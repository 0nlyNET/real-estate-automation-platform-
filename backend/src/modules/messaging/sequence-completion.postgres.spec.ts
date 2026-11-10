import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { buildDatabaseOptions } from '../../database/database-options';
import { Tenant } from '../tenants/tenant.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { Credential } from '../settings/credential.entity';
import { Lead } from '../leads/lead.entity';
import { LeadEvent } from '../leads/lead-event.entity';
import { Sequence } from '../sequences/sequence.entity';
import { SequenceStep } from '../sequences/sequence-step.entity';
import { SequenceEnrollment } from '../sequences/sequence-enrollment.entity';
import { SequencesService } from '../sequences/sequences.service';
import { EntitlementService } from '../entitlements/entitlement.service';
import { ComplianceService } from '../compliance/compliance.service';
import { ComplianceOptOut } from '../compliance/compliance-optout.entity';
import { ComplianceEvent } from '../compliance/compliance-event.entity';
import { TenantQuietHours } from '../compliance/tenant-quiet-hours.entity';
import { LeadConsentRecord } from '../compliance/lead-consent-record.entity';
import { CommunicationSuppression } from '../compliance/communication-suppression.entity';
import { Message } from './message.entity';
import { MessagingService } from './messaging.service';

const testUrl = process.env.TEST_POSTGRES_URL;
const postgres = testUrl ? describe : describe.skip;

// Real migrations, enrollment scheduling, message leases, consent, stop SQL and
// dispatch provenance. Only provider transport/configuration and unrelated
// operational notifications are stubbed; no live email or Stripe call occurs.
postgres('final sequence step dispatch (PostgreSQL)', () => {
  const databaseName = `rta_sequence_${randomUUID().replace(/-/g, '')}`;
  const originalPause = process.env.GLOBAL_AUTOMATIONS_DISABLED;
  let admin: Client;
  let source: DataSource;
  let sequences: SequencesService;
  let messaging: MessagingService;
  let compliance: ComplianceService;
  let sendEmail: jest.Mock;
  jest.setTimeout(120_000);

  beforeAll(async () => {
    const parsed = new URL(testUrl!);
    if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
      throw new Error('Sequence regressions require a local disposable PostgreSQL server');
    }
    admin = new Client({ connectionString: testUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    parsed.pathname = `/${databaseName}`;
    source = new DataSource({
      ...(buildDatabaseOptions(parsed.toString()) as PostgresConnectionOptions),
      type: 'postgres', synchronize: false, migrationsRun: false, ssl: false,
    });
    await source.initialize();
    await source.runMigrations();
    compliance = new ComplianceService(
      source.getRepository(ComplianceOptOut), source.getRepository(ComplianceEvent),
      source.getRepository(TenantQuietHours), source.getRepository(TenantSettings),
      source.getRepository(LeadConsentRecord), source.getRepository(Lead),
      source.getRepository(Message), source.getRepository(CommunicationSuppression),
    );
    const entitlements = new EntitlementService(
      source.getRepository(Tenant), source.getRepository(TenantSettings),
    );
    const operations = { createTask: jest.fn() };
    sequences = new SequencesService(
      source, source.getRepository(Sequence), source.getRepository(SequenceEnrollment),
      source.getRepository(SequenceStep), source.getRepository(Message),
      source.getRepository(LeadEvent), source.getRepository(Tenant),
      source.getRepository(TenantSettings), source.getRepository(Lead),
      compliance, entitlements, operations as any,
    );
    messaging = new MessagingService(
      source, source.getRepository(Message), source.getRepository(Lead),
      source.getRepository(Tenant), source.getRepository(LeadEvent),
      source.getRepository(Credential), sequences, compliance,
      {
        evaluateMessageSafety: async ({ leadId, clientId }: any) => {
          const lead = await source.getRepository(Lead).findOneByOrFail({ id: leadId, tenantId: clientId });
          const decision = await compliance.communicationEligibility(clientId, lead, 'email');
          return { allowed: decision.allowed, reasons: [], ruleIds: [] };
        },
      } as any,
      operations as any, {} as any, undefined, undefined, undefined,
      {
        resolveSendGrid: async () => ({ apiKey: 'unused-qa-transport', fromEmail: 'qa@example.test' }),
        resolveTwilio: async () => null,
      } as any,
    );
    sendEmail = jest.fn(async () => ({ providerMessageId: randomUUID(), providerStatus: 'accepted' }));
    jest.spyOn(messaging as any, 'sendEmail').mockImplementation(sendEmail);
  });

  beforeEach(() => {
    process.env.GLOBAL_AUTOMATIONS_DISABLED = 'false';
    sendEmail.mockClear();
  });

  afterAll(async () => {
    if (originalPause === undefined) delete process.env.GLOBAL_AUTOMATIONS_DISABLED;
    else process.env.GLOBAL_AUTOMATIONS_DISABLED = originalPause;
    jest.restoreAllMocks();
    if (source?.isInitialized) await source.destroy();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
    }
  });

  async function queueFinalStep() {
    // Paid state is a disposable QA fixture, not a real subscription/payment.
    const subscription = `sub_qa_${randomUUID()}`;
    const tenant = await source.getRepository(Tenant).save({
      name: 'Isolated sequence QA', status: 'active', lifecycleStatus: 'ACTIVE',
      stripeSubscriptionId: subscription, paidSubscriptionId: subscription,
      paymentConfirmedAt: new Date(),
    });
    await source.getRepository(TenantSettings).save({ tenantId: tenant.id, automationsEnabled: true });
    await source.getRepository(TenantQuietHours).save({
      tenantId: tenant.id, enabled: false, timezone: 'UTC', startMinute: 0, endMinute: 0,
    });
    const lead = await source.getRepository(Lead).save({
      tenantId: tenant.id, tenant, fullName: 'Sequence QA',
      email: `${randomUUID()}@example.test`, leadType: 'buyer', temperature: 'warm',
      stage: 'new', communicationStatus: 'active',
    });
    await compliance.recordLeadConsent(tenant.id, lead.id, {
      email: { affirmative: true, source: 'isolated_qa', consentedAt: new Date().toISOString(),
        disclosureText: 'Synthetic regression recipient; provider transport is disabled.', clientAttested: true },
    });
    const created = await sequences.createSequence(tenant.id, { name: 'Single final step', leadType: 'buyer', temperature: 'warm' });
    const step = await sequences.addStep(tenant.id, created.id, {
      channel: 'email', offsetMinutes: 0, identityLabel: 'Sequence QA',
      template: 'Sequence QA: approved final follow-up {{unsubscribeUrl}}',
    });
    if (!step.ok || !step.id) throw new Error('Could not create the approved regression step');
    await sequences.approveStep(tenant.id, created.id, step.id, randomUUID());
    await sequences.updateSequence(tenant.id, created.id, { active: true });
    await sequences.startForLead(lead);
    const enrollment = await source.getRepository(SequenceEnrollment).findOneByOrFail({ tenantId: tenant.id, leadId: lead.id });
    await expect(sequences.processDueEnrollments()).resolves.toEqual({ claimed: 1 });
    const message = await source.getRepository(Message).findOneByOrFail({ leadId: lead.id });
    expect(message.status).toBe('queued');
    expect(await source.getRepository(SequenceEnrollment).findOneByOrFail({ id: enrollment.id }))
      .toMatchObject({ status: 'completed', currentStepIndex: 1 });
    return { tenant, lead, enrollment, message };
  }

  it('dispatches the final queued step once after the real scheduler completes the enrollment', async () => {
    const { lead, message } = await queueFinalStep();
    await expect(messaging.processPendingOutbound({ leadId: lead.id })).resolves.toEqual({ claimed: 1, recovered: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(await source.getRepository(Message).findOneByOrFail({ id: message.id }))
      .toMatchObject({ status: 'provider_accepted' });
    await expect(messaging.processPendingOutbound({ leadId: lead.id })).resolves.toEqual({ claimed: 0, recovered: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('still cancels a completed enrollment final step when a reply arrives before dispatch', async () => {
    const { tenant, lead, message } = await queueFinalStep();
    await sequences.stopForLead(tenant.id, lead.id, 'reply');
    expect(await source.getRepository(Message).findOneByOrFail({ id: message.id }))
      .toMatchObject({ status: 'canceled', errorCode: 'CANCELLED_BY_ENROLLMENT_STOP' });
    await expect(messaging.processPendingOutbound({ leadId: lead.id })).resolves.toEqual({ claimed: 0, recovered: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('never accepts a completed enrollment belonging to another tenant or lead', async () => {
    const { message } = await queueFinalStep();
    const foreignTenant = await source.getRepository(Tenant).save({ name: 'Foreign QA tenant' });
    const foreignLead = await source.getRepository(Lead).save({
      tenantId: foreignTenant.id, tenant: foreignTenant, fullName: 'Foreign QA',
      email: `${randomUUID()}@example.test`, stage: 'new', communicationStatus: 'active',
    });
    await compliance.recordLeadConsent(foreignTenant.id, foreignLead.id, {
      email: { affirmative: true, source: 'isolated_qa', consentedAt: new Date().toISOString(),
        disclosureText: 'Synthetic regression recipient; provider transport is disabled.', clientAttested: true },
    });
    const forged = await source.getRepository(Message).save({
      leadId: foreignLead.id, lead: foreignLead, channel: 'email', direction: 'outbound',
      status: 'queued', body: message.body, authorship: 'template', communicationType: 'sequence',
      idempotencyKey: message.idempotencyKey!.replace(':0:email:', ':99:email:'),
    });
    await messaging.processPendingOutbound({ leadId: foreignLead.id });
    expect(await source.getRepository(Message).findOneByOrFail({ id: forged.id }))
      .toMatchObject({ status: 'canceled', errorCode: 'ENROLLMENT_STOPPED' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('still suppresses a completed enrollment final step after recipient opt-out', async () => {
    const { tenant, lead, message } = await queueFinalStep();
    await compliance.addOptOut(tenant.id, 'email', lead.email!, 'isolated_qa', 'regression');
    expect(await source.getRepository(Message).findOneByOrFail({ id: message.id }))
      .toMatchObject({ status: 'canceled', errorCode: 'RECIPIENT_OPTED_OUT' });
    await expect(messaging.processPendingOutbound({ leadId: lead.id })).resolves.toEqual({ claimed: 0, recovered: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
