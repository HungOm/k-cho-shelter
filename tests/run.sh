#!/usr/bin/env bash
# Every test. Needs node; nothing to install.
set -e
cd "$(dirname "$0")"
fail=0
for t in numbering.test.cjs settlement.test.cjs superadmin.test.cjs permissions.test.cjs approvals.test.cjs sellbook.test.cjs cache.test.cjs search.test.mjs emits.test.mjs bookrange.test.mjs loadorder.test.cjs numberinglock.test.cjs i18n.test.mjs whereis.test.mjs; do
  [ -f "$t" ] || continue
  echo "── ${t%%.*}"
  node "$t" | tail -1
  node "$t" > /dev/null || fail=1
done
exit $fail
