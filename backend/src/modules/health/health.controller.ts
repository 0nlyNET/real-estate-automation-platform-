import {
  Controller,
  Get,
  Headers,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { timingSafeEqual } from 'crypto';
import type { Response } from 'express';
import { DataSource } from 'typeorm';
import { environmentReadiness } from '../../common/environment-readiness';
import { SchemaReadinessService } from '../../database/schema-readiness.service';

@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly schema: SchemaReadinessService,
  ) {}

  @Get('live')
  live() {
    return { status: 'up', process: { status: 'up' } };
  }

  @Get()
  check() {
    return this.live();
  }

  @Get(['readiness', 'ready'])
  async readiness(
    @Headers('x-health-check-token') suppliedToken: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertDetailedHealthAccess(suppliedToken);
    const configuration = environmentReadiness();
    let database: Record<string, unknown> = { status: 'down' };
    let schema: Record<string, unknown> = { status: 'unknown' };
    let migrations: Record<string, unknown> = { status: 'unknown' };
    let credentialStorage: Record<string, unknown> = { status: 'unknown' };
    let durableWorkers: Record<string, unknown> = { status: 'unknown' };

    try {
      await this.dataSource.query('SELECT 1');
      database = { status: 'up' };

      const report = await this.schema.inspect();
      schema = this.schema.summary(report);

      const pending = await this.dataSource.showMigrations();
      migrations = { status: pending ? 'down' : 'up', pending };

      const workerRows: Array<{ failed: string; stalled: string }> =
        await this.dataSource.query(
          `SELECT
             COUNT(*) FILTER (WHERE status = 'failed')::text AS failed,
             COUNT(*) FILTER (
               WHERE status = 'running' AND lease_expires_at < NOW()
             )::text AS stalled
           FROM durable_jobs`,
        );
      const failed = Number(workerRows[0]?.failed || 0);
      const stalled = Number(workerRows[0]?.stalled || 0);
      durableWorkers = {
        status: failed || stalled ? 'down' : 'up',
        failed,
        stalled,
      };

      if (report.ok) {
        const rows: Array<{ count: string | number }> = await this.dataSource.query(
          `SELECT COUNT(*) AS count
             FROM credentials
            WHERE "encryptedValue" IS NOT NULL
              AND "encryptedValue" NOT LIKE 'v1:%'`,
        );
        const legacyPlaintextRows = Number(rows[0]?.count || 0);
        credentialStorage = {
          status: legacyPlaintextRows ? 'down' : 'up',
          legacyPlaintextRows,
        };
      }
    } catch {
      // A public health response intentionally omits connection strings and exception text.
    }

    const ready =
      database.status === 'up' &&
      schema.status === 'up' &&
      migrations.status === 'up' &&
      credentialStorage.status === 'up' &&
      durableWorkers.status === 'up' &&
      configuration.runtime.status === 'up' &&
      configuration.encryption.status === 'up' &&
      configuration.systemEmail.status !== 'down' &&
      configuration.billing.status !== 'down';

    if (!ready) response.status(503);
    return {
      status: ready ? 'ready' : 'not_ready',
      process: { status: 'up' },
      database,
      schema,
      migrations,
      configuration,
      credentialStorage,
      durableWorkers,
    };
  }

  private assertDetailedHealthAccess(suppliedToken?: string) {
    // Staging and development deployments can contain real connection and
    // schema metadata too. Only the isolated test runtime may bypass the
    // monitor credential; /health/live remains the intentionally public probe.
    if (process.env.NODE_ENV === 'test') return;
    const expected = Buffer.from(
      String(process.env.HEALTH_CHECK_TOKEN || ''),
      'utf8',
    );
    const supplied = Buffer.from(String(suppliedToken || ''), 'utf8');
    if (
      expected.length < 32 ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      throw new UnauthorizedException('Detailed health check is protected');
    }
  }
}
