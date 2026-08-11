import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { IntegrationIngressEvent } from '../crm-events/integration-ingress-event.entity';
import { TenantIntegrationConnection } from '../crm-events/tenant-integration-connection.entity';
import { LeadsModule } from '../leads/leads.module';
import { TestRun } from '../testing/test-run.entity';
import { CrmIntegrationsController, ZapierIngressController } from './crm-integrations.controller';
import { CrmIntegrationsService } from './crm-integrations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TenantIntegrationConnection, IntegrationIngressEvent, TestRun]),
    LeadsModule,
    AuditModule,
  ],
  controllers: [CrmIntegrationsController, ZapierIngressController],
  providers: [CrmIntegrationsService],
  exports: [CrmIntegrationsService],
})
export class CrmIntegrationsModule {}
