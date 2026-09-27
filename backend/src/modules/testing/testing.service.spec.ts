import { TestingService } from './testing.service';

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
      } as any,
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
      } as any,
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
      } as any,
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
});
