#!/usr/bin/env bash
# Prove the row-security policies by asking as the wrong person.
#
#   ./supabase/test-rls.sh
#
# These policies are what stands between a browser and several thousand buyers'
# phone numbers, many belonging to refugees. A policy that is too loose does not
# throw — it answers. So every case here asks as somebody who should NOT see the
# rows and checks that nothing comes back, rather than only checking that the
# right person can read.
set -uo pipefail
cd "$(dirname "$0")/.."

# The same two ways in as test-functions.sh, and for the same reason: this used
# to exit 0 when Docker was absent, and exit 0 is what a green suite looks like.
# A machine without Docker checked none of the row security and said nothing.
if docker info >/dev/null 2>&1; then
  MODE=docker
elif command -v psql >/dev/null 2>&1 && psql -d postgres -tAc "select 1" >/dev/null 2>&1; then
  MODE=local
else
  echo "NOT RUN: no Docker and no local Postgres to fall back on." >&2
  echo "This is the only place row security is exercised as the browser's own" >&2
  echo "roles, so a run that cannot happen is a failure, not a pass." >&2
  exit 1
fi

# Per-process, and overridable, exactly as test-functions.sh is and for the
# reason that suite learned: cleanup() is `docker rm -f`, so a fixed name means
# a peer starting their run kills the container mine is halfway through, and
# what that looks like is a scatter of failures in unrelated cases.
NAME=${KCHO_RLSTEST_NAME:-kcho-rlstest-$$}
PORT=${KCHO_RLSTEST_PORT:-$(( 55435 + ($$ % 400) ))}
pass=0; fail=0
ok() { if [ "$1" = "$2" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "  FAIL $3"; echo "    got:  $1"; echo "    want: $2"; fi; }

DB=kcho_rlstest_$$
if [ "$MODE" = docker ]; then
  cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
  trap cleanup EXIT
  cleanup
  echo "Starting Postgres (docker)…"
  docker run -d --name "$NAME" -e POSTGRES_PASSWORD=t -e POSTGRES_DB=kcho -p $PORT:5432 postgres:16 >/dev/null
  #
  # TWO FAULTS LIVED HERE AND BETWEEN THEM THIS BRANCH HAS NEVER RUN.
  #
  # The definition was `DB_() { DB_ "$@"; }` — a function whose body is a call
  # to itself. Bash recurses until the stack goes, and the suite dies with
  # signal 11 having printed "Starting Postgres (docker)…" and nothing else,
  # which reads as a container that crashed rather than as a typo.
  #
  # And it was defined AFTER the readiness loop that uses it, so the loop's
  # sixty attempts all failed instantly with "command not found" and the script
  # went on to apply schema.sql to a server that had not finished starting. That
  # is the "schema failed" anybody who fixed only the recursion would see next.
  #
  # The local branch below has always defined both properly, so this fired only
  # for somebody with Docker running — which, since the local branch is the
  # fallback, is nearly everybody who has Docker.
  DB_() { docker exec -i "$NAME" psql -U postgres -d kcho "$@"; }
  for _ in $(seq 1 60); do DB_ -c "select 1" >/dev/null 2>&1 && break; sleep 1; done
  APPLY() { docker cp "$1" "$NAME":/tmp/f.sql >/dev/null && \
            DB_ -q -v ON_ERROR_STOP=1 -f /tmp/f.sql; }
else
  cleanup() { psql -d postgres -q -c "drop database if exists $DB" >/dev/null 2>&1 || true; }
  trap cleanup EXIT
  cleanup
  echo "Starting Postgres (local, server $(psql -d postgres -tAc 'show server_version' 2>/dev/null))…"
  psql -d postgres -q -c "create database $DB" >/dev/null
  DB_() { psql -d "$DB" "$@"; }
  APPLY() { psql -d "$DB" -q -v ON_ERROR_STOP=1 -f "$1"; }
fi

# `anon` and `authenticated` are created by Supabase. schema.sql grants to one
# and rls.sql revokes from both, so both have to exist — this created only anon,
# and schema.sql stopped at the first grant to `authenticated`. Together with the
# two faults above it means the docker branch of this suite has never completed
# a run; everybody who has exercised these policies did it through the local
# Postgres fallback.
#
# AND IT HAPPENED AGAIN, with the third role. On 2026-09-21 functions.sql:1375
# gained `grant execute on function holding_of to service_role` — Supabase makes
# that role too, and this list did not. From that day this suite printed
# "functions failed" and exited before its first case, exactly as the paragraph
# above describes, and for the same reason one role further along. A role that
# appears once in the SQL looks unused until the statement that needs it runs.
DB_ -q -c "do \$\$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
  end \$\$;" >/dev/null 2>&1 || true

# WHY IT FAILED, not just which file. Three days of "functions failed" with the
# reason discarded, while psql was naming the missing role in full every time.
BUILD() { out=$(APPLY "$1" 2>&1) || { echo "$1 failed"; echo "$out" | grep -i "error" | head -3 | sed 's/^/  /'; exit 1; }; }

# SUPABASE'S OWN GRANTS COME FIRST, AND THAT ORDER IS THE POINT.
#
# This block used to sit AFTER the three BUILD lines and to open with
# `create role authenticated nologin;` — a role the do-block above has already
# created. psql runs a -c string as one implicit transaction, so that duplicate
# aborted the statement and every grant beneath it. The block has never run.
#
# Nothing failed, because Postgres grants EXECUTE on a new function to PUBLIC
# by default and `authenticated` reaches PUBLIC's grant like any other role. So
# for as long as this suite has existed, `authenticated` has been exercising
# these policies on privileges it was never actually given here.
#
# It also could not simply be repaired in place. Running those grants AFTER our
# own files would re-grant execute on every function the repository
# deliberately revokes — `revoke execute on function settle_book … from
# authenticated` and a dozen like it — and the suite would stop being able to
# see the difference. Production's order is the other way round: Supabase's
# template grants anon, authenticated and service_role broad access to the
# public schema when the project is created, and OUR sql then claws back the
# sensitive ones. So the grants belong here, before the build, and what the
# suite exercises afterwards is what our own revokes actually left standing.
DB_ -q -c "
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;" >/dev/null 2>&1

BUILD supabase/schema.sql
BUILD supabase/functions.sql
BUILD supabase/rls.sql

# The view grants our own rls.sql already makes are not repeated here; it grants
# select on tickets_readable, book_ledger, agents_readable and config_readable
# itself, which is why those kept working while the dead block above did not.

DB_ -q -c "
  -- UPSERT: schema.sql seeds these keys now, so a plain insert duplicates them.
  insert into config(key,value) values
    ('TOTAL_TICKETS','60'),('TICKETS_PER_BOOK','10'),('TICKET_PRICE','10'),('ACTIVE_TICKETS','30')
  on conflict (key) do update set value = excluded.value;
  insert into agents(agent_id,name,phone) values ('A001','Pa Thang','0125551111'),('A002','Ma Nu','0125552222');
  insert into books(idx,number,first_ticket,last_ticket,status,held_by_agent)
    select g,'Book-'||lpad(g::text,4,'0'),'KS-'||lpad(((g-1)*10+1)::text,5,'0'),
           'KS-'||lpad((g*10)::text,5,'0'),'Out', case when g<=2 then 'A001' else 'A002' end
    from generate_series(1,6) g;
  -- sold_by_agent is filled in, which it was not: every ticket here was Sold by
  -- nobody, so a case about reading another seller's takings had nothing to
  -- read. Credited to whoever holds the book, which is what the sale paths do.
  insert into tickets(idx,number,book_idx,status,buyer_name,buyer_phone,amount,sold_at,sold_by_agent,payment_status,recorded_by)
    select i,'KS-'||lpad(i::text,5,'0'),ceil(i/10.0),'Sold','Buyer '||i,'0125550'||lpad((100+i)::text,3,'0'),10,now(),
           case when ceil(i/10.0) <= 2 then 'A001' else 'A002' end,
           'Paid', 'desk@x.com'
    from generate_series(1,60) i;
  insert into app_users(email,name,role,status,agent_id) values
    ('admin@x.com','Admin','admin','active',null),
    ('view@x.com','Viewer','viewer','active',null),
    ('a1@x.com','Agent One','agent','active','A001'),
    ('off@x.com','Disabled','admin','suspended',null);" >/dev/null 2>&1

# Runs a query as `authenticated` with a given email in the JWT claims.
AS() {
  local email="$1" sql="$2" claims
  if [ -z "$email" ]; then claims='{}'; else claims="{\"email\":\"$email\"}"; fi
  DB_ -tAc \
    "begin;
     select set_config('request.jwt.claims', '$claims', true);
     set local role authenticated;
     $sql" 2>&1 | tail -1
}

# ============ THE FIXTURE HAS TO EXIST BEFORE A DENIAL MEANS ANYTHING ============
#
# A DENIAL OVER ZERO ROWS IS NOT A DENIAL. Every assertion below this line reads
# "and they see nothing", and an empty table satisfies every one of them. So a
# fixture that silently failed to load would turn this whole file green while
# proving the opposite of what it claims.
#
# Not hypothetical, twice over. A peer session's RLS fixture aborted on a
# `create role` that had already run, and because psql wraps a multi-statement
# -c in one implicit transaction, NOTHING was inserted — every later query
# answered truthfully about an empty table and the leak test passed. And this
# very file seeded app_users by writing `active`, which no handler does; the
# moment `active` became a generated column, as production has always had it,
# the seed failed and the suite would have gone quietly green had the counts
# below not happened to be non-zero.
#
# The specific causes differ and the family does not: an aborted transaction, a
# typo'd column, a filter matching nothing, a role never granted the privilege
# whose revocation is under test. Asserting the fixture is non-empty catches all
# of them, so it is asserted here rather than assumed everywhere.
echo "the fixture loaded at all"
ok "$(DB_ -tAc 'select count(*) from app_users')" "4" "four accounts to test as"
ok "$(DB_ -tAc 'select count(*) from tickets')"   "60" "sixty tickets to be refused"
ok "$(DB_ -tAc 'select count(*) from books')"     "6"  "six books"
ok "$(DB_ -tAc 'select count(*) from agents')"    "2"  "two sellers"
# And that the seed wrote what the HANDLERS write. app_users.active is generated
# from status, so a fixture writing `active` directly does not merely differ from
# production — it fails, and takes the evidence with it.
ok "$(DB_ -tAc "select active from app_users where email='admin@x.com'")" "t" "an active account reads as active"
ok "$(DB_ -tAc "select active from app_users where email='off@x.com'")"   "f" "and a suspended one does not"

echo "nobody signed in sees nothing"
ok "$(AS '' 'select count(*) from tickets_readable')" "0" "no session, no tickets"
ok "$(AS '' 'select count(*) from book_ledger')"      "0" "no session, no books"
ok "$(AS '' 'select count(*) from config_readable')"           "0" "no session, no config"

echo "somebody not on the allowlist sees nothing"
ok "$(AS 'stranger@x.com' 'select count(*) from tickets_readable')" "0" "a valid session is not enough"
ok "$(AS 'stranger@x.com' 'select count(*) from agents_readable')"  "0" "nor for sellers"

echo "a disabled account sees nothing"
# The row exists and says admin; `active` is false. This is the one that matters
# for revoking somebody in a hurry.
ok "$(AS 'off@x.com' 'select count(*) from tickets_readable')" "0" "a disabled admin is shut out"

echo "held-back tickets are not readable by anyone"
# 60 generated, 30 in play. The other 30 must be invisible even to an admin —
# hidden in the interface would not be enough, because a crafted query would
# still reach them.
ok "$(AS 'admin@x.com' 'select count(*) from tickets_readable')" "30" "an admin sees only what is in play"
ok "$(AS 'admin@x.com' "select count(*) from tickets_readable where number='KS-00045'")" "0" "a held-back ticket is absent"

echo "an agent sees every ticket's status and nobody else's buyer"
# A001 holds books 1-2, which is tickets 1-20. Books 3-6 are A002's.
#
# The rows are NOT hidden. Sellers ask each other whether a number is still
# going, and hiding the row makes an available ticket indistinguishable from one
# that was never printed. What is hidden is who bought it.
ok "$(AS 'a1@x.com' 'select count(*) from tickets_readable')" "30" "every ticket in play is visible"
ok "$(AS 'a1@x.com' "select count(*) from tickets_readable where book_idx=3")" "10" "including another seller's book"
ok "$(AS 'a1@x.com' "select status from tickets_readable where number='KS-00021'")" "Sold" "with its status, so availability is answerable"

# ...and this is the half that matters.
ok "$(AS 'a1@x.com' "select buyer_name from tickets_readable where book_idx=3 limit 1")" "" "but not the buyer's name"
ok "$(AS 'a1@x.com' "select buyer_phone from tickets_readable where book_idx=3 limit 1")" "" "nor their telephone number"
ok "$(AS 'a1@x.com' "select buyer_zone from tickets_readable where book_idx=3 limit 1")" "" "nor where they live"
ok "$(AS 'a1@x.com' "select coalesce(notes,'') from tickets_readable where book_idx=3 limit 1")" "" "nor any note about them"
ok "$(AS 'a1@x.com' "select count(*) from tickets_readable where book_idx<>1 and book_idx<>2 and buyer_phone<>''")" "0" "not one number outside their own books"

# Their own books are untouched — they made those sales and have to ring those
# buyers when a number comes up.
ok "$(AS 'a1@x.com' "select buyer_phone from tickets_readable where number='KS-00001'")" "0125550101" "their own buyer's number is intact"
ok "$(AS 'a1@x.com' 'select count(*) from book_ledger')" "2" "and only their books in the ledger"

echo "and the ledger views carry every column the function filters them by"
# WHAT THIS CAUGHT, AFTER IT REACHED PRODUCTION. listBooks scopes a seller's
# list to "held by me, or offered to me" and applies that through PostgREST
# against book_ledger_all. The column exists on `books` and was not in the
# view's select list, so the filter named a column that was not there:
#
#     column book_ledger_all.offered_to_agent does not exist
#
# A seller's entire books list failed to load, which is every screen they have.
# Nothing here exercised the view's COLUMNS — only its rows — so a filter added
# in the Edge Function could name anything at all and no suite would notice.
for v in book_ledger book_ledger_all; do
  ok "$(DB_ -tAc "select count(*) from information_schema.columns
                   where table_name='$v' and column_name='offered_to_agent'" 2>&1 | tr -d ' ')" "1" \
     "$v exposes offered_to_agent, which listBooks filters on"
done

echo "a seller can see the books being offered to them, and nobody else's offer"
# AN OFFER THEY CANNOT SEE IS AN OFFER THEY CANNOT ANSWER. The row lands in
# their approvals queue naming books; under "held by you" alone every one of
# those books was invisible on the screen the queue points at.
#
# held_by_agent is set to null in the same statement, because it has to be: an
# Offered book on somebody's balance is refused by the database, and that
# constraint is the whole reason an offer is safe.
DB_ -q -c "update books set status='Offered', held_by_agent=null, offered_to_agent='A001' where idx=3" >/dev/null
ok "$(AS 'a1@x.com' 'select count(*) from book_ledger')" "3" "their two books, plus the one being offered to them"
ok "$(AS 'a1@x.com' "select status from book_ledger where idx=3")" "Offered" "and it reads as Offered, not as theirs"
ok "$(AS 'a1@x.com' "select coalesce(held_by_agent,'') from book_ledger where idx=3")" "" "held by nobody, which is what keeps it off their balance"

DB_ -q -c "update books set offered_to_agent='A002' where idx=3" >/dev/null
ok "$(AS 'a1@x.com' 'select count(*) from book_ledger')" "2" "another seller's offer is not theirs to see"
ok "$(AS 'a1@x.com' "select count(*) from book_ledger where idx=3")" "0" "the offered book is gone from their list entirely"
# Through the ledger, not the base table: `books` is revoked from authenticated
# for everybody, organisers included, which the cases further down assert. An
# organiser reading it directly returns the SET from the role change and would
# have made this pass for a reason that has nothing to do with offers.
ok "$(AS 'admin@x.com' "select count(*) from book_ledger where idx=3")" "1" "an organiser still sees the offered book"
DB_ -q -c "update books set status='Out', held_by_agent='A002', offered_to_agent=null where idx=3" >/dev/null

echo "a seller cannot read another seller's takings"
# THE GAP THE REVIEW NAMED, and it is not the row's existence. Every signed-in
# agent's browser held every active ticket with four columns filled in that were
# none of their business: which seller sold it, for how much, whether that money
# had come in, and who wrote it down. No screen draws another seller's takings,
# which is why nobody noticed — but the data was in the browser, and "no screen
# shows it" is not a permission.
#
# A001 holds books 1-2 (tickets 1-20). Books 3-6 are A002's.
ok "$(AS 'a1@x.com' "select coalesce(sold_by_agent,'') from tickets_readable where number='KS-00021'")" "" "another seller's name is not on their ticket"
ok "$(AS 'a1@x.com' "select coalesce(amount::text,'') from tickets_readable where number='KS-00021'")" "" "nor what it went for"
ok "$(AS 'a1@x.com' "select payment_status from tickets_readable where number='KS-00021'")" "" "nor whether that money came in"
ok "$(AS 'a1@x.com' "select recorded_by from tickets_readable where number='KS-00021'")" "" "nor who wrote it down"

echo "and can read their own"
# The other direction, because a filter that returns nothing passes every
# does-not-see case in this file for the wrong reason.
ok "$(AS 'a1@x.com' "select sold_by_agent from tickets_readable where number='KS-00001'")" "A001" "their own sale names them"
ok "$(AS 'a1@x.com' "select amount::text from tickets_readable where number='KS-00001'")" "10.00" "with what it went for"

echo "the row itself stays, because availability is a question sellers ask"
# Hiding another seller's tickets was the obvious fix and the wrong one: sellers
# ask each other whether a number is still going, and a hidden row makes an
# available ticket indistinguishable from one that was never printed.
ok "$(AS 'a1@x.com' 'select count(*) from tickets_readable')" "30" "every ticket in play is still visible"
ok "$(AS 'a1@x.com' "select status from tickets_readable where number='KS-00021'")" "Sold" "with its status, so availability is answerable"

echo "an organiser, a helper and a viewer are unchanged by this"
ok "$(AS 'admin@x.com' "select sold_by_agent from tickets_readable where number='KS-00021'")" "A002" "an organiser still sees who sold what"
ok "$(AS 'admin@x.com' "select amount::text from tickets_readable where number='KS-00021'")" "10.00" "and for how much — the draw and the totals need it"
ok "$(AS 'view@x.com' "select amount::text from tickets_readable where number='KS-00021'")" "10.00" "a view-only account checks the money, which is what it is for"

echo "and an account claiming a seller who does not exist sees no takings at all"
# From AUDIT.md §X: a test keyed on the sellers who EXIST cannot catch the next
# widening. The case that catches it hands the filter an agent_id that is in no
# row, and asserts the masking still closes rather than opening.
DB_ -q -c "insert into agents(agent_id,name,phone) values ('A999','Holds Nothing','0125559999');
           insert into app_users(email,name,role,status,agent_id) values ('ghost@x.com','Ghost','agent','active','A999')" >/dev/null 2>&1
ok "$(AS 'ghost@x.com' "select coalesce(sold_by_agent,'') from tickets_readable where number='KS-00001'")" "" "a seller id belonging to nobody sees no seller"
ok "$(AS 'ghost@x.com' "select coalesce(amount::text,'') from tickets_readable where number='KS-00001'")" "" "and no amount"
ok "$(AS 'ghost@x.com' 'select count(*) from tickets_readable')" "30" "while availability still answers, as it must for any agent"
DB_ -q -c "delete from app_users where email='ghost@x.com'; delete from agents where agent_id='A999'" >/dev/null 2>&1

echo "phone numbers are masked for a view-only account"
ok "$(AS 'view@x.com' "select buyer_phone from tickets_readable where number='KS-00001'")" "••••101" "a viewer gets a masked number, in the shape both backends use"
ok "$(AS 'admin@x.com' "select buyer_phone from tickets_readable where number='KS-00001'")" "0125550101" "an admin gets the real one"
ok "$(AS 'view@x.com' "select phone from agents_readable where agent_id='A001'")" "" "a viewer gets no seller phone"
ok "$(AS 'admin@x.com' "select phone from agents_readable where agent_id='A001'")" "0125551111" "an admin does"

# Asserts the query was REFUSED. Checking the message rather than the row count
# on purpose: a query that is denied and a query that legitimately returns
# nothing both look like zero rows, and only one of them is the protection
# working.
denied() {
  # The whole output, not just the last line: psql writes the error to stderr
  # and "SET" to stdout, and the two do not arrive in a guaranteed order
  # through a pipe. Reading only the tail made a refusal look like a success.
  local out
  out="$(DB_ -tAc \
    "begin;
     select set_config('request.jwt.claims', '{\"email\":\"$1\"}', true);
     set local role authenticated;
     $2" 2>&1)"
  case "$out" in
    *denied*|*"does not exist"*) pass=$((pass+1)) ;;
    *) fail=$((fail+1)); echo "  FAIL $3"; echo "    got: $out" ;;
  esac
}

echo "a superadmin row is an admin to every policy"
# 'superadmin' is an ASSIGNMENT that app_role() resolves to 'admin'. If it ever
# leaked through as a fifth value, every policy comparing against the four tiers
# would take a branch nobody wrote — and the one that decides whether a phone
# number is masked is among them.
DB_ -tAc \
  "insert into app_users(email,name,role,status) values ('super2@x.com','Second','superadmin','active')" >/dev/null
ok "$(AS 'super2@x.com' 'select app_role()')" "admin" "app_role resolves superadmin to admin"
ok "$(AS 'super2@x.com' 'select count(*) from tickets_readable')" "30" "and they see every ticket in play"
ok "$(AS 'super2@x.com' "select buyer_phone from tickets_readable where number='KS-00001'")" "0125550101" "with phone numbers unmasked, as an admin"
ok "$(AS 'super2@x.com' 'select count(*) from book_ledger')" "3" "and every book in play"
DB_ -tAc \
  "delete from app_users where email='super2@x.com'" >/dev/null

echo "the base tables are not reachable at all"
# The masking only means something if the unmasked table is out of reach.
denied 'view@x.com'  'select buyer_phone from tickets limit 1' "a viewer could read the tickets table directly"
denied 'admin@x.com' 'select count(*) from app_users'          "an admin could read app_users directly"
denied 'admin@x.com' 'select count(*) from audit_log'          "an admin could read the audit log directly"
denied 'admin@x.com' 'select count(*) from pending_approvals'  "an admin could read the approvals queue directly"
denied 'admin@x.com' 'select count(*) from permissions'        "an admin could read the permissions table directly"

echo "the desk's money is the function's, not the browser's"
# desk_money() sums tickets and books directly. It is plain SQL run as the
# caller, so a browser role reaches neither table — and it is revoked outright
# as well, so a later grant on the tables cannot open it by accident.
denied 'view@x.com'  'select desk_money()' "a viewer could call desk_money()"
denied 'admin@x.com' 'select desk_money()' "an admin could call desk_money() from a browser"

echo "nobody can write through the browser path"
denied 'admin@x.com' "update tickets set buyer_name='hacked' where idx=1" "an admin could write directly"
denied 'admin@x.com' "delete from tickets where idx=1"                    "an admin could delete directly"
denied 'admin@x.com' "insert into tickets(idx,number,book_idx) values (999,'X',1)" "an admin could insert directly"
denied 'admin@x.com' "update config set value='99' where key='ACTIVE_TICKETS'" "an admin could change config directly"
ok "$(DB_ -tAc "select buyer_name from tickets where idx=1")" "Buyer 1" "and the row is untouched"

echo "releasing more tickets widens what is readable"
DB_ -q -c "update config set value='60' where key='ACTIVE_TICKETS'" >/dev/null
ok "$(AS 'admin@x.com' 'select count(*) from tickets_readable')" "60" "the whole raffle once released"

echo
echo "each view keeps the security property it was given"
# Supabase's linter reports BOTH of these as SECURITY DEFINER views. One of the
# two findings may be actioned and the other must not be, so the difference is
# pinned here rather than left to whoever meets the lint next.
#
# config_readable masks nothing — it is the config rows under the same condition
# config_read already carries — so it runs as the caller and the lint is
# genuinely resolved. tickets_readable masks COLUMNS, which no policy can
# express; converting it means granting select on tickets, and tickets_read does
# not mask anything, so a viewer would read every buyer's real telephone number
# off the base table. That is the hole 0974416 closed, and most of those numbers
# belong to refugees. If somebody "fixes" that lint, this file says so.
viewopt() {
  DB_ -tAc \
    "select coalesce(reloptions::text, '{}') from pg_class where relname='$1'"
}
ok "$(viewopt tickets_readable)" "{security_invoker=false}" \
   "tickets_readable is still a definer view, deliberately"
ok "$(viewopt config_readable)" "{security_invoker=true}" \
   "config_readable runs as the caller, which is why its lint could be resolved"

# The properties those settings exist to protect, asserted as behaviour and not
# only as a flag — a reloption is a proxy, and the point is what a person reads.
ok "$(AS 'view@x.com' "select buyer_phone from tickets_readable where number='KS-00001'")" "••••101" \
   "a viewer's number is still masked through the view"
denied 'view@x.com' 'select buyer_phone from tickets' \
   "and still unreachable off the base table"
ok "$(AS 'admin@x.com' "select value from config_readable where key='TICKET_PRICE'")" "10" \
   "config_readable still answers, now through the policy rather than its owner"
ok "$(AS 'off@x.com' "select count(*) from config_readable")" "0" \
   "and still refuses a switched-off account"
# The grant behind the invoker view is column-level: config has a third column
# the view drops, and a table-wide grant would have handed it over.
denied 'admin@x.com' 'select notes from config' \
   "config.notes stays out of reach — the grant names key and value only"

# ============ AND IT HAS TO RUN A SECOND TIME ============
#
# EVERY DEPLOY BUT THE FIRST APPLIES rls.sql TO A DATABASE THAT ALREADY HOLDS
# rls.sql's OWN PREVIOUS OUTPUT. Nothing here tested that. This suite built a
# database from nothing and applied the file once, which is the one shape the
# deploy never has — so a `drop view` that the existing views refuse looked
# perfectly green here and stopped the deploy dead at the line it was on:
#
#   ERROR: cannot drop view book_ledger_all because other objects depend on it
#   DETAIL: view agent_money depends on view book_ledger_all
#
# leaving the policies above that line applied and the money views below it not.
# Two sessions hit it on one evening, and both worked around it by hand.
#
# It costs one more application of a file against a container that is already
# up, and it is the only check here that exercises the deploy rather than the
# install.
echo "and the whole file survives being applied twice, which is what a deploy does"
if APPLY supabase/rls.sql >/dev/null 2>&1; then
  pass=$((pass+1))
else
  fail=$((fail+1))
  echo "  FAIL rls.sql cannot be re-applied to a database that already has its views"
  APPLY supabase/rls.sql 2>&1 | grep -iE "error|detail" | head -4 | sed 's/^/    /'
fi
# And the masking still holds afterwards, because "it ran" is not "it is right":
# a re-run that dropped the view and recreated a stale one would pass the line
# above and hand every seller back their neighbour's takings.
ok "$(AS 'a1@x.com' "select coalesce(sold_by_agent,'') from tickets_readable where number='KS-00021'")" "" \
   "and another seller's takings are still masked after the second run"

# ---------------------------------------------------------------------------
# NO FUNCTION THE BROWSER SHOULD NOT REACH IS REACHABLE BY anon.
#
# WHERE THIS CAME FROM. Stage 2 gives a dozen SQL functions a sibling overload
# taking p_project. A REVOKE names an exact signature, and `create or replace`
# carries privileges across only when it replaces the SAME signature — so every
# one of those siblings is a NEW function object, and Postgres grants EXECUTE on
# a new function to PUBLIC by default. Each arrived publicly callable while its
# original sat correctly revoked one line above it in the same file.
#
# That is invisible to every other check here: the function behaves identically,
# the suites pass, and the only difference is who may call it. With one raffle
# `active_tickets(uuid)` leaks a count; with two, anyone holding another
# organisation's project id reads that organisation's numbers.
#
# ASKED OF THE ROLE, not of the source text, because the question is what the
# database will actually permit.
# ---------------------------------------------------------------------------
echo "anon cannot call the functions that are not its business"
CLOSED="active_tickets(uuid)
desk_money()
desk_money(uuid)
ensure_holding_tx(text,text,text,text)
ensure_holding_tx(text,text,text,text,uuid)
holding_of(text,integer)
issue_books_tx(integer[],integer[],text,date,text,text,boolean)
issue_books_tx(integer[],integer[],text,date,text,uuid,text,boolean)
return_books_tx(integer[],text,text)
return_books_tx(integer[],text,uuid,text)
transfer_books_tx(integer[],text,text,text)
transfer_books_tx(integer[],text,text,uuid,text)
restock_books_tx(integer[],text,text)"
checked=0
while IFS= read -r sig; do
  [ -n "$sig" ] || continue
  # STDIN CLOSED FOR THE CALL, and without it this loop asks exactly one
  # question. DB_ is `docker exec -i` on the docker branch, so it inherits and
  # drains the loop's stdin — the heredoc feeding the signatures — and the
  # second iteration finds nothing left to read. It reported "1 of 13 asked",
  # which is the only reason it was noticed; a check that had simply returned
  # early with everything green would have looked like a clean run.
  got=$(DB_ -tAc "select has_function_privilege('anon', '$sig'::regprocedure, 'EXECUTE')" </dev/null 2>&1)
  case "$got" in
    f) pass=$((pass+1)); checked=$((checked+1)) ;;
    t) fail=$((fail+1)); checked=$((checked+1))
       echo "  FAIL anon may execute $sig — a new overload without its own revoke line" ;;
    *) fail=$((fail+1))
       echo "  FAIL could not ask about $sig: $got" ;;
  esac
done <<< "$CLOSED"
# THE POSITIVE COUNT. A typo in a signature would make every case unaskable and
# a silent loop would report nothing at all, which reads exactly like a clean
# run. This is the assertion that the questions were asked.
ok "$checked" "13" "all thirteen signatures were actually asked about"

# AND THE ONE THAT MUST STAY OPEN, so this section cannot be "fixed" by
# revoking everything: tickets_readable and book_ledger are definer views, but a
# definer view still checks function EXECUTE against the CALLING role, so
# authenticated needs active_tickets(uuid) or both views answer
# "permission denied for function active_tickets".
ok "$(DB_ -tAc "select has_function_privilege('authenticated', 'active_tickets(uuid)'::regprocedure, 'EXECUTE')")" "t" \
   "authenticated keeps active_tickets(uuid), which its views cannot work without"
ok "$(AS 'a1@x.com' "select count(*) >= 0 from tickets_readable")" "t" \
   "and tickets_readable still answers, which is what that grant is for"
ok "$(AS 'a1@x.com' "select count(*) >= 0 from book_ledger")" "t" \
   "as does book_ledger"

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
