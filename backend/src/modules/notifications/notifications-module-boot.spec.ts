/**
 * Regression test for the circular runtime dependency that crashed the Nest
 * backend during dependency injection in browser-e2e:
 *
 *   NotificationsService (..., ?, DurableJobsService)
 *
 * where the `?` (constructor index 4) was an undefined `MailService`.
 *
 * Root cause was a circular file import:
 *   notifications.service.ts -> mail.service.ts
 *     -> integrations.service.ts (for decryptIntegrationPayload)
 *     -> notifications.service.ts
 *
 * When mail.service.ts was evaluated before notifications.service.ts (the
 * order the e2e bootstrap hit), the re-entrant import returned a partially
 * initialized module and `MailService` was baked into
 * NotificationsService's decorator metadata as `undefined`.
 *
 * The fix extracts the pure crypto helpers into
 * `modules/integrations/integration-crypto.ts` (dependency-free), so
 * mail.service.ts no longer pulls in integrations.service.ts.
 *
 * This test boots the REAL Nest module graph (MailModule, IntegrationsModule,
 * NotificationsModule) in the crash-triggering import order and proves the DI
 * container can instantiate NotificationsService with a defined MailService.
 * Manually constructing NotificationsService would NOT catch this: the
 * failure lives in the module-evaluation order + decorator metadata.
 */

// Import order reproduces the production crash: mail.service.ts evaluated
// before notifications.service.ts.
import { MailModule } from '../../mail/mail.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { NotificationsModule } from './notifications.module';

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Global, Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MailService } from '../../mail/mail.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { OperationsService } from '../operations/operations.service';
import { NotificationsService } from './notifications.service';
import { AdminNotification } from './notification.entity';
import { AdminNotificationPreference } from './notification-preference.entity';
import { AdminPushSubscription } from './push-subscription.entity';
import { NotificationIncident } from './notification-incident.entity';
import { User } from '../users/user.entity';
import { StripeWebhookEvent } from '../billing/stripe-webhook-event.entity';
import { OperationsTask } from '../operations/operations-task.entity';
import { ProspectApplication } from '../public/prospect-application.entity';
import { AiRun } from '../ai/ai-run.entity';
import { Message } from '../messaging/message.entity';
import { SequenceEnrollment } from '../sequences/sequence-enrollment.entity';
import { TenantMessagingResource } from '../integrations/tenant-messaging-resource.entity';
import { TenantEmailIdentity } from '../integrations/tenant-email-identity.entity';
import { Lead } from '../leads/lead.entity';
import { Appointment } from '../client-operations/appointment.entity';
import { Tenant } from '../tenants/tenant.entity';
import { PlatformCredential } from '../integrations/platform-credential.entity';
import { Credential } from '../settings/credential.entity';
import { OnboardingRecord } from '../onboarding/onboarding-record.entity';
import { AuditLog } from '../audit/audit-log.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { SequenceStep } from '../sequences/sequence-step.entity';
import { TestRun } from '../testing/test-run.entity';
import { CalendarConnection } from '../calendar/calendar-connection.entity';
import { TenantWebhookSubscription } from '../crm-events/tenant-webhook-subscription.entity';
import { DurableJob } from '../durable-jobs/durable-job.entity';
import { UsagePolicy } from '../limits/usage-policy.entity';
import { UsageBucket } from '../limits/usage-bucket.entity';
import { UsageReservation } from '../limits/usage-reservation.entity';

const REPOSITORY_ENTITIES = [
  AdminNotification,
  AdminNotificationPreference,
  AdminPushSubscription,
  NotificationIncident,
  User,
  StripeWebhookEvent,
  OperationsTask,
  ProspectApplication,
  AiRun,
  Message,
  SequenceEnrollment,
  TenantMessagingResource,
  TenantEmailIdentity,
  Lead,
  Appointment,
  Tenant,
  PlatformCredential,
  Credential,
  OnboardingRecord,
  AuditLog,
  TenantSettings,
  SequenceStep,
  TestRun,
  CalendarConnection,
  TenantWebhookSubscription,
  DurableJob,
  UsagePolicy,
  UsageBucket,
  UsageReservation,
];

function mockRepository() {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn().mockImplementation((v: any) => Promise.resolve(v)),
    update: jest.fn().mockResolvedValue(undefined),
    count: jest.fn().mockResolvedValue(0),
  };
}

/**
 * Several services in the graph (ConversationLockService, HealthMonitorService,
 * TwilioProvisioningService, TenantQualityMonitorService, ServiceControlService)
 * inject TypeORM's DataSource, which only exists when TypeOrmModule.forRoot()
 * runs against a real database. This global stub satisfies those injection
 * points so the real module graph can boot without a database. The
 * circular-dependency failure this test guards against happens at
 * module-evaluation/DI-metadata time, which this stub does not mask.
 */
@Global()
@Module({
  providers: [{ provide: DataSource, useValue: {} }],
  exports: [DataSource],
})
class DataSourceStubModule {}

describe('notifications module graph boot (circular dependency regression)', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    const builder = Test.createTestingModule({
      imports: [
        DataSourceStubModule,
        MailModule,
        IntegrationsModule,
        NotificationsModule,
      ],
    });
    for (const entity of REPOSITORY_ENTITIES) {
      builder
        .overrideProvider(getRepositoryToken(entity))
        .useValue(mockRepository());
    }
    // Heavy cross-module collaborators: replaced so the graph boots without
    // a database or external providers. The circular-dependency failure this
    // guards against happens at module-evaluation/DI-metadata time, which
    // these mocks do not mask.
    builder.overrideProvider(OnboardingService).useValue({});
    builder.overrideProvider(OperationsService).useValue({});
    moduleRef = await builder.compile();
    await moduleRef.init();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('instantiates NotificationsService from the real module graph', () => {
    const service = moduleRef.get(NotificationsService, { strict: false });
    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(NotificationsService);
  });

  it('injects a defined MailService into NotificationsService (was undefined at index 4)', () => {
    const service = moduleRef.get(NotificationsService, { strict: false });
    const mailService = moduleRef.get(MailService, { strict: false });
    expect(mailService).toBeDefined();
    expect(mailService).toBeInstanceOf(MailService);
    const injected = (service as any).mailService;
    expect(injected).toBeDefined();
    expect(injected).toBeInstanceOf(MailService);
    expect(injected).toBe(mailService);
  });

  it('has no undefined entries in NotificationsService constructor metadata', () => {
    const paramTypes: any[] =
      Reflect.getMetadata('design:paramtypes', NotificationsService) || [];
    expect(paramTypes.length).toBeGreaterThan(0);
    expect(paramTypes).not.toContain(undefined);
    expect(paramTypes).toContain(MailService);
  });

  it('also instantiates IntegrationsService alongside the graph', () => {
    const service = moduleRef.get(IntegrationsService, { strict: false });
    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(IntegrationsService);
  });
});
