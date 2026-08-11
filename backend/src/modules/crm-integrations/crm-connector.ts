import { BadRequestException } from '@nestjs/common';
import { ZapierLeadIngressDto } from './crm-integrations.dto';

export type NormalizedCrmLead = {
  fullName: string;
  phone?: string;
  email?: string;
  source: string;
  message?: string;
  location?: string;
  propertyInterest?: string;
  leadType?: string;
  temperature?: string;
  consent?: unknown;
  ingestionProvider: string;
  sourceSystem: string;
  originalSource: string | null;
  externalLeadId: string | null;
};

/** Boundary implemented by Zapier now and reusable by future native CRM adapters. */
export interface CrmConnector<Input> {
  readonly provider: string;
  readonly capabilities: Readonly<{
    leadIngress: boolean;
    outboundWebhooks: boolean;
  }>;
  normalizeInboundLead(input: Input): NormalizedCrmLead;
}
export class ZapierCrmConnector implements CrmConnector<ZapierLeadIngressDto> {
  readonly provider = 'zapier';
  readonly capabilities = { leadIngress: true, outboundWebhooks: true } as const;

  normalizeInboundLead(input: ZapierLeadIngressDto): NormalizedCrmLead {
    const fullName = [input.firstName, input.lastName]
      .filter(Boolean)
      .join(' ')
      .trim() || String(input.fullName || '').trim();
    if (!fullName) throw new BadRequestException('A lead name is required');
    if (!input.phone && !input.email) {
      throw new BadRequestException('A phone number or email address is required');
    }
    return {
      fullName,
      phone: input.phone,
      email: input.email,
      source: input.source || 'Zapier',
      message: input.message,
      location: input.property?.city,
      propertyInterest:
        input.property?.address || input.property?.listingUrl || input.property?.url,
      leadType: input.leadType,
      temperature: input.temperature,
      consent: input.consent,
      ingestionProvider: this.provider,
      sourceSystem: input.sourceSystem || this.provider,
      originalSource: input.source || null,
      externalLeadId: input.externalLeadId || null,
    };
  }
}
