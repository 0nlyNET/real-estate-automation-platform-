import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuthModule } from '../auth/auth.module';

import { Tenant } from '../tenants/tenant.entity';
import { User } from '../users/user.entity';
import { Lead } from '../leads/lead.entity';
import { Message } from '../messaging/message.entity';
import { Credential } from '../settings/credential.entity';
import { CommonModule } from '../../common/common.module';
import { AuditModule } from '../audit/audit.module';
import { MailModule } from '../../mail/mail.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { OnboardingRecord } from '../onboarding/onboarding-record.entity';
import { ProspectApplication } from '../public/prospect-application.entity';
import { OperationsTask } from '../operations/operations-task.entity';
import { SupportTicket } from '../support/support-ticket.entity';
import { BillingEvent } from '../billing/billing-event.entity';
import { ServiceControlModule } from '../service-control/service-control.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      Tenant,
      User,
      Lead,
      Message,
      Credential,
      TenantSettings,
      OnboardingRecord,
      ProspectApplication,
      OperationsTask,
      SupportTicket,
      BillingEvent,
    ]),
    CommonModule,
    AuditModule,
    MailModule,
    OnboardingModule,
    ServiceControlModule,
    IntegrationsModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
