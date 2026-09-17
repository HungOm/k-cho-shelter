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
# READ FIRST, BEFORE ANYTHING ASKS FOR A VALUE THAT LIVES IN IT.
#
# This used to be sourced two thirds of the way down, just before the CSV that
# needs the API keys — which was fine while that was the only thing it
# supplied. The moment the connection string came from here too, the check for
# it ran against an environment that had not been loaded yet, and a correctly
# configured machine was told it had no database. Loading it late is loading it
# after somebody has already decided what it says.
#
# A missing .env.local is not an error: on a runner there is none, and every
# value comes from the environment instead.
if [ -f supabase/.env.local ]; then set -a; . supabase/.env.local; set +a; fi

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
#
# WHEN `supabase db dump` CANNOT RUN, AND WHY THAT IS NOT THE END OF IT.
#
# It shells out to a pg_dump of the server's own major version, and gets one by
# running a Docker image. On a machine with no Docker — or with a pg_dump older
# than the hosted database, which refuses outright and is the usual case, since
# Supabase upgrades the server and nobody upgrades their laptop — that path
# stops dead.
#
# psql has no such rule. An older client queries a newer server perfectly well;
# it is pg_dump alone that checks. So the fallback copies every table out with
# \copy, which produces a data backup that is complete and restorable, and it
# says plainly what it could not get: the schema. That is the honest trade. The
# schema can be rebuilt from this repository and a week of migrations; the
# names and telephone numbers cannot be rebuilt from anything.
CAN_DUMP=no
if [ -n "${SUPABASE_DB_URL:-}" ] || [ -n "$REF" ]; then
  if docker info >/dev/null 2>&1; then CAN_DUMP=yes; fi
fi

if [ "$CAN_DUMP" = yes ]; then
  echo "  schema..."
  "${DUMP[@]}" -f "$OUT/schema.sql"

  echo "  data..."
  "${DUMP[@]}" --data-only -f "$OUT/data.sql"
else
  if [ -z "${SUPABASE_DB_URL:-}" ]; then
    echo "NO DATABASE CONNECTION STRING." >&2
    echo >&2
    echo "Without Docker, supabase db dump cannot run, and the fallback needs to" >&2
    echo "reach the database directly. Set SUPABASE_DB_URL to the connection" >&2
    echo "string from Supabase -> Project Settings -> Database." >&2
    exit 1
  fi
  command -v psql >/dev/null 2>&1 || { echo "psql is not installed." >&2; exit 1; }

  echo "  data (psql, table by table — no Docker)..."
  # Every ordinary table in public, asked of the database rather than listed
  # here, so a table added next month is in the backup without anybody
  # remembering to add it. That is the failure this whole file exists to avoid.
  # `|| true` so that a connection failure reaches the refusal below in words
  # somebody can act on, rather than killing the script under `set -e` with
  # psql's own error and no statement about what it means.
  TABLES=$(psql "$SUPABASE_DB_URL" -tAc "
    select table_name from information_schema.tables
     where table_schema='public' and table_type='BASE TABLE'
     order by table_name" || true)
  [ -n "$TABLES" ] || { echo "REFUSING TO CALL THIS A BACKUP: the database reported no tables." >&2; exit 1; }

  : > "$OUT/data.sql"
  mkdir -p "$OUT/csv"
  for t in $TABLES; do
    # NAMED COLUMNS, AND NOT THE DERIVED ONES.
    #
    # `select *` takes generated columns too — app_users.active is computed from
    # status — and COPY refuses to write one back, so a backup taken with * is a
    # backup that cannot be restored. They are also not data: a generated column
    # is a function of the row, and it comes back by itself.
    cols=$(psql "$SUPABASE_DB_URL" -tAc "
      select string_agg(quote_ident(column_name), ',' order by ordinal_position)
        from information_schema.columns
       where table_schema='public' and table_name='$t' and is_generated = 'NEVER'")
    [ -n "$cols" ] || { echo "REFUSING TO CALL THIS A BACKUP: $t reported no columns." >&2; exit 1; }
    psql "$SUPABASE_DB_URL" -q -c "\copy (select $cols from public.$t) to '$OUT/csv/$t.csv' with (format csv, header)" \
      || { echo "REFUSING TO CALL THIS A BACKUP: $t could not be copied out." >&2; exit 1; }
    rows=$(( $(wc -l < "$OUT/csv/$t.csv") - 1 ))
    printf -- '-- %s: %s rows (see csv/%s.csv)\n' "$t" "$rows" "$t" >> "$OUT/data.sql"
    echo "      $t — $rows rows"
  done

  # A RESTORE SCRIPT, WRITTEN NOW, WHILE IT IS EASY.
  #
  # The obvious restore — \copy each CSV straight back — is positional, and it
  # breaks the moment the schema has gained a column since the backup was taken.
  # Which is the situation EVERY restore is in: you are putting an old backup
  # into a newer database. It fails with "missing data for column", at the worst
  # possible moment, to somebody who did not write the backup.
  #
  # So the columns are named, read from each CSV's own header row. A column
  # added later is simply absent and takes its default; one that was dropped
  # since is the only case that still needs a person, and it says so.
  cat > "$OUT/restore.sh" <<'RESTORE'
#!/usr/bin/env bash
# Put this backup into an EMPTY database.
#
#   DB_URL='postgresql://...' bash restore.sh
#
# Build the schema first — supabase/schema.sql, functions.sql, rls.sql and
# supabase/migrations/ from the repository — then run this for the data.
set -euo pipefail
cd "$(dirname "$0")"
: "${DB_URL:?Set DB_URL to the target connection string}"

# IN WHATEVER ORDER THE FOREIGN KEYS ALLOW, found by trying.
#
# csv/*.csv is alphabetical, so book_history loads before books and the foreign
# key refuses it. Rather than encode the dependency graph here — where it would
# go stale the first time somebody adds a table — each pass copies what it can
# and the next pass retries the rest. A pass that achieves nothing means what is
# left cannot be loaded at all, and it says which and stops.
#
# A failed COPY writes nothing, so a retry starts clean.
todo=$(ls csv/*.csv 2>/dev/null)
[ -n "$todo" ] || { echo "No CSVs here." >&2; exit 1; }

while [ -n "$todo" ]; do
  failed=""
  progress=""
  for f in $todo; do
    t=$(basename "$f" .csv)
    cols=$(head -1 "$f")
    if [ -z "$cols" ]; then echo "  $t — empty file, skipped"; progress=yes; continue; fi
    # Drop any column the TARGET computes for itself. An older backup may carry
    # a generated column this database now derives, and COPY refuses to write
    # one — it is not the backup's job to supply what the schema produces.
    cols=$(psql "$DB_URL" -tAc "
      select string_agg(quote_ident(c), ',')
        from unnest(string_to_array('$cols', ',')) c
       where c not in (select column_name from information_schema.columns
                        where table_schema='public' and table_name='$t'
                          and is_generated <> 'NEVER')")
    if [ -z "$cols" ]; then echo "  $t — nothing left to copy, skipped"; progress=yes; continue; fi
    if psql "$DB_URL" -q -c "\\copy public.$t ($cols) from '$f' with (format csv, header)" 2>/dev/null; then
      echo "  $t"
      progress=yes
    else
      failed="$failed $f"
    fi
  done
  if [ -z "$failed" ]; then break; fi
  if [ -z "$progress" ]; then
    echo >&2
    echo "STOPPED. These could not be loaded, and retrying will not help:" >&2
    for f in $failed; do
      t=$(basename "$f" .csv)
      echo "  $t:" >&2
      psql "$DB_URL" -c "\\copy public.$t ($(head -1 "$f")) from '$f' with (format csv, header)" 2>&1 | head -2 | sed 's/^/    /' >&2
    done
    echo >&2
    echo "Usually the schema has moved on since this backup. Build the schema from" >&2
    echo "the repository at the commit this backup was taken, load the data, then" >&2
    echo "apply the migrations since." >&2
    exit 1
  fi
  todo="$failed"
done

# SEQUENCES DO NOT MOVE WHEN ROWS ARE COPIED IN.
#
# Every id comes across with its row, and the sequence behind it stays where it
# was — at 1, in a fresh database. The restore looks perfect and the very next
# insert collides with a row that is already there. Asked of the database
# rather than listed here, so a table added later is covered.
psql "$DB_URL" -q -c "
do \$\$
declare r record; m bigint;
begin
  for r in
    select c.table_name as t, c.column_name as col,
           pg_get_serial_sequence('public.' || quote_ident(c.table_name), c.column_name) as seq
      from information_schema.columns c
     where c.table_schema = 'public'
       and pg_get_serial_sequence('public.' || quote_ident(c.table_name), c.column_name) is not null
  loop
    execute format('select coalesce(max(%I), 0) from public.%I', r.col, r.t) into m;
    perform setval(r.seq, greatest(m, 1));
  end loop;
end \$\$;" || { echo "Sequences were NOT advanced. The next insert may collide with a" >&2
                 echo "restored id — fix before anybody uses this database." >&2; exit 1; }

echo "Restored. Check a count you recognise before trusting it."
RESTORE
  chmod +x "$OUT/restore.sh"

  cat > "$OUT/SCHEMA-NOT-INCLUDED.txt" <<'NOTE'
This backup has the DATA and not the schema.

pg_dump has to be at least the version of the server it is dumping, and the
one on the machine that took this was older. psql has no such rule, so every
table was copied out with \copy instead — those CSVs are complete, and a
restore reads them with \copy in the other direction.

To get a schema dump as well, install a pg_dump matching the hosted server
(Supabase -> Project Settings -> Database shows the version), or run
`supabase db dump` on a machine with Docker.

Until then, the schema lives in supabase/schema.sql, functions.sql, rls.sql
and supabase/migrations/ in the repository — with the caveat, recorded in
supabase/AUDIT.md section S, that those files have drifted from production
before and may again.
NOTE
fi

# A plain CSV of the one thing that matters most, readable without Postgres.
# If everything else fails, this is the file that still lets somebody telephone
# the winner — openable in Excel on any machine, by anybody.
echo "  entries (csv)..."
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
SCHEMA_BYTES=$( [ -f "$OUT/schema.sql" ] && wc -c < "$OUT/schema.sql" || echo 0 )
DATA_BYTES=$(wc -c < "$OUT/data.sql")

if [ "$CAN_DUMP" = yes ] && [ "$SCHEMA_BYTES" -lt 1000 ]; then
  echo "REFUSING TO CALL THIS A BACKUP: the schema dump came out nearly empty." >&2
  exit 1
fi
if [ "$DATA_BYTES" -lt 100 ]; then
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
if [ "$CAN_DUMP" = yes ]; then
  echo "  psql \"\$DB_URL\" -f $OUT/schema.sql"
  echo "  psql \"\$DB_URL\" -f $OUT/data.sql"
else
  # data.sql is a manifest in this mode, not a script. Printing the same two
  # lines either way would hand somebody a restore that silently does nothing.
  echo "  # the schema first — see $OUT/SCHEMA-NOT-INCLUDED.txt"
  echo "  # then the data:"
  echo "  DB_URL=... bash $OUT/restore.sh"

fi
