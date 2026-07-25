import { BrokerageKnowledge } from './brokerage-knowledge.entity';
import { AiResponseMode, WorkspaceAiSettings } from './workspace-ai-settings.entity';

export const AI_PROVIDER = Symbol('AI_PROVIDER');

export const AI_TOOL_NAMES = [
  'get_lead_context',
  'get_conversation_history',
  'get_verified_business_information',
  'update_lead_qualification',
  'update_conversation_summary',
  'set_lead_temperature',
  'set_next_action',
  'send_verified_booking_link',
  'create_or_update_appointment',
  'create_human_handoff',
  'pause_ai_for_lead',
  'notify_assigned_agent',
] as const;

export type AiToolName = (typeof AI_TOOL_NAMES)[number];

export type AiToolRequest = {
  name: AiToolName;
  /**
   * JSON text is used at the provider boundary. RealtyTechAI parses it and
   * validates the tool-specific schema before execution.
   */
  arguments: string;
};

export type AiProviderOutput = {
  reply: string | null;
  confidence: number;
  classification: 'allowed' | 'handoff' | 'no_reply';
  escalationReason: string | null;
  summary: string;
  recommendedNextAction: string;
  leadTemperature: 'hot' | 'warm' | 'cold' | 'unchanged';
  actions: AiToolRequest[];
};

export type AiProviderInput = {
  mode: AiResponseMode;
  channel: 'sms' | 'email';
  identityLabel: string;
  firstAiResponse: boolean;
  lead: Record<string, unknown>;
  conversationSummary: string | null;
  recentMessages: Array<{
    direction: 'inbound' | 'outbound';
    channel: 'sms' | 'email';
    body: string;
    authorship: string;
    createdAt: string;
  }>;
  knowledge: BrokerageKnowledge;
  settings: WorkspaceAiSettings;
};

export type AiProviderResult = AiProviderOutput & {
  provider: string;
  model: string;
  inputUsage: number;
  outputUsage: number;
  latencyMs: number;
};

export interface AiProvider {
  generate(input: AiProviderInput): Promise<AiProviderResult>;
}

export type AiPolicyEscalation = {
  code: string;
  reason: string;
  priority: 'normal' | 'high' | 'urgent';
};
