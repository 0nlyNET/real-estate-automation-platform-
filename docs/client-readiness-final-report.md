# RealtyTechAI client-readiness final report

> Messaging, AI, webhook, and launch-readiness conclusions in this July 19 report are superseded by `docs/realtytechai-messaging-reliability-report.md` (August 7, 2026). In particular, SendGrid delivery events are now reconciled and ambiguous network results are not automatically resubmitted.
>
> Provider ownership and credential-handling conclusions are also superseded by
> `docs/managed-provider-architecture.md`: RealtyTechAI owns the Twilio parent
> and SendGrid accounts, while tenant resources are provisioned and resolved
> server-side without exposing provider secrets to clients.

Evidence date: July 19, 2026 UTC  
Audited baseline: `0f4efffc105caf8d305a6d943a1ce220d47ec218` on `main`

## 1. Final verdict

`REPOSITORY READY FOR OWNER CONFIGURATION`

All repository-controlled launch blockers B1–B17 are implemented and the final repository checks pass. This is not a paid-pilot approval: production configuration, a real PostgreSQL preflight/migration and restore drill, provider configuration, legal/commercial decisions, the controlled live payment, and all 21 production UAT tests have no evidence yet.

## 2. Audit blockers closed

| Blocker | Status | Files changed | Behavior implemented | Test evidence | Remaining external dependency |
| --- | --- | --- | --- | --- | --- |
| B1 — Public applications | VERIFIED | `backend/src/modules/public/{prospect-application.entity,public.dto,public.service,public.controller,admin-applications.controller}.ts`; `frontend/app/apply/page.tsx`; admin dashboard | Validated/honeypot-protected application is committed before email; exact persisted success is returned; notification failure is retained and queued for operators. | `public.service.spec.ts`; frontend verification. | Configure SendGrid and a monitored `SALES_INBOX_EMAIL`; execute UAT Test 3. |
| B2 — Safe lifecycle/defaults | VERIFIED | tenant and tenant-settings entities; foundation migration | Explicit `ONBOARDING`, `ACTIVE`, `PAUSED`, `CANCELED`; new and migrated automation defaults off; global kill switch preserved. | Entitlement tests and migration reproduction. | Operator must approve/activate each real workspace. |
| B3 — Central entitlement/activation | VERIFIED | `modules/entitlements/*`; `modules/onboarding/*`; admin controller/UI | Billing, lifecycle, per-tenant automation, and global pause are evaluated centrally before protected actions; activation fails closed with explicit blockers. | Entitlement matrix and onboarding blocker tests. | Supply real billing, intake, provider, consent, client approval, and operator evidence. |
| B4 — Stripe correctness | VERIFIED | `billing.service.ts`, `stripe-plan-config.ts`, `stripe-webhook-event.entity.ts`, tenant billing fields | One server-only monthly service price; transaction/advisory lock and Stripe lookup prevent duplicate subscriptions; signatures checked; events claimed idempotently; existing stored legacy subscriptions remain compatible; unknown new prices fail closed. | Focused Stripe safety tests. | Create the live service price, webhook, portal, dunning/tax policy, and complete sandbox/live reconciliation. |
| B5 — Consent enforcement | VERIFIED | `compliance/{consent.dto,lead-consent-record.entity,compliance.service}.ts`; lead intake DTO/service; sequence/messaging checks | Per-channel evidence with disclosure/source/version/time; missing or revoked consent blocks automated contact and records a terminal skipped state. | Consent/messaging focused suite and lead safety tests. | Counsel-approved disclosure and client source authorization. |
| B6 — STOP/unsubscribe | VERIFIED | compliance unsubscribe controller/service; Twilio webhooks; frontend unsubscribe page | Case/whitespace-tolerant STOP revokes SMS consent and stops relevant enrollment; signed expiring email token revokes email only; replay is safe. | STOP, tampered/expired/repeated unsubscribe tests. | Controlled live Twilio/SendGrid UAT. |
| B7 — Truthful message state | VERIFIED | message entity/service, Twilio status webhook, inbox UI | Created/queued/sending/provider accepted/sent/delivered/failed/skipped/canceled are distinguishable; signed callbacks advance monotonically; provider errors are sanitized and visible. | `webhooks.status.spec.ts`, messaging tests, frontend Failed/status verification. | Install exact Twilio callback URL and review live provider activity. |
| B8 — Atomic work/retry | VERIFIED | messaging and sequences services; foundation claim/idempotency columns/indexes | PostgreSQL `FOR UPDATE SKIP LOCKED` claims with leases; logical-step idempotency; progressive 1/5 minute retry before third terminal attempt; permanent errors do not retry; failure task created. | Two-worker/no-double-send and retry-exhaustion tests. | Keep one replica until a production-like multi-replica/provider exercise is retained. |
| B9 — Onboarding/readiness | VERIFIED | `modules/onboarding/*`; client onboarding page; admin dashboard | Structured intake, conditional provider/service requirements, evidence timestamps, blockers, operator-only activate/pause, and launch-approval tasks. | Onboarding blocker/operator test and frontend readiness checks. | Complete real intake, provider tests, written client/operator approvals. |
| B10 — Operations control plane | VERIFIED | `modules/operations/*`; support module; public/admin modules; admin dashboard | Filtered priority/due/tenant/category queue; application/support/payment/integration/message/approval/cancellation/deletion tasks; assignment, acknowledgment, evidence, resolution/reopen. | Operations ordering/filter, support lifecycle, and failure-task tests. | Assign staff, SLA, mailboxes, and daily queue review. |
| B11 — Truthful public site | VERIFIED | public pages and shared marketing components; `public-plan-catalog.ts`; sitemap/robots | Unsupported LLC/address, certification, ROI, social automation, AI-content, Gmail/calendar, and performance claims removed; CTAs resolve; pricing never renders blank or invented numbers; blog placeholders unpublished. | Frontend verification passed, including 33 static links. | Owner/counsel supplies approved legal identity, packages, prices, and policies. |
| B12 — Accurate reporting | VERIFIED | stats service/controller/tests; lead-stage events; reports UI | Exact message-state totals, lead reply time, initial provider-acceptance time, five-minute acceptance, current stage vs period stage events, opt-outs, assignments; unavailable revenue/ROI/social/booking metrics removed. | `stats.service.spec.ts` fixture reconciles tenant-scoped source rows. | Reconcile a first-client sample to raw production records. |
| B13 — Auth/session hardening | VERIFIED | auth/user modules; `session-cookie.ts`; same-origin frontend proxy; login/logout/reset/temp-password UI | JWT lives in Secure/HttpOnly/SameSite cookie, not localStorage; session version revokes old JWTs; logout/reset/change/deactivate revoke; temporary passwords force change; impersonation expires after 15 minutes. | Auth, JWT, hashed-token, temp-password, and frontend storage checks. | Verify TLS/domains and live recovery email flows. |
| B14 — Isolation/credentials/CSP | VERIFIED | tenant-scoped lead/message/sequence/user/integration/stats services; integration encryption; CSP headers; migration FKs/uniques | Direct-ID operations enforce tenant predicates; managed tenant provider resources are encrypted and resolved server-side without client secret exposure; CSP/HSTS/security headers applied; legacy plaintext credentials fail readiness. | Focused isolation: 5 suites/14 tests; operational-log redaction and migration constraints. | Production-like two-tenant matrix; remediate any legacy plaintext rows found. |
| B15 — Health/observability | VERIFIED | health controller/module; `environment-readiness.ts`; `operational-log.ts`; `main.ts`; admin failure UI | Liveness and dependency/schema/migration readiness are separate; unsafe production config blocks startup; request IDs and redacted structured events cover critical failures; failures create operator work. | Environment, health/schema, log-redaction, provider/task tests; builds. | Configure Railway/Vercel/provider/database/mailbox monitoring and restore alerts. |
| B16 — UAT/owner contract | VERIFIED | `docs/first-client-uat.md`, `production-launch-owner-checklist.md`, `database-migration-runbook.md`, `production-operations-checklist.md` | All 21 UAT journeys have prerequisites, exact action, expected result, evidence, failure response, rollback, and pass/fail; A–H owner configuration is exact. | Document inspection and frontend link checks. | Owner must execute every applicable row and retain evidence. |
| B17 — Final verification | VERIFIED | this report; implementation tracker; tests across backend/frontend | Final serial suite, focused safety suites, lint, builds, audits, and diff hygiene passed; external work is not misreported. | 39 suites/106 backend tests; results in section 10. | All section 11 work remains before payment. |

## 3. Database changes

- Migration: `backend/src/database/migrations/202607190001-client-readiness-foundations.ts` (`ClientReadinessFoundations1784419200001`). It follows the existing legacy compatibility and production reconciliation migrations.
- New tables: `prospect_applications`, `stripe_webhook_events`, `onboarding_records`, `operations_tasks`, `lead_consent_records`, and `lead_stage_events`.
- Tenant fields: lifecycle/activation/pause timestamps, trial and current-period start, Stripe product/checkout/session timing, cancellation/payment-failure/latest-invoice, and billing-state timestamp.
- User fields: session version, forced-password-change flag, password/welcome/login timestamps, and compatibility timestamps.
- Message fields: provider state/timestamps, safe errors, unique idempotency key, lease owner/time, attempt time, and next retry.
- Sequence fields: enrollment tenant/lease; step approval, approver/time, template version, identity, and active state.
- Support fields: severity, assigned operator, SLA due/acknowledged/resolved timestamps, and resolution.
- Constraints/indexes: non-null sequence/credential/enrollment tenant ownership; tenant/lead/sequence/support/onboarding/consent/stage/Stripe foreign keys; unique message idempotency, Stripe event ID, tenant/provider credential, one onboarding record per tenant, per-lead/channel consent, and one active/paused sequence+lead enrollment; partial claim and queue indexes.
- Data audit: preflight must show zero orphan tenant/lead/sequence references, ambiguous missing tenant ownership, duplicate credentials/enrollments/idempotency/event IDs, and legacy plaintext credential rows. The migration does not guess or delete ambiguous data; it throws with counts.
- Verification: pg-mem PostgreSQL-compatible reproduction applies reconciliation plus the foundation migration to both the shipped legacy SQL baseline and an empty schema, checks 26 tables/columns, preserves legacy rows, and enforces representative uniqueness. A real Railway PostgreSQL migration was not run.
- Rollback: the migration is additive and transactional. `down()` is deliberately non-destructive. Pre-commit failure rolls back; post-commit application failure uses the prior image with automation paused; data recovery requires a verified backup/PITR restore and provider-event reconciliation.

## 4. Security changes

- Authentication storage: same-origin `/api/backend/*` proxy; JWT in `rtai_session` HttpOnly, SameSite=Lax cookie, Secure in production; access token removed from browser responses and auth localStorage.
- Session revocation: `session_version` is embedded/validated; logout, password reset/change, deactivation, and admin actions revoke prior sessions.
- Temporary passwords: admin-created accounts set `must_change_password`; protected use redirects to the forced change flow; welcome mail no longer claims activation.
- CSP: restrictive default/base/form/frame/object/connect rules, DENY framing, nosniff, referrer/permissions policies, HSTS in production, and HTTPS upgrade.
- Tenant isolation: tenant predicates were added to direct-ID and worker paths for leads, users/teams, messages, sequences/enrollments, credentials, reports, and provider routing; focused two-tenant tests pass.
- Credential handling: platform parent secrets and tenant-scoped provider secrets use AES-256-GCM with a base64 key decoding to exactly 32 bytes. Clients receive neither secret class; runtime resolution remains tenant-bound and readiness refuses legacy plaintext rows.
- Consent enforcement: protected sends require channel-specific affirmative evidence; STOP/unsubscribe revocation prevents subsequent automation; templates must be approved/versioned and material edits invalidate approval.

## 5. Billing changes

- Duplicate prevention: a tenant-scoped PostgreSQL advisory transaction lock, local checkout marker, Stripe subscription lookup, and in-progress/open-state checks prevent a second subscription/checkout.
- Price mapping: exactly `STRIPE_PRICE_SERVICE_MONTH` for new checkout. Client input cannot choose a plan, interval, price, or amount. Existing stored subscriptions keep their Stripe price and interval through a tenant/subscription match; unknown new price IDs fail closed and create critical work.
- Webhook idempotency: signature validation precedes persistence; unique Stripe event ledger claims/replays completed events and safely retries stale/failed processing.
- Synchronization: customer, subscription/status, mapped plan/interval/price/product, trial/period dates, cancellation state, latest invoice, failure time, and billing update time synchronize for checkout, subscription, and invoice events.
- Entitlement behavior: active or unexpired trial is eligible; past due is blocked after the explicit 0–14-day grace policy; incomplete/canceled/unpaid/unknown fail closed; lifecycle and automation gates still apply.
- Tests: focused Stripe run passed 2 suites/7 tests for duplicate checkout, invalid signature, replay, complete sync, unknown price, payment failure, and cancellation behavior.

## 6. Messaging changes

- Consent: channel-specific evidence is ingested with disclosure/version/source/time and checked immediately before each automated send.
- STOP: signed inbound Twilio processing recognizes normalized STOP keywords, revokes SMS consent, records evidence, and stops related future SMS work.
- Unsubscribe: every approved automated email must include `{{unsubscribeUrl}}`; generated links are signed, tenant/lead/email-bound, expiring, channel-specific, and replay-safe.
- Failure handling: provider acceptance is not delivery; transient 408/429/selected 5xx/network errors retry up to three attempts, permanent/config/consent errors do not retry, exhaustion becomes `failed`, and an operator task is created.
- Status callbacks: Twilio signature is verified; provider SID locates the correct tenant message; queued/sent/delivered/failed states advance monotonically with safe error code/text. SendGrid records API acceptance/rejection only; email delivery tracking is explicitly unavailable.
- Job claiming: messages and enrollments use PostgreSQL row locks with `SKIP LOCKED`, lease recovery, deterministic logical-step idempotency, and no advancement after an unintended outcome.
- Quiet hours: tenant timezone/quiet-hour calculations defer due work to the next allowed window and preserve order; DST/overnight tests are included.
- Operator visibility: inbox shows exact state, provider status/SID, safe failure reason, and attempt count; message/provider failures appear in operations.

## 7. Client onboarding and operations

- Application queue: persisted applications have status, owner, notes, notification state/error, created/updated timestamps, and admin actions.
- Intake: business/public identity/market, six contact roles, package/channels/sources/volume/reporting, routing/hours/escalation/follow-up, brand/sender/fair-housing acknowledgment, consent/source/opt-out, integration requirements, service toggles, and target launch are stored.
- Readiness: billing, identity, contacts, scope, routing, timezone/quiet hours, booking URL when enabled, brand, consent, tenant provider tests, approved channel templates, controlled lead/inbound/STOP/rejection tests, client approval, operator approval, billing evidence, and global pause are evaluated with explicit blockers.
- Activation: only platform admin routes can record operator evidence, activate, or pause. Activation changes lifecycle/automation only after every required item passes; blocked attempts create a task.
- Support queue: severity/SLA due time, owner, acknowledgment, notes, resolution/reopen, notification state, and operator visibility are implemented.
- Cancellation/deletion: authenticated requests create durable reviewed work and acknowledgments; no destructive automatic deletion occurs.
- Operational tasks: priority/status/tenant/category/owner/due/evidence/related-record filters and updates cover applications, missing intake, launch approvals, provider tests, messaging failures, payment/cancellation, support, and account requests.

## 8. Public-site changes

- Claims removed/corrected: invented entity/address/mailboxes, certifications, guaranteed response/ROI/results, automated social publishing, AI content, Gmail/calendar sync, ad management, revenue attribution, and unsupported client/performance numbers.
- CTA repairs: public navigation and buttons target real routes; application/booking/contact paths no longer point to missing anchors or success pages without persistence.
- Pricing: a single public catalog always displays `Contact for pilot pricing`; no blank dollar values or repository-invented price is rendered; billing checkout still uses only configured Stripe IDs.
- Contact/application: one validated application flow persists first and reports notification failure honestly; confirmation says the request was recorded, not that service is active.
- Legal pages: terms/privacy/refund/security copy describes actual behavior and leaves business-controlled identity/policy decisions to owner/counsel instead of fabricating them.
- Blog/SEO: fake articles and placeholder publication dates were removed; the blog states that no articles are published; sitemap/robots cover real public pages.

## 9. Reporting corrections

- Replaced undifferentiated “messages sent/delivered” with Created, Attempted, Provider Accepted, Sent, Delivered, Failed, Skipped, Canceled, and Opted Out. Failed/pending/skipped never count as delivered.
- Renamed provider-call timing to `Average initial outreach time`; source is lead creation to first provider-accepted outbound attempt.
- Renamed response metric to `Average lead reply time after first outreach`; source is first outbound outreach to first inbound reply.
- Renamed five-minute claim to `Initial outreach accepted within 5 minutes`; tooltip states provider API acceptance is not receipt/read.
- Split appointments into current `Appointment Set` leads and `Appointment Set movements` during the period. `verifiedBookings` is unavailable because calendar sync is absent.
- Added Leads created, Lead replies, Opt-outs, Team assignments, current stage, and source breakdowns with tenant/user scoping.
- Removed/hid social performance, revenue generated, closed-deal attribution, time saved, ROAS, and campaign ROI.
- Added exact from/to, workspace timezone, source list, status definitions, sample counts, and known limitations (including absent SendGrid delivery events/calendar sync).

## 10. Verification evidence

| Exact command | Result |
| --- | --- |
| `cd backend && npm run lint` | Passed; 0 errors/warnings. |
| `cd backend && npm test -- --runInBand` | Passed after the final production-code change: 39/39 suites, 106/106 tests, 0 snapshots. |
| `cd backend && npm run build` | Passed. |
| `cd frontend && npm run lint` | Passed with 0 errors and 57 non-blocking warnings. |
| `cd frontend && npm test` | Passed; client-readiness verification and 33 static links/claims checked. |
| `cd frontend && npm run build` | Passed; TypeScript compiled and 46 routes generated. |
| `cd backend && npm test -- --runInBand src/database/production-schema-reconciliation.spec.ts src/database/migrations/202607180001-legacy-auth-compatibility.spec.ts src/database/schema-readiness.spec.ts src/database/schema.smoke.spec.ts` | Passed: 4 suites/7 tests. This is automated migration/schema reproduction, not a live production migration. |
| `cd backend && npm test -- --runInBand src/modules/users/users.tenant-isolation.spec.ts src/modules/leads/leads.safety.spec.ts src/modules/sequences/sequences.service.spec.ts src/modules/messaging/messaging.service.spec.ts src/modules/integrations/integrations.service.spec.ts` | Passed: 5 suites/14 tests. |
| `cd backend && npm test -- --runInBand src/modules/billing/billing.safety.spec.ts src/modules/billing/billing.service.spec.ts` | Passed: 2 suites/7 tests. Expected test-path warning/error events were exercised. |
| `cd backend && npm test -- --runInBand src/modules/messaging/messaging.service.spec.ts src/modules/webhooks/webhooks.status.spec.ts src/modules/compliance/compliance.enforcement.spec.ts` | Passed: 3 suites/9 tests. |
| `cd backend && npm audit --omit=dev --audit-level=high` | Passed; 0 vulnerabilities reported. |
| `cd frontend && npm audit --omit=dev --audit-level=high` | Passed; 0 vulnerabilities reported. |
| `git diff --check` | Passed. |

No Railway/Vercel deployment, production PostgreSQL migration, provider test, backup restore, sandbox/live payment, or production UAT was performed; those require owner accounts, secrets, infrastructure, legal decisions, and client authorization.

## 11. Owner-only launch actions

The exhaustive checkbox contract is `docs/production-launch-owner-checklist.md`. Every row there supplies the same six fields below; this table is the launch-blocking summary of work Codex could not physically complete.

| Platform | Exact setting/value format | Dependency | Verification step | Risk if omitted |
| --- | --- | --- | --- | --- |
| Corporate/legal/commercial | Approve real legal/public names, address, jurisdiction; monitored `support@…`, `billing@…`, `privacy@…`, `legal@…`, `sales@…`, `operations@…`; the one setup scope, one monthly service price, provider-cost/allowance terms, cancellation/refund/support/onboarding rules, signed MSA/SOW, consent/privacy/fair-housing review, tax, and E&O/cyber decisions. | Owner, counsel, accountant, broker, client. | Signed/versioned decision sheet reconciles agreement, site, Stripe, mail, and UAT; external Gmail/Outlook mailbox tests. | Misrepresentation, unauthorized contact, missed notices, tax/insurance/contract exposure. |
| SendGrid/DNS | Authenticate the final domain; provider-issued SPF/DKIM DNS; approved DMARC such as `v=DMARC1; p=none; rua=mailto:<dmarc-mailbox>`; restricted `SG.…` key in Railway `SENDGRID_API_KEY`; `SENDGRID_FROM_EMAIL=<verified-sender@domain>`, `SENDGRID_FROM_NAME=<approved name>`, `SALES_INBOX_EMAIL=<monitored mailbox>`. | Approved domain/name/mailboxes and DNS access. | SendGrid authenticated; Gmail/Outlook headers pass SPF/DKIM; verification/reset/welcome/application/support/cancellation/deletion mail and links pass; spam placement reviewed. | Mail failure/spoofing, broken recovery, lost applications/support. |
| Stripe account/catalog | Complete account/business/bank verification; create one approved monthly recurring service `price_…`; set Railway `STRIPE_SECRET_KEY=sk_live_…`, `STRIPE_PRICE_SERVICE_MONTH=price_…`, and `STRIPE_WEBHOOK_SECRET=whsec_…`; configure portal, receipts, branding, descriptor, dunning, cancellation, and the written tax decision. | Legal/commercial/tax decisions and live Stripe access. | `/health/readiness` billing up; inspect the service checkout; verify portal/payment method, receipts/invoices, tax, and no unknown mapping. | Wrong charge/tax, blocked payout, entitlement mismatch. |
| Stripe webhook/UAT | Endpoint `<api-origin>/billing/webhook`; events `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.payment_succeeded|failed`, `refund.created`, and `charge.dispute.created`; perform sandbox checkout/duplicate/renewal/failure/cancel/refund and one approved low-value live payment. | Public API, live service price/secret, UAT tenant, owner approval. | Unique completed event ledger; one customer/subscription; tenant dates/status reconcile to Stripe/invoice/receipt/payout; retain IDs then follow refund plan. | Duplicate/missed/forged billing state or first-client mischarge. |
| Twilio | Client authorization; A2P 10DLC/toll-free approval; tenant-specific SID/token/number or Messaging Service saved in Integrations; inbound POST `<api-origin>/webhooks/twilio/inbound`; Railway `TWILIO_WEBHOOK_URL` identical; `TWILIO_STATUS_CALLBACK_URL=<api-origin>/webhooks/twilio/status`. | Signed use case/consent, registered sender, final API domain. | Controlled outbound/inbound/STOP/rejection/replay and two-tenant routing; retain Message SID/callback/task evidence; assign daily log owner. | Carrier blocking, wrong tenant/recipient, opt-out breach, invisible failure. |
| Meta, only if sold | `FACEBOOK_APP_ID=<numeric>`, secret, `FACEBOOK_REDIRECT_URL=<api-origin>/integrations/facebook/callback`, `FACEBOOK_WEBHOOK_URL=<api-origin>/webhooks/facebook/lead-ads`, `FACEBOOK_WEBHOOK_VERIFY_TOKEN=<32+-char-random>`, pinned `FACEBOOK_GRAPH_API_VERSION=vN.N`; approved Page/app permissions. | Meta Business/App Review and client Page admin. | OAuth callback, webhook challenge/leadgen subscription, one deduplicated consented test lead in the correct tenant. | No/wrong-tenant lead delivery. Mark N/A with evidence if Meta is not in scope. |
| Railway application | `NODE_ENV=production`, `FRONTEND_URL`/`PUBLIC_APP_URL=<frontend-origin>`, `JWT_SECRET=<32+-char-random>`, `PLATFORM_ADMIN_EMAILS=<lowercase CSV>`, `INTEGRATIONS_ENCRYPTION_KEY=<base64 exactly 32 bytes>`, optional independent unsubscribe secret, `GLOBAL_AUTOMATIONS_DISABLED=true` during setup, `BILLING_GRACE_DAYS=<0..14>`, all provider values above. | Final domains, approved admins/policy, secret ceremony. | Production startup succeeds; admin allow-list works; readiness components are up; secrets absent from client/log evidence. | Forged sessions, unsafe sends, unavailable integrations/admin. |
| Railway/PostgreSQL | `DATABASE_URL=postgresql://…`, `DATABASE_SSL=true`, `TYPEORM_SYNC=false`, `RUN_MIGRATIONS=true`; one replica; healthcheck `/health/readiness`, optional liveness `/health/live`; deployment/crash/resource alerts. | Managed DB, backup, release commit, alert recipients. | Run documented read-only preflight, backup/restore drill, `migration:show/run/show`, HTTP 200 ready, zero plaintext credential rows, smoke/UAT; alert drill. | Schema/data loss, dirty migration, duplicate work, invisible outage. |
| PostgreSQL recovery | Scheduled backup/PITR if available; retention/RPO/RTO; restore newest backup to isolated nonproduction with global pause and no live keys; preserve additive migration on code rollback. | Appropriate plan and DB operator. | Login/read/report/count/checksum/readiness on restore; documented forward/rollback/global-shutdown drills. | Backups may be unusable; consent/billing evidence may be destroyed. |
| Vercel | Server-only `BACKEND_API_URL=<api-origin>`; `NEXT_PUBLIC_SITE_URL=<frontend-origin>`; remove obsolete `NEXT_PUBLIC_API_URL`; canonical HTTPS domain; redeploy after env changes; deployment alerts; keep analytics disabled unless reviewed/consented. | Final domains and Vercel/DNS access. | Browser uses only `/api/backend/*`; public/auth/legal/reset/verify/unsubscribe flows pass; no auth localStorage or analytics request; iOS Safari/Android Chrome matrix. | Broken auth/proxy/links, stale config, undisclosed tracking, mobile failure. |
| First-client approval | Evidence for signed MSA/SOW, payment, intake, consent, integrations, approved/versioned templates, all 21 UAT tests, production-like two-tenant matrix, backup restore, alerts, legal/tax review, controlled live payment, client approval, owner approval, rollback/global shutdown. | All rows above and named client/operator. | Complete section H release record with deployed commit, origins, tenant ID, evidence folder, approvers, and dates; only then activate named services. | Accepting payment before operational, legal, billing, and messaging safety is proven. |

## 12. Unresolved issues

### Launch blockers

- No evidence exists for any owner/platform configuration in section 11.
- The production PostgreSQL data preflight, backup/PITR configuration, restore drill, migration, readiness check, and rollback drill have not run.
- SendGrid, Stripe, Twilio, and conditional Meta production configuration/provider tests have not run; no controlled live payment/reconciliation exists.
- Legal identity, contract/SOW, commercial terms, consent/privacy/communications/fair-housing review, tax, insurance, client approval, and owner approval are unresolved.
- The 21-test UAT and production-like two-tenant acceptance matrix are not executed. Payment must not be accepted yet.

### Paid-pilot risks

- SendGrid event-webhook delivery tracking is not implemented. Email reports expose provider acceptance/rejection, never delivery.
- First launch must remain one backend replica until the tested Postgres claims are exercised with real provider traffic in a production-like multi-replica run.
- Operational safety depends on humans actually monitoring the admin queue, provider dashboards, alerts, and mailboxes to the documented SLA.

### Post-launch improvements

- Add a verified SendGrid Event Webhook and monotonic email delivery/bounce state processing.
- Resolve the frontend's 57 non-blocking ESLint warnings and add browser-driven accessibility/mobile regression tests beyond static verification.
- Exercise and document safe scale-out after the first-client controlled worker test.
- Remove the inherited npm `http-proxy` configuration before a future npm major version; it emitted a toolchain deprecation warning but did not affect checks.

### Optional future features

- Meta Lead Ads remains optional unless sold to the client.
- Calendar/Gmail synchronization, verified booking sync, social publishing, AI content, attribution/ROI, MFA/SSO, and advanced workflows remain intentionally outside the pilot scope.

## 13. First-client decision

The repository-side implementation is complete, but the owner must complete the listed external configuration and acceptance tests before accepting payment.
