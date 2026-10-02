#!/bin/sh
# t3: happy path — the run drops exactly the database it created, registers
# and unregisters ownership, and reports success.
set -eu
. "$(dirname -- "$0")/lib.sh"

D=$(setup_test_env t3)
drill_env "$D"

set +e
sh "$SCRIPT" > "$D/out.log" 2> "$D/err.log"
rc=$?
set -e

assert_eq "exit code 0" "0" "$rc"
N=$(grep -o 'CREATE DATABASE "[^"]*"' "$D/stub.log" | head -1 | cut -d'"' -f2)
[ -n "$N" ] || fail "no CREATE DATABASE name logged"
DROP_N=$(grep -o 'PSQL SQL: DROP DATABASE "[^"]*"' "$D/stub.log" | head -1 | cut -d'"' -f2)
assert_eq "dropped database equals created database" "$N" "$DROP_N"
DROPS=$(grep -c 'PSQL SQL: DROP DATABASE' "$D/stub.log" || true)
assert_eq "exactly one DROP DATABASE" "1" "$DROPS"
assert_contains "registry INSERT" "$D/stub.log" "INSERT INTO rta_restore_runs"
assert_contains "registry DELETE" "$D/stub.log" "DELETE FROM rta_restore_runs"
assert_contains "success message" "$D/out.log" "Restore test SUCCEEDED"
assert_contains "RPO line" "$D/out.log" "RPO: backup age at recovery start"
assert_contains "RTO line" "$D/out.log" "RTO: restore+verify"

teardown_test_env "$D"
exit $ok
