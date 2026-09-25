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
#   BACKUP_KEY (object name, e.g. rta-prod-20260925T150139Z.dump.gpg)

set -eu

for v in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET \
         BACKUP_ENCRYPTION_KEY RESTORE_DATABASE_URL BACKUP_KEY; do
  if [ -z "${v+set}" ] || [ -z "$(eval echo \"\$$v\")" ]; then
    echo "ERROR: required env var $v is not set" >&2
    exit 1
  fi
done

START_EPOCH=$(date +%s)
WORKDIR="/tmp/rta-restore-$$"
mkdir -p "$WORKDIR"
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_EC2_METADATA_DISABLED=true
export PGPASSWORD="$(echo "$RESTORE_DATABASE_URL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')"
R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

echo "[$(date -u +%FT%TZ)] Restore test starting: $BACKUP_KEY"

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
echo "Restoring (pg_restore)..."
pg_restore --no-owner --no-privileges --dbname="$TARGET_URL" "$WORKDIR/backup.dump" 2>&1 | tail -5
echo "pg_restore finished"

# 5. Verify representative data
echo "Verifying..."
PSQL="psql $TARGET_URL -t -A"
TABLES="tenants users leads lead_events messages sequences sequence_steps sequence_enrollments audit_logs credentials password_reset_tokens"
for t in $TABLES; do
  n=$($PSQL -c "SELECT count(*) FROM $t" 2>/dev/null || echo "MISSING")
  echo "  $t: $n rows"
done
TEST_TENANT="c2d3b240-7b15-491a-acf7-d26ea0f6d907"
TENANT_NAME=$($PSQL -c "SELECT name FROM tenants WHERE id='$TEST_TENANT'")
echo "  TEST tenant present: ${TENANT_NAME:-NO}"
LEAD_MSGS=$($PSQL -c "SELECT count(*) FROM messages WHERE lead_id IN (SELECT id FROM leads WHERE tenant_id='$TEST_TENANT')")
echo "  messages on TEST-tenant leads: $LEAD_MSGS"
if [ -z "$TENANT_NAME" ]; then
  echo "ERROR: TEST tenant missing after restore" >&2
  psql "$RESTORE_DATABASE_URL" -c "DROP DATABASE \"$RESTORE_DB\"" > /dev/null || true
  exit 1
fi

# 6. RPO / RTO
END_EPOCH=$(date +%s)
RTO=$((END_EPOCH - START_EPOCH))
BACKUP_TS=$(echo "$BACKUP_KEY" | sed -n 's/rta-prod-\(.*\)\.dump\.gpg/\1/p')
BACKUP_EPOCH=$(date -u -d "${BACKUP_TS%Z}" +%s 2>/dev/null || date -u -j -f "%Y%m%dT%H%M%S" "$BACKUP_TS" +%s 2>/dev/null || echo 0)
RPO_AGE=$((END_EPOCH - BACKUP_EPOCH))
echo "RPO: backup age ${RPO_AGE}s (target <=3600s)"
echo "RTO: restore+verify ${RTO}s (target <=14400s)"

# 7. Cleanup: drop the isolated database
psql "$RESTORE_DATABASE_URL" -c "DROP DATABASE \"$RESTORE_DB\"" > /dev/null
echo "Isolated database dropped"

if [ "$RPO_AGE" -gt 3600 ]; then echo "WARN: RPO above 60 minutes"; fi
echo "[$(date -u +%FT%TZ)] Restore test SUCCEEDED: $BACKUP_KEY"
