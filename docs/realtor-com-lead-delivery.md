# Realtor.com Lead Delivery setup

RealtyTechAI now includes a tenant-isolated Realtor.com lead receiver. This does not require the RealtyTechAI owner to pretend to be an agent. The customer who owns the eligible Realtor.com PRO account performs the final connection test.

## RealtyTechAI owner/admin flow

1. Sign in to the customer's RealtyTechAI workspace as an owner or admin.
2. Call `POST /integrations/realtor-com/rotate-key`.
3. Copy the returned values immediately:
   - `endpointUrl`
   - `loginName`
   - `apiKey`
4. Provide those values to the customer for entry in Realtor.com PRO.

The API key is shown only in the rotate response. `GET /integrations/realtor-com` returns status and the final four key characters, but never returns the secret.

## Customer flow in Realtor.com PRO

The customer must have an eligible Realtor.com lead product and access to Lead Settings.

1. Open Realtor.com PRO lead settings.
2. Add a Lead Delivery API destination.
3. Choose the independent or other-application option offered by Realtor.com.
4. Enter the RealtyTechAI endpoint URL, login name, and API key.
5. Run Realtor.com's connection test.
6. Save the destination only after the test succeeds.
7. Keep Realtor.com's email lead delivery enabled as a backup until API delivery has been verified in production.

Realtor.com's labels and authentication fields can change. Compare the current Lead Delivery API Implementation Guide with the supported authentication methods before the first paying-client launch.

## Receiver behavior

Endpoint:

```text
POST /webhooks/realtor-com/:tenantId
```

Supported API-key delivery methods:

- `x-api-key` header
- `x-realtor-api-key` header
- `Authorization: Bearer <key>`
- HTTP Basic password
- request-body fields `apiKey`, `api_key`, `password`, or `applicationKey`

Connection-test payloads are accepted when the request contains `test: true`, `isTest: true`, or an event/type value of `test`, `ping`, `connection_test`, or `verify`.

Lead payload normalization supports common nested and flat names for:

- full name or first/last name
- email
- phone
- message/comments
- property/listing address
- MLS number, property ID, or listing URL
- buyer, seller, renter, or investor lead type

Accepted leads use the existing `LeadsService.intake` path, which preserves tenant isolation, duplicate checking, routing, notifications, instant-response queuing, and sequence enrollment.

## Production environment

Set one of the following to the exact public backend origin so RealtyTechAI can return a complete endpoint URL:

```text
PUBLIC_API_URL=https://your-production-api.example.com
```

or

```text
BACKEND_URL=https://your-production-api.example.com
```

`INTEGRATIONS_ENCRYPTION_KEY` must already be configured as a valid 32-byte base64 or hexadecimal key. Realtor.com API credentials are encrypted at rest with that key.

## Required launch validation

Before marking Realtor.com production-ready:

1. Obtain the current Realtor.com Lead Delivery API Implementation Guide from an eligible customer account.
2. Compare its exact payload and authentication contract with the receiver.
3. Run Realtor.com's connection test.
4. Send one real test lead and confirm it appears in the correct RealtyTechAI workspace.
5. Confirm a duplicate email-delivered copy does not create a second lead.
6. Confirm lead notifications and approved follow-up automation behave as expected.
