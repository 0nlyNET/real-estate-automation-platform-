# Managed autopilot production UAT evidence

Run this checklist in an isolated production-like environment before the first controlled paying client. Record real references; do not mark an external check passed from a mocked test.

## Release identity

- Commit:
- Environment:
- Tester and date:
- Isolated test tenant:
- Controlled SMS recipient:
- Controlled email recipient:

## Platform evidence

- [ ] Admin setup checker has no unexplained action-required items.
- [ ] `/health/live` returns success from outside the hosting provider.
- [ ] `/health/ready` reports database, schema, migrations, credential storage, and durable workers up.
- [ ] Platform usage/cost policy is enabled.
- [ ] Tenant usage/cost policy is enabled.
- [ ] Recent isolated backup restore meets RPO ≤ 1 hour and RTO ≤ 4 hours.
- [ ] Restored leads and messages were verified.
- [ ] Legal-review evidence is current.

## Invitation and billing

- [ ] Convert one application once; a second conversion returns the existing tenant rather than creating another.
- [ ] Invitation reaches the intended owner without a temporary password.
- [ ] Wrong, expired, used, and revoked tokens fail.
- [ ] Client chooses a password and signs in.
- [ ] Live Stripe Checkout completes.
- [ ] Signed webhook records the subscription and billing readiness.
- [ ] Replayed Stripe event is idempotent.

## Managed providers

- [ ] Tenant Twilio subaccount, API key, Messaging Service, and number are isolated and persisted.
- [ ] A2P request fields match the captured official request-shape test.
- [ ] Real Twilio profile, Trust Product, brand, and campaign status are reconciled.
- [ ] Rejection creates an actionable incident and keeps SMS blocked.
- [ ] Corrected data can use the guarded resubmission path; unchanged data cannot.
- [ ] Tenant SendGrid identity uses the managed parent credential and authenticated domain.
- [ ] System invitation/reset email uses the platform parent credential.
- [ ] SPF, DKIM, DMARC, inbound parse, and event webhook are externally verified.

## Zapier and CRM

- [ ] Create Tenant A and Tenant B credentials; each resolves only its own tenant.
- [ ] Invalid and revoked credentials fail.
- [ ] Payload containing `tenantId` fails strict validation.
- [ ] Same event ID creates one lead.
- [ ] `ingestionProvider`, `sourceSystem`, and `originalSource` remain distinct.
- [ ] TESTING rejects a live event and accepts only the current controlled run.
- [ ] SUSPENDED rejects all live events.
- [ ] ACTIVE accepts the real lead.
- [ ] Outbound event arrives with a valid HMAC and stable event ID.
- [ ] Temporary hook failure retries from PostgreSQL; exhaustion creates an incident.

## Controlled lead journey

- [ ] Start Test Run 1 and submit the controlled lead.
- [ ] Real test SMS/email enters the normal persisted worker and reaches only approved recipients.
- [ ] Delivery callbacks, inbound SMS, inbound email, STOP, AI conversation, handoff, takeover, resume, and notification are verified.
- [ ] Repeat with Test Run 2 using the same phone/email; it creates isolated test data without colliding with live deduplication.
- [ ] Each test lead and every test-evidence item remains bound to its own `testRunId`; actual provider usage is still accounted for.

## Team routing and reporting

- [ ] Fixed assignment rejects a disabled or cross-tenant user.
- [ ] Team round robin rotates active agents deterministically.
- [ ] An agent from another team/tenant is never selected.
- [ ] Agent access is tenant-scoped; normal agents cannot open platform-admin endpoints.
- [ ] Team reporting filters by team, agent, source, and date and reconciles leads, replies, qualification, appointments, response time, handoffs, and closes.

## AI safety and recovery

- [ ] Eligible ACTIVE lead receives an automatic first response.
- [ ] ONBOARDING/TESTING live lead, unpaid billing, STOP/unsubscribe, quiet hours, hard usage limit, provider pause, and human ownership block external AI sending.
- [ ] Prompt injection, fake system text, secret extraction, cross-tenant request, non-allowlisted tool, malformed output, and timeout fail safely.
- [ ] Take Over after an AI message is queued cancels it before provider delivery.
- [ ] Resume AI reloads human messages and does not bypass unresolved handoff policy.
- [ ] Client AI reads only its tenant and can queue only the bounded setup reconciliation automatically.
- [ ] Client configuration mutations require the same tenant administrator’s confirmation.
- [ ] Operations AI diagnoses an incident, requires platform-admin confirmation, retries a failed durable job, verifies recovery, and resolves the incident.
- [ ] A running/nonfailed job and every destructive/sensitive request are refused.
- [ ] Assistant run shows provider/model, usage, cost, latency, actions, and audit evidence without retaining prompt text.

## Activation evidence

- [ ] `profileReady`, `billingReady`, managed Twilio readiness, messaging compliance, managed email readiness, lead-source readiness, tests, usage limits, and tenant safety all pass.
- [ ] Optional final owner approval is recorded if enabled.
- [ ] Tenant transitions to `ACTIVE` and only then enables live lead intake/automation.
- [ ] A full real lead reaches assignment, guarded AI response, reply handling, qualification, appointment or handoff, agent notification, and optional signed CRM update.

## External references

- Twilio approval/reference:
- Carrier delivery references:
- SendGrid DNS/delivery references:
- Stripe live event/payment reference:
- Backup restore evidence location:
- External monitor URL:
- Counsel review evidence location:
- Final approver/date:
