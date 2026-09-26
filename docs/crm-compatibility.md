# CRM Compatibility Matrix (P11)

**Date:** 2026-09-26
**Status (all 8 CRMs):** Zapier-dependent generic connectivity — implemented and
tested internally (automated test suites). **A real CRM provider workflow has
not yet been proven end-to-end with any of the 8 CRMs.** Do not represent any
CRM below as "integrated and verified" to a client.
**Decision:** Do NOT build native integrations. The generic `CrmConnector`
interface (`backend/src/modules/crm-integrations/crm-connector.ts`) is the
extension point; `ZapierCrmConnector` is currently the only implementation.

## 1. Platform architecture (what actually exists)

### Inbound (CRM → RealtyTechAI)
- Endpoint: `POST /integrations/zapier/leads` (public, throttled: 120 req/min).
- Auth: per-tenant Bearer credential issued once by
  `POST /integrations/crm/connections/zapier` (admin). Format
  `rtzi_<publicIdentifier>.<secret>` — the platform stores only a hash; the
  secret is shown once at creation/rotation. Rotate:
  `POST /integrations/crm/connections/zapier/:id/rotate`. Revoke: `DELETE .../:id`.
- Headers: `Authorization: Bearer <credential>` (required);
  `X-RealtyTechAI-Event-Id` (optional — if present it must equal the payload's
  `externalEventId`); `X-RealtyTechAI-Test-Run-Id` (optional, controlled tests).
- Body (`ZapierLeadIngressDto`): `externalEventId` (required, unique per lead
  event — **idempotency key per connection**), `externalLeadId`,
  `fullName` or `firstName`+`lastName` (required), `phone` and/or `email`
  (at least one required), `source`, `sourceSystem`, `message`,
  `leadType` (`buyer|seller|renter|investor`), `temperature`
  (`cold|warm|hot`), `property` (`address|city|region|postalCode|listingUrl|url|price`),
  `consent` (`LeadConsentDto`), `metadata`.
- Response: `202` with dedupe on `(connectionId, externalEventId)` — replays are safe.
- Consent posture: fail-closed. Provider-ingested leads sit paused until
  affirmative consent is recorded; pass through whatever consent evidence the
  CRM has — it is informational, not a bypass.

### Outbound (RealtyTechAI → CRM)
- Subscriptions: `POST /integrations/crm/webhooks` with
  `{ "eventType": "<event>", "targetUrl": "https://..." }`. One subscription per
  event type per tenant. The response includes a `signingSecret` (shown once).
- Target allowlist: `hooks.zapier.com` plus `OUTBOUND_WEBHOOK_ALLOWED_HOSTS`;
  HTTPS only, no credentials or custom ports.
- Delivery: `POST` with JSON body and headers
  `X-RealtyTechAI-Event-Id`, `X-RealtyTechAI-Event-Type`,
  `X-RealtyTechAI-Timestamp`, and
  `X-RealtyTechAI-Signature: v1=<hex>` where the signature is
  `HMAC-SHA256(signingSecret, "<timestamp>.<raw_body>")`. Deliveries are
  retried via the durable-jobs pipeline; failures are recorded per subscription.
- Connection test: `POST /integrations/crm/webhooks/:id/test` queues a
  `test.ping` delivery to the Catch Hook URL.

### Supported event types (platform side, all CRMs)
`lead.created`, `lead.updated`, `lead.engaged`, `lead.qualified`,
`lead.status_changed`, `lead.human_handoff`, `appointment.created`,
`appointment.rescheduled`, `appointment.cancelled`, `appointment.reconciled`,
`conversation.summary_ready`, `lead.opted_out`, `test.ping`.

Note: onboarding readiness requires an **active** `appointment.created`
webhook subscription when booking is enabled — this is part of every client's
CRM setup, not optional.

## 2. Compatibility matrix

| CRM | Inbound supported | Outbound supported | Required Zap(s) | Supported events | Setup steps | Real-provider test status | Last verified |
|-----|-------------------|--------------------|-----------------|------------------|-------------|---------------------------|---------------|
| Compass | Yes — generic inbound | Yes — signed webhooks to Catch Hook | 1 inbound + N outbound (one per subscribed event) | All platform events (§1) | §3 (full recipe) | **NOT PROVEN** | 2026-09-26 (internal automated tests only) |
| Follow Up Boss | Yes — generic inbound | Yes — signed webhooks to Catch Hook | 1 inbound + N outbound | All platform events (§1) | §4.1 (generic pattern) | **NOT PROVEN** | 2026-09-26 (internal automated tests only) |
| kvCORE (Inside Real Estate) | Yes — generic inbound | Yes — signed webhooks to Catch Hook | 1 inbound + N outbound | All platform events (§1) | §4.2 (generic pattern) | **NOT PROVEN** | 2026-09-26 (internal automated tests only) |
| BoomTown | Yes — generic inbound | Yes — signed webhooks to Catch Hook | 1 inbound + N outbound | All platform events (§1) | §4.3 (generic pattern) | **NOT PROVEN** | 2026-09-26 (internal automated tests only) |
| Lofty (formerly Chime) | Yes — generic inbound | Yes — signed webhooks to Catch Hook | 1 inbound + N outbound | All platform events (§1) | §4.4 (generic pattern) | **NOT PROVEN** | 2026-09-26 (internal automated tests only) |
| Brivity | Yes — generic inbound | Yes — signed webhooks to Catch Hook | 1 inbound + N outbound | All platform events (§1) | §4.5 (generic pattern) | **NOT PROVEN** | 2026-09-26 (internal automated tests only) |
| HighLevel (GoHighLevel) | Yes — generic inbound | Yes — signed webhooks to Catch Hook | 1 inbound + N outbound | All platform events (§1) | §4.6 (generic pattern) | **NOT PROVEN** | 2026-09-26 (internal automated tests only) |
| HubSpot | Yes — generic inbound | Yes — signed webhooks to Catch Hook | 1 inbound + N outbound | All platform events (§1) | §4.7 (generic pattern) | **NOT PROVEN** | 2026-09-26 (internal automated tests only) |

Minimum viable per client: **1 inbound Zap + 1 outbound Zap for
`appointment.created`** (readiness requirement when booking is enabled).
Recommended: add `lead.status_changed` and `lead.qualified` outbound Zaps so
the CRM reflects AI qualification and status movement.

## 3. Compass — full recipe

### 3.1 Inbound: Compass new lead → RealtyTechAI
1. In the tenant's admin: `POST /integrations/crm/connections/zapier`
   `{ "label": "Compass inbound" }` → copy the `credential` (shown once).
2. In Zapier, create a Zap:
   - **Trigger:** Compass app → "New Lead" (connect the agent's Compass
     account; use the instant trigger where offered, otherwise polling).
   - **Action:** Webhooks by Zapier → **POST**.
     - URL: `https://<api-base>/integrations/zapier/leads`
     - Headers: `Authorization: Bearer <rtzi_credential from step 1>`,
       `Content-Type: application/json`.
     - Data (map from the Compass trigger fields):
       - `externalEventId`: the Compass lead/record ID (stable per lead;
         guarantees idempotent replays)
       - `externalLeadId`: the Compass lead ID
       - `fullName` (or `firstName` + `lastName`)
       - `phone`, `email` (at least one required)
       - `source`: `"Compass"`, `sourceSystem`: `"compass"`
       - `leadType`, `temperature` (if the trigger provides them)
       - `property`: `address`, `city`, `listingUrl` as available
       - `consent`: whatever opt-in evidence Compass holds (informational)
3. Test the Zap step, then publish ("On").

### 3.2 Outbound: RealtyTechAI events → Compass
Per event (start with `appointment.created`):
1. In Zapier, create a Zap:
   - **Trigger:** Webhooks by Zapier → **Catch Hook** → copy the hook URL.
     (Child-key/hook per Zap; keep one Zap per event type for clarity, or one
     Zap with multiple subscriptions sharing a hook URL and a Zapier Paths step
     on the `X-RealtyTechAI-Event-Type` header.)
   - Optional hardening — **Code by Zapier** step: recompute
     `v1 = HMAC-SHA256(signingSecret, timestamp + "." + raw_body)` and halt the
     Zap unless it equals the `X-RealtyTechAI-Signature` header. (Catch Hook
     URLs are unguessable; treat the signature check as defense-in-depth.)
   - **Action:** Compass app → "Create a New Lead" (or the update/contact
     variant) → map fields from the webhook payload: First Name, Last Name,
     Email Address, Phone Number, Tags (include the event type, e.g.
     `realtytechai:appointment.created`), notes/message.
2. In the tenant's admin: `POST /integrations/crm/webhooks`
   `{ "eventType": "appointment.created", "targetUrl": "<catch-hook-url>" }`
   → store the returned `signingSecret` with the Zap (needed only if you added
   the signature-check step).
3. Test: `POST /integrations/crm/webhooks/:id/test` → confirm `test.ping`
   arrives in the Zap's run history and the Compass action succeeds.
4. Repeat for `lead.status_changed`, `lead.qualified`, and any other events the
   client wants mirrored.

## 4. Other CRMs — same generic pattern

Every CRM below uses the §3 pattern with only the Zapier app and its
trigger/action names swapped. Inbound is always: **CRM trigger →
Webhooks-by-Zapier POST → `/integrations/zapier/leads`** with the
`rtzi_` credential. Outbound is always: **Catch Hook → (optional signature
check) → CRM create/update action**, with one RealtyTechAI webhook
subscription per event type.

### 4.1 Follow Up Boss
- Trigger: Follow Up Boss app → "New Lead" (or "Updated Lead" if the client
  wants updates mirrored inbound).
- Outbound action: "Create Contact" (without triggering action plans unless the
  client explicitly wants them).
- Notes: map the RealtyTechAI `externalLeadId` into the FUB contact so the two
  systems can be reconciled later.

### 4.2 kvCORE (Inside Real Estate)
- Trigger: kvCORE app → new contact/lead trigger.
- Outbound action: create/update contact.
- Notes: kvCORE deduplicates aggressively on email — make sure the inbound Zap
  always sends the email when the CRM has it.

### 4.3 BoomTown
- Trigger: BoomTown app → new lead trigger.
- Outbound action: add/update lead.

### 4.4 Lofty (formerly Chime)
- Trigger: Lofty app → new lead trigger.
- Outbound action: create/update contact.

### 4.5 Brivity
- Trigger: Brivity app → "New Lead" (instant trigger available).
- Outbound action: create contact.

### 4.6 HighLevel (GoHighLevel)
- Trigger: HighLevel/LeadConnector app → "New Contact".
- Outbound action: create/update contact; tags recommended
  (`realtytechai:<event-type>`).
- Notes: HighLevel can also be the client's calendar provider in RealtyTechAI;
  CRM sync still goes through this Zapier pattern — do not conflate the two.

### 4.7 HubSpot
- Trigger: HubSpot app → "New Contact".
- Outbound action: create/update contact (associate to company when the client
  uses company records).

### Per-CRM caveats (apply to all)
- Polling-based CRM triggers on free/low-tier Zapier plans can lag 1–15 min;
  prefer instant triggers where the CRM app offers them.
- Inbound `externalEventId` must be the CRM's stable record ID — never a
  timestamp — or replays will create duplicates despite server-side idempotency.
- Do not fan one tenant's credential across clients: one Zapier connection
  (credential) per tenant, always.

## 5. Operator runbook (repeatable per-client setup)

Goal: per-client CRM setup in ~15 minutes of operator time, most of it
copy-paste.

### 5.1 One-time: golden templates
1. On the RealtyTechAI Zapier template account, build one golden pair per CRM:
   `"<CRM> — inbound lead → RealtyTechAI (TEMPLATE)"` and
   `"<CRM> — RealtyTechAI events → <CRM> (TEMPLATE)"`.
2. Leave the credential header and hook URL as clearly-marked placeholders
   (`PASTE_RTZI_CREDENTIAL`, `PASTE_CATCH_HOOK_URL`).
3. Keep templates published-off; document the template Zap share links in the
   internal ops notes (not in client-facing docs).

### 5.2 Per client: clone procedure
1. Create the tenant's Zapier connection:
   `POST /integrations/crm/connections/zapier` `{ "label": "<Client> <CRM> inbound" }`
   → copy credential (once).
2. Duplicate the golden inbound Zap → rename `<Client> — <CRM> inbound` →
   reconnect the CRM auth step to the **client's** CRM login → paste the
   tenant credential into the POST headers → turn on.
3. Duplicate the golden outbound Zap → rename `<Client> — <CRM> events` →
   create the Catch Hook trigger → copy the hook URL.
4. Create the webhook subscription(s):
   `POST /integrations/crm/webhooks` per event type
   (`appointment.created` minimum when booking is enabled) → store each
   returned `signingSecret` alongside the Zap if signature-check steps are used.
5. Run the connection tests (§5.4), then record the mapping
   (connection id ↔ Zap ids) in the client's onboarding ops notes.

### 5.3 Pre-flight checklist
- [ ] Tenant identity (email/SMS) provisioned and verified.
- [ ] `contacts.controlledTestEmail` (or `accountOwner`) set — used by the
  inbound connection test.
- [ ] A controlled test run is active (`testing.start`) — required by
  `POST /integrations/crm/connections/zapier/:id/test`.
- [ ] Client's CRM login available for the Zap auth step (client or Jayden).
- [ ] Outbound target URL is `https://hooks.zapier.com/...` (allowlisted).

### 5.4 Connection-test procedure (existing endpoints only)
1. **Inbound:** `POST /integrations/crm/connections/zapier/:id/test` — ingests
   a controlled test lead through the tenant's connection. Confirm the lead
   appears in the client workspace with `source: 'controlled_zapier_test'`.
   (Requires a running test run; no real CRM data involved.)
2. **Outbound:** `POST /integrations/crm/webhooks/:id/test` — queues a
   `test.ping` delivery. Confirm it arrives in the Zap's run history and the
   delivery shows success on the subscription.
3. **Real-shape test (in UAT):** trigger a real CRM lead through the inbound
   Zap during the controlled test window and verify the full
   intake → conversation → (appointment) → outbound-event loop, including the
   CRM-side record the outbound Zap creates/updates.
4. **Rotate/revoke:** after testing with any shared or temporary credential,
   `POST .../rotate` and update the Zap headers; revoke test-only connections.

### 5.5 Ongoing
- Webhook subscription health (`last_success_at`, `failure_count`,
  `last_error`) is visible per subscription; a failing subscription pages via
  the existing operations tasks — treat repeated failures as an owner
  exception, not silent decay.
- Never reuse one tenant's credential or hook URL for another tenant.
- When a CRM changes its Zapier app (renamed triggers/actions), update the
  golden template once — all future clients inherit the fix.

## 6. Verification log

| Date | Scope | Result |
|------|-------|--------|
| 2026-09-26 | Internal automated tests: inbound DTO validation/idempotency, outbound signing + allowlist, connection lifecycle | Pass (repo test suites) |
| — | Real provider workflow (any of the 8 CRMs, live Zap) | **NOT PROVEN** — first real-client CRM setup must be treated as a pilot and verified with §5.4 before launch |

## 7. Explicit non-goals

- No native CRM integrations are built or planned in this change; the
  `CrmConnector` interface remains the extension point if a native adapter is
  ever justified.
- No per-CRM field-mapping code lives in the platform — mapping is configured
  in Zapier, per client, from the templates.
