#!/usr/bin/env bash
#
# Deploy an Edge Function from a FROZEN ARCHIVE of a pushed commit.
#
# WHY THIS EXISTS. `supabase functions deploy` bundles the files ON DISK. It
# does not read git, and it does not care what is committed. Several Claude
# sessions share this worktree, so running it from the repo root ships whatever
# anybody happens to have open. On 2026-09-23 that put two modified files under
# supabase/functions/api and one untracked module under _shared into the live
# raffle; `./tests/run.sh` on exactly that code was EXIT 1, and the function
# read a config key no migration had created. Live impact was nil only because
# the deployed CLIENT predated the feature and so never sent the new key.
#
# A clean checkout prepared by hand does not prevent this, which is the part
# worth knowing: one was prepared that day, at a scratch path, and the bare
# command got typed from the repo root anyway. It is shorter, it is what every
# document says, and the shell was already sitting in the repo. So this script
# IS the short command, and it refuses instead of bundling the working tree.
#
# Usage:
#   scripts/deploy-function.sh [-f] [--at <commit>] [--no-deploy] [<function>...]
#
#   --at <commit>   what to deploy. Default origin/master. Must be ON origin:
#                   production ahead of the repository is a state nobody can
#                   reconstruct afterwards.
#   <function>      default `api`. THERE ARE TWO FUNCTIONS AND api IS NOT
#                   verify — deploying one has never deployed the other.
#   -f, --force     deploy although supabase/functions/ has uncommitted work.
#   --no-deploy     run every check and stop before the deploy.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

FORCE=0
NO_DEPLOY=0
AT=origin/master
FNS=()
while [ $# -gt 0 ]; do
  case "$1" in
    -f|--force)  FORCE=1; shift ;;
    --no-deploy) NO_DEPLOY=1; shift ;;
    --at)        AT=${2:?--at needs a commit}; shift 2 ;;
    -*)          echo "unknown option: $1" >&2; exit 2 ;;
    *)           FNS+=("$1"); shift ;;
  esac
done
[ ${#FNS[@]} -gt 0 ] || FNS=(api)

git fetch -q origin
SHA=$(git rev-parse --verify "$AT^{commit}")

# ON ORIGIN, NOT MERELY LOCAL. A commit that exists only on this machine can be
# rewritten or lost, and then the code running the raffle exists nowhere.
if ! git merge-base --is-ancestor "$SHA" origin/master; then
  echo "REFUSED: $AT ($SHA) is not on origin/master. Push it first." >&2
  exit 1
fi

# THE CHECK THAT WAS MISSING ON 2026-09-23. The pre-flight that day compared
# `git ls-tree` against `ls` for supabase/MIGRATIONS — the wrong directory
# entirely. `functions deploy` reads supabase/FUNCTIONS, and nobody looked
# there. `git status --porcelain` covers modified AND untracked, and it was the
# untracked _shared module that made the shipped bundle incoherent.
DIRTY=$(git status --porcelain -- supabase/functions/)
if [ -n "$DIRTY" ]; then
  echo "supabase/functions/ has uncommitted work:" >&2
  printf '%s\n' "$DIRTY" | sed 's/^/  /' >&2
  if [ "$FORCE" -eq 0 ]; then
    echo >&2
    echo "REFUSED. Not because it would be bundled — this deploys from a frozen" >&2
    echo "archive, so it would not be. The danger is the other direction: if any" >&2
    echo "of that work was already shipped from a dirty tree, this REPLACES it" >&2
    echo "with what is committed, silently and with nothing in the history to" >&2
    echo "show it was ever live. Land it, or pass --force having read this." >&2
    exit 1
  fi
  echo "--force given: continuing, and that work will not be deployed." >&2
fi

# NAMES CHECKED BEFORE THE GATE, not after it. A typo in a function name is
# the cheapest possible failure and there is no reason to spend a minute of
# test run discovering it. Asked of the COMMIT, so it is the archive's layout
# that is checked and not this tree's.
for fn in "${FNS[@]}"; do
  if ! git rev-parse -q --verify "$SHA:supabase/functions/$fn" >/dev/null; then
    echo "REFUSED: $SHA has no function named $fn." >&2
    echo "         it has: $(git ls-tree --name-only "$SHA:supabase/functions" | grep -v '^_' | tr '\n' ' ')" >&2
    exit 1
  fi
done

WORK=$(mktemp -d "${TMPDIR:-/tmp}/deployfn.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
git archive "$SHA" | tar -x -C "$WORK"
ln -s "$ROOT/node_modules" "$WORK/node_modules"

# GREEN IN THE WORKTREE IS NOT GREEN. The suite has to run against the bytes
# being deployed, which are the archive's, not this tree's.
echo "── gate at $SHA"
if ! (cd "$WORK" && ./tests/run.sh > "$WORK/gate.log" 2>&1); then
  echo "REFUSED: ./tests/run.sh fails at $SHA. Nothing deployed." >&2
  # BOTH SHAPES. run.sh prints `  FAIL` for a suite that ran and failed, and
  # `  CRASHED` for one that threw before printing anything — grepping only for
  # FAIL on a crash falls through to `tail`, which shows the suites that passed
  # AFTER it and reads like a green run with an error pasted on top.
  grep -E '^  (FAIL|CRASHED)' "$WORK/gate.log" >&2 \
    || { echo "  (no FAIL or CRASHED line; last 20 of the log)" >&2; tail -20 "$WORK/gate.log" >&2; }
  exit 1
fi
echo "   exit 0, $(grep -c '^── ' "$WORK/gate.log") suites"

if [ "$NO_DEPLOY" -eq 1 ]; then
  echo "── would deploy ${FNS[*]} at $SHA"
  echo "   --no-deploy: stopping here. Every check above passed."
  exit 0
fi

# RESOLVED LAST, ON PURPOSE. The ref is the only thing here that is needed at
# deploy time rather than at check time, and resolving it first made every
# other refusal unreachable on a machine without a linked project — including
# in the throwaway clone this script's own guards are tested in.
REF=${SUPABASE_PROJECT_REF:-}
if [ -z "$REF" ] && [ -f supabase/.temp/project-ref ]; then
  REF=$(cat supabase/.temp/project-ref)
fi
if [ -z "$REF" ]; then
  echo "REFUSED: no project ref. Set SUPABASE_PROJECT_REF or link the project." >&2
  exit 1
fi

echo "── deploying ${FNS[*]} at $SHA to $REF"
for fn in "${FNS[@]}"; do
  (cd "$WORK" && supabase functions deploy "$fn" --project-ref "$REF")
done

cat <<NOTE

Deployed from a frozen archive of $SHA, so the bundle matches that commit.

A success message is not evidence. To check what is actually being served,
download the function to a SCRATCH directory — `download` writes into
supabase/functions/ of wherever it runs and will overwrite this worktree —
and grep it for a string literal the change adds or removes:

  mkdir -p /tmp/fncheck && cd /tmp/fncheck \\
    && supabase functions download ${FNS[0]} --project-ref $REF \\
    && grep -rn '<a literal new to this change>' supabase/functions/

Migrations are separate and go FIRST. So does `verify`, if it changed:
deploying api has never deployed verify.
NOTE
