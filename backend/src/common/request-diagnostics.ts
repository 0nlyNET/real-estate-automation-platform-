import type { DataSource } from 'typeorm';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;

/**
 * Return the single request ID shared across the whole request lifecycle.
 * The HTTP middleware in main.ts assigns `req.correlationId` from the
 * incoming `x-request-id` header (or generates one) and echoes it back, so
 * every layer must use it instead of generating its own ID.
 */
export function requestIdOf(req: any): string {
  const fromMiddleware = req?.correlationId;
  if (typeof fromMiddleware === 'string' && fromMiddleware.length > 0) {
    return fromMiddleware;
  }
  const fromHeader = req?.headers?.['x-request-id'];
  if (typeof fromHeader === 'string' && REQUEST_ID_PATTERN.test(fromHeader)) {
    return fromHeader;
  }
  return 'no-request-id';
}

export type PgPoolStats = {
  total: number;
  idle: number;
  waiting: number;
};

/**
 * Safe pg pool counters for diagnostics: waiting clients, pool size, idle
 * clients. Never includes credentials, connection strings, or query text.
 */
export function pgPoolStats(dataSource: DataSource | undefined | null): PgPoolStats | null {
  try {
    const pool: any = (dataSource?.driver as any)?.master;
    if (!pool || typeof pool.totalCount !== 'number') return null;
    return {
      total: pool.totalCount,
      idle: typeof pool.idleCount === 'number' ? pool.idleCount : -1,
      waiting: typeof pool.waitingCount === 'number' ? pool.waitingCount : -1,
    };
  } catch {
    return null;
  }
}
