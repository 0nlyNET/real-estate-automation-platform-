import { AiToolName } from './ai.types';

/**
 * Tool-specific contracts shared by the model-facing tool definitions and the
 * runtime validator. The provider serializes these into the model input so the
 * model sees the exact required nesting, allowed keys, types, and an example
 * for every allowlisted tool. The executor validates against the same
 * contract; the validator is never loosened to accommodate a malformed call.
 */

export type AiToolParametersSchema = {
  type: 'object';
  required?: string[];
  properties: Record<string, unknown>;
  additionalProperties: false;
};

export type AiToolContract = {
  name: AiToolName;
  description: string;
  parameters: AiToolParametersSchema;
  /**
   * Valid `arguments` JSON text for this tool (what the model must produce).
   */
  example: string;
};

export const QUALIFICATION_FIELD_NAMES = [
  'intent',
  'location',
  'timeline',
  'budget',
  'preapproval',
  'preferredContact',
  'preferredTimes',
] as const;

export const QUALIFICATION_FIELDS = new Set<string>(QUALIFICATION_FIELD_NAMES);

const QUALIFICATION_PROPERTIES: Record<string, unknown> = {
  intent: {
    type: ['string', 'null'],
    description: 'buyer, seller, renter, or investor.',
  },
  location: {
    type: ['string', 'null'],
    description: 'Preferred area, neighborhood, or city.',
  },
  timeline: {
    type: ['string', 'null'],
    description: 'When they want to move, e.g. "within 3 months".',
  },
  budget: {
    type: ['string', 'null'],
    description: 'Budget or price range, e.g. "$450,000".',
  },
  preapproval: {
    type: ['string', 'null'],
    description: 'yes, no, or unsure.',
  },
  preferredContact: {
    type: ['string', 'null'],
    description: 'How they prefer to be contacted.',
  },
  preferredTimes: {
    type: ['string', 'null'],
    description: 'Best times to reach them.',
  },
};

export const AI_TOOL_CONTRACTS: Record<AiToolName, AiToolContract> = {
  get_lead_context: {
    name: 'get_lead_context',
    description:
      'Read the current lead record (profile, qualification data, temperature). Takes no arguments.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    example: '{}',
  },
  get_conversation_history: {
    name: 'get_conversation_history',
    description:
      'Read the recent conversation history for this lead. Takes no arguments.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    example: '{}',
  },
  get_verified_business_information: {
    name: 'get_verified_business_information',
    description:
      'Read the approved brokerage knowledge (identity, service areas, FAQs, escalation rules). Takes no arguments.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    example: '{}',
  },
  update_lead_qualification: {
    name: 'update_lead_qualification',
    description:
      'Save structured qualification facts extracted from the lead\'s own messages. ' +
      'The arguments MUST nest the facts under a top-level "qualification" object; ' +
      'flat keys are rejected. Only these keys are allowed: ' +
      QUALIFICATION_FIELD_NAMES.join(', ') +
      '. Every value must be text or null (max 500 characters); never invent ' +
      'timeline, preapproval, or other unstated preferences. ' +
      'Bedroom/bathroom counts and other details outside the allowed keys are NOT ' +
      'accepted here — preserve them in the conversation summary via ' +
      'update_conversation_summary instead of sending an unsupported field or ' +
      'dropping the detail.',
    parameters: {
      type: 'object',
      required: ['qualification'],
      properties: {
        qualification: {
          type: 'object',
          properties: QUALIFICATION_PROPERTIES,
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    example:
      '{"qualification":{"intent":"buyer","location":"Elmwood Village","budget":"$450,000"}}',
  },
  update_conversation_summary: {
    name: 'update_conversation_summary',
    description:
      'Save a concise summary of the conversation so far, including preferences ' +
      'that have no structured qualification field (for example bedroom counts). ' +
      'Requires a non-empty "summary" string.',
    parameters: {
      type: 'object',
      required: ['summary'],
      properties: {
        summary: { type: 'string', maxLength: 2000 },
      },
      additionalProperties: false,
    },
    example:
      '{"summary":"Buyer wants a 3-bedroom in Elmwood Village around $450,000. Asked for current listings."}',
  },
  set_lead_temperature: {
    name: 'set_lead_temperature',
    description:
      'Set the lead temperature. Requires "temperature" (hot, warm, or cold) and a "reason".',
    parameters: {
      type: 'object',
      required: ['temperature', 'reason'],
      properties: {
        temperature: { type: 'string', enum: ['hot', 'warm', 'cold'] },
        reason: { type: 'string', maxLength: 1000 },
      },
      additionalProperties: false,
    },
    example: '{"temperature":"hot","reason":"Asked for listings with a clear budget and area."}',
  },
  set_next_action: {
    name: 'set_next_action',
    description:
      'Record the recommended next action for this lead. Requires "nextAction".',
    parameters: {
      type: 'object',
      required: ['nextAction'],
      properties: {
        nextAction: { type: 'string', maxLength: 255 },
      },
      additionalProperties: false,
    },
    example: '{"nextAction":"Send Elmwood Village listings under $450,000."}',
  },
  send_verified_booking_link: {
    name: 'send_verified_booking_link',
    description:
      'Request the workspace-verified booking link to include in the reply. ' +
      'Takes no arguments. Only valid when the workspace uses verified-link booking.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    example: '{}',
  },
  create_or_update_appointment: {
    name: 'create_or_update_appointment',
    description:
      'Create or update an appointment, only after the lead agreed to one exact ' +
      'time with an explicit UTC offset. "startsAt" and "endsAt" must include an ' +
      'explicit offset (Z or ±HH:MM). "meetingMode" is in_person, phone, or virtual.',
    parameters: {
      type: 'object',
      properties: {
        appointmentId: { type: 'string' },
        startsAt: { type: 'string' },
        endsAt: { type: 'string' },
        meetingMode: { type: 'string', enum: ['in_person', 'phone', 'virtual'] },
        notes: { type: 'string', maxLength: 2000 },
      },
      additionalProperties: false,
    },
    example:
      '{"startsAt":"2026-10-05T14:00:00-04:00","endsAt":"2026-10-05T14:30:00-04:00","meetingMode":"phone"}',
  },
  create_human_handoff: {
    name: 'create_human_handoff',
    description:
      'Escalate the conversation to a human. Provide "reason", "nextAction", and "priority" (normal, high, or urgent).',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', maxLength: 1000 },
        nextAction: { type: 'string', maxLength: 255 },
        priority: { type: 'string', enum: ['normal', 'high', 'urgent'] },
      },
      additionalProperties: false,
    },
    example:
      '{"reason":"Lead requested a human agent.","nextAction":"Call the lead to discuss listings.","priority":"high"}',
  },
  pause_ai_for_lead: {
    name: 'pause_ai_for_lead',
    description:
      'Pause AI automation for this lead. Provide a "reason".',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', maxLength: 1000 },
      },
      additionalProperties: false,
    },
    example: '{"reason":"Lead asked to stop automated messages."}',
  },
  notify_assigned_agent: {
    name: 'notify_assigned_agent',
    description:
      'Notify the assigned agent that this conversation needs attention. Provide a "reason".',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', maxLength: 1000 },
      },
      additionalProperties: false,
    },
    example: '{"reason":"Hot buyer asked for listings in Elmwood Village."}',
  },
};

export const AI_TOOL_CONTRACT_LIST: AiToolContract[] =
  (Object.keys(AI_TOOL_CONTRACTS) as AiToolName[]).map(
    (name) => AI_TOOL_CONTRACTS[name],
  );
