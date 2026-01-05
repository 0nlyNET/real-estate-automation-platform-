import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { IntakeLeadDto } from './dto/intake-lead.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';

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

  // -------------------------
  // Helpers
  // -------------------------

  private normalizePhone(phone?: string): string | undefined {
    if (!phone) return undefined;
    const digits = String(phone).replace(/\D/g, '');
    return digits || undefined;
  }

  private normalizeEmail(email?: string): string | undefined {
    if (!email) return undefined;
    const v = String(email).trim().toLowerCase();
    return v || undefined;
  }

  private normalizeName(name?: string): string {
    return String(name || '').trim();
  }

  private normalizeString(v: any): string | undefined {
    if (v === null || v === undefined) return undefined;
    const s = String(v).trim();
    return s || undefined;
  }

  private normalizeStringArray(v: any): string[] | undefined {
    if (v === null || v === undefined) return undefined;
    if (!Array.isArray(v)) return undefined;
    const arr = v
      .filter(Boolean)
      .map((x) => String(x).trim())
      .filter(Boolean);
    return arr.length ? arr : undefined;
  }

  private clampScore(v: any): number | undefined {
    if (v === null || v === undefined) return undefined;
    const n = Number(v);
    if (Number.isNaN(n)) return undefined;
    return Math.max(0, Math.min(100, Math.floor(n)));
  }

  private async requireTenant(tenantId?: string) {
    if (!tenantId) throw new Error('Missing tenant');
    const tenant = await this.tenantsService.findById(tenantId);
    if (!tenant) throw new Error('Invalid tenant');
    return tenant;
  }

  private async findDuplicateLead(params: {
    tenantId: string;
    email?: string;
    phone?: string;
  }): Promise<Lead | null> {
    const where: Array<Record<string, any>> = [];
    if (params.email) where.push({ tenantId: params.tenantId, email: params.email });
    if (params.phone) where.push({ tenantId: params.tenantId, phone: params.phone });
    if (where.length === 0) return null;

    // Passing array for "where" => OR conditions
    return (await this.leadsRepository.findOne({ where })) || null;
  }

  // -------------------------
  // Events
  // -------------------------

  async logLeadEvent(lead: Lead, eventType: string, metadata?: Record<string, any>) {
    const event = this.leadEventsRepository.create({
      lead,
      eventType,
      metadata,
    });
    return this.leadEventsRepository.save(event);
  }

  // -------------------------
  // Public intake (webhook/forms/FB)
  // -------------------------

  async intake(tenantId: string, payload: IntakeLeadDto): Promise<Lead> {
    const tenant = await this.requireTenant(tenantId);

    const fullName = this.normalizeName(payload.fullName);
    if (!fullName) throw new Error('fullName is required');

    const email = this.normalizeEmail(payload.email);
    const phone = this.normalizePhone(payload.phone);

    const existing = await this.findDuplicateLead({ tenantId: tenant.id, email, phone });
    if (existing) {
      this.logger.log(`Deduped lead ${existing.id}`);
      await this.logLeadEvent(existing, 'deduped', payload as any);
      return existing;
    }

    const lead = this.leadsRepository.create({
      tenant,
      tenantId: tenant.id,

      fullName,
      email,
      phone,

      source: this.normalizeString(payload.source) || 'Website',
      location: this.normalizeString(payload.location),
      propertyInterest: this.normalizeString(payload.propertyInterest),

      leadType: (payload.leadType ?? 'buyer') as any,
      temperature: (payload.temperature ?? 'warm') as any,
      stage: (payload.stage ?? 'new') as any,

      budgetRange: this.normalizeString((payload as any).budgetRange),
      estimatedPrice: this.normalizeString((payload as any).estimatedPrice),
      preferredAreas: this.normalizeStringArray((payload as any).preferredAreas),

      notes: this.normalizeString((payload as any).notes),

      score: this.clampScore((payload as any).score),

      lastActivityAt: new Date(),
    } as Partial<Lead>);

    const saved = await this.leadsRepository.save(lead as Lead);

    await this.logLeadEvent(saved, 'created', payload as any);

    // Automation hooks
    await this.messagingService.queueInstantResponses(saved);
    await this.sequencesService.startForLead(saved);

    return saved;
  }

  // -------------------------
  // Protected: agent manually creates a lead
  // -------------------------

  async createLead(tenantId: string | undefined, payload: CreateLeadDto): Promise<Lead> {
    const tenant = await this.requireTenant(tenantId);

    const fullName = this.normalizeName(payload.fullName);
    if (!fullName) throw new Error('fullName is required');

    const email = this.normalizeEmail(payload.email);
    const phone = this.normalizePhone(payload.phone);

    const existing = await this.findDuplicateLead({ tenantId: tenant.id, email, phone });
    if (existing) {
      await this.logLeadEvent(existing, 'deduped', payload as any);
      return existing;
    }

    const lead = this.leadsRepository.create({
      tenant,
      tenantId: tenant.id,

      fullName,
      email,
      phone,

      source: this.normalizeString(payload.source) || 'Manual',
      location: this.normalizeString(payload.location),
      propertyInterest: this.normalizeString(payload.propertyInterest),

      leadType: (payload.leadType ?? 'buyer') as any,
      temperature: (payload.temperature ?? 'warm') as any,
      stage: (payload.stage ?? 'new') as any,

      budgetRange: this.normalizeString((payload as any).budgetRange),
      estimatedPrice: this.normalizeString((payload as any).estimatedPrice),
      preferredAreas: this.normalizeStringArray((payload as any).preferredAreas),

      notes: this.normalizeString((payload as any).notes),

      assignedTo: this.normalizeString((payload as any).assignedTo),
      score: this.clampScore((payload as any).score),
      nextFollowUpAt: (payload as any).nextFollowUpAt ? new Date((payload as any).nextFollowUpAt) : undefined,

      lastActivityAt: new Date(),
    } as Partial<Lead>);

    const saved = await this.leadsRepository.save(lead as Lead);
    await this.logLeadEvent(saved, 'created', payload as any);

    const trigger = (payload as any).triggerAutomation !== false;
    if (trigger) {
      await this.messagingService.queueInstantResponses(saved);
      await this.sequencesService.startForLead(saved);
    }

    return saved;
  }

  // -------------------------
  // Protected: agent updates lead
  // -------------------------

  async updateLead(tenantId: string | undefined, id: string, payload: UpdateLeadDto): Promise<Lead> {
    if (!tenantId) throw new Error('Missing tenant');

    const lead = await this.leadsRepository.findOne({ where: { id, tenantId } });
    if (!lead) throw new Error('Lead not found');

    if (payload.fullName !== undefined) {
      const v = this.normalizeName(payload.fullName);
      if (v) lead.fullName = v;
    }

    if (payload.email !== undefined) lead.email = this.normalizeEmail(payload.email);
    if (payload.phone !== undefined) lead.phone = this.normalizePhone(payload.phone);

    if (payload.source !== undefined) lead.source = this.normalizeString(payload.source);
    if (payload.location !== undefined) lead.location = this.normalizeString(payload.location);
    if (payload.propertyInterest !== undefined) lead.propertyInterest = this.normalizeString(payload.propertyInterest);

    if (payload.leadType !== undefined) lead.leadType = payload.leadType as any;
    if (payload.temperature !== undefined) lead.temperature = payload.temperature as any;
    if (payload.stage !== undefined) lead.stage = payload.stage as any;

    if ((payload as any).budgetRange !== undefined) lead.budgetRange = this.normalizeString((payload as any).budgetRange);
    if ((payload as any).estimatedPrice !== undefined) lead.estimatedPrice = this.normalizeString((payload as any).estimatedPrice);
    if ((payload as any).preferredAreas !== undefined) lead.preferredAreas = this.normalizeStringArray((payload as any).preferredAreas);

    if ((payload as any).notes !== undefined) lead.notes = this.normalizeString((payload as any).notes);
    if ((payload as any).assignedTo !== undefined) lead.assignedTo = this.normalizeString((payload as any).assignedTo);

    if (payload.score !== undefined) {
      const sc = this.clampScore(payload.score);
      if (sc !== undefined) lead.score = sc;
    }

    if ((payload as any).nextFollowUpAt !== undefined) {
      lead.nextFollowUpAt = (payload as any).nextFollowUpAt ? new Date((payload as any).nextFollowUpAt) : undefined;
    }

    lead.lastActivityAt = new Date();

    const saved = await this.leadsRepository.save(lead);
    await this.logLeadEvent(saved, 'updated', payload as any);
    return saved;
  }

  // -------------------------
  // Protected: sample leads for demo/onboarding
  // -------------------------

  async createSampleLeads(tenantId: string | undefined): Promise<Lead[]> {
    const tenant = await this.requireTenant(tenantId);

    const now = Date.now();

    const samples: Array<Partial<Lead>> = [
      {
        fullName: 'Ava Johnson',
        leadType: 'buyer' as any,
        stage: 'new' as any,
        temperature: 'warm' as any,
        score: 58,
        source: 'Facebook',
        location: 'Brooklyn',
        propertyInterest: '2 bed condo',
        budgetRange: '$650k-$800k',
      },
      {
        fullName: 'Marcus Lee',
        leadType: 'seller' as any,
        stage: 'active' as any,
        temperature: 'warm' as any,
        score: 62,
        source: 'Referral',
        location: 'Queens',
        propertyInterest: 'List my townhouse',
        estimatedPrice: '$900k-$1.1M',
      },
      {
        fullName: 'Sofia Martinez',
        leadType: 'buyer' as any,
        stage: 'hot' as any,
        temperature: 'hot' as any,
        score: 88,
        source: 'Website',
        location: 'Manhattan',
        propertyInterest: '1 bed rental',
      },
      {
        fullName: 'Daniel Kim',
        leadType: 'investor' as any,
        stage: 'active' as any,
        temperature: 'warm' as any,
        score: 73,
        source: 'Open house',
        location: 'Jersey City',
        propertyInterest: 'Multi-family cashflow',
      },
      {
        fullName: 'Emily Chen',
        leadType: 'buyer' as any,
        stage: 'under_contract' as any,
        temperature: 'hot' as any,
        score: 85,
        source: 'Facebook',
        location: 'Long Island',
        propertyInterest: '3 bed single family',
      },
      {
        fullName: 'Noah Williams',
        leadType: 'seller' as any,
        stage: 'new' as any,
        temperature: 'cold' as any,
        score: 42,
        source: 'Manual',
        location: 'Bronx',
        propertyInterest: 'Thinking about selling',
      },
      {
        fullName: 'Olivia Brown',
        leadType: 'renter' as any,
        stage: 'active' as any,
        temperature: 'warm' as any,
        score: 55,
        source: 'Website',
        location: 'Downtown Brooklyn',
        propertyInterest: 'Studio rental',
      },
      {
        fullName: 'Ethan Davis',
        leadType: 'buyer' as any,
        stage: 'closed' as any,
        temperature: 'warm' as any,
        score: 67,
        source: 'Referral',
        location: 'Staten Island',
        propertyInterest: 'Starter home',
      },
    ];

    const created: Lead[] = [];

    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];

      const unique = `${now}-${i}`;
      const email = `sample+${tenant.id.slice(0, 6)}-${unique}@realtytechai.dev`;
      const phone = `555${String((now + i) % 10000000).padStart(7, '0')}`;

      // IMPORTANT: no "as any" here. Use Partial<Lead> so TS picks the single-entity overload.
      const lead = this.leadsRepository.create({
        ...s,
        email,
        phone,
        tenant,
        tenantId: tenant.id,
        lastActivityAt: new Date(),
        nextFollowUpAt: i % 3 === 0 ? new Date() : undefined,
      } as Partial<Lead>);

      const saved = await this.leadsRepository.save(lead as Lead);

      await this.logLeadEvent(saved, 'sample_created', { sample: true });

      created.push(saved);
    }

    return created;
  }

  // -------------------------
  // Protected: list and get
  // -------------------------

  async listLeads(params: { tenantId?: string; take: number; skip: number }): Promise<Lead[]> {
    if (!params.tenantId) return [];

    return this.leadsRepository.find({
      where: { tenantId: params.tenantId },
      order: { createdAt: 'DESC' },
      take: params.take,
      skip: params.skip,
    });
  }

  async getLeadById(tenantId: string | undefined, id: string): Promise<Lead> {
    if (!tenantId) throw new Error('Missing tenant');

    const lead = await this.leadsRepository.findOne({
      where: { id, tenantId },
    });

    if (!lead) throw new Error('Lead not found');

    return lead;
  }
}