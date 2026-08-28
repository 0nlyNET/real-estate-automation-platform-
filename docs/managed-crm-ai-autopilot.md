# Managed CRM and AI autopilot operations

This document describes the implemented production path. Provider approval, DNS propagation, live carrier delivery, payment settlement, backup restoration, and legal review remain external evidence—not code-generated facts.

## Operating boundary

RealtyTechAI uses one platform configuration and isolates each client below it:

- Twilio: platform parent credential → tenant subaccount → tenant Messaging Service → tenant number → tenant A2P graph.
- SendGrid: platform parent credential and authenticated domains → unique tenant sender/reply identity. The internal model leaves room for tenant subusers without changing callers.
- CRM: tenant-owned hashed connection credential → generic lead ingress → existing lead engine.
- AI: three separate permission sets for lead conversations, tenant assistance, and platform operations.
- Data: every request, durable job, integration event, assistant run, and delivery is tenant-scoped where applicable.

Normal clients never receive Twilio, SendGrid, Stripe, OpenAI, or database credentials.

## One-time platform setup

Use the Admin “Production setup checker.” An item marked **Action required** is an honest pre-launch dependency; it does not prevent the application from booting while the platform is still being configured.

| Area | One-time evidence |
| --- | --- |
| Twilio | Reachable parent account, public inbound/status URLs, approved primary Trust Hub profile, current secondary-profile policy SID, current A2P Trust Product policy SID |
| SendGrid | Reachable parent account, system From identity, sending/reply domains, SPF/DKIM/DMARC evidence, authenticated inbound parse and event-webhook endpoints |
| OpenAI | Server-only key, pinned model, controlled structured-output test |
| Zapier | Public API URL, credential encryption, outbound host allowlist |
| Stripe | Live secret, signed webhook secret, monthly and setup price IDs |
| Database | Reachable database, synchronization disabled, no pending migrations |
| Recovery | Recent isolated restore, RPO ≤ 60 minutes, RTO ≤ 240 minutes, retention, protected restore credentials |
| Monitoring/legal | External checks for `/health/live` and `/health/ready`; current qualified-counsel review evidence |

The three Twilio policy/profile SIDs are needed when RealtyTechAI actually submits a tenant registration. They are not fabricated, and missing values remain a visible setup blocker until Twilio makes them available.

## Client creation and invitation

Application conversion creates an inactive tenant and a pending owner account in one transaction. It sends a single-use, expiring invitation. The client chooses a password; no temporary password is emailed or displayed. Resending revokes the prior invitation, and acceptance verifies the intended user and tenant before setting the password.

## Managed Twilio compliance

The compliance reconciler creates or resumes the official resource graph:

1. Secondary Customer Profile.
2. Legal-business and authorized-representative EndUsers.
3. Account Address and address SupportingDocument.
4. Entity assignments, policy evaluation, and profile submission.
5. A2P Trust Product, messaging-profile EndUser, assignments, evaluation, and submission.
6. Brand Registration.
7. Messaging Service campaign with two samples, message flow, opt-in/out/help data, privacy URL, terms URL, and Twilio API version header.
8. Status polling until approved, rejected, or an actionable exception occurs.

Created SIDs are persisted after each provider step so retries resume rather than duplicate resources. Rejection creates an owner incident and leaves SMS blocked. After the client corrects onboarding data, a platform administrator may call:

```text
POST /admin/tenants/{tenantId}/provisioning/twilio-compliance/resubmit
```

Resubmission is rejected unless the prior registration is blocked/rejected and the normalized compliance input changed. It then creates a versioned replacement graph and returns to durable reconciliation. Approval remains solely Twilio’s decision.

Current provider references:

- [Twilio A2P ISV onboarding](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv-api)
- [Twilio Secondary Customer Profiles](https://www.twilio.com/docs/trust-hub/trusthub-rest-api/api-create-secondary-customer-profile)
- [Twilio US A2P campaign resource](https://www.twilio.com/docs/messaging/api/usapptoperson-resource)

## Zapier inbound connection

An owner or tenant admin creates a Zapier connection in **Connections**. RealtyTechAI shows the credential once and retains only its SHA-256 digest and last four characters. Rotation invalidates the old secret immediately; revocation is permanent.

Configure a Zapier Webhooks action as follows:

```text
POST {PUBLIC_API_URL}/integrations/zapier/leads
Authorization: Bearer rtzi_{publicIdentifier}.{secret}
Content-Type: application/json
X-RealtyTechAI-Event-Id: {stable source event ID}
```

Example body:

```json
{
  "externalEventId": "kw-command-event-4815",
  "externalLeadId": "kw-lead-9271",
  "firstName": "Jordan",
  "lastName": "Buyer",
  "phone": "+15125550123",
  "email": "jordan@example.com",
  "sourceSystem": "kw_command",
  "source": "facebook",
  "message": "Interested in 1 Main Street",
  "leadType": "buyer",
  "property": {
    "address": "1 Main Street",
    "city": "Austin",
    "url": "https://example.com/listings/1"
  },
  "consent": {
    "sms": true,
    "email": true,
    "source": "kw_command_form"
  }
}
```

Do not send `tenantId`. Strict request validation rejects it. The bearer credential resolves the immutable tenant, and the connection/event unique constraint makes stable event IDs idempotent. Attribution remains separate:

- `ingestionProvider`: `zapier`
- `sourceSystem`: the CRM, such as `kw_command`
- `originalSource`: the CRM’s source, such as `facebook`

Live ingress succeeds only for an `ACTIVE` tenant. During `TESTING`, only a valid, unexpired controlled run may supply `X-RealtyTechAI-Test-Run-Id`. Suspended, paused, onboarding, and canceled workspaces reject live intake.

## Outbound CRM events

Tenant admins may subscribe a Zapier Catch Hook to:

- `lead.created`, `lead.updated`, `lead.engaged`, `lead.qualified`, `lead.status_changed`
- `lead.human_handoff`, `appointment.created`, `conversation.summary_ready`, `lead.opted_out`

RealtyTechAI saves the delivery before scheduling network I/O. The PostgreSQL durable worker retries a bounded ten times, records provider status/error, and creates an operations incident after exhaustion.

Every request includes:

```text
X-RealtyTechAI-Event-Id
X-RealtyTechAI-Event-Type
X-RealtyTechAI-Timestamp
X-RealtyTechAI-Signature: v1={hex HMAC-SHA256}
```

Verify the signature over `{timestamp}.{exact raw body}` using the one-time signing secret. Reject stale timestamps and deduplicate by event ID. Targets must use HTTPS, no URL credentials/custom port, and an owner-controlled hostname allowlist; Zapier’s hook host is allowed by default.

## Team and brokerage scope

The supported hierarchy is:

```text
Tenant → Team → Agent/User
```

Routing supports fixed users, team round robin, team assignment, and the tenant default. Candidate users must be active and match both tenant and team. Round robin is deterministic from prior routing logs. Reporting can filter by team, agent, source, and date and returns leads, replies, qualification, appointments, response time, handoffs, and closed leads.

A future `Brokerage → Office → Team → Agent` hierarchy should add an office boundary above existing teams. Do not overload `tenant_id` or weaken current tenant filters. Offices and multi-brand enterprise behavior are intentionally not implemented without customer demand.

## AI permission boundaries

| AI | Automatic scope | Mutations and approval |
| --- | --- | --- |
| Lead AI | Eligible first response, structured reply/qualification, verified booking link, appointment, summary, handoff | Never has admin/provider tools; every external message enters the normal persisted messaging worker and final deterministic safety check |
| Client AI | Readiness, managed messaging status, tenant usage/reporting, safe idempotent setup reconciliation | Business hours, booking link, and global tenant automation pause/resume require tenant-admin confirmation bound to the same actor/run/tenant |
| Operations AI | Exception/readiness diagnosis | Durable-job retry, provisioning reconciliation, webhook retry, and recovered-incident resolution require platform-admin confirmation; destructive/provider/legal/billing tools do not exist in its registry |

Lead policy maps the approved settings directly: `responseMode=controlled_autopilot` enables autopilot, `aiFirstResponderEnabled` controls the automatic opening response, `allowedChannels` limits SMS/email use, `tone` is supplied as approved model context, `bookingBehavior` gates booking tools, qualification questions are approved brokerage knowledge, and escalation rules/instructions define handoff policy. Public business identity, disclosed assistant identity, and approved agent roster are stored separately.

Prompt text is sent with `store: false`. Client and operations assistant prompts are encrypted at rest with `INTEGRATIONS_ENCRYPTION_KEY` so a conversation can survive refreshes without exposing plaintext in the database; history queries are bound to the same actor, tenant, and assistant type. Each run also stores a digest, withheld-length preview, provider/model, structured actions, token counts, estimated cost, latency, error classification, actor, tenant, and audit evidence.

Every assistant request carries a client-generated UUID. The actor/type/request uniqueness constraint makes a timeout retry idempotent and prevents a duplicate action. Model output is strict JSON and can request only the exact role-aware allowlist. RealtyTechAI executes read actions inside the authenticated tenant boundary, then gives the verified results to a second provider pass before showing a final answer. Mutations remain pending until the authorized actor confirms the exact arguments; atomic confirmation claiming prevents double execution.

Lead content is untrusted data. Lead AI has no administrative tool registry. Human takeover changes persisted ownership first, cancels queued AI messages and follow-up, and wins at the final send check. Resume reloads the complete tenant-scoped conversation, including human messages.

## Expected recurring owner work

For a healthy client, recurring technical provisioning is not expected. Owner work is limited to optional applicant/final launch approval, genuine provider/compliance exceptions, and unusual support or business decisions. Durable jobs handle ordinary provisioning, polling, UAT, outbound CRM delivery, message delivery, and bounded retries.
