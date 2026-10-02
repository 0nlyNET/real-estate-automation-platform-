#!/bin/sh
# Shared helpers for restore.sh regression tests. Source from each t*.sh.
# All external commands are stubbed; nothing touches real infrastructure.

TESTS_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$TESTS_DIR/../.." && pwd)
SCRIPT="$REPO_ROOT/backup-service/restore.sh"
STUB_SRC="$TESTS_DIR/stubs"

# setup_test_env <name> : isolated stub bin + log dir; echoes dir path.
setup_test_env() {
  _d="$TESTS_DIR/.tmp-$1-$$"
  rm -rf "$_d"
  mkdir -p "$_d/bin" "$_d/work"
  cp "$STUB_SRC/psql" "$STUB_SRC/pg_restore" "$STUB_SRC/aws" "$STUB_SRC/gpg" "$_d/bin/"
  chmod +x "$_d/bin/"*
  : > "$_d/stub.log"
  echo "$_d"
}

# drill_env <dir> [extra VAR=val ...] : export stub PATH + required drill env.
drill_env() {
  _d="$1"; shift
  export PATH="$_d/bin:/usr/bin:/bin"
  export STUB_LOG="$_d/stub.log"
  export R2_ACCOUNT_ID=fake-acct
  export R2_ACCESS_KEY_ID=fake-key
  export R2_SECRET_ACCESS_KEY=fake-secret
  export R2_BUCKET=fake-bucket
  export BACKUP_ENCRYPTION_KEY=ZmFrZS1lbmNyeXB0aW9uLWtleQ==
  # Test-only database URL. This value is never used to open a real connection:
  # every test stubs `psql`, so it only flows into stub logs. It must never
  # contain a real credential — override via the environment only for local
  # runs that need a live database.
  export RESTORE_DATABASE_URL="${RESTORE_DATABASE_URL:-postgres://localhost:5432/postgres}"
  # Recent snapshot so the RPO (<=3600s) gate passes; t5 overrides this.
  export BACKUP_KEY="rta-prod-$(date -u -d '5 minutes ago' +%Y%m%dT%H%M%SZ).dump.gpg"
  export TEST_TENANT_ID="11111111-1111-1111-1111-111111111111"
  for _kv in "$@"; do export "$_kv"; done
}

teardown_test_env() {
  rm -rf "$1"
}

ok=0
fail() { echo "  FAIL: $1" >&2; ok=1; }

assert_eq() { # <label> <expected> <actual>
  if [ "$2" = "$3" ]; then return 0; fi
  fail "$1: expected [$2] got [$3]"
}

assert_contains() { # <label> <file> <fixed-string>
  if grep -Fq "$3" "$2"; then return 0; fi
  fail "$1: <$3> not found in $2"
}

assert_not_contains() { # <label> <file> <fixed-string>
  if grep -Fq "$3" "$2"; then fail "$1: <$3> unexpectedly found in $2"; return 1; fi
  return 0
}
