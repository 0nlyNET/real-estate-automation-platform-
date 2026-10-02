#!/bin/sh
# t4: reclaim scoping. Only abandoned, strictly-named, old databases are
# dropped, under an advisory lock. Active/registry-owned, young, and
# non-matching databases (incl. injection attempts) are never dropped.
set -eu
. "$(dirname -- "$0")/lib.sh"

D=$(setup_test_env t4)
drill_env "$D" ENABLE_STALE_RECLAMATION=1 STALE_AFTER_SECONDS=21600

NOW=$(date -u +%Y%m%dT%H%M%S)
STALE_OK="restore_test_20200101T000000_ab12cd34_99999"     # old, no registry -> DROP
STALE_ACTIVE="restore_test_20200101T000000_deadbeef_88888" # old, active registry -> KEEP
YOUNG="restore_test_${NOW}_cafef00d_77771"                # young -> KEEP
export STUB_PSQL_CANDIDATES="${STALE_OK};${STALE_ACTIVE};${YOUNG};production;staging;restore_test_bogus;restore_test_20200101T000000_ab12cd34_1;restore_test_20200101T000000_ab12cd34_77772\"; DROP TABLE tenants; --"
export STUB_REGISTRY_ACTIVE_DBS="${STALE_ACTIVE}"

set +e
sh "$SCRIPT" --reclaim > "$D/out.log" 2> "$D/err.log"
rc=$?
set -e

assert_eq "reclaim exit 0" "0" "$rc"
assert_contains "advisory lock taken" "$D/stub.log" "pg_advisory_lock"
assert_contains "stale db dropped" "$D/stub.log" "DROP DATABASE \"$STALE_OK\""
assert_not_contains "active db kept" "$D/stub.log" "DROP DATABASE \"$STALE_ACTIVE\""
assert_not_contains "young db kept" "$D/stub.log" "DROP DATABASE \"$YOUNG\""
assert_not_contains "production never dropped" "$D/stub.log" 'DROP DATABASE "production"'
assert_not_contains "staging never dropped" "$D/stub.log" 'DROP DATABASE "staging"'
assert_not_contains "no DROP TABLE smuggled" "$D/stub.log" "DROP TABLE"
assert_not_contains "bogus name not dropped" "$D/stub.log" 'DROP DATABASE "restore_test_bogus"'
assert_contains "registry row cleaned for dropped db" "$D/stub.log" "DELETE FROM rta_restore_runs WHERE dbname = '$STALE_OK'"

# Opt-in gate: without ENABLE_STALE_RECLAMATION=1 the reclaim must refuse.
D2=$(setup_test_env t4b)
drill_env "$D2"
unset ENABLE_STALE_RECLAMATION
set +e
sh "$SCRIPT" --reclaim > "$D2/out.log" 2> "$D2/err.log"
rc2=$?
set -e
[ "$rc2" -ne 0 ] || fail "reclaim without opt-in must fail"
assert_not_contains "no drops without opt-in" "$D2/stub.log" "DROP DATABASE"

# Fail-closed: registry lookup failure must not drop anything.
D3=$(setup_test_env t4c)
drill_env "$D3" ENABLE_STALE_RECLAMATION=1
export STUB_PSQL_CANDIDATES="$STALE_OK"
export STUB_REGISTRY_QUERY_FAIL=1
set +e
sh "$SCRIPT" --reclaim > "$D3/out.log" 2> "$D3/err.log"
rc3=$?
set -e
assert_eq "reclaim exit 0 even when refusing" "0" "$rc3"
assert_not_contains "no drop when registry lookup fails" "$D3/stub.log" "DROP DATABASE"

teardown_test_env "$D"
teardown_test_env "$D2"
teardown_test_env "$D3"
exit $ok
