import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { IntakeLeadDto } from './dto/intake-lead.dto';
import { Lead } from './lead.entity';
import { LeadEvent } from './lead-event.entity';

import { TenantsService } from '../tenants/tenants.service';
import { MessagingService } from '../messaging/messaging.service';
import { SequencesService } from '../sequences/sequences.service';

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    @InjectRepository(Lead)
    private readonly leadsRepository: Repository<Lead>,

    @InjectRepository(LeadEvent)
    private readonly leadEventsRepository: Repository<LeadEvent>,

    private readonly tenantsService: TenantsService,
    private readonly messagingService: MessagingService,
    private readonly sequencesService: SequencesService,
  ) {}

  async intake(tenantId: string, payload: IntakeLeadDto): Promise<Lead> {
    const tenant = await this.tenantsService.findById(tenantId);
    if (!tenant) {
      throw new Error('Invalid tenant');
    }

    const normalizedPhone = payload.phone
      ? payload.phone.replace(/\D/g, '')
      : undefined;

    // Dedupe only using fields that exist in the request
    const where: Array<Record<string, any>> = [];
    if (payload.email) {
      where.push({ tenant: { id: tenantId }, email: payload.email });
    }
    if (normalizedPhone) {
      where.push({ tenant: { id: tenantId }, phone: normalizedPhone });
    }

    const existing =
      where.length > 0
        ? await this.leadsRepository.findOne({
            where,
            relations: ['tenant'],
          })
        : null;

    if (existing) {
      this.logger.log(`Deduped lead ${existing.id}`);
      await this.logLeadEvent(existing, 'deduped', payload as any);
      return existing;
    }

    const lead = this.leadsRepository.create({
      ...payload,
      phone: normalizedPhone,
      tenant,
      leadType: payload.leadType ?? 'buyer',
      temperature: payload.temperature ?? 'warm',
    });

    const saved = await this.leadsRepository.save(lead);

    await this.logLeadEvent(saved, 'created', payload as any);

    // Automation hooks (instant email/SMS + sequences)
    await this.messagingService.queueInstantResponses(saved);
    await this.sequencesService.startForLead(saved);

    return saved;
  }

  async logLeadEvent(
    lead: Lead,
    eventType: string,
    metadata?: Record<string, any>,
  ) {
    const event = this.leadEventsRepository.create({
      lead,
      eventType,
      metadata,
    });

    return this.leadEventsRepository.save(event);
  }

  async listLeads(params: { tenantId?: string; take: number; skip: number }) {
    const where = params.tenantId ? { tenant: { id: params.tenantId } } : {};

    const [items, total] = await this.leadsRepository.findAndCount({
      where,
      relations: ['tenant'],
      order: { createdAt: 'DESC' },
      take: params.take,
      skip: params.skip,
    });

    return {
      items,
      total,
      take: params.take,
      skip: params.skip,
    };
  }

  async getLeadById(id: string) {
    const lead = await this.leadsRepository.findOne({
      where: { id },
      relations: ['tenant'],
    });

    if (!lead) {
      throw new Error('Lead not found');
    }

    return lead;
  }
}