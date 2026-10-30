import { BadRequestException } from '@nestjs/common';
import { OnboardingRecord } from './onboarding-record.entity';
import { OnboardingService } from './onboarding.service';
import { Tenant } from '../tenants/tenant.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';

describe('operator-controlled workspace activation', () => {
  it('returns explicit blockers and cannot be completed by client-entered fields alone', async () => {
    const record = Object.assign(new OnboardingRecord(), {
      id: 'onboarding-1',
      tenantId: 'tenant-1',
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
    });
    const records = {
      findOne: jest.fn().mockResolvedValue(record),
      create: jest.fn((value) => Object.assign(new OnboardingRecord(), value)),
      save: jest.fn(async (value) => value),
    };
    const tenants = {
      findOne: jest.fn().mockResolvedValue({
        id: 'tenant-1',
        name: 'Lakeview Realty',
        status: 'active',
        stripeSubscriptionId: 'sub_paid',
        paidSubscriptionId: 'sub_paid',
        paymentConfirmedAt: new Date(),
        lifecycleStatus: 'ONBOARDING',
      }),
      manager: { transaction: jest.fn() },
    };
    const settings = { findOne: jest.fn().mockResolvedValue({ tenantId: 'tenant-1', automationsEnabled: false }) };
    const stepsBuilder: any = {};
    for (const method of ['innerJoin', 'where', 'andWhere', 'select', 'addSelect', 'groupBy']) {
      stepsBuilder[method] = jest.fn(() => stepsBuilder);
    }
    stepsBuilder.getRawMany = jest.fn().mockResolvedValue([]);
    const operations = { createTask: jest.fn().mockResolvedValue({}) };
    const service = new OnboardingService(
      records as any,
      tenants as any,
      settings as any,
      { find: jest.fn().mockResolvedValue([]) } as any,
      { createQueryBuilder: jest.fn(() => stepsBuilder) } as any,
      operations as any,
    );

    const readiness = await service.readiness('tenant-1');
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers.map((item) => item.key)).toEqual(
      expect.arrayContaining([
        'business_identity',
        'contacts',
        'consent_policy',
        'test_lead',
        'client_approval',
        'operator_approval',
        'billing_evidence',
      ]),
    );
    await expect(service.activate('tenant-1', 'operator-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tenants.manager.transaction).not.toHaveBeenCalled();
    expect(record.activationStatus).toBe('blocked');
    expect(operations.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'missing_client_information' }),
    );

    await service.recordOperatorEvidence(
      'tenant-1',
      {
        clientApprovedAt: '2026-07-19T12:00:00Z',
        clientApprovalEvidence: 'signed approval record',
      },
      'operator-1',
    );
    expect(operations.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'launch_approval' }),
    );
  });

  it('requires exact runtime routing, verified settings, and external provider evidence', async () => {
    const now = new Date('2026-08-07T00:00:00.000Z');
    const record = Object.assign(new OnboardingRecord(), {
      id: 'onboarding-1',
      tenantId: 'tenant-1',
      businessIdentity: {
        legalBusinessName: 'Lakeview Realty LLC',
        publicBusinessName: 'Lakeview Realty',
        primaryMarket: 'Austin, TX',
        businessType: 'LLC',
        companyType: 'private',
        ein: '12-3456789',
        website: 'https://lakeview.example',
        businessAddress: '1 Main Street',
        city: 'Austin',
        region: 'TX',
        postalCode: '78701',
      },
      contacts: {
        ...Object.fromEntries(
          [
            'accountOwner',
            'billingContact',
            'operationsContact',
            'supportContact',
            'approvalContact',
            'escalationContact',
          ].map((key) => [key, `${key}@lakeview.example`]),
        ),
        controlledTestPhone: '+14155550123',
        controlledTestEmail: 'controlled@lakeview.example',
        firstName: 'Alex',
        lastName: 'Broker',
        email: 'alex@lakeview.example',
        phone: '+14155550123',
        jobPosition: 'Owner',
      },
      serviceScope: {
        selectedPackage: 'RealtyTechAI managed service',
        includedChannels: ['sms', 'email'],
        leadSources: ['website'],
        expectedLeadVolume: '50',
        reportingFrequency: 'weekly',
      },
      leadHandling: {
        businessHours: 'Mon-Fri 9-5',
        routingRules: 'Alex',
        escalationBehavior: 'After 15 minutes',
        followUpTiming: 'Immediately',
      },
      brandCommunication: {
        brandName: 'Lakeview Realty',
        brandVoice: 'Warm and concise',
        requiredSignature: 'Alex at Lakeview Realty',
        approvedPhoneIdentity: '+14155550100',
        approvedEmailIdentity: 'agent@lakeview.example',
        fairHousingReviewAcknowledged: true,
      },
      consentConfiguration: {
        exactConsentLanguage: 'I agree to receive messages.',
        consentCollectionMethod: 'Website checkbox',
        sourceOwnership: 'authorized',
        optOutProcess: 'STOP or unsubscribe',
        consentPolicyVersion: 'v1',
        purchasedOrColdListsExcluded: true,
        clientResponsibilityAcknowledged: true,
        lawfulLeadCollectionCertified: true,
        termsAcceptedVersion: '2026-08-11',
        privacyAcceptedVersion: '2026-08-11',
        acceptableUseAcceptedVersion: '2026-08-11',
        dataRetentionAcceptedVersion: '2026-08-11',
        campaignDescription: 'Lakeview Realty follows up with consumers who request real-estate information.',
        messageFlow: 'Consumers request listing information on https://lakeview.example and check the SMS consent box.',
        sampleMessage: 'Lakeview Realty: Thanks for your inquiry. Reply STOP to opt out.',
        sampleMessage2: 'Lakeview Realty: Would you like to schedule a tour? Reply STOP to opt out.',
        termsUrl: 'https://lakeview.example/terms',
        privacyUrl: 'https://lakeview.example/privacy',
      },
      integrationConfiguration: {
        providerAccountOwner: 'Lakeview Realty',
        authorizationStatus: 'authorized',
      },
      providerTests: {
        twilioMessagingApprovalStatus: 'approved',
        twilioApprovalReference: 'provider-reference-1',
        twilioApprovalRecordedAt: now.toISOString(),
        sendgridSenderVerificationStatus: 'approved',
        sendgridApprovalReference: 'provider-reference-2',
        sendgridApprovalRecordedAt: now.toISOString(),
        endToEndTestReference: 'controlled-run-1',
        providerRejectionReference: 'controlled-failure-1',
      },
      verifiedItems: {},
      smsEnabled: true,
      emailEnabled: true,
      bookingEnabled: false,
      targetLaunchDate: '2026-08-15',
      consentPolicyAcknowledgedAt: now,
      testLeadCompletedAt: now,
      inboundSmsTestedAt: now,
      inboundEmailTestedAt: now,
      stopTestedAt: now,
      providerRejectionTestedAt: now,
      billingVerifiedAt: now,
      clientApprovedAt: now,
      clientApprovalEvidence: 'approval-reference',
      operatorApprovedAt: now,
      operatorApprovedById: '00000000-0000-4000-8000-000000000099',
      activationStatus: 'incomplete',
      configurationUpdatedAt: now,
      updatedAt: now,
    });
    const workspaceSettings: any = {
      tenantId: 'tenant-1',
      timeZone: 'America/Chicago',
      timeZoneVerifiedAt: now,
      quietHoursStart: '21:00',
      quietHoursEnd: '08:00',
    };
    const credentialRows: any[] = [
      {
        provider: 'twilio',
        routingKey: '+14155550100',
        encryptedValue: JSON.stringify({
          connected: true,
          accountSid: 'AC-test',
          authToken: 'test-token',
          fromNumber: '+14155550100',
          lastSync: now.toISOString(),
          error: null,
        }),
      },
      {
        provider: 'sendgrid',
        routingKey: 'replies@reply.lakeview.example',
        encryptedValue: JSON.stringify({
          connected: true,
          apiKey: 'test-key',
          fromEmail: 'agent@lakeview.example',
          fromName: 'Lakeview Realty',
          inboundAddress: 'replies@reply.lakeview.example',
          lastSync: now.toISOString(),
          error: null,
        }),
      },
    ];
    const records = {
      findOne: jest.fn().mockResolvedValue(record),
      save: jest.fn(async (value) => value),
    };
    const tenants = {
      findOne: jest.fn().mockResolvedValue({
        id: 'tenant-1',
        status: 'active',
        stripeSubscriptionId: 'sub_paid',
        paidSubscriptionId: 'sub_paid',
        paymentConfirmedAt: new Date(),
        lifecycleStatus: 'TESTING',
      }),
    };
    const stepsBuilder: any = {};
    for (const method of [
      'innerJoin',
      'where',
      'andWhere',
      'select',
      'addSelect',
      'groupBy',
    ]) {
      stepsBuilder[method] = jest.fn(() => stepsBuilder);
    }
    stepsBuilder.getRawMany = jest
      .fn()
      .mockResolvedValue([
        { channel: 'sms', count: '1' },
        { channel: 'email', count: '1' },
      ]);
    const service = new OnboardingService(
      records as any,
      tenants as any,
      { findOne: jest.fn().mockImplementation(async () => workspaceSettings) } as any,
      { find: jest.fn().mockImplementation(async () => credentialRows) } as any,
      { createQueryBuilder: jest.fn(() => stepsBuilder) } as any,
      { createTask: jest.fn() } as any,
      undefined,
      undefined,
      {
        getTenantPolicy: jest.fn().mockResolvedValue({
          enabled: true,
          maxSmsPerHour: 60,
          maxSmsPerDay: 500,
          maxEmailsPerHour: 120,
          maxEmailsPerDay: 1000,
          maxAiCallsPerDay: 200,
          hardCostThresholdUsd: '30.0000',
        }),
        getPlatformPolicy: jest.fn().mockResolvedValue({ enabled: true }),
      } as any,
    );

    await expect(service.readiness('tenant-1')).resolves.toMatchObject({
      ready: true,
      activationStatus: 'ready',
      providerDiagnostics: {
        twilio: { runtimeReady: true },
        sendgrid: { runtimeReady: true },
      },
    });

    workspaceSettings.timeZoneVerifiedAt = null;
    workspaceSettings.bookingLink = 'https://calendar.example.com/lakeview';
    workspaceSettings.bookingLinkVerificationStatus = 'unverified';
    record.bookingEnabled = true;
    (record as OnboardingRecord).inboundEmailTestedAt = null;
    credentialRows[1].routingKey = 'wrong-route@reply.lakeview.example';
    const blocked = await service.readiness('tenant-1');
    expect(blocked.ready).toBe(false);
    expect(blocked.blockers.map((item) => item.key)).toEqual(
      expect.arrayContaining([
        'timezone',
        'booking_provider',
        'crm_appointment_event',
        'appointment_uat',
        'sendgrid',
        'inbound_email',
      ]),
    );
    expect(blocked.remainingActions.providerConfiguration).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'sendgrid' })]),
    );
    expect(blocked.remainingActions.controlledLiveTests).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'inbound_email' })]),
    );
  });

  it('records authenticated webhook evidence once without replacing operator evidence', async () => {
    const record = Object.assign(new OnboardingRecord(), {
      tenantId: 'tenant-1',
      verifiedItems: {
        billing: { verifiedAt: '2026-08-01T00:00:00.000Z', verifiedBy: 'owner' },
      },
      inboundSmsTestedAt: null,
      inboundEmailTestedAt: null,
      stopTestedAt: null,
      providerRejectionTestedAt: null,
    });
    const records = {
      findOne: jest.fn().mockResolvedValue(record),
      save: jest.fn(async (value) => value),
    };
    const service = new OnboardingService(
      records as any,
      {
        findOne: jest.fn().mockResolvedValue({
          id: 'tenant-1',
          lifecycleStatus: 'TESTING',
        }),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        findOne: jest.fn().mockResolvedValue({
          id: 'test-run-1',
          tenantId: 'tenant-1',
          status: 'running',
          expiresAt: new Date(Date.now() + 60_000),
          checks: {},
        }),
        save: jest.fn(async (value) => value),
      } as any,
    );
    await service.recordAutomatedTestEvidence('tenant-1', {
      inboundSms: true,
      stop: true,
      testRunId: 'test-run-1',
    });
    const firstSmsEvidence = record.inboundSmsTestedAt;
    await service.recordAutomatedTestEvidence('tenant-1', {
      inboundSms: true,
      inboundEmail: true,
      providerRejection: true,
      testRunId: 'test-run-1',
    });
    expect(record).toMatchObject({
      inboundSmsTestedAt: firstSmsEvidence,
      inboundEmailTestedAt: expect.any(Date),
      stopTestedAt: expect.any(Date),
      providerRejectionTestedAt: expect.any(Date),
      verifiedItems: {
        billing: { verifiedBy: 'owner' },
        inbound_sms: { verifiedBy: 'system:webhook' },
        inbound_email: { verifiedBy: 'system:webhook' },
        stop: { verifiedBy: 'system:webhook' },
        provider_rejection: { verifiedBy: 'system:webhook' },
      },
    });
    expect(records.save).toHaveBeenCalledTimes(2);
  });

  it('passes a booking UAT run only after calendar, CRM, notification, and takeover evidence', async () => {
    const record = Object.assign(new OnboardingRecord(), {
      tenantId: 'tenant-1',
      smsEnabled: false,
      emailEnabled: true,
      bookingEnabled: true,
      verifiedItems: {},
      providerTests: {},
    });
    const run: any = {
      id: 'test-run-1',
      tenantId: 'tenant-1',
      status: 'running',
      expiresAt: new Date(Date.now() + 60_000),
      checks: { outbound: 'delivered', inboundEmail: 'passed' },
      completedAt: null,
    };
    const records = {
      findOne: jest.fn().mockResolvedValue(record),
      save: jest.fn(async (value) => value),
    };
    const testRuns = {
      findOne: jest.fn().mockImplementation(async ({ where }) =>
        run.status === where.status ? run : null,
      ),
      save: jest.fn(async (value) => value),
    };
    const service = new OnboardingService(
      records as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      testRuns as any,
      undefined,
      undefined,
      undefined,
      // Non-AI booking UAT journey: AI explicitly disabled, so no AI reply
      // evidence is required. Fail-closed on missing settings is covered in
      // the P1 invariant suite below.
      {
        findOne: jest.fn().mockResolvedValue({
          tenantId: 'tenant-1',
          aiEnabled: false,
          aiPaused: false,
          responseMode: 'controlled_autopilot',
          allowedChannels: ['sms', 'email'],
        }),
      } as any,
    );
    await service.recordUatWorkflowEvidence('tenant-1', run.id, {
      calendarAvailability: true,
      externalCalendarEvent: true,
      internalAppointment: true,
      agentNotification: true,
      crmAppointmentEvent: true,
    });
    expect(run.status).toBe('running');
    expect(record.verifiedItems).not.toHaveProperty('appointment_uat');

    await service.recordUatWorkflowEvidence('tenant-1', run.id, {
      humanTakeover: true,
    });
    expect(run).toMatchObject({ status: 'passed', completedAt: expect.any(Date) });
    expect(record.verifiedItems).toMatchObject({
      appointment_uat: { verifiedBy: 'system:uat', testRunId: run.id },
    });
  });

  it('invalidates stale launch and provider evidence when messaging identity changes', async () => {
    const approvedAt = new Date('2026-08-07T00:00:00.000Z');
    const record = Object.assign(new OnboardingRecord(), {
      id: 'onboarding-1',
      tenantId: 'tenant-1',
      businessIdentity: {},
      contacts: {},
      serviceScope: {},
      leadHandling: {},
      brandCommunication: {
        brandName: 'Old Brand',
        approvedPhoneIdentity: '+14155550100',
        approvedEmailIdentity: 'old@example.com',
      },
      consentConfiguration: {},
      integrationConfiguration: {},
      providerTests: {
        twilioMessagingApprovalStatus: 'approved',
        twilioApprovalReference: 'twilio-old',
        twilioApprovalRecordedAt: approvedAt.toISOString(),
        sendgridSenderVerificationStatus: 'approved',
        sendgridApprovalReference: 'sendgrid-old',
        sendgridApprovalRecordedAt: approvedAt.toISOString(),
        endToEndTestReference: 'old-run',
        providerRejectionReference: 'old-failure',
      },
      verifiedItems: {
        activation: { verifiedAt: approvedAt.toISOString() },
        inbound_sms: { verifiedBy: 'system:webhook' },
      },
      smsEnabled: true,
      emailEnabled: true,
      bookingEnabled: false,
      activationStatus: 'ready',
      clientApprovedAt: approvedAt,
      clientApprovalEvidence: 'old-client-approval',
      operatorApprovedAt: approvedAt,
      operatorApprovedById: '00000000-0000-4000-8000-000000000099',
      testLeadCompletedAt: approvedAt,
      inboundSmsTestedAt: approvedAt,
      inboundEmailTestedAt: approvedAt,
      stopTestedAt: approvedAt,
      providerRejectionTestedAt: approvedAt,
      configurationUpdatedAt: approvedAt,
      updatedAt: approvedAt,
    });
    const records = {
      findOne: jest.fn().mockResolvedValue(record),
      save: jest.fn(async (value) => value),
    };
    const service = new OnboardingService(
      records as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await service.updateClientInput('tenant-1', {
      brandCommunication: {
        ...record.brandCommunication,
        brandName: 'New Brand',
        approvedEmailIdentity: 'new@example.com',
      },
    });

    expect(record).toMatchObject({
      activationStatus: 'incomplete',
      clientApprovedAt: null,
      clientApprovalEvidence: null,
      operatorApprovedAt: null,
      operatorApprovedById: null,
      testLeadCompletedAt: null,
      inboundSmsTestedAt: null,
      inboundEmailTestedAt: null,
      stopTestedAt: null,
      providerRejectionTestedAt: null,
    });
    expect(record.configurationUpdatedAt.getTime()).toBeGreaterThan(
      approvedAt.getTime(),
    );
    expect(record.providerTests).not.toHaveProperty(
      'twilioMessagingApprovalStatus',
    );
    expect(record.providerTests).not.toHaveProperty(
      'sendgridSenderVerificationStatus',
    );
    expect(record.verifiedItems).not.toHaveProperty('activation');
  });

  it('includes the provider-lead consent notice as an informational item', async () => {
    const record = Object.assign(new OnboardingRecord(), {
      id: 'onboarding-1',
      tenantId: 'tenant-1',
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
    });
    const stepsBuilder: any = {};
    for (const method of ['innerJoin', 'where', 'andWhere', 'select', 'addSelect', 'groupBy']) {
      stepsBuilder[method] = jest.fn(() => stepsBuilder);
    }
    stepsBuilder.getRawMany = jest.fn().mockResolvedValue([]);
    const service = new OnboardingService(
      {
        findOne: jest.fn().mockResolvedValue(record),
        create: jest.fn((value) => Object.assign(new OnboardingRecord(), value)),
        save: jest.fn(async (value) => value),
      } as any,
      {
        findOne: jest.fn().mockResolvedValue({
          id: 'tenant-1',
          name: 'Lakeview Realty',
          status: 'active',
          stripeSubscriptionId: 'sub_paid',
          paidSubscriptionId: 'sub_paid',
          paymentConfirmedAt: new Date(),
          lifecycleStatus: 'ONBOARDING',
        }),
      } as any,
      { findOne: jest.fn().mockResolvedValue({ tenantId: 'tenant-1' }) } as any,
      { find: jest.fn().mockResolvedValue([]) } as any,
      { createQueryBuilder: jest.fn(() => stepsBuilder) } as any,
      { createTask: jest.fn().mockResolvedValue({}) } as any,
    );

    const readiness = await service.readiness('tenant-1');
    const item = readiness.optional.find(
      (entry) => entry.key === 'provider_lead_consent_notice',
    );
    expect(item).toBeDefined();
    expect(item).toMatchObject({ required: false, passed: true });
    expect(item?.label).toContain('affirmative consent');
    // Informational only: it must never block activation.
    expect(
      readiness.blockers.some(
        (entry) => entry.key === 'provider_lead_consent_notice',
      ),
    ).toBe(false);
  });
});

describe('onboarding safe automations (P10)', () => {
  const PROVISIONED = 'lakeview-9f3ac2@mg.realtytechai.app';

  function automationHarness(options?: {
    emailEnabled?: boolean;
    brandIdentity?: string | null;
    identityFromEmail?: string | null;
    contacts?: Record<string, unknown>;
    providerTests?: Record<string, unknown>;
  }) {
    const brandCommunication: Record<string, unknown> = {};
    if (options?.brandIdentity !== undefined && options.brandIdentity !== null) {
      brandCommunication.approvedEmailIdentity = options.brandIdentity;
    }
    const record = Object.assign(new OnboardingRecord(), {
      id: 'onboarding-auto',
      tenantId: 'tenant-auto',
      businessIdentity: {},
      contacts: options?.contacts || {},
      serviceScope: {},
      leadHandling: {},
      brandCommunication,
      consentConfiguration: {},
      integrationConfiguration: {},
      providerTests: options?.providerTests || {},
      verifiedItems: {},
      smsEnabled: false,
      emailEnabled: options?.emailEnabled ?? true,
      bookingEnabled: false,
      activationStatus: 'incomplete',
      configurationUpdatedAt: new Date('2026-09-20T00:00:00Z'),
    });
    const records = {
      findOne: jest.fn().mockResolvedValue(record),
      create: jest.fn((value) => Object.assign(new OnboardingRecord(), value)),
      save: jest.fn(async (value) => value),
    };
    const identity =
      options?.identityFromEmail === undefined ||
      options.identityFromEmail === null
        ? null
        : {
            tenantId: 'tenant-auto',
            fromEmail: options.identityFromEmail,
            fromName: 'Lakeview Realty',
            inboundAddress: 'reply@inbound.realtytechai.app',
            emailStatus: 'testing',
          };
    const emailIdentities = { findOne: jest.fn().mockResolvedValue(identity) };
    const audit = { recordSystemEvent: jest.fn().mockResolvedValue({}) };
    const service = new OnboardingService(
      records as any,
      { findOne: jest.fn() } as any,
      { findOne: jest.fn() } as any,
      { find: jest.fn().mockResolvedValue([]) } as any,
      { createQueryBuilder: jest.fn() } as any,
      {} as any,
      undefined,
      undefined,
      undefined,
      audit as any,
      undefined,
      emailIdentities as any,
    );
    return { service, record, records, emailIdentities, audit };
  }

  it('auto-aligns the approved identity when the client never set one', async () => {
    const item = automationHarness({ identityFromEmail: PROVISIONED });
    const result = await item.service.autoAlignApprovedEmailIdentity(
      'tenant-auto',
    );
    expect(result).toMatchObject({
      ok: true,
      aligned: true,
      reason: 'auto_aligned',
      provisionedIdentity: PROVISIONED,
    });
    expect(item.record.brandCommunication.approvedEmailIdentity).toBe(
      PROVISIONED,
    );
    expect(
      new Date(item.record.configurationUpdatedAt).getTime(),
    ).toBeGreaterThan(new Date('2026-09-20T00:00:00Z').getTime());
    expect(item.records.save).toHaveBeenCalled();
    expect(item.audit.recordSystemEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'onboarding.approved_email_identity_auto_aligned',
      }),
    );
    // Gates are not weakened: activation state is untouched.
    expect(item.record.activationStatus).toBe('incomplete');
  });

  it('is a no-op when the brand identity already matches (case-insensitively)', async () => {
    const item = automationHarness({
      identityFromEmail: PROVISIONED,
      brandIdentity: PROVISIONED.toUpperCase(),
    });
    const result = await item.service.autoAlignApprovedEmailIdentity(
      'tenant-auto',
    );
    expect(result).toMatchObject({ ok: true, aligned: false });
    expect(item.records.save).not.toHaveBeenCalled();
    expect(item.audit.recordSystemEvent).not.toHaveBeenCalled();
  });

  it('never silently overrides an explicitly-set different identity', async () => {
    const item = automationHarness({
      identityFromEmail: PROVISIONED,
      brandIdentity: 'owner@lakeviewrealty.com',
    });
    const result = await item.service.autoAlignApprovedEmailIdentity(
      'tenant-auto',
    );
    expect(result).toMatchObject({ ok: false, reason: 'mismatch' });
    expect(item.record.brandCommunication.approvedEmailIdentity).toBe(
      'owner@lakeviewrealty.com',
    );
    expect(item.records.save).not.toHaveBeenCalled();
  });

  it('skips alignment when email is disabled or no identity is provisioned', async () => {
    const disabled = automationHarness({
      emailEnabled: false,
      identityFromEmail: PROVISIONED,
    });
    expect(
      await disabled.service.autoAlignApprovedEmailIdentity('tenant-auto'),
    ).toMatchObject({ ok: false, reason: 'email_not_enabled' });

    const missing = automationHarness({ identityFromEmail: null });
    expect(
      await missing.service.autoAlignApprovedEmailIdentity('tenant-auto'),
    ).toMatchObject({ ok: false, reason: 'no_provisioned_identity' });
    expect(missing.records.save).not.toHaveBeenCalled();
  });

  it('tracks automated connection-test attempts for retry throttling', async () => {
    const item = automationHarness({ identityFromEmail: PROVISIONED });
    await item.service.noteAutoConnectionTestAttempt(
      'tenant-auto',
      'sendgrid',
      'failed',
      'SendGrid client test email failed (403)',
    );
    expect(
      item.record.providerTests.sendgridAutoTestLastAttemptedAt,
    ).toBeDefined();
    expect(item.record.providerTests.sendgridAutoTestLastResult).toBe('failed');
    expect(item.record.providerTests.sendgridAutoTestLastDetail).toContain(
      '403',
    );
    expect(item.records.save).toHaveBeenCalled();
  });

  it('resolves the connection-test recipient from controlled contacts only', async () => {
    const controlled = automationHarness({
      identityFromEmail: PROVISIONED,
      contacts: {
        controlledTestEmail: 'Control-Test@Example.com',
        accountOwner: 'owner@lakeviewrealty.com',
      },
    });
    expect(
      await controlled.service.connectionTestRecipient('tenant-auto'),
    ).toBe('control-test@example.com');

    const fallback = automationHarness({
      identityFromEmail: PROVISIONED,
      contacts: { accountOwner: 'owner@lakeviewrealty.com' },
    });
    expect(await fallback.service.connectionTestRecipient('tenant-auto')).toBe(
      'owner@lakeviewrealty.com',
    );

    const none = automationHarness({
      identityFromEmail: PROVISIONED,
      contacts: { accountOwner: 'not-an-email' },
    });
    expect(await none.service.connectionTestRecipient('tenant-auto')).toBeNull();
  });
});

describe('onboarding operational event wiring (P1)', () => {
  function harnessWithEvents(record: OnboardingRecord) {
    const records = {
      findOne: jest.fn().mockResolvedValue(record),
      create: jest.fn((value) => Object.assign(new OnboardingRecord(), value)),
      save: jest.fn(async (value) => value),
    };
    const tenants = {
      findOne: jest.fn().mockResolvedValue({
        id: 'tenant-1',
        name: 'Lakeview Realty',
        status: 'active',
        stripeSubscriptionId: 'sub_paid',
        paidSubscriptionId: 'sub_paid',
        paymentConfirmedAt: new Date(),
        lifecycleStatus: 'ONBOARDING',
      }),
      manager: { transaction: jest.fn() },
    };
    const settings = { findOne: jest.fn().mockResolvedValue({ tenantId: 'tenant-1', automationsEnabled: false }) };
    const stepsBuilder: any = {};
    for (const method of ['innerJoin', 'where', 'andWhere', 'select', 'addSelect', 'groupBy']) {
      stepsBuilder[method] = jest.fn(() => stepsBuilder);
    }
    stepsBuilder.getRawMany = jest.fn().mockResolvedValue([]);
    const operations = { createTask: jest.fn().mockResolvedValue({}) };
    const operationalEvents = {
      readyForActivation: jest.fn().mockResolvedValue({}),
      onboardingBlocked: jest.fn().mockResolvedValue({}),
      automationResumed: jest.fn().mockResolvedValue({}),
      automationPaused: jest.fn().mockResolvedValue({}),
    };
    const service = new OnboardingService(
      records as any,
      tenants as any,
      settings as any,
      { find: jest.fn().mockResolvedValue([]) } as any,
      { createQueryBuilder: jest.fn(() => stepsBuilder) } as any,
      operations as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      operationalEvents as any,
    );
    return { service, operationalEvents };
  }

  function blockedRecord(): OnboardingRecord {
    return Object.assign(new OnboardingRecord(), {
      id: 'onboarding-1',
      tenantId: 'tenant-1',
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
    });
  }

  it.each<[string | undefined, string | undefined, boolean]>([
    ['60', '240', true],
    ['0.5', '0.6667', true],
    [undefined, '40', false],
    ['', '40', false],
    [' ', '40', false],
    ['0', '40', false],
    ['-1', '40', false],
    ['60.01', '40', false],
    ['NaN', '40', false],
    ['Infinity', '40', false],
    ['30', undefined, false],
    ['30', '', false],
    ['30', ' ', false],
    ['30', '0', false],
    ['30', '-1', false],
    ['30', '240.01', false],
    ['30', 'NaN', false],
    ['30', 'Infinity', false],
  ])('production recovery readiness with RPO=%s RTO=%s passes=%s', async (rpo, rto, passed) => {
    const originalEnvironment = process.env;
    process.env = {
      ...originalEnvironment,
      NODE_ENV: 'production',
      BACKUP_RESTORE_TESTED_AT: new Date().toISOString(),
      BACKUP_RETENTION_DAYS: '7',
      BACKUP_RESTORE_ISOLATED_VERIFIED: 'true',
      BACKUP_RESTORE_CREDENTIALS_PROTECTED: 'true',
    };
    if (rpo === undefined) delete process.env.BACKUP_RPO_MINUTES;
    else process.env.BACKUP_RPO_MINUTES = rpo;
    if (rto === undefined) delete process.env.BACKUP_RTO_MINUTES;
    else process.env.BACKUP_RTO_MINUTES = rto;
    try {
      const { service } = harnessWithEvents(blockedRecord());
      const readiness = await service.readiness('tenant-1');
      expect(readiness.required.find((item) => item.key === 'disaster_recovery'))
        .toMatchObject({ passed, required: true });
      expect(readiness.blockers.some((item) => item.key === 'disaster_recovery'))
        .toBe(!passed);
    } finally {
      process.env = originalEnvironment;
    }
  });

  it('blocked activate fires onboardingBlocked before throwing ACTIVATION_BLOCKED', async () => {
    const { service, operationalEvents } = harnessWithEvents(blockedRecord());
    await expect(service.activate('tenant-1', 'operator-1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ACTIVATION_BLOCKED' }),
    });
    expect(operationalEvents.onboardingBlocked).toHaveBeenCalledTimes(1);
    expect(operationalEvents.onboardingBlocked).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        tenantName: 'Lakeview Realty',
        blocker: expect.any(String),
        whatIsNeeded: expect.any(String),
      }),
    );
  });

  it('ready-for-activation fires once per ready transition, not on repeated ready polls', async () => {
    const { service, operationalEvents } = harnessWithEvents(blockedRecord());
    const transition = (service as any).notifyReadyForActivationTransition.bind(service);
    const checklist = { billing: 'ok', email: 'ok', crm: 'ok', calendar: 'ok' };

    // Not ready -> ready: fires.
    await transition('tenant-1', { name: 'Lakeview Realty' }, { ready: false }, checklist);
    expect(operationalEvents.readyForActivation).not.toHaveBeenCalled();
    await transition('tenant-1', { name: 'Lakeview Realty' }, { ready: true }, checklist);
    expect(operationalEvents.readyForActivation).toHaveBeenCalledTimes(1);
    expect(operationalEvents.readyForActivation).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', tenantName: 'Lakeview Realty' }),
    );
    // Repeated ready polls do not re-fire.
    await transition('tenant-1', { name: 'Lakeview Realty' }, { ready: true }, checklist);
    await transition('tenant-1', { name: 'Lakeview Realty' }, { ready: true }, checklist);
    expect(operationalEvents.readyForActivation).toHaveBeenCalledTimes(1);
    // Ready -> not ready -> ready is a new transition: fires again.
    await transition('tenant-1', { name: 'Lakeview Realty' }, { ready: false }, checklist);
    await transition('tenant-1', { name: 'Lakeview Realty' }, { ready: true }, checklist);
    expect(operationalEvents.readyForActivation).toHaveBeenCalledTimes(2);
  });

  it('consent gate names RealtyTechAI as the owner when client evidence is complete but the operator acknowledgment is missing', async () => {
    const record = blockedRecord();
    record.consentConfiguration = {
      exactConsentLanguage: 'You agree to receive calls and texts.',
      consentCollectionMethod: 'Checkbox on website lead form',
      sourceOwnership: 'authorized',
      optOutProcess: 'Reply STOP to opt out',
      consentPolicyVersion: 'client-onboarding-v1',
      purchasedOrColdListsExcluded: true,
      clientResponsibilityAcknowledged: true,
      lawfulLeadCollectionCertified: true,
      termsAcceptedVersion: '2026-08-11',
      privacyAcceptedVersion: '2026-08-11',
      acceptableUseAcceptedVersion: '2026-08-11',
      dataRetentionAcceptedVersion: '2026-08-11',
    };
    record.consentPolicyAcknowledgedAt = null;
    const { service } = harnessWithEvents(record);

    const readiness = await service.readiness('tenant-1');
    const gate = readiness.required.find((item) => item.key === 'consent_policy');
    expect(gate).toBeDefined();
    // The two-party requirement is NOT weakened: the gate still fails.
    expect(gate!.passed).toBe(false);
    // ...but it now says whose turn it is.
    expect(gate!.responsibleParty).toBe('jayden');
    expect(gate!.statusMessage).toMatch(/awaiting RealtyTechAI operator review/);
    expect(gate!.nextAction).toMatch(/operator must review/i);
  });

  it('consent gate passes once the operator records the acknowledgment', async () => {
    const record = blockedRecord();
    record.consentConfiguration = {
      exactConsentLanguage: 'You agree to receive calls and texts.',
      consentCollectionMethod: 'Checkbox on website lead form',
      sourceOwnership: 'authorized',
      optOutProcess: 'Reply STOP to opt out',
      consentPolicyVersion: 'client-onboarding-v1',
      purchasedOrColdListsExcluded: true,
      clientResponsibilityAcknowledged: true,
      lawfulLeadCollectionCertified: true,
      termsAcceptedVersion: '2026-08-11',
      privacyAcceptedVersion: '2026-08-11',
      acceptableUseAcceptedVersion: '2026-08-11',
      dataRetentionAcceptedVersion: '2026-08-11',
    };
    record.consentPolicyAcknowledgedAt = new Date();
    const { service } = harnessWithEvents(record);

    const readiness = await service.readiness('tenant-1');
    const gate = readiness.required.find((item) => item.key === 'consent_policy');
    expect(gate).toBeDefined();
    expect(gate!.passed).toBe(true);
  });

  it('brand gate names RealtyTechAI as the owner when only the provisioned SMS sender identity is missing', async () => {
    const record = blockedRecord();
    record.smsEnabled = true;
    record.brandCommunication = {
      brandName: 'Harborlight Realty',
      brandVoice: 'Warm and professional',
      requiredSignature: '— Alex at Harborlight Realty',
      fairHousingReviewAcknowledged: true,
      // approvedPhoneIdentity is provisioned by RealtyTechAI during Twilio setup.
    };
    const { service } = harnessWithEvents(record);

    const readiness = await service.readiness('tenant-1');
    const gate = readiness.required.find((item) => item.key === 'brand');
    expect(gate).toBeDefined();
    expect(gate!.passed).toBe(false);
    expect(gate!.responsibleParty).toBe('jayden');
    expect(gate!.statusMessage).toMatch(/sender identity is still being provisioned/);
  });
});

describe('operator pause/resume control', () => {
  function buildResumeService(options: {
    lifecycleStatus?: string;
    previousLifecycleStatus?: string | null;
    billingStatus?: string;
    paymentConfirmed?: boolean;
    withRecord?: boolean;
  }) {
    const tenantState: any = {
      id: 'tenant-1',
      name: 'Harborlight Realty',
      status: options.billingStatus ?? 'active',
      stripeSubscriptionId: 'sub_1',
      paidSubscriptionId: 'sub_1',
      paymentConfirmedAt: options.paymentConfirmed === false ? null : new Date(),
      lifecycleStatus: options.lifecycleStatus ?? 'PAUSED',
      servicePreviousLifecycleStatus:
        options.previousLifecycleStatus === undefined
          ? 'ACTIVE'
          : options.previousLifecycleStatus,
      servicePausedAt: new Date(),
      serviceRestoredAt: null,
      serviceRestoredById: null,
    };
    const settingsState: any = { tenantId: 'tenant-1', automationsEnabled: false };
    const recordState: any = options.withRecord === false
      ? null
      : { tenantId: 'tenant-1', activationStatus: 'paused', blockedReason: 'x' };
    const manager = {
      query: jest.fn().mockResolvedValue([{ enrollments: '2', jobs: '1' }]),
      getRepository: jest.fn((entity: any) => {
        if (entity === Tenant) {
          return {
            findOne: jest.fn().mockResolvedValue(tenantState),
            save: jest.fn(async (value: any) => Object.assign(tenantState, value)),
          };
        }
        if (entity === TenantSettings) {
          return {
            findOne: jest.fn().mockResolvedValue(settingsState),
            create: jest.fn((value: any) => ({ ...value })),
            save: jest.fn(async (value: any) => Object.assign(settingsState, value)),
          };
        }
        if (entity === OnboardingRecord) {
          return {
            findOne: jest.fn().mockResolvedValue(recordState),
            save: jest.fn(async (value: any) => Object.assign(recordState ?? {}, value)),
          };
        }
        throw new Error(`unexpected repository ${entity?.name}`);
      }),
    };
    const tenants = {
      findOne: jest.fn().mockResolvedValue(tenantState),
      manager: { transaction: jest.fn(async (fn: any) => fn(manager)) },
    };
    const audit = { record: jest.fn().mockResolvedValue({}) };
    const operationalEvents = { automationResumed: jest.fn().mockResolvedValue({}) };
    const notifications = { createForPlatform: jest.fn().mockResolvedValue({}) };
    const service = new OnboardingService(
      {} as any,
      tenants as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      notifications as any,
      undefined,
      undefined,
      audit as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      operationalEvents as any,
    );
    return {
      service,
      manager,
      audit,
      operationalEvents,
      notifications,
      tenantState,
      settingsState,
      recordState,
    };
  }

  it('resumes a paused workspace to its pre-pause state with one audit, one notification, one recovery event', async () => {
    const { service, manager, audit, operationalEvents, notifications, tenantState, settingsState, recordState } =
      buildResumeService({});

    const result = await service.resume('tenant-1', { id: 'op-1', email: 'op@example.com' });

    expect(result).toEqual(
      expect.objectContaining({ ok: true, changed: true, lifecycleStatus: 'ACTIVE' }),
    );
    expect(tenantState.lifecycleStatus).toBe('ACTIVE');
    expect(tenantState.servicePausedAt).toBeNull();
    expect(tenantState.serviceRestoredAt).toBeInstanceOf(Date);
    expect(tenantState.serviceRestoredById).toBe('op-1');
    expect(tenantState.servicePreviousLifecycleStatus).toBeNull();
    expect(settingsState.automationsEnabled).toBe(true);
    expect(recordState.activationStatus).toBe('active');
    expect(recordState.blockedReason).toBeNull();
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'workspace.resumed', tenantId: 'tenant-1' }),
    );
    expect(operationalEvents.automationResumed).toHaveBeenCalledTimes(1);
    expect(notifications.createForPlatform).toHaveBeenCalledTimes(1);
    // Advisory lock serializes pause/resume; stale work is staggered, not fired.
    expect(manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['service-control:tenant-1'],
    );
    const staggerCall = manager.query.mock.calls.find((call: any[]) =>
      String(call[0]).includes('sequence_enrollments'),
    );
    expect(staggerCall).toBeDefined();
    expect(staggerCall[1]).toEqual(['tenant-1']);
  });

  it('refuses to resume into ACTIVE when Stripe has not confirmed payment', async () => {
    const { service, audit, operationalEvents, notifications, tenantState } = buildResumeService({
      billingStatus: 'past_due',
      paymentConfirmed: false,
    });

    await expect(
      service.resume('tenant-1', { id: 'op-1', email: 'op@example.com' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tenantState.lifecycleStatus).toBe('PAUSED');
    expect(audit.record).not.toHaveBeenCalled();
    expect(operationalEvents.automationResumed).not.toHaveBeenCalled();
    expect(notifications.createForPlatform).not.toHaveBeenCalled();
  });

  it('is a no-op when the workspace is not paused', async () => {
    const { service, audit, operationalEvents, notifications } = buildResumeService({
      lifecycleStatus: 'ONBOARDING',
    });

    const result = await service.resume('tenant-1', { id: 'op-1', email: 'op@example.com' });
    expect(result).toEqual(
      expect.objectContaining({ ok: true, changed: false, lifecycleStatus: 'ONBOARDING' }),
    );
    expect(audit.record).not.toHaveBeenCalled();
    expect(operationalEvents.automationResumed).not.toHaveBeenCalled();
    expect(notifications.createForPlatform).not.toHaveBeenCalled();
  });

  it('never resumes a SUSPENDED workspace (suspension owns its own restore path)', async () => {
    const { service, audit, tenantState } = buildResumeService({ lifecycleStatus: 'SUSPENDED' });

    const result = await service.resume('tenant-1', { id: 'op-1', email: 'op@example.com' });
    expect(result.changed).toBe(false);
    expect(tenantState.lifecycleStatus).toBe('SUSPENDED');
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('falls back to ONBOARDING, never ACTIVE, when the pre-pause state is unknown', async () => {
    const { service, tenantState, settingsState, recordState } = buildResumeService({
      previousLifecycleStatus: null,
      billingStatus: 'incomplete',
      paymentConfirmed: false,
    });

    const result = await service.resume('tenant-1', { id: 'op-1', email: 'op@example.com' });
    expect(result.lifecycleStatus).toBe('ONBOARDING');
    expect(tenantState.lifecycleStatus).toBe('ONBOARDING');
    expect(settingsState.automationsEnabled).toBe(false);
    expect(recordState.activationStatus).toBe('incomplete');
  });

  it('pause records the pre-pause state so resume can restore it', async () => {
    const tenantState: any = {
      id: 'tenant-1',
      name: 'Harborlight Realty',
      lifecycleStatus: 'TESTING',
      servicePausedAt: null,
      servicePreviousLifecycleStatus: null,
    };
    const tenants = {
      findOne: jest.fn().mockResolvedValue(tenantState),
      manager: {
        transaction: jest.fn(async (fn: any) =>
          fn({
            save: jest.fn(async (value: any) => Object.assign(tenantState, value)),
          }),
        ),
      },
    };
    const settingsState: any = { tenantId: 'tenant-1', automationsEnabled: true };
    const settings = {
      findOne: jest.fn().mockResolvedValue(settingsState),
      create: jest.fn((value: any) => ({ ...value })),
    };
    const recordState: any = { tenantId: 'tenant-1', activationStatus: 'incomplete' };
    const records = {
      findOne: jest.fn().mockResolvedValue(recordState),
      create: jest.fn((value: any) => ({ ...value })),
      save: jest.fn(async (value: any) => value),
    };
    const service = new OnboardingService(
      records as any,
      tenants as any,
      settings as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await service.pause('tenant-1');
    expect(tenantState.lifecycleStatus).toBe('PAUSED');
    expect(tenantState.servicePreviousLifecycleStatus).toBe('TESTING');
    expect(tenantState.servicePausedAt).toBeInstanceOf(Date);
    expect(settingsState.automationsEnabled).toBe(false);
    expect(recordState.activationStatus).toBe('paused');
  });
});

describe('operator consent review (Review → Approve / Reject)', () => {
  const completeEvidence = {
    exactConsentLanguage: 'I consent to receive marketing messages.',
    consentCollectionMethod: 'Website form checkbox',
    sourceOwnership: 'Client owns the lead list',
    optOutProcess: 'Reply STOP to opt out',
    consentPolicyVersion: 'v1.0',
    termsAcceptedVersion: '2026-08-11',
    privacyAcceptedVersion: '2026-08-11',
    acceptableUseAcceptedVersion: '2026-08-11',
    dataRetentionAcceptedVersion: '2026-08-11',
    purchasedOrColdListsExcluded: true,
    clientResponsibilityAcknowledged: true,
    lawfulLeadCollectionCertified: true,
  };

  function buildService(consentConfiguration: any, existingAcknowledgedAt: Date | null = null) {
    const recordState: any = {
      tenantId: 'tenant-1',
      consentConfiguration,
      consentPolicyAcknowledgedAt: existingAcknowledgedAt,
      verifiedItems: {},
      providerTests: {},
    };
    const records = {
      findOne: jest.fn().mockResolvedValue(recordState),
      create: jest.fn((value: any) => ({ ...value })),
      save: jest.fn(async (value: any) => value),
    };
    const audit = {
      record: jest.fn().mockResolvedValue({}),
    };
    const service = new OnboardingService(
      records as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      audit as any,
    );
    return { service, recordState, audit };
  }

  it('approves when client evidence is complete: timestamps, attributes, scope, and audits', async () => {
    const { service, recordState, audit } = buildService({ ...completeEvidence });
    const operator = { userId: 'op-1', email: 'jayden@realtytechai.app' };

    await service.reviewConsent('tenant-1', 'approve', 'Evidence looks good.', operator);

    expect(recordState.consentPolicyAcknowledgedAt).toBeInstanceOf(Date);
    const evidence = recordState.verifiedItems.consent_policy;
    expect(evidence.decision).toBe('approve');
    expect(evidence.verifiedBy).toBe('jayden@realtytechai.app');
    expect(evidence.verifiedByUserId).toBe('op-1');
    expect(evidence.scope).toBe('tenant-wide');
    expect(evidence.notes).toBe('Evidence looks good.');
    expect(evidence.verifiedAt).toBeTruthy();
    // Audit record written with decision, scope, operator identity.
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        actorId: 'op-1',
        actorEmail: 'jayden@realtytechai.app',
        action: 'consent.approved',
        resourceType: 'onboarding_consent',
        metadata: expect.objectContaining({
          decision: 'approve',
          scope: 'tenant-wide',
        }),
      }),
    );
  });

  it('refuses approval when policy version fields are missing', async () => {
    const { termsAcceptedVersion, privacyAcceptedVersion, ...partial } = completeEvidence;
    const { service } = buildService(partial);
    const operator = { userId: 'op-1', email: 'jayden@realtytechai.app' };

    await expect(
      service.reviewConsent('tenant-1', 'approve', undefined, operator),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('writes an audit record on rejection', async () => {
    const { service, audit } = buildService({ ...completeEvidence });
    const operator = { userId: 'op-1', email: 'jayden@realtytechai.app' };

    await service.reviewConsent('tenant-1', 'reject', 'Missing opt-out details.', operator);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'consent.rejected',
        metadata: expect.objectContaining({
          decision: 'reject',
          scope: 'tenant-wide',
          notes: 'Missing opt-out details.',
        }),
      }),
    );
  });

  it('refuses approval when client evidence is incomplete', async () => {
    const { service } = buildService({ exactConsentLanguage: 'partial' });
    const operator = { userId: 'op-1', email: 'jayden@realtytechai.app' };

    await expect(
      service.reviewConsent('tenant-1', 'approve', undefined, operator),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects with a reason: clears acknowledgment and records rejection', async () => {
    const { service, recordState } = buildService(
      { ...completeEvidence },
      new Date('2026-09-26T00:00:00Z'),
    );
    const operator = { userId: 'op-1', email: 'jayden@realtytechai.app' };

    await service.reviewConsent('tenant-1', 'reject', 'Missing opt-out details on the form.', operator);

    expect(recordState.consentPolicyAcknowledgedAt).toBeNull();
    const evidence = recordState.verifiedItems.consent_policy;
    expect(evidence.decision).toBe('reject');
    expect(evidence.verifiedBy).toBe('jayden@realtytechai.app');
    expect(evidence.notes).toBe('Missing opt-out details on the form.');
  });

  it('refuses rejection without a reason so the client knows what to fix', async () => {
    const { service } = buildService({ ...completeEvidence });
    const operator = { userId: 'op-1', email: 'jayden@realtytechai.app' };

    await expect(
      service.reviewConsent('tenant-1', 'reject', '   ', operator),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('P1 shared controlled-test completion invariant', () => {
  function harness(options: {
    aiEnabled?: boolean;
    aiPaused?: boolean;
    responseMode?: string;
    allowedChannels?: Array<'sms' | 'email'>;
    aiSettingsMode?: 'ok' | 'missing' | 'error';
    smsEnabled?: boolean;
    emailEnabled?: boolean;
    bookingEnabled?: boolean;
    initialChecks?: Record<string, unknown>;
  }) {
    const {
      aiEnabled = true,
      aiPaused = false,
      responseMode = 'controlled_autopilot',
      allowedChannels,
      aiSettingsMode = 'ok',
      smsEnabled = false,
      emailEnabled = true,
      bookingEnabled = true,
      initialChecks = { outbound: 'delivered', inboundEmail: 'passed' },
    } = options;
    const record = Object.assign(new OnboardingRecord(), {
      tenantId: 'tenant-1',
      smsEnabled,
      emailEnabled,
      bookingEnabled,
      verifiedItems: {},
      providerTests: {},
      testLeadCompletedAt: null,
    });
    const run: any = {
      id: 'test-run-1',
      tenantId: 'tenant-1',
      status: 'running',
      expiresAt: new Date(Date.now() + 60_000),
      checks: { ...initialChecks },
      completedAt: null,
      failureReason: null,
    };
    const records = {
      findOne: jest.fn().mockResolvedValue(record),
      save: jest.fn(async (value) => value),
    };
    const testRuns = {
      findOne: jest.fn().mockImplementation(async ({ where }) =>
        run.status === where.status ? run : null,
      ),
      save: jest.fn(async (value) => value),
    };
    const workspaceAiSettings = {
      findOne: jest.fn().mockImplementation(async () => {
        if (aiSettingsMode === 'error') throw new Error('settings store unavailable');
        if (aiSettingsMode === 'missing') return null;
        return {
          tenantId: 'tenant-1',
          aiEnabled,
          aiPaused,
          responseMode,
          allowedChannels,
        };
      }),
    };
    const service = new OnboardingService(
      records as any,
      {
        findOne: jest.fn().mockResolvedValue({
          id: 'tenant-1',
          lifecycleStatus: 'TESTING',
        }),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      testRuns as any,
      undefined,
      undefined,
      undefined,
      workspaceAiSettings as any,
    );
    return { service, record, run, records, testRuns };
  }

  const allBookingEvidence = {
    calendarAvailability: true,
    externalCalendarEvent: true,
    internalAppointment: true,
    agentNotification: true,
    crmAppointmentEvent: true,
    humanTakeover: true,
  };

  it('does not pass on appointment/takeover evidence while the AI reply is pending', async () => {
    const { service, run, record } = harness({});
    await service.recordUatWorkflowEvidence('tenant-1', run.id, allBookingEvidence);
    expect(run.status).toBe('running');
    expect(record.testLeadCompletedAt).toBeNull();
    expect(record.verifiedItems).not.toHaveProperty('appointment_uat');
  });

  it('passes through recordUatWorkflowEvidence once the AI reply delivery arrives', async () => {
    const { service, run, record } = harness({});
    await service.recordUatWorkflowEvidence('tenant-1', run.id, allBookingEvidence);
    expect(run.status).toBe('running');
    await service.recordAutomatedTestEvidence('tenant-1', {
      inboundEmailAiReplyDelivered: true,
      testRunId: run.id,
    });
    expect(run).toMatchObject({ status: 'passed', completedAt: expect.any(Date) });
    expect(record.testLeadCompletedAt).toBeInstanceOf(Date);
  });

  it('recordAutomatedTestEvidence also requires the AI reply when AI is enabled', async () => {
    const { service, run } = harness({
      bookingEnabled: false,
      initialChecks: { outbound: 'delivered', inboundEmail: 'passed' },
    });
    await service.recordAutomatedTestEvidence('tenant-1', {
      outboundDelivered: true,
      testRunId: run.id,
    });
    expect(run.status).toBe('running');
    await service.recordAutomatedTestEvidence('tenant-1', {
      inboundEmailAiReplyDelivered: true,
      testRunId: run.id,
    });
    expect(run.status).toBe('passed');
  });

  it('lets a legitimate non-AI workflow complete without AI reply evidence', async () => {
    const { service, run, record } = harness({ aiEnabled: false });
    await service.recordUatWorkflowEvidence('tenant-1', run.id, allBookingEvidence);
    expect(run).toMatchObject({ status: 'passed', completedAt: expect.any(Date) });
    expect(record.testLeadCompletedAt).toBeInstanceOf(Date);
  });

  it('lets a paused-AI workflow complete without AI reply evidence', async () => {
    const { service, run } = harness({ aiPaused: true });
    await service.recordUatWorkflowEvidence('tenant-1', run.id, allBookingEvidence);
    expect(run.status).toBe('passed');
  });

  it('keeps testLeadCompletedAt unset until the full journey passes', async () => {
    const { service, run, record } = harness({
      bookingEnabled: false,
      initialChecks: {},
    });
    await service.recordAutomatedTestEvidence('tenant-1', {
      outboundDelivered: true,
      inboundEmail: true,
      testRunId: run.id,
    });
    expect(run.status).toBe('running');
    expect(record.testLeadCompletedAt).toBeNull();
    await service.recordAutomatedTestEvidence('tenant-1', {
      inboundEmailAiReplyDelivered: true,
      testRunId: run.id,
    });
    expect(run.status).toBe('passed');
    expect(record.testLeadCompletedAt).toBeInstanceOf(Date);
  });

  it('completes an email-only tenant without any SMS proof', async () => {
    const { service, run, record } = harness({
      smsEnabled: false,
      emailEnabled: true,
      bookingEnabled: false,
      aiEnabled: true,
      allowedChannels: ['email'],
      initialChecks: { outbound: 'delivered', inboundEmail: 'passed' },
    });
    // Email journey complete (inbound + AI reply delivered), no SMS checks
    // recorded at all: an email-only workspace must not require SMS proof.
    await service.recordAutomatedTestEvidence('tenant-1', {
      inboundEmailAiReplyDelivered: true,
      testRunId: run.id,
    });
    expect(run).toMatchObject({ status: 'passed', completedAt: expect.any(Date) });
    expect(record.testLeadCompletedAt).toBeInstanceOf(Date);
  });

  it('does not require an SMS AI reply when AI is approved for email only', async () => {
    const { service, run } = harness({
      smsEnabled: true,
      emailEnabled: true,
      bookingEnabled: false,
      aiEnabled: true,
      allowedChannels: ['email'],
      initialChecks: {
        outbound: 'delivered',
        inboundSms: 'passed',
        stop: 'passed',
        inboundEmail: 'passed',
      },
    });
    // Full SMS delivery journey + email AI reply, but no SMS AI reply:
    // allowedChannels=['email'] means AI was never approved for SMS.
    await service.recordAutomatedTestEvidence('tenant-1', {
      inboundEmailAiReplyDelivered: true,
      testRunId: run.id,
    });
    expect(run.status).toBe('passed');
  });

  it('requires the SMS AI reply when AI is approved for both channels', async () => {
    const { service, run } = harness({
      smsEnabled: true,
      emailEnabled: true,
      bookingEnabled: false,
      aiEnabled: true,
      // allowedChannels omitted: the AI preflight default-channel behavior
      // treats a missing list as approval for both channels.
      initialChecks: {
        outbound: 'delivered',
        inboundSms: 'passed',
        stop: 'passed',
        inboundEmail: 'passed',
        inboundEmailAiReplyDelivered: 'passed',
      },
    });
    await service.recordAutomatedTestEvidence('tenant-1', {
      outboundDelivered: true,
      testRunId: run.id,
    });
    expect(run.status).toBe('running');
    await service.recordAutomatedTestEvidence('tenant-1', {
      inboundSmsAiReplyDelivered: true,
      testRunId: run.id,
    });
    expect(run.status).toBe('passed');
  });

  it('fails closed when the AI configuration is unreadable', async () => {
    const { service, run, record } = harness({
      aiSettingsMode: 'error',
      bookingEnabled: false,
      initialChecks: { outbound: 'delivered', inboundEmail: 'passed' },
    });
    await service.recordAutomatedTestEvidence('tenant-1', {
      inboundEmailAiReplyDelivered: true,
      testRunId: run.id,
    });
    expect(run.status).toBe('running');
    expect(record.testLeadCompletedAt).toBeNull();
  });

  it('fails closed when the AI configuration is missing', async () => {
    const { service, run, record } = harness({
      aiSettingsMode: 'missing',
      bookingEnabled: false,
      initialChecks: { outbound: 'delivered', inboundEmail: 'passed' },
    });
    await service.recordAutomatedTestEvidence('tenant-1', {
      inboundEmailAiReplyDelivered: true,
      testRunId: run.id,
    });
    expect(run.status).toBe('running');
    expect(record.testLeadCompletedAt).toBeNull();
  });
});

describe('unpaid operator email testing retains activation prerequisites', () => {
  function fixture(blockers: any[], lifecycleStatus = 'ONBOARDING', email = 'owned@example.test') {
    const tenant = { id: 'fixture', status: 'incomplete', lifecycleStatus };
    const record = { emailEnabled: true, smsEnabled: false, bookingEnabled: false,
      contacts: { controlledTestEmail: email }, activationStatus: 'incomplete' };
    const manager = { save: jest.fn() };
    const transaction = jest.fn(async (callback) => callback(manager));
    const service = new OnboardingService({} as any,
      { findOne: async () => tenant, manager: { transaction } } as any,
      { findOne: async () => ({ automationsEnabled: false }) } as any, {} as any, {} as any, {} as any);
    jest.spyOn(service, 'getOrCreate').mockResolvedValue(record as any);
    jest.spyOn(service, 'readiness').mockResolvedValue({ blockers } as any);
    (service as any).operatorTests = { validateGrant: jest.fn(async ({ recipientEmail }) =>
      recipientEmail === 'owned@example.test' ? { id: 'grant' } : null) };
    return { service, tenant, transaction };
  }
  it('allows only billing blockers to be satisfied by the grant and preserves incomplete billing', async () => {
    const item = fixture([{ category: 'billing', key: 'billing_evidence' }]);
    await item.service.beginTesting('fixture', 'operator', 'owned@example.test');
    expect(item.tenant.lifecycleStatus).toBe('TESTING');
    expect(item.tenant.status).toBe('incomplete');
    expect(item.transaction).toHaveBeenCalled();
  });
  it('retains consent/configuration prerequisites and recipient binding', async () => {
    const item = fixture([{ category: 'client_information', key: 'consent_policy' }]);
    await expect(item.service.beginTesting('fixture', 'operator')).rejects.toBeInstanceOf(BadRequestException);
    expect(item.transaction).not.toHaveBeenCalled();
    const mismatch = fixture([{ category: 'billing', key: 'billing_evidence' }]);
    await expect(mismatch.service.beginTesting('fixture', 'operator', 'stranger@example.test')).rejects.toBeInstanceOf(BadRequestException);
    expect(mismatch.transaction).not.toHaveBeenCalled();
  });
  it.each(['SUSPENDED', 'CANCELED'])('never revives an offboarded or %s fixture', async (lifecycle) => {
    const item = fixture([], lifecycle);
    await expect(item.service.beginTesting('fixture', 'operator')).rejects.toBeInstanceOf(BadRequestException);
    expect(item.transaction).not.toHaveBeenCalled();
  });
});
