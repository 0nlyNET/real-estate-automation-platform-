#!/bin/sh
# RealtyTechAI isolated restore test (one-shot).
# Downloads an encrypted backup from R2, decrypts, restores into a FRESH
# database on the target server, verifies data, measures RPO/RTO, cleans up.
# NEVER log: DATABASE URLs, R2 secrets, encryption keys.
#
# Required env vars (Railway variables, never in code):
#   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
#   BACKUP_ENCRYPTION_KEY (base64 32-byte, same as backup),
#   RESTORE_DATABASE_URL (target Postgres server URL; a NEW database is
#     created on this server and DROPPED afterwards - never the default db),
#   BACKUP_KEY (object name, e.g. rta-prod-20260925T150139Z.dump.gpg),
#   TEST_TENANT_ID (tenant ID to verify after restore; not hard-coded)

set -eu

for v in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET \
         BACKUP_ENCRYPTION_KEY RESTORE_DATABASE_URL BACKUP_KEY TEST_TENANT_ID; do
  if [ -z "${v+set}" ] || [ -z "$(eval echo \"\$$v\")" ]; then
    echo "ERROR: required env var $v is not set" >&2
    exit 1
  fi
done

START_EPOCH=$(date +%s)
WORKDIR="/tmp/rta-restore-$$"
RESTORE_DB=""
mkdir -p "$WORKDIR"
cleanup() {
  rm -rf "$WORKDIR"
  if [ -n "$RESTORE_DB" ]; then
    psql "$RESTORE_DATABASE_URL" -c "DROP DATABASE IF EXISTS \"$RESTORE_DB\"" > /dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_EC2_METADATA_DISABLED=true
export PGPASSWORD="$(echo "$RESTORE_DATABASE_URL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')"
R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

echo "[$(date -u +%FT%TZ)] Restore test starting: $BACKUP_KEY"

# 0. Defensive: drop only the exact database this run will create, if a previous
# run died before cleanup. Do NOT broadly delete restore_test_* — that could
# drop another concurrent run's database.
# (The RESTORE_DB name is set in step 3; this is a no-op on first run.)

# 1. Download from R2
echo "Downloading from R2..."
aws --only-show-errors --endpoint-url "$R2_ENDPOINT" \
  s3 cp "s3://${R2_BUCKET}/${BACKUP_KEY}" "$WORKDIR/backup.dump.gpg"
DL_SIZE=$(stat -c%s "$WORKDIR/backup.dump.gpg" 2>/dev/null || stat -f%z "$WORKDIR/backup.dump.gpg")
echo "Downloaded: ${DL_SIZE} bytes"

# 2. Decrypt (base64 passphrase string used directly, see backup.sh)
echo "Decrypting..."
printf '%s' "$BACKUP_ENCRYPTION_KEY" | \
  gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 \
      -d -o "$WORKDIR/backup.dump" "$WORKDIR/backup.dump.gpg"
rm -f "$WORKDIR/backup.dump.gpg"
DEC_SIZE=$(stat -c%s "$WORKDIR/backup.dump" 2>/dev/null || stat -f%z "$WORKDIR/backup.dump")
echo "Decrypted: ${DEC_SIZE} bytes"

# 3. Create isolated database on target server
RESTORE_DB="restore_test_$(date -u +%Y%m%dT%H%M%S)"
echo "Creating isolated database: $RESTORE_DB"
psql "$RESTORE_DATABASE_URL" -c "CREATE DATABASE \"$RESTORE_DB\"" > /dev/null
TARGET_URL="$(echo "$RESTORE_DATABASE_URL" | sed "s|/[^/?]*\(?.*\)\?$|/$RESTORE_DB\1|")"

# 4. Restore
# Do NOT pipe pg_restore to tail: under /bin/sh the pipeline's exit status is
# tail's, masking pg_restore failures. Capture output to a file instead.
echo "Restoring (pg_restore)..."
if ! pg_restore --no-owner --no-privileges --dbname="$TARGET_URL" "$WORKDIR/backup.dump" > "$WORKDIR/restore.log" 2>&1; then
  echo "ERROR: pg_restore failed (see $WORKDIR/restore.log)" >&2
  tail -20 "$WORKDIR/restore.log" >&2 || true
  exit 1
fi
echo "pg_restore finished"
tail -5 "$WORKDIR/restore.log" || true

# 5. Verify representative data
# Fail on any missing table or missing TEST tenant data — a restore that drops
# tables or loses data is not a successful restore.
echo "Verifying..."
PSQL="psql $TARGET_URL -t -A"
TABLES="tenants users leads lead_events messages sequences sequence_steps sequence_enrollments audit_logs credentials password_reset_tokens"
VERIFY_FAILED=0
for t in $TABLES; do
  n=$($PSQL -c "SELECT count(*) FROM $t" 2>/dev/null || echo "MISSING")
  echo "  $t: $n rows"
  if [ "$n" = "MISSING" ]; then
    echo "ERROR: table $t is missing after restore" >&2
    VERIFY_FAILED=1
  fi
done
# TEST_TENANT must be provided via env (not hard-coded) for the drill to be
# meaningful across environments.
if [ -z "${TEST_TENANT_ID:-}" ]; then
  echo "ERROR: TEST_TENANT_ID env var is required for restore verification" >&2
  exit 1
fi
TEST_TENANT="$TEST_TENANT_ID"
TENANT_NAME=$($PSQL -c "SELECT name FROM tenants WHERE id='$TEST_TENANT'")
echo "  TEST tenant present: ${TENANT_NAME:-NO}"
LEAD_MSGS=$($PSQL -c "SELECT count(*) FROM messages WHERE \"leadId\" IN (SELECT id FROM leads WHERE tenant_id='$TEST_TENANT')")
echo "  messages on TEST-tenant leads: $LEAD_MSGS"
if [ -z "$TENANT_NAME" ]; then
  echo "ERROR: TEST tenant missing after restore" >&2
  VERIFY_FAILED=1
fi
if [ "$VERIFY_FAILED" = "1" ]; then
  echo "ERROR: restore verification failed" >&2
  exit 1
fi

# 6. RPO / RTO
END_EPOCH=$(date +%s)
RTO=$((END_EPOCH - START_EPOCH))
BACKUP_TS=$(echo "$BACKUP_KEY" | sed -n 's/rta-prod-\(.*\)\.dump\.gpg/\1/p')
# BACKUP_TS looks like 20260925T150139Z -> reformat for GNU date
BTS=$(echo "$BACKUP_TS" | sed -E 's/^([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})Z$/\1-\2-\3 \4:\5:\6/')
BACKUP_EPOCH=$(date -u -d "$BTS" +%s 2>/dev/null || echo 0)
if [ "$BACKUP_EPOCH" = "0" ]; then echo "WARN: could not parse backup timestamp $BACKUP_TS" >&2; fi
RPO_AGE=$((END_EPOCH - BACKUP_EPOCH))
echo "RPO: backup age ${RPO_AGE}s (target <=3600s)"
echo "RTO: restore+verify ${RTO}s (target <=14400s)"
# Enforce RPO/RTO targets: fail the drill if either is exceeded.
if [ "$RPO_AGE" -gt 3600 ]; then
  echo "ERROR: RPO violated: backup age ${RPO_AGE}s exceeds 3600s (60 minutes)" >&2
  exit 1
fi
if [ "$RTO" -gt 14400 ]; then
  echo "ERROR: RTO violated: restore+verify ${RTO}s exceeds 14400s (240 minutes)" >&2
  exit 1
fi
echo "RPO/RTO targets met."

# 7. Cleanup: drop the isolated database
psql "$RESTORE_DATABASE_URL" -c "DROP DATABASE \"$RESTORE_DB\"" > /dev/null
echo "Isolated database dropped"

if [ "$RPO_AGE" -gt 3600 ]; then echo "WARN: RPO above 60 minutes"; fi
echo "[$(date -u +%FT%TZ)] Restore test SUCCEEDED: $BACKUP_KEY"
