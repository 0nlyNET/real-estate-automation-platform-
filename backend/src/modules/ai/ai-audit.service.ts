import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { sanitizeAuditMetadata } from '../audit/audit-metadata';
import { AuditService } from '../audit/audit.service';
import { LeadEvent } from '../leads/lead-event.entity';

@Injectable()
export class AiAuditService {
  constructor(
    @InjectRepository(LeadEvent)
    private readonly leadEvents: Repository<LeadEvent>,
    private readonly audit: AuditService,
  ) {}

  async recordSystem(
    leadId: string,
    eventType: string,
    metadata?: Record<string, unknown>,
  ) {
    return this.leadEvents.save(
      this.leadEvents.create({
        leadId,
        eventType,
        metadata: sanitizeAuditMetadata(metadata) || {},
      } as any),
    );
  }

  async recordHuman(input: {
    tenantId: string;
    actorId: string;
    actorEmail?: string | null;
    action: string;
    leadId: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.audit.record({
      tenantId: input.tenantId,
      actorId: input.actorId,
      actorEmail: input.actorEmail,
      action: input.action,
      method: 'POST',
      path: `/ai/conversations/${input.leadId}`,
      statusCode: 200,
      metadata: {
        leadId: input.leadId,
        ...(input.metadata || {}),
      },
    });
  }
}
