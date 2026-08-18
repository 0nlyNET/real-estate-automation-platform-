# First-client UAT

Run this document against a new Stripe test-mode pilot workspace before accepting a live payment. Replace `<frontend-origin>`, `<api-origin>`, and `<tenant-id>` with the deployed HTTPS values. Use synthetic contacts controlled by the test team. Never paste credentials, tokens, message bodies containing personal data, or webhook secrets into evidence.

Record the tester, UTC timestamp, deployed commit, tenant ID, Stripe mode, and evidence location at the top of the retained copy. A test passes only when its expected result is observed and its evidence is retained. If a test fails, stop dependent tests, leave `GLOBAL_AUTOMATIONS_DISABLED=true`, and follow the listed rollback.

## Test 1 — Public website availability

- Pass/fail: [ ] PASS [ ] FAIL
- Preconditions: Production domains and TLS are active; the tested commit is deployed.
- Exact action: In a private browser window, load `/`, `/features`, `/use-cases`, `/pricing`, `/apply`, `/contact`, `/privacy`, `/terms`, `/refund`, and `/security` on `<frontend-origin>`. Run `curl -I <frontend-origin>` and `curl -i <api-origin>/health/live`.
- Expected result: Every page loads over HTTPS without a certificate warning or redirect loop; the frontend returns a successful status; `/health/live` returns HTTP 200 and `status: up`.
- Evidence to retain: Timestamped screenshots, response headers, TLS/certificate summary, deployed commit.
- Failure response: Stop launch; classify certificate, DNS, routing, or application failure; notify the deployment owner.
- Rollback action: Restore the last known-good Vercel/Railway deployment or DNS value; keep all automation paused.

## Test 2 — Offer understanding

- Pass/fail: [ ] PASS [ ] FAIL
- Preconditions: Public pages from Test 1 are available.
- Exact action: Have a reviewer unfamiliar with the implementation read the home, features, use-cases, pricing, and FAQ/contact content. Ask them to describe the service and list promised integrations and outcomes. Search the rendered pages for unsupported AI content generation, social publishing, revenue attribution, guaranteed response/performance, Gmail sync, calendar claims beyond the approved Google Calendar workflow, and CRM replacement claims.
- Expected result: The reviewer describes a managed real-estate lead intake, approved SMS/email response, follow-up, routing, history, and reporting service. No unsupported service or guaranteed outcome is represented.
- Evidence to retain: Reviewer name, written summary, screenshots or saved page text, search terms and results.
- Failure response: Treat any unsupported promise as a launch blocker and identify the source component.
- Rollback action: Revert the misleading copy or unpublish the affected page until corrected and re-reviewed.

## Test 3 — Application and booking

- Pass/fail: [ ] PASS [ ] FAIL
- Preconditions: A monitored `SALES_INBOX_EMAIL` and system SendGrid sender are configured for the positive test; an operator can query the admin application queue.
- Exact action: Submit `/apply` with a unique plus-address and valid fields. Confirm the browser success state, find the record in Admin → Applications, find its `new_application` operations task, and verify applicant/operator email when configured. Repeat once with system email deliberately unavailable in a nonproduction environment. Click every consultation/booking CTA.
- Expected result: Each submission persists once and returns a truthful received confirmation. Email status is `sent`, `partial`, or `failed` as observed; notification failure creates an operator task and never loses the application. Each booking/consultation CTA reaches the working application/contact destination or an owner-approved live booking URL.
- Evidence to retain: Application IDs, operations-task IDs, redacted screenshots, email message IDs/headers, CTA destination list, failure-test log event `application_notification_failed`.
- Failure response: Stop public acquisition if persistence or CTA routing fails; manually contact any persisted applicant whose notification failed.
- Rollback action: Restore the last known-good form/CTA deployment; keep the persisted application and task; do not resubmit unless deduplication is documented.

## Test 4 — Service selection

- Pass/fail: [ ] PASS [ ] FAIL
- Preconditions: Owner-approved one-service pricing decision and draft agreement/SOW exist; `STRIPE_PRICE_SERVICE_MONTH` contains the approved Stripe test price ID.
- Exact action: Compare the single managed service on `/pricing` with the agreement, SOW, monthly billing terms, and `STRIPE_PRICE_SERVICE_MONTH`. Start checkout in test mode and inspect its Stripe line item without paying. Confirm the browser cannot submit a plan, interval, price ID, or amount.
- Expected result: Names, included scope, billing interval, and Stripe product/price agree. Public pricing never renders blank and says `Contact for pilot pricing` until the owner publishes an approved amount. The server—not browser text—selects one configured price ID.
- Evidence to retain: Signed-off service mapping, screenshots, the test price ID (IDs are safe; no secret keys), and agreement/SOW version.
- Failure response: Block checkout for the mismatched package and correct the central mapping or external Stripe price.
- Rollback action: Disable billing by removing the production Stripe secret or keep checkout inaccessible; do not invent a replacement price.

## Test 5 — Payment

- Pass/fail: [ ] PASS [ ] FAIL
- Preconditions: Stripe test keys, portal, signed webhook endpoint, test products/prices, and Test 4 mapping are ready; use a fresh tenant.
- Exact action: Complete one Stripe test checkout. Allow the signed `checkout.session.completed` and subscription events to process. Attempt a second checkout from the same workspace and inspect Stripe Customers and Subscriptions.
- Expected result: Exactly one Stripe customer relationship and one open subscription exist. Tenant customer/subscription/price/status fields match Stripe. A second checkout is refused with a billing-management/portal direction and creates no second subscription.
- Evidence to retain: Stripe test customer/subscription/event IDs, application response, tenant billing summary, webhook-ledger rows, duplicate-attempt screenshot.
- Failure response: Set `GLOBAL_AUTOMATIONS_DISABLED=true`, stop payment acceptance, reconcile duplicate objects in Stripe test mode, and open an operations incident.
- Rollback action: Cancel the unintended test subscription, clear only stale checkout-lock fields through reviewed operator action, and repeat with a new test tenant.

## Test 6 — Account creation

- Pass/fail: [ ] PASS [ ] FAIL
- Preconditions: A platform-admin account is authenticated; a unique owner email is controlled by the tester.
- Exact action: Create a workspace and owner in Admin. Inspect the tenant, tenant settings, and owner account before any activation action. Log in after verification and temporary-password replacement.
- Expected result: Lifecycle is `ONBOARDING`, billing is not implicitly eligible, `automationsEnabled` is false, no sequence runs, and the owner is forced to verify email and replace a temporary password when one was issued.
- Evidence to retain: Tenant/user IDs, redacted admin screenshots, lifecycle/settings database query, authentication audit entries.
- Failure response: Pause the tenant immediately and do not connect providers.
- Rollback action: Deactivate the synthetic user and retain the inactive test workspace for audit, or remove it only through the approved nonproduction cleanup process.

## Test 7 — Internal notification

- Pass/fail: [ ] PASS [ ] FAIL
- Preconditions: Admin Applications and Operations pages are accessible to a platform admin.
- Exact action: Trigger a new application, completed test payment, onboarding-task creation, support request, provider test failure, and failed payment fixture. Filter the operations queue by category, tenant, priority, and overdue state.
- Expected result: Persisted application, payment follow-up, onboarding, support, integration failure, and payment failure work is visible with category, priority, state, owner, due date, timestamps, summary, evidence note, and related record. Email delivery is not required for queue persistence.
- Evidence to retain: Record/task IDs and screenshots of every category and filter.
- Failure response: Treat missing application/payment/onboarding tasks as a go-live blocker; manually create and own an incident task for the lost signal.
- Rollback action: Keep the originating records; restore queue creation/display code and replay only idempotent test events.

## Test 8 — Onboarding communication

- Pass/fail: [ ] PASS [ ] FAIL
- Preconditions: System sender/domain is authenticated; test mailbox receives external mail.
- Exact action: For the fresh owner, exercise account verification, forgot/reset password, welcome delivery, first login, forced temporary-password change, and the in-app onboarding instructions. Repeat reset, then try the pre-reset session.
- Expected result: Links use the production frontend, expire/reject invalid values, welcome is sent at most once, temporary credentials cannot access the normal app before replacement, and the old session fails after reset/change.
- Evidence to retain: Email provider message IDs, redacted screenshots, session-version values before/after, HTTP status for rejected old session.
- Failure response: Deactivate the account and stop onboarding; never send credentials through an unapproved channel.
- Rollback action: Issue a new verified reset flow after the fix; revoke all prior sessions by incrementing session version.

## Test 9 — Intake

- Pass/fail: [ ] PASS [ ] FAIL
- Preconditions: Fresh tenant from Test 6; operator and client know the approved service scope.
- Exact action: Complete business identity, contacts, package/channels/sources/volume/reporting, routing/business hours/escalation/follow-up, time zone, quiet hours, brand identity/voice/signatures, consent disclosure/source/opt-out evidence, integration ownership, target launch date, and conditional booking/provider fields. Leave one required field empty, request readiness, then complete it.
- Expected result: Saved sections return only for this tenant. Each missing required or conditional item appears as an explicit blocker; optional providers are not required when disabled. Client-entered fields alone do not mark readiness complete.
- Evidence to retain: Redacted onboarding JSON/export, before/after readiness screenshots, blocker keys, operator identity.
- Failure response: Keep lifecycle `ONBOARDING`; assign the missing-information operations task.
- Rollback action: Correct the onboarding record; do not bypass the server activation gate or edit lifecycle directly.

## Test 10 — Integrations

- Pass/fail: [ ] PASS [ ] FAIL
- Preconditions: Client authorization; approved platform-owned Twilio and SendGrid parent accounts; final callback URLs and sending/reply domains configured; Meta only if included.
- Exact action: From the owner workspace, reconcile tenant provisioning and verify the Twilio child account, Messaging Service, dedicated number, compliance state, SendGrid sender, and unguessable inbound address. Run the controlled SMS/email tests, deliberately fail one provider request, then reconcile and retest. For Meta, authorize and select the intended Page.
- Expected result: The client is never asked for provider secrets. Parent credentials remain server-side; tenant-scoped resources are encrypted and never returned. Provisioning is resumable, callbacks route to exactly one tenant, test results are recorded, and failures appear in the operator queue.
- Evidence to retain: Secret-free client and owner screenshots, provider resource IDs, exact routing identities, test timestamps, and operations-task ID.
- Failure response: Leave the resource blocked and tenant inactive; rotate a parent or tenant credential only if it was exposed.
- Rollback action: Block the tenant resource, reconcile the provider asset inventory, and resume provisioning only after callback, compliance, and routing checks pass.

## Test 11 — Safe activation

- Pass/fail: [ ] PASS [ ] FAIL
- Preconditions: Platform admin and fresh onboarding tenant; global pause state is known.
- Exact action: Call the admin activation action before readiness passes. Record blockers. Complete billing, intake, enabled-provider tests, approved templates, consent policy, controlled lead, inbound/STOP/rejection tests, client approval, billing verification, and operator approval. Activate as platform admin, then use the immediate pause action once.
- Expected result: Early activation returns `ACTIVATION_BLOCKED` with exact failed conditions and writes no active state. Only a platform admin can activate. Successful activation records operator/time/evidence/services, sets lifecycle `ACTIVE`, and enables tenant automation. Pause sets lifecycle `PAUSED` and disables automation immediately.
- Evidence to retain: Failed/success responses, `workspace_activation_blocked` log, audit record, tenant/settings/onboarding states and timestamps.
- Failure response: Set the global pause, pause the tenant, and treat unauthorized or premature activation as a security incident.
- Rollback action: Use Admin Pause; correct evidence; reactivate only after a complete readiness rerun.

## Test 12 — Approved campaigns

- Pass/fail: [ ] PASS [ ] FAIL
- Preconditions: Active or activation-ready test tenant with SMS/email enabled.
- Exact action: Create SMS and email sequences. Try to activate an empty sequence, a draft step, an SMS without client identity/STOP, and an email without `{{unsubscribeUrl}}`. Then approve compliant templates and activate. Inspect all public/app navigation for social workflow claims.
- Expected result: New sequences are inactive. Invalid/draft templates cannot activate or send. Compliant approved templates can activate only when service entitlement passes. No social publishing workflow is represented.
- Evidence to retain: Validation responses, sequence/step states, approved template versions, UI screenshots.
- Failure response: Pause the sequence and tenant; open a compliance operations task if any invalid content sent.
- Rollback action: Deactivate the sequence, cancel its pending messages, correct and reapprove the template.

## Test 13 — Client approval

- Pass/fail: [ ] PASS [ ] FAIL
- Preconditions: Compliant draft templates and a named client approval contact.
- Exact action: Record written approval and approve each template with identity label/operator. Edit one approved template’s body or identity and inspect its version, approval, and parent sequence.
- Expected result: Approval stores approver/time/version. Editing content increments version, clears approval fields, changes status to `draft`, and deactivates the sequence. The edited content cannot run until reapproved.
- Evidence to retain: Written client approval, step records before/after, audit entry, sequence inactive state.
- Failure response: Stop all affected sequences and determine whether unapproved content was queued or sent.
- Rollback action: Restore the approved content as a new reviewed version or obtain new written approval; never restore approval flags manually.

## Test 14 — Lead capture

- Pass/fail: [ ] PASS [ ] FAIL
- Preconditions: At least one enabled source; custom intake key when using `/leads/intake/<tenant-id>`; controlled consent disclosure/version.
- Exact action: Submit one controlled lead through each enabled source using a unique source/form identifier and channel-specific consent object (`affirmative`, `source`, `consentedAt`, disclosure text/version, source identifier, and client attestation where applicable). Replay the same source event and test a lead without consent. Verify assignment.
- Expected result: Lead lands in the correct tenant with correct source, consent record/evidence, and assignment; duplicate intake does not create duplicate protected activity; missing consent still stores the lead but creates no automated contact and records the block/skip reason.
- Evidence to retain: Lead/consent/event IDs, source provider ID, assignment, dedupe result, skipped-message/event record.
- Failure response: Global-pause automation if routing crosses tenants or duplicate sends occur; quarantine the source.
- Rollback action: Disconnect/disable the source, preserve evidence, correct routing/dedupe, and rerun with a new controlled identifier.

## Test 15 — Communications

- Pass/fail: [ ] PASS [ ] FAIL
- Preconditions: Active controlled test tenant, approved templates, owned test email and optional phone, enabled-provider callbacks, affirmative consent, a tested Google Calendar connection, and an active `appointment.created` CRM webhook. Email-only mode is valid while Twilio/A2P is unavailable.
- Exact action: Submit the controlled test lead and observe the first real email. Reply and verify the inbound message and AI reply. Agree to one exact future appointment time. Verify free/busy, the Google event and attendee, the RealtyTechAI appointment, lead stage, agent notification, and CRM delivery. Replay the booking request, reschedule, and cancel. Use Take over and verify AI stops immediately. If SMS is enabled, also trigger SMS, observe the signed delivery callback, reply inbound, reply ` STOP `, and try manual/automatic SMS again. Use the signed email unsubscribe twice, force one provider rejection/retry exhaustion, replay a callback, and attempt concurrent worker claims.
- Expected result: Each enabled channel operates independently. There is one Google event and one internal appointment; they match after reschedule/cancel. No internal appointment exists when calendar availability or event creation is uncertain. The lead reaches `appointment_set`, the assigned agent is notified, one idempotent CRM event is queued, and takeover cancels queued AI/follow-up. SMS STOP and email unsubscribe affect the correct channel. Rejection is visible, bounded retries create an operator task, terminal states do not regress, and no message or booking occurs twice.
- Evidence to retain: Redacted message/provider/event/appointment/delivery IDs, status timeline, free/busy result, calendar and internal screenshots, notification, CRM delivery, takeover state, signed-callback results, consent rows, operations tasks, and worker claim query. Never retain OAuth tokens or webhook secrets.
- Failure response: Set global pause immediately for opt-out, signature, duplicate-send, or wrong-recipient failure; notify compliance/incident contacts.
- Rollback action: Cancel queued messages/enrollments, disconnect the affected provider, preserve logs, and resume only after controlled retest.

## Test 16 — Reporting

- Pass/fail: [ ] PASS [ ] FAIL
- Preconditions: Controlled records from Tests 14–15 and at least one lead stage change.
- Exact action: Select an explicit date range and manually count raw leads, outbound created/attempted/provider-accepted/sent/delivered/failed/skipped/canceled, replies, opt-outs, assignments, and `appointment_set` stage events. Compare to Reports and test as owner and assigned non-admin user.
- Expected result: Totals reconcile exactly; failed/pending/skipped are not delivered; provider acceptance is not delivery; the reporting appointment metric remains `Leads moved to Appointment Set during this period`, while appointment records separately expose Google sync status; date range, timezone, sources, definitions, and limitations display. Non-admin scope includes only assigned leads.
- Evidence to retain: Redacted SQL/count sheet, report screenshot/export, date/timezone, raw IDs used in reconciliation.
- Failure response: Do not share the report externally; open a reporting incident and identify the incorrect query/state.
- Rollback action: Hide/revert the affected metric until corrected and rerun the same fixture reconciliation.

## Test 17 — Recurring payment success

- Pass/fail: [ ] PASS [ ] FAIL
- Preconditions: Stripe test subscription from Test 5; test clock or sandbox renewal method available.
- Exact action: Advance the Stripe test clock or complete a test renewal. Observe `invoice.payment_succeeded` and the related subscription update through the signed webhook.
- Expected result: Webhook ledger completes once; latest invoice, period, subscription status, plan/interval, billing update time, and tenant entitlement remain correct; no duplicate welcome/task/subscription occurs.
- Evidence to retain: Stripe test clock/invoice/event IDs, ledger row, tenant billing before/after, entitlement response.
- Failure response: Pause new payment acceptance and reconcile local state against Stripe.
- Rollback action: Replay the signed event after the fix or run a reviewed subscription resync; never hand-edit a paid plan without Stripe evidence.

## Test 18 — Payment failure

- Pass/fail: [ ] PASS [ ] FAIL
- Preconditions: Test subscription and owner-approved `BILLING_GRACE_DAYS` value; billing portal works.
- Exact action: Trigger `invoice.payment_failed`. Check tenant billing, operations queue, client billing UI/portal, entitlement during and after the configured grace boundary, and existing data access.
- Expected result: Status becomes `past_due`, failure/invoice timestamps update, one high-priority payment task appears, payment-update action works, protected new activity stops at policy boundary, and login/view/export/support data remain available. No data is deleted.
- Evidence to retain: Stripe event/invoice IDs, task ID, billing fields, entitlement decisions at controlled times, portal screenshot.
- Failure response: Global-pause the tenant if activity continues after grace; contact the billing owner through approved channels.
- Rollback action: Use Stripe test payment recovery, process `invoice.payment_succeeded`, verify state resynchronizes, then resume only after entitlement passes.

## Test 19 — Support

- Pass/fail: [ ] PASS [ ] FAIL
- Preconditions: Authenticated client; platform admin; monitored inbox for positive notification test.
- Exact action: Submit normal, high, or urgent support from authenticated navigation. Force notification failure once in nonproduction. In Admin, assign owner, change status, set due date, add resolution note, resolve, and reopen.
- Expected result: Ticket persists under the authenticated tenant and is accessible from navigation. Queue shows severity, owner, SLA/due date, state, timestamps, summary, and notes even when email fails. High/urgent emits `support_escalation`.
- Evidence to retain: Ticket/task IDs, client/admin screenshots, notification status/log event, resolution note.
- Failure response: Manually capture and own the issue; stop launch if persistence or tenant attribution fails.
- Rollback action: Restore support queue behavior; retain the ticket and reconcile its task rather than resubmitting sensitive details.

## Test 20 — Cancellation

- Pass/fail: [ ] PASS [ ] FAIL
- Preconditions: Two Stripe test subscriptions/workspaces where practical; export function and support remain available.
- Exact action: In separate tests request immediate cancellation and cancellation at period end through the billing/support process. Process subscription updates/deletion. Inspect billing, lifecycle, automation, operator/billing/provider-disable tasks, client access, support, and export.
- Expected result: Effective date and cancel-at-period-end state match Stripe. At the effective boundary protected activity stops and automation is off; immediate deletion sets lifecycle `CANCELED`. Cancellation, billing follow-up, and provider-disable tasks persist. Login, status, support, and permitted export remain; production data is not automatically deleted.
- Evidence to retain: Stripe subscription/event IDs, request/task IDs, lifecycle/settings/billing fields, export checksum, access checks.
- Failure response: Global-pause the tenant if service continues beyond the agreed boundary; escalate any data loss.
- Rollback action: For an erroneous test cancellation, create a new Stripe test subscription through the normal flow and require a fresh activation review; do not silently flip local billing state.

## Test 21 — Access and billing reconciliation

- Pass/fail: [ ] PASS [ ] FAIL
- Preconditions: Test tenants representing onboarding/unactivated, expired trial, past-due beyond grace, unpaid/incomplete, paused, and canceled states; one active control tenant; Tenant A and Tenant B records.
- Exact action: For each blocked tenant attempt sequence activation/enrollment/run, automated SMS/email, manual SMS, integration-triggered protected intake activity, automation enablement, and protected team expansion. Attempt direct Tenant B lead, message thread, sequence, enrollment, team/user, credential, onboarding, and report identifiers while logged in to Tenant A. Verify allowed billing/support/export/status actions.
- Expected result: Every blocked/unknown billing or lifecycle state denies new protected activity with explicit reasons. Tenant A receives 403/404/null—not Tenant B data—and no mutation/send occurs. Active control works only with consent/approval. Billing portal, payment update, support, status, disabling integrations, and permitted export remain accessible.
- Evidence to retain: State/action matrix with HTTP results, tenant-isolation request IDs, before/after record counts, audit/log events, active-control evidence.
- Failure response: This is a launch blocker. Set `GLOBAL_AUTOMATIONS_DISABLED=true`, suspend payment acceptance, preserve evidence, and start an isolation/billing incident.
- Rollback action: Keep all affected tenants paused, deploy the corrected authorization/entitlement code, revoke sessions if needed, and repeat the entire matrix before go-live.

## Final sign-off

- [ ] All 21 tests passed on the same release candidate.
- [ ] No unresolved launch-blocker failure is waived.
- [ ] Evidence location: ____________________
- [ ] Deployed commit: ____________________
- [ ] Tester/date: ____________________
- [ ] Business owner written approval: ____________________
- [ ] Platform operator written approval: ____________________
