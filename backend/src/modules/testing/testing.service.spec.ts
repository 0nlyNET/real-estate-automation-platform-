import { TestingService } from './testing.service';

describe('TestingService production-pipeline UAT', () => {
  it('creates a run-bound lead through the normal intake service', async () => {
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

    const result = await service.start('tenant-1', 'operator-1', {
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
});
