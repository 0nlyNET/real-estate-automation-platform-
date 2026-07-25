import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * A database-backed mutex shared by every application instance that may send
 * a message for the same lead. The callback intentionally runs while the
 * transaction-scoped advisory lock is held so a human and the AI cannot send
 * overlapping replies from different workers.
 */
@Injectable()
export class ConversationLockService {
  constructor(private readonly dataSource: DataSource) {}

  async withLock<T>(
    tenantId: string,
    leadId: string,
    callback: () => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `conversation:${tenantId}:${leadId}`,
      ]);
      return callback();
    });
  }
}
