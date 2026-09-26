import { BadRequestException } from '@nestjs/common';
import { OnboardingRecord } from './onboarding-record.entity';
import { OnboardingService } from './onboarding.service';

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
});
