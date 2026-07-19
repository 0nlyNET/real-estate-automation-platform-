# Client-readiness database migration runbook

This runbook applies `ClientReadinessFoundations1784419200001` through TypeORM with `TYPEORM_SYNC=false`. The migration is additive and runs in the configured `all` transaction. Its `down()` is intentionally non-destructive because dropping consent, Stripe ledger, onboarding, stage-history, and operations evidence is not an acceptable rollback.

## Before the release

1. Set Railway `GLOBAL_AUTOMATIONS_DISABLED=true` and keep one backend replica.
2. Record the release commit, operator, UTC time, database environment, current `app_migrations` rows, and row counts for all affected tables.
3. Create a provider backup/PITR bookmark. Record its opaque backup ID, not the database URL.
4. Restore that backup into an isolated nonproduction database and confirm it is readable before touching production.
5. Run the preflight queries below using read-only credentials first. Do not delete, merge, or reassign ambiguous rows automatically.
6. Build the backend from the release commit. Confirm `NODE_ENV=production`, `TYPEORM_SYNC=false`, `RUN_MIGRATIONS=true`, and the correct `DATABASE_URL`/`DATABASE_SSL=true` are set in Railway.

## Read-only integrity preflight

Every query must return zero rows or an `issue_count` of zero. Save the results as release evidence with personal fields excluded.

### Orphaned tenant-owned records

```sql
SELECT 'users.tenantId -> tenants.id' AS relation, COUNT(*)::int AS issue_count
FROM users c LEFT JOIN tenants p ON p.id = c."tenantId"
WHERE c."tenantId" IS NOT NULL AND p.id IS NULL
UNION ALL
SELECT 'leads.tenant_id -> tenants.id', COUNT(*)::int
FROM leads c LEFT JOIN tenants p ON p.id = c.tenant_id
WHERE c.tenant_id IS NOT NULL AND p.id IS NULL
UNION ALL
SELECT 'sequences.tenant_id -> tenants.id', COUNT(*)::int
FROM sequences c LEFT JOIN tenants p ON p.id = c.tenant_id
WHERE c.tenant_id IS NOT NULL AND p.id IS NULL
UNION ALL
SELECT 'credentials.tenantId -> tenants.id', COUNT(*)::int
FROM credentials c LEFT JOIN tenants p ON p.id = c."tenantId"
WHERE c."tenantId" IS NOT NULL AND p.id IS NULL
UNION ALL
SELECT 'support_tickets.tenantId -> tenants.id', COUNT(*)::int
FROM support_tickets c LEFT JOIN tenants p ON p.id = c."tenantId"
WHERE c."tenantId" IS NOT NULL AND p.id IS NULL;
```

### Orphaned lead/sequence relationships

```sql
SELECT 'messages.leadId -> leads.id' AS relation, COUNT(*)::int AS issue_count
FROM messages c LEFT JOIN leads p ON p.id = c."leadId"
WHERE c."leadId" IS NOT NULL AND p.id IS NULL
UNION ALL
SELECT 'sequence_enrollments.leadId -> leads.id', COUNT(*)::int
FROM sequence_enrollments c LEFT JOIN leads p ON p.id = c."leadId"
WHERE c."leadId" IS NOT NULL AND p.id IS NULL
UNION ALL
SELECT 'sequence_enrollments.sequenceId -> sequences.id', COUNT(*)::int
FROM sequence_enrollments c LEFT JOIN sequences p ON p.id = c."sequenceId"
WHERE c."sequenceId" IS NOT NULL AND p.id IS NULL
UNION ALL
SELECT 'sequence_steps.sequenceId -> sequences.id', COUNT(*)::int
FROM sequence_steps c LEFT JOIN sequences p ON p.id = c."sequenceId"
WHERE c."sequenceId" IS NOT NULL AND p.id IS NULL;
```

### Required tenant ownership

The migration backfills enrollment tenant from its lead before its internal guard, but production should still be understood before release.

```sql
SELECT 'sequences missing tenant_id' AS relation, COUNT(*)::int AS issue_count
FROM sequences WHERE tenant_id IS NULL
UNION ALL
SELECT 'sequence_enrollments missing tenant_id', COUNT(*)::int
FROM sequence_enrollments WHERE tenant_id IS NULL
UNION ALL
SELECT 'credentials missing tenantId', COUNT(*)::int
FROM credentials WHERE "tenantId" IS NULL;
```

For an enrollment with a valid lead, the migration derives `tenant_id` from `leads.tenant_id`. A sequence or credential with no tenant is ambiguous: stop and have an authorized operator map it from external ownership evidence. Do not guess.

### Duplicate rows that would violate new unique indexes

```sql
SELECT "tenantId", provider, COUNT(*)::int AS issue_count
FROM credentials
GROUP BY "tenantId", provider
HAVING COUNT(*) > 1;

SELECT "sequenceId", "leadId", COUNT(*)::int AS issue_count
FROM sequence_enrollments
WHERE status IN ('active', 'paused')
GROUP BY "sequenceId", "leadId"
HAVING COUNT(*) > 1;

SELECT idempotency_key, COUNT(*)::int AS issue_count
FROM messages
WHERE idempotency_key IS NOT NULL
GROUP BY idempotency_key
HAVING COUNT(*) > 1;

SELECT stripe_event_id, COUNT(*)::int AS issue_count
FROM stripe_webhook_events
GROUP BY stripe_event_id
HAVING COUNT(*) > 1;
```

The last two tables/columns may not exist before this migration; `messages.idempotency_key` is backfilled as `legacy:<message-id>`, and `stripe_webhook_events` is new. Run those two checks after migration as verification if the baseline lacks them.

### Credential storage audit

```sql
SELECT COUNT(*)::int AS legacy_plaintext_rows
FROM credentials
WHERE "encryptedValue" IS NOT NULL
  AND "encryptedValue" NOT LIKE 'v1:%';
```

Any nonzero value keeps `/health/readiness` down. Back up the database, identify tenant/provider ownership, and re-save each credential through the tenant Integrations workflow so it is encrypted with the configured `INTEGRATIONS_ENCRYPTION_KEY`. Rotate the external provider secret if plaintext exposure is possible. Do not mass-prefix or reinterpret plaintext as ciphertext.

## Applying the migration

From the built backend release artifact, with production variables injected:

```bash
npm run migration:show
npm run migration:run
npm run migration:show
```

Expected result:

- The first `migration:show` lists `ClientReadinessFoundations1784419200001` as pending.
- `migration:run` completes once. If its integrity guard finds dirty data, the transaction fails and reports counts without deleting rows.
- The second `migration:show` has no pending migration.
- `GET <api-origin>/health/readiness` returns HTTP 200 and `status: ready` only after configuration, schema, migrations, system email, billing, and legacy-credential checks pass.

## Post-migration verification

Run and retain:

```sql
SELECT name, run_on FROM app_migrations ORDER BY id;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'prospect_applications', 'stripe_webhook_events', 'onboarding_records',
    'operations_tasks', 'lead_consent_records', 'lead_stage_events'
  )
ORDER BY table_name;
```

Then verify:

- Automation settings were conservatively changed to false. Activation must be performed through the operator gate; do not bulk re-enable.
- Legacy message `pending`/`scheduled` states became `queued`; each has a unique `idempotency_key`.
- Invalid foreign references fail.
- Duplicate tenant/provider credentials fail.
- Duplicate active/paused sequence+lead enrollment fails.
- Duplicate message idempotency and Stripe event IDs fail.
- Existing valid tenant, lead, message, sequence, support, and auth data remains readable.
- `/health/readiness` reports database/schema/migrations/credential storage up and does not expose connection strings or secrets.
- A fresh application, onboarding record, operations task, consent record, stage change, and signed Stripe test event persist.

The automated reproduction evidence is in `backend/src/database/production-schema-reconciliation.spec.ts` and `backend/src/database/migrations/202607180001-legacy-auth-compatibility.spec.ts`.

## Failure and rollback procedure

### Migration fails before commit

1. Leave `GLOBAL_AUTOMATIONS_DISABLED=true` and the new deployment unhealthy/out of traffic.
2. TypeORM's `all` transaction should roll back the entire migration. Confirm no migration row was added and compare affected table counts/schema to the preflight record.
3. Correct only the identified data after ownership review and backup. Rerun preflight, restore drill, and migration.

### Application fails after the migration commits

1. Keep global pause on and stop payment/onboarding traffic.
2. Roll Railway back to the last known-good application image/commit. The migration is additive; the prior application should ignore extra tables/columns/indexes.
3. Do **not** run `migration:revert` expecting evidence deletion. This migration's `down()` intentionally does nothing.
4. Diagnose against a clone/restore, ship a forward fix, rerun tests and readiness, then redeploy one replica.

### Database corruption or incompatible behavior

Restore/PITR is a last resort because it discards post-snapshot writes. Require business owner and database operator approval, record the recovery point, export any safely recoverable post-snapshot applications/support/operations evidence, and restore into a separate environment first. Reconcile Stripe/Twilio/SendGrid events after recovery before automation resumes.

## Resume criteria

Remove the global pause only after migration checks, `/health/readiness`, two-tenant isolation, controlled application/payment, consent/STOP/unsubscribe, provider callback, reporting reconciliation, and the affected UAT smoke tests pass. Record who resumed automation and the UTC timestamp.
