# RealtyTechAI first-client readiness

Evidence date: September 6, 2026. Baseline: `768d61a09c7aad519f4e8d127fb6d81fd6af7bc1`.
This report supersedes the historical first-client report in this file.

## READY

Local verification covers authentication/token handling, server-side payment restrictions, conversation ownership/history, durable message processing, persistent workspace configuration, and support tickets/navigation. Signup intentionally follows application → admin approval → invitation; invitation acceptance verifies the account and establishes its password.

Live Stripe, SendGrid, and OpenAI credentials were unavailable. Production deployment and delivery have not been certified.

## FIXED

- Operational API access now requires server-verified payment evidence tied to the workspace's current Stripe subscription. An `active` flag or unpaid trial is insufficient. Setup, billing, and support remain accessible. Frontend routing follows the same server decision.
- Stripe synchronization validates customer/subscription/price/invoice ownership, serializes customer webhook and reconciliation processing, handles replay and stale events, and automatically restores billing suspensions after paid recovery. Manual/safety suspensions remain controlled by operations.
- SendGrid now honors the configured workspace sender/reply identity, preserves unchanged successful configuration, encrypts credentials, records failed tests/provider authentication failures, and clears failure state after a successful real test send. Client/admin connection status follows usable provider state. One workspace test can establish platform credential readiness too.
- Conversations default to email for leads with email addresses. Booking-link replies support email-only contacts. Sender-supplied inbound Message-IDs and duplicate lookups are tenant-scoped, with compatibility for previously stored inbound IDs.
- New AI configuration defaults to controlled autopilot with 12 automatic turns. Approved business knowledge, configuration, provider readiness, consent, and activation remain required; approving valid configuration enables it. Routine references to an agent or offer no longer cause automatic handoff. Unsent/failed outbound drafts are excluded from conversation context. Email is the preferred first-response channel.
- Help preserves a safe prior workspace/admin path and includes Back. First-login notification preference creation is idempotent.
- Facebook Lead Ads UI, OAuth routes, webhook triggers, and active setup instructions were removed. Historical data/migrations and generic lead intake remain compatible.

## VERIFIED WORKFLOWS

`PASS` means locally verified behavior. `BLOCKED BY CREDENTIAL` means local code tests passed, but the external round trip still needs real account credentials.

| Workflow | Result | Evidence / remaining check |
| --- | --- | --- |
| Signup / email verification | BLOCKED BY CREDENTIAL | Application/approval/invitation and verification token tests pass; deliver real account mail. |
| Forgot / reset password | BLOCKED BY CREDENTIAL | HTTP/database token expiry, replay, reset, session invalidation, and login tests pass; deliver real reset mail. |
| Invitation | BLOCKED BY CREDENTIAL | Single-use acceptance and account activation pass over HTTP/database; deliver real invitation. |
| Stripe / payment gating | BLOCKED BY CREDENTIAL | Actual JWT/API unpaid/suspended restrictions pass; mocked signed-event/payment/recovery tests pass; complete real Stripe checkout/webhook/recovery. |
| SendGrid / email | BLOCKED BY CREDENTIAL | Sender/routing persistence, provider calls, rejection/retest and delivery-state tests pass; verify domains and deliver to a controlled mailbox. |
| Conversations inbound | BLOCKED BY CREDENTIAL | Multipart webhook, storage, deduplication, routing and UI history pass; receive a real Parse reply. |
| Conversations manual outbound reply | BLOCKED BY CREDENTIAL | Recipient/channel/ownership, queue, provider transport, threading and failure tests pass; confirm actual mailbox receipt. |
| AI outbound responses | BLOCKED BY CREDENTIAL | Context/policy/queue/delivery pipeline tests pass with provider doubles; validate real model output and mailbox delivery. |
| Calendly persistence | PASS | Actual API save/update/remove, workspace isolation, backend restart and browser reload/update checks pass. Link-based scheduling needs no Calendly OAuth credentials. |
| Help / support navigation | PASS | Browser returns to prior settings page; actual API ticket persisted; safe return paths tested. |
| Tenant isolation | PASS | JWT/API conversation access and settings isolation, plus RBAC/IDOR/AI/provider regressions. |

Validation: all 122 backend suites / 618 tests passed; frontend's five verification scripts passed; backend/frontend TypeScript and production builds passed; backend lint was clean and frontend lint had zero errors (46 warnings); public artifact and secret/workflow scans. All 25 migrations applied against the SQL baseline, reran without changes, and preserved paid evidence through rollback/reapply. Production backend started with 60 entity tables and readiness HTTP 200. Browser checks exercised the real frontend/API with synthetic accounts. Local SQL tests used PGlite (embedded PostgreSQL); the browser harness serialized database connections to accommodate its single-session transport. This is not native PostgreSQL concurrency or live-provider certification; repository CI includes PostgreSQL 15.

## OWNER SETUP REQUIRED

Confirm these in the deployed environments. They were not available to this audit; existing valid production configuration can be retained.

| Location | Exact configuration |
| --- | --- |
| Backend runtime/security | `NODE_ENV=production`, production `DATABASE_URL`, database TLS via `DATABASE_SSL` / `DATABASE_SSL_REJECT_UNAUTHORIZED`, `TYPEORM_SYNC=false`, `RUN_MIGRATIONS=true`; `JWT_SECRET` (32+ random characters), `INTEGRATIONS_ENCRYPTION_KEY` (base64 encoding of 32 random bytes), `PLATFORM_ADMIN_EMAILS`; `FRONTEND_URL` and `PUBLIC_APP_URL` = canonical frontend HTTPS origin, `PUBLIC_API_URL` = backend HTTPS origin; `BILLING_GRACE_DAYS=0`; keep `GLOBAL_AUTOMATIONS_DISABLED=true` until controlled validation, then set `false`; `HEALTH_CHECK_TOKEN` (32+ random characters). |
| Frontend | Server-only `BACKEND_API_URL` = backend origin; `NEXT_PUBLIC_SITE_URL` = canonical frontend HTTPS origin. |
| Stripe account | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_SERVICE_MONTH` (recurring service), `STRIPE_PRICE_SETUP_ONCE` (one-time setup). Register `<PUBLIC_API_URL>/billing/webhook` for `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, and `invoice.payment_failed`. Keys, prices and webhook must use the same Stripe mode/account. |
| System/account email | `SENDGRID_API_KEY`, authenticated `SENDGRID_FROM_EMAIL`, `SENDGRID_FROM_NAME`, monitored `SALES_INBOX_EMAIL`. |
| Workspace email | Save the platform SendGrid API key in Admin, then assign/test the workspace sender name/address and unique reply address. Set `SENDGRID_SENDING_DOMAIN`, `SENDGRID_REPLY_DOMAIN`, `SENDGRID_INBOUND_USERNAME`, `SENDGRID_INBOUND_PASSWORD`, `SENDGRID_INBOUND_WEBHOOK_URL=<PUBLIC_API_URL>/webhooks/sendgrid/inbound`, `SENDGRID_EVENT_WEBHOOK_URL=<PUBLIC_API_URL>/webhooks/sendgrid/events`. Configure DNS/domain authentication and the reply domain's Inbound Parse MX. Secure Parse and Event Webhooks using the supported OAuth client credentials: token URL `<PUBLIC_API_URL>/webhooks/sendgrid/oauth/token`, client ID = inbound username, secret = inbound password. Record actual SPF/DKIM/DMARC verification in `SENDGRID_SPF_VERIFIED_AT`, `SENDGRID_DKIM_VERIFIED_AT`, `SENDGRID_DMARC_VERIFIED_AT`. |
| AI / client content | `OPENAI_API_KEY`, `OPENAI_MODEL` accessible to that project. Approve the workspace's business knowledge, identity, allowed email channel, and AI configuration. Save/test the workspace Calendly link once if used. Complete the existing onboarding/controlled-test/activation flow with accurate client information and consent evidence. |
| Existing production activation evidence | Complete the actual restore and legal-review requirements before recording `BACKUP_RESTORE_TESTED_AT`, `BACKUP_RPO_MINUTES` (≤60), `BACKUP_RTO_MINUTES` (≤240), `BACKUP_RETENTION_DAYS` (≥7), `BACKUP_RESTORE_ISOLATED_VERIFIED=true`, `BACKUP_RESTORE_CREDENTIALS_PROTECTED=true`, and `LEGAL_DOCUMENTS_REVIEWED_AT`. Restore evidence must be within 90 days and legal review within 365 days. Configure the external uptime monitor and `EXTERNAL_UPTIME_MONITOR_URL`. |

SMS/Twilio and calendar OAuth are optional for the requested email plus Calendly-link workflow. No Facebook setup is required. Never fabricate provider/restore/review evidence.

## FIRST CLIENT BLOCKERS

1. Review, merge, and deploy this change, including `FirstClientPayment1788652800001`. Previously active workspaces stay restricted until Stripe reconciliation proves payment; opening Billing triggers reconciliation.
2. Configure or verify the real credentials/domains/client information and complete the existing activation requirements above.
3. Pass one controlled deployed application/invitation → payment → inbound lead/reply → AI email → manual email → booking-link round trip, including failed-payment recovery. Confirm actual mailbox delivery and correct workspace ownership.

## FINAL VERDICT

**NOT READY FOR FIRST CLIENT**

The remaining minimum is deployment, owner-controlled provider/setup evidence, and the controlled live round trip. No live integration success is inferred from local tests.
