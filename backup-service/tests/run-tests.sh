#!/bin/sh
# Test harness for backup-service/restore.sh regression tests.
# Runs each t*.sh as its own process; all externals are stubbed.
set -eu
TESTS_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PASS=0
FAIL=0
FAILED=""
for t in t1_failed_create_no_drop \
         t2_unique_names \
         t3_cleanup_drops_own_db \
         t4_reclaim_scoping \
         t5_rpo_from_start \
         t6_concurrent_runs \
         t7_verification_fails_loudly; do
  echo "--- $t"
  if sh "$TESTS_DIR/$t.sh"; then
    echo "PASS $t"; PASS=$((PASS + 1))
  else
    echo "FAIL $t"; FAIL=$((FAIL + 1)); FAILED="$FAILED $t"
  fi
done
echo ""
echo "restore.sh regression tests: PASS=$PASS FAIL=$FAIL"
[ -z "$FAILED" ] || echo "failed:$FAILED"
[ "$FAIL" = "0" ]
