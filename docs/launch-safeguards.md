# Launch safeguards

This release extends the existing managed-service architecture. It does not replace the current consent, quiet-hour, entitlement, provider-verification, idempotency, audit, controlled-UAT, export, or service-suspension paths.

## Implemented application safeguards

- Tenant and platform hourly/daily SMS and email caps.
- Tenant and platform daily AI-call caps.
- Tenant and platform daily warning and hard cost thresholds.
- Atomic PostgreSQL usage reservations with idempotency keys, preventing retry double-counting and distributed-worker races.
- 80%-style configurable owner warnings and hard-limit automation pause with a critical operations task.
- Lead-ingestion velocity caps for custom, Zillow, and Realtor.com intake paths.
- Quality monitoring for opt-outs, SMS failures, email bounces/drops, and spam complaints, with client warning, automatic pause, or suspension by severity.
- SendGrid bounce/drop/blocked events add the recipient to the existing email suppression path, and provider traffic is classified as `transactional` or `lead_follow_up`.
- Expanded immutable audit events with actor type, event type, resource, before/after state, and IP address fields; automated operational retention no longer purges audit events.
- Explicit `TESTING` lifecycle state. Live automation remains disabled until controlled tests and every activation requirement pass.
- Activation gates for tenant/platform limits, unresolved safety incidents, client policy certifications, recent disaster-recovery evidence, and legal-review evidence in production.
- Owner-controlled usage-limit API and admin-dashboard controls.
- Acceptable Use and Data Retention & Deletion pages plus versioned onboarding acknowledgement.

## Operational launch blockers that code cannot truthfully complete

- Enable the production database provider's backups/PITR and retention.
- Perform and document one isolated restore using `docs/disaster-recovery-runbook.md`.
- Configure and verify SPF, DKIM, and DMARC for the production sending domain.
- Enable SendGrid suppression management and monitor reputation/bounce/complaint dashboards.
- Have qualified counsel review the actual Terms, Privacy Policy, Acceptable Use Policy, subscription/cancellation terms, consent workflow, and retention policy.
- Record the production environment evidence only after those steps pass.

No environment variable should be set merely to make readiness turn green.
