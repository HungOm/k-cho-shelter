#!/usr/bin/env bash
# Run every test. Needs node; no packages to install.
set -e
cd "$(dirname "$0")"
fail=0
for t in numbering search settlement ui; do
  echo "── $t"
  node "$t.test.js" | tail -1
  node "$t.test.js" > /dev/null || fail=1
done
exit $fail
