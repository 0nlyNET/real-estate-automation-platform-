# Dashboard and session repair after PR #54

Evidence date: September 6, 2026. Base: `c01f0fb3797441bb7cf5dd215bb55366630a1e6f` (merged PR #54). This report covers the new repair; it does not repeat historical browser claims from `client-readiness-final-report.md`.

## 1. Root causes

| Problem | Established cause and PR #54 relationship |
| --- | --- |
| Integrations opens Billing; navigation appears ineffective | PR #54's frontend proxy redirected every restricted operational route to Billing/Support. The profile href was already `/app/integrations`; shared authorization redirected it after the click. The six route definitions exist. Source inspection found no shared pointer-events overlay explaining the symptom. |
| Unexpected login redirects | The proxy retried `/me` twice with five-second deadlines, then treated network errors, malformed responses and server errors as unauthenticated. PR #54 added entitlement work to `/me`, exposing authentication to billing/database failures. Admin restoration also used a helper that collapsed all failures to `null`. Feature-level 401 responses immediately triggered login navigation without confirming the session. |
| Long waits / admin skeletons | The same-origin API proxy had no upstream deadline. Vercel's production deployment `dpl_HGmonCaja3ouZFvrSd4AdmrTYzZE` recorded 24 request timeouts at 300 seconds between 19:25:53 and 19:33:31 UTC. Affected requests included `/me`, admin overview/operations/system health/setup checker, notifications and read-all. One public health request took 7.75 seconds. These establish an upstream availability problem, but do not identify its Railway/network/database cause. |
| Excess requests and coupled loading | Protected-link prefetch added authenticated requests; repeated health/setup requests duplicated database work. System health ran three independent queries sequentially. Health and integration screens withheld successful results until unrelated requests completed; one integration failure discarded all seven sections. |
| Notifications fail silently | Mutation failures were not caught, `{ok:false}` was treated as success, and there was no distinct single-item read control. PR #54 payment gating also blocked unpaid clients' own notification endpoints. List, summary, preferences and device initialization were unnecessarily coupled. |
| Misleading integration state | An active Zapier configuration was labeled Connected without successful test evidence. Generic intake-key presence was described as Ready. These were existing UX defects, not proof of a successful provider connection. |

## 2. Implemented repair

- Added `/auth/session`: authenticated identity and current platform role from the existing JWT strategy, without entitlements/provider lookups. Existing active-account, verified-email, tenant, token expiry, session-version and impersonation checks still apply.
- Navigation performs one bounded identity check (eight seconds). Only authoritative 401 means expired/revoked. Temporary failures rewrite to a retryable 503 page, retain the requested URL/cookie, and expose no protected page content. A 404-only `/me` fallback supports backend rollout compatibility.
- Moved client payment presentation into an explicit initializing/error/verified access guard. Restricted users see an explanation at their selected route with payment/support recovery. Operational children do not mount before verified access. Payment requirements remain enforced by backend guards; Integrations does not become an unpaid API bypass.
- Centralized all six client navigation destinations, exposed all six on mobile, retained correct account-menu destinations, and disabled speculative prefetch on shared client/admin links.
- API reads time out after 12 seconds upstream; mutations after 60 seconds. Browser limits are 15/65 seconds. The upstream deadline includes reading the response body. Errors return sanitized 502/504 responses with retry guidance; there is no automatic mutation retry. Tenant/auth responses remain private and uncached.
- A feature 401 now causes one coalesced session check; only its 401 redirects. Admin restoration has explicit initialization, failure and retry states. Identity requests coalesce only while in flight, with no completed session cache.
- Notifications have separate single/all read actions, visible errors, immediate successful state/count changes, background reconciliation and stale-response protection. Unpaid users can access their own notifications. UUID validation and recipient-filtered SQL remain enforced; missing/foreign IDs return 404.
- Health queries run concurrently and overlapping callers share only the current computation. Independent health and integration results render as they resolve. Integration testing/failure/configured states are explicit; Zapier requires successful test evidence before Connected.
- Assistant requests retain outcome-reconciliation behavior after the new proxy timeout/unavailable responses, avoiding premature retries of potentially completed requests.

No new dependencies, migrations, production data edits, token lifetime extensions or provider credentials were introduced.

## 3. Authentication/session status

**PASS locally; deployed authenticated browser verification remains pending.** Cookies remain HttpOnly, Secure in production, SameSite=Lax and same-origin through `/api/backend`; JWT and cookie lifetimes remain aligned (12 hours, or 30 days when remembered). There is no refresh-token architecture to rotate. Refresh/navigation still validates the current session with the backend; slow services no longer mean logout. Actual 401, explicit logout and revoked/expired sessions still end access. Payment or authorization failure does not clear authentication.

## 4. Performance status

The repair removes duplicate route retries, speculative protected-link requests, sequential health queries and cross-section load barriers. It bounds previously 300-second proxy waits without claiming to repair an unobserved infrastructure cause. Successful sections no longer wait for a failed optional section.

Local production builds were exercised against isolated PGlite data. Session calls were single-digit milliseconds and client/admin requests completed without hanging. These are small-fixture startup checks, not production latency benchmarks; fixture password hashes use a reduced work factor. Railway resource saturation, connection-pool pressure, database query plans and production p95 remain unverified. No speculative indexes were added.

## 5. Client dashboard status

`PASS` below means local executable regression/HTTP verification. It does **not** certify live browser clicking or provider delivery.

| Area | Status | Evidence / remaining work |
| --- | --- | --- |
| Today | PASS | Navigation guard and actual Today endpoint. |
| Leads | PASS | Navigation guard and actual tenant lead endpoint. |
| Conversations | CONFIGURATION REQUIRED | Owned history passes; foreign workspace denied. Existing outbound queue/provider/delivery tests pass. Actual local submission correctly rejects missing consent; live consent, SendGrid and mailbox round trip remain. |
| Appointments | PASS | Navigation and actual appointments/calendar-status endpoints; external calendar sync requires the selected provider. |
| Integrations | CONFIGURATION REQUIRED | Paid and unpaid built-page requests retain `/app/integrations` with HTTP 200; access guard preserves payment rules. Seven data sources, status/error handling and menu href verified. Real credentials/tests still required. |
| AI Assistant | CONFIGURATION REQUIRED | Route/authorization, status/history, submission/error/reconciliation tests pass. Live model response needs project credentials/provider validation. |
| Notifications | PASS | Executed single/all/error handlers and actual JWT/SQL read persistence, unread counts, CSRF/RBAC and recipient isolation. |

## 6. Admin dashboard status

| Area | Status | Scope |
| --- | --- | --- |
| Login | PASS | Actual built backend HTTP login and cookie issuance; not a production login benchmark. |
| Session persistence | PASS | Repeated cookie authentication, expiry/revocation tests and explicit restoration/error states. |
| Navigation | PASS | Route/RBAC regressions and built dashboard HTTP response. Authenticated browser tab clicks remain pending. |
| Dashboard loading | PASS | Actual overview/tenants/operations requests; independent bounded section loading. |
| System health | PASS | Actual health/setup responses; concurrent query, shared in-flight and failure-recovery tests. |
| Billing | CONFIGURATION REQUIRED | Actual billing-overview API and existing payment tests pass; real Stripe checkout/webhooks remain. |
| Audit log | PASS | Actual audit API and existing access controls. |
| Settings | PASS | Access/settings APIs and existing RBAC/routing checks; provider settings require the configuration below. |

## 7. Tests and limits

| Command / validation | Result |
| --- | --- |
| `cd backend && npm test -- --runInBand` | 122 suites / 625 tests passed; two PostgreSQL-specific suites / five tests skipped without `TEST_POSTGRES_URL`. Repository CI supplies PostgreSQL 15 and is the authoritative full-database gate. |
| `cd frontend && npm test` | All six scripts passed: client readiness, admin routing, assistant workflows, security boundaries, first client, session/navigation. The new script executes real route/component handlers through deterministic test doubles; it is not a DOM browser test. |
| `cd backend && npx tsc --noEmit`; `cd frontend && npx tsc --noEmit` | Both passed. |
| `npm run lint` in backend and frontend | Backend passed; frontend zero errors, 46 existing warnings. |
| `npm run build` in backend and frontend | Both production builds passed. |
| `node scripts/secret-scan.mjs`; `node scripts/workflow-security-scan.mjs` | Passed; no production secrets committed. |
| `node scripts/verify-production-artifacts.mjs` | Passed; 55 public build files checked, no public source maps. |
| `git diff --check` | Passed. |
| Production backend startup | Existing SQL baseline plus all 25 migrations; 60 entity tables and readiness HTTP 200. Isolated synthetic accounts, real JWT/cookies and real SQL. PGlite's transport required a test-only one-connection pool shim outside the repository; it is not a PostgreSQL concurrency benchmark. |
| Production browser / logs | Public deployed login loaded; read-only production runtime logs inspected. No authenticated production credentials/session were available. The connected browser blocked the local preview address (`ERR_BLOCKED_BY_CLIENT`); authenticated browser client/admin flows and console/network checks could not be completed in this run. |

## 8. Exact owner configuration checklist

**Current production presence is UNKNOWN for every secret/provider setting below.** No environment-secret inventory or authenticated provider state was accessible. Unknown does not mean missing: retain existing valid values and add/fix only absent or failed settings. This is the complete checklist for the email-first workflow; optional calendars/push/SMS are labeled separately.

| Variable / setting | Location and source | Missing now? | Verification |
| --- | --- | --- | --- |
| `NODE_ENV=production`, `DATABASE_URL`, `DATABASE_SSL`, `DATABASE_SSL_REJECT_UNAUTHORIZED`, `TYPEORM_SYNC=false`, `RUN_MIGRATIONS=true` | Railway backend; Railway/PostgreSQL supplies URL and TLS policy | Unknown | Deploy/start, authenticated `/health/readiness`: schema up, no pending migrations; inspect backend DB/pool errors. |
| `JWT_SECRET` (32+ random characters), `INTEGRATIONS_ENCRYPTION_KEY` (base64 32 random bytes), `PLATFORM_ADMIN_EMAILS`, `HEALTH_CHECK_TOKEN` (32+ random characters) | Railway backend; owner-generated secrets and exact admin emails | Unknown | Login, refresh and admin access; readiness using health token. Preserve existing encryption key to keep saved credentials decryptable. |
| `FRONTEND_URL`, `PUBLIC_APP_URL` = canonical frontend HTTPS origin; `PUBLIC_API_URL` = Railway HTTPS origin | Railway backend; deployment domains | Unknown | Cookie login and allowed-origin mutations succeed; provider callback URLs resolve to backend. |
| `BACKEND_API_URL` = backend origin; `NEXT_PUBLIC_SITE_URL` = canonical frontend origin | Vercel production/preview environment; deployment domains | Unknown | `/api/backend/health/live` responds promptly; no direct cross-origin browser API calls. `BACKEND_API_URL` is server-only. |
| `BILLING_GRACE_DAYS=0`; `GLOBAL_AUTOMATIONS_DISABLED=true` during setup, then `false` for controlled validation | Railway backend; owner | Unknown | Unpaid API access denied; verified paid workspace recovers; only enable automation after provider/client approval. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_SERVICE_MONTH` (recurring service price), `STRIPE_PRICE_SETUP_ONCE` (one-time setup price) | Railway backend; Stripe Dashboard, same account/mode | Unknown | Real controlled Checkout reaches paid subscription evidence for the current subscription. Do not set payment flags manually. |
| Stripe webhook `<PUBLIC_API_URL>/billing/webhook`; `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed` | Stripe Dashboard | Unknown | Signed deliveries return 2xx; paid access, failed-payment restriction and recovery reconcile correctly. |
| `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `SENDGRID_FROM_NAME`, `SALES_INBOX_EMAIL` | Railway backend; SendGrid key/authenticated sender and monitored sales inbox | Unknown | Deliver real invitation/reset/account email and receive it. |
| Platform SendGrid credential; workspace sender name/address and unique reply address | Admin platform integrations and workspace assignment; SendGrid/owner | Unknown | Save then run real test; Connected only after success; receive the message in a controlled mailbox. |
| `SENDGRID_SENDING_DOMAIN`, `SENDGRID_REPLY_DOMAIN`; sender authentication, SPF/DKIM/DMARC records and reply domain Inbound Parse MX | Railway backend, DNS host and SendGrid | Unknown | Provider domain checks and actual send/reply pass before recording `SENDGRID_SPF_VERIFIED_AT`, `SENDGRID_DKIM_VERIFIED_AT`, `SENDGRID_DMARC_VERIFIED_AT`. |
| `SENDGRID_INBOUND_USERNAME`, `SENDGRID_INBOUND_PASSWORD`; `SENDGRID_INBOUND_WEBHOOK_URL=<PUBLIC_API_URL>/webhooks/sendgrid/inbound`; `SENDGRID_EVENT_WEBHOOK_URL=<PUBLIC_API_URL>/webhooks/sendgrid/events` | Railway backend and SendGrid Parse/Event Webhooks | Unknown | Configure supported OAuth client credentials: token endpoint `<PUBLIC_API_URL>/webhooks/sendgrid/oauth/token`, client ID = inbound username, secret = inbound password. A real reply creates history; delivery events update outbound state. |
| `OPENAI_API_KEY`, `OPENAI_MODEL`; optional `OPENAI_ASSISTANT_MODEL` override | Railway backend; OpenAI project with model access | Unknown | Admin provider test then one client assistant request returns a real response; no key in browser bundle. |
| Workspace brokerage/identity, service area, approved knowledge, email channel, client onboarding details and affirmative lead consent | Admin/client onboarding and AI configuration; client/owner | Unknown | Approve configuration, complete controlled validation/activation; consent-free sends remain rejected. |
| Booking link (optional) | Client Integrations; client's Calendly link | Unknown / optional | Save and test the URL; OAuth is unnecessary for link-only scheduling. |
| Google sync (optional): `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`; optional `GOOGLE_CALENDAR_WEBHOOK_URL` | Railway + Google Cloud Calendar API; callback `<PUBLIC_API_URL>/calendar/google/oauth/callback`, notification endpoint `/calendar/google/notifications` | Unknown / optional | Enable Calendar API, register exact callback, connect workspace, confirm a real appointment sync. |
| Microsoft sync (optional): `MICROSOFT_CALENDAR_CLIENT_ID`, `MICROSOFT_CALENDAR_CLIENT_SECRET`; optional `MICROSOFT_CALENDAR_WEBHOOK_URL` | Railway + Entra organizational-account app; callback `<PUBLIC_API_URL>/calendar/microsoft/oauth/callback`, notification endpoint `/calendar/microsoft/notifications` | Unknown / optional | Register exact callback, grant requested calendar consent, connect and verify appointment sync. |
| Calendly sync (optional): `CALENDLY_CLIENT_ID`, `CALENDLY_CLIENT_SECRET`, `CALENDLY_WEBHOOK_SIGNING_KEY`; optional `CALENDLY_WEBHOOK_URL` | Railway + Calendly OAuth app; callback `<PUBLIC_API_URL>/calendar/calendly/oauth/callback`, notification endpoint `/calendar/calendly/notifications` | Unknown / optional | Connect workspace and verify a real signed booking/cancellation event. |
| Phone push (optional): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Railway; owner-generated VAPID pair | Unknown / optional | Subscribe device and receive a test push. In-app mark-as-read needs no VAPID configuration. |
| `BACKUP_RESTORE_TESTED_AT`, `BACKUP_RPO_MINUTES` ≤60, `BACKUP_RTO_MINUTES` ≤240, `BACKUP_RETENTION_DAYS` ≥7, `BACKUP_RESTORE_ISOLATED_VERIFIED=true`, `BACKUP_RESTORE_CREDENTIALS_PROTECTED=true`, `LEGAL_DOCUMENTS_REVIEWED_AT`, `EXTERNAL_UPTIME_MONITOR_URL` | Railway and existing restore/legal/monitoring process; owner and providers | Unknown | Complete existing activation gates with genuine evidence: restore within 90 days, legal review within 365 days, external monitor healthy. |

SMS/Twilio is optional and not required for the email-first client; its separate provider, sender registration and delivery-callback flow remains in existing setup documentation. No Facebook configuration is required.

## 9. Remaining blockers

1. Review/merge and deploy both backend and frontend repair. Deploy backend first. No new migration is required; retain PR #54's migration/payment reconciliation.
2. Confirm deployed upstream health and explain any continuing Railway/DB/network delays. Bounded errors improve recovery but cannot make an unavailable backend healthy.
3. Complete authenticated browser acceptance on the deployed repair: client six tabs, notification single/all and refresh, profile Integrations/Billing; admin tabs/refresh and partial health failure. Observe console/network and real timings.
4. Verify the owner-controlled configuration above and pass one controlled invitation → payment → inbound email → manual reply → AI response → booking flow, including delivery state and failed-payment recovery. No real provider delivery or first-client activation was certified here.

## 10. Pull request / merge guidance

Branch: `codex/repair-dashboard-sessions-20260906`. The repair is intended for review and CI, not automatic merge. Require green repository checks before merging, then deploy backend and frontend together as described above. Passing code checks is not first-client production certification. See the PR for current commit IDs and CI results.
