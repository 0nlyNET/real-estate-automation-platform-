import { ServiceUnavailableException } from '@nestjs/common';
import { RestrictedAssistantProvider } from './restricted-assistant.provider';

describe('RestrictedAssistantProvider structured allowlist', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  const originalRetries = process.env.AI_MODEL_MAX_RETRIES;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.AI_MODEL_MAX_RETRIES = '1';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    if (originalRetries === undefined) delete process.env.AI_MODEL_MAX_RETRIES;
    else process.env.AI_MODEL_MAX_RETRIES = originalRetries;
  });

  it('rejects a model-requested destructive tool outside the exact registry', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'gpt-5.6',
        output_text: JSON.stringify({
          response: 'I will delete it.',
          actions: [{ name: 'delete_tenant', arguments: '{}' }],
        }),
      }),
    }) as any;
    const provider = new RestrictedAssistantProvider();
    await expect(
      provider.generate({
        assistantType: 'operations',
        prompt: 'Delete every tenant',
        allowedTools: ['get_exception_summary'],
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('sends no arbitrary tool definitions and disables provider-side storage', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'gpt-5.6',
        usage: { input_tokens: 12, output_tokens: 8 },
        output_text: JSON.stringify({
          response: 'Setup is ready.',
          actions: [],
        }),
      }),
    }) as any;
    const provider = new RestrictedAssistantProvider();
    await expect(
      provider.generate({
        assistantType: 'client',
        prompt: 'Is my setup ready?',
        allowedTools: ['get_readiness'],
        context: {
          assistantScope: 'authenticated_workspace',
          workspace: { name: 'Lakeview Realty' },
        },
      }),
    ).resolves.toMatchObject({ response: 'Setup is ready.', actions: [] });
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body).toMatchObject({ store: false, model: expect.any(String) });
    expect(body).not.toHaveProperty('tools');
    expect(body.instructions).toContain('Allowed actions:');
    expect(body.instructions).toContain(
      '- get_readiness: Read the current workspace launch/readiness blockers.',
    );
    expect(JSON.parse(body.input).authenticatedContext).toEqual({
      assistantScope: 'authenticated_workspace',
      workspace: { name: 'Lakeview Realty' },
    });
  });

  it('returns an exact configuration requirement when the provider key is missing', async () => {
    delete process.env.OPENAI_API_KEY;
    const provider = new RestrictedAssistantProvider();

    await expect(
      provider.generate({
        assistantType: 'client',
        prompt: 'Hello',
        allowedTools: [],
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'AI_PROVIDER_NOT_CONFIGURED',
        message: expect.stringContaining('OPENAI_API_KEY'),
      },
    });
  });

  it('retries one transient rate limit and then returns the successful response', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ error: { message: 'rate limited' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'gpt-5.6',
          output_text: JSON.stringify({
            response: 'Ready after retry.',
            actions: [],
          }),
        }),
      }) as any;
    const provider = new RestrictedAssistantProvider();

    await expect(
      provider.generate({
        assistantType: 'operations',
        prompt: 'Check readiness',
        allowedTools: [],
      }),
    ).resolves.toMatchObject({ response: 'Ready after retry.' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('sends verified tool output through a second provider pass before returning the final answer', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'gpt-5.6',
        output_text: JSON.stringify({
          response: 'SMS is not ready because the sender is awaiting approval.',
          actions: [],
        }),
      }),
    }) as any;
    const provider = new RestrictedAssistantProvider();

    await expect(
      provider.finalize({
        assistantType: 'client',
        prompt: 'Why is SMS not ready?',
        plannedResponse: 'I will check.',
        actionResults: [
          {
            name: 'get_messaging_status',
            status: 'executed',
            output: { smsReady: false, emailReady: true },
          },
        ],
      }),
    ).resolves.toMatchObject({
      response: 'SMS is not ready because the sender is awaiting approval.',
      actions: [],
    });
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    const input = JSON.parse(body.input);
    expect(input.verifiedActionResults).toEqual([
      expect.objectContaining({
        name: 'get_messaging_status',
        output: { smsReady: false, emailReady: true },
      }),
    ]);
    expect(body.instructions).toContain(
      'Never claim a failed or pending action completed',
    );
  });
});
