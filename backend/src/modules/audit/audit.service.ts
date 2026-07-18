import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './audit-log.entity';
import { sanitizeAuditMetadata } from './audit-metadata';

export type AuditRecord = {
  tenantId: string;
  actorId: string;
  actorEmail?: string | null;
  action: string;
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

  async record(input: AuditRecord): Promise<AuditLog> {
    const row = this.repository.create({
      ...input,
      actorEmail: input.actorEmail?.trim().toLowerCase() || null,
      metadata: sanitizeAuditMetadata(input.metadata),
    });
    return this.repository.save(row);
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
