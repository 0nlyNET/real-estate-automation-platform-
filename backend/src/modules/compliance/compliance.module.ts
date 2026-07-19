import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ComplianceOptOut } from './compliance-optout.entity';
import { ComplianceEvent } from './compliance-event.entity';
import { TenantQuietHours } from './tenant-quiet-hours.entity';
import { ComplianceService } from './compliance.service';
import { ComplianceController } from './compliance.controller';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { CommonModule } from '../../common/common.module';
import { DataExportService } from './data-export.service';
import { Tenant } from '../tenants/tenant.entity';
import { User } from '../users/user.entity';
import { Team } from '../teams/team.entity';
import { Lead } from '../leads/lead.entity';
import { Sequence } from '../sequences/sequence.entity';
import { RoutingRule } from '../routing/routing-rule.entity';
import { SupportTicket } from '../support/support-ticket.entity';
import { AuditLog } from '../audit/audit-log.entity';
import { IntegrationsModule } from '../integrations/integrations.module';
import { LeadConsentRecord } from './lead-consent-record.entity';
import { Message } from '../messaging/message.entity';
import { UnsubscribeController } from './unsubscribe.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ComplianceOptOut,
      ComplianceEvent,
      TenantQuietHours,
      TenantSettings,
      Tenant,
      User,
      Team,
      Lead,
      Sequence,
      RoutingRule,
      SupportTicket,
      AuditLog,
      LeadConsentRecord,
      Message,
    ]),
    CommonModule,
    IntegrationsModule,
  ],
  providers: [ComplianceService, DataExportService],
  controllers: [ComplianceController, UnsubscribeController],
  exports: [ComplianceService],
})
export class ComplianceModule {}
