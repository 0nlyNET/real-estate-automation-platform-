# Managed provider architecture and operations

RealtyTechAI owns the messaging provider accounts. A client supplies business,
consent, and lead-source information; they do not supply Twilio or SendGrid
credentials. Production must keep `TYPEORM_SYNC=false` and apply the checked-in
TypeORM migrations before application rollout.

## 1. Platform Twilio setup

1. Store the Twilio parent Account SID and Auth Token through the platform-admin
   integration screen. They remain only in `platform_credentials`.
2. Configure `TWILIO_WEBHOOK_URL` and
   `TWILIO_STATUS_CALLBACK_URL` as public HTTPS backend URLs.
3. Configure the default country and optional area code. Confirm the parent
   account can create subaccounts, API keys, Messaging Services, and numbers.
4. For a paid tenant, run the provisioning reconciliation endpoint. The worker
   persists each created SID immediately and resumes at the next missing step.
5. Complete the parent account's Primary Customer Profile once, then configure
   its SID plus the current Secondary Profile and A2P Trust Product policy SIDs.
   RealtyTechAI creates tenant business/representative objects, evaluates and
   submits the secondary profile and trust product, creates the Brand and
   Campaign, and durably polls provider status. A rejection becomes an
   `ACTION_REQUIRED` exception with Twilio's sanitized correction reason.

Never copy the parent Auth Token into a tenant credential row. Tenant webhook
signature verification and provisioning use the encrypted subaccount Auth
Token; outbound runtime sends use the tenant-scoped API Key SID and secret.
Twilio does not expose an API-key secret after creation, so reconciliation
removes a detected unusable orphan key before creating one replacement.

## 2. Platform SendGrid and DNS setup

1. Create one restricted production API key with Mail Send and the webhook
   permissions actually required. Save it as the platform SendGrid credential.
2. Set `SENDGRID_SENDING_DOMAIN` and `SENDGRID_REPLY_DOMAIN` to authenticated
   domains. Publish provider-issued SPF and DKIM records. Publish an approved
   DMARC record and monitor its reporting mailbox.
3. Configure Inbound Parse for the reply domain and the authenticated Event
   Webhook. Keep transactional mail and `lead_follow_up` classifications
   separate.
4. Tenant provisioning creates a non-guessable random reply token and a unique
   inbound address. A controlled outbound/reply test marks the identity ready.
5. Monitor bounces, spam complaints, blocks, and reputation. SendGrid subusers
   may be added later without changing the provider resolver contract.

Consent and deliverability are deliberately separate. Unsubscribe and spam
complaints revoke consent. Permanent hard bounces create a destination
suppression without falsely recording withdrawal of consent. Temporary blocks
remain transient. Dropped events are classified by their reason.

## 3. Tenant provisioning lifecycle

The persisted aggregate lifecycle is `WAITING_FOR_CLIENT -> PROFILE_READY ->
BILLING_READY -> EMAIL_PROVISIONING -> SMS_PROVISIONING ->
COMPLIANCE_PENDING -> TESTING -> READY -> ACTIVE`, with `ACTION_REQUIRED` for
failures. Provisioning reconciliation is safe to rerun and reconciles Twilio and
email independently. A failed provider step stores the completed resource
identifiers, records a sanitized error, releases its lease, and creates one
deduplicated owner task. A successful retry resolves that recoverable task.
It must never guess a tenant for an unknown number or reply token.

Stripe checkout completion and successful invoice payment durably enqueue
provider reconciliation and automatically record signed billing readiness.
Provider, A2P, quality, health/stalled-worker, retention, and offboarding jobs
use PostgreSQL schedules, leases, retries, and backoff and do not depend on an
open browser or a particular application instance. Provider failures do not
invalidate or retry a verified Stripe event; they become owner-visible
exceptions.

## 4. Callback checklist

- Twilio inbound: exact public URL, POST, signature verification with the owning
  subaccount token, routing by destination number or Messaging Service SID.
- Twilio status: exact public URL, POST, signature verification, monotonic
  delivery-state update, provider SID correlation.
- SendGrid inbound: authenticated endpoint, Inbound Parse reply domain, routing
  by the complete random inbound address, provider-message idempotency.
- SendGrid events: authenticated endpoint, event-id idempotency, message ID
  correlation, monotonic state changes, consent/deliverability classification.
- Stripe: signed raw-body webhook, event ledger idempotency, live/test separation.

After changing any URL, domain, sender, number, or provider credential,
invalidate the old readiness evidence and repeat the controlled tests.

## 5. Readiness and controlled testing

Clients cannot enable live automation directly. Required checks include billing,
business profile, lead source, platform and tenant usage limits, Twilio resources,
messaging compliance, SendGrid identity, affirmative consent configuration,
quiet hours, safety incidents, policy acknowledgements, and fresh controlled
tests.

Start a `test_run` with explicit owned SMS/email recipients. The isolated lead
is tagged with that run and passes through normal normalization, limits,
sequence, PostgreSQL worker, safety, provider, callback, reply, suppression,
and notification paths. Provider callbacks—not manually checked boxes—record
test evidence. Run SMS, email, inbound replies, STOP, unsubscribe, a safe
provider rejection, and notification checks. `tenant.lifecycleStatus=ACTIVE` and
`tenant_settings.automationsEnabled=true` are written only by successful
activation after every required item passes.

## 6. Monitoring and owner exception queue

The deduplicated health incident monitor checks backend readiness, database
connectivity/configuration, Stripe webhook failures, stalled message/sequence/AI
leases, blocked or failed Twilio/SendGrid tenant resources, and unresolved
critical incidents. Tenant quality monitoring separately evaluates SMS/email
failure, bounce, complaint, opt-out, velocity, lead-spike, and prohibited-content
rates. Alerts must link to an operations task or tenant resource and contain no
provider secrets or message bodies.

The owner dashboard is the exception queue: provider provisioning failures,
compliance blocks, spend warnings, hard-limit pauses, unusual velocity, billing
failures, webhook failures, and restore/retention reminders. Healthy tenants
should not generate routine tasks.

## 7. Incident response

For provider abuse, credential compromise, duplicate imports, or runaway
automation: use the platform emergency pause, preserve inbound webhooks and
evidence, suspend the affected tenant where possible, rotate the scoped key or
platform key as appropriate, reconcile provider events, and record an immutable
audit event. Do not delete records to make counters or incidents disappear.

For a hard tenant or platform usage limit, automation remains paused until an
authorized owner confirms the cause, adjusts a policy if justified, and resumes
service through the audited control path.

## 8. Cost and margin reporting

The owner-only tenant usage report aggregates SMS/email sent, delivered, failed,
and email-bounce outcomes alongside SMS, email, AI, and lead reservations,
estimated provider cost, normalized monthly subscription revenue, and estimated
contribution margin. Unit costs come from the configured
`ESTIMATED_*_COST_USD` values. Reconcile estimates against Twilio, SendGrid, and
AI invoices before financial use; estimates are operational guardrails, not an
accounting ledger.

## 9. Backup and disaster recovery

Follow `docs/disaster-recovery-runbook.md`. Targets are RPO <= 60 minutes and
RTO <= 240 minutes. Enable provider backups/PITR and retention, protect restore
credentials separately, and complete an isolated restore with all outbound
providers and automation disabled. Verify representative tenants, leads,
messages, consent, audit, and billing data. A backup is not proven until this
restore evidence exists.

## 10. Offboarding and retention

An owner-controlled export includes leads, contact data, conversation history,
appointments, lead status, and reports. Subscription cancellation durably
pauses automation and both sending identities, starts the configured retention
window, and schedules anonymization. Business/contact/message PII is removed at
the deadline; immutable audit, consent evidence, and billing records remain for
their separately approved legal retention. Offboarding requests and execution
timestamps remain auditable.

## Owner-controlled external gates

Before public paid launch, qualified counsel must review the actual Terms of
Service, Privacy Policy, Acceptable Use Policy, subscription/cancellation terms,
messaging-consent language, lawful lead collection certification, and retention
policy. The owner must also complete production DNS/provider verification, the
restore drill, live monitoring/alert routing, and controlled production UAT.
Do not fabricate readiness evidence or environment variables to bypass these
gates.
