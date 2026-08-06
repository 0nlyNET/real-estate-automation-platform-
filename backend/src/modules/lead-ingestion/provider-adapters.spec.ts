import { parseProviderPayload } from "./provider-payload";
import { RealtorLeadAdapter } from "./realtor-lead.adapter";
import { ZillowLeadAdapter } from "./zillow-lead.adapter";

describe("provider lead adapters", () => {
  const tenantId = "11111111-1111-4111-8111-111111111111";

  it("normalizes a Zillow JSON payload with an eligible email and no phone", () => {
    const result = new ZillowLeadAdapter().normalize(
      {
        providerLeadId: "zillow-1",
        receivedAt: "2026-08-06T08:00:00.000Z",
        lead: {
          firstName: "  Jordan ",
          lastName: "Buyer",
          email: " JORDAN@EXAMPLE.COM ",
          property: {
            address: "1 Main Street",
            city: "Albany",
            state: "NY",
            zip: "12207",
          },
        },
      },
      tenantId,
    );

    expect(result).toMatchObject({
      provider: "zillow",
      tenantId,
      providerLeadId: "zillow-1",
      fullName: "Jordan Buyer",
      email: "jordan@example.com",
      phone: null,
      emailEligible: true,
      smsEligible: false,
      propertyAddress: "1 Main Street",
    });
  });

  it("parses a form-encoded Realtor.com payload with an eligible E.164 phone", () => {
    const payload = parseProviderPayload(
      "provider=realtor&lead_id=realtor-1&first_name=Casey&last_name=Seller&phone=%2B14155550101",
    );
    const result = new RealtorLeadAdapter().normalize(payload, tenantId);

    expect(result).toMatchObject({
      provider: "realtor",
      providerLeadId: "realtor-1",
      fullName: "Casey Seller",
      email: null,
      phone: "+14155550101",
      emailEligible: false,
      smsEligible: true,
    });
  });

  it("unwraps raw JSON strings without executing arbitrary content", () => {
    expect(
      parseProviderPayload(
        JSON.stringify({ provider: "zillow", lead: { id: "zillow-2" } }),
      ),
    ).toEqual({ provider: "zillow", lead: { id: "zillow-2" } });
    expect(() => parseProviderPayload("not-json-or-form")).toThrow(
      "not a supported form payload",
    );
  });

  it("marks invalid email and phone values as independently ineligible", () => {
    const result = new RealtorLeadAdapter().normalize(
      {
        providerLeadId: "realtor-invalid",
        email: "not-an-email",
        phone: "123",
      },
      tenantId,
    );

    expect(result).toMatchObject({
      email: null,
      phone: null,
      emailEligible: false,
      smsEligible: false,
    });
  });
});
