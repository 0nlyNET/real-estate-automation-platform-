import { TestingService } from './testing.service';
import { ComplianceService } from '../compliance/compliance.service';

describe('TestingService production-pipeline UAT', () => {
  it.each(['explicit', 'saved'])('creates a run-bound lead using %s controlled recipients', async (recipientSource) => {
    let sequence = 0;
    const runs = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => {
        if (!value.id) value.id = `run-${++sequence}`;
        return value;
      }),
    };
    const onboarding = {
      getOrCreate: jest.fn().mockResolvedValue({
        smsEnabled: true,
        emailEnabled: true,
        contacts: { controlledTestPhone: '+15550000001', controlledTestEmail: 'owner@example.com' },
      }),
      beginTesting: jest.fn().mockResolvedValue({ lifecycleStatus: 'TESTING' }),
    };
    const leads = {
      intake: jest.fn().mockResolvedValue({ id: 'lead-1' }),
    };
    const notifications = {
      createForTenant: jest.fn().mockResolvedValue({ id: 'notification-1' }),
    };
    const sequences = {
      find: jest.fn().mockResolvedValue([
        {
          leadType: 'seller',
          temperature: 'hot',
          steps: [
            { active: true, approvalStatus: 'approved', channel: 'sms' },
            { active: true, approvalStatus: 'approved', channel: 'email' },
          ],
        },
      ]),
    };
    const service = new TestingService(
      runs as any,
      sequences as any,
      { count: jest.fn().mockResolvedValue(0) } as any,
      { count: jest.fn().mockResolvedValue(0) } as any,
      onboarding as any,
      leads as any,
      notifications as any,
    );

    const result = await service.start('tenant-1', 'operator-1', recipientSource === 'saved' ? {} : {
      smsRecipient: '(555) 000-0001',
      emailRecipient: 'owner@example.com',
    });

    expect(onboarding.beginTesting).toHaveBeenCalledWith(
      'tenant-1',
      'operator-1',
    );
    expect(leads.intake).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        source: 'controlled_uat',
        email: 'owner@example.com',
        leadType: 'seller',
        temperature: 'hot',
      }),
      {
        source: 'controlled_uat',
        controlledTest: true,
        testRunId: 'run-1',
      },
    );
    expect(result).toMatchObject({
      testLeadId: 'lead-1',
      status: 'running',
      checks: expect.objectContaining({
        intake: 'passed',
        outbound: 'awaiting_provider_callbacks',
      }),
    });
  });

  it('creates isolated evidence contexts when later runs reuse the same recipients', async () => {
    let runSequence = 0;
    let leadSequence = 0;
    const runs = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => {
        if (!value.id) value.id = `run-${++runSequence}`;
        return value;
      }),
    };
    const sequences = { find: jest.fn().mockResolvedValue([{
      leadType: 'buyer', temperature: 'warm',
      steps: [{ active: true, approvalStatus: 'approved', channel: 'sms' }],
    }]) };
    const leads = { intake: jest.fn(async () => ({ id: `lead-${++leadSequence}` })) };
    const service = new TestingService(
      runs as any,
      sequences as any,
      { count: jest.fn().mockResolvedValue(0) } as any,
      { count: jest.fn().mockResolvedValue(0) } as any,
      {
        getOrCreate: jest.fn().mockResolvedValue({ smsEnabled: true, emailEnabled: false }),
        beginTesting: jest.fn(),
      } as any,
      leads as any,
      { createForTenant: jest.fn() } as any,
    );

    const first = await service.start('tenant-1', 'operator-1', { smsRecipient: '+15550000001' });
    first.status = 'passed';
    const second = await service.start('tenant-1', 'operator-1', { smsRecipient: '+15550000001' });

    expect(first).toMatchObject({ id: 'run-1', testLeadId: 'lead-1' });
    expect(second).toMatchObject({ id: 'run-2', testLeadId: 'lead-2' });
    expect((leads.intake as jest.Mock).mock.calls[0][2]).toMatchObject({ testRunId: 'run-1' });
    expect((leads.intake as jest.Mock).mock.calls[1][2]).toMatchObject({ testRunId: 'run-2' });
  });

  it('supports an email-only controlled UAT while SMS/A2P is unavailable', async () => {
    const runs = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: value.id || 'run-email', ...value })),
    };
    const leads = { intake: jest.fn().mockResolvedValue({ id: 'lead-email' }) };
    const service = new TestingService(
      runs as any,
      {
        find: jest.fn().mockResolvedValue([
          {
            leadType: 'buyer',
            temperature: 'warm',
            steps: [{ active: true, approvalStatus: 'approved', channel: 'email' }],
          },
        ]),
      } as any,      { count: jest.fn().mockResolvedValue(0) } as any,
      { count: jest.fn().mockResolvedValue(0) } as any,

      {
        getOrCreate: jest.fn().mockResolvedValue({ smsEnabled: false, emailEnabled: true }),
        beginTesting: jest.fn(),
      } as any,
      leads as any,
      { createForTenant: jest.fn() } as any,
    );
    await expect(
      service.start('tenant-1', 'operator-1', { emailRecipient: 'owner@example.com' }),
    ).resolves.toMatchObject({ smsRecipient: null, emailRecipient: 'owner@example.com' });
    expect(leads.intake).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        email: 'owner@example.com',
        phone: undefined,
        consent: expect.objectContaining({
          email: expect.objectContaining({
            affirmative: true,
            source: 'controlled_uat',
            sourceIdentifier: 'run-email',
            clientAttested: true,
            disclosureText: expect.stringContaining('Synthetic controlled UAT'),
          }),
        }),
      }),
      expect.objectContaining({ controlledTest: true }),
    );
    // Email-only should NOT create SMS consent
    const consentArg = (leads.intake as jest.Mock).mock.calls[0][1].consent;
    expect(consentArg.sms).toBeUndefined();
    expect(consentArg.email).toBeDefined();
  });

  it('creates sufficient SMS consent for SMS-only controlled UAT', async () => {
    const runs = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: value.id || 'run-sms', ...value })),
    };
    const leads = { intake: jest.fn().mockResolvedValue({ id: 'lead-sms' }) };
    const service = new TestingService(
      runs as any,
      {
        find: jest.fn().mockResolvedValue([
          {
            leadType: 'buyer',
            temperature: 'warm',
            steps: [{ active: true, approvalStatus: 'approved', channel: 'sms' }],
          },
        ]),
      } as any,      { count: jest.fn().mockResolvedValue(0) } as any,
      { count: jest.fn().mockResolvedValue(0) } as any,

      {
        getOrCreate: jest.fn().mockResolvedValue({ 
          smsEnabled: true, 
          emailEnabled: false,
          contacts: { controlledTestPhone: '+15550000001' },
        }),
        beginTesting: jest.fn(),
      } as any,
      leads as any,
      { createForTenant: jest.fn() } as any,
    );
    await service.start('tenant-1', 'operator-1', { smsRecipient: '+15550000001' });
    const consentArg = (leads.intake as jest.Mock).mock.calls[0][1].consent;
    // SMS-only should create SMS consent but NOT email consent
    expect(consentArg.sms).toMatchObject({
      affirmative: true,
      source: 'controlled_uat',
      sourceIdentifier: 'run-sms',
      clientAttested: true,
    });
    expect(consentArg.sms.disclosureText).toContain('Synthetic controlled UAT');
    expect(consentArg.sms.consentedAt).toBeDefined();
    expect(consentArg.email).toBeUndefined();
  });

  it('creates both SMS and email consent for combined controlled UAT', async () => {
    const runs = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: value.id || 'run-both', ...value })),
    };
    const leads = { intake: jest.fn().mockResolvedValue({ id: 'lead-both' }) };
    const service = new TestingService(
      runs as any,
      {
        find: jest.fn().mockResolvedValue([
          {
            leadType: 'buyer',
            temperature: 'warm',
            steps: [
              { active: true, approvalStatus: 'approved', channel: 'sms' },
              { active: true, approvalStatus: 'approved', channel: 'email' },
            ],
          },
        ]),
      } as any,      { count: jest.fn().mockResolvedValue(0) } as any,
      { count: jest.fn().mockResolvedValue(0) } as any,

      {
        getOrCreate: jest.fn().mockResolvedValue({ 
          smsEnabled: true, 
          emailEnabled: true,
          contacts: { 
            controlledTestPhone: '+15550000001',
            controlledTestEmail: 'owner@example.com',
          },
        }),
        beginTesting: jest.fn(),
      } as any,
      leads as any,
      { createForTenant: jest.fn() } as any,
    );
    await service.start('tenant-1', 'operator-1', { 
      smsRecipient: '+15550000001',
      emailRecipient: 'owner@example.com',
    });
    const consentArg = (leads.intake as jest.Mock).mock.calls[0][1].consent;
    // Combined should create BOTH consents with same test run ID
    expect(consentArg.sms).toMatchObject({
      affirmative: true,
      source: 'controlled_uat',
      sourceIdentifier: 'run-both',
      clientAttested: true,
    });
    expect(consentArg.email).toMatchObject({
      affirmative: true,
      source: 'controlled_uat',
      sourceIdentifier: 'run-both',
      clientAttested: true,
    });
  });

  it('never synthesizes controlled_uat consent on the ordinary live intake path', async () => {
    // Regression: the synthetic controlled_uat consent must ONLY ever be
    // created by TestingService.start. Ordinary live intake (LeadsService.intake
    // called without a consent payload) must not receive synthetic consent.
    // ComplianceService.recordLeadConsent with no consent payload creates
    // nothing — it never invents controlled_uat evidence.
    const consentRepo = {
      findOne: jest.fn(),
      create: jest.fn((v: any) => v),
      save: jest.fn(async (v: any) => v),
    };
    const compliance = new ComplianceService(
      {} as any,
      { create: jest.fn((v: any) => v), save: jest.fn(async (v: any) => v) } as any,
      {} as any,
      {} as any,
      consentRepo as any,
      {} as any,
      {} as any,
      {} as any,
    );
    // Live intake passes payload.consent through; when absent, nothing is recorded.
    const saved = await compliance.recordLeadConsent('tenant-1', 'lead-live', undefined);
    expect(saved).toEqual([]);
    expect(consentRepo.create).not.toHaveBeenCalled();
    expect(consentRepo.save).not.toHaveBeenCalled();
  });

  it('produces synthetic consent that satisfies communicationEligibility', async () => {
    // End-to-end regression for PR #99: the consent DTO built by
    // TestingService.start, once recorded, must make communicationEligibility()
    // return allowed. A malformed synthetic consent would fail closed here.
    const runs = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: value.id || 'run-elig', ...value })),
    };
    const leads = { intake: jest.fn().mockResolvedValue({ id: 'lead-elig' }) };
    const service = new TestingService(
      runs as any,
      {
        find: jest.fn().mockResolvedValue([
          {
            leadType: 'buyer',
            temperature: 'warm',
            steps: [{ active: true, approvalStatus: 'approved', channel: 'email' }],
          },
        ]),
      } as any,      { count: jest.fn().mockResolvedValue(0) } as any,
      { count: jest.fn().mockResolvedValue(0) } as any,

      {
        getOrCreate: jest.fn().mockResolvedValue({ smsEnabled: false, emailEnabled: true }),
        beginTesting: jest.fn(),
      } as any,
      leads as any,
      { createForTenant: jest.fn() } as any,
    );
    await service.start('tenant-1', 'operator-1', { emailRecipient: 'owner@example.com' });
    const consentDto = (leads.intake as jest.Mock).mock.calls[0][1].consent;
    expect(consentDto.email.source).toBe('controlled_uat');

    // Record it through the real ComplianceService logic (mocked repos).
    const savedRecords: any[] = [];
    const consentRepo = {
      findOne: jest.fn(async () => null),
      create: jest.fn((v: any) => v),
      save: jest.fn(async (v: any) => {
        savedRecords.push(v);
        return v;
      }),
    };
    const compliance = new ComplianceService(
      { findOne: jest.fn(async () => null) } as any,
      { create: jest.fn((v: any) => v), save: jest.fn(async (v: any) => v) } as any,
      {} as any,
      {} as any,
      consentRepo as any,
      {} as any,
      {} as any,
      { findOne: jest.fn(async () => null) } as any,
    );
    await compliance.recordLeadConsent('tenant-1', 'lead-elig', consentDto);
    expect(savedRecords).toHaveLength(1);
    expect(savedRecords[0]).toMatchObject({
      status: 'affirmative',
      source: 'controlled_uat',
    });
    expect(savedRecords[0].consentedAt).toBeInstanceOf(Date);
    expect(savedRecords[0].disclosureText).toContain('Synthetic controlled UAT');

    // Now eligibility must allow with the saved record.
    const eligibilityService = new ComplianceService(
      { findOne: jest.fn(async () => null) } as any,
      { create: jest.fn((v: any) => v), save: jest.fn(async (v: any) => v) } as any,
      {} as any,
      {} as any,
      { findOne: jest.fn(async () => savedRecords[0]) } as any,
      {} as any,
      {} as any,
      { findOne: jest.fn(async () => null) } as any,
    );
    const result = await eligibilityService.communicationEligibility(
      'tenant-1',
      { id: 'lead-elig', email: 'owner@example.com' } as any,
      'email',
    );
    expect(result).toMatchObject({ allowed: true });
  });

  it('expires a stuck run and starts a fresh one', async () => {
    const oldDate = new Date(Date.now() - 20 * 60_000);
    const stuckRun = {
      id: 'run-stuck',
      tenantId: 'tenant-1',
      status: 'running',
      createdAt: oldDate,
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
      testLeadId: 'lead-stuck',
      checks: { intake: 'passed', outbound: 'awaiting_provider_callbacks' },
      failureReason: null,
    };
    const savedRuns: any[] = [];
    const runs = {
      findOne: jest.fn().mockResolvedValue(stuckRun),
      create: jest.fn((value: any) => value),
      save: jest.fn(async (value: any) => {
        savedRuns.push({ ...value });
        if (!value.id) value.id = 'run-fresh';
        return value;
      }),
    };
    const enrollments = { count: jest.fn().mockResolvedValue(0) };
    const aiRuns = { count: jest.fn().mockResolvedValue(0) };
    const onboarding = {
      getOrCreate: jest.fn().mockResolvedValue({
        smsEnabled: false,
        emailEnabled: true,
        contacts: { controlledTestEmail: 'owner@example.com' },
      }),
      beginTesting: jest.fn().mockResolvedValue({ lifecycleStatus: 'TESTING' }),
    };
    const leads = { intake: jest.fn().mockResolvedValue({ id: 'lead-fresh' }) };
    const notifications = { createForTenant: jest.fn().mockResolvedValue({}) };
    const sequences = {
      find: jest.fn().mockResolvedValue([
        {
          leadType: 'buyer',
          temperature: 'warm',
          steps: [{ active: true, approvalStatus: 'approved', channel: 'email' }],
        },
      ]),
    };
    const service = new TestingService(
      runs as any,
      sequences as any,
      enrollments as any,
      aiRuns as any,
      onboarding as any,
      leads as any,
      notifications as any,
    );
    const result = await service.start('tenant-1', 'operator-1', {});
    // The stuck run must have been expired...
    expect(savedRuns[0]).toMatchObject({ id: 'run-stuck', status: 'expired' });
    // ...and a fresh run created with a new lead intake.
    expect(leads.intake).toHaveBeenCalled();
    expect(result.id).toBe('run-fresh');
  });

  it('returns the existing run when it is not stuck', async () => {
    const recentDate = new Date(Date.now() - 2 * 60_000);
    const healthyRun = {
      id: 'run-healthy',
      tenantId: 'tenant-1',
      status: 'running',
      createdAt: recentDate,
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
      testLeadId: 'lead-healthy',
      checks: { intake: 'passed', outbound: 'awaiting_provider_callbacks' },
      failureReason: null,
    };
    const runs = {
      findOne: jest.fn().mockResolvedValue(healthyRun),
      create: jest.fn((v: any) => v),
      save: jest.fn(async (v: any) => v),
    };
    const enrollments = { count: jest.fn().mockResolvedValue(0) };
    const aiRuns = { count: jest.fn().mockResolvedValue(1) };
    const onboarding = {
      getOrCreate: jest.fn().mockResolvedValue({
        smsEnabled: false,
        emailEnabled: true,
        contacts: { controlledTestEmail: 'owner@example.com' },
      }),
    };
    const service = new TestingService(
      runs as any,
      { find: jest.fn() } as any,
      enrollments as any,
      aiRuns as any,
      onboarding as any,
      { intake: jest.fn() } as any,
      {} as any,
    );
    const result = await service.start('tenant-1', 'operator-1', {});
    expect(result.id).toBe('run-healthy');
  });
});
