import { AiController } from './ai.controller';

/**
 * Regression: POST /ai/emergency-pause used to return the partial
 * WorkspaceAiSettings entity. ai-assistant-settings.tsx replaces its local
 * configuration with the mutation response, so the partial payload corrupted
 * the page state and crashed rendering ("This page couldn't load").
 * The endpoint must return the full AiConfiguration shape after persisting.
 */
describe('AiController emergency pause', () => {
  function buildController() {
    const persistedSettings: { workspacePaused: boolean; reason: string | null } = {
      workspacePaused: false,
      reason: null,
    };
    const configuration = {
      getConfiguration: jest.fn(async () => ({
        settings: { ...persistedSettings },
        readiness: { communications: { workspacePaused: persistedSettings.workspacePaused } },
        approvals: [],
        knowledgeSources: [],
      })),
    };
    const conversations = {
      setWorkspacePause: jest.fn(async (_tenantId: string, paused: boolean, reason: string) => {
        persistedSettings.workspacePaused = paused;
        persistedSettings.reason = paused ? reason : null;
        return { ...persistedSettings };
      }),
    };
    const controller = new AiController(configuration as any, conversations as any);
    return { controller, configuration, conversations };
  }

  const req = { user: { tenantId: 'tenant-1', sub: 'op-1' } };

  it('returns the full configuration after persisting the pause', async () => {
    const { controller, configuration, conversations } = buildController();

    const result: any = await controller.setWorkspacePause(req as any, {
      paused: true,
      reason: 'test pause',
    });

    expect(conversations.setWorkspacePause).toHaveBeenCalledTimes(1);
    expect(configuration.getConfiguration).toHaveBeenCalledWith('tenant-1');
    expect(result).toHaveProperty('settings');
    expect(result).toHaveProperty('readiness');
    expect(result).toHaveProperty('approvals');
    expect(result.readiness.communications.workspacePaused).toBe(true);
  });

  it('returns the full configuration after clearing the pause, so a reload keeps working', async () => {
    const { controller, configuration } = buildController();

    await controller.setWorkspacePause(req as any, { paused: true, reason: 'test pause' });
    const result: any = await controller.setWorkspacePause(req as any, {
      paused: false,
      reason: '',
    });

    expect(configuration.getConfiguration).toHaveBeenCalledTimes(2);
    expect(result).toHaveProperty('settings');
    expect(result.readiness.communications.workspacePaused).toBe(false);
  });
});
