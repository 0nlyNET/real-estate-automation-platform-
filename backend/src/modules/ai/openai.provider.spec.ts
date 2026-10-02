import { ServiceUnavailableException } from '@nestjs/common';
import { BrokerageKnowledge } from './brokerage-knowledge.entity';
import { OpenAiProvider, validateOutput } from './openai.provider';
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
    triggeringMessage: {
      direction: 'inbound' as const,
      channel: 'sms' as const,
      body: 'I am looking near Austin.',
      authorship: 'system',
      createdAt: new Date().toISOString(),
    },
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
    // The model input carries the exact triggering message and per-tool
    // contracts (required nesting, allowed keys, examples) so the model can
    // produce valid tool arguments.
    const modelInput = JSON.parse(body.input);
    expect(modelInput.triggeringMessage).toMatchObject({
      direction: 'inbound',
      body: 'I am looking near Austin.',
    });
    const qualificationTool = modelInput.availableTools.find(
      (tool: any) => tool.name === 'update_lead_qualification',
    );
    expect(qualificationTool).toBeDefined();
    expect(qualificationTool.parameters.required).toContain('qualification');
    expect(
      qualificationTool.parameters.properties.qualification.properties,
    ).toHaveProperty('budget');
    expect(qualificationTool.example).toContain('"qualification"');
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

describe('validateOutput (OUTPUT_SCHEMA agreement)', () => {
  function valid() {
    return {
      reply: 'Hello!',
      confidence: 0.9,
      classification: 'allowed',
      escalationReason: null,
      summary: 'Buyer inquiry.',
      recommendedNextAction: 'Follow up.',
      leadTemperature: 'warm',
      actions: [],
    };
  }

  it('accepts a valid output', () => {
    expect(validateOutput(valid()).classification).toBe('allowed');
  });

  it('rejects NaN and non-finite confidence', () => {
    expect(() => validateOutput({ ...valid(), confidence: NaN })).toThrow(
      /confidence/,
    );
    expect(() => validateOutput({ ...valid(), confidence: Infinity })).toThrow(
      /confidence/,
    );
  });

  it('rejects out-of-range confidence', () => {
    expect(() => validateOutput({ ...valid(), confidence: 1.5 })).toThrow(
      /confidence/,
    );
  });

  it('rejects a non-string, non-null escalationReason', () => {
    expect(() =>
      validateOutput({ ...valid(), escalationReason: 42 }),
    ).toThrow(/escalationReason/);
  });

  it('rejects missing required fields', () => {
    const { reply, ...rest } = valid();
    expect(() => validateOutput(rest)).toThrow(/missing required field/);
  });

  it('rejects unexpected extra properties', () => {
    expect(() =>
      validateOutput({ ...valid(), injected: 'x' }),
    ).toThrow(/unexpected field/);
  });

  it('rejects more than 10 actions', () => {
    const actions = Array.from({ length: 11 }, () => ({
      name: 'update_conversation_summary',
      arguments: JSON.stringify({ summary: 's' }),
    }));
    expect(() => validateOutput({ ...valid(), actions })).toThrow(/10-action/);
  });

  it('rejects over-length summary and action arguments', () => {
    expect(() =>
      validateOutput({ ...valid(), summary: 'x'.repeat(2001) }),
    ).toThrow(/summary/);
    expect(() =>
      validateOutput({
        ...valid(),
        actions: [
          {
            name: 'update_conversation_summary',
            arguments: 'x'.repeat(4001),
          },
        ],
      }),
    ).toThrow(/arguments/);
  });

  it('rejects actions with unexpected fields', () => {
    expect(() =>
      validateOutput({
        ...valid(),
        actions: [
          {
            name: 'update_conversation_summary',
            arguments: '{}',
            extra: 1,
          },
        ],
      }),
    ).toThrow(/unexpected fields/);
  });

  it('rejects invalid classification and temperature enums', () => {
    expect(() =>
      validateOutput({ ...valid(), classification: 'escalate' }),
    ).toThrow(/classification/);
    expect(() =>
      validateOutput({ ...valid(), leadTemperature: 'boiling' }),
    ).toThrow(/leadTemperature/);
  });
});
