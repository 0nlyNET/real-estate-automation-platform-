import { BadRequestException, ConflictException } from '@nestjs/common';
import { AiConfigurationService } from './ai-configuration.service';
import { BrokerageKnowledge } from './brokerage-knowledge.entity';
import { WorkspaceAiSettings } from './workspace-ai-settings.entity';

function repository<T extends object>(factory: () => T) {
  let row: T | null = null;
  return {
    get row() {
      return row;
    },
    set row(value: T | null) {
      row = value;
    },
    findOne: jest.fn(async () => row),
    findOneOrFail: jest.fn(async () => {
      if (!row) throw new Error('missing');
      return row;
    }),
    create: jest.fn((value) => Object.assign(factory(), value)),
    save: jest.fn(async (value) => {
      row = Object.assign(value, {
        id: (value as any).id || '00000000-0000-4000-8000-000000000099',
        createdAt: (value as any).createdAt || new Date(),
        updatedAt: new Date(),
      });
      return row;
    }),
  };
}

describe('workspace AI configuration approval', () => {
  const originalKey = process.env.OPENAI_API_KEY;
  let settingsRepo: ReturnType<typeof repository<WorkspaceAiSettings>>;
  let knowledgeRepo: ReturnType<typeof repository<BrokerageKnowledge>>;
  let credentials: any;
  let bookingProviders: any;
  let service: AiConfigurationService;
  const actor = {
    userId: '00000000-0000-4000-8000-000000000010',
    email: 'owner@example.com',
  };

  beforeEach(() => {
    settingsRepo = repository(() => new WorkspaceAiSettings());
    knowledgeRepo = repository(() => new BrokerageKnowledge());
    credentials = { find: jest.fn().mockResolvedValue([]) };
    bookingProviders = { status: jest.fn() };
    service = new AiConfigurationService(
      settingsRepo as any,
      knowledgeRepo as any,
      credentials,
      { findOne: jest.fn().mockResolvedValue(null) } as any,
      {
        usageForWorkspace: jest.fn().mockResolvedValue({
          runs: 0,
          input: 0,
          output: 0,
          total: 0,
          estimatedCostUsd: 0,
        }),
      } as any,
      { recordHuman: jest.fn().mockResolvedValue({}) } as any,
      undefined,
      bookingProviders,
    );
    process.env.OPENAI_API_KEY = 'configured-for-test';
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  it('creates every workspace as disabled and human-only by default', async () => {
    const result = await service.getConfiguration(
      '00000000-0000-4000-8000-000000000001',
    );
    expect(result.settings).toMatchObject({
      aiEnabled: false,
      responseMode: 'human_only',
      configurationApprovalStatus: 'draft',
    });
  });

  it('requires explicit confirmation before saving controlled autopilot', async () => {
    await expect(
      service.updateSettings(
        '00000000-0000-4000-8000-000000000001',
        { responseMode: 'controlled_autopilot' },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('disables AI and invalidates approval whenever business information changes', async () => {
    settingsRepo.row = Object.assign(new WorkspaceAiSettings(), {
      tenantId: '00000000-0000-4000-8000-000000000001',
      aiEnabled: true,
      responseMode: 'draft',
      configurationApprovalStatus: 'approved',
      identityLabel: 'Lakeview virtual assistant',
    });
    knowledgeRepo.row = Object.assign(new BrokerageKnowledge(), {
      tenantId: settingsRepo.row.tenantId,
      approvalStatus: 'approved',
      publicName: 'Lakeview Realty',
      serviceAreas: ['Austin'],
      businessHours: {},
      approvedFaqs: [],
      agentRoster: [],
      routingRules: {},
    });
    await service.updateKnowledge(
      settingsRepo.row.tenantId,
      { serviceAreas: ['Austin', 'Round Rock'] },
      actor,
    );
    expect(settingsRepo.row).toMatchObject({
      aiEnabled: false,
      configurationApprovalStatus: 'draft',
    });
    expect(knowledgeRepo.row).toMatchObject({ approvalStatus: 'draft' });
  });

  it('will not approve empty or unverified brokerage knowledge', async () => {
    await expect(
      service.approveKnowledge(
        '00000000-0000-4000-8000-000000000001',
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('will not approve AI settings until knowledge and a tested channel are ready', async () => {
    settingsRepo.row = Object.assign(new WorkspaceAiSettings(), {
      tenantId: '00000000-0000-4000-8000-000000000001',
      aiEnabled: false,
      responseMode: 'draft',
      identityLabel: 'Lakeview virtual assistant',
      configurationApprovalStatus: 'draft',
    });
    knowledgeRepo.row = Object.assign(new BrokerageKnowledge(), {
      tenantId: settingsRepo.row.tenantId,
      approvalStatus: 'draft',
    });
    await expect(
      service.approveSettings(settingsRepo.row.tenantId, actor),
    ).rejects.toBeInstanceOf(ConflictException);

    knowledgeRepo.row.approvalStatus = 'approved';
    await expect(
      service.approveSettings(settingsRepo.row.tenantId, actor),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('enables only a separately approved configuration with a tested provider', async () => {
    const tenantId = '00000000-0000-4000-8000-000000000001';
    settingsRepo.row = Object.assign(new WorkspaceAiSettings(), {
      tenantId,
      aiEnabled: false,
      responseMode: 'draft',
      identityLabel: 'Lakeview virtual assistant',
      maximumAutomaticTurns: 6,
      minimumConfidenceThreshold: 0.82,
      configurationApprovalStatus: 'approved',
    });
    knowledgeRepo.row = Object.assign(new BrokerageKnowledge(), {
      tenantId,
      approvalStatus: 'approved',
      publicName: 'Lakeview Realty',
      serviceAreas: ['Austin'],
    });
    credentials.find.mockResolvedValue([
      {
        provider: 'twilio',
        encryptedValue: JSON.stringify({
          connected: true,
          lastSync: new Date().toISOString(),
          error: null,
        }),
      },
    ]);
    const result = await service.updateSettings(
      tenantId,
      { aiEnabled: true },
      actor,
    );
    expect(result.settings.aiEnabled).toBe(true);
  });

  it.each([
    'google_calendar',
    'microsoft_calendar',
    'calendly',
  ] as const)(
    'recognizes a tested %s connection without requiring the other providers',
    async (activeProvider) => {
      bookingProviders.status.mockResolvedValue({
        activeProvider,
        connected: true,
        providers: {
          google_calendar: {
            connected: activeProvider === 'google_calendar',
          },
          microsoft_calendar: {
            connected: activeProvider === 'microsoft_calendar',
          },
          calendly: { connected: activeProvider === 'calendly' },
        },
      });
      const result = await service.getConfiguration(
        '00000000-0000-4000-8000-000000000001',
      );
      expect(result.readiness).toMatchObject({
        bookingProviderConnected: true,
        activeBookingProvider: activeProvider,
      });
    },
  );

  it('blocks direct AI booking when the selected provider is not tested', async () => {
    bookingProviders.status.mockResolvedValue({
      activeProvider: 'microsoft_calendar',
      connected: false,
      providers: {
        google_calendar: { connected: false },
        microsoft_calendar: { connected: false },
        calendly: { connected: false },
      },
    });
    await expect(
      service.updateSettings(
        '00000000-0000-4000-8000-000000000001',
        { bookingBehavior: 'calendar_booking' },
        actor,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CALENDAR_NEEDS_ATTENTION' }),
    });
  });
});
