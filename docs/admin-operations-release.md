# RealtyTechAI admin operations release

This document is the owner handoff for the flat-service admin/client release. It describes what is implemented, what the numbers mean, what must be configured manually, and what still requires a real production device or provider account to verify.

## Outcome

RealtyTechAI now has one client-facing managed service and two deliberately different workspaces:

- The client workspace is a short path through Home, Get started, Leads, Messages, Follow-up, Reports, Connections, Team, Lead routing, Compliance, Settings, Billing, and Help. It contains no upgrade tiers or locked-plan screens.
- The internal workspace is organized around Today, Leads, Clients, Onboarding, Tasks, Support, Activity, and owner-only Billing & health.
- A client cannot activate service. The owner reviews readiness evidence and activates only after required setup, provider tests, approval, and billing verification pass.
- Trusted backend events create user-scoped in-app notifications and optional web-push notifications.

## Original condition and issues corrected

The repository already had real tenant-scoped leads, messaging, Twilio/SendGrid/Facebook credential storage, Stripe checkout/webhooks, onboarding records, operations tasks, support, audit logs, and client pages. The main gaps were operational rather than cosmetic:

- The admin page did not present the existing data as one understandable sales-to-launch workflow.
- Platform access was an all-or-nothing environment allow-list; there was no Staff role with server-enforced financial restrictions.
- Assignments were inconsistent and invalid operator IDs were not centrally rejected.
- Billing state existed, but live/test revenue, refunds, disputes, subscription amounts, renewals, and recent verified activity were not presented as an owner operating view.
- There was no structured in-app/device notification system, per-user preferences, subscription cleanup, incident grouping, or recovery alerting.
- Diagnostic retention was not automated as a bounded, batched 90-day policy.
- Old client pages could briefly display obsolete Teams/Enterprise upgrade gates.
- The application favicon was not the RealtyTechAI logo.
- The internal seed workspace could be counted as a client; admin client/revenue reporting now excludes the workspace containing a configured SuperAdmin.

## What is now implemented

### Admin operating flow

1. A public application is persisted before email delivery is attempted.
2. The application creates an operations task and a trusted review notification.
3. An operator can qualify the lead, record notes, assign it, book the consultation, and mark it won/lost.
4. The SuperAdmin can create an inactive client workspace after close. Duplicate owner emails are rejected.
5. The handoff shows the owner email, a one-time temporary password, a verification link, and whether system email was delivered.
6. The client completes the guided four-step intake and connects their accounts.
7. Staff can review operational readiness and record nonfinancial evidence. Only the SuperAdmin can verify billing, activate/pause service, assign clients, impersonate a client, or manage Staff access.
8. Provider tests, client approval, operator approval, billing evidence, and other readiness checks must pass before activation.

### Admin sections

- **Today:** real summary metrics, action center, business flow, 30-day conversion/launch/support report, and eight-week lead/client trend.
- **Leads:** persisted applications, search, status, assignment, unassigned filter, internal notes, follow-up task creation, and client conversion handoff.
- **Clients:** client status/ownership, owner-only assignment, client user list, and controlled view-as-client support session.
- **Onboarding:** readiness blockers, provider-test evidence, launch approval evidence, operator approval, owner-only billing verification, activation, and pause.
- **Tasks:** priority, due date, status, assignment, evidence, overdue reminders, and direct related-record context.
- **Support:** severity, due date, assignment, acknowledgment, resolution, and notification/task creation.
- **Activity:** connection health without credentials and read-only message delivery history.
- **Billing & health:** owner-only MRR, net collected revenue, live/test separation, recent verified Stripe events, subscription counts, upcoming renewals, provider readiness, retention status, and Staff access.

### Client experience

- One managed service with no plan picker, upgrade modal, tier badge, or locked feature flash.
- Four guided onboarding steps: business, leads, communication/consent, and review/connections.
- Repeated contact roles default to the account owner to reduce duplicate entry.
- Connections includes website/Zapier intake, Twilio SMS, SendGrid email, and Facebook Lead Ads. Credentials are encrypted server-side and are never returned to the browser.
- Stripe in the client Billing page is RealtyTechAI billing. Clients do not connect a separate Stripe account to pay RealtyTechAI.

## Role and data boundaries

| Capability | SuperAdmin | Staff |
| --- | --- | --- |
| Leads, clients, onboarding, tasks, support | Yes | Yes |
| Read-only communications and connection status | Yes | Yes |
| Company revenue and Stripe summaries | Yes | No |
| System health and environment readiness | Yes | No |
| Client assignment, activation, pause, impersonation | Yes | No |
| Staff/access management | Yes | No |
| Billing verification evidence | Yes | No |
| Billing/system notifications | Yes | No |

These restrictions are enforced by backend guards and response shaping. The Staff frontend does not request owner-only endpoints. Notification reads are recipient-scoped, and owner-only events cannot be addressed to Staff even if an incorrect assignee is supplied internally.

Removing database-managed Staff access automatically unassigns that user from clients, applications, tasks, support requests, and onboarding records without deleting business records. Environment-managed SuperAdmin/Staff access must be changed through Railway variables.

All mutation routes are captured by the existing audit interceptor. Passwords, tokens, secrets, raw payment data, and request bodies are not copied into audit metadata.

## Metric definitions

- **Active client:** a non-internal tenant whose service lifecycle is `ACTIVE`.
- **New lead:** a persisted prospective-client application with status `new`.
- **Call booked:** an application with `consultation_booked` or `accepted` status in the reporting period.
- **Lead-to-client conversion:** accepted applications divided by applications received in the same 30-day period. It is shown as unavailable when there is no denominator.
- **New client:** a non-internal tenant record created in the period.
- **Average time to launch:** average hours from tenant creation to recorded service activation; unavailable without completed samples.
- **MRR:** synchronized Stripe unit amounts for live active/trialing subscriptions; annual legacy subscriptions are divided by 12. Currencies are never mixed.
- **Collected revenue:** verified live-mode `invoice.payment_succeeded` amounts minus verified live-mode `refund.created` amounts in the selected UTC period.
- **Past due:** synchronized `past_due` or `unpaid` Stripe tenant state.
- **Recent billing activity:** summarized, signature-verified live Stripe events. No raw webhook payload or card data is stored in the summary.
- **Test activity:** stored and displayed separately and never included in live MRR or collected totals.

## Notification behavior

Trusted server-side sources currently include public applications, application assignment/stage changes, client creation/assignment, onboarding changes/assignment, tasks, daily due/overdue task reminders, 24-hour lead follow-up reminders, support creation/assignment, verified Stripe events, integration failure/recovery, and grouped health incidents/recovery.

Notifications support:

- recipient ownership, category, severity, timestamps, internal action links, read/read-all, filters, pagination parameters, and empty/error states;
- per-user in-app/device settings, category and severity settings, quiet hours/timezone, privacy-safe lock-screen text, and critical-alert protection;
- multiple device records, expired subscription revocation on HTTP 404/410, event deduplication, daily reminder deduplication, durable incident detection, and recovery notifications;
- explicit browser permission only after the operator presses **Connect this device**.

Web push cannot report that the whole Railway process or deployment is down because the sender is then unavailable. Configure Railway deployment/crash alerts and an external uptime check for `/health/live` in addition to RealtyTechAI's in-process database/configuration/webhook monitoring.

## Retention and database changes

Migration:

- `backend/src/database/migrations/202607200001-admin-operations-notifications.ts`

It safely adds:

- `users.platform_role`;
- client billing amount/currency/interval and assignment fields;
- `admin_notifications`;
- `admin_push_subscriptions`;
- `admin_notification_preferences`;
- permanent summarized `billing_events`;
- assignment, retention, unread, incident, billing, and deduplication indexes and `ON DELETE SET NULL` assignment foreign keys.

The migration is intentionally non-destructive on rollback. Production TypeORM startup runs registered migrations unless `RUN_MIGRATIONS=false`; set `RUN_MIGRATIONS=true` explicitly in Railway.

The in-process retention service runs at startup and daily. It deletes only expired audit logs, Stripe webhook-processing ledger rows, and admin notifications in batches of 1,000. The default is 90 days and the safe configurable range is 30–365 days. It does not delete clients, leads, billing summaries, invoices in Stripe, tasks, support, onboarding, communications, or credentials.

## Environment variables

### Required Railway backend values

```dotenv
NODE_ENV=production
DATABASE_URL=<Railway Postgres reference/value>
TYPEORM_SYNC=false
RUN_MIGRATIONS=true
FRONTEND_URL=<canonical frontend HTTPS origin, no trailing slash>
PUBLIC_APP_URL=<same canonical frontend HTTPS origin>
JWT_SECRET=<at least 32 random characters>
INTEGRATIONS_ENCRYPTION_KEY=<base64 that decodes to exactly 32 bytes>
PLATFORM_ADMIN_EMAILS=realtytechai@gmail.com
PLATFORM_STAFF_EMAILS=<optional lowercase comma-separated emails>
GLOBAL_AUTOMATIONS_DISABLED=true
BILLING_GRACE_DAYS=0
OPERATIONAL_RETENTION_DAYS=90
```

Keep global automations disabled while configuring/testing the first client. Enable only after the controlled UAT checklist passes.

### Phone push values

Generate one VAPID pair locally from `backend/`:

```bash
npx web-push generate-vapid-keys
```

Add the generated values to Railway; never commit the private key:

```dotenv
VAPID_PUBLIC_KEY=<generated public key>
VAPID_PRIVATE_KEY=<generated private key>
VAPID_SUBJECT=mailto:realtytechai@gmail.com
```

Redeploy the backend after adding them. On iPhone, open the production site in Safari, add it to the Home Screen, launch that Home Screen app, sign in as SuperAdmin, press the bell, press **Connect this device**, and allow notifications. Keep **Private lock-screen text** enabled unless displaying business details on the lock screen is acceptable.

### Stripe—RealtyTechAI's account

Create one recurring monthly Price in the RealtyTechAI Stripe account, then set:

```dotenv
STRIPE_SECRET_KEY=<matching test or live secret key>
STRIPE_PRICE_SERVICE_MONTH=<matching recurring Price ID>
STRIPE_WEBHOOK_SECRET=<signing secret for the endpoint below>
```

Webhook endpoint:

```text
<api-origin>/billing/webhook
```

Subscribe to exactly the events handled by this release:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`
- `refund.created`
- `charge.dispute.created`

Do not mix test keys, live keys, prices, or webhook secrets. Run the full payment/refund/failure tests in Stripe test mode before replacing all three values with their live-mode equivalents.

### Email ownership

There are two separate email uses:

1. **RealtyTechAI system email** uses Railway `SENDGRID_*` values for account verification, password reset, application acknowledgment, and delivery to `SALES_INBOX_EMAIL`. It is optional as a complete unit for deployment; the admin client-creation handoff provides a manual verification link when it is not configured. A partially filled setup is marked unhealthy.
2. **Client follow-up email** is connected by each brokerage in **Client dashboard → Connections → SendGrid**. The client normally owns and pays for that provider account. RealtyTechAI stores the restricted API key encrypted and exposes only status/test results.

System email values when you return to SendGrid:

```dotenv
SENDGRID_API_KEY=<restricted RealtyTechAI system key>
SENDGRID_FROM_EMAIL=<verified RealtyTechAI sender>
SENDGRID_FROM_NAME=RealtyTechAI
SALES_INBOX_EMAIL=realtytechai@gmail.com
```

### Client-owned connections

- **Twilio:** the client enters Account SID, auth token, and sending number. Configure the number's inbound message URL as `<api-origin>/webhooks/twilio/inbound` with HTTP POST; status callbacks use `<api-origin>/webhooks/twilio/status`.
- **SendGrid:** the client enters a restricted API key and a verified brokerage sender, then runs the connection test.
- **Facebook Lead Ads:** the client authorizes Facebook and selects the brokerage Page. Platform-level Meta app/webhook values still belong in Railway.
- **Website/Zapier:** the client creates a one-time intake key, stores it in the sending system, and posts to the displayed tenant-specific endpoint using the `x-intake-key` header.

## Deployment

### Railway backend

1. Use `backend/` as the service root.
2. Build with `npm ci` and `npm run build`.
3. Start with `npm run start:prod`.
4. Use one replica while migrations run.
5. Set the health-check path to `/health/readiness`. If system email/Stripe are intentionally absent as complete integrations, readiness permits `not_configured`; partial or unsafe configuration returns HTTP 503.
6. Confirm Railway Postgres backups and deployment/crash notifications before accepting client data.

### Vercel frontend

1. Use `frontend/` as the project root.
2. Set server-only `BACKEND_API_URL=<Railway API origin>`.
3. Set `NEXT_PUBLIC_SITE_URL=<canonical frontend origin>`.
4. Do not create `NEXT_PUBLIC_*` variables containing the backend origin or any secret.
5. Deploy the same commit as Railway.

### Post-deployment checks

```bash
curl -fsS <api-origin>/health/live
curl -fsS <api-origin>/health/readiness
```

Then verify in a private browser: login, owner dashboard, Staff restrictions, public application persistence, lead update, client creation, manual/automatic verification handoff, guided intake, a provider test, a Stripe test checkout/webhook, notification read state, and one real phone push.

## Verification result

- Backend: 45 of 45 Jest suites passed (124 tests), production build passed, and lint passed with no errors.
- Frontend: client-readiness verification passed (33 static links), all 47 production routes built successfully, service-worker syntax passed, and lint passed with no errors (48 existing warnings remain).
- Diff integrity: `git diff --check` passed.
- Production dependency audits: backend and frontend each reported zero vulnerabilities.
- Deployed provider and real-device drills remain separate release checks because they require the production accounts, configuration, and intended phone.

## Remaining limitations and risks

- A real push cannot be claimed until the production VAPID keys are set and a notification is received on the intended phone.
- Full process/deployment outages need Railway/external monitoring; an unavailable backend cannot send its own outage push.
- System email remains manual until all four SendGrid system values are configured with a verified sender.
- The admin uses bounded recent lists suitable for the first operating stage. Add server-driven cursor pagination before thousands of clients/messages/tasks.
- Revenue is event-synchronized from handled Stripe webhooks. Historical Stripe activity from before this migration is not backfilled automatically.
- Provider health is based on configuration, real test/use failures, webhook processing, and recovery—not paid synthetic probes of every third-party API.
- Native App Store notifications are not included; this release uses standards-based web push.

## Recommended next work

### Required before the first paying client

- Complete the Railway/Vercel variables, production migration, backup check, Stripe test-mode drill, client provider tests, and one intended-phone push test.
- Complete `docs/production-launch-owner-checklist.md` and all scenarios in `docs/first-client-uat.md`.

### Recommended in the first month

- Add external uptime/deployment alerting and perform a restore drill.
- Add cursor pagination once operational lists approach their current 100/200-record windows.
- Backfill summarized historical Stripe events only through a reviewed, idempotent script if historical reporting is required.

### Optional later

- Native mobile apps, granular Staff record scopes, calendar OAuth, file uploads, outbound admin messaging, richer cohort charts, and more advanced workflow scheduling.

## Page descriptions

- **Owner Today:** four high-signal metrics, an action center, the five-step business flow, 30-day operating results, and an eight-week trend.
- **Owner Billing & health:** live revenue and MRR, recent verified billing events, renewals, provider readiness, retention, and Staff controls.
- **Staff workspace:** the same operational lead/client/onboarding/task/support tools with financial, system, activation, impersonation, and access controls absent.
- **Client Get started:** a numbered four-step form with save-as-you-go behavior and a clear explanation that RealtyTechAI reviews/tests before launch.
- **Client Connections:** status-first cards for intake, Twilio, SendGrid, and Facebook, with secrets entered only when the client is authorized to manage them.
