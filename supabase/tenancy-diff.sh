#!/usr/bin/env bash
#
# The five reports, dumped as JSON, so a migration can be proved to change nothing.
#
# WHY THIS EXISTS. Stage 1 of the multi-tenancy plan adds a column to twenty-three
# tables and recreates every index with it leading. Nothing about that is supposed
# to change a single answer the raffle gives — and "supposed to" is not a proof.
# T9 is the proof: dump before, apply, dump after, diff. An empty diff is the only
# evidence that a schema change was invisible.
#
# WHAT IT DUMPS, AND WHY IT IS NOT WHAT THE CARD SAYS. The card names five
# reports. Only one of them, `agent_money`, is a database object. The other four
# are Edge Function handlers:
#
#     read_snapshot      → tickets
#     list_books         → book_ledger_all
#     agent_money        → agent_money            (a view, rls.sql)
#     report_draw_ready  → book_ledger_all, tickets, active_tickets()
#     list_payments      → agent_money, payments
#
# A script handed a database URL cannot call a handler, so this dumps the SQL each
# report is built FROM, each object once, with the mapping above recorded in the
# output. That is a stronger claim than calling the handlers would be: Stage 1
# cannot touch handler code, so if no underlying row moved, no answer can have.
# It also keeps no second copy of any handler's query, which would drift the first
# time a handler changed. Recorded as D-011 in MULTI-TENANCY-DECISIONS.md.
#
# `project_id` IS EXCLUDED FROM EVERY ROW, and that is the point rather than an
# oversight. Stage 1's whole purpose is to add it; leaving it in would make every
# row differ after the migration and the diff would be noise by construction.
# `to_jsonb(t) - 'project_id'` removes it when it is there and does nothing when
# it is not, so one script works on both sides of the migration. Nothing else is
# excluded — these are stored rows, so there is no serverTime or requestId to
# strip; every value here is the same on the second read as the first.
#
# STABLE BY CONSTRUCTION, because a diff is worthless otherwise. Keys are sorted
# because jsonb stores them sorted. Rows are sorted by their own JSON text, which
# needs no per-table knowledge of what a sensible sort key would be and cannot be
# defeated by a table whose natural key the plan later changes.
#
# READ-ONLY, IN A WAY THE DATABASE ENFORCES. Rule 3 of the task board says nothing
# touches production; this runs inside `begin transaction read only`, so it is not
# a promise in a comment — the server refuses a write. Pass a production URL to it
# if you want a baseline; it cannot do anything to it.
#
# Usage:
#   bash supabase/tenancy-diff.sh <db-url> [out.json]
#   bash supabase/tenancy-diff.sh <db-url> --selftest
#
# --selftest dumps the same database twice and diffs the two, which is the card's
# own "done when" condition. It is here rather than in a test file because the
# thing it proves is a property of a live database, not of this repository.

set -euo pipefail

URL="${1:-}"
OUT="${2:-}"

if [ -z "$URL" ]; then
  cat >&2 <<USAGE
Usage: bash supabase/tenancy-diff.sh <db-url> [out.json|--selftest]

  <db-url>   a postgres:// URL. Read-only; a production URL is safe.
  out.json   where to write. Standard output if left off.
  --selftest dump twice and diff, proving the dump is stable.
USAGE
  exit 2
fi

command -v psql >/dev/null 2>&1 || { echo "psql is not on PATH." >&2; exit 1; }

# ONE STATEMENT, so it is one snapshot. Five separate queries would each see a
# different moment, and on a live raffle that is a diff which reports a sale
# rather than a schema change.
read -r -d '' SQL <<'EOSQL' || true
begin transaction read only;
select jsonb_pretty(jsonb_build_object(
  'excluded', jsonb_build_array('project_id'),
  'reports', jsonb_build_object(
    'read_snapshot',     jsonb_build_array('tickets'),
    'list_books',        jsonb_build_array('book_ledger_all'),
    'agent_money',       jsonb_build_array('agent_money'),
    'report_draw_ready', jsonb_build_array('book_ledger_all', 'tickets', 'active_tickets'),
    'list_payments',     jsonb_build_array('agent_money', 'payments')
  ),
  'counts', jsonb_build_object(
    'tickets',         (select count(*) from tickets),
    'book_ledger_all', (select count(*) from book_ledger_all),
    'agent_money',     (select count(*) from agent_money),
    'payments',        (select count(*) from payments)
  ),
  'scalars', jsonb_build_object('active_tickets', active_tickets()),
  'objects', jsonb_build_object(
    'tickets',         (select coalesce(jsonb_agg(j order by j::text), '[]'::jsonb)
                          from (select to_jsonb(t) - 'project_id' as j from tickets t) s),
    'book_ledger_all', (select coalesce(jsonb_agg(j order by j::text), '[]'::jsonb)
                          from (select to_jsonb(t) - 'project_id' as j from book_ledger_all t) s),
    'agent_money',     (select coalesce(jsonb_agg(j order by j::text), '[]'::jsonb)
                          from (select to_jsonb(t) - 'project_id' as j from agent_money t) s),
    'payments',        (select coalesce(jsonb_agg(j order by j::text), '[]'::jsonb)
                          from (select to_jsonb(t) - 'project_id' as j from payments t) s)
  )
));
commit;
EOSQL

# -X ignores ~/.psqlrc, which can otherwise print a banner into the JSON. -q, -t
# and -A strip the noise, the header and the padding.
dump() { psql "$URL" -X -q -t -A -v ON_ERROR_STOP=1 -f - <<<"$SQL"; }

if [ "$OUT" = "--selftest" ]; then
  T=$(mktemp -d)
  trap 'rm -rf "$T"' EXIT
  dump > "$T/a.json"
  dump > "$T/b.json"
  if diff -u "$T/a.json" "$T/b.json" > "$T/d" 2>&1; then
    echo "stable: two dumps of this database are identical ($(wc -c < "$T/a.json" | tr -d ' ') bytes)"
    exit 0
  fi
  echo "UNSTABLE: two dumps of one database differ, so a diff across a migration would prove nothing." >&2
  head -40 "$T/d" >&2
  exit 1
fi

if [ -n "$OUT" ]; then
  dump > "$OUT"
  echo "wrote $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"
else
  dump
fi
