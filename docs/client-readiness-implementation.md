# RealtyTechAI client-readiness implementation

## Repository baseline

- Repository: `0nlyNET/real-estate-automation-platform-`
- Branch at start: `main`
- Audited and inspected commit: `0f4efffc105caf8d305a6d943a1ce220d47ec218` (`0f4efffc`)
- Baseline result: the worktree began exactly at the audited commit; no newer repository fixes required preservation.
- Production schema policy: TypeORM migrations with `TYPEORM_SYNC=false`.

Status values: `NOT STARTED` · `IN PROGRESS` · `IMPLEMENTED` · `VERIFIED` · `EXTERNAL OWNER ACTION` · `BLOCKED`.

## Repository map

| Area | Source of truth |
| --- | --- |
| Workspace/lifecycle/billing state | `backend/src/modules/tenants/tenant.entity.ts`, `tenants.service.ts`, `stripe-billing-update.ts` |
| Tenant automation/settings | `backend/src/modules/settings/tenant-settings.entity.ts`, `settings.service.ts` |
| Users/auth/session | `backend/src/modules/users/*`, `backend/src/modules/auth/*`, `frontend/app/api/backend/[...path]/route.ts` |
| Stripe checkout/portal/webhook | `backend/src/modules/billing/*` |
| Entitlement/activation | `backend/src/modules/entitlements/*`, `backend/src/modules/onboarding/*` |
| Lead intake/manual lead/stage | `backend/src/modules/leads/*` |
| Consent/STOP/unsubscribe | `backend/src/modules/compliance/*`, `backend/src/modules/webhooks/*`, `frontend/app/unsubscribe/*` |
| Sequences/enrollments/worker | `backend/src/modules/sequences/*` |
| Messages/provider send/worker | `backend/src/modules/messaging/*`, `backend/src/common/providers.ts` |
| Tenant provider credentials/tests | `backend/src/modules/integrations/*`, `backend/src/modules/settings/credential.entity.ts` |
| Public applications | `backend/src/modules/public/*`, `frontend/app/apply/page.tsx` |
| Support/cancellation/deletion | `backend/src/modules/support/*`, `frontend/app/app/support/page.tsx` |
| Admin applications/operations | `frontend/app/admin/dashboard/page.tsx`, `backend/src/modules/public/admin-applications.controller.ts`, `backend/src/modules/operations/*` |
| Reporting | `backend/src/modules/stats/*`, `frontend/app/app/reports/page.tsx` |
| Public truth/CTA/legal | `frontend/app/{page,features,use-cases,pricing,contact,apply,blog,privacy,terms,refund,security}.tsx` and shared marketing components |
| Health/config/logging | `backend/src/modules/health/*`, `backend/src/common/environment-readiness.ts`, `operational-log.ts` |
| Schema/migrations | `backend/src/database/entities.ts`, `database-options.ts`, `migrations/*` |
| Launch procedures | `docs/first-client-uat.md`, `docs/production-launch-owner-checklist.md`, `docs/database-migration-runbook.md` |

## Audit blocker tracker

| ID | Requirement | Status | Repository evidence | Test/evidence | External dependency |
| --- | --- | --- | --- | --- | --- |
| B1 | Persist public applications independently of email | VERIFIED | `prospect-application.entity.ts`, `public.service.ts`, admin applications controller/UI | `public.service.spec.ts`: persistence survives both email failures, validation/honeypot checks; frontend success-state verification | Configure/monitor SendGrid and `SALES_INBOX_EMAIL` |
| B2 | Automation off by default and explicit lifecycle | VERIFIED | Tenant lifecycle fields/defaults, tenant-settings false default, migration disables prior true values | Entitlement and migration reproduction tests | Operator must review/activate each real tenant |
| B3 | Central entitlement and server activation gate | VERIFIED | `EntitlementService`, `OnboardingService.readiness/activate/pause`, platform-admin routes | Active/trial/past-due/canceled/global pause tests; activation-blocker test | Owner supplies billing/intake/provider/client approval evidence |
| B4 | Stripe mapping, duplicate prevention, signed/idempotent sync | VERIFIED | Central four-price mapping, advisory checkout lock, event ledger, full state sync, unknown-price/payment/cancellation tasks | `billing.safety.spec.ts`, `billing.service.spec.ts` | Live products/prices, webhook, portal, dunning, tax, controlled payment |
| B5 | Channel-specific consent evidence and eligibility | VERIFIED | `lead_consent_records`, consent DTO/service, lead ingestion, entitlement/template checks | `compliance.enforcement.spec.ts` and lead safety tests | Counsel-reviewed consent language and client source authorization |
| B6 | STOP and secure email unsubscribe | VERIFIED | Twilio keyword handling/revocation/enrollment stop; signed expiring unsubscribe route/page | STOP cancellation and valid/tampered/repeated unsubscribe tests | Live Twilio/SendGrid controlled UAT |
| B7 | Truthful provider/message state and callbacks | VERIFIED | Message state fields/UI, Twilio signed status callback, monotonic state mapping | `webhooks.status.spec.ts`, frontend Failed/status checks | Exact Twilio callbacks and provider delivery review |
| B8 | Atomic claims and bounded retries | VERIFIED | Postgres `FOR UPDATE SKIP LOCKED`, leases, idempotency, three-attempt backoff/exhaustion task | Two-worker and exhaustion tests; migration unique/index checks | Keep one production replica until controlled multi-replica exercise |
| B9 | Structured onboarding and operator-only activation | VERIFIED | Onboarding JSON sections, conditional readiness items/evidence, Admin activation/pause, client UI | Explicit-blocker/operator activation tests; frontend readiness verification | Complete real intake, tests, client/operator written approval |
| B10 | Persisted applications/operations/support/cancellation/deletion control plane | VERIFIED | `operations_tasks`, admin filters/update UI, support SLA fields, follow-up tasks | Public/support tests and integration/payment/message task assertions | Staff monitored queue/mailbox and assign owners/due dates |
| B11 | Truthful public claims, CTA, pricing, and legal content | VERIFIED | Marketing copy/navigation repaired; central nonblank public catalog; legal pages remove invented entity/address/guarantees; blog unpublished | Frontend script checks 33 static links, claims, prices, legal placeholders | Owner/counsel must insert approved legal identity/policy decisions |
| B12 | Status-aware/stage-history reporting | VERIFIED | Exact message-state aggregates, initial outreach/reply labels, stage-event appointments, definitions/limitations | `stats.service.spec.ts` reconciles fixture totals and tenant predicate | First-client raw-record UAT reconciliation |
| B13 | HttpOnly auth, revocation, forced password change | VERIFIED | Same-origin proxy; Secure/HttpOnly/SameSite cookie; session version; logout/reset/change/deactivation revocation; 15-minute impersonation | Auth/JWT tests; frontend scan rejects auth localStorage/document.cookie | Production domains/TLS and account-recovery email UAT |
| B14 | CSP, isolation, and credential hygiene | VERIFIED | CSP/HSTS/standard headers; tenant predicates; encrypted/masked credentials; readiness plaintext audit | Lead/message/sequence/enrollment/team/user/credential/report isolation assertions; log-redaction and migration tests | Two-tenant production-like UAT and legacy credential remediation if count > 0 |
| B15 | Readiness, safe logs, and operator error visibility | VERIFIED | `/health/live`, `/health`, `/health/readiness`; production startup validation; request IDs/redacted JSON events; admin operations/error states | Environment/log tests, builds, provider/task tests | Railway/Vercel/provider alerts, backup/PITR/restore, mailbox owners |
| B16 | Exact UAT and external owner runbook | VERIFIED | 21-test UAT, A–H owner checklist, recurring operations checklist, migration/preflight/rollback runbook | Document inspection: every UAT test has prerequisites/action/result/evidence/failure/rollback/pass-fail | Owner must execute and retain real evidence |
| B17 | Full automated verification and evidence-based verdict | VERIFIED | CI-compatible commands, focused safety suites, dependency checks, and `docs/client-readiness-final-report.md` | Final serial backend suite: 39 suites/106 tests; both builds; both lint/test gates; migration/isolation/Stripe/messaging focused suites; zero production audit vulnerabilities; clean diff check | External UAT/config prevents paid-pilot verdict until completed |

## Database foundation

`202607190001-client-readiness-foundations.ts` adds prospect applications, Stripe webhook ledger, onboarding, operations tasks, channel consent, and lead-stage history; extends tenant billing/lifecycle, user session, message delivery/claim, sequence approval/claim, and support SLA state; and adds preflighted FKs, uniqueness, and queue indexes. It performs no ambiguous deletion and has an intentionally non-destructive `down()`.

The production reproduction test applies the production reconciliation and client-readiness migration from both the supported legacy baseline and an empty schema, then verifies constraints. The exact preflight and rollback process is in `docs/database-migration-runbook.md`.

## Conservative decisions

- Public prices remain `Contact for pilot pricing`; no price was invented.
- New workspaces remain onboarding/inactive with automation off.
- Missing/unknown billing, consent, provider, approval, or configuration blocks protected activity.
- Calendar synchronization is explicitly unavailable; only an external booking link is supported.
- Provider credentials are tenant-owned, encrypted, masked, and never supplied through global Twilio variables.
- Cancellation and deletion create reviewed work; neither automatically destroys production data.
- Global pause persists leads/evidence but prevents automated work.

## Verification evidence

Only observed results are recorded here. These are the final repository-side results from July 19, 2026 UTC.

| Command/check | Observed result | Blockers |
| --- | --- | --- |
| `git rev-parse HEAD` before edits | `0f4efffc105caf8d305a6d943a1ce220d47ec218` | Baseline |
| `cd backend && npm test -- --runInBand` | 39 suites, 106 tests passed | B1–B17 |
| Focused migration/schema command (four named specs) | 4 suites, 7 tests passed; legacy and empty-schema reproduction covered | B2, B8, B14–B15 |
| Focused tenant-isolation command (five named specs) | 5 suites, 14 tests passed | B14 |
| Focused Stripe command (two named specs) | 2 suites, 7 tests passed | B4 |
| Focused messaging/consent command (three named specs) | 3 suites, 9 tests passed | B5–B8 |
| `cd backend && npm run lint` | Passed with zero errors/warnings | B17 |
| `cd backend && npm run build` | Passed | B17 |
| `cd frontend && npm test` | Client-readiness source verification passed; 33 static links checked | B11, B13 |
| `cd frontend && npm run lint` | Passed with zero errors and 57 non-blocking warnings | B17 |
| `cd frontend && npm run build` | Production build passed; 46 routes generated | B11, B13, B17 |
| `npm audit --omit=dev --audit-level=high` in backend and frontend | Both passed; 0 production vulnerabilities reported | B17 |
| `git diff --check` | Passed | B17 |

## External acceptance gate

Repository-controlled work reached `REPOSITORY READY FOR OWNER CONFIGURATION`. It cannot reach `READY FOR CONTROLLED PAID PILOT` until the owner completes `docs/production-launch-owner-checklist.md`, the production database restore drill, controlled live payment, and all 21 UAT journeys with written client/owner approval.
