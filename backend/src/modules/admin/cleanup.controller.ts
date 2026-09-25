import { Controller, Delete, ForbiddenException, Param, Req } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';

// TEMPORARY: Permanent tenant deletion for stale test data cleanup.
// REMOVE THIS FILE after the cleanup is complete.
@Controller('cleanup')
export class CleanupController {
  private readonly PROTECTED_TENANT_IDS = new Set([
    'c2d3b240-7b15-491a-acf7-d26ea0f6d907', // TEST - Launch Rehearsal
    'dd11ce21-fb97-4610-814a-9ad528d96ebf', // The Row Properties Inc.
  ]);

  private readonly CLEANUP_SECRET = 'temp-cleanup-2026-09-25-jayden-authorized';

  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  @Delete('tenants/:tenantId/permanent')
  async permanentDeleteTenant(
    @Param('tenantId') tenantId: string,
    @Req() req: any,
  ) {
    if (req.headers['x-cleanup-secret'] !== this.CLEANUP_SECRET) {
      throw new ForbiddenException('Invalid cleanup secret');
    }

    if (this.PROTECTED_TENANT_IDS.has(tenantId)) {
      throw new ForbiddenException('This tenant is protected and cannot be deleted');
    }

    const tenant = await this.dataSource.query(
      'SELECT id, name FROM tenants WHERE id = $1',
      [tenantId],
    );
    if (!tenant || tenant.length === 0) {
      throw new ForbiddenException('Tenant not found');
    }
    const tenantName = tenant[0].name;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.query(
        'DELETE FROM lead_ingestion_events WHERE tenant_id = $1',
        [tenantId],
      );
      await queryRunner.query(
        'DELETE FROM twilio_inbound_messages WHERE tenant_id = $1',
        [tenantId],
      );
      await queryRunner.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    await this.audit.record({
      tenantId,
      actorId: 'cleanup-script',
      actorEmail: 'aiautomationsllc@gmail.com',
      action: 'tenant.permanent_delete',
      method: 'DELETE',
      path: `/cleanup/tenants/${tenantId}/permanent`,
      statusCode: 200,
      metadata: { tenantId, tenantName },
    });

    return { deleted: true, tenantId, tenantName };
  }
}
