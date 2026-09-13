#!/usr/bin/env bash
# Check the connection to Supabase, apply the schema, and say what is there.
#
#   ./supabase/connect.sh            check the connection only
#   ./supabase/connect.sh --schema   also apply schema.sql
#
# Reads supabase/.env.local, which is gitignored. Nothing is printed that would
# expose the secret key — only its prefix and length, enough to tell you that
# the right kind of key is loaded without putting it on screen or in a log.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="supabase/.env.local"
if [ ! -f "$ENV_FILE" ]; then
  echo "No $ENV_FILE yet. Start with:"
  echo "  cp supabase/.env.local.example supabase/.env.local"
  echo "then fill in the two values from Supabase -> Settings -> API."
  exit 1
fi

set -a; . "$ENV_FILE"; set +a

if [ -z "${SUPABASE_URL:-}" ] || [ "${SUPABASE_URL}" = "https://YOUR-PROJECT-REF.supabase.co" ]; then
  echo "SUPABASE_URL is still the placeholder."; exit 1
fi
if [ -z "${SUPABASE_SECRET_KEY:-}" ] || [ "${SUPABASE_SECRET_KEY}" = "sb_secret_REPLACE_ME" ]; then
  echo "SUPABASE_SECRET_KEY is still the placeholder."; exit 1
fi

# A publishable key here would appear to work for reads and then fail on every
# write, which is a confusing way to spend an afternoon.
case "$SUPABASE_SECRET_KEY" in
  sb_publishable_*)
    echo "That is the PUBLISHABLE key, not the secret one."
    echo "The secret key starts sb_secret_ and is behind a reveal button."
    exit 1;;
esac

echo "URL : $SUPABASE_URL"
echo "Key : ${SUPABASE_SECRET_KEY:0:10}… (${#SUPABASE_SECRET_KEY} chars)"
echo

echo "Reaching the project…"
code=$(curl -sS -o /dev/null -m 20 -w '%{http_code}' \
  -H "apikey: $SUPABASE_SECRET_KEY" \
  -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
  "$SUPABASE_URL/rest/v1/" || echo 000)

case "$code" in
  200|404) echo "  reachable (HTTP $code)";;
  401|403) echo "  rejected (HTTP $code) — the key is wrong for this project."; exit 1;;
  000)     echo "  could not connect. Check the URL and your internet."; exit 1;;
  *)       echo "  unexpected HTTP $code"; exit 1;;
esac

t=$(curl -sS -o /dev/null -m 20 -w '%{time_total}' \
  -H "apikey: $SUPABASE_SECRET_KEY" -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
  "$SUPABASE_URL/rest/v1/" 2>/dev/null || echo 0)
printf '  round trip %.0f ms — this is the number the region decides\n\n' "$(echo "$t * 1000" | bc -l)"

if [ "${1:-}" = "--schema" ]; then
  if [ -z "${SUPABASE_DB_URL:-}" ]; then
    echo "To apply the schema, either:"
    echo "  - paste supabase/schema.sql into the Supabase SQL editor and Run, or"
    echo "  - add SUPABASE_DB_URL (Settings -> Database -> Connection string, URI)"
    echo "    to $ENV_FILE and run this again."
    exit 0
  fi
  echo "Applying schema.sql…"
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql
  echo "Schema applied."
  echo
fi

echo "What is in the database now:"
for t in tickets books agents app_users; do
  n=$(curl -sS -m 20 -H "apikey: $SUPABASE_SECRET_KEY" \
        -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
        -H "Prefer: count=exact" -H "Range: 0-0" \
        -D - -o /dev/null "$SUPABASE_URL/rest/v1/$t?select=*" 2>/dev/null \
      | grep -i '^content-range:' | sed 's|.*/||' | tr -d '\r' || true)
  printf '  %-12s %s\n' "$t" "${n:-table not found — apply the schema first}"
done

echo
echo "Next: node supabase/bench.mjs --seed   then   node supabase/bench.mjs"
echo "(bench.mjs reads SUPABASE_SERVICE_KEY; export SUPABASE_SERVICE_KEY=\"\$SUPABASE_SECRET_KEY\")"
