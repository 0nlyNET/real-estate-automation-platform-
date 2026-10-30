#!/bin/sh
# Exercise the complete backup job with isolated provider/database stubs.
set -eu
TESTS_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SCRIPT="$TESTS_DIR/../backup.sh"
FIXTURE=$(mktemp -d "$TESTS_DIR/.tmp-backup-optional-XXXXXX")
trap 'rm -rf "$FIXTURE"' EXIT
mkdir -p "$FIXTURE/bin"

cat > "$FIXTURE/bin/pg_dump" <<'STUB'
#!/bin/sh
printf 'fixture database dump\n'
STUB
cat > "$FIXTURE/bin/gpg" <<'STUB'
#!/bin/sh
set -eu
output=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = '-o' ]; then shift; output="$1"; fi
  shift
done
cat > /dev/null
printf 'fixture encrypted backup\n' > "$output"
STUB
cat > "$FIXTURE/bin/aws" <<'STUB'
#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$STUB_LOG"
case "$*" in
  *' s3 ls '*)
    printf '%s\n' \
      '2000-01-01 00:00:00 5 rta-prod-20000101T000000Z.dump.gpg' \
      '2999-01-01 00:00:00 5 rta-prod-29990101T000000Z.dump.gpg' \
      '2000-01-01 00:00:00 5 unrelated.txt'
    ;;
esac
STUB
cat > "$FIXTURE/bin/curl" <<'STUB'
#!/bin/sh
printf 'heartbeat\n' >> "$STUB_LOG"
STUB
chmod +x "$FIXTURE/bin/"*

run_case() (
  name="$1"; prune="$2"; heartbeat="$3"
  export PATH="$FIXTURE/bin:/usr/bin:/bin"
  export STUB_LOG="$FIXTURE/$name.commands"
  export DATABASE_URL='postgres://localhost:5432/postgres'
  export BACKUP_ENCRYPTION_KEY='Zml4dHVyZS1vbmx5'
  export R2_ACCOUNT_ID='fixture-account'
  export R2_ACCESS_KEY_ID='fixture-key'
  export R2_SECRET_ACCESS_KEY='fixture-secret'
  export R2_BUCKET='fixture-bucket'
  unset BACKUP_PRUNE_DISABLED HEARTBEAT_URL
  [ "$prune" != 'disabled' ] || export BACKUP_PRUNE_DISABLED=true
  [ "$heartbeat" != 'enabled' ] || export HEARTBEAT_URL='https://monitor.invalid/fixture'
  : > "$STUB_LOG"
  if ! sh "$SCRIPT" > "$FIXTURE/$name.output" 2>&1; then
    cat "$FIXTURE/$name.output" >&2
    exit 1
  fi
  grep -Fq ' s3 cp ' "$STUB_LOG"
  grep -Fq ' s3api head-object ' "$STUB_LOG"
  grep -Fq 'Backup succeeded:' "$FIXTURE/$name.output"
  if [ "$prune" = 'disabled' ]; then
    grep -Fq 'Prune skipped (BACKUP_PRUNE_DISABLED=true)' "$FIXTURE/$name.output"
    ! grep -Fq ' s3 ls ' "$STUB_LOG"
    ! grep -Fq ' s3 rm ' "$STUB_LOG"
  else
    grep -Fq ' s3 rm s3://fixture-bucket/rta-prod-20000101T000000Z.dump.gpg' "$STUB_LOG"
    ! grep -Fq ' s3 rm s3://fixture-bucket/rta-prod-29990101T000000Z.dump.gpg' "$STUB_LOG"
    ! grep -Fq ' s3 rm s3://fixture-bucket/unrelated.txt' "$STUB_LOG"
  fi
  if [ "$heartbeat" = 'enabled' ]; then
    grep -Fxq 'heartbeat' "$STUB_LOG"
    grep -Fq 'Heartbeat sent' "$FIXTURE/$name.output"
  else
    ! grep -Fxq 'heartbeat' "$STUB_LOG"
  fi
)

run_case default omitted enabled
run_case disabled disabled enabled
run_case no-heartbeat omitted omitted
