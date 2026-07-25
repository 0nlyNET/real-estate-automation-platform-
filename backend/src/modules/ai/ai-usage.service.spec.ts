import { AiUsageService } from './ai-usage.service';
import { ConversationAiState } from './conversation-ai-state.entity';
import { WorkspaceAiSettings } from './workspace-ai-settings.entity';

function queryWith(raw: Record<string, string>) {
  const query: any = {
    select: jest.fn(() => query),
    addSelect: jest.fn(() => query),
    where: jest.fn(() => query),
    andWhere: jest.fn(() => query),
    getRawOne: jest.fn().mockResolvedValue(raw),
  };
  return query;
}

describe('AI usage controls', () => {
  it('blocks a conversation at its configured usage limit', async () => {
    const query = queryWith({ input: '100', output: '50', cost: '0.02', runs: '2' });
    const service = new AiUsageService({
      createQueryBuilder: jest.fn(() => query),
    } as any);
    const settings = Object.assign(new WorkspaceAiSettings(), {
      tenantId: '00000000-0000-4000-8000-000000000001',
      perConversationUsageLimit: 500,
      monthlyWorkspaceUsageLimit: 10_000,
    });
    const state = Object.assign(new ConversationAiState(), {
      usageUnits: 500,
    });
    await expect(service.evaluateLimits(settings, state)).resolves.toMatchObject({
      allowed: false,
      code: 'CONVERSATION_USAGE_LIMIT',
    });
  });

  it('blocks a workspace at its monthly limit and records aggregate cost', async () => {
    const query = queryWith({
      input: '700',
      output: '300',
      cost: '1.25',
      runs: '12',
    });
    const service = new AiUsageService({
      createQueryBuilder: jest.fn(() => query),
    } as any);
    const settings = Object.assign(new WorkspaceAiSettings(), {
      tenantId: '00000000-0000-4000-8000-000000000001',
      perConversationUsageLimit: 5_000,
      monthlyWorkspaceUsageLimit: 1_000,
    });
    const state = Object.assign(new ConversationAiState(), { usageUnits: 100 });
    await expect(service.evaluateLimits(settings, state)).resolves.toMatchObject({
      allowed: false,
      code: 'WORKSPACE_USAGE_LIMIT',
      workspace: {
        total: 1_000,
        estimatedCostUsd: 1.25,
        runs: 12,
      },
    });
  });
});
