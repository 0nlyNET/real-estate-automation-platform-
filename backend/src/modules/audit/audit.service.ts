import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditLog } from './audit-log.entity';
import { sanitizeAuditMetadata } from './audit-metadata';

export type AuditRecord = {
  tenantId: string;
  actorId: string;
  actorType?: AuditLog['actorType'];
  actorEmail?: string | null;
  action: string;
  eventType?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  ipAddress?: string | null;
  method: string;
  path: string;
  statusCode: number;
  metadata?: Record<string, unknown> | null;
};

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly repository: Repository<AuditLog>,
  ) {}

  async record(input: AuditRecord, manager?: EntityManager): Promise<AuditLog> {
    const repository = manager?.getRepository(AuditLog) ?? this.repository;
    const row = repository.create({
      ...input,
      actorType: input.actorType || 'user',
      actorEmail: input.actorEmail?.trim().toLowerCase() || null,
      eventType: input.eventType || input.action,
      beforeState: sanitizeAuditMetadata(input.beforeState),
      afterState: sanitizeAuditMetadata(input.afterState),
      metadata: sanitizeAuditMetadata(input.metadata),
    });
    return repository.save(row);
  }

  recordSystemEvent(
    input: {
      tenantId: string;
      eventType: string;
      resourceType?: string | null;
      resourceId?: string | null;
      beforeState?: Record<string, unknown> | null;
      afterState?: Record<string, unknown> | null;
      metadata?: Record<string, unknown> | null;
    },
    manager?: EntityManager,
  ) {
    return this.record(
      {
        tenantId: input.tenantId,
        actorId: '00000000-0000-0000-0000-000000000000',
        actorType: 'system',
        action: input.eventType,
        eventType: input.eventType,
        resourceType: input.resourceType || null,
        resourceId: input.resourceId || null,
        beforeState: input.beforeState || null,
        afterState: input.afterState || null,
        metadata: input.metadata || null,
        method: 'SYSTEM',
        path: '/system',
        statusCode: 200,
      },
      manager,
    );
  }

  async listForTenant(tenantId: string, take = 100, skip = 0) {
    return this.repository.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(take, 1), 250),
      skip: Math.max(skip, 0),
    });
  }
}
