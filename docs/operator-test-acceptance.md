# Operator email acceptance repair

This change repairs the operator-test candidate built on PRs #177–#180. It does
not activate a customer, create a grant, initiate a payment, or approve a
production release. The operational acceptance session below uses a separately
authorized staging grant. The goal is readiness to onboard a future client;
identifying or activating that client is not part of this repair.

## Current acceptance checkpoint — 2026-10-03

- Earlier candidate `c891f13590810af27147856d006ed33b6c78181b` passed all five CI jobs (run 37096418165), 1124 backend tests and 16 desktop/mobile browser tests, including real PostgreSQL migration/quota tests. Both staging services served it and dependency audits passed. This is historical evidence, not proof that later repairs pass.
- Follow-up `c16e3c584d81add4c1e87268697dbf14d9720aca` is verified on staging backend deployment `1df0cb95-110d-4298-84ac-ca552733b4ab`. CI run 37099845284 passed backend, frontend, security and archived-admin jobs. Browser verification failed: an explicitly scoped operator was rejected by tenant-membership-only conversation read state; the final client permission check also encountered an unavailable session. The new repair adds server-derived operator read scope, preserves ordinary membership and cross-tenant denial, and removes an unnecessary cached-session navigation from the browser fixture. Failed HTTP statuses are now logged; production throttles and permission assertions remain unchanged.
- Staging fixture `c82e1cb1-7381-410f-b0a3-cedfa2eae60c` has grant `15938879-1361-4d2a-aeaf-98e985b2c64e`: one explicitly approved mailbox, 24 hours, five emails per UTC day and ten total. Billing remains Incomplete; client activation remains blocked. No production deployment or payment.
- The owner approved all six final setup acknowledgments at action time. They were saved, and the operator reviewed/approved the exact evidence with staging-only notes. Email-only business intake, AI configuration, approved knowledge and an approved active one-step buyer sequence are prepared. SMS and booking remain disabled.
- One separately authorized managed-sender diagnostic was accepted by SendGrid. This proves provider submission, not inbox receipt or buyer E2E. It is outside the normal Message/grant reservation path. Four additional physical emails remain within this session's five-email authorization.
- Controlled run `1e953a05-ec8b-4bdf-9cd5-0ff619380add` created AI run `9b99b473-671e-459c-86b1-4877e606c545`. Railway traces prove provider generation completed in 3.5 seconds, then `update_conversation_summary` was blocked because its entitlement check omitted the pinned grant. No outbound message was created. The repair revalidates the existing grant and freshly loaded recipient at the tool boundary; it never discovers a replacement grant. Buyer inbound, qualification and reply delivery are not yet proven. The connected Gmail account is a different mailbox; a real reply from the approved recipient must not be spoofed.
- That first controlled run was aborted. A second run `2c40b584-5247-45cf-a525-f46ff231aaa6`, lead `952d25bd-7c98-4ba8-a6d4-9edb1fd1a2df`, AI run `0291ba61-b253-43f0-a659-2ec457c7f6d0` proves both summary/qualification tools execute with the pinned grant. Provider generation took 2.9 seconds, but its `no_reply` decision completed the initial-contact run without an outbound. The new repair supplies an explicit `first_response` trigger to the provider and states that no inbound is expected yet. A missing initial reply now creates an explicit blocked run and human handoff instead of silent success. Ordinary inbound no-reply behavior is preserved. Controlled intake uses a realistic buyer/seller inquiry while retaining test labels and provenance; it does not fabricate a provider inbound email.
- Conversation AI status, return-to-AI and unpaid operator manual-email submission now carry the existing server grant through their respective gates. Current recipient, tenant, expiration, revocation, consent, lifecycle and SMS denial remain enforced; neither UI input nor a new grant can replace queued authorization.
- Live navigation exposed three UI defects: consent review mounted only on a full Setup page load; TESTING workspaces disappeared from the onboarding list; controlled conversations were excluded without an explicit test view. The follow-up repair moves consent review into the selected client's Setup tab, retains TESTING workspaces, adds a sanitized active-run status panel, and adds an operator-only opt-in test conversation view. Normal reporting still excludes test messages.
- The status endpoint reads the persisted `sanitizedError`. Nine targeted backend suites pass (149 tests), including real entitlement/guard checks for tool authorization, revocation, expiry, tenant/recipient mismatch, missing grant, SMS, global pause and consent, plus initial-contact failure, read scope, manual-send authorization and return-to-AI. Backend build passes; lint has no errors and 14 existing warnings. A new PostgreSQL regression verifies operator personal read state without changing client membership or cross-tenant isolation. Full CI and staging proof for this latest repair remain pending at this checkpoint.
- Runtime candidate `12c450f410ce44fc3cc4bb2922ed401be5d9ad40` is independently verified on both staging services: backend `4510ec4e-f7da-4d79-b8a5-f0d25bbf3f7e`, frontend `1fa06978-a2a5-434c-8b1f-56cdfaf840f4`. Both deployments are successful. CI 37101086626 passed all four non-browser jobs, 1143 backend tests / 160 suites, real PostgreSQL personal read state and operator quota tests, and zero-vulnerability dependency audits. Browser operator conversation visibility and client permission checks now pass. One browser fixture remained at a blank page after cookie restoration; its explicit initial admin navigation is restored in the subsequent test-only change. Full desktop/mobile browser rerun remains required.
- Fresh controlled run `eca8c201-55ea-4e61-8238-7ef96abda979`, lead `1e79148e-7fba-43bf-bbcb-8d4bec39590c`, AI run `dc611eef-d1bc-4fa1-91ab-54d943e3492c`, created outbound `d7892d5f-2cb9-46df-9932-310690869c5a`. Its real provider generation, tools, message finalization and email submission succeeded. The actual Conversations UI shows the disclosed buyer welcome and Provider accepted; scoped operator reads and AI Active status work. No inbox receipt/delivered callback or buyer inbound is claimed. Human takeover succeeded and SendGrid accepted one manual acceptance email to the same approved recipient. Three physical emails have been submitted including the earlier diagnostic; two remain within the owner's five-email session allowance. No additional recipients are authorized.
- Follow-up `64b99c5746217f2661fcefb30243bf12d428936b` restores the consent fixture's initial navigation. CI 37101431545 passed all four non-browser jobs. Nine desktop browser tests passed, but the final client permission check again encountered an unavailable session. This is unresolved; the new failure diagnostic captures the authenticated session HTTP status without logging credentials. Permission assertions and production throttles remain unchanged.
- Live human takeover exposed a missing inbox action for completing the open handoff before returning the lead to AI. Conversations now exposes the scoped active handoff and calls the existing guarded completion endpoint. Completion preserves human ownership; the existing separate Resume AI confirmation and entitlement checks remain required. Targeted backend tests (17 across two suites), backend build, frontend lint/static checks/build pass. Database-backed desktop/mobile browser and live staging proof for this change remain pending.
- Staging System health reports missing `SENDGRID_EVENT_WEBHOOK_URL`, and no authenticated delivery callback has been observed for the actual outbound. The presence check alone does not establish how SendGrid's account webhook is configured; this requires investigation before claiming delivery acceptance. SPF/DKIM/DMARC verification dates, backup/restore evidence, and external uptime monitor are also unrecorded in the staging setup checker. Historical production packet claims must be independently reconciled with the actual production configuration and evidence. Do not mark these checks ready by inserting dates or flags without verification.
- Candidate `c57c6d51994ee8146ceb57fd19b92f8364e05e75`, CI 37102109302: four non-browser jobs pass, nine desktop cases pass. The new handoff regression exposes an actual 404 because the existing mutation endpoint excludes test leads. The repair includes controlled handoffs only for the server-verified selected operator tenant; normal clients and all default Today/report listings retain test exclusions. The database-backed browser case also verifies that an ordinary user of the same tenant cannot mutate the operator fixture. This run's final permission/session case passes; no prior intermittent session issue is declared resolved merely because it did not recur.
- PR #147 documents the staging callback limitation: SendGrid's account event webhook targets production. Its existing polling implementation still uses NODE_ENV for environment identity, does not validate returned message ownership or protect concurrent terminal updates, and does not implement the advertised rate-limit backoff. Do not merge it as written or redirect the production webhook to staging. A reviewed delivery-evidence solution remains pending.
- Frontend session verification now records a bounded server-side failure reason and upstream HTTP status, excluding cookies, identity, URLs and raw errors. This supplies evidence for the intermittent unavailable-session failure without changing authentication decisions or throttle limits.
- Candidate `dcbe93ff888ae464764d8b08581bdc68cba6dac1`, CI 37102585889: all four non-browser jobs pass. The scoped handoff completion and same-tenant ordinary-user denial work over the real HTTP/database path. One assertion incorrectly assumed human ownership while the fixture deliberately starts paused; it now asserts that completing a handoff preserves the actual prior ownership state. Nine desktop cases passed; mobile verification remains pending.
- The new server diagnostic identifies the intermittent session failure as HTTP 429 on `/auth/session`. Its previous direct-peer bucket pooled every user behind the frontend. The repair retains 120 checks/minute but uses a hashed subject only after verifying the session signature, algorithm, issuer, audience and expiration. Invalid/anonymous tokens and every non-session route retain direct-peer limits; login account limits and the platform ceiling are unchanged. This bucket selection never authorizes a request: JwtStrategy still reloads current account/role/revocation/operator state. HTTP tests exercise the real JWT/throttle guards, same-peer user isolation, 120-request enforcement, forged-token limits and immediate database revocation.
- Candidate `6d4de3e188375542554427bac422deeaa830ac1e`, CI 37103138411: 1158 backend tests / 161 suites and all four non-browser jobs pass. All ten desktop and nine mobile cases pass, with no session-429 diagnostic. The remaining mobile fixture tried to click its navigation link without opening the actual navigation drawer; it now uses the visible drawer control. Permission and layout assertions stay intact.
- Live staging handoff completion is verified: the completion button disappears and human attention/control remains until a separate return-to-AI action. The existing native browser confirmation could not be completed by the acceptance browser; no successful AI resumption is claimed for that attempt. The confirmation now uses the existing accessible in-app dialog with explicit Keep human control and Confirm return to AI actions, pinned to the currently selected lead. Server confirmation, grant, consent, pause and handoff checks are unchanged. Browser coverage verifies cancellation leaves ownership unchanged; live confirmed resumption remains pending the next deployment.
- Vercel independently identifies the current production frontend as READY deployment `dpl_4U6a6r4Kbo5SRdeLxWgePGkkeor8`, main SHA `b1bcea9449ca9481d122d1f2cf8c400711a2d595`. Staging-branch builds are previews and have not been promoted to production. This replaces the historical claim that the production frontend SHA cannot be queried.
- Candidate `9fc8f29ff837d95d89ea0b06abfcd21dd2f39f66` has successful Railway commit statuses for staging backend deployment `ab263c67-336e-4376-9aba-f00043557361` and frontend `cc08a4ba-675d-4d0c-ad7d-a761a98aa6bb`. CI 37103896780 passes all four non-browser jobs, 1158 backend tests / 161 suites, ten desktop and nine mobile cases. The remaining mobile case checked drawer visibility before the page rendered; it now waits for the mobile navigation button using the configured mobile fixture. No permission, layout or rate-limit assertion was relaxed; the final CI rerun remains required.
- Live staging verifies the new confirmation: Keep human control closes the dialog and preserves human ownership; Confirm return to AI changes the conversation to AI Active and restores Take Over. The human-attention banner clears, the handoff stays completed and the same two messages remain Provider accepted. No extra outbound was created by resumption. Manual message ID: `40af0bd6-549f-4dab-abf8-71c5de4d88b2`. Three physical emails remain submitted in this session; two remain authorized. The owner has been asked for the real reply from the approved mailbox; no inbound/delivery proof is fabricated.
- Candidate `861944a723eb8faae0f241c210587037e4499c73`, CI 37104284441: all five jobs pass, including 1158 backend tests / 161 suites and ten desktop plus ten mobile browser cases. Dependency audits report zero vulnerabilities. Railway commit statuses confirm this exact SHA successfully deployed to staging backend `f1d0c622-51df-4ecf-a3ce-a1b1f3d62306` and frontend `e15b911d-57dd-476a-8708-dcbcc653f59a`. Main remains `b1bcea9449ca9481d122d1f2cf8c400711a2d595`.
- Production public UI loads and accurately describes supervised lead intake, routing and approved follow-up. Its private admin preflight remains unavailable: the owner-submitted secure login returned Invalid credentials. No password reset, production mutation or customer activation was performed. Current Gmail search returned no message to the approved mailbox; that connected Gmail account is different and this does not prove provider delivery failure.
- Final review found that production disaster-recovery activation accepted blank/zero/negative RPO/RTO metrics despite the health screen requiring positive values. The activation gate now uses the same positive bounds (RPO <=60 minutes, RTO <=240 minutes), preserving fractional measured timings and all existing restore-date, isolation, retention and credential checks. Regression coverage exercises the actual required/blocker result for valid boundary/fractional values and missing, blank, zero, negative, over-limit and nonfinite metrics. This proves validation, not the existence of a production restore drill; the subsequent candidate still requires CI and staging version checks.

## Changes

- Register an ordered, idempotent schema repair after migrations creating
  messages. Preserve the original migration identity for installations where
  it was executed manually. The CLI and application use the same registry.
- Register grant administration in AdminModule, keeping OperatorTestModule
  independent of CommonModule. Require an unimpersonated super administrator.
- Persist grant creation/revocation audit records in the same database
  transaction as each mutation. Restrict grants to one email recipient, a
  maximum seven-day expiration, ten reservations per UTC day and fifty total.
- Keep billingEligible false for unpaid tests. Authorize only email actions;
  preserve lifecycle, consent, pause, opt-out, AI approval and provider checks.
- Allow email-only controlled testing to replace billing prerequisites with
  the server grant. Customer activation readiness and paid state are unchanged.
  Suspended/canceled tenants cannot enter testing.
- Persist the grant ID on AI runs and outbound messages. Workers cannot
  discover a replacement grant for queued work. Validate it again in message
  safety and reserve quota immediately before email submission.
- Lock the specific grant row while counting/reserving quotas so distinct
  workers cannot exceed limits. Retries preserve grant/message/recipient
  identity. Do not query an aborted PostgreSQL transaction after an insert error.
- Label provider submissions as operator tests and exclude flagged messages
  from default thread listings and message reporting.

## Earlier local validation

Local Node 24, fresh npm ci: backend build passed; backend lint passed with
existing warnings; full suite passed (1106 tests, 18 PostgreSQL-only tests
skipped because this environment has no usable PostgreSQL server). Repository
secret scan passed.

New PostgreSQL tests run in backend CI with TEST_POSTGRES_URL. They use the real
application migration registry on a new disposable database, undo/reapply the
latest migration, exercise concurrent daily/total quota limits, retry identity,
revocation and expiry. Local test success is not PostgreSQL concurrency proof.

## Earlier staging evidence (superseded by the current checkpoint)

Railway staging initially crashed with UnknownDependenciesException: StatsModule
could not resolve OperatorTestGuard for ServiceAccessGuard. Deployment
`e1cd79ef-5823-4a92-9621-ea5750d934f5` successfully starts the repaired backend
SHA `a1e7587d45085b9efbe7e4903fa03ef7b85fa307`. Its logs show schema readiness
for 65 entity tables and successful Nest startup; GET /health returned HTTP 200.
Only staging was changed. VAPID_SUBJECT was corrected to a mailto URL.

CI run 37089739453 passed 1124 backend tests and desktop/mobile browser tests.
Frontend, backend and archived jobs still fail inherited dependency audits.
The new super-admin grant panel uses the existing authenticated proxy and
provides a 24-hour, one-recipient grant with five emails/day and ten total.
It is hidden from staff and impersonated sessions. Browser coverage verifies
creation, revocation, staff denial and unchanged billing; that new coverage
requires the updated CI run. Local frontend lint, regressions and build passed.
No actual staging grant or recipient consent has been created yet.

## Remaining acceptance gates

1. Inspect the follow-up UI CI results and verify its exact staging SHA. Existing backend security, migration and quota checks must stay green.
2. Inspect the active run's actual AI/message results. Fix any real worker or configuration failure, without changing billing, client activation, consent or suspension boundaries.
3. Confirm a real reply from the approved test mailbox traverses authenticated inbound routing, buyer qualification, AI queue and provider delivery. Record run, grant, lead and message references. Inbox receipt is separate from provider acceptance.
4. Revoke the grant through DELETE /admin/operator-test/grants/:id. Prove
   queued work is blocked after revocation/expiry and non-allowlisted recipients,
   SMS, suspended tenants and cross-tenant access remain denied.
5. Present the staging evidence and exact candidate SHA for production approval.
   Production smoke testing still requires the owner's invitation acceptance
   and recipient consent. Client #1 identity and onboarding approvals remain
   separate prerequisites. No artificial live payment is part of testing.

For code rollback, redeploy the previously approved release. The new tables
and default-false nullable/flag message fields can remain in place. Do not
execute the destructive down migration on a production database containing
operator audit/usage records merely to roll back code.


## Follow-up acceptance preparation — 2026-10-03

- Staging grant created after explicit owner authorization: 24 hours, one owned recipient, five emails/day, ten total. Billing remains Incomplete. No production grant or customer activation.
- Synthetic staging business intake, routing, email-only scope and controlled test recipient saved. Business information and assistant configuration approved; SMS and booking disabled. Automation master switch remains paused until controlled-test prerequisites are reviewed.
- Guided Open intake now enters audited operator mode and opens the selected tenant's editable `/app/onboarding` form. Added desktop/mobile browser coverage for that route and accessible knowledge-base labels.
- Jest upgraded to supported 30.x; patched allowed backend transitive dependency versions. Local backend tests: 1106 passed; 18 PostgreSQL tests deferred to database-backed CI. Local lint and build pass.
- Next ESLint rules remain enabled. A scoped directory-only adapter removes the plugin's vulnerable braces chain without disabling audit checks. Compatibility checks cover the actual installed Next helper; both frontend packages use copied local packages (`install-links=true`) so isolated CI and Docker installs resolve correctly. Registry package tinyglobby is pinned; no invented upstream patch version.
- Local npm audit reports zero vulnerabilities for backend, frontend and archived admin UI. Frontend lint (existing warnings), static verification and production build pass; archived admin lint/build pass.
- Live staging delivery/AI reply evidence remains pending. Consent-policy agreement checkboxes must be explicitly accepted by the owner at action time; controlled-email authorization does not silently accept Terms or Acceptable Use. No test email has been sent at this checkpoint.
- Main and production remain unchanged. This branch is a reviewable staging candidate; production promotion requires exact-SHA approval after acceptance evidence.
