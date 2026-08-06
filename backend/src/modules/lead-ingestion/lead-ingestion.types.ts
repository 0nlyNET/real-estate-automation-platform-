export const LEAD_PROVIDERS = ["zillow", "realtor"] as const;

export type LeadProvider = (typeof LEAD_PROVIDERS)[number];

export interface IncomingLeadPayload {
  provider: LeadProvider;
  tenantId: string;
  providerLeadId: string | null;
  receivedAt: Date;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  emailEligible: boolean;
  smsEligible: boolean;
  message: string | null;
  sourceUrl: string | null;
  propertyAddress: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  propertyPostalCode: string | null;
  rawPayloadReference: string | null;
}

export interface ProviderLeadAdapter {
  readonly provider: LeadProvider;
  normalize(
    payload: Record<string, unknown>,
    tenantId: string,
  ): IncomingLeadPayload;
}

export type LeadIngestionResult = {
  acknowledged: true;
  status: "accepted" | "duplicate" | "rejected_validation";
  eventId: string;
  leadId: string | null;
  validationError: string | null;
};
