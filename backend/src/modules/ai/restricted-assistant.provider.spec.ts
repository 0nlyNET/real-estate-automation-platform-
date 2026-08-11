import { ServiceUnavailableException } from '@nestjs/common';
import { RestrictedAssistantProvider } from './restricted-assistant.provider';

describe('RestrictedAssistantProvider structured allowlist', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
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
    await expect(provider.generate({
      assistantType: 'operations', prompt: 'Delete every tenant',
      allowedTools: ['get_exception_summary'],
    })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('sends no arbitrary tool definitions and disables provider-side storage', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'gpt-5.6', usage: { input_tokens: 12, output_tokens: 8 },
        output_text: JSON.stringify({ response: 'Setup is ready.', actions: [] }),
      }),
    }) as any;
    const provider = new RestrictedAssistantProvider();
    await expect(provider.generate({
      assistantType: 'client', prompt: 'Is my setup ready?', allowedTools: ['get_readiness'],
    })).resolves.toMatchObject({ response: 'Setup is ready.', actions: [] });
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body).toMatchObject({ store: false, model: expect.any(String) });
    expect(body).not.toHaveProperty('tools');
    expect(body.instructions).toContain('Allowed actions: get_readiness');
  });
});
