# Production database disaster recovery runbook

## Objective and launch gate

RealtyTechAI targets an RPO of 60 minutes or less and an RTO of four hours or less. A backup is not considered proven until a production backup has been restored into an isolated environment and representative leads and messages have been verified.

Public client activation in production remains blocked until the restore evidence variables below are recorded. Do not invent values or set them before the test passes.

## Roles and protected access

- Incident commander: RealtyTechAI platform owner.
- Database operator: the person authorized to access Railway/PostgreSQL backups.
- Application verifier: a platform operator who can compare representative tenant records without exporting secrets.
- Restore credentials must be stored separately from the application runtime and limited to the restore operator.
- Never restore production data into a developer laptop or a publicly reachable database.

## Backup configuration checklist

- [ ] Automated production backups or point-in-time recovery are enabled.
- [ ] The provider schedule guarantees an RPO of 60 minutes or less.
- [ ] Backup retention is at least seven days and matches the approved retention policy.
- [ ] Encryption at rest and in transit is enabled.
- [ ] Restore credentials are protected separately from application credentials.
- [ ] Backup failure notifications reach the platform owner.
- [ ] `TYPEORM_SYNC=false` and `RUN_MIGRATIONS=true` are set in production.

## Isolated restore test

1. Record the production database provider, backup identifier, backup timestamp, and application commit under test.
2. Create a private, isolated PostgreSQL restore target with no provider webhooks, background workers, public ingress, or outbound messaging credentials.
3. Restore the selected backup using protected restore credentials.
4. Connect using a read-only verification account.
5. Run schema checks and confirm the expected migration head exists in `app_migrations`.
6. Select at least two known test tenants. Verify tenant-scoped counts for leads, messages, consent records, onboarding records, and audit events.
7. Verify representative lead and message IDs, timestamps, directions, statuses, and tenant IDs against the source evidence. Never compare or export plaintext provider secrets.
8. Start the API against the isolated target with `GLOBAL_AUTOMATIONS_DISABLED=true`, provider credentials absent, and workers disabled or network-blocked.
9. Confirm health/schema readiness without sending SMS, email, AI, billing, or provider callbacks.
10. Record restore start, restore completion, verification completion, achieved RPO, achieved RTO, verifier, and evidence location.
11. Destroy the isolated target through the provider-approved deletion process after the evidence is retained. Record the deletion time.

## Failure recovery procedure

1. Declare the incident and set `GLOBAL_AUTOMATIONS_DISABLED=true` anywhere the application remains reachable.
2. Disable provider callbacks or point them to a maintenance response if writes could reach an inconsistent database.
3. Identify the last known-good backup or point-in-time target and calculate the expected data-loss window.
4. Create a new production database target; do not overwrite the damaged database.
5. Restore and run the same schema and tenant verification steps used in the isolated test.
6. Point one backend instance at the restored target with automations paused.
7. Validate authentication, tenant isolation, lead reads, conversation reads, audit reads, and idempotency ledgers.
8. Re-enable signed inbound webhooks before outbound workers so delayed provider events can reconcile safely.
9. Re-enable workers in this order: webhook reconciliation, outbound messages, sequences, AI.
10. Monitor duplicates, stuck work, provider failures, cross-tenant anomalies, and billing events.
11. Close the incident only after the owner records actual RPO/RTO and corrective actions.

## Evidence record

Store this record outside the production database:

| Field | Required evidence |
| --- | --- |
| Backup ID and timestamp | Provider backup/PITR reference |
| Restore target | Isolated database identifier |
| Source release | Git commit SHA |
| Started/completed | UTC timestamps |
| Achieved RPO/RTO | Minutes |
| Verified tenants | Test tenant IDs only |
| Verified records | Lead/message/consent/audit IDs or checksums |
| Verifier | Named operator |
| Isolation proof | No public ingress, workers, or provider credentials |
| Cleanup | Restore target deletion timestamp |

After a successful test, configure:

```text
BACKUP_RESTORE_TESTED_AT=<UTC timestamp>
BACKUP_RPO_MINUTES=<achieved value, maximum 60>
BACKUP_RTO_MINUTES=<achieved value, maximum 240>
BACKUP_RETENTION_DAYS=<approved value, minimum 7>
BACKUP_RESTORE_ISOLATED_VERIFIED=true
BACKUP_RESTORE_CREDENTIALS_PROTECTED=true
```

Repeat at least every 90 days and after material database, hosting, encryption, or migration changes.
