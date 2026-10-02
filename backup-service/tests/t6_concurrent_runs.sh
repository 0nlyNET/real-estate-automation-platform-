#!/bin/sh
# t6: two overlapping runs each drop only their own database.
set -eu
. "$(dirname -- "$0")/lib.sh"

dbname_of() {
  grep -o 'CREATE DATABASE "[^"]*"' "$1" | head -1 | cut -d'"' -f2
}
dropname_of() {
  grep -o 'PSQL SQL: DROP DATABASE "[^"]*"' "$1" | head -1 | cut -d'"' -f2
}

D1=$(setup_test_env t6a)
D2=$(setup_test_env t6b)

(
  drill_env "$D1"
  sh "$SCRIPT" > "$D1/out.log" 2>&1
  echo $? > "$D1/rc"
) &
P1=$!
(
  drill_env "$D2"
  sh "$SCRIPT" > "$D2/out.log" 2>&1
  echo $? > "$D2/rc"
) &
P2=$!
wait $P1 || true
wait $P2 || true

assert_eq "run 1 exit 0" "0" "$(cat "$D1/rc")"
assert_eq "run 2 exit 0" "0" "$(cat "$D2/rc")"
N1=$(dbname_of "$D1/stub.log")
N2=$(dbname_of "$D2/stub.log")
[ -n "$N1" ] && [ -n "$N2" ] || fail "missing CREATE names"
[ "$N1" != "$N2" ] || fail "concurrent runs collided on $N1"
assert_eq "run 1 dropped only its own db" "$N1" "$(dropname_of "$D1/stub.log")"
assert_eq "run 2 dropped only its own db" "$N2" "$(dropname_of "$D2/stub.log")"

teardown_test_env "$D1"
teardown_test_env "$D2"
exit $ok
