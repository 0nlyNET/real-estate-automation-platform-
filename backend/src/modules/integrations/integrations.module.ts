import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Credential } from '../settings/credential.entity';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { CommonModule } from '../../common/common.module';
import { OperationsModule } from '../operations/operations.module';
import { PlatformCredential } from './platform-credential.entity';
import { PlatformIntegrationsService } from './platform-integrations.service';
import {
  AdminSalesBookingController,
  PublicSalesBookingController,
} from './sales-booking.controller';
import { SalesBookingService } from './sales-booking.service';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { TenantMessagingResource } from './tenant-messaging-resource.entity';
import { TenantEmailIdentity } from './tenant-email-identity.entity';
import { ProviderConfigService } from './provider-config.service';
import { TwilioProvisioningService } from './twilio-provisioning.service';
import { EmailIdentityService } from './email-identity.service';
import { Tenant } from '../tenants/tenant.entity';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { AuditModule } from '../audit/audit.module';
import { TwilioComplianceService } from './twilio-compliance.service';
import { OnboardingRecord } from '../onboarding/onboarding-record.entity';
import { CalendarOAuthState } from '../calendar/calendar-oauth-state.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Credential,
      PlatformCredential,
      TenantMessagingResource,
      TenantEmailIdentity,
      Tenant,
      OnboardingRecord,
      CalendarOAuthState,
    ]),
    CommonModule,
    OperationsModule,
    OnboardingModule,
    AuditModule,
  ],
  controllers: [
    IntegrationsController,
    AdminSalesBookingController,
    PublicSalesBookingController,
  ],
  providers: [
    IntegrationsService,
    PlatformIntegrationsService,
    SalesBookingService,
    ProviderConfigService,
    TwilioProvisioningService,
    EmailIdentityService,
    TenantProvisioningService,
    TwilioComplianceService,
  ],
  exports: [
    IntegrationsService,
    PlatformIntegrationsService,
    SalesBookingService,
    ProviderConfigService,
    TwilioProvisioningService,
    EmailIdentityService,
    TenantProvisioningService,
    TwilioComplianceService,
  ],
})
export class IntegrationsModule {}
