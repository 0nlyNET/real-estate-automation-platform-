import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OnboardingRecord } from './onboarding-record.entity';
import { Tenant } from '../tenants/tenant.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { Credential } from '../settings/credential.entity';
import { SequenceStep } from '../sequences/sequence-step.entity';
import { billingEligibility } from '../entitlements/entitlement.service';
import { decryptIntegrationPayload } from '../integrations/integrations.service';
import {
  operationalEvent,
  sanitizeOperationalText,
} from '../../common/operational-log';
import { OperationsService } from '../operations/operations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlatformOperatorsService } from '../../common/platform-operators.service';
import { isSafeBookingUrl } from '../../common/booking-link';
import { normalizePhoneE164 } from '../../common/phone';
import { LimitsService } from '../limits/limits.service';
import { AuditService } from '../audit/audit.service';
import { TenantMessagingResource } from '../integrations/tenant-messaging-resource.entity';
import { TenantEmailIdentity } from '../integrations/tenant-email-identity.entity';
import { TestRun } from '../testing/test-run.entity';

type ReadinessCategory =
  | 'client_information'
  | 'provider_configuration'
  | 'controlled_live_test'
  | 'external_provider_approval'
  | 'client_approval'
  | 'platform_approval'
  | 'billing'
  | 'platform_control';

type ResponsibleParty = 'client' | 'jayden' | 'provider' | 'platform';

type ReadinessItem = {
  key: string;
  label: string;
  passed: boolean;
  required: boolean;
  category: ReadinessCategory;
  responsibleParty: ResponsibleParty;
  statusMessage: string;
  nextAction: string | null;
  verifiedAt?: string | null;
  verifiedBy?: string | null;
};

function hasText(record: Record<string, unknown>, key: string) {
  return String(record?.[key] || '').trim().length > 0;
}

function dateOrNull(value: string | null | undefined) {
  return value ? new Date(value) : value === null ? null : undefined;
}

function validEmail(value: unknown) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    String(value || '').trim().toLowerCase(),
  );
}

function missingTextFields(
  record: Record<string, unknown>,
  fields: Record<string, string>,
) {
  return Object.entries(fields)
    .filter(([key]) => !hasText(record, key))
    .map(([, label]) => label);
}

function verifiedBookingLink(settings: TenantSettings | null) {
  if (!settings || !isSafeBookingUrl(settings.bookingLink)) return false;
  return Boolean(
    settings.bookingLinkVerificationStatus === 'verified' &&
      settings.bookingLinkVerifiedAt &&
      !settings.bookingLinkRevokedAt &&
      (!settings.bookingLinkVerificationExpiresAt ||
        settings.bookingLinkVerificationExpiresAt > new Date()),
  );
}

function safeProviderTestPatch(value: Record<string, unknown>) {
  const result: Record<string, string> = {};
  for (const key of [
    'twilioMessagingApprovalStatus',
    'sendgridSenderVerificationStatus',
  ]) {
    if (value[key] === undefined) continue;
    const status = String(value[key] || '').trim().toLowerCase();
    if (!['pending', 'approved', 'blocked'].includes(status)) {
      throw new BadRequestException(`${key} must be pending, approved, or blocked`);
    }
    result[key] = status;
  }
  for (const key of [
    'twilioApprovalReference',
    'sendgridApprovalReference',
    'endToEndTestReference',
    'providerRejectionReference',
  ]) {
    if (value[key] === undefined) continue;
    const reference = sanitizeOperationalText(value[key], 500).trim();
    if (!reference) {
      throw new BadRequestException(`${key} cannot be empty`);
    }
    result[key] = reference;
  }
  return result;
}

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    @InjectRepository(OnboardingRecord)
    private readonly records: Repository<OnboardingRecord>,
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    @InjectRepository(TenantSettings)
    private readonly settings: Repository<TenantSettings>,
    @InjectRepository(Credential)
    private readonly credentials: Repository<Credential>,
    @InjectRepository(SequenceStep)
    private readonly steps: Repository<SequenceStep>,
    private readonly operations: OperationsService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly platformOperators?: PlatformOperatorsService,
    @Optional() private readonly limits?: LimitsService,
    @Optional() private readonly audit?: AuditService,
    @Optional()
    @InjectRepository(TenantMessagingResource)
    private readonly messagingResources?: Repository<TenantMessagingResource>,
    @Optional()
    @InjectRepository(TenantEmailIdentity)
    private readonly emailIdentities?: Repository<TenantEmailIdentity>,
    @Optional()
    @InjectRepository(TestRun)
    private readonly testRuns?: Repository<TestRun>,
  ) {}

  async getOrCreate(tenantId: string) {
    let record = await this.records.findOne({ where: { tenantId } });
    if (!record) {
      const tenant = await this.tenants.findOne({ where: { id: tenantId } });
      if (!tenant) throw new NotFoundException('Workspace not found');
      record = await this.records.save(
        this.records.create({
          tenantId,
          businessIdentity: {},
          contacts: {},
          serviceScope: {},
          leadHandling: {},
          brandCommunication: {},
          consentConfiguration: {},
          integrationConfiguration: {},
          providerTests: {},
          verifiedItems: {},
          smsEnabled: false,
          emailEnabled: false,
          bookingEnabled: false,
          activationStatus: 'incomplete',
          configurationUpdatedAt: new Date(),
        }),
      );
    }
    return record;
  }

  async updateClientInput(tenantId: string, patch: Partial<OnboardingRecord>) {
    const record = await this.getOrCreate(tenantId);
    const allowed: Array<keyof OnboardingRecord> = [
      'businessIdentity',
      'contacts',
      'serviceScope',
      'leadHandling',
      'brandCommunication',
      'consentConfiguration',
      'integrationConfiguration',
      'smsEnabled',
      'emailEnabled',
      'bookingEnabled',
      'targetLaunchDate',
    ];
    const changed = allowed.filter(
      (key) =>
        patch[key] !== undefined &&
        JSON.stringify(patch[key]) !== JSON.stringify(record[key]),
    );
    for (const key of allowed) {
      if (patch[key] !== undefined) (record as any)[key] = patch[key];
    }
    if (changed.length > 0) {
      const messagingConfigurationChanged = changed.some((key) =>
        [
          'businessIdentity',
          'serviceScope',
          'leadHandling',
          'brandCommunication',
          'consentConfiguration',
          'integrationConfiguration',
          'smsEnabled',
          'emailEnabled',
          'bookingEnabled',
        ].includes(key),
      );
      this.invalidateRecordEvidence(record, {
        reason: 'Client onboarding information changed',
        retestMessaging: messagingConfigurationChanged,
        twilioApproval:
          messagingConfigurationChanged &&
          changed.some((key) =>
            ['businessIdentity', 'brandCommunication', 'smsEnabled'].includes(
              key,
            ),
          ),
        sendgridApproval:
          messagingConfigurationChanged &&
          changed.some((key) =>
            ['businessIdentity', 'brandCommunication', 'emailEnabled'].includes(
              key,
            ),
          ),
      });
      if (changed.includes('consentConfiguration')) {
        record.consentPolicyAcknowledgedAt = null;
      }
    }
    const saved = await this.records.save(record);
    await this.notifications?.createForPlatform({
      eventType: 'onboarding.client_updated',
      category: 'onboarding',
      severity: 'info',
      title: 'Client updated onboarding',
      message: 'A client saved onboarding information. Review their readiness when convenient.',
      deduplicationKey: `onboarding-client-update:${saved.id}:${saved.updatedAt.getTime()}`,
      actionUrl: '/admin/dashboard?view=onboarding',
      entityType: 'tenant',
      entityId: tenantId,
    });
    return saved;
  }

  private invalidateRecordEvidence(
    record: OnboardingRecord,
    options: {
      reason: string;
      retestMessaging?: boolean;
      retestEndToEnd?: boolean;
      twilioApproval?: boolean;
      sendgridApproval?: boolean;
    },
  ) {
    record.activationStatus = 'incomplete';
    record.blockedReason = options.reason.slice(0, 1_000);
    record.configurationUpdatedAt = new Date();
    record.clientApprovedAt = null;
    record.clientApprovalEvidence = null;
    record.operatorApprovedById = null;
    record.operatorApprovedAt = null;
    const providerTests = { ...(record.providerTests || {}) };
    const verifiedItems = { ...(record.verifiedItems || {}) };
    delete verifiedItems.activation;
    if (options.retestMessaging || options.retestEndToEnd) {
      record.testLeadCompletedAt = null;
      delete providerTests.endToEndTestReference;
      delete verifiedItems.test_lead;
    }
    if (options.retestMessaging) {
      record.inboundSmsTestedAt = null;
      record.inboundEmailTestedAt = null;
      record.stopTestedAt = null;
      record.providerRejectionTestedAt = null;
      delete providerTests.providerRejectionReference;
      for (const key of [
        'inbound_sms',
        'inbound_email',
        'stop',
        'provider_rejection',
      ]) {
        delete verifiedItems[key];
      }
    }
    if (options.twilioApproval) {
      delete providerTests.twilioMessagingApprovalStatus;
      delete providerTests.twilioApprovalReference;
      delete providerTests.twilioApprovalRecordedAt;
    }
    if (options.sendgridApproval) {
      delete providerTests.sendgridSenderVerificationStatus;
      delete providerTests.sendgridApprovalReference;
      delete providerTests.sendgridApprovalRecordedAt;
    }
    record.providerTests = providerTests;
    record.verifiedItems = verifiedItems;
  }

  async invalidateLaunchEvidence(
    tenantId: string,
    options: {
      reason: string;
      retestMessaging?: boolean;
      retestEndToEnd?: boolean;
      twilioApproval?: boolean;
      sendgridApproval?: boolean;
    },
  ) {
    const record = await this.getOrCreate(tenantId);
    this.invalidateRecordEvidence(record, options);
    return this.records.save(record);
  }

  async recordBillingFromStripe(input: {
    tenantId: string;
    eventReference: string;
    eligible: boolean;
    subscriptionStatus: string;
  }) {
    const record = await this.getOrCreate(input.tenantId);
    record.billingVerifiedAt = input.eligible ? new Date() : null;
    const verifiedItems = { ...(record.verifiedItems || {}) } as Record<string, any>;
    if (input.eligible) {
      verifiedItems.billing_evidence = {
        verifiedAt: record.billingVerifiedAt!.toISOString(),
        verifiedBy: 'system:stripe',
        eventReference: input.eventReference,
        subscriptionStatus: input.subscriptionStatus,
      };
    } else {
      delete verifiedItems.billing_evidence;
    }
    record.verifiedItems = verifiedItems;
    return this.records.save(record);
  }

  async recordOperatorEvidence(
    tenantId: string,
    patch: Record<string, any>,
    operatorId: string,
  ) {
    const record = await this.getOrCreate(tenantId);
    if (patch.providerTests !== undefined) {
      const providerTestPatch = safeProviderTestPatch(patch.providerTests);
      const evidenceTime = new Date().toISOString();
      if (providerTestPatch.twilioMessagingApprovalStatus !== undefined) {
        providerTestPatch.twilioApprovalRecordedAt = evidenceTime;
      }
      if (providerTestPatch.sendgridSenderVerificationStatus !== undefined) {
        providerTestPatch.sendgridApprovalRecordedAt = evidenceTime;
      }
      record.providerTests = {
        ...(record.providerTests || {}),
        ...providerTestPatch,
      };
    }
    if (patch.verifiedItems !== undefined) {
      record.verifiedItems = {
        ...(record.verifiedItems || {}),
        ...patch.verifiedItems,
      };
    }
    for (const key of [
      'consentPolicyAcknowledgedAt',
      'testLeadCompletedAt',
      'inboundSmsTestedAt',
      'inboundEmailTestedAt',
      'stopTestedAt',
      'providerRejectionTestedAt',
      'billingVerifiedAt',
      'clientApprovedAt',
    ] as const) {
      if (patch[key] !== undefined) (record as any)[key] = dateOrNull(patch[key]);
    }
    if (patch.clientApprovalEvidence !== undefined)
      record.clientApprovalEvidence = patch.clientApprovalEvidence;
    if (patch.assignedOnboardingOwnerId !== undefined) {
      await this.platformOperators?.requireAssignable(patch.assignedOnboardingOwnerId);
      record.assignedOnboardingOwnerId = patch.assignedOnboardingOwnerId;
    }
    if (patch.operatorApproved === true) {
      record.operatorApprovedById = operatorId;
      record.operatorApprovedAt = new Date();
    } else if (patch.operatorApproved === false) {
      record.operatorApprovedById = null;
      record.operatorApprovedAt = null;
    }
    const saved = await this.records.save(record);
    if (patch.assignedOnboardingOwnerId) {
      await this.notifications?.createForPlatform({
        eventType: 'onboarding.assigned',
        category: 'onboarding',
        severity: 'warning',
        title: 'Onboarding assigned to you',
        message: 'A client onboarding workspace is ready for your review.',
        deduplicationKey: `onboarding-assigned:${saved.id}:${patch.assignedOnboardingOwnerId}`,
        assignedOperatorId: patch.assignedOnboardingOwnerId,
        actionUrl: '/admin/dashboard?view=onboarding',
        entityType: 'tenant',
        entityId: tenantId,
      });
    }
    if (
      patch.clientApprovedAt !== undefined ||
      patch.clientApprovalEvidence !== undefined
    ) {
      await this.operations.createTask({
        tenantId,
        category: 'launch_approval',
        title: 'Review workspace for launch approval',
        description:
          'Client approval evidence changed. Recalculate readiness, verify the controlled tests, and record the platform launch decision.',
        priority: 'high',
        dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        relatedEntityType: 'tenant',
        relatedEntityId: tenantId,
        dedupeOpen: true,
      });
    }
    return saved;
  }

  async recordAutomatedTestEvidence(
    tenantId: string,
    evidence: {
      inboundSms?: boolean;
      inboundEmail?: boolean;
      stop?: boolean;
      providerRejection?: boolean;
      outboundDelivered?: boolean;
      testRunId?: string | null;
    },
  ) {
    const record = await this.getOrCreate(tenantId);
    const tenant = await this.tenants.findOne({ where: { id: tenantId } });
    if (
      tenant?.lifecycleStatus !== 'TESTING' ||
      !evidence.testRunId ||
      !this.testRuns
    ) return record;
    const run = await this.testRuns.findOne({
      where: { id: evidence.testRunId, tenantId, status: 'running' },
    });
    if (!run || run.expiresAt <= new Date()) return record;
    const now = new Date();
    const verifiedItems = { ...(record.verifiedItems || {}) };
    let changed = false;
    const mark = (
      property:
        | 'inboundSmsTestedAt'
        | 'inboundEmailTestedAt'
        | 'stopTestedAt'
        | 'providerRejectionTestedAt',
      key: string,
      enabled: boolean | undefined,
    ) => {
      if (!enabled) return;
      const configurationUpdatedAt =
        record.configurationUpdatedAt?.getTime?.() || 0;
      if (
        record[property] &&
        record[property]!.getTime() >= configurationUpdatedAt
      ) {
        return;
      }
      record[property] = now;
      verifiedItems[key] = {
        verifiedAt: now.toISOString(),
        verifiedBy: 'system:webhook',
      };
      changed = true;
    };
    mark('inboundSmsTestedAt', 'inbound_sms', evidence.inboundSms);
    mark('inboundEmailTestedAt', 'inbound_email', evidence.inboundEmail);
    mark('stopTestedAt', 'stop', evidence.stop);
    mark(
      'providerRejectionTestedAt',
      'provider_rejection',
      evidence.providerRejection,
    );
    if (evidence.outboundDelivered && !record.testLeadCompletedAt) {
      record.testLeadCompletedAt = now;
      verifiedItems.test_lead = {
        verifiedAt: now.toISOString(),
        verifiedBy: 'system:provider_callback',
        testRunId: run.id,
      };
      run.checks = { ...run.checks, outbound: 'delivered' };
      record.providerTests = {
        ...(record.providerTests || {}),
        endToEndTestReference: `test-run:${run.id}`,
        endToEndTestRecordedAt: now.toISOString(),
      };
      changed = true;
    }
    if (evidence.inboundSms || evidence.inboundEmail || evidence.stop) {
      run.checks = {
        ...run.checks,
        ...(evidence.inboundSms ? { inboundSms: 'passed' } : {}),
        ...(evidence.inboundEmail ? { inboundEmail: 'passed' } : {}),
        ...(evidence.stop ? { stop: 'passed' } : {}),
      };
    }
    if (evidence.providerRejection) {
      run.checks = { ...run.checks, providerRejection: 'passed' };
      record.providerTests = {
        ...(record.providerTests || {}),
        providerRejectionReference: `test-run:${run.id}`,
        providerRejectionRecordedAt: now.toISOString(),
      };
      changed = true;
    }
    const checks = run.checks as Record<string, unknown>;
    const passed =
      checks.outbound === 'delivered' &&
      (!record.smsEnabled ||
        (checks.inboundSms === 'passed' && checks.stop === 'passed')) &&
      (!record.emailEnabled || checks.inboundEmail === 'passed');
    if (passed) {
      run.status = 'passed';
      run.completedAt = now;
    }
    await this.testRuns.save(run);
    if (!changed) return record;
    record.verifiedItems = verifiedItems;
    return this.records.save(record);
  }

  private async approvedTemplateCounts(tenantId: string) {
    const rows = await this.steps
      .createQueryBuilder('step')
      .innerJoin('step.sequence', 'sequence')
      .where('sequence.tenant_id = :tenantId', { tenantId })
      .andWhere('sequence.active = true')
      .andWhere('step.approval_status = :approved', { approved: 'approved' })
      .andWhere('step.active = true')
      .select('step.channel', 'channel')
      .addSelect('COUNT(*)', 'count')
      .groupBy('step.channel')
      .getRawMany();
    return new Map(rows.map((row) => [String(row.channel), Number(row.count)]));
  }

  async readiness(tenantId: string) {
    const record = await this.getOrCreate(tenantId);
    const tenant = await this.tenants.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Workspace not found');
    const settings = await this.settings.findOne({ where: { tenantId } });
    const [
      tenantUsagePolicy,
      platformUsagePolicy,
      safetyIncidentOpen,
      managedTwilio,
      managedEmail,
    ] =
      await Promise.all([
        this.limits?.getTenantPolicy(tenantId) || Promise.resolve(null),
        this.limits?.getPlatformPolicy() || Promise.resolve(null),
        this.operations.hasOpenSafetyIncident?.(tenantId) ||
          Promise.resolve(false),
        this.messagingResources?.findOne({ where: { tenantId } }) ||
          Promise.resolve(null),
        this.emailIdentities?.findOne({ where: { tenantId } }) ||
          Promise.resolve(null),
      ]);
    const credentials = await this.credentials.find({
      where: { tenant: { id: tenantId } as any },
      relations: ['tenant'],
    });
    const credentialRows = new Map(credentials.map((row) => [row.provider, row]));
    const integrations = new Map(
      credentials.map((row) => [
        row.provider,
        decryptIntegrationPayload(row.encryptedValue),
      ]),
    );
    const templates = await this.approvedTemplateCounts(tenantId);
    const billing = billingEligibility(tenant);
    const items: ReadinessItem[] = [];
    const add = (
      key: string,
      label: string,
      passed: boolean,
      required = true,
      details: Partial<
        Pick<
          ReadinessItem,
          | 'category'
          | 'responsibleParty'
          | 'statusMessage'
          | 'nextAction'
        >
      > = {},
    ) => {
      const evidence = (record.verifiedItems as any)?.[key] || {};
      items.push({
        key,
        label,
        passed,
        required,
        category: details.category || 'client_information',
        responsibleParty: details.responsibleParty || 'client',
        statusMessage: passed
          ? 'Complete'
          : details.statusMessage || 'Required information is incomplete',
        nextAction: passed
          ? null
          : details.nextAction || 'Complete this item before launch review.',
        verifiedAt: evidence.verifiedAt || null,
        verifiedBy: evidence.verifiedBy || null,
      });
    };

    const businessMissing = missingTextFields(record.businessIdentity, {
      legalBusinessName: 'legal business name',
      publicBusinessName: 'public business name',
      primaryMarket: 'primary market',
    });
    const contactFields: Record<string, string> = {
      accountOwner: 'account owner email',
      billingContact: 'billing email',
      operationsContact: 'operations email',
      supportContact: 'support email',
      approvalContact: 'approval email',
      escalationContact: 'escalation email',
    };
    const invalidContacts = Object.entries(contactFields)
      .filter(([key]) => !validEmail(record.contacts[key]))
      .map(([, label]) => label);
    const serviceChannels = Array.isArray(record.serviceScope.includedChannels)
      ? record.serviceScope.includedChannels.filter(Boolean)
      : [];
    const leadSources = Array.isArray(record.serviceScope.leadSources)
      ? record.serviceScope.leadSources.map((source) =>
          String(source).toLowerCase(),
        )
      : [];
    const metaRequired = leadSources.some(
      (source) => source.includes('meta') || source.includes('facebook'),
    );
    const intakeRequired = leadSources.some((source) => source.includes('api'));
    const twilio = integrations.get('twilio');
    const twilioRow = credentialRows.get('twilio');
    const twilioFromNumber = normalizePhoneE164(twilio?.fromNumber);
    const approvedPhone = normalizePhoneE164(
      String(record.brandCommunication.approvedPhoneIdentity || ''),
    );
    const twilioRuntimeReady = managedTwilio
      ? Boolean(
          ['testing', 'ready'].includes(managedTwilio.smsStatus) &&
            managedTwilio.twilioSubaccountSid &&
            managedTwilio.messagingServiceSid &&
            managedTwilio.phoneNumber &&
            managedTwilio.encryptedAuthToken &&
            managedTwilio.twilioApiKeySid &&
            managedTwilio.encryptedApiSecret &&
            approvedPhone === normalizePhoneE164(managedTwilio.phoneNumber),
        )
      : Boolean(
          twilio?.connected === true &&
            !twilio?.error &&
            twilio?.accountSid &&
            twilio?.authToken &&
            twilioFromNumber &&
            twilioRow?.routingKey === twilioFromNumber &&
            approvedPhone === twilioFromNumber &&
            twilio?.lastSync,
        );
    const sendgrid = integrations.get('sendgrid');
    const sendgridRow = credentialRows.get('sendgrid');
    const sendgridFromEmail = String(sendgrid?.fromEmail || '')
      .trim()
      .toLowerCase();
    const sendgridInboundAddress = String(sendgrid?.inboundAddress || '')
      .trim()
      .toLowerCase();
    const approvedEmail = String(
      record.brandCommunication.approvedEmailIdentity || '',
    )
      .trim()
      .toLowerCase();
    const sendgridRuntimeReady = managedEmail
      ? Boolean(
          ['testing', 'ready'].includes(managedEmail.emailStatus) &&
            managedEmail.reputationStatus !== 'blocked' &&
            validEmail(managedEmail.fromEmail) &&
            validEmail(managedEmail.inboundAddress) &&
            managedEmail.fromName &&
            approvedEmail === managedEmail.fromEmail.toLowerCase(),
        )
      : Boolean(
          sendgrid?.connected === true &&
            !sendgrid?.error &&
            sendgrid?.apiKey &&
            validEmail(sendgridFromEmail) &&
            String(sendgrid?.fromName || '').trim() &&
            validEmail(sendgridInboundAddress) &&
            String(sendgridRow?.routingKey || '').trim().toLowerCase() ===
              sendgridInboundAddress &&
            approvedEmail === sendgridFromEmail &&
            sendgrid?.lastSync,
        );
    const providerTests = record.providerTests || {};
    const configurationUpdatedAt =
      record.configurationUpdatedAt?.getTime?.() ||
      record.createdAt?.getTime?.() ||
      0;
    const freshDate = (value: Date | null | undefined) =>
      Boolean(value && value.getTime() >= configurationUpdatedAt);
    const freshProviderEvidence = (value: unknown) => {
      const timestamp = new Date(String(value || '')).getTime();
      return Number.isFinite(timestamp) && timestamp >= configurationUpdatedAt;
    };
    const twilioProviderApproved = managedTwilio
      ? managedTwilio.a2pComplianceStatus === 'approved'
      : Boolean(
          providerTests.twilioMessagingApprovalStatus === 'approved' &&
            hasText(providerTests, 'twilioApprovalReference') &&
            freshProviderEvidence(providerTests.twilioApprovalRecordedAt),
        );
    const sendgridProviderApproved = managedEmail
      ? Boolean(managedEmail.lastVerifiedAt && managedEmail.emailStatus === 'ready')
      : Boolean(
          providerTests.sendgridSenderVerificationStatus === 'approved' &&
            hasText(providerTests, 'sendgridApprovalReference') &&
            freshProviderEvidence(providerTests.sendgridApprovalRecordedAt),
        );

    add('billing', 'Billing status is eligible', billing.allowed, true, {
      category: 'billing',
      responsibleParty: 'jayden',
      statusMessage: billing.reason || 'Billing is not eligible',
      nextAction: 'Resolve the billing status in the authorized billing workflow.',
    });
    add(
      'business_identity',
      'Business identity and market are complete',
      businessMissing.length === 0,
      true,
      {
        nextAction: `Provide: ${businessMissing.join(', ')}.`,
      },
    );
    add(
      'contacts',
      'Account, billing, operations, support, approval, and escalation emails are valid',
      invalidContacts.length === 0,
      true,
      {
        nextAction: `Provide valid values for: ${invalidContacts.join(', ')}.`,
      },
    );
    const controlledTestPhone = normalizePhoneE164(
      String(record.contacts.controlledTestPhone || ''),
    );
    const controlledTestEmail = String(
      record.contacts.controlledTestEmail || record.contacts.accountOwner || '',
    );
    add(
      'controlled_test_destinations',
      'Controlled SMS and email test destinations are valid',
      (!record.smsEnabled || Boolean(controlledTestPhone)) &&
        (!record.emailEnabled || validEmail(controlledTestEmail)),
      record.smsEnabled || record.emailEnabled,
      {
        nextAction:
          'Provide destinations you control for the automated end-to-end SMS and email tests.',
      },
    );
    add(
      'service_scope',
      'Package, channels, lead sources, and reporting scope are recorded',
      hasText(record.serviceScope, 'selectedPackage') &&
        serviceChannels.length > 0 &&
        leadSources.length > 0 &&
        hasText(record.serviceScope, 'expectedLeadVolume') &&
        hasText(record.serviceScope, 'reportingFrequency'),
      true,
      {
        nextAction:
          'Choose at least one messaging channel and provide lead sources, expected volume, and reporting frequency.',
      },
    );
    add(
      'lead_handling',
      'Lead routing and business hours are recorded',
      hasText(record.leadHandling, 'businessHours') &&
        hasText(record.leadHandling, 'routingRules') &&
        hasText(record.leadHandling, 'escalationBehavior') &&
        hasText(record.leadHandling, 'followUpTiming'),
      true,
      {
        nextAction:
          'Provide business hours, routing rules, escalation behavior, and follow-up timing.',
      },
    );
    add(
      'target_launch_date',
      'Target launch date is recorded',
      Boolean(record.targetLaunchDate),
      true,
      { nextAction: 'Choose the intended launch date.' },
    );
    add(
      'provider_owner',
      'Provider account owner and setup authorization are recorded',
      (!record.smsEnabled && !record.emailEnabled) ||
        (hasText(record.integrationConfiguration, 'providerAccountOwner') &&
          hasText(record.integrationConfiguration, 'authorizationStatus')),
      record.smsEnabled || record.emailEnabled,
      {
        nextAction:
          'Identify who owns the messaging provider accounts and confirm authorization for RealtyTechAI to configure them.',
      },
    );
    add(
      'timezone',
      'Time zone is configured and confirmed',
      Boolean(settings?.timeZone?.trim() && settings.timeZoneVerifiedAt),
      true,
      {
        nextAction: 'Save the client’s correct IANA time zone in workspace settings.',
      },
    );
    add(
      'quiet_hours',
      'Quiet hours are configured',
      Boolean(settings?.quietHoursStart && settings?.quietHoursEnd),
      true,
      {
        nextAction: 'Save the approved quiet-hours start and end times.',
      },
    );
    add(
      'booking_url',
      'Booking URL is configured, tested, and currently verified',
      !record.bookingEnabled || verifiedBookingLink(settings),
      record.bookingEnabled,
      {
        nextAction:
          'Open the saved HTTPS booking link, confirm the correct calendar, and record verification in workspace settings.',
      },
    );
    add(
      'brand',
      'Brand identity and voice are recorded',
      hasText(record.brandCommunication, 'brandName') &&
        hasText(record.brandCommunication, 'brandVoice') &&
        hasText(record.brandCommunication, 'requiredSignature') &&
        record.brandCommunication.fairHousingReviewAcknowledged === true &&
        (!record.smsEnabled || hasText(record.brandCommunication, 'approvedPhoneIdentity')) &&
        (!record.emailEnabled || hasText(record.brandCommunication, 'approvedEmailIdentity')),
      true,
      {
        nextAction:
          'Provide the brand name, voice, signature, fair-housing acknowledgement, and each enabled channel’s approved sender identity.',
      },
    );
    add(
      'consent_policy',
      'Consent policy and disclosure evidence are acknowledged',
      Boolean(record.consentPolicyAcknowledgedAt) &&
        hasText(record.consentConfiguration, 'exactConsentLanguage') &&
        hasText(record.consentConfiguration, 'consentCollectionMethod') &&
        hasText(record.consentConfiguration, 'sourceOwnership') &&
        hasText(record.consentConfiguration, 'optOutProcess') &&
        hasText(record.consentConfiguration, 'consentPolicyVersion') &&
        record.consentConfiguration.purchasedOrColdListsExcluded === true &&
        record.consentConfiguration.clientResponsibilityAcknowledged === true &&
        record.consentConfiguration.lawfulLeadCollectionCertified === true &&
        hasText(record.consentConfiguration, 'termsAcceptedVersion') &&
        hasText(record.consentConfiguration, 'privacyAcceptedVersion') &&
        hasText(record.consentConfiguration, 'acceptableUseAcceptedVersion') &&
        hasText(record.consentConfiguration, 'dataRetentionAcceptedVersion'),
      true,
      {
        nextAction:
          'Provide and acknowledge the exact consent language, collection method, source ownership, opt-out process, and evidence responsibilities.',
      },
    );
    add(
      'usage_limits',
      'Tenant and platform usage/cost limits are configured',
      Boolean(
        tenantUsagePolicy?.enabled &&
          platformUsagePolicy?.enabled &&
          tenantUsagePolicy.maxSmsPerHour > 0 &&
          tenantUsagePolicy.maxSmsPerDay > 0 &&
          tenantUsagePolicy.maxEmailsPerHour > 0 &&
          tenantUsagePolicy.maxEmailsPerDay > 0 &&
          tenantUsagePolicy.maxAiCallsPerDay > 0 &&
          Number(tenantUsagePolicy.hardCostThresholdUsd) > 0,
      ),
      true,
      {
        category: 'platform_control',
        responsibleParty: 'jayden',
        nextAction:
          'Configure tenant and platform hourly, daily, AI, warning-cost, and hard-cost safety limits.',
      },
    );
    const production = process.env.NODE_ENV === 'production';
    const restoreTestedAt = new Date(
      String(process.env.BACKUP_RESTORE_TESTED_AT || ''),
    );
    const restoreAge = Date.now() - restoreTestedAt.getTime();
    const disasterRecoveryReady =
      !production ||
      (Number.isFinite(restoreTestedAt.getTime()) &&
        restoreAge >= 0 &&
        restoreAge <= 90 * 24 * 60 * 60_000 &&
        Number(process.env.BACKUP_RPO_MINUTES) <= 60 &&
        Number(process.env.BACKUP_RTO_MINUTES) <= 240 &&
        Number(process.env.BACKUP_RETENTION_DAYS) >= 7 &&
        process.env.BACKUP_RESTORE_ISOLATED_VERIFIED === 'true' &&
        process.env.BACKUP_RESTORE_CREDENTIALS_PROTECTED === 'true');
    add(
      'disaster_recovery',
      'Production backup restore is proven within RPO/RTO targets',
      disasterRecoveryReady,
      true,
      {
        category: 'platform_control',
        responsibleParty: 'jayden',
        statusMessage: 'A recent isolated production restore test is not recorded',
        nextAction:
          'Complete the disaster-recovery runbook, verify restored leads/messages, and record the protected evidence variables.',
      },
    );
    const legalReviewedAt = new Date(
      String(process.env.LEGAL_DOCUMENTS_REVIEWED_AT || ''),
    );
    const legalReviewReady =
      !production ||
      (Number.isFinite(legalReviewedAt.getTime()) &&
        Date.now() - legalReviewedAt.getTime() >= 0 &&
        Date.now() - legalReviewedAt.getTime() <= 365 * 24 * 60 * 60_000);
    add(
      'legal_review',
      'Customer-facing terms and messaging obligations received legal review',
      legalReviewReady,
      true,
      {
        category: 'platform_control',
        responsibleParty: 'jayden',
        nextAction:
          'Have qualified counsel review the actual managed-service terms, privacy, acceptable-use, cancellation, messaging, and retention documents; then record the review date.',
      },
    );
    add(
      'tenant_safety',
      'No unresolved usage, quality, or security safety incident exists',
      !safetyIncidentOpen,
      true,
      {
        category: 'platform_control',
        responsibleParty: 'jayden',
        nextAction:
          'Resolve the open safety incident and document the corrective action before activation.',
      },
    );
    add(
      'testing_started',
      'Workspace entered controlled TESTING mode',
      ['TESTING', 'READY_FOR_ACTIVATION', 'ACTIVE', 'PAUSED'].includes(
        tenant.lifecycleStatus,
      ),
      true,
      {
        category: 'controlled_live_test',
        responsibleParty: 'jayden',
        nextAction:
          'Start controlled TESTING mode after profile, billing, providers, compliance, and safety limits are ready.',
      },
    );
    add(
      'twilio',
      'Twilio credentials, sender identity, and exact inbound route are ready',
      !record.smsEnabled || twilioRuntimeReady,
      record.smsEnabled,
      {
        category: 'provider_configuration',
        responsibleParty: 'jayden',
        statusMessage: sanitizeOperationalText(
          twilio?.error ||
            'The connection, assigned number, approved identity, or routing key is incomplete.',
        ),
        nextAction:
          'Assign the approved client number, confirm its exact routing key, and run the tenant Twilio connection test.',
      },
    );
    add(
      'sendgrid',
      'SendGrid credentials, branding, Reply-To, and exact inbound route are ready',
      !record.emailEnabled || sendgridRuntimeReady,
      record.emailEnabled,
      {
        category: 'provider_configuration',
        responsibleParty: 'jayden',
        statusMessage: sanitizeOperationalText(
          sendgrid?.error ||
            'The connection, sender, sender name, inbound Reply-To, approved identity, or routing key is incomplete.',
        ),
        nextAction:
          'Assign the approved from address and sender name, set a unique inbound Reply-To/routing key, and run the tenant SendGrid connection test.',
      },
    );
    add(
      'twilio_provider_approval',
      'Twilio sender registration or applicable Trust Hub/A2P approval is recorded',
      !record.smsEnabled || twilioProviderApproved,
      record.smsEnabled,
      {
        category: 'external_provider_approval',
        responsibleParty: 'provider',
        statusMessage:
          String(providerTests.twilioMessagingApprovalStatus || 'pending') ===
          'blocked'
            ? 'Blocked by Twilio approval'
            : 'Provider approval evidence is not recorded',
        nextAction:
          'Wait for the applicable Twilio sender registration/Trust Hub/A2P approval, then record the provider reference.',
      },
    );
    add(
      'sendgrid_provider_approval',
      'SendGrid sender identity or domain verification is recorded',
      !record.emailEnabled || sendgridProviderApproved,
      record.emailEnabled,
      {
        category: 'external_provider_approval',
        responsibleParty: 'provider',
        statusMessage:
          String(providerTests.sendgridSenderVerificationStatus || 'pending') ===
          'blocked'
            ? 'Blocked by SendGrid sender verification'
            : 'Provider verification evidence is not recorded',
        nextAction:
          'Complete SendGrid sender/domain verification through the provider, then record the provider reference.',
      },
    );
    add(
      'meta',
      'Meta Lead Ads is connected and tested',
      !metaRequired ||
        (integrations.get('facebook_lead_ads')?.connected === true &&
          Boolean(integrations.get('facebook_lead_ads')?.lastSync)),
      metaRequired,
      {
        category: 'provider_configuration',
        responsibleParty: 'client',
        nextAction: 'Authorize the correct Meta page and form, then complete a test lead.',
      },
    );
    add(
      'intake_api',
      'Custom intake API key is configured',
      !intakeRequired || Boolean(settings?.intakeApiKeyHash),
      intakeRequired,
      {
        category: 'provider_configuration',
        responsibleParty: 'jayden',
        nextAction: 'Generate the client intake key through the secure interface.',
      },
    );
    add(
      'intake_api_test',
      'Custom intake API received a controlled test lead',
      !intakeRequired || Boolean(settings?.intakeLastReceivedAt),
      intakeRequired,
      {
        category: 'controlled_live_test',
        responsibleParty: 'jayden',
        nextAction:
          'Submit one controlled lead through the configured intake endpoint and confirm it appears in the client workspace.',
      },
    );
    add(
      'sms_template',
      'At least one compliant SMS template is approved',
      !record.smsEnabled || (templates.get('sms') || 0) > 0,
      record.smsEnabled,
      {
        category: 'platform_approval',
        responsibleParty: 'jayden',
        nextAction: 'Review and approve at least one compliant SMS sequence step.',
      },
    );
    add(
      'email_template',
      'At least one compliant email template is approved',
      !record.emailEnabled || (templates.get('email') || 0) > 0,
      record.emailEnabled,
      {
        category: 'platform_approval',
        responsibleParty: 'jayden',
        nextAction: 'Review and approve at least one compliant email sequence step.',
      },
    );
    add(
      'test_lead',
      'A controlled end-to-end test lead completed',
      Boolean(
        freshDate(record.testLeadCompletedAt) &&
          (hasText(providerTests, 'endToEndTestReference') ||
            (record.verifiedItems as any)?.test_lead?.verifiedBy ===
              'system:provider_callback'),
      ),
      true,
      {
        category: 'controlled_live_test',
        responsibleParty: 'jayden',
        nextAction:
          'Run a controlled test lead through intake, routing, conversation storage, and the allowed outbound path.',
      },
    );
    add(
      'inbound_sms',
      'Inbound SMS was tested',
      !record.smsEnabled || freshDate(record.inboundSmsTestedAt),
      record.smsEnabled,
      {
        category: 'controlled_live_test',
        responsibleParty: 'jayden',
        nextAction:
          'Reply from the controlled SMS test lead; authenticated successful routing records this automatically.',
      },
    );
    add(
      'inbound_email',
      'Authenticated inbound email routing was tested',
      !record.emailEnabled || freshDate(record.inboundEmailTestedAt),
      record.emailEnabled,
      {
        category: 'controlled_live_test',
        responsibleParty: 'jayden',
        nextAction:
          'Reply from the controlled email test lead; authenticated successful routing records this automatically.',
      },
    );
    add(
      'stop',
      'STOP behavior was tested',
      !record.smsEnabled || freshDate(record.stopTestedAt),
      record.smsEnabled,
      {
        category: 'controlled_live_test',
        responsibleParty: 'jayden',
        nextAction:
          'Send STOP from the controlled SMS test lead and confirm opt-out plus sequence cancellation; the webhook records this automatically.',
      },
    );
    add(
      'provider_rejection',
      'Provider rejection visibility was tested',
      Boolean(
        freshDate(record.providerRejectionTestedAt) &&
          (hasText(providerTests, 'providerRejectionReference') ||
            (record.verifiedItems as any)?.provider_rejection?.verifiedBy ===
              'system:webhook'),
      ),
      false,
      {
        category: 'controlled_live_test',
        responsibleParty: 'jayden',
        nextAction:
          'Trigger one safe controlled provider rejection and confirm the failed message plus operations task; the authenticated callback records this automatically.',
      },
    );
    add(
      'client_approval',
      'Client written launch approval is recorded',
      Boolean(freshDate(record.clientApprovedAt) && record.clientApprovalEvidence),
      true,
      {
        category: 'client_approval',
        responsibleParty: 'client',
        nextAction: 'Obtain and reference the client’s written approval for this exact setup.',
      },
    );
    add(
      'operator_approval',
      'Platform operator launch approval is recorded',
      Boolean(freshDate(record.operatorApprovedAt) && record.operatorApprovedById),
      true,
      {
        category: 'platform_approval',
        responsibleParty: 'jayden',
        nextAction: 'Review all evidence and record the platform launch decision.',
      },
    );
    add(
      'billing_evidence',
      'Billing readiness was verified from signed Stripe state',
      Boolean(record.billingVerifiedAt),
      true,
      {
        category: 'billing',
        responsibleParty: 'platform',
        nextAction: 'Complete payment so Stripe can confirm an eligible subscription state.',
      },
    );
    add(
      'global_pause',
      'Global automation pause is off',
      process.env.GLOBAL_AUTOMATIONS_DISABLED !== 'true',
      true,
      {
        category: 'platform_control',
        responsibleParty: 'platform',
        statusMessage: 'The global safety pause is enabled',
        nextAction:
          'Keep the platform paused during setup. The owner may change this only as part of the explicitly approved launch window.',
      },
    );

    const blockers = items.filter((item) => item.required && !item.passed);
    const remainingActions = {
      clientInformation: blockers.filter(
        (item) => item.category === 'client_information',
      ),
      providerConfiguration: blockers.filter(
        (item) => item.category === 'provider_configuration',
      ),
      controlledLiveTests: blockers.filter(
        (item) => item.category === 'controlled_live_test',
      ),
      externalProviderApproval: blockers.filter(
        (item) => item.category === 'external_provider_approval',
      ),
      clientApproval: blockers.filter(
        (item) => item.category === 'client_approval',
      ),
      platformApproval: blockers.filter(
        (item) => item.category === 'platform_approval',
      ),
      billing: blockers.filter((item) => item.category === 'billing'),
      platformControl: blockers.filter(
        (item) => item.category === 'platform_control',
      ),
    };
    const computedActivationStatus =
      record.activationStatus === 'active' || record.activationStatus === 'paused'
        ? record.activationStatus
        : blockers.length === 0
          ? 'ready'
          : record.activationStatus === 'testing'
            ? 'testing'
          : record.activationStatus === 'blocked'
            ? 'blocked'
            : 'incomplete';
    const testingBlockers = blockers.filter(
      (item) =>
        item.category !== 'controlled_live_test' &&
        item.key !== 'client_approval' &&
        item.key !== 'operator_approval' &&
        item.key !== 'global_pause',
    );
    return {
      state: tenant.lifecycleStatus,
      activationStatus: computedActivationStatus,
      ready: blockers.length === 0,
      testingReady: testingBlockers.length === 0,
      testingBlockers,
      blockers,
      required: items.filter((item) => item.required),
      optional: items.filter((item) => !item.required),
      remainingActions,
      enabledServices: {
        sms: record.smsEnabled,
        email: record.emailEnabled,
        booking: record.bookingEnabled,
        meta: metaRequired,
        customIntakeApi: intakeRequired,
      },
      externalProviderApprovals: {
        twilio: {
          required: record.smsEnabled,
          status: String(
            providerTests.twilioMessagingApprovalStatus || 'pending',
          ),
          recorded: twilioProviderApproved,
        },
        sendgrid: {
          required: record.emailEnabled,
          status: String(
            providerTests.sendgridSenderVerificationStatus || 'pending',
          ),
          recorded: sendgridProviderApproved,
        },
      },
      providerDiagnostics: {
        twilio: {
          required: record.smsEnabled,
          runtimeReady: twilioRuntimeReady,
          status: managedTwilio?.lastError || twilio?.error
            ? 'error'
            : twilioRuntimeReady
              ? 'ready'
              : 'incomplete',
          lastCheckedAt: managedTwilio?.smsLastVerifiedAt || twilio?.lastSync || null,
          error: managedTwilio?.lastError || twilio?.error
            ? sanitizeOperationalText(managedTwilio?.lastError || twilio.error)
            : null,
        },
        sendgrid: {
          required: record.emailEnabled,
          runtimeReady: sendgridRuntimeReady,
          status: managedEmail?.lastError || sendgrid?.error
            ? 'error'
            : sendgridRuntimeReady
              ? 'ready'
              : 'incomplete',
          lastCheckedAt: managedEmail?.lastVerifiedAt || sendgrid?.lastSync || null,
          error: managedEmail?.lastError || sendgrid?.error
            ? sanitizeOperationalText(managedEmail?.lastError || sendgrid.error)
            : null,
        },
      },
      lastUpdatedAt: record.updatedAt,
    };
  }

  async beginTesting(tenantId: string, operatorId: string) {
    const readiness = await this.readiness(tenantId);
    if (!readiness.testingReady) {
      throw new BadRequestException({
        code: 'TESTING_BLOCKED',
        message: 'Workspace is not ready for controlled testing',
        blockers: readiness.testingBlockers,
      });
    }
    const tenant = await this.tenants.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Workspace not found');
    const record = await this.getOrCreate(tenantId);
    let settings = await this.settings.findOne({ where: { tenantId } });
    if (!settings) settings = this.settings.create({ tenantId });
    const beforeState = {
      lifecycleStatus: tenant.lifecycleStatus,
      activationStatus: record.activationStatus,
      automationsEnabled: settings.automationsEnabled,
    };
    tenant.lifecycleStatus = 'TESTING';
    record.activationStatus = 'testing';
    record.blockedReason = null;
    settings.automationsEnabled = false;
    await this.tenants.manager.transaction(async (manager) => {
      await manager.save(tenant);
      await manager.save(record);
      await manager.save(settings!);
    });
    await this.audit?.recordSystemEvent({
      tenantId,
      eventType: 'tenant.testing_started',
      resourceType: 'tenant',
      resourceId: tenantId,
      beforeState,
      afterState: {
        lifecycleStatus: 'TESTING',
        activationStatus: 'testing',
        automationsEnabled: false,
        initiatedBy: operatorId,
      },
    });
    return this.readiness(tenantId);
  }

  async activate(tenantId: string, operatorId: string) {
    const readiness = await this.readiness(tenantId);
    if (!readiness.ready) {
      const record = await this.getOrCreate(tenantId);
      record.activationStatus = 'blocked';
      record.blockedReason = readiness.blockers.map((item) => item.label).join('; ');
      await this.records.save(record);
      await this.operations.createTask({
        tenantId,
        category: 'missing_client_information',
        title: 'Workspace activation is blocked',
        description: `Resolve readiness blockers: ${readiness.blockers
          .map((item) => item.label)
          .join('; ')}`,
        priority: 'high',
        dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        relatedEntityType: 'tenant',
        relatedEntityId: tenantId,
        dedupeOpen: true,
      });
      this.logger.warn(
        operationalEvent('workspace_activation_blocked', {
          tenantId,
          operatorId,
          blockerKeys: readiness.blockers.map((item) => item.key),
        }),
      );
      throw new BadRequestException({
        code: 'ACTIVATION_BLOCKED',
        message: 'Workspace activation requirements are incomplete',
        blockers: readiness.blockers,
      });
    }

    const tenant = await this.tenants.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Workspace not found');
    const record = await this.getOrCreate(tenantId);
    tenant.lifecycleStatus = 'ACTIVE';
    tenant.provisioningStatus = 'ACTIVE';
    tenant.provisioningLastReconciledAt = new Date();
    tenant.provisioningLastError = null;
    tenant.serviceActivatedAt = new Date();
    tenant.servicePausedAt = null;
    record.activationStatus = 'active';
    record.blockedReason = null;
    record.operatorApprovedById = operatorId;
    record.operatorApprovedAt ||= new Date();
    record.verifiedItems = {
      ...record.verifiedItems,
      activation: {
        verifiedAt: new Date().toISOString(),
        verifiedBy: operatorId,
        passedReadinessKeys: readiness.required
          .filter((item) => item.passed)
          .map((item) => item.key),
        enabledServices: readiness.enabledServices,
        globalAutomationPaused: process.env.GLOBAL_AUTOMATIONS_DISABLED === 'true',
      },
    };
    let settings = await this.settings.findOne({ where: { tenantId } });
    if (!settings) settings = this.settings.create({ tenantId });
    settings.automationsEnabled = true;
    await this.tenants.manager.transaction(async (manager) => {
      await manager.save(tenant);
      await manager.save(record);
      await manager.save(settings!);
    });
    return this.readiness(tenantId);
  }

  async pause(tenantId: string) {
    const tenant = await this.tenants.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Workspace not found');
    tenant.lifecycleStatus = 'PAUSED';
    tenant.servicePausedAt = new Date();
    let settings = await this.settings.findOne({ where: { tenantId } });
    if (!settings) settings = this.settings.create({ tenantId });
    settings.automationsEnabled = false;
    const record = await this.getOrCreate(tenantId);
    record.activationStatus = 'paused';
    await this.tenants.manager.transaction(async (manager) => {
      await manager.save(tenant);
      await manager.save(settings!);
      await manager.save(record);
    });
    return { ok: true, lifecycleStatus: tenant.lifecycleStatus };
  }
}
