#!/bin/sh
# t7: restore/table/tenant failures are explicit and loud (non-zero exit,
# clear ERROR), never silently continued.
set -eu
. "$(dirname -- "$0")/lib.sh"

# Case A: a required table is missing after restore.
DA=$(setup_test_env t7a)
drill_env "$DA" STUB_MISSING_TABLES="messages"
set +e
sh "$SCRIPT" > "$DA/out.log" 2> "$DA/err.log"
rca=$?
set -e
[ "$rca" -ne 0 ] || fail "missing table must fail the drill"
assert_contains "missing table error" "$DA/err.log" "table messages is missing after restore"

# Case B: TEST tenant absent.
DB=$(setup_test_env t7b)
drill_env "$DB" STUB_TENANT_MISSING=1
set +e
sh "$SCRIPT" > "$DB/out.log" 2> "$DB/err.log"
rcb=$?
set -e
[ "$rcb" -ne 0 ] || fail "missing tenant must fail the drill"
assert_contains "missing tenant error" "$DB/err.log" "TEST tenant missing after restore"

# Case C: pg_restore fails.
DC=$(setup_test_env t7c)
drill_env "$DC" STUB_PGRESTORE_FAIL=1
set +e
sh "$SCRIPT" > "$DC/out.log" 2> "$DC/err.log"
rcc=$?
set -e
[ "$rcc" -ne 0 ] || fail "pg_restore failure must fail the drill"
assert_contains "pg_restore error" "$DC/err.log" "pg_restore failed"

# Case D: even on verification failure, the owned database is still cleaned up.
assert_contains "owned db dropped after failed verify" "$DA/stub.log" "DROP DATABASE"

# Case E: application migration history is app_migrations, not TypeORM's default.
unset STUB_MISSING_TABLES STUB_TENANT_MISSING STUB_PGRESTORE_FAIL
DE=$(setup_test_env t7e)
drill_env "$DE" STUB_MISSING_TABLES="migrations"
sh "$SCRIPT" > "$DE/out.log" 2> "$DE/err.log" || fail "valid app_migrations must not require legacy migrations"
assert_contains "application migration history checked" "$DE/stub.log" "SELECT count(*) FROM app_migrations"

# Case F: missing application migration history must still fail closed.
DF=$(setup_test_env t7f)
drill_env "$DF" STUB_MISSING_TABLES="app_migrations"
set +e
sh "$SCRIPT" > "$DF/out.log" 2> "$DF/err.log"
rcf=$?
set -e
[ "$rcf" -ne 0 ] || fail "missing app_migrations must fail the drill"
assert_contains "migration history error" "$DF/err.log" "table app_migrations is missing after restore"
assert_contains "owned db dropped after migration failure" "$DF/stub.log" "DROP DATABASE"
teardown_test_env "$DE"
teardown_test_env "$DF"

teardown_test_env "$DA"
teardown_test_env "$DB"
teardown_test_env "$DC"
exit $ok
