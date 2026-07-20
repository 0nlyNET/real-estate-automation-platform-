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
import { operationalEvent } from '../../common/operational-log';
import { OperationsService } from '../operations/operations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlatformOperatorsService } from '../../common/platform-operators.service';

type ReadinessItem = {
  key: string;
  label: string;
  passed: boolean;
  required: boolean;
  verifiedAt?: string | null;
  verifiedBy?: string | null;
};

function hasText(record: Record<string, unknown>, key: string) {
  return String(record?.[key] || '').trim().length > 0;
}

function dateOrNull(value: string | null | undefined) {
  return value ? new Date(value) : value === null ? null : undefined;
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
    for (const key of allowed) {
      if (patch[key] !== undefined) (record as any)[key] = patch[key];
    }
    record.activationStatus = 'incomplete';
    record.blockedReason = null;
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

  async recordOperatorEvidence(
    tenantId: string,
    patch: Record<string, any>,
    operatorId: string,
  ) {
    const record = await this.getOrCreate(tenantId);
    if (patch.providerTests !== undefined) record.providerTests = patch.providerTests;
    if (patch.verifiedItems !== undefined) record.verifiedItems = patch.verifiedItems;
    for (const key of [
      'consentPolicyAcknowledgedAt',
      'testLeadCompletedAt',
      'inboundSmsTestedAt',
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

  private async approvedTemplateCounts(tenantId: string) {
    const rows = await this.steps
      .createQueryBuilder('step')
      .innerJoin('step.sequence', 'sequence')
      .where('sequence.tenant_id = :tenantId', { tenantId })
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
    const credentials = await this.credentials.find({
      where: { tenant: { id: tenantId } as any },
      relations: ['tenant'],
    });
    const integrations = new Map(
      credentials.map((row) => [row.provider, decryptIntegrationPayload(row.encryptedValue)]),
    );
    const templates = await this.approvedTemplateCounts(tenantId);
    const billing = billingEligibility(tenant);
    const items: ReadinessItem[] = [];
    const add = (key: string, label: string, passed: boolean, required = true) => {
      const evidence = (record.verifiedItems as any)?.[key] || {};
      items.push({
        key,
        label,
        passed,
        required,
        verifiedAt: evidence.verifiedAt || null,
        verifiedBy: evidence.verifiedBy || null,
      });
    };

    add('billing', 'Billing status is eligible', billing.allowed);
    add(
      'business_identity',
      'Business identity and market are complete',
      hasText(record.businessIdentity, 'legalBusinessName') &&
        hasText(record.businessIdentity, 'publicBusinessName') &&
        hasText(record.businessIdentity, 'primaryMarket'),
    );
    add(
      'contacts',
      'Account, billing, operations, support, approval, and escalation contacts are complete',
      ['accountOwner', 'billingContact', 'operationsContact', 'supportContact', 'approvalContact', 'escalationContact'].every(
        (key) => hasText(record.contacts, key),
      ),
    );
    add(
      'service_scope',
      'Package, channels, lead sources, and reporting scope are recorded',
      hasText(record.serviceScope, 'selectedPackage') &&
        Array.isArray(record.serviceScope.includedChannels) &&
        Array.isArray(record.serviceScope.leadSources) &&
        hasText(record.serviceScope, 'expectedLeadVolume') &&
        hasText(record.serviceScope, 'reportingFrequency'),
    );
    add(
      'lead_handling',
      'Lead routing and business hours are recorded',
      hasText(record.leadHandling, 'businessHours') &&
        hasText(record.leadHandling, 'routingRules') &&
        hasText(record.leadHandling, 'escalationBehavior') &&
        hasText(record.leadHandling, 'followUpTiming'),
    );
    add(
      'timezone',
      'Time zone is configured',
      Boolean(settings?.timeZone?.trim()),
    );
    add(
      'quiet_hours',
      'Quiet hours are configured',
      Boolean(settings?.quietHoursStart && settings?.quietHoursEnd),
    );
    add(
      'booking_url',
      'Booking URL is configured for booking service',
      !record.bookingEnabled || Boolean(settings?.bookingLink?.trim()),
      record.bookingEnabled,
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
        record.consentConfiguration.clientResponsibilityAcknowledged === true,
    );
    add(
      'twilio',
      'Twilio is connected and tested',
      !record.smsEnabled ||
        (integrations.get('twilio')?.connected === true &&
          Boolean(integrations.get('twilio')?.lastSync)),
      record.smsEnabled,
    );
    add(
      'sendgrid',
      'SendGrid is connected and tested',
      !record.emailEnabled ||
        (integrations.get('sendgrid')?.connected === true &&
          Boolean(integrations.get('sendgrid')?.lastSync)),
      record.emailEnabled,
    );
    const leadSources = Array.isArray(record.serviceScope.leadSources)
      ? record.serviceScope.leadSources.map((source) => String(source).toLowerCase())
      : [];
    const metaRequired = leadSources.some((source) => source.includes('meta') || source.includes('facebook'));
    add(
      'meta',
      'Meta Lead Ads is connected and tested',
      !metaRequired ||
        (integrations.get('facebook_lead_ads')?.connected === true &&
          Boolean(integrations.get('facebook_lead_ads')?.lastSync)),
      metaRequired,
    );
    const intakeRequired = leadSources.some((source) => source.includes('api'));
    add(
      'intake_api',
      'Custom intake API key is configured',
      !intakeRequired || Boolean(settings?.intakeApiKeyHash),
      intakeRequired,
    );
    add(
      'sms_template',
      'At least one compliant SMS template is approved',
      !record.smsEnabled || (templates.get('sms') || 0) > 0,
      record.smsEnabled,
    );
    add(
      'email_template',
      'At least one compliant email template is approved',
      !record.emailEnabled || (templates.get('email') || 0) > 0,
      record.emailEnabled,
    );
    add('test_lead', 'A controlled test lead completed', Boolean(record.testLeadCompletedAt));
    add(
      'inbound_sms',
      'Inbound SMS was tested',
      !record.smsEnabled || Boolean(record.inboundSmsTestedAt),
      record.smsEnabled,
    );
    add(
      'stop',
      'STOP behavior was tested',
      !record.smsEnabled || Boolean(record.stopTestedAt),
      record.smsEnabled,
    );
    add(
      'provider_rejection',
      'Provider rejection visibility was tested',
      Boolean(record.providerRejectionTestedAt),
    );
    add(
      'client_approval',
      'Client written launch approval is recorded',
      Boolean(record.clientApprovedAt && record.clientApprovalEvidence),
    );
    add(
      'operator_approval',
      'Platform operator launch approval is recorded',
      Boolean(record.operatorApprovedAt && record.operatorApprovedById),
    );
    add(
      'billing_evidence',
      'Billing state was verified by an operator',
      Boolean(record.billingVerifiedAt),
    );
    add(
      'global_pause',
      'Global automation pause is off',
      process.env.GLOBAL_AUTOMATIONS_DISABLED !== 'true',
    );

    const blockers = items.filter((item) => item.required && !item.passed);
    return {
      state: tenant.lifecycleStatus,
      activationStatus: record.activationStatus,
      ready: blockers.length === 0,
      blockers,
      required: items.filter((item) => item.required),
      optional: items.filter((item) => !item.required),
      enabledServices: {
        sms: record.smsEnabled,
        email: record.emailEnabled,
        booking: record.bookingEnabled,
        meta: metaRequired,
        customIntakeApi: intakeRequired,
      },
      lastUpdatedAt: record.updatedAt,
    };
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
