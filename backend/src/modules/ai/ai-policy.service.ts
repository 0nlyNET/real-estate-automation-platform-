import { Injectable } from '@nestjs/common';
import { isSafeBookingUrl } from '../../common/booking-link';
import { AiPolicyEscalation, AiProviderOutput } from './ai.types';
import { BrokerageKnowledge } from './brokerage-knowledge.entity';
import { WorkspaceAiSettings } from './workspace-ai-settings.entity';

type ResponseValidationInput = {
  output: AiProviderOutput;
  settings: WorkspaceAiSettings;
  knowledge: BrokerageKnowledge;
  identityLabel: string;
  firstAiResponse: boolean;
  channel: 'sms' | 'email';
  verifiedBookingLink?: string | null;
};

const ESCALATION_PATTERNS: Array<{
  code: string;
  pattern: RegExp;
  reason: string;
  priority: AiPolicyEscalation['priority'];
}> = [
  {
    code: 'HUMAN_REQUESTED',
    pattern:
      /\b(human|person|real person|agent|broker|manager|supervisor|attorney|lawyer|lender|loan officer)\b/i,
    reason: 'The lead asked to speak with a person or licensed professional.',
    priority: 'high',
  },
  {
    code: 'BINDING_DECISION',
    pattern:
      /\b(submit (?:an )?offer|ready to sign|sign today|list my (?:home|house|property)|accept the offer|make it official)\b/i,
    reason: 'The lead appears ready to make a binding real-estate decision.',
    priority: 'urgent',
  },
  {
    code: 'LEGAL_OR_CONTRACT',
    pattern:
      /\b(contract|agreement|offer|counteroffer|negotiate|negotiation|commission|disclosure|lawsuit|legal advice|binding|sign(?:ing)?|attorney)\b/i,
    reason: 'The conversation involves a contract, offer, negotiation, disclosure, or legal matter.',
    priority: 'urgent',
  },
  {
    code: 'LENDING_OR_TAX',
    pattern:
      /\b(mortgage qualification|qualify for|loan decision|interest rate|apr|down payment assistance|tax advice|tax deduction|financing approval|preapprove me)\b/i,
    reason: 'The conversation requests lending, mortgage-qualification, or tax guidance.',
    priority: 'high',
  },
  {
    code: 'FAIR_HOUSING',
    pattern:
      /\b(safe neighborhood|good neighborhood|bad neighborhood|crime rate|racial|race|religion|churches|mosque|synagogue|ethnic|family neighborhood|families with children|school district ranking|disabled people|gay|straight|nationality|protected class)\b/i,
    reason: 'The request may involve fair-housing or protected-class considerations.',
    priority: 'urgent',
  },
  {
    code: 'SAFETY_OR_EMERGENCY',
    pattern:
      /\b(emergency|unsafe|threat|threaten|violence|hurt myself|suicide|weapon|fire|police|911)\b/i,
    reason: 'The message raises a safety, threat, or emergency concern.',
    priority: 'urgent',
  },
  {
    code: 'DISTRESS_OR_COMPLAINT',
    pattern:
      /\b(furious|angry|upset|complaint|scam|fraud|discriminat|harass|stop wasting|this is ridiculous|report you)\b/i,
    reason: 'The lead appears distressed, angry, or dissatisfied.',
    priority: 'high',
  },
  {
    code: 'PROMPT_INJECTION',
    pattern:
      /\b(ignore (?:all |the )?(?:previous|prior|system) instructions|show (?:me )?(?:your|the) (?:system )?prompt|reveal (?:your|the) instructions|developer message|tool definitions|run sql|database password|api key|access another tenant)\b/i,
    reason: 'The message attempted to change system rules or access unauthorized information.',
    priority: 'high',
  },
];

const PROHIBITED_RESPONSE_PATTERNS = [
  /\b(guarantee|guaranteed|definitely qualify|you qualify|legal advice|tax advice)\b/i,
  /\b(the property|this home|this listing)\s+is\s+(?:still\s+)?available\b/i,
  /\b(ignore|bypass)\s+(?:consent|quiet hours|policy|permissions)\b/i,
  /\b(protected class|racial preference|religious preference)\b/i,
];

@Injectable()
export class AiPolicyService {
  classifyInbound(text: string): AiPolicyEscalation | null {
    const clean = String(text || '').trim();
    for (const rule of ESCALATION_PATTERNS) {
      if (rule.pattern.test(clean)) {
        return {
          code: rule.code,
          reason: rule.reason,
          priority: rule.priority,
        };
      }
    }
    return null;
  }

  ensureIdentityDisclosure(reply: string, identityLabel: string, firstAiResponse: boolean) {
    const clean = String(reply || '').trim();
    if (!firstAiResponse) return clean;
    const identity = String(identityLabel || '').trim();
    if (!identity) return clean;
    if (clean.toLowerCase().includes(identity.toLowerCase())) return clean;
    return `Hi, this is ${identity}. ${clean}`.trim();
  }

  ensureRequiredDisclaimer(reply: string, requiredDisclaimer?: string | null) {
    const clean = String(reply || '').trim();
    const disclaimer = String(requiredDisclaimer || '').trim();
    if (!clean || !disclaimer) return clean;
    if (clean.toLowerCase().includes(disclaimer.toLowerCase())) return clean;
    return `${clean}\n\n${disclaimer}`;
  }

  validateResponse(input: ResponseValidationInput) {
    const { output, settings, knowledge } = input;
    if (output.classification === 'handoff' || output.escalationReason) {
      return {
        allowed: false,
        code: 'MODEL_REQUESTED_HANDOFF',
        reason:
          output.escalationReason ||
          'The AI determined that a human should handle this conversation.',
      };
    }
    if (output.confidence < settings.minimumConfidenceThreshold) {
      return {
        allowed: false,
        code: 'LOW_CONFIDENCE',
        reason: 'The AI response did not meet the workspace confidence threshold.',
      };
    }
    if (output.classification === 'no_reply' || !String(output.reply || '').trim()) {
      return {
        allowed: true,
        noReply: true,
        code: null,
        reason: null,
      };
    }

    const reply = String(output.reply || '').trim();
    const limit = input.channel === 'sms' ? 1_200 : 5_000;
    if (reply.length > limit) {
      return {
        allowed: false,
        code: 'MESSAGE_TOO_LONG',
        reason: 'The proposed response exceeds the channel length limit.',
      };
    }
    if (
      input.firstAiResponse &&
      !reply.toLowerCase().includes(input.identityLabel.trim().toLowerCase())
    ) {
      return {
        allowed: false,
        code: 'MISSING_AI_DISCLOSURE',
        reason: 'The first AI response does not disclose the approved assistant identity.',
      };
    }
    const requiredDisclaimer = String(knowledge.requiredDisclaimer || '').trim();
    if (
      requiredDisclaimer &&
      !reply.toLowerCase().includes(requiredDisclaimer.toLowerCase())
    ) {
      return {
        allowed: false,
        code: 'MISSING_REQUIRED_DISCLAIMER',
        reason: 'The proposed response omits the approved required disclaimer.',
      };
    }
    for (const pattern of PROHIBITED_RESPONSE_PATTERNS) {
      if (pattern.test(reply)) {
        return {
          allowed: false,
          code: 'PROHIBITED_CONTENT',
          reason: 'The proposed response contains restricted or unverifiable content.',
        };
      }
    }
    const urls: string[] = Array.from(
      reply.match(/https?:\/\/[^\s)]+/gi) || [],
    );
    const allowedUrls = new Set(
      [input.verifiedBookingLink]
        .filter((value): value is string => Boolean(value && isSafeBookingUrl(value)))
        .map((value) => value.replace(/[.,]+$/, '')),
    );
    if (urls.some((url) => !allowedUrls.has(url.replace(/[.,]+$/, '')))) {
      return {
        allowed: false,
        code: 'UNVERIFIED_URL',
        reason: 'The proposed response contains a URL that is not approved.',
      };
    }
    const customProhibited = knowledge.prohibitedTopics || [];
    if (
      customProhibited.some((topic) =>
        topic.trim()
          ? reply.toLowerCase().includes(topic.trim().toLowerCase())
          : false,
      )
    ) {
      return {
        allowed: false,
        code: 'WORKSPACE_PROHIBITED_TOPIC',
        reason: 'The proposed response includes a workspace-prohibited topic.',
      };
    }
    return { allowed: true, noReply: false, code: null, reason: null };
  }
}
