#!/bin/sh
# RealtyTechAI isolated restore test (one-shot).
# Downloads an encrypted backup from R2, decrypts, restores into a FRESH
# database on the target server, verifies data, measures RPO/RTO, cleans up.
# NEVER log: DATABASE URLs, R2 secrets, encryption keys.
#
# Modes:
#   restore.sh            Full drill: restore BACKUP_KEY into a new isolated
#                         database, verify, measure RPO/RTO, drop the database.
#   restore.sh --reclaim  Stale-run reclamation ONLY. Drops abandoned
#                         restore-run databases. Requires ENABLE_STALE_RECLAMATION=1.
#                         Never drops: databases with an active registry row,
#                         databases younger than STALE_AFTER_SECONDS (default 6h),
#                         or any database whose name does not strictly match the
#                         restore-run naming pattern.
#
# Ownership model:
#   - Database names are unique per run: restore_test_<UTC ts>_<rand>_<pid>.
#   - A database is dropped by a run ONLY if that run successfully created it
#     (DB_CREATED=1) and the name passes strict validation.
#   - Each run registers itself in rta_restore_runs on the target server so
#     the reclaimer can distinguish active runs from abandoned ones.
#
# Required env vars (Railway variables, never in code):
#   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
#   BACKUP_ENCRYPTION_KEY (base64 32-byte, same as backup),
#   RESTORE_DATABASE_URL (target Postgres server URL; a NEW database is
#     created on this server and DROPPED afterwards - never the default db),
#   BACKUP_KEY (object name, e.g. rta-prod-20260925T150139Z.dump.gpg),
#   TEST_TENANT_ID (tenant ID to verify after restore; not hard-coded)

set -eu

MODE="drill"
if [ "${1:-}" = "--reclaim" ]; then
  MODE="reclaim"
elif [ -n "${1:-}" ]; then
  echo "ERROR: unknown argument '$1' (expected --reclaim or nothing)" >&2
  exit 1
fi

# ---------------------------------------------------------------- helpers ---
log() { echo "[$(date -u +%FT%TZ)] $*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

require_env() {
  for v in "$@"; do
    if [ -z "${v+set}" ] || [ -z "$(eval echo \"\$$v\")" ]; then
      die "required env var $v is not set"
    fi
  done
}

# Strict restore-run database name validation.
# Allowed shape only: restore_test_YYYYMMDDTHHMMSS_<8 lowercase hex>_<pid digits>
# Anything else (production, staging, template DBs, hand-typed names,
# injection attempts) is refused by every code path that could DROP.
is_restore_db_name() {
  printf '%s' "$1" | grep -Eq '^restore_test_[0-9]{8}T[0-9]{6}_[0-9a-f]{8}_[0-9]+$'
}

# Collision-resistant per-run database name: UTC timestamp + 32 bits of
# randomness from /dev/urandom + PID. Two concurrent runs can never collide.
gen_restore_db_name() {
  _ts=$(date -u +%Y%m%dT%H%M%S)
  _rnd=$(od -An -tx1 -N4 /dev/urandom 2>/dev/null | tr -d ' \n' || true)
  case "$_rnd" in
    ????????????????) ;; # 16 hex chars from 4 bytes
    *) _rnd=$(printf '%s%s' "$(date -u +%s)" "$$" | tail -c 8) ;; # digits are valid hex
  esac
  printf 'restore_test_%s_%s_%s' "$_ts" "$_rnd" "$$"
}

# Timestamp embedded in a validated restore-run name -> epoch (0 on failure).
restore_db_name_epoch() {
  _ts=$(printf '%s' "$1" | sed -n 's/^restore_test_\([0-9]\{8\}T[0-9]\{6\}\)_.*/\1/p')
  [ -n "$_ts" ] || { echo 0; return; }
  _fmt=$(printf '%s' "$_ts" | sed -E 's/^([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})$/\1-\2-\3 \4:\5:\6/')
  date -u -d "$_fmt" +%s 2>/dev/null || echo 0
}

require_env R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET \
  BACKUP_ENCRYPTION_KEY RESTORE_DATABASE_URL
# BACKUP_KEY / TEST_TENANT_ID are required for drill mode; validated below.

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_EC2_METADATA_DISABLED=true
export PGPASSWORD="$(echo "$RESTORE_DATABASE_URL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')"
R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

# Registry table: lets the reclaimer prove which restore-run databases are
# still owned by a live run. Created idempotently wherever it is needed.
ensure_registry() {
  psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
    "CREATE TABLE IF NOT EXISTS rta_restore_runs (
       dbname     text PRIMARY KEY,
       host       text NOT NULL,
       pid        integer NOT NULL,
       started_at timestamptz NOT NULL DEFAULT now(),
       status     text NOT NULL DEFAULT 'active'
     )" > /dev/null || die "could not ensure rta_restore_runs registry table"
}

# ============================================================ RECLAIM MODE ==
if [ "$MODE" = "reclaim" ]; then
  [ "${ENABLE_STALE_RECLAMATION:-0}" = "1" ] \
    || die "refusing to reclaim: set ENABLE_STALE_RECLAMATION=1 to opt in"
  STALE_AFTER_SECONDS="${STALE_AFTER_SECONDS:-21600}" # default: 6 hours
  case "$STALE_AFTER_SECONDS" in ''|*[!0-9]*) die "STALE_AFTER_SECONDS must be a positive integer" ;; esac

  log "Stale-run reclamation starting (older than ${STALE_AFTER_SECONDS}s)"
  ensure_registry
  NOW_EPOCH=$(date -u +%s)
  CUTOFF_EPOCH=$((NOW_EPOCH - STALE_AFTER_SECONDS))

  # Broad candidate query, then STRICT shell-side validation per name.
  CANDIDATES=$(psql "$RESTORE_DATABASE_URL" -t -A -v ON_ERROR_STOP=1 -c \
    "SELECT datname FROM pg_database WHERE datname LIKE 'restore_test\_%' ESCAPE '\' AND NOT datistemplate ORDER BY datname;")

  DROP_SQL="${WORKDIR_RECLAIM_SQL:-/tmp/rta-reclaim-$$.sql}"
  : > "$DROP_SQL"
  {
    echo "SELECT pg_advisory_lock(hashtext('rta_restore_reclaim'));"
    DROPPED=0
    SKIPPED=0
    for db in $CANDIDATES; do
      if ! is_restore_db_name "$db"; then
        log "reclaim: REFUSING '$db' (does not match restore-run name pattern)"
        SKIPPED=$((SKIPPED + 1))
        continue
      fi
      DB_EPOCH=$(restore_db_name_epoch "$db")
      if [ "$DB_EPOCH" -gt "$CUTOFF_EPOCH" ]; then
        log "reclaim: keeping '$db' (younger than stale threshold)"
        SKIPPED=$((SKIPPED + 1))
        continue
      fi
      ACTIVE=$(psql "$RESTORE_DATABASE_URL" -t -A -v ON_ERROR_STOP=1 -c \
        "SELECT count(*) FROM rta_restore_runs WHERE dbname = '$db' AND started_at > now() - make_interval(secs => $STALE_AFTER_SECONDS);" 2>/dev/null || echo "QUERYFAIL")
      if [ "$ACTIVE" = "QUERYFAIL" ]; then
        log "reclaim: REFUSING '$db' (registry lookup failed - fail closed)"
        SKIPPED=$((SKIPPED + 1))
        continue
      fi
      if [ "$ACTIVE" != "0" ]; then
        log "reclaim: keeping '$db' (active registry row)"
        SKIPPED=$((SKIPPED + 1))
        continue
      fi
      # Name is strictly valid, older than the threshold, and has no active
      # registry row: abandoned by a dead run. Safe to drop.
      # WITH (FORCE) terminates stray connections from the dead run.
      log "reclaim: dropping abandoned '$db'"
      echo "DROP DATABASE \"$db\" WITH (FORCE);"
      echo "DELETE FROM rta_restore_runs WHERE dbname = '$db';"
      DROPPED=$((DROPPED + 1))
    done
    echo "SELECT pg_advisory_unlock(hashtext('rta_restore_reclaim'));"
  } >> "$DROP_SQL"

  # One session holds the advisory lock across all drops: concurrency-safe
  # against overlapping reclaimers and against a racing new run (new runs
  # always insert a fresh registry row, which excludes them from the
  # abandoned set computed above; the 6h age floor covers the
  # create-then-register crash window).
  psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$DROP_SQL" > /dev/null \
    || die "reclaim: locked drop pass failed"
  rm -f "$DROP_SQL"
  log "Reclamation complete: dropped=$DROPPED skipped=$SKIPPED"
  exit 0
fi

# ================================================================= DRILL ====
require_env BACKUP_KEY TEST_TENANT_ID

# Recovery reference point: the moment this drill starts. RPO is the data-loss
# window = drill_start - backup_snapshot_time (NOT restore completion time).
START_EPOCH=$(date +%s)
RECOVERY_REF=$(date -u -d "@${START_EPOCH}" +%FT%TZ 2>/dev/null || date -u +%FT%TZ)
RUN_RAND=$(od -An -tx1 -N4 /dev/urandom 2>/dev/null | tr -d ' \n' || echo "rr$$")
WORKDIR="/tmp/rta-restore-$$-${RUN_RAND}"
RESTORE_DB=""
DB_CREATED=0
mkdir -p "$WORKDIR"

cleanup() {
  rm -rf "$WORKDIR"
  # Drop ONLY the database this run successfully created. Never drop on the
  # basis of a name alone: DB_CREATED is set to 1 immediately after CREATE
  # DATABASE returns success, and the name is strictly re-validated here.
  if [ "$DB_CREATED" = "1" ] && [ -n "$RESTORE_DB" ]; then
    if is_restore_db_name "$RESTORE_DB"; then
      psql "$RESTORE_DATABASE_URL" -c "DELETE FROM rta_restore_runs WHERE dbname = '$RESTORE_DB';" > /dev/null 2>&1 || true
      if psql "$RESTORE_DATABASE_URL" -c "DROP DATABASE \"$RESTORE_DB\"" > /dev/null 2>&1; then
        log "cleanup: dropped isolated database $RESTORE_DB"
      else
        echo "WARN: cleanup could not drop $RESTORE_DB (manual check required)" >&2
      fi
    else
      echo "WARN: cleanup refusing to drop unexpected database name '$RESTORE_DB'" >&2
    fi
    DB_CREATED=0
    RESTORE_DB=""
  fi
}
trap cleanup EXIT

log "Restore test starting: $BACKUP_KEY (recovery reference: $RECOVERY_REF)"

# 1. Download from R2
log "Downloading from R2..."
aws --only-show-errors --endpoint-url "$R2_ENDPOINT" \
  s3 cp "s3://${R2_BUCKET}/${BACKUP_KEY}" "$WORKDIR/backup.dump.gpg" \
  || die "R2 download failed for $BACKUP_KEY"
DL_SIZE=$(stat -c%s "$WORKDIR/backup.dump.gpg" 2>/dev/null || stat -f%z "$WORKDIR/backup.dump.gpg")
[ "$DL_SIZE" -gt 0 ] || die "downloaded backup is empty"
log "Downloaded: ${DL_SIZE} bytes"

# 2. Decrypt (base64 passphrase string used directly, see backup.sh)
log "Decrypting..."
printf '%s' "$BACKUP_ENCRYPTION_KEY" | \
  gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 \
      -d -o "$WORKDIR/backup.dump" "$WORKDIR/backup.dump.gpg" \
  || die "gpg decrypt failed"
rm -f "$WORKDIR/backup.dump.gpg"
DEC_SIZE=$(stat -c%s "$WORKDIR/backup.dump" 2>/dev/null || stat -f%z "$WORKDIR/backup.dump")
[ "$DEC_SIZE" -gt 0 ] || die "decrypted dump is empty"
log "Decrypted: ${DEC_SIZE} bytes"

# 3. Create isolated database on target server.
#    Unique per run (timestamp + randomness + PID): concurrent runs cannot
#    collide, and no two runs ever share a database.
RESTORE_DB=$(gen_restore_db_name)
is_restore_db_name "$RESTORE_DB" || die "generated invalid database name (refusing to proceed)"
log "Creating isolated database: $RESTORE_DB"
if ! psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$RESTORE_DB\"" > "$WORKDIR/create.log" 2>&1; then
  echo "ERROR: CREATE DATABASE failed for $RESTORE_DB" >&2
  tail -10 "$WORKDIR/create.log" >&2 || true
  # DB_CREATED stays 0: cleanup will NOT attempt to drop anything. We do not
  # know whether the failure left a half-created database, and we must not
  # drop a database this run did not successfully create.
  die "CREATE DATABASE failed (no database dropped: this run did not create one)"
fi
DB_CREATED=1
# Register ownership so the stale-run reclaimer treats this database as active.
ensure_registry
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
  "INSERT INTO rta_restore_runs (dbname, host, pid) VALUES ('$RESTORE_DB', '$(hostname 2>/dev/null || echo unknown)', $$)
   ON CONFLICT (dbname) DO UPDATE SET started_at = now(), status = 'active';" > /dev/null \
  || die "registry insert failed for $RESTORE_DB"
TARGET_URL="$(echo "$RESTORE_DATABASE_URL" | sed "s|/[^/?]*\(?.*\)\?$|/$RESTORE_DB\1|")"

# 4. Restore
# Do NOT pipe pg_restore to tail: under /bin/sh the pipeline's exit status is
# tail's, masking pg_restore failures. Capture output to a file instead.
log "Restoring (pg_restore)..."
if ! pg_restore --no-owner --no-privileges --dbname="$TARGET_URL" "$WORKDIR/backup.dump" > "$WORKDIR/restore.log" 2>&1; then
  echo "ERROR: pg_restore failed (see $WORKDIR/restore.log)" >&2
  tail -20 "$WORKDIR/restore.log" >&2 || true
  die "pg_restore failed"
fi
log "pg_restore finished"
tail -5 "$WORKDIR/restore.log" || true

# 5. Verify representative data
# Fail on any missing table or missing TEST tenant data — a restore that drops
# tables or loses data is not a successful restore.
log "Verifying..."
PSQL="psql $TARGET_URL -t -A -v ON_ERROR_STOP=1"
TABLES="migrations tenants leads lead_events messages sequences sequence_steps sequence_enrollments lead_consent_records compliance_optouts audit_logs credentials password_reset_tokens"
VERIFY_FAILED=0
for t in $TABLES; do
  n=$($PSQL -c "SELECT count(*) FROM $t" 2>/dev/null || echo "MISSING")
  log "  $t: $n rows"
  if [ "$n" = "MISSING" ]; then
    echo "ERROR: table $t is missing after restore" >&2
    VERIFY_FAILED=1
  fi
done
TEST_TENANT="$TEST_TENANT_ID"
TENANT_NAME=$($PSQL -c "SELECT name FROM tenants WHERE id='$TEST_TENANT'" 2>/dev/null || echo "")
log "  TEST tenant present: ${TENANT_NAME:-NO}"
TENANT_LEADS=$($PSQL -c "SELECT count(*) FROM leads WHERE tenant_id='$TEST_TENANT'" 2>/dev/null || echo "MISSING")
log "  TEST-tenant leads: $TENANT_LEADS"
LEAD_MSGS=$($PSQL -c "SELECT count(*) FROM messages WHERE \"leadId\" IN (SELECT id FROM leads WHERE tenant_id='$TEST_TENANT')" 2>/dev/null || echo "MISSING")
log "  messages on TEST-tenant leads: $LEAD_MSGS"
TENANT_CONSENT=$($PSQL -c "SELECT count(*) FROM lead_consent_records WHERE lead_id IN (SELECT id FROM leads WHERE tenant_id='$TEST_TENANT')" 2>/dev/null || echo "MISSING")
log "  consent records on TEST-tenant leads: $TENANT_CONSENT"
AUDIT_N=$($PSQL -c "SELECT count(*) FROM audit_logs" 2>/dev/null || echo "MISSING")
log "  audit_logs (all tenants): $AUDIT_N"
if [ -z "$TENANT_NAME" ]; then
  echo "ERROR: TEST tenant missing after restore" >&2
  VERIFY_FAILED=1
fi
if [ "$TENANT_LEADS" = "MISSING" ] || [ "$TENANT_LEADS" = "0" ]; then
  echo "ERROR: no leads for TEST tenant after restore (expected representative data)" >&2
  VERIFY_FAILED=1
fi
if [ "$VERIFY_FAILED" = "1" ]; then
  die "restore verification failed"
fi

# 6. RPO / RTO
# RPO is measured from the RECOVERY REFERENCE POINT (drill start), not from
# restore completion: it is the data-loss window a real incident would face.
END_EPOCH=$(date +%s)
RTO=$((END_EPOCH - START_EPOCH))
BACKUP_TS=$(echo "$BACKUP_KEY" | sed -n 's/rta-prod-\(.*\)\.dump\.gpg/\1/p')
# BACKUP_TS looks like 20260925T150139Z -> reformat for GNU date
BTS=$(echo "$BACKUP_TS" | sed -E 's/^([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})Z$/\1-\2-\3 \4:\5:\6/')
BACKUP_EPOCH=$(date -u -d "$BTS" +%s 2>/dev/null || echo 0)
[ "$BACKUP_EPOCH" != "0" ] || die "could not parse backup timestamp '$BACKUP_TS' from BACKUP_KEY"
RPO_AGE=$((START_EPOCH - BACKUP_EPOCH))
BACKUP_UTC=$(date -u -d "@${BACKUP_EPOCH}" +%FT%TZ 2>/dev/null || echo "$BACKUP_TS")
log "Backup snapshot time: $BACKUP_UTC"
log "Recovery reference (drill start): $RECOVERY_REF"
log "RPO: backup age at recovery start ${RPO_AGE}s (target <=3600s)"
log "RTO: restore+verify ${RTO}s (target <=14400s)"
# Enforce RPO/RTO targets: fail the drill if either is exceeded.
[ "$RPO_AGE" -le 3600 ] || die "RPO violated: backup age ${RPO_AGE}s exceeds 3600s (60 minutes)"
[ "$RTO" -le 14400 ] || die "RTO violated: restore+verify ${RTO}s exceeds 14400s (240 minutes)"
log "RPO/RTO targets met."

# 7. Cleanup: drop the isolated database (owned by this run; validated name).
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -c "DELETE FROM rta_restore_runs WHERE dbname = '$RESTORE_DB';" > /dev/null
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE \"$RESTORE_DB\"" > /dev/null \
  || die "cleanup DROP DATABASE failed for $RESTORE_DB"
DB_CREATED=0
RESTORE_DB=""
log "Isolated database dropped"

log "Restore test SUCCEEDED: $BACKUP_KEY"
