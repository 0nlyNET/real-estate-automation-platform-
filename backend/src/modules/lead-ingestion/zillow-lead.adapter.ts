import { Injectable } from "@nestjs/common";
import {
  firstText,
  nestedRecord,
  normalizeEmailAddress,
  normalizePhoneNumber,
  parseProviderDate,
} from "./provider-payload";
import {
  IncomingLeadPayload,
  ProviderLeadAdapter,
} from "./lead-ingestion.types";

@Injectable()
export class ZillowLeadAdapter implements ProviderLeadAdapter {
  readonly provider = "zillow" as const;

  normalize(
    payload: Record<string, unknown>,
    tenantId: string,
  ): IncomingLeadPayload {
    const lead = nestedRecord(payload, "lead", "contact", "consumer");
    const property = nestedRecord(
      Object.keys(lead).length ? lead : payload,
      "property",
      "listing",
    );
    const root = Object.keys(lead).length ? lead : payload;
    const firstName = firstText(
      root.firstName,
      root.first_name,
      payload.firstName,
      payload.first_name,
    );
    const lastName = firstText(
      root.lastName,
      root.last_name,
      payload.lastName,
      payload.last_name,
    );
    const email = normalizeEmailAddress(
      firstText(
        root.email,
        root.emailAddress,
        root.email_address,
        payload.email,
      ),
    );
    const phone = normalizePhoneNumber(
      firstText(
        root.phone,
        root.phoneNumber,
        root.phone_number,
        root.mobile,
        payload.phone,
      ),
    );

    return {
      provider: this.provider,
      tenantId,
      providerLeadId: firstText(
        payload.providerLeadId,
        payload.leadId,
        payload.lead_id,
        payload.eventId,
        payload.event_id,
        root.id,
      ),
      receivedAt: parseProviderDate(
        firstText(
          payload.receivedAt,
          payload.createdAt,
          payload.created_at,
          payload.timestamp,
        ),
      ),
      firstName,
      lastName,
      fullName: firstText(
        root.fullName,
        root.full_name,
        root.name,
        [firstName, lastName].filter(Boolean).join(" "),
      ),
      email,
      phone,
      emailEligible: email !== null,
      smsEligible: phone !== null,
      message: firstText(
        root.message,
        root.comments,
        root.inquiry,
        payload.message,
        payload.comments,
      ),
      sourceUrl: firstText(
        payload.sourceUrl,
        payload.source_url,
        property.url,
        property.listingUrl,
      ),
      propertyAddress: firstText(
        property.address,
        property.streetAddress,
        property.street_address,
      ),
      propertyCity: firstText(property.city),
      propertyState: firstText(property.state, property.region),
      propertyPostalCode: firstText(
        property.postalCode,
        property.postal_code,
        property.zip,
      ),
      rawPayloadReference: null,
    };
  }
}
