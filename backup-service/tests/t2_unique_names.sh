#!/bin/sh
# t2: two runs must generate different, strictly-valid database names.
set -eu
. "$(dirname -- "$0")/lib.sh"

dbname_of() { # <stub.log> : extract first CREATE DATABASE name
  grep -o 'CREATE DATABASE "[^"]*"' "$1" | head -1 | cut -d'"' -f2
}

D1=$(setup_test_env t2a)
D2=$(setup_test_env t2b)
drill_env "$D1"
sh "$SCRIPT" > "$D1/out.log" 2>&1
N1=$(dbname_of "$D1/stub.log")

drill_env "$D2"
sh "$SCRIPT" > "$D2/out.log" 2>&1
N2=$(dbname_of "$D2/stub.log")

[ -n "$N1" ] || fail "run 1 produced no CREATE DATABASE name"
[ -n "$N2" ] || fail "run 2 produced no CREATE DATABASE name"
[ "$N1" != "$N2" ] || fail "database names collided: $N1"
echo "$N1" | grep -Eq '^restore_test_[0-9]{8}T[0-9]{6}_[0-9a-f]{8}_[0-9]+$' \
  || fail "run 1 name fails strict pattern: $N1"
echo "$N2" | grep -Eq '^restore_test_[0-9]{8}T[0-9]{6}_[0-9a-f]{8}_[0-9]+$' \
  || fail "run 2 name fails strict pattern: $N2"

teardown_test_env "$D1"
teardown_test_env "$D2"
exit $ok
