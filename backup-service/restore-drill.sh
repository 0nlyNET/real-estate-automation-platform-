#!/bin/bash
# RealtyTechAI Restore Drill v2 — uses base64 string directly as GPG passphrase,
# matching the hardened backup.sh (PR #156). Restores into isolated local Postgres.
# NEVER log secrets. Run once in ephemeral Railway service, then delete.
set -e

DRILL_START=$(date -u +%s)
echo "[$(date -u +%FT%TZ)] === RESTORE DRILL v2 START ==="

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_EC2_METADATA_DISABLED=true
R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
WORKDIR="/tmp/restore-drill-$$"
mkdir -p "$WORKDIR"

# GPG passphrase: base64 STRING directly (matches backup.sh PR #156)
# printf '%s' avoids trailing newline; no base64 -d.
gpg_decrypt() {
  printf '%s' "$BACKUP_ENCRYPTION_KEY" | \
    gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 \
        -o "$2" -d "$1"
}

# 1. List backups (newest first)
echo "Listing backups..."
aws --endpoint-url "$R2_ENDPOINT" s3 ls "s3://${R2_BUCKET}/" > "$WORKDIR/listing.txt"
MAP=$(awk '{print $4}' "$WORKDIR/listing.txt" | grep '^rta-prod-.*\.dump\.gpg$' | sort -r | head -3)
echo "Candidates:"; echo "$MAP"
echo "Key length: ${#BACKUP_ENCRYPTION_KEY}"

# 2. Download newest + verify size, then decrypt
for CAND in $MAP; do
  echo "Trying $CAND ..."
  aws --endpoint-url "$R2_ENDPOINT" s3 cp "s3://${R2_BUCKET}/$CAND" "$WORKDIR/backup.dump.gpg"
  SZ=$(stat -c%s "$WORKDIR/backup.dump.gpg")
  echo "Downloaded ${SZ} bytes"
  # Verify download completeness: size > 100MB sanity
  if [ "$SZ" -lt 100000000 ]; then echo "WARN: suspiciously small, skipping"; continue; fi
  if gpg_decrypt "$WORKDIR/backup.dump.gpg" "$WORKDIR/backup.dump" 2>"$WORKDIR/gpg.log"; then
    echo "DECRYPT OK: $CAND"
    LATEST="$CAND"; break
  else
    echo "Decrypt failed: $(head -c 200 "$WORKDIR/gpg.log")"
  fi
done
if [ -z "$LATEST" ]; then echo "DRILL FAIL: no decryptable backup"; exit 1; fi
rm -f "$WORKDIR/backup.dump.gpg"

# 3. Isolated Postgres (run as postgres user; initdb refuses root)
export PGDATA="$WORKDIR/pgdata"
mkdir -p "$PGDATA" "$WORKDIR"
chown -R postgres:postgres "$WORKDIR"
su postgres -c "initdb -D '$PGDATA' -U postgres --auth=trust" >/dev/null 2>&1
echo "unix_socket_directories = '$WORKDIR'" >> "$PGDATA/postgresql.conf"
chown postgres:postgres "$PGDATA/postgresql.conf"
su postgres -c "pg_ctl -D '$PGDATA' -l '$WORKDIR/pg.log' -o '-k $WORKDIR -p 54329' start" >/dev/null
trap "su postgres -c \"pg_ctl -D '$PGDATA' stop -m fast\" >/dev/null 2>&1; rm -rf '$WORKDIR'" EXIT
su postgres -c "createdb -h '$WORKDIR' -p 54329 -U postgres restoredb"
echo "Isolated Postgres ready (no provider creds, no outbound automation)"
PSQL_AS="su postgres -c"

# 4. Restore
T0=$(date -u +%s)
su postgres -c "pg_restore -h '$WORKDIR' -p 54329 -U postgres -d restoredb --no-owner --no-acl '$WORKDIR/backup.dump'" 2>&1 | grep -v "^$" | tail -5 || true
T1=$(date -u +%s)
echo "pg_restore completed in $((T1-T0))s"

# 5. Verify: schema + representative records
echo "--- VERIFICATION ---"
dbq() { su postgres -c "psql -h '$WORKDIR' -p 54329 -U postgres -d restoredb -t -A -c \"$1\""; }
echo "tables: $(dbq "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null || echo '?')"
for tbl in tenants leads messages lead_consent_records compliance_optouts audit_logs communication_suppressions; do
  c=$(dbq "SELECT count(*) FROM $tbl;" 2>/dev/null || echo "missing")
  echo "$tbl: $c"
done
echo "sample tenant ids:"
dbq "SELECT id FROM tenants LIMIT 3;" 2>/dev/null || echo "n/a"
echo "sample lead ids:"
dbq "SELECT id FROM leads LIMIT 3;" 2>/dev/null || echo "n/a"

DRILL_END=$(date -u +%s)
TOTAL=$((DRILL_END-DRILL_START))
echo "[$(date -u +%FT%TZ)] === DRILL COMPLETE in ${TOTAL}s ==="
echo "RTO target <=240min: $((TOTAL/60))m $((TOTAL%60))s — $([ $TOTAL -le 14400 ] && echo PASS || echo FAIL)"
echo "Backup used: $LATEST"
sleep 240
