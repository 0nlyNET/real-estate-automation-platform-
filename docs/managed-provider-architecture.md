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
5. Record the tenant's Customer Profile, Brand, Campaign, and approval status.
   Live readiness cannot pass until status is `approved` and a controlled test
   marks the resource `ready`.

Never copy the parent Auth Token into a tenant credential row. Tenant webhook
signature verification uses the encrypted subaccount Auth Token; outbound sends
use the subaccount configuration resolved on the server.

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

The normal lifecycle is `PROVISIONING -> TESTING -> READY -> ACTIVE`.
Provisioning reconciliation is safe to rerun and reconciles Twilio and email
independently. A failed provider step stores the completed resource identifiers,
records a sanitized error, releases its lease, and creates an owner task when
triggered from billing. It must never guess a tenant for an unknown number or
reply token.

Stripe checkout completion and successful invoice payment request provider
reconciliation. Provider failures do not invalidate or retry a verified Stripe
event; they become owner-visible exceptions.

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

Run test SMS, test email, test lead/follow-up, inbound SMS, inbound email, STOP,
unsubscribe, provider rejection, and notification tests using owned test
destinations. `tenant.lifecycleStatus=ACTIVE` and
`tenant_settings.automationsEnabled=true` are written only by successful
activation after every required item passes.

## 6. Monitoring and owner exception queue

Monitor backend readiness, worker leases, database connections and migrations,
Stripe webhook failures, Twilio/SendGrid failures, provisioning state and lease
age, safety incidents, usage warnings, bounce/complaint/opt-out rates, and backup
freshness. Alerts must link to an operations task or tenant resource and contain
no provider secrets or message bodies.

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

The owner-only tenant usage report aggregates SMS, email, AI, and lead
reservations, estimated provider cost, normalized monthly subscription revenue,
and estimated contribution margin. Unit costs come from the configured
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

An owner-controlled export includes workspace settings, users, leads and their
conversation history, sequences, appointments, consent/opt-out history, audit
history, support records, and billing records. Subscription cancellation pauses
automation and opens an offboarding task; it does not immediately erase client
data. Apply the counsel-approved retention schedule to business data, messages,
consent, audit, and billing categories. Keep deletion requests and execution
evidence auditable, and remove or release provider resources only after the
approved retention/offboarding decision.

## Owner-controlled external gates

Before public paid launch, qualified counsel must review the actual Terms of
Service, Privacy Policy, Acceptable Use Policy, subscription/cancellation terms,
messaging-consent language, lawful lead collection certification, and retention
policy. The owner must also complete production DNS/provider verification, the
restore drill, live monitoring/alert routing, and controlled production UAT.
Do not fabricate readiness evidence or environment variables to bypass these
gates.
