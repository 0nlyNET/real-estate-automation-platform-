import { ClientOperationsService } from './client-operations.service';
import { Lead } from '../leads/lead.entity';

function queryBuilder(result: any[]) {
  const builder: any = {};
  for (const method of [
    'leftJoinAndSelect',
    'where',
    'andWhere',
    'orderBy',
    'take',
  ]) {
    builder[method] = jest.fn(() => builder);
  }
  builder.getMany = jest.fn().mockResolvedValue(result);
  builder.getOne = jest.fn().mockResolvedValue(result[0] || null);
  return builder;
}

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    tenantId: '20000000-0000-4000-8000-000000000001',
    fullName: 'Jordan Buyer',
    leadType: 'buyer',
    temperature: 'warm',
    temperatureReason: 'Qualification is still in progress.',
    readinessLevel: 'exploring',
    qualificationData: {},
    stage: 'contacted',
    score: 50,
    sequenceStatus: 'stopped',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Lead;
}

function workflowHarness() {
  const handoffs = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => ({
      id: value.id || '30000000-0000-4000-8000-000000000001',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...value,
    })),
    createQueryBuilder: jest.fn(() => queryBuilder([])),
  };
  const appointments = {
    createQueryBuilder: jest.fn(() => queryBuilder([])),
  };
  const leads = {
    save: jest.fn(async (value) => value),
    createQueryBuilder: jest.fn(() => queryBuilder([])),
  };
  const messages = {
    createQueryBuilder: jest.fn(() => queryBuilder([])),
    find: jest.fn().mockResolvedValue([]),
  };
  const events = {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
  };
  const notifications = {
    createForTenant: jest.fn().mockResolvedValue([]),
    createForPlatform: jest.fn().mockResolvedValue([]),
  };
  const service = new ClientOperationsService(
    handoffs as any,
    appointments as any,
    leads as any,
    messages as any,
    events as any,
    notifications as any,
  );
  return { service, handoffs, appointments, leads, messages, events, notifications };
}

describe('ClientOperationsService', () => {
  it('classifies the pre-approved 60-day buyer as hot and creates a handoff with a reason', async () => {
    const { service, handoffs, notifications } = workflowHarness();
    const item = lead();

    const result = await service.processInboundReply(
      item,
      "I'm pre-approved up to $350,000 and want to buy within 60 days. Can we talk?",
      '40000000-0000-4000-8000-000000000001',
    );

    expect(result.lead).toMatchObject({
      temperature: 'hot',
      readinessLevel: 'ready',
      preapproved: 'yes',
      timeline: 'Within 60 days',
      budgetRange: '$350,000',
      stage: 'qualified',
    });
    expect(result.lead.temperatureReason).toContain('Pre-approved buyer');
    expect(result.lead.temperatureReason).toContain('60 days');
    expect(result.handoff).toMatchObject({ priority: 'high', status: 'open' });
    expect(handoffs.save).toHaveBeenCalled();
    expect(notifications.createForTenant).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'handoff.created' }),
    );
  });

  it('keeps a buyer with a credit blocker warm and schedules a future follow-up without an urgent handoff', async () => {
    const { service, handoffs } = workflowHarness();
    const item = lead();
    const before = Date.now();

    const result = await service.processInboundReply(
      item,
      'I want to purchase, but I need to improve my credit score first.',
      '40000000-0000-4000-8000-000000000002',
    );

    expect(result.lead).toMatchObject({
      temperature: 'warm',
      readinessLevel: 'exploring',
      mainBlocker: 'Credit improvement',
      stage: 'nurture',
      followUpCadence: 'Monthly',
    });
    expect(result.lead.nextFollowUpAt!.getTime()).toBeGreaterThan(
      before + 29 * 24 * 60 * 60 * 1000,
    );
    expect(result.handoff).toBeNull();
    expect(handoffs.save).not.toHaveBeenCalled();
  });

  it('creates a reasoned handoff for a seller with a near-term timeline who requests a call', async () => {
    const { service } = workflowHarness();
    const item = lead({ fullName: 'Taylor Seller' });
    const result = await service.processInboundReply(
      item,
      'I need to sell my home within 45 days and would like to talk. I expect about $425,000.',
      '40000000-0000-4000-8000-000000000003',
    );
    expect(result.lead).toMatchObject({
      leadType: 'seller',
      temperature: 'hot',
      readinessLevel: 'ready',
      timeline: 'Within 45 days',
      estimatedPrice: '$425,000',
      stage: 'qualified',
    });
    expect(result.lead.temperatureReason).toContain('Seller planning to move within 45 days');
    expect(result.handoff).not.toBeNull();
  });

  it('caps the client Today queue at eight priority records from the requested tenant', async () => {
    const { service, handoffs, leads } = workflowHarness();
    const tenantId = '20000000-0000-4000-8000-000000000001';
    const rows = Array.from({ length: 10 }, (_, index) => {
      const item = lead({
        id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        tenantId,
        fullName: `Priority Lead ${index + 1}`,
        assignedToUserId: null,
      });
      return {
        id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        tenantId,
        leadId: item.id,
        lead: item,
        assignedUser: null,
        priority: 'high',
        status: 'open',
        reason: 'Ready for a personal conversation.',
        summary: 'Qualified lead.',
        recommendedAction: 'Call today.',
        dueAt: new Date(Date.now() + index * 60_000),
      };
    });
    const handoffBuilder = queryBuilder(rows);
    handoffs.createQueryBuilder.mockReturnValue(handoffBuilder);
    leads.createQueryBuilder
      .mockReturnValueOnce(queryBuilder([]))
      .mockReturnValueOnce(queryBuilder([]));

    const result = await service.getToday(
      tenantId,
      { userId: '50000000-0000-4000-8000-000000000001', role: 'owner' },
      50,
    );

    expect(result.actionCount).toBe(8);
    expect(result.actions).toHaveLength(8);
    expect(handoffBuilder.where).toHaveBeenCalledWith(
      'handoff.tenantId = :tenantId',
      { tenantId },
    );

    const invalidLimit = await service.getToday(
      tenantId,
      { userId: '50000000-0000-4000-8000-000000000001', role: 'owner' },
      Number.NaN,
    );
    expect(invalidLimit.actions).toHaveLength(8);
  });
});
