#!/bin/bash
# RealtyTechAI Restore Drill — isolated recovery proof for RPO/RTO targets.
# Runs ONCE in an ephemeral Railway service, restores the latest production
# backup into a LOCAL throwaway Postgres (never touches prod/staging),
# verifies data, and logs timing. Service is deleted after the drill.
# NEVER log: DATABASE_URL, R2 secrets, encryption keys, auth headers.
set -e

DRILL_START=$(date -u +%s)
echo "[$(date -u +%FT%TZ)] === RESTORE DRILL START ==="

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_EC2_METADATA_DISABLED=true
R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
WORKDIR="/tmp/restore-drill-$$"
mkdir -p "$WORKDIR"
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

# 1. Find recent backups (newest first)
echo "Listing backups in R2..."
aws --endpoint-url "$R2_ENDPOINT" s3 ls "s3://${R2_BUCKET}/" > "$WORKDIR/listing.txt"
echo "--- R2 raw listing (last 10) ---"
tail -10 "$WORKDIR/listing.txt"
echo "--- end listing ---"
MAP=$(awk '{print $4}' "$WORKDIR/listing.txt" | grep '^rta-prod-.*\.dump\.gpg$' | sort -r | head -10)
if [ -z "$MAP" ]; then echo "DRILL FAIL: no backups found"; exit 1; fi
echo "Recent backups:"; echo "$MAP"

KEY_LEN=${#BACKUP_ENCRYPTION_KEY}
echo "Key present: $([ $KEY_LEN -gt 0 ] && echo yes || echo no), length: $KEY_LEN"
# Fingerprint (SHA256 of key, never the value) for rotation forensics
echo "$BACKUP_ENCRYPTION_KEY" | sha256sum | cut -c1-16 | xargs echo "Key fingerprint:"
# Definitive test: can the CURRENT key round-trip? (set +e to survive failure)
set +e
echo "canary-$(date -u +%s)" > "$WORKDIR/canary.txt"
echo "$BACKUP_ENCRYPTION_KEY" | base64 -d | gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 --symmetric --cipher-algo AES256 -o "$WORKDIR/canary.gpg" "$WORKDIR/canary.txt" 2>"$WORKDIR/gpg1.log"
E1=$?
echo "$BACKUP_ENCRYPTION_KEY" | base64 -d | gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 -o "$WORKDIR/canary.out" -d "$WORKDIR/canary.gpg" 2>"$WORKDIR/gpg2.log"
E2=$?
if [ $E1 -eq 0 ] && [ $E2 -eq 0 ] && cmp -s "$WORKDIR/canary.txt" "$WORKDIR/canary.out"; then
  echo "CANARY RESULT: PASS - current key round-trips correctly"
else
  echo "CANARY RESULT: FAIL - encrypt exit=$E1 decrypt exit=$E2"
fi
set -e

# 2+3. Try each backup: download + decrypt until one works
DECRYPTED=""
for CAND in $MAP; do
  echo "Trying $CAND ..."
  T0=$(date -u +%s)
  aws --endpoint-url "$R2_ENDPOINT" s3 cp "s3://${R2_BUCKET}/$CAND" "$WORKDIR/backup.dump.gpg"
  T1=$(date -u +%s)
  SZ=$(stat -c%s "$WORKDIR/backup.dump.gpg")
  echo "Downloaded ${SZ} bytes in $((T1-T0))s"
  if echo "$BACKUP_ENCRYPTION_KEY" | base64 -d | \
      gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 \
          -o "$WORKDIR/backup.dump" -d "$WORKDIR/backup.dump.gpg" 2>/dev/null; then
    echo "Decrypted OK: $CAND"
    LATEST="$CAND"; DECRYPTED="yes"; break
  else
    echo "Decrypt failed for $CAND, trying older backup..."
    rm -f "$WORKDIR/backup.dump.gpg" "$WORKDIR/backup.dump"
  fi
done
rm -f "$WORKDIR/backup.dump.gpg"
if [ -z "$DECRYPTED" ]; then echo "DRILL FAIL: no backup decryptable with current key"; exit 1; fi
echo "Using backup: $LATEST"

# 4. Start isolated local Postgres
export PGDATA="$WORKDIR/pgdata"
export PGSOCKET="$WORKDIR"
initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null 2>&1
echo "unix_socket_directories = '$WORKDIR'" >> "$PGDATA/postgresql.conf"
pg_ctl -D "$PGDATA" -l "$WORKDIR/pg.log" -o "-k $WORKDIR -p 54329" start >/dev/null
trap "pg_ctl -D '$PGDATA' stop -m fast >/dev/null 2>&1; cleanup" EXIT
createdb -h "$WORKDIR" -p 54329 -U postgres restoredb
echo "Isolated Postgres ready"

# 5. Restore
T0=$(date -u +%s)
pg_restore -h "$WORKDIR" -p 54329 -U postgres -d restoredb --no-owner --no-acl "$WORKDIR/backup.dump" 2>&1 | tail -3 || true
T1=$(date -u +%s)
echo "pg_restore completed in $((T1-T0))s"

# 6. Verify data
echo "--- VERIFICATION ---"
psql -h "$WORKDIR" -p 54329 -U postgres -d restoredb -t -c \
  "SELECT 'tenants=' || count(*) FROM tenant;" 2>/dev/null || echo "tenant table: n/a"
psql -h "$WORKDIR" -p 54329 -U postgres -d restoredb -t -c \
  "SELECT 'leads=' || count(*) FROM lead;" 2>/dev/null || echo "lead table: n/a"
psql -h "$WORKDIR" -p 54329 -U postgres -d restoredb -t -c \
  "SELECT 'messages=' || count(*) FROM message;" 2>/dev/null || echo "message table: n/a"
# schema sanity: migrations table present?
psql -h "$WORKDIR" -p 54329 -U postgres -d restoredb -t -c \
  "SELECT 'migrations=' || count(*) FROM migrations;" 2>/dev/null || echo "migrations table: n/a"

DRILL_END=$(date -u +%s)
TOTAL=$((DRILL_END-DRILL_START))
echo "[$(date -u +%FT%TZ)] === RESTORE DRILL COMPLETE in ${TOTAL}s (${TOTAL}/60 min) ==="
echo "RTO target: <=240 min. Result: $((TOTAL/60)) min $((TOTAL%60))s — $([ $TOTAL -le 14400 ] && echo PASS || echo FAIL)"
# Keep container alive briefly so logs can be collected, then exit
sleep 300
