# Production operations checklist

The pre-launch source of truth is `docs/production-launch-owner-checklist.md`; the release/migration source of truth is `docs/database-migration-runbook.md`; the acceptance source of truth is `docs/first-client-uat.md`. This page covers recurring controls after an approved pilot launches.

Never paste secrets, access tokens, message bodies containing personal data, or database URLs into evidence. Use safe record/provider IDs and dated links.

## Every business day during the pilot

- [ ] `GET <api-origin>/health/readiness` with `x-health-check-token: <HEALTH_CHECK_TOKEN>` returns HTTP 200 `status: ready`; investigate database, schema, pending migrations, production config, system email, billing, worker, or plaintext-credential failure before allowing new work.
- [ ] Admin → Operations has no unowned critical/high-priority application, integration, messaging, payment, support, cancellation, deletion, compliance, or onboarding task.
- [ ] Stripe Workbench has no unreviewed webhook failure and local `stripe_webhook_events` failed rows are reconciled.
- [ ] Twilio Messaging Logs delivery errors reconcile to local Failed messages and operations tasks.
- [ ] SendGrid Activity blocks/bounces for system email are assigned; verify/reset/welcome/application/support flows are not silently failing.
- [ ] The monitored operations mailbox has a primary and backup reviewer.

## Weekly

- [ ] Review Railway failed deployments, crashes/restarts, CPU, memory, storage, and request-error alerts.
- [ ] Review Vercel failed deployments and public/mobile flow availability.
- [ ] Review Stripe dunning/past-due accounts against `BILLING_GRACE_DAYS`; confirm protected activity stops at the boundary without deleting data.
- [ ] Review provider integration status and expire/retest any credential changed during the week.
- [ ] Review admin/platform membership, open impersonation/audit anomalies, and tenant lifecycle/automation mismatches.
- [ ] Export operations queue status and assign due dates/resolution evidence.

## Monthly

- [ ] Confirm the newest PostgreSQL backup and PITR window; restore into isolated nonproduction and run readiness, migration state, login, lead/report read, and row-count/checksum checks.
- [ ] Run a controlled lead through consent → approved message → callback/reply → STOP/unsubscribe → reporting reconciliation.
- [ ] Run a Tenant A/Tenant B direct-ID isolation smoke test.
- [ ] Reconcile a Stripe subscription/invoice/event to local tenant and webhook-ledger state.
- [ ] Review retention/deletion requests, legal-policy versions, consent disclosures, provider authorizations, and incident contacts.

## Incident stop procedure

Use this for tenant isolation uncertainty, wrong-recipient messaging, invalid webhook trust, opt-out failure, corrupted billing entitlement, or unsafe schema/readiness:

1. Set Railway `GLOBAL_AUTOMATIONS_DISABLED=true` and redeploy/restart.
2. Use platform Admin Pause for every affected tenant.
3. Stop public checkout/onboarding if billing or tenant routing is implicated.
4. Preserve request IDs, safe provider IDs, audit/operations rows, deployed commit, and UTC timeline; do not copy secrets or full unnecessary message content.
5. Confirm no message/sequence worker advances protected work and `/health/readiness` reports the global pause.
6. Notify primary/backup incident contacts and affected client under the approved incident plan.
7. Resume only after a tested fix, two-person review, controlled UAT, written owner authorization, and recorded UTC resume time.
