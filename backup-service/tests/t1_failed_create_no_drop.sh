#!/bin/sh
# t1: CREATE DATABASE failure must exit non-zero and must NOT drop anything.
# The run never successfully created a database, so cleanup has no ownership
# to act on.
set -eu
. "$(dirname -- "$0")/lib.sh"

D=$(setup_test_env t1)
drill_env "$D" STUB_CREATE_FAIL=1

set +e
sh "$SCRIPT" > "$D/out.log" 2> "$D/err.log"
rc=$?
set -e

assert_eq "exit code non-zero on CREATE failure" "1" "$([ "$rc" -ne 0 ] && echo 1 || echo 0)"
assert_contains "CREATE attempted" "$D/stub.log" "CREATE DATABASE"
assert_not_contains "no DROP DATABASE issued" "$D/stub.log" "DROP DATABASE"
assert_contains "error explains no drop" "$D/err.log" "did not create"
assert_not_contains "no DROP in reclaim/file path either" "$D/stub.log" "PSQL FILE CONTENT"

teardown_test_env "$D"
exit $ok
