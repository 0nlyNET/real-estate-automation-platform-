# Onboarding Automation Audit (P10)

**Date:** 2026-09-26
**Scope:** RealtyTechAI client onboarding — every manual operator step, classified for automation.
**Goal:** Jayden normally does only three things per client:
1. approve/create the client,
2. review exceptional blockers,
3. approve final activation.

Everything else is automated, client self-service, machine-verified, or an
external-provider wait that the system retries on its own.

## 1. Manual steps today (client #2 baseline)

The ~9+ manual Jayden actions per client observed today, each classified:

| # | Step today | Classification | Target end state |
|---|-----------|----------------|------------------|
| 1 | Create tenant + owner user + invitation | **must-remain-owner-approval** (the approve/create action) | Jayden approves/creates the client; invitation delivery stays as-is |
| 2 | Optional custom SendGrid identity (per-client sender) | **can-be-client-self-service** for the default; custom identity stays operator-assisted | Default managed identity is already fully automatic via the provisioning scan; custom domains require client DNS, which stays a guided step |
| 3 | Run tenant SendGrid connection test per client | **can-be-automated** — **IMPLEMENTED** | Auto-runs from the provisioning scan once the identity is testable; success marks the identity verified, clearing `sendgrid` + `sendgrid_provider_approval` blockers |
| 4 | Twilio setup (number assignment, messaging service, A2P/Trust Hub registration) | **must-remain-owner-approval** + **external-provider-wait** | Number assignment could be semi-automated later; A2P/Trust Hub approval is Twilio's timeline and stays a surfaced wait |
| 5 | Booking provider connect/test/activate + `appointment.created` CRM webhook | mixed: connect = **can-be-client-self-service** (OAuth), webhook create = **can-be-automated** (future), test verification = **can-be-automatically-verified** | UAT evidence already auto-records via `recordUatWorkflowEvidence`; the connect step stays client OAuth |
| 6 | Approve ≥1 SMS/email template | **must-remain-owner-approval** | Compliance review of message content is a judgment call and stays with Jayden |
| 7 | Configure usage limits (tenant + platform) | **can-be-automated** (future: safe defaults) | Defaults on tenant creation; Jayden reviews only exceptions |
| 8 | Start controlled testing | **can-be-automated** (future) | `beginTesting` already refuses until `testingReady`; auto-start is intentionally NOT in this change — starting TESTING sends controlled test traffic, so it stays an explicit operator action for now |
| 9 | Run full test lead + appointment UAT incl. Take Over | **can-be-automatically-verified** — already implemented | `recordAutomatedTestEvidence` / `recordUatWorkflowEvidence` record inbound SMS/email, STOP, provider rejection, outbound delivery, calendar, notification, CRM, and takeover checks from real system callbacks |
| 10 | Record client approval | **must-remain** (client) | Written approval for the exact setup stays a client action |
| 11 | Record operator approval | **must-remain-owner-approval** | Launch decision stays with Jayden |
| 12 | Click Activate | **must-remain-owner-approval** | Explicit operator `POST /activate` only — **never auto-activated**, Stripe payment alone cannot activate |

External waits (not automatable, but surfaced + retried):
- **SendGrid sender/domain verification** — external-provider-wait; the auto connection test now retries every 6h, so verification completes without Jayden re-running anything.
- **Twilio A2P/Trust Hub approval** — external-provider-wait; surfaced as the `twilio_provider_approval` blocker with the provider reference recorded once approved.

## 2. Readiness blocker taxonomy → automation mapping

`onboarding.service.ts` `readiness()` evaluates ~39 blockers in 8 categories:

| Category | Responsible party | Automation posture |
|----------|------------------|--------------------|
| `client_information` | client | Client self-service via onboarding form; blocking profile fields gate provisioning (`WAITING_FOR_CLIENT`) |
| `provider_configuration` | jayden | Email side now auto-verifies (this change); Twilio side stays operator-assisted |
| `controlled_live_test` | jayden | Machine-verified from real callbacks (`recordAutomatedTestEvidence`, `recordUatWorkflowEvidence`) |
| `external_provider_approval` | provider | SendGrid side auto-clears on verified identity; Twilio A2P stays a surfaced wait |
| `client_approval` | client | Stays manual |
| `platform_approval` | jayden | Template approval stays manual (compliance judgment) |
| `billing` | jayden | Auto-verified from signed Stripe state (`recordBillingFromStripe`) |
| `platform_control` | jayden/platform | Usage limits → future defaults; DR/legal/safety → manual evidence |

## 3. Automations implemented (this change)

### A. Auto-run tenant SendGrid connection test
**Where:** `TenantProvisioningService.maybeAutoVerifyEmailIdentity`, called from
`reconcileTenantProvisioning` (both the full-reconcile path and the recurring
`TESTING` scan branch — `backend/src/modules/integrations/tenant-provisioning.service.ts`).

**Behavior:**
- Runs only when: email is enabled, the managed identity exists but is not yet
  verified (`tenantSummary` sendgrid status `testing`/`failed`), the tenant is
  NOT `ACTIVE` (never auto-send from a live client), a valid controlled test
  recipient exists (`contacts.controlledTestEmail` → `contacts.accountOwner`
  fallback), and no attempt in the last 6 hours.
- Uses the existing `PlatformIntegrationsService.testTenantSendGrid`, the same
  code path as the manual admin test. On success it calls `markVerified`
  internally → `emailStatus='ready'` + `lastVerifiedAt`, which clears the
  `sendgrid` (provider_configuration) and `sendgrid_provider_approval`
  (external_provider_approval) readiness blockers.
- On failure: records the attempt, creates one deduplicated
  (`dedupeOpen: true`) operator task in `provider_configuration`, and never
  breaks provisioning — the helper cannot throw.

**Safety properties (regression-tested):**
- Never activates the tenant; never touches lifecycle/activation status.
- Never re-tests an already-verified identity (no surprise mail).
- Attempts are throttled (6h) and tracked in `providerTests.sendgridAutoTestLastAttemptedAt`.
- Recipient is always a controlled address, never a lead.

### B. Auto-reconcile `approvedEmailIdentity`
**Where:** `OnboardingService.autoAlignApprovedEmailIdentity`
(`backend/src/modules/onboarding/onboarding.service.ts`), invoked before the
auto test in the provisioning hook.

**Behavior:**
- Client never set one + provisioned identity exists → adopt the provisioned
  from address (bumps `configurationUpdatedAt`, writes an audit event
  `onboarding.approved_email_identity_auto_aligned`).
- Matches case-insensitively → no-op.
- Client explicitly set a DIFFERENT address → **never silently overridden**;
  returns `mismatch` and the provisioning hook raises a deduplicated operator
  task naming both addresses for Jayden to resolve.
- Skipped when email is disabled or no identity is provisioned.

This removes the "identity stays pending with no recourse" dead end
(`onboarding.service.ts` approvedEmail-vs-fromEmail equality check).

### C. Auto-collect machine-verifiable test evidence
Already covered by `recordAutomatedTestEvidence` (inbound SMS/email, STOP,
provider rejection, outbound delivery → `test_lead`) and
`recordUatWorkflowEvidence` (calendar availability, external/internal
appointment records, agent notification, CRM appointment event, human
takeover → `appointment_uat`), all gated to `TESTING` lifecycle + a live
test run. Verified: the only machine-verifiable gaps were the SendGrid
identity blockers, now closed by automations A and B. `intake_api_test` is
already automatic (`intakeLastReceivedAt` is set on real intake receipt).
No changes were needed here beyond documenting the coverage.

## 4. Target end state vs. today

| Jayden action | Before | After |
|---------------|--------|-------|
| Approve/create client | manual | manual (unchanged) |
| Run SendGrid connection test per client | manual | **automatic** (retries on 6h cadence until verified) |
| Reconcile approved sender identity | manual, dead-end blocker | **automatic**; mismatches surface as one deduplicated task |
| Review exceptional blockers | manual | manual — now only true exceptions (mismatches, failed tests, A2P waits, template review, approvals, activation) |
| Approve final activation | manual | manual (unchanged, `POST /activate` only) |

## 5. Explicitly NOT automated (and why)

- **Activation** — `activate()` still requires `readiness.ready` + explicit
  operator `POST /activate`. Stripe payment alone cannot activate. No
  auto-activation, ever.
- **Template approval** — message-content compliance review is a judgment call.
- **Client approval** — written approval for the exact setup is the client's.
- **Operator approval** — the launch decision is Jayden's.
- **Twilio A2P/Trust Hub** — external provider timeline; surfaced, not skipped.
- **Starting controlled TESTING** — left explicit for now because it sends
  controlled test traffic; the readiness gate (`testingReady`) is already
  machine-computed, so auto-start is a safe future step when Jayden opts in.
- **Readiness gates are not weakened** — automations only satisfy existing
  checks with real evidence (a genuinely passing connection test, a genuinely
  matching identity); they never mark items passed by fiat.

## 6. Regression tests

- `backend/src/modules/onboarding/onboarding.service.spec.ts` →
  "onboarding safe automations (P10)": align/no-op/mismatch/disabled/missing-identity,
  attempt tracking, recipient resolution (7 tests).
- `backend/src/modules/integrations/tenant-provisioning.service.spec.ts` →
  auto-test on testable pass, skip when verified, skip for ACTIVE, skip without
  recipient, 6h throttle, failed-attempt task, thrown-error handling, mismatch
  task, retry on TESTING scan branch (9 tests).

Run: `npx jest src/modules/onboarding src/modules/integrations src/modules/durable-jobs`
— 13 suites, 95 tests, all passing (3 consecutive clean runs).
