#!/bin/sh
# t5: RPO must be measured from the recovery reference point (drill start),
# not from restore completion. The stubbed clock returns T on the first
# `date +%s` (START_EPOCH) and T+600 on later calls (END_EPOCH), simulating
# a 10-minute restore. With a backup snapshot 100s before T, RPO must be
# exactly 100s (old code would report 700s) and RTO 600s.
set -eu
. "$(dirname -- "$0")/lib.sh"

D=$(setup_test_env t5)
cp "$STUB_SRC/date" "$D/bin/date"
chmod +x "$D/bin/date"
export FAKE_START_EPOCH=1785715200
export FAKE_DATE_STATE="$D/datecount"
echo 0 > "$FAKE_DATE_STATE"
drill_env "$D"
# Backup snapshot = 100s before the recovery reference point.
export BACKUP_KEY="rta-prod-$(/bin/date -u -d "@$((FAKE_START_EPOCH - 100))" +%Y%m%dT%H%M%SZ).dump.gpg"

set +e
sh "$SCRIPT" > "$D/out.log" 2> "$D/err.log"
rc=$?
set -e

assert_eq "exit 0" "0" "$rc"
assert_contains "RPO measured from drill start (100s)" "$D/out.log" "RPO: backup age at recovery start 100s"
assert_not_contains "RPO is not completion-based (700s)" "$D/out.log" "backup age at recovery start 700s"
assert_contains "RTO is 600s" "$D/out.log" "RTO: restore+verify 600s"
assert_contains "recovery reference printed" "$D/out.log" "Recovery reference (drill start)"
assert_contains "backup snapshot printed" "$D/out.log" "Backup snapshot time"

teardown_test_env "$D"
exit $ok
