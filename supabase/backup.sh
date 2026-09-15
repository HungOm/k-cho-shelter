#!/usr/bin/env bash
#
# Take a copy of the raffle, onto this machine.
#
# WHY THIS EXISTS. The free plan takes no automatic backups. Everything about
# this raffle that cannot be reconstructed lives in one Postgres database: who
# bought which ticket, and how to telephone them. Lose it and the draw cannot be
# run — not "is inconvenient to run", cannot be run, because there is no way
# left to tell a winner they have won.
#
# WHAT COMES OUT IS PERSONAL DATA. Every buyer's name and phone number, most of
# them refugees. The file lands in backup/, which is in .gitignore, and it must
# stay out of the repository, out of email, and off any shared drive that is not
# meant to hold it. Treat it exactly like the paper ticket stubs.
#
# Usage:   bash supabase/backup.sh
# Restore: see the note printed at the end.

set -euo pipefail
cd "$(dirname "$0")/.."

# TWO WAYS IN, because this runs in two places now.
#
# On a laptop it is linked: the project ref sits in supabase/.temp and the keys
# in supabase/.env.local, and nothing about that changes. On a scheduled runner
# there is no link and no .env.local, so the database is named outright by
# SUPABASE_DB_URL and the REST credentials come from the environment. The
# difference is confined to these few lines; everything below is the same
# backup either way, including the refusal at the end.
DB_URL="${SUPABASE_DB_URL:-}"
REF="${SUPABASE_PROJECT_REF:-$(cat supabase/.temp/project-ref 2>/dev/null || true)}"
if [ -z "$DB_URL" ] && [ -z "$REF" ]; then
  echo "No database. Either run: supabase link --project-ref <ref>" >&2
  echo "or set SUPABASE_DB_URL to the connection string." >&2
  exit 1
fi

if [ -n "$DB_URL" ]; then
  DUMP=(supabase db dump --db-url "$DB_URL")
  WHERE="$REF${REF:+ }via SUPABASE_DB_URL"
else
  DUMP=(supabase db dump --linked)
  WHERE="$REF"
fi

STAMP="$(date +%Y-%m-%d-%H%M)"
OUT="backup/$STAMP"
mkdir -p "$OUT"

echo "Backing up ${WHERE:-the linked project}"
echo

# Schema and data separately. The schema is worth keeping beside the data
# because a restore into an empty project needs both, and a schema that has
# drifted from the dump is the thing that turns a restore into an afternoon.
echo "  schema..."
"${DUMP[@]}" -f "$OUT/schema.sql"

echo "  data..."
"${DUMP[@]}" --data-only -f "$OUT/data.sql"

# A plain CSV of the one thing that matters most, readable without Postgres.
# If everything else fails, this is the file that still lets somebody telephone
# the winner — openable in Excel on any machine, by anybody.
echo "  entries (csv)..."
# Local keys if they are there, otherwise whatever the runner was given. A
# missing .env.local is not an error here — on a runner it is the normal case.
if [ -f supabase/.env.local ]; then set -a; . supabase/.env.local; set +a; fi
if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SECRET_KEY:-}" ]; then
  echo "No SUPABASE_URL / SUPABASE_SECRET_KEY — cannot write the CSV." >&2
  exit 1
fi
curl -s "$SUPABASE_URL/rest/v1/tickets?select=number,status,buyer_name,buyer_phone,buyer_zone,sold_by_agent,amount,sold_at&status=in.(Sold,Donated)&order=idx" \
  -H "apikey: $SUPABASE_SECRET_KEY" -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
  -H "Accept: text/csv" -o "$OUT/sold-tickets.csv"

# Prove it is not an empty file dressed up as a backup. A backup nobody checked
# is a backup nobody has.
SOLD=$(( $(wc -l < "$OUT/sold-tickets.csv") - 1 ))
SCHEMA_BYTES=$(wc -c < "$OUT/schema.sql")
DATA_BYTES=$(wc -c < "$OUT/data.sql")

if [ "$SCHEMA_BYTES" -lt 1000 ] || [ "$DATA_BYTES" -lt 1000 ]; then
  echo "REFUSING TO CALL THIS A BACKUP: the dump came out nearly empty." >&2
  exit 1
fi

echo
echo "Done — $OUT"
echo "  schema.sql        $SCHEMA_BYTES bytes"
echo "  data.sql          $DATA_BYTES bytes"
echo "  sold-tickets.csv  $SOLD sold or donated tickets, with buyer contacts"
echo
echo "This folder holds people's names and telephone numbers. Keep it off the"
echo "repository and off shared drives."
echo
# Named on stdout in a form a workflow can read, so whatever runs this next
# does not have to guess which timestamp it chose.
if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "dir=$OUT" >> "$GITHUB_OUTPUT"; fi

echo "To restore into an empty project:"
echo "  psql \"\$DB_URL\" -f $OUT/schema.sql"
echo "  psql \"\$DB_URL\" -f $OUT/data.sql"
