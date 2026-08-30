# Production launch owner checklist

This is the external configuration contract for the first paid pilot. Repository tests cannot complete these actions. Do not mark a row complete without a dated evidence link or provider record. Store secrets only in the named platform secret store; evidence may contain safe object IDs but never secret values.

Use these placeholders consistently:

- `<frontend-origin>`: `https://realtytechai.app` or the final canonical Vercel domain, with no trailing slash.
- `<api-origin>`: the final public Railway backend HTTPS origin, with no trailing slash.
- `<operations-mailbox>`: monitored mailbox owned by the operating business.
- `<32+-char-random>`: cryptographically random secret of at least 32 characters.
- `<base64-32-bytes>`: output of `openssl rand -base64 32`.
- Stripe object formats: secret `sk_live_…`, webhook secret `whsec_…`, recurring price `price_…`.

## A. Must be completed by the business owner

| Done / evidence | Platform | Exact setting and value format | Dependency | Verification step | Risk if omitted |
| --- | --- | --- | --- | --- | --- |
| [ ] | Corporate/legal records | Legal entity name, physical/mailing business address, formation jurisdiction, and public business name; use real approved values, not repository placeholders. | Company formation records and counsel. | Counsel/owner signs a one-page identity sheet; public terms/privacy/contact copy is updated only after approval. | Contracts, notices, tax, and privacy disclosures may identify the wrong party. |
| [ ] | Email/domain admin | Create monitored `support@…`, `billing@…`, `privacy@…`, `legal@…`, `sales@…`, and `operations@…`; assign primary and backup humans. Set `SALES_INBOX_EMAIL=<operations-mailbox>` in Railway. | Domain and mailbox licenses. | Send from an external Gmail and Outlook account; confirm ownership, forwarding, alerting, and backup access. | Applications, incidents, billing, or rights requests may be missed. |
| [ ] | Commercial decision record | Approve the one managed service, exact setup scope, monthly amount, currency, provider-cost pass-through/inclusion, message allowance, and overage handling. | Unit economics and the Stripe product. | Signed price sheet reconciles to the agreement, SOW, public presentation, and single Stripe service price. | Misbilling, margin loss, or misleading public presentation. |
| [ ] | Commercial policy | Approve trial/no-trial rule, cancellation notice/effective-date rule, refund policy, and monthly renewal behavior. | Counsel/accountant and Stripe configuration. | Agreement, terms, refund page, Stripe portal, and UAT Tests 17–20 agree. | Disputes, refunds, or service continuing after cancellation. |
| [ ] | Service policy | Approve support hours, timezone, support response target by severity, onboarding turnaround target, and incident/escalation contacts. | Staffing calendar and monitored mailboxes. | Run an after-hours/high-severity support drill and record who responds. | Unowned incidents and unmet client expectations. |
| [ ] | Scope decision | Confirm the launch offer is lead-response/follow-up only. If manual social work is sold separately, create a separate human SOP and SOW; do not represent it as platform automation. | Sales and delivery owners. | Public pages and signed scope contain no unsupported social/AI workflow. | Scope breach and misleading sales. |
| [ ] | Legal | Execute managed-service agreement and client-specific SOW; obtain review of consent language, privacy terms, SMS/email communications process, data retention/deletion, and applicable fair-housing obligations. | Qualified counsel; client approval contact. | Retain signed documents/version IDs and counsel sign-off; link them in onboarding evidence without uploading secrets. | Unauthorized messaging, privacy/compliance exposure, or unenforceable terms. |
| [ ] | Tax/accounting | Obtain accountant guidance on nexus, sales tax, invoices, and whether/how to enable Stripe Tax. | Entity, client jurisdictions, packages/prices. | Written decision identifies jurisdictions and Stripe Tax setting; reconcile a test invoice. | Under/over-collection and filing exposure. |
| [ ] | Insurance | Review and bind appropriate E&O/professional liability and cyber/privacy coverage, including provider incidents and messaging operations. | Broker underwriting and final service scope. | Retain declarations page, limits, exclusions, incident hotline, and renewal owner. | Uninsured professional/cyber loss. |

## B. SendGrid

| Done / evidence | Platform | Exact setting and value format | Dependency | Verification step | Risk if omitted |
| --- | --- | --- | --- | --- | --- |
| [ ] | SendGrid → Sender Authentication | Authenticate the final sending domain; add the exact CNAME/TXT records SendGrid provides. Confirm SPF alignment and DKIM validation. | DNS administrator and approved public domain. | SendGrid shows domain authenticated; inspect Gmail/Outlook headers for SPF=pass and DKIM=pass. | Spoofing risk and poor/rejected delivery. |
| [ ] | DNS | Publish a DMARC TXT record for the sending domain, beginning conservatively with counsel/security-approved reporting policy (for example `v=DMARC1; p=none; rua=mailto:<dmarc-mailbox>`), then tighten after review. | SPF/DKIM alignment and monitored report mailbox. | Validate with a DNS checker and review aggregate reports. | Domain abuse or undetected alignment failures. |
| [ ] | SendGrid → API Keys | Create a dedicated restricted production API key with only required Mail Send access. Put its `SG.…` value in Railway `SENDGRID_API_KEY`; never in Vercel or source. | Authenticated domain and Railway access. | `/health/readiness` reports system email up; rotate the test key after any accidental exposure. | Excess privilege or complete mail failure. |
| [ ] | Railway variables | Set `SENDGRID_FROM_EMAIL=<verified-sender@domain>`, `SENDGRID_FROM_NAME=<approved public business name>`, and `SALES_INBOX_EMAIL=<operations-mailbox>`. | Legal/public name and verified domain/mailbox. | Redeploy; submit a public application and inspect From identity and operations delivery. | Missing/false sender identity or lost operational mail. |
| [ ] | SendGrid Activity | Send verification, reset, welcome/onboarding, public application applicant/operator, support acknowledgment/operator, cancellation, and deletion test emails to Gmail and Outlook. Review delivered/bounced/blocked/spam states. | Deployed frontend/backend URLs and test accounts. | Retain provider message IDs/headers; all links use `<frontend-origin>` and no onboarding email says service is already active. | Broken access recovery, silent application loss, or misleading onboarding. |
| [ ] | Mailbox providers | Check inbox/spam placement on Gmail and Outlook and establish a weekly SendGrid Activity review owner. | Successful message tests. | Record placement screenshots and recurring owner/calendar item. | Deliverability degradation goes unnoticed. |

## C. Stripe

| Done / evidence | Platform | Exact setting and value format | Dependency | Verification step | Risk if omitted |
| --- | --- | --- | --- | --- | --- |
| [ ] | Stripe account | Complete business verification, beneficial-owner details, production bank account, support contact, and payout controls. | Legal entity and bank records. | Stripe account shows charges/payouts enabled; two authorized administrators are documented. | Live charges or payouts may be blocked or misdirected. |
| [ ] | Stripe Product/Price | Create one monthly recurring price for the approved RealtyTechAI managed service. Record its `price_…` ID. Do not create a separate setup-fee checkout unless the signed business process is implemented separately. | Approved service/price sheet and tax decision. | Price currency, amount, monthly interval, tax behavior, and product name reconcile to the signed mapping. | Wrong amount, interval, or entitlement. |
| [ ] | Railway variables | Set `STRIPE_SECRET_KEY=sk_live_…` and `STRIPE_PRICE_SERVICE_MONTH=price_…`; both must be from live mode. No Pro, Teams, or annual price variables are used. | Live product and monthly price. | Redeploy; `/health/readiness` reports billing up; start one checkout and inspect its line item before payment. | Checkout fails or an unknown price blocks service. |
| [ ] | Stripe Workbench → Webhooks | Endpoint URL exactly `<api-origin>/billing/webhook`. Subscribe to `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`, `refund.created`, and `charge.dispute.created`. Set Railway `STRIPE_WEBHOOK_SECRET=whsec_…`. | Public Railway HTTPS origin and live Stripe account. | Send a Stripe test event; ledger row completes once; an invalid signature is rejected before ledger insertion. | Forged, missed, duplicated, or stale billing state. |
| [ ] | Stripe Customer Portal | Enable payment-method update, invoice history, and owner-approved cancellation timing/plan controls. Set the approved return behavior. | Cancellation and refund policy. | Open portal from an authenticated test workspace; update a test payment method and return to `/app/billing`. | Client cannot recover payment or cancellation differs from contract. |
| [ ] | Stripe Settings | Configure receipts, approved branding, support details, statement descriptor, invoice footer, and dunning/retry schedule. | Public business identity, support mailbox, policy. | Inspect test receipt/invoice/statement descriptor and simulate a failed payment. | Charge confusion, disputes, or missed collections. |
| [ ] | Stripe Tax | Apply the written accountant decision: enabled with registrations/product tax codes, or explicitly disabled with owner/date evidence. | Accountant decision and nexus analysis. | Inspect tax behavior on test invoices in relevant jurisdictions. | Incorrect tax collection/reporting. |
| [ ] | Stripe test mode | Complete sandbox checkout, duplicate checkout attempt, renewal/test clock, failed payment/recovery, period-end cancellation, immediate cancellation, and refund. | UAT tenants and webhook endpoint. | UAT Tests 5 and 17–20 pass; retain customer/subscription/invoice/event/refund IDs and local ledger/tenant reconciliation. | Billing lifecycle is unproven. |
| [ ] | Stripe live mode | Make one controlled low-value live payment under the final agreement, verify receipt/payout/webhook/local state, then refund or retain it according to the documented test plan. | All prior Stripe/UAT checks and owner approval. | One customer, one subscription, mapped price, completed event ledger, correct tenant state, and bank payout/reconciliation evidence. | First client could be charged incorrectly without detection. |

## D. Twilio

| Done / evidence | Platform | Exact setting and value format | Dependency | Verification step | Risk if omitted |
| --- | --- | --- | --- | --- | --- |
| [ ] | Client agreement/records | Obtain written client authorization for the sending identity, use case, lead sources, consent disclosure, and number ownership/assignment. | Signed SOW and counsel-reviewed consent language. | Link signed authorization in onboarding evidence and identify the approved client/brokerage name. | Unauthorized messaging or sender misidentification. |
| [ ] | Twilio Messaging Compliance | Complete A2P 10DLC brand/campaign registration or toll-free verification as applicable before production traffic. | Entity/EIN, use-case samples, opt-in/STOP language. | Twilio shows the number/campaign approved; send only within the approved use case. | Carrier blocking, filtering, fines, or suspension. |
| [ ] | Twilio tenant provisioning | Save the RealtyTechAI parent Account SID/Auth Token once in owner-only platform settings, then run tenant provisioning. Confirm a child account, scoped credential, Messaging Service, dedicated number, exact callbacks, and approved A2P/toll-free status are persisted for the intended tenant. Clients must never enter or receive provider credentials. | Approved registration, tenant authorization, final callback URLs, and platform encryption key. | Owner provisioning view reports ready after outbound/inbound/status tests; assigned number is unique and the resource parent SID matches the active parent account. | Cross-tenant routing, root-secret exposure, unregistered traffic, or orphaned provider resources. |
| [ ] | Twilio number → Messaging webhook | HTTP POST inbound URL exactly `<api-origin>/webhooks/twilio/inbound`; Railway `TWILIO_WEBHOOK_URL` must be the identical absolute HTTPS string. | Final API domain and tenant sender. | Send inbound SMS; Twilio request validates and lands once on the correct tenant/lead. | Signature rejection or wrong-tenant inbound routing. |
| [ ] | Application/Railway | Railway `TWILIO_STATUS_CALLBACK_URL=<api-origin>/webhooks/twilio/status`. Outbound requests attach this exact URL; do not configure a different host/path in Twilio. | Final API domain. | Send controlled SMS and observe signed queued/sent/delivered or failed callbacks on the same message. | Provider acceptance may be misreported as delivery; failures remain hidden. |
| [ ] | Twilio tests | Test outbound, inbound reply, whitespace/case STOP, provider rejection (invalid controlled destination or Twilio test fixture), callback replay, and tenant routing. | Active controlled test tenant and affirmative consent. | UAT Test 15 passes; Twilio Message SID and local task/status evidence retained. | Wrong recipient, opt-out violation, duplicate send, or invisible rejection. |
| [ ] | Twilio Monitor | Assign a daily pilot-period owner to review Messaging Logs/Errors and alerts for delivery error codes. | Production traffic and operations mailbox. | Document alert recipient and a reviewed failed-message example reconciled to Admin Operations. | Carrier/provider failures are noticed only by the client. |

## E. Meta

Meta is required only when the first client’s signed scope includes Meta Lead Ads. Otherwise leave it disabled and mark this section `NOT APPLICABLE — Meta not sold`, with owner evidence.

| Done / evidence | Platform | Exact setting and value format | Dependency | Verification step | Risk if omitted |
| --- | --- | --- | --- | --- | --- |
| [ ] / [ ] N/A | Meta for Developers | Create a Business-type app, associate the verified business, add Facebook Login and Webhooks/Lead Ads capabilities, and request the permissions actually used: `pages_show_list`, `pages_read_engagement`, `leads_retrieval`, `pages_manage_metadata`. Complete App Review/business verification when Meta requires it. | Client Page authorization and Meta business access. | App dashboard shows Live/approved permissions for the test user/client assets. | OAuth or lead retrieval stops in development-only mode. |
| [ ] / [ ] N/A | Railway variables | `FACEBOOK_APP_ID=<numeric app id>`, `FACEBOOK_APP_SECRET=<secret>`, `FACEBOOK_REDIRECT_URL=<api-origin>/integrations/facebook/callback`, `FACEBOOK_WEBHOOK_URL=<api-origin>/webhooks/facebook/lead-ads`, `FACEBOOK_WEBHOOK_VERIFY_TOKEN=<32+-char-random>`, and an active pinned `FACEBOOK_GRAPH_API_VERSION=v<major>.<minor>`. | Final API domain and Meta app. | OAuth returns to the exact URI; webhook challenge succeeds; secrets never appear in client responses/logs. | Broken OAuth/webhook or secret exposure. |
| [ ] / [ ] N/A | Meta Webhooks | Subscribe the app/Page to `leadgen` at `<api-origin>/webhooks/facebook/lead-ads` using the same verify token as Railway. | Approved app and Page admin. | Meta webhook dashboard shows verified and Page subscription success. | No lead delivery. |
| [ ] / [ ] N/A | RealtyTechAI Integrations | Authorize the exact client Page, select it, and ensure status becomes connected only after Page subscription. | Meta account with Page access. | Masked integration UI names the intended Page and records a successful timestamp. | Leads route from the wrong Page/tenant. |
| [ ] / [ ] N/A | Meta Lead Ads Testing Tool | Submit and replay a test lead with source/form/campaign identifier and approved consent evidence. | Connected Page and approved form. | Exactly one lead appears in the correct tenant with expected source, consent, assignment, and no duplicate protected activity. | Cross-tenant ingestion, duplicates, or contact without evidence. |

## F. Railway and PostgreSQL

| Done / evidence | Platform | Exact setting and value format | Dependency | Verification step | Risk if omitted |
| --- | --- | --- | --- | --- | --- |
| [ ] | Railway backend variables | Set `NODE_ENV=production`, `PORT` from Railway/default, `FRONTEND_URL=<frontend-origin>`, `PUBLIC_APP_URL=<frontend-origin>`, `JWT_SECRET=<32+-char-random>`, `HEALTH_CHECK_TOKEN=<32+-char-random>`, `PLATFORM_ADMIN_EMAILS=<comma-separated lowercase emails>`, `INTEGRATIONS_ENCRYPTION_KEY=<base64-32-bytes>`, optional independent `UNSUBSCRIBE_TOKEN_SECRET=<32+-char-random>`, `GLOBAL_AUTOMATIONS_DISABLED=true` for launch preparation, and owner-approved `BILLING_GRACE_DAYS=<integer 0..14>` (repository default policy is 0). | Legal/admin contacts and secret-generation ceremony. | Production starts without unsafe-config error; authenticated `/health/readiness` runtime/encryption are up; admin allow-list is tested. | Startup failure, forged sessions, exposed diagnostics, undecryptable credentials, or unsafe automation. |
| [ ] | Railway PostgreSQL variables | `DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/<database>`, `DATABASE_SSL=true`, `TYPEORM_SYNC=false`, `RUN_MIGRATIONS=true`. Do not expose the URL in evidence. | Managed PostgreSQL and backup completed. | Deployment logs show migrations complete; `migration:show` has no pending items; `/health/readiness` database/schema/migrations are up. | Data loss from sync, schema mismatch, or plaintext transport. |
| [ ] | Railway service scaling | Keep exactly one backend replica for first-client launch. Scale only after a production-like multi-replica exercise confirms Postgres `FOR UPDATE SKIP LOCKED` message/enrollment claiming and no duplicate provider send. | Worker tests and controlled provider test. | Railway shows one replica; UAT Test 15 proves concurrent claims; later scaling approval is written. | Duplicate processing if platform/runtime behavior differs from tests. |
| [ ] | Railway health | Deployment healthcheck path `/health/live`; monitor `/health/readiness` with the `x-health-check-token` header and use the Admin production setup checker plus tenant readiness for launch gates. | Database/migrations/runtime config/system email/billing; provider approval and external evidence remain separate activation gates. | Liveness is HTTP 200; unauthenticated readiness is HTTP 401; authenticated readiness is HTTP 200 `status: ready`, with no pending migrations or legacy plaintext credential rows. The setup checker may still show action-required launch items, and tenant activation must remain blocked until those pass. | A healthy process can be confused with a launch-ready platform or diagnostics can be exposed publicly. |
| [ ] | Railway alerts | Enable deployment-failed, crash/restart, and sustained CPU/memory/storage/resource alerts to primary and backup incident contacts. | Monitored operations mailbox/on-call channel. | Trigger a nonproduction alert and record receipt/escalation time. | Outage or resource exhaustion goes unnoticed. |
| [ ] | PostgreSQL backups | Enable scheduled backups and point-in-time recovery if the Railway plan supports it; document retention and recovery objectives. | Appropriate managed DB plan and owner budget. | Provider dashboard shows successful backup/PITR window and alert recipient. | Irrecoverable client/consent/billing history loss. |
| [ ] | PostgreSQL restore drill | Restore the newest backup into a separate nonproduction database. Deploy the same commit with automation globally paused and no live provider keys. | Backup and isolated environment. | `/health/readiness`, migration state, login, lead/report read, counts/checksums, and no plaintext credentials pass; destroy the drill environment under the retention policy. | Backups may be unusable when needed. |
| [ ] | Release procedure | Before migration: set global pause, snapshot/backup, run repository tests/build, run data preflight from `docs/database-migration-runbook.md`, deploy one replica, run migration, then verify readiness/UAT smoke checks. | Approved release commit and backup. | Dated release record contains commit, operator, preflight, backup ID, migration output, and health result. | Dirty data blocks migration or partial launch occurs. |
| [ ] | Rollback procedure | Follow `docs/database-migration-runbook.md`: migration transaction failure rolls back automatically; post-migration code rollback uses the prior application image while preserving additive evidence tables/columns. Do not invoke the intentionally non-destructive `down()` as a data rollback. | Known-good deployment and snapshot/PITR. | Conduct nonproduction rollback drill and record application/data checks. | Destructive rollback may erase consent/billing/audit evidence. |
| [ ] | Incident/global shutdown | Document primary/backup contacts. To stop automation, set Railway `GLOBAL_AUTOMATIONS_DISABLED=true`, redeploy/restart, use Admin Pause for affected tenants, then confirm readiness reports global pause and no workers advance sends. | Railway access and platform admin. | Time a nonproduction drill; verify queued work is held/skipped and no provider request occurs. | No reliable stop during opt-out, isolation, or wrong-recipient incident. |

## G. Vercel

| Done / evidence | Platform | Exact setting and value format | Dependency | Verification step | Risk if omitted |
| --- | --- | --- | --- | --- | --- |
| [ ] | Vercel project variables | Production `BACKEND_API_URL=<api-origin>` (server-only; never `NEXT_PUBLIC_*`) and `NEXT_PUBLIC_SITE_URL=<frontend-origin>`. Remove obsolete `NEXT_PUBLIC_API_URL` if present. | Final Railway/Vercel domains. | Redeploy; browser network calls use `/api/backend/*`; no backend origin or auth token is read from browser storage. | Authentication proxy failure or exposed/cross-origin token flow. |
| [ ] | Vercel Domains | Set `<frontend-origin>` as canonical production domain; enforce HTTPS and correct redirect from alternate domains. | DNS access and public business name. | Test Test 1 pages, sitemap, robots, reset/verify/unsubscribe links, and no redirect loop. | Broken public/auth/legal links. |
| [ ] | Vercel deployments | Redeploy after every environment-variable change; enable failed-deployment alerts to primary and backup contacts. | Monitored incident contacts. | Change a harmless preview variable, redeploy, and confirm alert/release ownership. | Runtime retains stale provider/API configuration. |
| [ ] | Analytics/privacy | Current repository renders no analytics client. Keep analytics disabled unless counsel approves collection and a consent mechanism is implemented before enabling it. | Privacy review. | Browser network panel shows no analytics request/cookie during public/auth flows; privacy page matches actual behavior. | Undisclosed tracking/privacy noncompliance. |
| [ ] | Mobile verification | On current iOS Safari and Android Chrome, test home → pricing → apply success, contact, login, temporary-password change, dashboard readiness, support, billing portal handoff, unsubscribe, and legal pages. | Production deployment and test accounts. | Retain device/browser/version screenshots and no horizontal overflow or blocked CTA. | First-client public/access flows fail on common devices. |

## H. First-client go-live approval

Do not accept payment until every applicable item below has a dated evidence link and the final two written approvals are present.

| Approval evidence | Pass |
| --- | --- |
| Signed managed-service agreement and client SOW, including cancellation/refund/provider-cost terms | [ ] |
| Correct controlled/live payment and one-customer/one-subscription reconciliation | [ ] |
| Complete onboarding intake and named onboarding owner | [ ] |
| Counsel-reviewed consent language and lead-source evidence | [ ] |
| Required integrations connected, masked, routed, and tested | [ ] |
| Client-approved/versioned SMS and email templates | [ ] |
| All 21 tests in `docs/first-client-uat.md` pass on the release commit | [ ] |
| If AI is enabled: `ControlledAiLeadAgent1784937600001` is reviewed/applied, AI variables and authenticated SendGrid inbound routing are verified, and settings/knowledge are separately approved | [ ] / [ ] N/A |
| If AI is enabled: all 19 controlled journeys in `docs/controlled-ai-lead-agent.md` pass with retained provider, audit, usage, notification, Today, and tenant-isolation evidence | [ ] / [ ] N/A |
| If AI is enabled: workspace and platform AI pauses cancel pending AI work while login, inbox, manual messaging, lead intake, and appointments remain functional | [ ] / [ ] N/A |
| Two-tenant direct-ID isolation tests and production-like isolation matrix pass | [ ] |
| Backup/PITR configured and nonproduction restore drill passes | [ ] |
| Railway, Vercel, Stripe, Twilio, SendGrid, database, and mailbox alerts/reviews have owners | [ ] |
| Legal/privacy/communications review and tax decision retained | [ ] |
| Controlled live payment and reconciliation evidence retained | [ ] |
| Written client approval to activate the named services | [ ] |
| Written business owner approval to accept the first paid pilot | [ ] |
| Tested rollback/global-shutdown plan with incident contacts | [ ] |

Final release record:

- Deployed commit: ____________________
- Frontend origin: ____________________
- API origin: ____________________
- Tenant ID: ____________________
- Evidence folder: ____________________
- Client approver/date: ____________________
- Business owner approver/date: ____________________
- Platform operator/date: ____________________
