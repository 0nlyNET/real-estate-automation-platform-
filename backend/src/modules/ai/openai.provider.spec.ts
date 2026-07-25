import { ServiceUnavailableException } from '@nestjs/common';
import { BrokerageKnowledge } from './brokerage-knowledge.entity';
import { OpenAiProvider } from './openai.provider';
import { WorkspaceAiSettings } from './workspace-ai-settings.entity';

function input() {
  return {
    mode: 'draft' as const,
    channel: 'sms' as const,
    identityLabel: 'the virtual assistant for Lakeview Realty',
    firstAiResponse: true,
    lead: {
      id: '00000000-0000-4000-8000-000000000020',
      fullName: 'Jordan Client',
      leadType: 'buyer',
    },
    conversationSummary: null,
    recentMessages: [
      {
        direction: 'inbound' as const,
        channel: 'sms' as const,
        body: 'I am looking near Austin.',
        authorship: 'system',
        createdAt: new Date().toISOString(),
      },
    ],
    knowledge: Object.assign(new BrokerageKnowledge(), {
      publicName: 'Lakeview Realty',
      serviceAreas: ['Austin'],
      businessHours: {},
      approvedFaqs: [],
      agentRoster: [],
      routingRules: {},
    }),
    settings: Object.assign(new WorkspaceAiSettings(), {
      allowedTopics: ['qualification'],
    }),
  };
}

describe('OpenAI provider boundary', () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-test-only';
    process.env.OPENAI_MODEL = 'gpt-5.6';
    process.env.AI_MODEL_MAX_RETRIES = '0';
  });

  afterEach(() => {
    process.env = { ...original };
    jest.restoreAllMocks();
  });

  it('uses the Responses API with strict structured output and no provider storage', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'gpt-5.6-2026-07-01',
        output_text: JSON.stringify({
          reply: 'What timeline are you considering?',
          confidence: 0.96,
          classification: 'allowed',
          escalationReason: null,
          summary: 'Buyer is interested in Austin.',
          recommendedNextAction: 'Ask the approved timeline question.',
          leadTemperature: 'warm',
          actions: [
            {
              name: 'update_conversation_summary',
              arguments: JSON.stringify({
                summary: 'Buyer is interested in Austin.',
              }),
            },
          ],
        }),
        usage: { input_tokens: 120, output_tokens: 40 },
      }),
    } as Response);
    const result = await new OpenAiProvider().generate(input());
    expect(result).toMatchObject({
      provider: 'openai',
      inputUsage: 120,
      outputUsage: 40,
      classification: 'allowed',
    });
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(String(request?.body));
    expect(body).toMatchObject({
      model: 'gpt-5.6',
      store: false,
      text: {
        format: {
          type: 'json_schema',
          strict: true,
        },
      },
    });
    expect(body.text.format.schema.properties.actions.items.properties.name.enum)
      .toContain('create_human_handoff');
    expect(String(request?.headers && JSON.stringify(request.headers))).not.toContain(
      'Jordan Client',
    );
  });

  it('turns a timeout into a sanitized service failure for human fallback', async () => {
    const timeout = Object.assign(
      new Error('request timed out with sk-should-not-leak'),
      { name: 'TimeoutError' },
    );
    jest.spyOn(global, 'fetch').mockRejectedValue(timeout);
    let caught: unknown;
    try {
      await new OpenAiProvider().generate(input());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ServiceUnavailableException);
    expect((caught as ServiceUnavailableException).getResponse()).toMatchObject({
      code: 'AI_PROVIDER_TIMEOUT',
    });
    expect(
      JSON.stringify((caught as ServiceUnavailableException).getResponse()),
    ).not.toContain('sk-should-not-leak');
  });
});
