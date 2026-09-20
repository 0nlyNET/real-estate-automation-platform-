# PR #61 Conversations verification and deployment

Reconstructed from `main` at `8fb5b87a71bb529407a25378017768049b66af54`, which contains merged PRs #59 and #60. GitHub returned “No commit found” for `2541e2b` and `8ff319e`; no PR #61 branch existed. The older `codex/conversation-ux-client-isolation` branch did not contain durable reads and changed reply permissions, so it was not applied.

## Changes and boundaries

- Lead identity, email, optional phone/source, latest preview/time, and backend-derived AI status in Conversations.
- Durable read state keyed by tenant, lead, and authenticated user. Shared-thread readers can change their own read state; existing reply and takeover ownership checks remain intact.
- The browser acknowledges a message actually visible in the message viewport. It never acknowledges the newer thread-list preview or uses the current time as a read boundary.
- The API validates the user's tenant and the watermark message's lead. PostgreSQL compares `(created_at, id)` without losing timestamp precision and only advances the watermark. Mark-unread increments a version so old page requests cannot undo it.
- Read/unread writes do not send messages, call OpenAI, resume jobs, or change conversation ownership.
- Global pause, stale jobs, suspension, replay guards, SendGrid handlers, AI generation and outbound provider submission code are unchanged.

## Migration

`backend/src/database/migrations/202609200002-conversation-read-state.ts` registers `ConversationReadState1789862400002` after PR #60's due-time migration. It adds `conversation_read_states` and a partial index for inbound unread counts. The schema now contains 61 entity tables.

Apply with the existing migration runner before serving the new API. `RUN_MIGRATIONS=true` enables startup migrations; the production default also runs them unless explicitly disabled. Alternatively build the backend and run `npm run migration:run`. Confirm `npm run migration:show` has no pending migrations and run `npm run schema:check`.

Fresh migration, rerun, transaction rollback, and latest down/up paths are covered by the database tests and browser seed. Downgrade the application before rolling back this migration. Its `down()` removes per-user read state and the new index, preserving leads and messages; back up read state if rollback must preserve those preferences. No production database was accessible or modified.

## Environment-variable audit

These findings describe actual code usage, not deployed values. No secret values were inspected or included.

| Variable | Actual use | Code evidence |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection; required in production. CLI migration connection can be overridden by `MIGRATION_DATABASE_URL`. | `backend/src/database/database-options.ts`, `data-source.ts` |
| `RUN_MIGRATIONS` | Controls automatic startup migrations: `true` enables, `false` disables; otherwise enabled outside tests. | `backend/src/database/database-options.ts` |
| `INTEGRATIONS_ENCRYPTION_KEY` | Encrypts stored integration credentials and assistant history. Must decode to 32 bytes; integration compatibility paths require base64. | `backend/src/common/crypto-secrets.ts`, `modules/integrations/integrations.service.ts`, `platform-integrations.service.ts` |
| `OPENAI_API_KEY` | Authenticates real Responses API requests and is checked by AI readiness/resume gates. | `backend/src/modules/ai/openai.provider.ts`, `restricted-assistant.provider.ts`, `ai-conversation-control.service.ts` |
| `OPENAI_MODEL` | Lead conversation model; also fallback for restricted assistants. Current code fallback is `gpt-5.6`; actual account/model access still needs a live check. | `backend/src/modules/ai/openai.provider.ts`, `restricted-assistant.provider.ts` |
| `OPENAI_ASSISTANT_MODEL` | Overrides the restricted client/admin assistant model, not the automated lead-conversation model. | `backend/src/modules/ai/restricted-assistant.provider.ts` |
| `SENDGRID_API_KEY` | Fallback for system transactional mail. Tenant Conversations use the encrypted platform credential saved/tested in the admin integration flow; this variable alone does not connect tenant email. | `backend/src/mail/mail.service.ts`, `modules/integrations/provider-config.service.ts`, `platform-integrations.service.ts` |
| `SENDGRID_FROM_EMAIL` | System transactional sender; tenant messages use their provisioned email identity. | `backend/src/mail/mail.service.ts`, `modules/integrations/provider-config.service.ts` |
| `SENDGRID_FROM_NAME` | System transactional display name; fallback `RealtyTechAI`. Readiness also checks presence. | `backend/src/mail/mail.service.ts`, `modules/admin/admin.controller.ts` |
| `SENDGRID_SENDING_DOMAIN` | Generates managed tenant sending identities and appears in launch readiness. | `backend/src/modules/integrations/email-identity.service.ts` |
| `SENDGRID_REPLY_DOMAIN` | Generates/validates tenant inbound reply addresses and appears in launch readiness. | `backend/src/modules/integrations/email-identity.service.ts` |
| `SENDGRID_INBOUND_WEBHOOK_URL` | Integration setup metadata and readiness presence check. Does not register the remote provider webhook. | `backend/src/modules/integrations/integrations.service.ts`, `common/environment-readiness.ts` |
| `SENDGRID_INBOUND_USERNAME` | Inbound/event webhook Basic authentication identity and OAuth client ID. | `backend/src/modules/webhooks/webhooks.service.ts`, `sendgrid-inbound-oauth.ts` |
| `SENDGRID_INBOUND_PASSWORD` | Inbound/event webhook Basic secret and OAuth client secret/token authentication material. | `backend/src/modules/webhooks/webhooks.service.ts`, `sendgrid-inbound-oauth.ts` |
| `SENDGRID_EVENT_WEBHOOK_URL` | Admin readiness presence check only. The real route is `POST /webhooks/sendgrid/events`; configure it in SendGrid separately. | `backend/src/modules/admin/admin.controller.ts`, `modules/webhooks/webhooks.controller.ts` |
| `SENDGRID_SPF_VERIFIED_AT` | Admin launch evidence timestamp, considered recent within 180 days. Does not check DNS. | `backend/src/modules/admin/admin.controller.ts` |
| `SENDGRID_DKIM_VERIFIED_AT` | Same evidence check for DKIM; does not check DNS. | `backend/src/modules/admin/admin.controller.ts` |
| `SENDGRID_DMARC_VERIFIED_AT` | Same evidence check for DMARC; does not check DNS. | `backend/src/modules/admin/admin.controller.ts` |
| `TWILIO_WEBHOOK_URL` | SMS provisioning callback, inbound signature validation, integration metadata, launch readiness. | `backend/src/modules/integrations/twilio-provisioning.service.ts`, `modules/webhooks/webhooks.service.ts` |
| `TWILIO_STATUS_CALLBACK_URL` | Outbound SMS delivery callback, provisioning, callback signature validation, readiness. | `backend/src/modules/messaging/messaging.service.ts`, `inbox-send.service.ts`, `modules/webhooks/webhooks.service.ts` |

## Verification scope and first-client blockers

Local validation completed:

- Backend: 125 suites / 664 tests passed; 12 tests across four database-conditional suites are deferred to CI when `TEST_POSTGRES_URL` is absent.
- The six new read-state/migration tests also passed separately against embedded PostgreSQL (PGlite).
- All 27 migrations applied to a fresh embedded PostgreSQL database; latest migration rollback/reapply passed.
- Ten desktop/mobile browser tests passed through the actual frontend, API, and test database, including the existing onboarding tests. The local harness used Chromium 153, UTC clocks, and a serialized connection pool for PGlite. Repository CI uses native PostgreSQL 15 and the standard Playwright browser.
- Backend/frontend type checks and builds, all frontend verification scripts, backend/frontend lint, archived admin UI build/lint, secret/workflow/production-artifact checks passed. Frontend lint has 46 existing warnings and zero errors.
- Backend, frontend and archived admin dependency audits each reported zero vulnerabilities.

Automated coverage includes identity fallback, per-user persistence, tenant and message ownership, out-of-order reads, timestamp ties/microseconds, a post-render arrival, mark-unread versus delayed read requests, migration rollback/rerun, desktop/mobile inbox behavior, and existing onboarding/automation/email regressions. Browser fixtures use a disposable local database and synthetic users; global automation is paused. They do not exercise a live SendGrid/OpenAI round trip.

No staging/provider credentials or deployment connection were available in this session. Before activating the first client:

1. Deploy the approved PR, apply/verify migrations, and confirm the deployed frontend/API versions match.
2. Verify the production database connection, stable encryption key, server authentication/public URLs, and operational monitoring/backup readiness using the existing launch checklist.
3. Save and test the platform SendGrid credential in admin. Provision the tenant's From/Reply identity and confirm its readiness; setting system mail variables alone is insufficient.
4. Verify real SPF, DKIM, DMARC, and inbound-domain/MX routing, then record the evidence timestamps. Configure authenticated inbound parse at `/webhooks/sendgrid/inbound` and delivery events at `/webhooks/sendgrid/events`; if using OAuth, the token endpoint is `/webhooks/sendgrid/oauth/token`.
5. Verify OpenAI credentials and model access, approve the workspace AI configuration and brokerage knowledge, and verify consent, paid subscription evidence, service lifecycle, usage limits, and booking readiness.
6. Run an authorized controlled lead email round trip: initial message → real inbound reply → OpenAI run → outbound email → delivery event → Conversations UI. Verify retries/deduplication, takeover/Resume AI, global pause, suspension, and cross-tenant rejection. Record evidence before activation.

Twilio is only relevant when enabling SMS. Its variables remain used by SMS code and some platform-wide launch checks; this PR does not alter those gates. Production configuration remains unverified, so this PR alone is not first-client launch approval.
