#!/usr/bin/env bash
# Run the SQL functions against a real Postgres and check they behave.
#
#   ./supabase/test-functions.sh
#
# Deliberately NOT part of tests/run.sh. It needs Docker, takes about fifteen
# seconds, and run.sh executes each file twice — a suite that slow stops being
# run before every change, and a suite that is not run is not a suite. This is
# the one to run after touching schema.sql or functions.sql.
#
# What it checks is the half that cannot be read off the page: that a batch is
# genuinely all-or-nothing, that a book sale skips rather than overwrites
# somebody else's buyer, that an agent cannot reach another agent's books, and
# that the database itself refuses a sale the draw could not resolve to a
# person.
set -uo pipefail
cd "$(dirname "$0")/.."

# PER PROCESS, so two sessions can run this at the same time.
#
# These were fixed strings, and the script starts by running `docker rm -f` on
# that name: a second run killed the first one's container mid-flight, and the
# first then reported schema.sql failing and a hundred and forty-four cases
# failing after it. Every one of those was a phantom — the real error was "No
# such container" — and confident nonsense is worse than a red suite, because
# somebody goes hunting a bug that does not exist.
#
# The local-Postgres branch below has always done this: it creates
# kcho_sqltest_$$ precisely so a run cannot touch anything already on the
# machine. The docker branch was never given the same treatment.
NAME=${KCHO_SQLTEST_NAME:-kcho-sqltest-$$}
PORT=${KCHO_SQLTEST_PORT:-$(( 55434 + ($$ % 400) ))}
pass=0; fail=0
ok()  { if [ "$1" = "$2" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "  FAIL $3"; echo "    got:  $1"; echo "    want: $2"; fi; }
has() { if grep -q "$2" <<<"$1"; then pass=$((pass+1)); else fail=$((fail+1)); echo "  FAIL $3"; echo "    got: $1"; fi; }

# ---------------------------------------------------------------------------
# TWO WAYS TO GET A POSTGRES, because "skipped" was being read as "passed".
#
# This used to exit 0 when Docker was absent. Exit 0 is what a green suite
# looks like, so a machine without Docker ran the whole of tests/run.sh, saw
# nothing red, and concluded the SQL had been checked. It had not. That is
# the failure this file exists to prevent, wearing the file's own clothes —
# and it went on for the entire time a set of new cases was being added to it.
#
# A local server is used when there is one. It has to be a REAL Postgres of
# the right major version: these tests are about triggers, partial indexes,
# generated columns and plpgsql, none of which can be approximated.
# ---------------------------------------------------------------------------
MODE=""
if docker info >/dev/null 2>&1; then
  MODE=docker
elif command -v psql >/dev/null 2>&1 && psql -d postgres -tAc "select 1" >/dev/null 2>&1; then
  MODE=local
  SERVER_MAJOR=$(psql -d postgres -tAc "show server_version_num" 2>/dev/null | cut -c1-2)
  if [ "${SERVER_MAJOR:-0}" -lt 14 ]; then
    echo "The local Postgres is older than 14. These tests need the version the"
    echo "project runs on; start Docker instead." >&2
    exit 1
  fi
else
  echo "NOT RUN: no Docker and no local Postgres to fall back on." >&2
  echo "These are the only tests that exercise the SQL — triggers, constraints" >&2
  echo "and plpgsql — so a run that cannot happen is reported as a failure" >&2
  echo "rather than as a pass. Start Docker, or run a local Postgres 14+." >&2
  exit 1
fi

DB=kcho_sqltest_$$
if [ "$MODE" = docker ]; then
  cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
  trap cleanup EXIT
  echo "Starting Postgres (docker)…"
  cleanup
  docker run -d --name "$NAME" -e POSTGRES_PASSWORD=t -e POSTGRES_DB=kcho -p $PORT:5432 postgres:16 >/dev/null
  for _ in $(seq 1 60); do
    docker exec "$NAME" psql -U postgres -d kcho -c "select 1" >/dev/null 2>&1 && break
    sleep 1
  done
  P() { docker exec "$NAME" psql -U postgres -d kcho -tAc "$1" 2>&1; }
  # A second session, in the background, so one can hold a row while the other
  # tries for it. The concurrency cases below are the only reason this exists.
  PBG() { docker exec "$NAME" psql -U postgres -d kcho -tAc "$1" >/dev/null 2>&1 & }
  APPLY() { docker cp "$1" "$NAME":/tmp/f.sql >/dev/null &&             docker exec "$NAME" psql -U postgres -d kcho -q -v ON_ERROR_STOP=1 -f /tmp/f.sql; }
  # Supabase creates these; a bare Postgres does not, and rls.sql grants to them.
  P "do \$\$ begin
       if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
       if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
     end \$\$;" >/dev/null
else
  # A throwaway database named after this process, dropped on the way out, so a
  # run can never touch anything that was already on the machine.
  cleanup() { psql -d postgres -q -c "drop database if exists $DB" >/dev/null 2>&1 || true; }
  trap cleanup EXIT
  echo "Starting Postgres (local, server $(psql -d postgres -tAc 'show server_version' 2>/dev/null))…"
  cleanup
  psql -d postgres -q -c "create database $DB" >/dev/null
  # rls.sql is not applied here, but schema.sql may still mention the browser
  # roles; create them so a grant is a grant rather than an error.
  psql -d "$DB" -q -c "do \$\$ begin
      if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
    end \$\$;" >/dev/null 2>&1 || true
  P() { psql -d "$DB" -tAc "$1" 2>&1; }
  PBG() { psql -d "$DB" -tAc "$1" >/dev/null 2>&1 & }
  APPLY() { psql -d "$DB" -q -v ON_ERROR_STOP=1 -f "$1"; }
fi

APPLY supabase/schema.sql    >/dev/null 2>&1 || { echo "schema.sql failed"; exit 1; }
APPLY supabase/functions.sql >/dev/null 2>&1 || { echo "functions.sql failed"; exit 1; }
# AND rls.sql, because the VIEWS are in it. book_ledger_all and agent_money are
# where the money arithmetic actually lives, and a suite that applies only the
# tables and the functions cannot see either — which is how cases asserting on
# agent_money came to be written against a database that never had it. What
# this file does NOT test is the row security itself: it runs as the owner,
# which bypasses every policy. test-rls.sh is where that is checked, as the
# browser's own roles.
APPLY supabase/rls.sql >/dev/null 2>&1 || { echo "rls.sql failed"; exit 1; }

# 5 books of 10. Books 1-3 with A001, 4-5 with A002.
# UPSERT, because schema.sql now SEEDS these keys. A fixture that plain-inserts
# them collided with the defaults the moment a Supabase project could be set up
# without a spreadsheet — and it failed at setup, before a single case ran.
P "insert into config(key,value) values
     ('TOTAL_TICKETS','50'),('TICKETS_PER_BOOK','10'),('TICKET_PRICE','10'),('ACTIVE_TICKETS','')
   on conflict (key) do update set value = excluded.value;
   insert into agents(agent_id,name,phone) values
     ('A001','Pa Thang','0125551111'),('A002','Ma Nu','0125552222');
   insert into books(idx,number,first_ticket,last_ticket,status,held_by_agent)
     select g,'Book-'||lpad(g::text,4,'0'),'KS-'||lpad(((g-1)*10+1)::text,5,'0'),
            'KS-'||lpad((g*10)::text,5,'0'),'Out', case when g<=3 then 'A001' else 'A002' end
     from generate_series(1,5) g;
   insert into tickets(idx,number,book_idx,status)
     select i,'KS-'||lpad(i::text,5,'0'),ceil(i/10.0),'Available' from generate_series(1,50) i;" >/dev/null

echo "a clean batch commits"
r=$(P "select bulk_record_sales('[{\"ticketNumber\":\"KS-00001\",\"buyerName\":\"Ma Nu\",\"buyerPhone\":\"0125550100\"},{\"ticketNumber\":\"KS-00002\",\"buyerName\":\"Pa Thang\",\"buyerPhone\":\"0125550101\"}]'::jsonb,'admin@x.com','admin',null,false)")
has "$r" '"recorded": 2' "two sales recorded"
ok "$(P "select count(*) from tickets where status='Sold'")" "2" "two tickets sold"

echo "one bad row rejects the whole batch"
r=$(P "select bulk_record_sales('[{\"ticketNumber\":\"KS-00003\",\"buyerName\":\"Good\",\"buyerPhone\":\"0125550102\"},{\"ticketNumber\":\"KS-00004\",\"buyerName\":\"NoPhone\",\"buyerPhone\":\"12\"}]'::jsonb,'admin@x.com','admin',null,false)")
has "$r" "BAD_PHONE" "the bad row is named"
has "$r" "KS-00004" "and which ticket it was"
# The one that matters: the GOOD row in the same batch must not have been written.
ok "$(P "select status from tickets where number='KS-00003'")" "Available" "the good row in a rejected batch is not written"
ok "$(P "select count(*) from tickets where status='Sold'")" "2" "still only the original two"

echo "every reason is collected, not just the first"
r=$(P "select bulk_record_sales('[{\"ticketNumber\":\"KS-00005\",\"buyerName\":\"\",\"buyerPhone\":\"0125550100\"},{\"ticketNumber\":\"KS-00001\",\"buyerName\":\"X\",\"buyerPhone\":\"0125550100\"},{\"ticketNumber\":\"KS-99999\",\"buyerName\":\"X\",\"buyerPhone\":\"0125550100\"}]'::jsonb,'admin@x.com','admin',null,false)")
has "$r" "MISSING_FIELD"    "a blank name is reported"
has "$r" "ALREADY_SOLD"     "an already-sold ticket is reported"
has "$r" "TICKET_NOT_FOUND" "and one that does not exist"

echo "a duplicate inside one batch is caught"
r=$(P "select bulk_record_sales('[{\"ticketNumber\":\"KS-00006\",\"buyerName\":\"A\",\"buyerPhone\":\"0125550100\"},{\"ticketNumber\":\"KS-00006\",\"buyerName\":\"B\",\"buyerPhone\":\"0125550101\"}]'::jsonb,'admin@x.com','admin',null,false)")
has "$r" "DUPLICATE_IN_BATCH" "the same ticket twice is refused"

echo "a whole-book sale refuses rather than selling what is left"
# THIS USED TO SELL THE REMAINDER. Two of Book-0001's ten were already gone, and
# the whole-book sale took the other eight and reported the two as skipped — so
# somebody who asked for a book got eight stubs, and the only trace was a
# "skipped" list nobody reads. The raffle's owner asked for the button to be
# unavailable on a book that is not whole; this is the same rule at the only
# place that can actually enforce it.
#
# The earlier buyer surviving is still asserted, because that was never the
# problem and a refusal must not undo it either.
r=$(P "select sell_books('Book-0001',null,null,'Ma Hlaing','0125550999','',false,'admin@x.com','admin',null)")
has "$r" "BOOK_NOT_WHOLE"  "a part-sold book cannot be sold whole"
has "$r" "already sold"    "and it says how many of its tickets are gone"
ok "$(P "select count(*) from tickets where book_idx=1 and buyer_name='Ma Hlaing'")" "0" "nobody got the remainder"
ok "$(P "select buyer_name from tickets where number='KS-00001'")" "Ma Nu" "the earlier buyer's name survives"

echo "agents can only reach their own books"
r=$(P "select sell_books('Book-0004',null,null,'X','0125550100','',false,'a@x.com','agent','A001')")
has "$r" "NOT_YOUR_BOOK" "another agent's book is refused"
ok "$(P "select count(*) from tickets where book_idx=4 and status='Sold'")" "0" "and nothing was written"
r=$(P "select sell_books('Book-0004',null,null,'Ma Nu','0125550100','',false,'b@x.com','agent','A002')")
has "$r" '"sold": 10' "the agent holding it can sell it"

echo "a book that is out with a seller is not the office's to sell"
# The rule: you can only sell paper you can hand to the buyer. A book that is
# Out is in somebody's bag, so a helper at the desk claiming one of its tickets
# gives the buyer a number and no ticket — and leaves the seller free to sell
# that same number in person. sell_books had NO check for this at all: the only
# question it asked was whether the book existed.
P "update books set status='Out', held_by_agent='A002' where idx=5;
   update tickets set status='Available', buyer_name='', buyer_phone='' where book_idx=5" >/dev/null
r=$(P "select sell_books('Book-0005',null,null,'X','0125550100','',false,'help@x.com','recorder',null)")
has "$r" "BOOK_WITH_SELLER" "a helper cannot sell a whole book out of a seller's bag"
ok "$(P "select count(*) from tickets where book_idx=5 and status='Sold'")" "0" "and not one ticket was written"

# An organiser may, because that is transcribing what the seller reported —
# and the sale is credited to the HOLDER, which is what keeps it honest: the
# money lands on their balance where settlement checks it against their stubs.
r=$(P "select sell_books('Book-0005',null,null,'Ma Hlaing','0125550100','',false,'admin@x.com','admin',null)")
has "$r" '"sold": 10' "an organiser writing down the seller's report is fine"
ok "$(P "select distinct sold_by_agent from tickets where book_idx=5")" "A002" "credited to whoever holds the book"

echo "and a batch of stubs obeys the same rule"
P "update books set status='Out', held_by_agent='A002' where idx=5;
   update tickets set status='Available', buyer_name='', buyer_phone='', sold_by_agent=null where book_idx=5" >/dev/null
r=$(P "select bulk_record_sales('[{\"ticketNumber\":\"KS-00041\",\"buyerName\":\"A\",\"buyerPhone\":\"0125550100\"}]'::jsonb,'help@x.com','recorder',null,false)")
has "$r" "BOOK_WITH_SELLER" "a helper's batch into a seller's book is refused"
ok "$(P "select status from tickets where number='KS-00041'")" "Available" "and nothing was written"

r=$(P "select bulk_record_sales('[{\"ticketNumber\":\"KS-00041\",\"buyerName\":\"A\",\"buyerPhone\":\"0125550100\",\"agentId\":\"A001\"}]'::jsonb,'admin@x.com','admin',null,false)")
has "$r" '"recorded": 1' "an organiser transcribing it is fine"
ok "$(P "select sold_by_agent from tickets where number='KS-00041'")" "A002" "and the named agent cannot take the credit from the holder"

echo "a book handed back is paper on the desk again"
# The row people trip on. Returned means the book is physically here but not
# counted yet — which is exactly when somebody types the stubs in, so this must
# stay open or counting a book in becomes impossible.
P "update books set status='Returned' where idx=5;
   update tickets set status='Available', buyer_name='', buyer_phone='', sold_by_agent=null where book_idx=5" >/dev/null
r=$(P "select bulk_record_sales('[{\"ticketNumber\":\"KS-00042\",\"buyerName\":\"A\",\"buyerPhone\":\"0125550100\"}]'::jsonb,'help@x.com','recorder',null,false)")
has "$r" '"recorded": 1' "a helper can record against a book that has been handed back"

echo "a lost book is closed like a settled one"
P "update books set status='Lost' where idx=5" >/dev/null
r=$(P "select sell_books('Book-0005',null,null,'X','0125550100','',false,'admin@x.com','admin',null)")
has "$r" "BOOK_CLOSED" "lost sits with settled and void"
P "update books set status='Out', held_by_agent='A002' where idx=5" >/dev/null

echo "held-back tickets cannot be sold"
P "update config set value='20' where key='ACTIVE_TICKETS'" >/dev/null
r=$(P "select sell_books('Book-0005',null,null,'X','0125550100','',false,'admin@x.com','admin',null)")
has "$r" "TICKET_NOT_RELEASED" "a book past the line is refused"
P "update config set value='' where key='ACTIVE_TICKETS'" >/dev/null

echo "the database refuses a sale the draw could not resolve"
r=$(P "update tickets set status='Sold', buyer_name='NoPhone', buyer_phone='' where number='KS-00045'")
has "$r" "tickets_sold_needs_contact" "no phone number is refused by the constraint itself"
r=$(P "update tickets set status='Sold', buyer_name='', buyer_phone='0125550100' where number='KS-00045'")
has "$r" "tickets_sold_needs_contact" "and so is no name"
ok "$(P "select status from tickets where number='KS-00045'")" "Available" "the row is unchanged"

echo "settlement is the one exception, and it is deliberate"
r=$(P "update tickets set status='Sold', source='settlement', buyer_name='', buyer_phone='' where number='KS-00046'")
ok "$(P "select status from tickets where number='KS-00046'")" "Sold" "a settled book may record a sale nobody wrote down"


# ============ SETTLEMENT ============
#
# The action that decides money, and the one with the most ways to be quietly
# wrong. It asks for the tickets that did NOT sell — the ones the agent is
# physically holding — and marks everything else sold. Typing two numbers takes
# five seconds and is exact, where "I sold eight" throws away the
# ticket-to-buyer link the draw depends on.
#
# Book 3 is the settlement fixture: tickets 21-30, held by A001.

echo "settling a book counts what was not handed back"
P "update tickets set status='Available' where book_idx=3" >/dev/null
r=$(P "select settle_book('Book-0003','[\"KS-00029\",\"KS-00030\"]'::jsonb,80,false,null,false,'me@x.com','')")
has "$r" '"declaredSold": 8' "eight of ten sold"
has "$r" '"amountDue": 80' "at RM 10 each"
has "$r" '"variance": 0' "and the money balances"
ok "$(P "select status from tickets where number='KS-00021'")" "Sold" "a ticket not handed back is sold"
ok "$(P "select status from tickets where number='KS-00029'")" "Available" "one handed back goes on the shelf"
ok "$(P "select status from books where idx=3")" "Settled" "and the book is settled"
ok "$(P "select declared_sold||'/'||round(amount_due)||'/'||round(amount_paid) from books where idx=3")" "8/80/80" "the figures are recorded"
ok "$(P "select sold_by_agent from tickets where number='KS-00021'")" "A001" "the sale is attributed to whoever held the book"
ok "$(P "select source from tickets where number='KS-00021'")" "settlement" "and marked as coming from a settlement"

echo "a settlement never overwrites a buyer somebody wrote down"
P "update books set status='Out' where idx=4;
   update tickets set status='Available', buyer_name='', buyer_phone='', source='' where book_idx=4;
   update tickets set status='Sold', buyer_name='Daw Hla', buyer_phone='0125550111',
     amount=10, sold_by_agent='A001', payment_status='Paid'
     where number='KS-00031'" >/dev/null
r=$(P "select settle_book('Book-0004','[]'::jsonb,100,false,null,false,'me@x.com','')")
ok "$(P "select buyer_name from tickets where number='KS-00031'")" "Daw Hla" "the named buyer survives settlement"
ok "$(P "select buyer_phone from tickets where number='KS-00031'")" "0125550111" "with their phone number"
# This is the whole reason settlement asks for the UNSOLD list: a winner drawn
# out of a settled book can still be telephoned if anybody wrote them down.
ok "$(P "select source from tickets where number='KS-00031'")" "" "and is not restamped as a settlement"
# The one that would actually cost somebody: the book is held by A002, but this
# ticket was sold by A001. Restamping it would move the sale — and the money
# owed for it — onto the wrong seller, and the ledger would agree.
ok "$(P "select sold_by_agent from tickets where number='KS-00031'")" "A001" "the sale stays with whoever made it, not whoever held the book"
has "$r" '"declaredSold": 10' "all ten counted, including the one already recorded"

echo "a ticket from another book is a typo, not an instruction"
P "update books set status='Out', declared_sold=null, amount_due=null, amount_paid=null where idx=5;
   update tickets set status='Available' where book_idx=5" >/dev/null
r=$(P "select settle_book('Book-0005','[\"KS-00021\"]'::jsonb,100,false,null,false,'me@x.com','')")
has "$r" "NOT_IN_BOOK" "a number from a different book is refused"
ok "$(P "select status from books where idx=5")" "Out" "and nothing was settled"
# Accepting it would mark the wrong ticket unsold — in a book already closed.
ok "$(P "select status from tickets where number='KS-00041'")" "Available" "no ticket in the named book was touched"

echo "settling twice needs saying so twice"
r=$(P "select settle_book('Book-0003','[]'::jsonb,100,false,null,false,'me@x.com','')")
has "$r" "ALREADY_SETTLED" "a settled book refuses a second settlement"
ok "$(P "select declared_sold from books where idx=3")" "8" "the first figures stand"
r=$(P "select settle_book('Book-0003','[]'::jsonb,100,false,null,true,'me@x.com','corrected')")
has "$r" '"declaredSold": 10' "with force it re-settles"
ok "$(P "select notes from books where idx=3")" "corrected" "and the reason is kept"

echo "when the leftovers are lost, the count is recorded and nothing is invented"
P "update books set status='Out', declared_sold=null, amount_due=null, amount_paid=null where idx=5;
   update tickets set status='Available', source='', buyer_name='', buyer_phone='' where book_idx=5" >/dev/null
r=$(P "select settle_book('Book-0005','[]'::jsonb,60,true,6,false,'me@x.com','stubs lost')")
has "$r" '"declaredSold": 6' "the agent's count is taken"
has "$r" '"unidentified": true' "and flagged as unidentified"
# THE POINT: no ticket rows were fabricated. A "Sold" against a number nobody
# chose is a lie the system would then defend at the draw.
ok "$(P "select count(*) from tickets where book_idx=5 and status='Sold'")" "0" "no ticket was marked sold"
ok "$(P "select round(amount_due) from books where idx=5")" "60" "but the money owed is recorded"

echo "an unidentified settlement still has to be arithmetically possible"
P "update books set status='Out' where idx=5" >/dev/null
r=$(P "select settle_book('Book-0005','[]'::jsonb,60,true,99,false,'me@x.com','')")
has "$r" "BAD_REQUEST" "more sold than the book holds is refused"
r=$(P "select settle_book('Book-0005','[]'::jsonb,60,true,null,false,'me@x.com','')")
has "$r" "MISSING_FIELD" "and a missing count is refused rather than assumed"

echo "a short payment is recorded as a debt, not as a refusal"
P "update books set status='Out', declared_sold=null, amount_due=null, amount_paid=null where idx=5;
   update tickets set status='Available' where book_idx=5" >/dev/null
r=$(P "select settle_book('Book-0005','[]'::jsonb,40,false,null,false,'me@x.com','paid part')")
has "$r" '"variance": -60' "ten sold, forty paid, sixty still owed"
# book_ledger_all, NOT book_ledger, and the difference is not cosmetic.
# schema.sql defines an unfiltered `book_ledger`; rls.sql then REPLACES it with
# the browser-facing one, whose first line is `where app_role() is not null`.
# Applied in that order — which is the order production has — it returns
# nothing to a connection with no signed-in user, which is exactly what this
# script is. These cases read the unfiltered view they always meant.
ok "$(P "select round(counted_expected-counted_collected) from book_ledger_all where idx=5")" "60" "and the ledger says so"
# Refusing a short payment would mean the agent who handed in RM 40 has no
# record of having handed in anything at all.

echo "a void ticket is not swept into a settlement"
P "update books set status='Out', declared_sold=null, amount_due=null, amount_paid=null where idx=5;
   update tickets set status='Available' where book_idx=5;
   update tickets set status='Void' where number='KS-00050'" >/dev/null
r=$(P "select settle_book('Book-0005','[]'::jsonb,90,false,null,false,'me@x.com','')")
has "$r" '"declaredSold": 9' "the void ticket is not counted as sold"
ok "$(P "select status from tickets where number='KS-00050'")" "Void" "and stays void"

echo "settling writes its own history"
ok "$(P "select action from book_history where book_idx=3 order by at desc limit 1")" "settle" "the settlement is on the book's record"
has "$(P "select note from book_history where book_idx=3 order by at desc limit 1")" "sold 10" "with the figures it recorded"

echo "a book that does not exist"
r=$(P "select settle_book('Book-9999','[]'::jsonb,0,false,null,false,'me@x.com','')")
has "$r" "BOOK_NOT_FOUND" "is refused by name"

echo "a settlement never writes a contact nobody can ring"
# The live raffle had four sellers whose numbers had lost their leading zero,
# and this copy turned them into NINE tickets whose contact of record was
# undialable. The field was not empty, so every check downstream passed.
P "update agents set phone = '123367462' where agent_id = 'A002';
   update books set status='Out', held_by_agent='A002' where idx=5;
   update tickets set status='Available', buyer_name='', buyer_phone='', source='' where book_idx=5" >/dev/null
r=$(P "select settle_book('Book-0005','[]'::jsonb,100,false,null,false,'me@x.com','')")
has "$r" '"declaredSold": 10' "the book still settles"
ok "$(P "select buyer_phone from tickets where number='KS-00041'")" "" "an undialable seller number is treated as absent, not copied"
ok "$(P "select buyer_name from tickets where number='KS-00041'")" "Ma Nu (seller)" "the name still identifies who to ask"
# And it lands where somebody looks, rather than looking fine and reaching a stranger.
ok "$(P "select count(*) from tickets where book_idx=5 and status='Sold' and buyer_phone=''")" "10" "all ten show as missing a contact"

echo "but a dialable seller number is still copied"
P "update agents set phone = '0123367462' where agent_id = 'A002';
   update books set status='Out', held_by_agent='A002' where idx=5;
   update tickets set status='Available', buyer_name='', buyer_phone='', source='' where book_idx=5" >/dev/null
r=$(P "select settle_book('Book-0005','[]'::jsonb,100,false,null,false,'me@x.com','')")
ok "$(P "select buyer_phone from tickets where number='KS-00041'")" "0123367462" "a number with a leading zero is trusted"
P "update agents set phone = '60123367462' where agent_id = 'A002';
   update books set status='Out', held_by_agent='A002' where idx=5;
   update tickets set status='Available', buyer_name='', buyer_phone='', source='' where book_idx=5" >/dev/null
r=$(P "select settle_book('Book-0005','[]'::jsonb,100,false,null,false,'me@x.com','')")
ok "$(P "select buyer_phone from tickets where number='KS-00041'")" "60123367462" "and so is one already carrying a country code"

echo "a settled book records the SELLER as the contact"
# A seller selling from their own book keeps their own buyers: they hand back
# the money, and whether they pass the names on is their business. So the
# contact on these tickets is the person who can actually be telephoned about
# them — marked as the seller, not passed off as the buyer.
P "update books set status='Out', held_by_agent='A001', declared_sold=null, amount_due=null, amount_paid=null where idx=2;
   update tickets set status='Available', buyer_name='', buyer_phone='', source='' where book_idx=2" >/dev/null
r=$(P "select settle_book('Book-0002','[\"KS-00019\"]'::jsonb,90,false,null,true,'me@x.com','')")
ok "$(P "select buyer_name from tickets where number='KS-00011'")" "Pa Thang (seller)" "the seller is named, and marked as the seller"
ok "$(P "select buyer_phone from tickets where number='KS-00011'")" "0125551111" "with their phone, so a winner can be traced through them"
# The marker is the point. Without it the winners list would say the seller
# BOUGHT it, and the difference between "knows the buyer" and "bought it" is
# exactly what somebody needs on the day.
ok "$(P "select buyer_name like '% (seller)' from tickets where number='KS-00011'")" "t" "the record says which it is"
ok "$(P "select buyer_name from tickets where number='KS-00019'")" "" "a ticket handed back carries nobody"

echo "and that is enough contact for the draw"
ok "$(P "select count(*) from tickets where book_idx=2 and status='Sold' and buyer_phone=''")" "0" "no settled ticket is left with no way to reach anybody"



# ============ PHASE 1 INTEGRITY (audit of 2026-09-15) ============
#
# Each of these was reproduced on a clean database before it was fixed. They
# stay here so the fix cannot quietly come undone.

echo "a lost book keeps the sales recorded on it"
# Marking a book Lost from the Books screen never declares a count, and the
# ledger read that null as nought — so three recorded sales became RM 0 and
# the seller's debt left the chase list.
P "update books set status='Out', held_by_agent='A001', declared_sold=null, amount_due=null, amount_paid=null where idx=2;
   update tickets set status='Available', buyer_name='', buyer_phone='', source='', sold_by_agent=null, amount=null, payment_status='' where book_idx=2;
   update tickets set status='Sold', buyer_name='Ma Aye', buyer_phone='0125550777', amount=10, sold_by_agent='A001',
     payment_status='Paid', sold_at=now(), source='app' where number in ('KS-00011','KS-00012','KS-00013')" >/dev/null
ok "$(P "select round(counted_expected) from book_ledger_all where idx=2")" "30" "three sold: RM 30 expected while the book is out"
P "update books set status='Lost', notes='seller says lost' where idx=2" >/dev/null
ok "$(P "select round(counted_expected) from book_ledger_all where idx=2")" "30" "still RM 30 once it is marked lost — the sales did not stop existing"
ok "$(P "select counted_sold from book_ledger_all where idx=2")" "3" "and the three sales are still counted"
ok "$(P "select unidentified_sold from book_ledger_all where idx=2")" "0" "with nothing unidentified, because nothing was declared"
# THE SAME NULL, ONE COLUMN ALONG. counted_sold and counted_expected were taught
# to read a null declared_sold as "nobody has counted this book", above. variance
# was not: it computed coalesce(amount_due,0) - recorded_amount, so a book with
# three good sales on it and no count yet reported a discrepancy of minus its own
# takings. Seven books in the live fundraiser were doing it, and the book sheet
# drew every one of them in red under "Difference".
ok "$(P "select round(variance_amount) from book_ledger_all where idx=2")" "0" "and no variance, because there is no count to differ from"
ok "$(P "select variance_sold from book_ledger_all where idx=2")" "0" "not minus the three that ARE written down"

echo "sold by count with no numbers is money, and the ledger says how many cannot be drawn"
P "update books set status='Out', held_by_agent='A002', declared_sold=null, amount_due=null, amount_paid=null where idx=4;
   update tickets set status='Available', buyer_name='', buyer_phone='', source='', sold_by_agent=null, amount=null, payment_status='' where book_idx=4" >/dev/null
r=$(P "select settle_book('Book-0004','[]'::jsonb,60,true,6,false,'me@x.com','stubs lost')")
has "$r" '"declaredSold": 6' "six declared"
ok "$(P "select unidentified_sold from book_ledger_all where idx=4")" "6" "none of them identified"
ok "$(P "select round(unidentified_amount) from book_ledger_all where idx=4")" "60" "worth RM 60 the draw cannot include"
ok "$(P "select round(counted_expected) from book_ledger_all where idx=4")" "60" "and still expected in full — the money is real"
# AND THE OTHER HALF OF THE SAME RULE: once somebody HAS counted the book, the
# variance is a real number and has to show. Six declared against nothing written
# down is a gap of six tickets and RM 60, and suppressing it would be the
# opposite mistake to the one above.
ok "$(P "select variance_sold from book_ledger_all where idx=4")" "6" "six declared with no numbers is a variance of six"
ok "$(P "select round(variance_amount) from book_ledger_all where idx=4")" "60" "worth RM 60, now that there is a declared count to differ from"

echo "counting a book in does not erase a buyer"
P "update books set status='Out', held_by_agent='A001', declared_sold=null, amount_due=null, amount_paid=null where idx=2;
   update tickets set status='Available', buyer_name='', buyer_phone='', source='', sold_by_agent=null, amount=null, payment_status='' where book_idx=2;
   update tickets set status='Sold', buyer_name='Real Buyer', buyer_phone='0125559999', amount=10, sold_by_agent='A001',
     payment_status='Paid', sold_at=now(), source='app', recorded_by='helper@x.com' where number='KS-00011'" >/dev/null
r=$(P "select settle_book('Book-0002','[\"KS-00011\"]'::jsonb,90,false,null,false,'me@x.com','')")
has "$r" "SOLD_TICKET_NAMED_UNSOLD" "a sold ticket typed as unsold is refused"
has "$r" "KS-00011 (Real Buyer)" "and named with its buyer, so the mistake can be found"
ok "$(P "select status||'/'||buyer_name from tickets where number='KS-00011'")" "Sold/Real Buyer" "the sale is untouched"
ok "$(P "select status from books where idx=2")" "Out" "and the book was not settled"
r=$(P "select settle_book('Book-0002','[]'::jsonb,100,false,null,false,'me@x.com','')")
has "$r" '"declaredSold": 10' "without the mistake it settles"
# A placeholder written by that settlement is not a buyer anybody wrote down,
# so a forced re-settle may still hand it back.
r=$(P "select settle_book('Book-0002','[\"KS-00012\"]'::jsonb,90,false,null,true,'me@x.com','one came back')")
has "$r" '"declaredSold": 9' "a settlement placeholder may be named as unsold on a re-settle"
ok "$(P "select status from tickets where number='KS-00012'")" "Available" "and goes back on the shelf"
ok "$(P "select buyer_name from tickets where number='KS-00011'")" "Real Buyer" "while the real buyer is still there"

echo "two settlements of one book cannot interleave"
ok "$(P "select count(*) from pg_proc where proname='settle_book' and prosrc ilike '%for update%'")" "1" "the book row is locked for the transaction"

echo "a ticket keeps its past"
n0=$(P "select count(*) from ticket_history where ticket_idx=11")
P "update tickets set buyer_name='Corrected Buyer', recorded_by='fixer@x.com' where number='KS-00011'" >/dev/null
ok "$(P "select from_buyer||' -> '||to_buyer from ticket_history where ticket_idx=11 order by id desc limit 1")" "Real Buyer -> Corrected Buyer" "a correction records what the name was before"
ok "$(P "select by_user from ticket_history where ticket_idx=11 order by id desc limit 1")" "fixer@x.com" "and who changed it"
ok "$(P "select from_status||' -> '||to_status from ticket_history where ticket_idx=12 order by id desc limit 1")" "Sold -> Available" "the re-settle that handed KS-00012 back is on its record"
ok "$(P "select by_user from ticket_history where ticket_idx=12 order by id desc limit 1")" "me@x.com" "signed by whoever counted the book"
P "update tickets set modified_at=now() where number='KS-00011'" >/dev/null
ok "$(P "select count(*) from ticket_history where ticket_idx=11")" "$((n0+1))" "a touch that changes nothing that matters writes nothing"
ok "$(P "select count(*) from ticket_history where ticket_idx=11 and from_status='' and to_status=''")" "0" "and no row is ever blank"

# APPEND ONLY, tested as the database sees it rather than as the handlers
# promise it. This is the only place an overwritten buyer still exists, and it
# was immutable only in the sense that nobody had written the code to change it.
# Run as the owning superuser, which is stricter than the key the Edge Function
# holds: if it cannot edit the trail, neither can anything the app can do.
echo "a ticket's record cannot be edited or erased"
n1=$(P "select count(*) from ticket_history")
r=$(P "update ticket_history set to_buyer='Somebody Else' where ticket_idx=11")
has "$r" "append only" "an update is refused"
ok "$(P "select count(*) from ticket_history where to_buyer='Somebody Else'")" "0" "and rewrote nothing"
ok "$(P "select from_buyer||' -> '||to_buyer from ticket_history where ticket_idx=11 order by id desc limit 1")" "Real Buyer -> Corrected Buyer" "the step it tried to rewrite is as it was"
r=$(P "delete from ticket_history where ticket_idx=11")
has "$r" "append only" "a delete is refused"
r=$(P "truncate ticket_history")
has "$r" "append only" "and a truncate, which is neither an update nor a delete and would have emptied it"
ok "$(P "select count(*) from ticket_history")" "$n1" "every row is still there"
# The other end of the same guarantee: a ticket cannot be deleted out from
# under its own record, so the trail can never point at nothing.
r=$(P "delete from tickets where number='KS-00011'")
has "$r" "violates foreign key" "and the ticket itself cannot be deleted while it has a record"

# THE CUSTODY TRAIL, held to the same bar, and it was the last history table
# that was not. payments, ticket_history and round_snapshots each refuse an
# update, a delete and a truncate; book_history — who had a book and who they
# handed it to — refused nothing. It was append-only in the sense that nobody
# had written the code to change it, which is precisely how ticket_history was
# append-only until somebody did. Again as the owning superuser, which is
# stricter than the key the Edge Function holds.
echo "a book's custody line cannot be edited or erased"
n2=$(P "select count(*) from book_history")
was=$(P "select action from book_history where book_idx=3 order by id desc limit 1")
r=$(P "update book_history set action='nothing happened' where book_idx=3")
has "$r" "append only" "an update is refused"
ok "$(P "select count(*) from book_history where action='nothing happened'")" "0" "and rewrote nothing"
ok "$(P "select action from book_history where book_idx=3 order by id desc limit 1")" "$was" "the move it tried to rewrite is as it was"
r=$(P "delete from book_history where book_idx=3")
has "$r" "append only" "a delete is refused"
r=$(P "truncate book_history")
has "$r" "append only" "and a truncate, which would have emptied it without being either"
ok "$(P "select count(*) from book_history")" "$n2" "every movement is still there"
# The other end of the same guarantee. This was `on delete cascade`, which let a
# book take the record of its own movements with it — the one moment that record
# is worth having.
r=$(P "delete from books where idx=3")
has "$r" "violates foreign key" "and a book cannot be deleted out from under its own trail"
# A new movement is still ordinary. An append-only table that refuses appends is
# a different defect wearing the same trigger.
P "insert into book_history(book_idx,action,by_user,note) values (3,'issue','me@x.com','still writable')" >/dev/null
ok "$(P "select count(*) from book_history where note='still writable'")" "1" "while appending a move still works"

# A CLOSED ROUND SAID WHAT IT SAID. Same bar as the ticket's record and for the
# same reason: this is the only place the figures a round was closed on still
# exist, and "append only" was going to be true of it exactly as long as nobody
# wrote the handler that changed one. Again as the owning superuser, which is
# stricter than the key the Edge Function holds.
echo "a round that has closed cannot be rewritten"
P "insert into agents(agent_id,name) values ('SNAP','Snapshot Seller') on conflict do nothing;
   insert into round_snapshots(round,agent_id,books_out,recorded_sold,expected,collected,outstanding,reported,missed_before)
     values (1,'SNAP',5,3,30,10,20,true,0)" >/dev/null
ok "$(P "select expected||'/'||collected||'/'||outstanding from round_snapshots where round=1 and agent_id='SNAP'")" "30.00/10.00/20.00" "the round was frozen at RM30 expected, RM10 in, RM20 owed"
r=$(P "update round_snapshots set outstanding=0 where round=1 and agent_id='SNAP'")
has "$r" "append only" "an update is refused"
ok "$(P "select outstanding from round_snapshots where round=1 and agent_id='SNAP'")" "20.00" "and the round still says RM20 was owed"
r=$(P "delete from round_snapshots where round=1")
has "$r" "append only" "a delete is refused"
r=$(P "truncate round_snapshots")
has "$r" "append only" "and a truncate, which would have emptied it without firing either"
# The retried roll. ON CONFLICT DO NOTHING is what the handler sends, and it
# has to be a no-op rather than a merge: a merge is an UPDATE, which this table
# raises on, so a half-failed roll retried an hour later would fail outright
# instead of leaving the figures the round actually closed on.
P "insert into round_snapshots(round,agent_id,expected,collected,outstanding) values (1,'SNAP',999,999,999) on conflict do nothing" >/dev/null
ok "$(P "select expected from round_snapshots where round=1 and agent_id='SNAP'")" "30.00" "a retried roll keeps the figures the round closed on"
ok "$(P "select count(*) from round_snapshots where round=1 and agent_id='SNAP'")" "1" "and adds no second row for the same seller and round"
# A measurement the raffle took of its own books has to survive the person it
# measured, so the FK restricts rather than cascades the way a declaration does.
r=$(P "delete from agents where agent_id='SNAP'")
has "$r" "violates foreign key" "and the seller cannot be erased out from under a round that measured them"

# The check-in's two new columns are what makes a checkpoint able to find
# anything: everything else on the report is a figure the database already had.
# The constraints are the whole of the SQL here — there is no function to test —
# and they are worth a case because a negative count of stubs is not a typo that
# shows up on a screen, it is an "unaccounted for" line that reads as five
# tickets found rather than five missing.
echo "what the seller brought is counted, and cannot be counted backwards"
P "insert into agents(agent_id,name,phone) values ('A009','Reporter','0125559999')" >/dev/null
P "insert into check_in_reports(agent_id,round,due_at,books_back,tickets_sold,amount_paid)
   values ('A009',1,'2026-09-01',2,5,50)" >/dev/null
ok "$(P "select stubs_returned||'/'||unsold_returned||'/'||books_out_at from check_in_reports where agent_id='A009'")" "0/0/0" "a check-in recorded before anybody was asked reads as nought, which is what happened"
P "update check_in_reports set stubs_returned=5, unsold_returned=15, books_out_at=2 where agent_id='A009'" >/dev/null
ok "$(P "select stubs_returned+unsold_returned from check_in_reports where agent_id='A009'")" "20" "and two books' worth of paper adds up"
r=$(P "update check_in_reports set stubs_returned=-1 where agent_id='A009'")
has "$r" "violates check constraint" "a negative count of stubs is refused by the database, not by a screen"

echo "a reporting round can be moved, once, to one day"
P "insert into check_in_dates(round,due_at,note,set_by) values (4,'2026-11-20','hall booked','a@x.com')" >/dev/null
r=$(P "insert into check_in_dates(round,due_at,set_by) values (4,'2026-11-27','a@x.com')")
has "$r" "duplicate key" "one round cannot have two dates — the upsert replaces, it does not add"
ok "$(P "select due_at from check_in_dates where round=4")" "2026-11-20" "and the stored one stands until it is replaced"
r=$(P "insert into check_in_dates(round,due_at,set_by) values (0,'2026-11-27','a@x.com')")
has "$r" "violates check constraint" "there is no round zero"

# THE BOOK AND THE LEDGER CANNOT DISAGREE, because one transaction writes both.
# The old path wrote the payment row after settle_book returned, in a call that
# could not fail the settlement — so a book could say money came in over a
# ledger with no row for it, and nothing sums them against each other to notice.
# What is asserted here is the arithmetic the dropped unique index used to gesture
# at: the settlement rows for a book add up to what the book says was paid.
echo "the cash counted in at settlement is in the ledger, and adds up"
# A BOOK OF ITS OWN, because the ledger cannot be cleared between cases.
#
# This used to reset book 2 and delete its payment rows. The ledger refuses a
# delete outright now — it is append only, and rightly so — and book 2 has been
# settled twice by earlier cases, so what these assertions actually saw was a
# reversal of somebody else's settlement sitting in front of their own. A test
# that needs to destroy evidence in order to count something is testing the
# wrong thing; one that needs a clean book should ask for a clean book.
P "insert into agents(agent_id,name,phone) values ('SET','Settle Seller','0125559999') on conflict do nothing;
   insert into books(idx,number,first_ticket,last_ticket,status,held_by_agent)
     values (6,'Book-0006','KS-00051','KS-00060','Out','SET') on conflict (idx) do nothing;
   insert into tickets(idx,number,book_idx,status)
     select i,'KS-'||lpad(i::text,5,'0'),6,'Available' from generate_series(51,60) i
     on conflict (idx) do nothing" >/dev/null
P "select settle_book('Book-0006','[]'::jsonb,120,false,null,false,'me@x.com','')" >/dev/null
ok "$(P "select count(*)||'/'||sum(amount) from payments where book_idx=6 and source='settlement'")" "1/120.00" "one row, for what was handed over"
ok "$(P "select (select coalesce(sum(amount),0) from payments where book_idx=6) = (select amount_paid from books where idx=6)")" "t" "and it equals what the book says"

# A RE-SETTLE IS A REVERSAL AND A NEW ROW. Updating in place, or deleting the
# row when the second count came to nothing, destroys the only evidence that the
# first figure was ever claimed — and a correction whose evidence is gone cannot
# be told from a figure that was always right.
P "select settle_book('Book-0006','[]'::jsonb,90,false,null,true,'me@x.com','')" >/dev/null
ok "$(P "select count(*) from payments where book_idx=6")" "3" "the first row, its reversal, and the new one"
ok "$(P "select amount from payments where book_idx=6 and reverses is not null")" "-120.00" "the reversal is the negative of what it undoes"
ok "$(P "select count(*) from payments where book_idx=6 and abs(amount)=120")" "2" "and RM120 is still readable as having been claimed"
ok "$(P "select (select sum(amount) from payments where book_idx=6) = (select amount_paid from books where idx=6)")" "t" "the ledger still equals the book"

# ZERO IS NOT A ROW. payments refuses amount = 0, so settling for nothing leaves
# the reversal and no replacement — which reads correctly: claimed, then taken back.
P "select settle_book('Book-0006','[]'::jsonb,0,false,null,true,'me@x.com','')" >/dev/null
ok "$(P "select coalesce(sum(amount),0) from payments where book_idx=6")" "0.00" "settling for nothing leaves nothing owed to the ledger"
ok "$(P "select count(*) from payments where book_idx=6 and amount=0")" "0" "and writes no zero row for somebody to interpret"
ok "$(P "select (select coalesce(sum(amount),0) from payments where book_idx=6) = (select amount_paid from books where idx=6)")" "t" "book and ledger agree at zero too"

# The index that used to be unique. Uniqueness would have refused the third row
# above; the race it guarded is now held off by the row lock settle_book takes.
ok "$(P "select indisunique from pg_index where indexrelid = 'payments_settlement_book_idx'::regclass")" "f" "the settlement index is no longer unique"

# THE SUMS BELONG TO POSTGRES. Every money total used to be added up in
# JavaScript — read the rows, loop, round at the end — which gave up
# numeric(12,2) the moment the values became Numbers, and wrote the same
# arithmetic out in three places. agent_money does it once, in the type the
# column has. What is asserted is that it agrees EXACTLY with the same figures
# computed independently, and that the three quantities stay apart.
echo "what each seller owes, added up by the database"
P "insert into agents(agent_id,name,phone,zone) values ('AM','Money Seller','0125550000','KL') on conflict do nothing;
   -- settled_by_agent as well as held_by_agent, because that is the state
   -- settle_book now leaves behind: custody says where the paper is, and the
   -- frozen seller says whose the declared money is. A fixture that sets only
   -- the first is simulating a settlement this system no longer performs.
   update books set status='Settled', held_by_agent='AM', settled_by_agent='AM', declared_sold=8, amount_due=80, amount_paid=55 where idx=3;
   delete from payments where agent_id='AM';
   insert into payments(agent_id,amount,source,note) values ('AM',12.35,'hand','part'),('AM',7.65,'writeoff','gone away and not coming back')" >/dev/null
ok "$(P "select expected||'/'||collected||'/'||written_off||'/'||outstanding from agent_money where agent_id='AM'")" "80.00/67.35/7.65/5.00" "expected, cash, forgiven and the gap"
# WORKED OUT THE OTHER WAY, from the two regimes rather than from the view. It
# used to sum book_ledger_all by held_by_agent, which was the old model's own
# arithmetic written a second time — so it would have agreed with the view
# however wrong they both were. Now it asks the question the model asks: an open
# book's money is its ticket rows by seller, a closed book's is its declared
# figure by whoever settled it.
ok "$(P "select (select outstanding from agent_money where agent_id='AM') = (
             (select coalesce(sum(t.amount),0) from tickets t join books b on b.idx=t.book_idx
               where t.sold_by_agent='AM' and t.status in ('Sold','Donated')
                 and t.idx <= active_tickets()
                 and not (b.status in ('Settled','Lost') and b.declared_sold is not null))
           + (select coalesce(sum(b.amount_due),0) from books b
               where b.settled_by_agent='AM' and b.status in ('Settled','Lost') and b.declared_sold is not null)
           - (select coalesce(sum(b.amount_paid),0) from books b
               where b.settled_by_agent='AM' and b.status in ('Settled','Lost') and b.declared_sold is not null)
           - (select coalesce(sum(amount),0) from payments where agent_id='AM' and source='hand')
           - (select coalesce(sum(amount),0) from payments where agent_id='AM' and source='writeoff'))")" "t" "and it equals the same sum worked out independently"
ok "$(P "select pg_typeof(outstanding)::text from agent_money where agent_id='AM'")" "numeric" "in the type money is stored in, not a float"

# A SETTLEMENT ROW IS ALREADY IN THE BOOK'S OWN FIGURE. Counting it here as
# well would charge the raffle twice for the same cash — which is why the sum
# asks for 'hand' by name rather than for everything that is not a settlement.
P "insert into payments(agent_id,amount,source,book_idx,note) values ('AM',55,'settlement',3,'counted in')" >/dev/null
ok "$(P "select collected from agent_money where agent_id='AM'")" "67.35" "a settlement row does not double count"

# FORGIVEN IS NOT CASH. Collapsing the two would say the money arrived, and the
# seller whose debt was written off would read as having paid it.
ok "$(P "select collected from agent_money where agent_id='AM'")" "67.35" "what was written off is not in what was handed in"
ok "$(P "select written_off from agent_money where agent_id='AM'")" "7.65" "it is its own figure"

# A seller carrying nothing still has a line, at nought — which is the true
# answer rather than an absence somebody has to interpret.
P "insert into agents(agent_id,name) values ('AMNONE','Holds Nothing') on conflict do nothing" >/dev/null
ok "$(P "select expected||'/'||collected||'/'||outstanding from agent_money where agent_id='AMNONE'")" "0.00/0.00/0.00" "a seller holding nothing reads as nought, not as missing"

# Server-only, like every other view the function reads on the raffle's behalf.
ok "$(P "select has_table_privilege('anon','agent_money','select')")" "f" "the browser's anonymous role cannot read it"
ok "$(P "select has_table_privilege('authenticated','agent_money','select')")" "f" "nor can a signed-in browser"

# THE LEDGER IS THE ONLY RECORD OF WHAT MONEY WAS CORRECTED FROM, and until
# today it was append-only in the sense that nobody had written the code to
# change it. Run as the owning superuser, which is stricter than the key the
# edge function holds: if it cannot edit the ledger, neither can anything the
# app can do.
# A BOOK IN THE OFFICE HAS NO SELLER, AND A SALE OUT OF IT IS NOBODY'S.
# Returning a book does not clear held_by_agent — keeping it is how "brought
# back by" has a name on it — so a book handed in and then sold whole at the
# desk credited every ticket to the seller who had brought it back, and put the
# price of them on her balance as money owed. The single-ticket path had this
# right all along, which is why nobody looked at this one.
#
# Two fresh books, because every book in the fixture has been sold, settled or
# restocked by the time this runs, and a test that reuses one would be asserting
# about whatever the section above left behind.
#
# BOOK 6 IS NOT FREE, which is what these cases found out the hard way. The
# settlement section above creates book 6 and settles it three times, so this
# block's insert hit a duplicate key — and `psql -c "a; b; c"` is ONE implicit
# transaction, so the failure took the TOTAL_TICKETS update and the ticket rows
# down with it. What showed was four assertions failing about credit, none of
# them mentioning a book that already existed: TICKET_NOT_RELEASED, because
# TOTAL_TICKETS had rolled back to 50, and then `held_by_agent` reading 'SET'
# — the settlement fixture's agent, still sitting on book 6.
#
# So: 7, 8 and 9, which are free, and the fixture now says so out loud before
# anything is asserted about credit. A test whose SETUP fails should say the
# setup failed. Four confusing failures downstream is how an afternoon goes.
echo "a whole book sold out of the office is not charged to whoever brought it back"
P "update config set value='80' where key='TOTAL_TICKETS';
   insert into books(idx,number,first_ticket,last_ticket,status,held_by_agent)
     values (7,'Book-0007','KS-00061','KS-00070','Returned','A002'),
            (8,'Book-0008','KS-00071','KS-00080','Out','A002');
   insert into tickets(idx,number,book_idx,status)
     select i,'KS-'||lpad(i::text,5,'0'),ceil(i/10.0),'Available' from generate_series(61,80) i" >/dev/null
ok "$(P "select count(*) from books where idx in (7,8) and held_by_agent='A002'")" "2" "the two fresh books this section needs are actually there"
ok "$(P "select active_tickets()")" "80" "and their tickets are released, so a refusal here means what it says"

r=$(P "select sell_books('Book-0007',null,null,'Desk Buyer','0125557777','',false,'me@x.com','admin',null)")
has "$r" "sold" "a book brought back can still be sold whole at the desk"
ok "$(P "select count(*) from tickets where book_idx=7 and status='Sold' and sold_by_agent is null")" "10" "with nobody named, it is the desk's — not the seller who handed the book in"
ok "$(P "select count(*) from tickets where book_idx=7 and sold_by_agent='A002'")" "0" "nobody is charged for a sale they were not there for"
ok "$(P "select held_by_agent from books where idx=7")" "A002" "while the book still remembers who brought it back"

# NO SELLER IS CREDITED FOR A BOOK THAT IS NOT OUT WITH THEM, and the name the
# caller sends is ignored rather than honoured.
#
# THIS REPLACES A DELIBERATE FEATURE AND SAYS SO. p_sold_by existed to name the
# helper standing at the desk, on the reasoning that the person taking the money
# is usually not the seller who handed the book in. The raffle's owner looked at
# what that produced on real data and ruled the other way: a seller is credited
# only when a book GIVEN OUT TO THEM is sold, and anything sold at the office is
# the organiser's.
#
# What it cost, in the case that prompted it: Book-004 went out at 01:02, came
# back at 01:04, and was sold whole at the desk at 01:27 — credited to the
# seller who had returned it, because the screen offered their name and this
# function accepted it. Money on the balance of somebody who had already
# settled up, and the chase list sent after them for it.
#
# The organiser is not lost. recorded_by carries their address and the book's
# history says "Written down by" them; a null sold_by_agent means "no seller's
# balance", which is the truth.
P "insert into books(idx,number,first_ticket,last_ticket,status,held_by_agent)
     values (9,'Book-0009','KS-00081','KS-00090','Returned','A002');
   insert into tickets(idx,number,book_idx,status)
     select i,'KS-'||lpad(i::text,5,'0'),9,'Available' from generate_series(81,90) i;
   update config set value='90' where key='TOTAL_TICKETS'" >/dev/null
ok "$(P "select count(*) from books where idx=9")" "1" "the third book is there too"
r=$(P "select sell_books('Book-0009',null,null,'Desk Buyer','0125557777','',false,'me@x.com','recorder',null,'A001')")
ok "$(P "select count(*) from tickets where book_idx=9 and sold_by_agent='A001'")" "0" "naming a seller for an office book no longer credits them"
ok "$(P "select count(*) from tickets where book_idx=9 and sold_by_agent is null")" "10" "it is the desk's, and the organiser is on recorded_by"
ok "$(P "select count(*) from tickets where book_idx=9 and recorded_by='me@x.com'")" "10" "which is where the organiser's name actually lives"
ok "$(P "select count(*) from tickets where book_idx=9 and sold_by_agent='A002'")" "0" "and the seller who brought the book in still is not"
# The other half of the same rule, unchanged: a book genuinely out with somebody
# is theirs, and the money lands on their balance where settlement checks it
# against the stubs they hand back.
r=$(P "select sell_books('Book-0008',null,null,'Another Buyer','0125558888','',false,'me@x.com','admin',null)")
ok "$(P "select count(*) from tickets where book_idx=8 and status='Sold' and sold_by_agent='A002'")" "10" "a book out with a seller is still credited to them"

echo "and neither can the record of who did it"
# audit_log is where an override is written down. Whoever made the override is
# the person with the most reason to edit it, so the table refuses them the way
# the four ledgers already do.
P "insert into audit_log(action,details,email) values ('TEST_OVERRIDE','{\"why\":\"a test\"}'::jsonb,'someone@x.com')" >/dev/null
r=$(P "update audit_log set email='somebody.else@x.com' where action='TEST_OVERRIDE'")
has "$r" "append only" "an entry cannot be rewritten to name a different person"
r=$(P "delete from audit_log where action='TEST_OVERRIDE'")
has "$r" "append only" "nor deleted"
r=$(P "truncate audit_log")
has "$r" "append only" "nor the whole log emptied"
ok "$(P "select email from audit_log where action='TEST_OVERRIDE'")" "someone@x.com" "and the original entry is untouched"

echo "putting a book back on the shelf does not un-pay the seller"
# BOOK-084, FROM THE LIVE RAFFLE. A book counted in with nine sold and RM90
# handed over, then put back on the shelf, left JOHN owing ninety pounds of
# money he had already given. Restock reverses the settlement payment — it must,
# because it also clears the book's amount_paid and the two are the same cash —
# and the nine sales survive the restock, so the charge stayed and the credit
# went. The cash arrived; it did not stop having arrived.
P "insert into agents(agent_id,name,phone,active) values ('RS','Restock Seller','0125559999',true)" >/dev/null
P "insert into books(idx,number,first_ticket,last_ticket,status,held_by_agent) values (12,'Book-0012','KS-00111','KS-00120','Out','RS')" >/dev/null
P "insert into tickets(idx,number,book_idx,status) select i,'KS-'||lpad(i::text,5,'0'),12,'Available' from generate_series(111,120) i" >/dev/null
# Its own book and its own ticket range: every range below 100 is already spoken
# for by a case above, and settling somebody else's half-sold fixture proves
# nothing about restock.
P "update config set value='120' where key='TOTAL_TICKETS'" >/dev/null
P "select settle_book('Book-0012','[\"KS-00120\"]'::jsonb,90,false,null,false,'admin@x.com','')" >/dev/null
ok "$(P "select outstanding from agent_money where agent_id='RS'")" "0.00" "counted in and paid in full, nothing outstanding"

P "select restock_books_tx(array[12],'admin@x.com','')" >/dev/null
ok "$(P "select count(*) from tickets where book_idx=12 and status='Sold'")" "9" "the nine sales survive the restock — they are somebody's tickets"
ok "$(P "select expected from agent_money where agent_id='RS'")" "90.00" "and are still charged to the seller who sold them"
ok "$(P "select collected from agent_money where agent_id='RS'")" "90.00" "the money they handed over is still theirs to have paid"
ok "$(P "select outstanding from agent_money where agent_id='RS'")" "0.00" "so they owe nothing, which is the truth"
# The ledger says both things rather than hiding one: the settlement row is
# reversed because the book's figure is gone, and the cash is re-entered as the
# hand-over it now is.
ok "$(P "select count(*) from payments where agent_id='RS' and source='settlement' and reverses is not null")" "1" "the settlement row is reversed, not deleted"
has "$(P "select note from payments where agent_id='RS' and source='hand'")" "went back on the shelf" "and the cash is re-entered saying where it came from"
P "update config set value='50' where key='TOTAL_TICKETS'" >/dev/null

echo "the custody ledger refuses to be edited, emptied, or doubled"
# ff's Phase 1A tables, exercised in the database rather than read from source:
# the triggers, the partial unique index and the check are the whole of what
# ticket_movements promises while nothing reads it yet. The truncate one is the
# one people forget, and it empties a table without firing either of the others.
P "insert into ticket_movements(ticket_idx,from_holder,to_holder,kind,batch_id,by_user,reason)
   values (1,'desk','A001','issue',gen_random_uuid(),'admin@x.com','a test')" >/dev/null
r=$(P "update ticket_movements set reason='changed' where ticket_idx=1")
has "$r" "append only" "a movement cannot be rewritten"
r=$(P "delete from ticket_movements where ticket_idx=1")
has "$r" "append only" "nor deleted"
r=$(P "truncate ticket_movements")
has "$r" "append only" "nor the whole ledger emptied — the one that fires per statement"
ok "$(P "select count(*) from ticket_movements where ticket_idx=1")" "1" "and the movement is still there"

# Idempotency: two rows with no key are two facts; two rows with the same key
# are one fact submitted twice.
P "insert into ticket_movements(ticket_idx,from_holder,to_holder,kind,batch_id,by_user)
   values (2,'desk','A001','issue',gen_random_uuid(),'x'),(3,'desk','A001','issue',gen_random_uuid(),'x')" >/dev/null
ok "$(P "select count(*) from ticket_movements where from_holder='desk' and client_key is null")" "3" "a null key never collides with another null"
P "insert into ticket_movements(ticket_idx,from_holder,to_holder,kind,batch_id,by_user,client_key)
   values (4,'desk','A001','issue',gen_random_uuid(),'x','same-key')" >/dev/null
r=$(P "insert into ticket_movements(ticket_idx,from_holder,to_holder,kind,batch_id,by_user,client_key)
   values (5,'desk','A001','issue',gen_random_uuid(),'x','same-key')")
has "$r" "duplicate key" "the same submission twice is refused"

# A movement from somewhere to the same somewhere is not a movement, unless it
# is the row that says an earlier one was wrong.
r=$(P "insert into ticket_movements(ticket_idx,from_holder,to_holder,kind,batch_id,by_user)
   values (6,'A001','A001','issue',gen_random_uuid(),'x')")
has "$r" "violates check constraint" "a book cannot be issued to whoever already holds it"
P "insert into ticket_movements(ticket_idx,from_holder,to_holder,kind,batch_id,by_user)
   values (7,'A001','A001','correction',gen_random_uuid(),'x')" >/dev/null
ok "$(P "select count(*) from ticket_movements where kind='correction'")" "1" "but a correction may name the same holder at both ends"

ok "$(P "select has_table_privilege('anon','ticket_movements','select')")" "f" "and the browser cannot read it at all"

echo "a ticket moves as a row, and the column follows it"
# PHASE 1. Custody stops being `update books set held_by_agent` and becomes a
# movement per ticket, with tickets.holder as a cache of the latest one. The
# whole point is that the cache can be re-derived: ticket_custody replays the
# ledger, and a disagreement between the two is the thing to look for.
P "insert into agents(agent_id,name,active) values ('MA','Mover A',true),('MB','Mover B',true)" >/dev/null
P "insert into books(idx,number,first_ticket,last_ticket,status) values (20,'Book-0020','KS-00191','KS-00200','Unassigned')" >/dev/null
P "insert into tickets(idx,number,book_idx,status) select i,'KS-'||lpad(i::text,5,'0'),20,'Available' from generate_series(191,200) i" >/dev/null
P "update config set value='200' where key='TOTAL_TICKETS'" >/dev/null

r=$(P "select move_tickets(array(select idx from tickets where book_idx=20),'desk','MA','issue','admin@x.com','')")
has "$r" '"moved": 10' "ten tickets move in one batch"
ok "$(P "select count(*) from ticket_movements where to_holder='MA'")" "10" "ten movements written, one per ticket"
ok "$(P "select count(distinct batch_id) from ticket_movements where to_holder='MA'")" "1" "sharing one batch, because it was one act"
ok "$(P "select count(*) from tickets where book_idx=20 and holder='MA'")" "10" "and the column followed"
ok "$(P "select count(*) from ticket_custody where idx between 191 and 200 and disagrees")" "0" "the ledger and the column agree"

echo "and a book can be split, which is the thing the old model could not say"
# A keeps four, six come back, three go out again to somebody else. Under
# books.held_by_agent this is unrepresentable: the book has ONE holder, so the
# only way to give three tickets to MB was to restock the whole book.
P "select move_tickets(array(select idx from tickets where book_idx=20 and idx>194),'MA','desk','return','admin@x.com','')" >/dev/null
P "select move_tickets(array[195,196,197],'desk','MB','issue','admin@x.com','')" >/dev/null
ok "$(P "select count(*) from tickets where book_idx=20 and holder='MA'")" "4" "four stayed with the first seller"
ok "$(P "select count(*) from tickets where book_idx=20 and holder='MB'")" "3" "three went out to the second"
ok "$(P "select count(*) from tickets where book_idx=20 and holder='desk'")" "3" "three are on the desk"
ok "$(P "select count(*) from ticket_custody where idx between 191 and 200 and disagrees")" "0" "and every one of them can be replayed from its movements"
# No ticket is in two places: the replay returns exactly one holder per ticket.
ok "$(P "select count(*) from (select ticket_idx from ticket_movements where ticket_idx between 191 and 200 group by ticket_idx) x")" "10" "ten tickets have a trail, and each has exactly one current holder"

echo "a movement whose premise is wrong is refused, and says which tickets"
# Not "skip the ones that are not there": a batch that is wrong about one ticket
# is a batch somebody has misread, and moving the other nine hides it.
r=$(P "select move_tickets(array[191,195],'MA','MB','transfer','admin@x.com','')")
has "$r" "NOT_THERE" "the batch is refused"
has "$r" "KS-00195" "naming the ticket that is not where the caller thinks"
ok "$(P "select count(*) from tickets where idx=191 and holder='MA'")" "1" "and nothing moved — not even the ticket that was where it should be"

echo "the same submission twice is one movement, not two"
# The thing a volunteer does on a bad connection.
r1=$(P "select move_tickets(array[198],'desk','MB','issue','admin@x.com','','once-only')")
r2=$(P "select move_tickets(array[198],'desk','MB','issue','admin@x.com','','once-only')")
has "$r2" '"replayed": true' "the second press is recognised as a replay"
# Count the REPLAYED batch, not the ticket's whole trail: 198 has moved twice
# already in the cases above, and asserting on its total would have been a test
# that passed for the wrong reason the first time somebody reordered these.
ok "$(P "select count(*) from ticket_movements where client_key='once-only'")" "1" "and wrote no second movement"
ok "$(P "select count(*) from tickets where idx=198 and holder='MB'")" "1" "the ticket moved exactly once"
P "update config set value='50' where key='TOTAL_TICKETS'" >/dev/null

echo "the ledger cannot be edited or erased"
P "insert into payments(agent_id,amount,received_by,note) values ('A001',50,'me@x.com','cash at the desk')" >/dev/null
n0=$(P "select count(*) from payments")
r=$(P "update payments set amount=5 where amount=50")
has "$r" "append only" "an update is refused"
r=$(P "delete from payments where amount=50")
has "$r" "append only" "a delete is refused"
r=$(P "truncate payments")
has "$r" "append only" "and a truncate, which would have emptied it without firing either"
ok "$(P "select count(*) from payments")" "$n0" "every entry is still there"
ok "$(P "select amount from payments where note='cash at the desk'")" "50.00" "with the figure it was written with"

echo "the same attempt, recorded twice, is one payment"
P "insert into payments(agent_id,amount,received_by,client_key) values ('A001',60,'me@x.com','attempt-1')" >/dev/null
r=$(P "insert into payments(agent_id,amount,received_by,client_key) values ('A001',60,'me@x.com','attempt-1')")
has "$r" "duplicate key" "a retry of the same attempt cannot write a second row"
ok "$(P "select count(*) from payments where client_key='attempt-1'")" "1" "so the money is counted once"
# The index is PARTIAL, and it has to be: every NULL is distinct in Postgres, but
# a plain unique column would be relying on that by accident. Two keyless
# payments of the same amount are two payments, which is the ordinary case.
P "insert into payments(agent_id,amount,received_by) values ('A001',7,'me@x.com')" >/dev/null
P "insert into payments(agent_id,amount,received_by) values ('A001',7,'me@x.com')" >/dev/null
ok "$(P "select count(*) from payments where amount=7")" "2" "and two payments nobody named are still two payments"

# One API request writes to four tables. Before this, "show me everything that
# happened when that book was counted in" was a join on TIME — approximately
# right, always available, and wrong in exactly the case worth investigating.
echo "one request, one thread through every table it touched"
ok "$(P "select request_id from payments order by id desc limit 1")" "" "written with no request, the id is blank — which is the truth about that row"
P "begin;
   select set_config('request.headers','{\"x-request-id\":\"req-77\"}',true);
   update tickets set buyer_name='Threaded' where number='KS-00021';
   insert into payments(agent_id,amount,received_by) values ('A001',9,'me@x.com');
   insert into audit_log(action,details,email) values ('RECORD_PAYMENT','{}','me@x.com');
   insert into book_history(book_idx,action,by_user) values (3,'issue','me@x.com');
   commit;" >/dev/null
ok "$(P "select count(*) from ticket_history where request_id='req-77'")" "1" "the ticket trail carries it, written by a trigger that was never told about it"
ok "$(P "select count(*) from payments where request_id='req-77'")" "1" "the ledger carries it"
ok "$(P "select count(*) from audit_log where request_id='req-77'")" "1" "the log carries it"
ok "$(P "select count(*) from book_history where request_id='req-77'")" "1" "and the book's custody line"

# MEASURED AS A DELTA, not against a fixed total. desk_money() sums every sale
# in the database that nobody is credited with, so it is not book 1's figure —
# it is the whole office's, and any case above that sells a book across a desk
# moves it. Asserting "expected is 100" made this section depend on the section
# before it being broken: the desk-credit cases were failing on a fixture
# collision, so their ten desk sales were never made, so the total happened to
# be book 1's alone. Fixing them turned three green assertions red without
# anything here changing.
#
# The question this section actually asks is what ONE book of desk sales adds.
# So: empty book 1 out, read the desk, sell it at the desk, read again. The
# difference is the answer, and it stays the answer however many desk sales
# other cases make.
echo "money taken at the desk is counted, paid or not"
P "update config set value='' where key='ACTIVE_TICKETS';
   update books set status='Unassigned', held_by_agent=null, declared_sold=null, amount_due=null, amount_paid=null where idx=1;
   update tickets set status='Available', buyer_name=null, buyer_phone=null, amount=null,
     payment_status=null, sold_at=null, sold_by_agent=null where book_idx=1" >/dev/null
before=$(P "select (desk_money()->>'sold')||'/'||(desk_money()->>'expected')||'/'||(desk_money()->>'collected')")
P "update tickets set status='Sold', buyer_name='Desk '||idx, buyer_phone='0125550'||lpad(idx::text,3,'0'), amount=10,
     payment_status='Paid', sold_at=now(), source='app', sold_by_agent=null where book_idx=1;
   update tickets set payment_status='Unpaid' where number='KS-00001'" >/dev/null
ok "$(P "select (desk_money()->>'sold')::int - ${before%%/*}")" "10" "ten sales out of a book nobody holds"
ok "$(P "select round((desk_money()->>'expected')::numeric - $(echo "$before" | cut -d/ -f2), 2)")" "100.00" "worth RM 100"
ok "$(P "select round((desk_money()->>'collected')::numeric - $(echo "$before" | cut -d/ -f3), 2)")" "90.00" "of which RM 90 was paid at the desk and RM 10 is owed by a named buyer"


# ============ THE SCHEMA MUST ACCEPT THE WRITES THE HANDLERS MAKE ============
#
# This suite applies schema.sql and then exercises the SQL functions, so it
# proved the functions and never the tables the TypeScript handlers write to.
# The gap let the four-state lifecycle sit on the wrong table for a day:
# `agents` had `active` generated from `status` while `app_users` had the plain
# boolean, the exact mirror of production and of what the handlers do. Postgres
# refuses any write to a generated column, so against this repository's own
# schema, adding a seller and editing a seller both failed outright — and
# listing users, admitting one or suspending one failed too, because app_users
# had no `status` to write.
#
# None of it showed anywhere, because schema.sql has never been applied to the
# live project. A fresh environment — a staging restore, a new deployment, a
# contributor running the stack locally — would have got an app whose Sellers
# and Setup screens could not write at all, reported as QUERY_FAILED with
# nothing pointing at the schema.
#
# So these are the literal statements the handlers issue, against the schema
# this file applies. Each names the handler and line it copies.

echo "the schema accepts what upsert_agent writes"
# people.ts:184 — creating a seller.
r=$(P "insert into agents(agent_id,name,phone,zone,active) values ('A900','New Seller','0125559000','KL',true)")
ok "$r" "INSERT 0 1" "a seller can be added"
# people.ts:167 — editing one.
r=$(P "update agents set name='Renamed', phone='0125559001', zone='Klang', active=true where agent_id='A900'")
ok "$r" "UPDATE 1" "and edited"
# And deactivated, which is how an organiser retires somebody.
r=$(P "update agents set active=false where agent_id='A900'")
ok "$r" "UPDATE 1" "and deactivated"
ok "$(P "select active from agents where agent_id='A900'")" "f" "the flag actually moved"
P "delete from agents where agent_id='A900'" >/dev/null

echo "the schema accepts what upsert_user and set_user_status write"
# people.ts — upsertUser builds a row carrying `status`, never `active`.
r=$(P "insert into app_users(email,name,role,status,agent_id,added_by) values ('new@x.com','New','viewer','pending',null,'boss@x.com')")
ok "$r" "INSERT 0 1" "somebody can be staged as pending"
ok "$(P "select active from app_users where email='new@x.com'")" "f" "and is not yet let in"
# setUserStatus writes status alone; `active` follows because it is generated.
r=$(P "update app_users set status='active' where email='new@x.com'")
ok "$r" "UPDATE 1" "letting them in is a status write"
ok "$(P "select active from app_users where email='new@x.com'")" "t" "and the active flag follows on its own"
r=$(P "update app_users set status='banned' where email='new@x.com'")
ok "$r" "UPDATE 1" "and stopping them"
ok "$(P "select active from app_users where email='new@x.com'")" "f" "flips it back"
# people.ts:197 — listUsers selects `status` by name; without the column the
# whole Setup screen fails with a 400 rather than a missing field.
ok "$(P "select count(*) from app_users where status is not null")" "1" "and listUsers can select status by name"
# The lifecycle is only meaningful if the invalid states are refused.
r=$(P "update app_users set status='whatever' where email='new@x.com'")
has "$r" "app_users_status_check" "an invented state is refused by the constraint"
P "delete from app_users where email='new@x.com'" >/dev/null

echo "and the two tables are not confused for each other"
ok "$(P "select is_generated from information_schema.columns where table_name='app_users' and column_name='active'")" "ALWAYS" "app_users.active is derived from its status"
ok "$(P "select is_generated from information_schema.columns where table_name='agents' and column_name='active'")" "NEVER" "agents.active is a plain boolean the handlers write"
ok "$(P "select count(*) from information_schema.columns where table_name='agents' and column_name='status'")" "0" "and an agent has no sign-in lifecycle, because an agent does not sign in"

# ============ THE PRIZE SCHEDULE ============
#
# The half of it that cannot be read off the page. Over-awarding a prize is not
# a bug somebody reports — it is two people holding a receipt for one car — so
# the guard is structural, and structural means the database has to be asked
# whether it really refuses.

echo "the four prize types arrive with the schema"
ok "$(P "select count(*) from prize_types where built_in")" "4" "cash, goods, voucher and a share of the takings"
ok "$(P "select valuing from prize_types where type_id='pot_share'")" "percent" "a split-the-pot prize is valued as a percentage"
# The TYPES are open — an organiser adds one without a migration — and this is
# what that looks like in the table rather than in an argument about it.
r=$(P "insert into prize_types(type_id,label,valuing,added_by) values ('goat','A goat','none','org@x.com')")
ok "$r" "INSERT 0 1" "and an organiser can add a kind nobody thought of"
# What is NOT open is how a value is read, because the code can only read it the
# ways it has branches for.
r=$(P "insert into prize_types(type_id,label,valuing) values ('vibes','Vibes','whatever')")
has "$r" "prize_types_valuing_check" "an invented valuing rule is refused"

echo "a prize is set up once, however many of it there are"
P "insert into prizes(prize_id,tier,name,type_id,value_amount,quantity,rank) values
     ('grand','Grand Prize','Toyota Hilux','goods',120000,1,1),
     ('hampers','Consolation','Hamper','goods',250,10,3)" >/dev/null
ok "$(P "select quantity from prizes where prize_id='hampers'")" "10" "ten hampers are one row saying ten"
ok "$(P "select active from prizes where prize_id='grand'")" "t" "and a new prize is being offered"
# A quantity of nothing is not a prize.
r=$(P "insert into prizes(prize_id,tier,name,type_id,quantity) values ('none','X','Y','goods',0)")
has "$r" "prizes_quantity_check" "a prize given zero times is refused"

echo "a seat that does not exist cannot be filled"
P "update tickets set status='Sold', buyer_name='Buyer', buyer_phone='0125550001' where idx between 1 and 6" >/dev/null
r=$(P "insert into winners(ticket_idx,prize,prize_id,seq) values (1,'Grand','grand',2)")
has "$r" "there is no number 2" "the Grand Prize has one seat, and it is number 1"
r=$(P "insert into winners(ticket_idx,prize,prize_id,seq) values (1,'Consolation','hampers',11)")
has "$r" "there is no number 11" "and ten hampers stop at ten"
r=$(P "insert into winners(ticket_idx,prize,prize_id,seq) values (1,'Ghost','unicorn',1)")
has "$r" "No prize called unicorn" "a prize nobody set up cannot be awarded"

echo "the same seat cannot be filled twice"
P "insert into winners(ticket_idx,prize,prize_id,seq) values (1,'Grand Prize — Toyota Hilux','grand',1)" >/dev/null
ok "$(P "select count(*) from winners where prize_id='grand'")" "1" "the car has gone to somebody"
# THE RACE, which is the reason the seat is a column and not a count: two
# organisers recording winners in the same second both read "none given" and
# both write seat 1. A unique index cannot be read at the wrong moment.
r=$(P "insert into winners(ticket_idx,prize,prize_id,seq) values (2,'Grand','grand',1)")
has "$r" "winners_one_per_seat" "and the second person to reach for it is refused"

echo "one ticket, one prize"
r=$(P "insert into winners(ticket_idx,prize,prize_id,seq) values (1,'Consolation','hampers',1)")
has "$r" "winners_pkey" "a ticket that has won cannot win again"

echo "rows from before the schedule existed do not collide with each other"
# The index is PARTIAL on purpose. A plain unique index would make every winner
# recorded as free text — prize_id null, seq null — collide with the next one,
# so the migration would fail on any raffle that had already drawn anything.
P "insert into winners(ticket_idx,prize) values (3,'First prize'),(4,'Second prize')" >/dev/null
ok "$(P "select count(*) from winners where prize_id is null")" "2" "two typed prizes sit side by side"

echo "a quantity cannot be cut out from under somebody holding one"
P "insert into winners(ticket_idx,prize,prize_id,seq) values (5,'Consolation','hampers',1),(6,'Consolation','hampers',2)" >/dev/null
r=$(P "update prizes set quantity=1 where prize_id='hampers'")
has "$r" "given 2 times already" "two hampers are out, so ten cannot become one"
# Trimming the unclaimed tail is fine — the guard is about people, not numbers.
r=$(P "update prizes set quantity=2 where prize_id='hampers'")
ok "$r" "UPDATE 1" "but the seats nobody holds can go"
# And a seat stranded above the new ceiling is caught even when the count is not:
# seat 2 of 2 is held, so cutting to 1 has to fail on the seat as well.
P "delete from winners where ticket_idx=5" >/dev/null
r=$(P "update prizes set quantity=1 where prize_id='hampers'")
has "$r" "above number 1" "one holder at seat 2 still blocks a cut to one"

echo "a prize somebody holds cannot be deleted out from under them"
r=$(P "delete from prizes where prize_id='grand'")
has "$r" "violates foreign key" "the row that names it stops the delete"

echo "a forfeited prize is still on the record"
P "update winners set forfeited_at=now() where prize_id='grand'" >/dev/null
ok "$(P "select count(*) from winners where prize_id='grand'")" "1" "the draw that happened is not erased"
ok "$(P "select count(*) from winners where prize_id='grand' and forfeited_at is null")" "0" "but nobody is holding the car"

echo "the browser can read the prizes and nothing else new"
ok "$(P "select count(*) from information_schema.role_table_grants where grantee='authenticated' and table_name='prizes' and privilege_type='SELECT'")" "1" "a signed-in person may read what is on offer"
ok "$(P "select count(*) from information_schema.role_table_grants where grantee='authenticated' and table_name='prizes' and privilege_type='UPDATE'")" "0" "and may not change it"
ok "$(P "select count(*) from information_schema.role_table_grants where grantee='anon' and table_name in ('prizes','prize_types')")" "0" "a request with no session gets nothing"
ok "$(P "select count(*) from information_schema.role_table_grants where grantee='authenticated' and table_name='winners'")" "0" "and the winners table, which carries telephone numbers, stays shut"

# ============ WHAT A RAFFLE IS SET UP AS ============
#
# The half of removing the Apps Script backend that had to exist BEFORE it went:
# a Supabase project built from nothing used to have an EMPTY config table,
# because every config row in production arrived through the one-off migration
# out of the Sheet. `expand_tickets` would have generated ten thousand tickets
# numbered 1 to 10000 with no prefix and no padding.

echo "a project built from nothing knows how to number a ticket"
ok "$(P "select count(*) from config")" "26" "the defaults are seeded"
ok "$(P "select value from config where key='TICKET_PREFIX'")" "KS-" "there is a prefix to build a number from"
ok "$(P "select value from config where key='TICKET_DIGITS'")" "5" "and a width to pad it to"
# BLANK, and that is the guarantee, not an oversight: a raffle that has not set
# a logo shows NO logo rather than somebody else's. This was asserted against
# Config.gs by orgidentity.test.mjs; this is where it lives now.
ok "$(P "select count(*) from config where key in ('ORG_LOGO','ORG_LOGO_SMALL','BRAND_COLOR') and value=''")" "3" "and no branding it did not choose"
# Re-running the seed must not restate a raffle that is already running.
P "update config set value='Spring Draw 2026' where key='EVENT_NAME'" >/dev/null
APPLY supabase/schema.sql >/dev/null 2>&1
ok "$(P "select value from config where key='EVENT_NAME'")" "Spring Draw 2026" "and applying it twice does not overwrite a live raffle"

echo "the numbering cannot change under tickets that are already printed"
# Nothing is stopping an organiser editing config in the Supabase dashboard —
# there is no set_config action at all — so the guard has to be in the database.
r=$(P "update config set value='ZZ-' where key='TICKET_PREFIX'")
has "$r" "cannot change once tickets exist" "the prefix is refused"
for k in TICKET_START TICKET_DIGITS TICKETS_PER_BOOK BOOK_PREFIX BOOK_DIGITS; do
  r=$(P "update config set value='9' where key='$k'")
  has "$r" "cannot change once tickets exist" "$k is refused"
done
# The message has to say what actually happens, because nothing throws when it
# is wrong — the stored numbers simply stop matching the recomputed ones.
has "$r" "stops them matching" "and says what going wrong would look like"

echo "but the raffle can still grow, which is the one that has to stay possible"
before=$(P "select value from config where key='TOTAL_TICKETS'")
r=$(P "update config set value='500' where key='TOTAL_TICKETS'")
ok "$r" "UPDATE 1" "TOTAL_TICKETS may be raised — expand_tickets does exactly this"
r=$(P "update config set value='10' where key='TOTAL_TICKETS'")
has "$r" "cannot be reduced" "and may not be lowered"
has "$r" "including ones already sold" "because lowering it silently unmakes sold tickets"
P "update config set value='$before' where key='TOTAL_TICKETS'" >/dev/null 2>&1
# A write that changes nothing is not a change. settle_book and friends rewrite
# config rows wholesale; if a no-op tripped the lock, every one of them would
# fail the moment a ticket existed.
r=$(P "update config set value=value where key='TICKET_PREFIX'")
ok "$r" "UPDATE 1" "and rewriting a locked key with its own value is not a change"
# Everything else stays editable — the lock is about numbering, not about config.
r=$(P "update config set value='Autumn Draw' where key='EVENT_NAME'")
ok "$r" "UPDATE 1" "the keys that are not numbering are still editable"

echo "money follows the sale, not whoever is holding the paper"
# THE ASSERTION THAT WOULD HAVE CAUGHT IT ON DAY ONE, and did not exist.
#
# Every balance used to be keyed on books.held_by_agent, which is right only
# while custody and selling are the same person. It failed four times in three
# shapes: a book returned and then sold at the office charged the ex-holder, a
# book sold at the desk and issued afterwards charged the new holder. RM400
# across two volunteers, found by somebody looking at a screen.
#
# Measured as a DELTA rather than an absolute. By this point in the file A002
# has sold tickets from several earlier cases, and an assertion on their total
# would be pinning the sum of everything above it — which fails for reasons
# that have nothing to do with what it is testing.
a002_before=$(P "select coalesce(expected,0) from agent_money where agent_id='A002'")
desk_before=$(P "select (desk_money()->>'expected')::numeric")
# Every ticket in book 5, whatever it was before, becomes a desk sale: the book
# stays with A002 and not one ringgit of it is theirs. Written over the whole
# book rather than only the untouched rows, because by here some are already
# sold and the interesting case is money MOVING off a holder, not merely never
# landing on them.
P "update tickets set status='Sold', sold_by_agent=null, amount=10,
     payment_status='Paid', sold_at=now() where book_idx=5;" >/dev/null
ok "$(P "select coalesce(expected,0) from agent_money where agent_id='A002'")" \
   "$(P "select ( (select coalesce(sum(t.amount),0) from tickets t join books b on b.idx=t.book_idx
                   where t.sold_by_agent='A002' and t.status in ('Sold','Donated')
                     and t.idx <= active_tickets()
                     and not (b.status in ('Settled','Lost') and b.declared_sold is not null))
                 + (select coalesce(sum(b.amount_due),0) from books b
                     where b.settled_by_agent='A002' and b.status in ('Settled','Lost')
                       and b.declared_sold is not null) )::numeric(12,2)")" \
   "a holder is charged for exactly what they sold and what they settled, and no more"
ok "$(P "select ((desk_money()->>'expected')::numeric - $desk_before) >= 0")" "t" \
   "and what nobody sold went to the desk rather than to whoever held the book"

# EVERY RINGGIT IS ON EXACTLY ONE BALANCE: a seller's, or the desk's. Not both,
# and not neither.
#
# COMPARED AGAINST THE TWO REGIMES, not against the raw ticket rows. A settled
# book may declare more than its tickets show — that is what unidentified_sold
# is for, money the seller counted with no number written down — so summing
# tickets alone is not the total the raffle expects, and an identity written
# that way fails on a perfectly correct database. The first version of this case
# did exactly that and reported a 40.00 gap that was not a gap.
#
# Its limit, said plainly because a test nobody can see the edge of is worse
# than none: this catches money on NO balance or on TWO. It cannot catch money
# on the WRONG one — a ticket credited to the wrong seller still sums correctly.
# What it closes is the class where a figure quietly stops being counted, which
# is what a returned book's money did for six days.
ok "$(P "select (select coalesce(sum(expected),0) from agent_money)
           + (desk_money()->>'expected')::numeric
           - ( (select coalesce(sum(t.amount),0) from tickets t join books b on b.idx=t.book_idx
                 where t.status in ('Sold','Donated') and t.idx <= active_tickets()
                   and not (b.status in ('Settled','Lost') and b.declared_sold is not null))
             + (select coalesce(sum(b.amount_due),0) from books b
                 where b.status in ('Settled','Lost') and b.declared_sold is not null) )")" "0.00" \
   "every ringgit of sold ticket is on exactly one balance"

# A SETTLED BOOK'S MONEY IS FROZEN TO WHOEVER SETTLED IT, so moving the paper
# afterwards cannot move money already accounted for. This is the property the
# new column exists for: without it the view would read custody a second time
# and the bug would come back through a different door.
settled_before=$(P "select coalesce(expected,0) from agent_money where agent_id='AM'")
P "update books set held_by_agent=null where idx=3" >/dev/null
ok "$(P "select coalesce(expected,0) from agent_money where agent_id='AM'")" "$settled_before" \
   "clearing the holder of a settled book does not move its money"
P "update books set held_by_agent='AM' where idx=3" >/dev/null


# ============ A PROJECT BUILT BY FOLLOWING THE README ============
#
# Everything above runs against a database this file built its own way. That
# proves the SQL works; it does not prove the INSTRUCTIONS do, and for most of
# the time this suite has existed they did not.
#
# SETUP.md said: schema.sql, then `supabase db push`, then functions.sql, then
# rls.sql. Six migrations call app_role() or read book_ledger_all and
# config_readable, and every one of those lives in rls.sql — two steps later. A
# project built by following the README stopped with "function app_role() does
# not exist", which reads like a broken migration and is really a build run out
# of order. Nothing here noticed, because nothing here had ever applied a
# migration: this file goes straight from schema.sql to functions.sql.
#
# Production was never affected. It was built incrementally, a migration at a
# time, with rls.sql re-applied along the way — so the order it happened to go
# in was a working one. The exposure was a staging restore, a contributor
# setting up locally, or anybody rebuilding after a loss, which is exactly when
# a broken build is most expensive.
#
# So: a SECOND, empty database, built in the order SETUP.md now gives, from the
# files as they stand. It is the only case here that runs the migrations at all.
echo "two tills cannot sell the same ticket"
# THE RACE THIS CLOSES. Both bulk paths judge every ticket and then write the
# ones that passed. Before the lock, a second session read 'Available' behind
# the first session's uncommitted sale, passed its own check, blocked on the
# write, and then overwrote the first buyer's name and phone the moment the
# first committed. One ticket, two buyers, and only the second could be
# telephoned at the draw.
#
# So: session A sells a ticket and HOLDS the transaction open for three seconds.
# Session B tries the same ticket one second in. B must wait for the row, see
# the sale once A commits, and refuse — not queue behind a stale read.
P "update books set status='Unassigned', held_by_agent=null where idx=5" >/dev/null
P "update tickets set status='Available', buyer_name='', buyer_phone='', sold_by_agent=null where book_idx=5" >/dev/null
PBG "begin; select bulk_record_sales('[{\"ticketNumber\":\"KS-00041\",\"buyerName\":\"First In\",\"buyerPhone\":\"0125550201\"}]'::jsonb,'a@x.com','admin',null,false); select pg_sleep(3); commit;"
sleep 1
r=$(P "select bulk_record_sales('[{\"ticketNumber\":\"KS-00041\",\"buyerName\":\"Second In\",\"buyerPhone\":\"0125550202\"}]'::jsonb,'b@x.com','admin',null,false)")
wait
has "$r" "ALREADY_SOLD" "the second till is refused rather than overwriting"
ok "$(P "select buyer_name from tickets where number='KS-00041'")" "First In" "the buyer who got there first is the one on the ticket"
ok "$(P "select count(*) from ticket_history where ticket_idx=41 and to_status='Sold' and to_buyer in ('First In','Second In')")" "1" "and exactly one of the two tills wrote a buyer"

echo "and neither can two whole-book sales"
P "update books set status='Unassigned', held_by_agent=null where idx=5" >/dev/null
P "update tickets set status='Available', buyer_name='', buyer_phone='', sold_by_agent=null where book_idx=5" >/dev/null
PBG "begin; select sell_books('Book-0005',null,null,'Book First','0125550203','',false,'a@x.com','admin',null,null); select pg_sleep(3); commit;"
sleep 1
r=$(P "select sell_books('Book-0005',null,null,'Book Second','0125550204','',false,'b@x.com','admin',null,null)")
wait
has "$r" "already sold" "the second seller is told every stub had gone"
ok "$(P "select count(distinct buyer_name) from tickets where book_idx=5 and status='Sold'")" "1" "one buyer for the whole book, not two"
ok "$(P "select buyer_name from tickets where number='KS-00041'")" "Book First" "and it is the one who got there first"
P "update books set status='Out', held_by_agent='A002' where idx=5" >/dev/null

echo "a book that is not whole cannot be sold whole"
# WHAT THIS STOPS. sell_books skipped tickets that were already sold and sold
# the rest, so a book with 8 of its 10 gone was sold "whole" to somebody who got
# two stubs. The sale reported 2 sold and 8 skipped and nobody read it; the
# screen offered the button as though the book were untouched.
#
# A whole-book sale is one act, one buyer, one price, one receipt. Selling the
# caller the remainder answers a different question from the one they asked.
P "update books set status='Unassigned', held_by_agent=null, offered_to_agent=null where idx=3" >/dev/null
P "update tickets set status='Available', buyer_name='', buyer_phone='', sold_by_agent=null, amount=null, payment_status='', sold_at=null where book_idx=3" >/dev/null
# One ticket sold out of ten is enough to make it not whole.
P "select bulk_record_sales('[{\"ticketNumber\":\"KS-00021\",\"buyerName\":\"Early Bird\",\"buyerPhone\":\"0125550301\"}]'::jsonb,'me@x.com','admin',null,false)" >/dev/null
ok "$(P "select count(*) from tickets where book_idx=3 and status='Sold'")" "1" "one of its ten is gone"
r=$(P "select sell_books('Book-0003',null,null,'Whole Buyer','0125550302','',false,'me@x.com','admin',null,null)")
has "$r" "BOOK_NOT_WHOLE" "the whole-book sale is refused"
has "$r" "1 of its tickets are already sold" "and it says how many, so the number is not a guess"
ok "$(P "select count(*) from tickets where book_idx=3 and buyer_name='Whole Buyer'")" "0" "nothing was sold to the buyer who asked for a book"
ok "$(P "select buyer_name from tickets where number='KS-00021'")" "Early Bird" "and the ticket that was already gone is untouched"

echo "but a book nobody has sold from still sells whole"
P "update tickets set status='Available', buyer_name='', buyer_phone='', sold_by_agent=null, amount=null, payment_status='', sold_at=null where book_idx=3" >/dev/null
r=$(P "select sell_books('Book-0003',null,null,'Whole Buyer','0125550302','',false,'me@x.com','admin',null,null)")
ok "$(P "select count(*) from tickets where book_idx=3 and buyer_name='Whole Buyer'")" "10" "all ten go to the one buyer"
P "update books set status='Out', held_by_agent='A001' where idx=3" >/dev/null

echo "a book offered is a book on nobody's balance"
# THE HANDSHAKE THAT ONLY EXISTED IN ONE DIRECTION. A seller could ASK for books
# and an organiser granted it. An organiser giving books out needed nobody's
# agreement: held_by_agent named the seller, so the money was theirs, they were
# on the chase list when it went overdue, and the settle screen asked them to
# account for stock they might never have touched. A mistyped seller was liable.
#
# So an offer reserves and moves nothing. The assertion that matters is not the
# status — it is that the money views cannot see it, because held_by_agent is
# what every one of them reads.
P "update books set status='Unassigned', held_by_agent=null, offered_to_agent=null where idx in (4,5)" >/dev/null
before=$(P "select count(*) from book_ledger_all where held_by_agent='A001'")
P "select offer_books_tx(array[4,5],'A001',current_date+7,'org@x.com')" >/dev/null
ok "$(P "select status from books where idx=4")" "Offered" "the book is Offered"
ok "$(P "select coalesce(held_by_agent,'-') from books where idx=4")" "-" "and on nobody's balance, which is the point"
ok "$(P "select offered_to_agent from books where idx=4")" "A001" "reserved for the seller it was offered to"
ok "$(P "select count(*) from book_ledger_all where held_by_agent='A001'")" "$before" "and the money views are unmoved by an offer"

echo "and it cannot be offered twice, or to two sellers at once"
# Book 6's state is READ, not assumed. Written as a literal it said 'Out', which
# was true of book 6 several hundred lines earlier and is 'Settled' by the time
# the suite reaches here — a test that has to be right about unrelated state is
# a test that goes red for reasons that are nothing to do with it.
was6=$(P "select status from books where idx=6")
r=$(P "select offer_books_tx(array[5,6],'A002',current_date+7,'org@x.com')")
has "$r" "BOOKS_NOT_FREE" "a second offer over a reserved book is refused"
ok "$(P "select offered_to_agent from books where idx=5")" "A001" "the reserved book still belongs to the first offer"
ok "$(P "select status from books where idx=6")" "$was6" "and the other book in that batch is untouched — all or nothing"

echo "only the seller it was offered to can accept it"
r=$(P "select accept_offer_tx(array[4],'A002','manu@x.com')")
has "$r" "NOT_OFFERED_TO_YOU" "somebody else accepting is refused"
ok "$(P "select status from books where idx=4")" "Offered" "and the offer is still standing"

echo "accepting is the moment the money becomes theirs"
P "select accept_offer_tx(array[4,5],'A001','pathang@x.com')" >/dev/null
ok "$(P "select status from books where idx=4")" "Out" "the book goes Out"
ok "$(P "select held_by_agent from books where idx=4")" "A001" "held by the seller who accepted"
ok "$(P "select coalesce(offered_to_agent,'-') from books where idx=4")" "-" "and the reservation is cleared"
ok "$(P "select count(*) from book_ledger_all where held_by_agent='A001'")" "$((before + 2))" "NOW the money views carry them"
ok "$(P "select count(*) from book_history where book_idx=4 and action='offer'")" "1" "the offer is in the book's history"
ok "$(P "select count(*) from book_history where book_idx=4 and action='issue'")" "1" "and so is the acceptance"

echo "an offer that ends without being accepted puts the book back"
P "update books set status='Unassigned', held_by_agent=null where idx in (4,5)" >/dev/null
P "select offer_books_tx(array[4],'A001',current_date+7,'org@x.com')" >/dev/null
# NAMED WITH BOOKS THAT WERE NEVER OFFERED, on purpose. Releasing by re-reading
# "which books are Unassigned now" instead of by RETURNING would free-and-log
# every book that was already on the shelf. Two of the three below are.
ok "$(P "select release_offer_tx(array[4,5,6],'org@x.com','declined')")" "1" "only the book that was actually offered is released"
ok "$(P "select status from books where idx=4")" "Unassigned" "back on the shelf"
ok "$(P "select coalesce(due_at::text,'-') from books where idx=4")" "-" "with the due date cleared, so it is not born overdue"
ok "$(P "select count(*) from book_history where action='release'")" "1" "and exactly one release written, not three"

echo "the database itself refuses an offered book on somebody's balance"
# A CONSTRAINT RATHER THAN A HABIT. Every money view reads held_by_agent, so
# this one column being null is what makes all of them correct without knowing
# the feature exists. A future edit that sets both is refused by Postgres.
r=$(P "update books set status='Offered', held_by_agent='A001' where idx=4")
has "$r" "books_offered_is_on_nobodys_balance" "setting both is refused"
P "update books set status='Out', held_by_agent='A002', offered_to_agent=null where idx in (4,5)" >/dev/null

echo "a project built by following SETUP.md comes up"
if [ "$MODE" = docker ]; then
  docker exec "$NAME" psql -U postgres -d postgres -q -c "create database cleanbuild" >/dev/null 2>&1
  C()  { docker exec "$NAME" psql -U postgres -d cleanbuild -tAc "$1" 2>&1; }
  CA() { docker cp "$1" "$NAME":/tmp/c.sql >/dev/null && docker exec "$NAME" psql -U postgres -d cleanbuild -q -v ON_ERROR_STOP=1 -f /tmp/c.sql 2>&1; }
else
  CLEAN="${DB}_clean"
  # shellcheck disable=SC2064
  trap "psql -d postgres -q -c 'drop database if exists $CLEAN' >/dev/null 2>&1; cleanup" EXIT
  psql -d postgres -q -c "create database $CLEAN" >/dev/null 2>&1
  C()  { psql -d "$CLEAN" -tAc "$1" 2>&1; }
  CA() { psql -d "$CLEAN" -q -v ON_ERROR_STOP=1 -f "$1" 2>&1; }
fi

# THE PLATFORM'S HALF, stubbed. realtime.send, realtime.messages and
# realtime.topic are Supabase's, not this repository's, and a bare Postgres has
# none of them — so two migrations fail here for a reason that says nothing
# about our SQL. Stubbing them keeps those migrations IN the check: what is
# being asserted is that our statements parse and apply against the objects
# Supabase provides, which is the part we can get wrong.
C "create schema if not exists realtime;
   create table if not exists realtime.messages(topic text, extension text, payload jsonb);
   alter table realtime.messages enable row level security;
   create or replace function realtime.topic() returns text as \$\$ select ''::text \$\$ language sql stable;
   create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default false)
     returns void as \$\$ begin end \$\$ language plpgsql;" >/dev/null
C "do \$\$ begin
     if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
     if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
   end \$\$;" >/dev/null

broke=""
for f in supabase/schema.sql supabase/functions.sql supabase/rls.sql; do
  out=$(CA "$f") || { broke="$f"; break; }
done
if [ -z "$broke" ]; then
  pass=$((pass+1))
else
  fail=$((fail+1))
  echo "  FAIL SETUP.md step 3: $broke would not apply to an empty project"
  echo "$out" | grep -o 'ERROR:.*' | head -2 | sed 's/^/    /'
fi

# `supabase db push`, one file at a time, in the order the CLI takes them. Named
# individually when they fail: "a migration failed" sends somebody to thirty
# files, and the one that stopped the build is the whole of the information.
#
# AND THE ONES STILL WAITING. supabase/migrations.pending holds a migration
# while it is being written and reviewed, because `db push` reads the
# migrations DIRECTORY rather than git and a finished-but-uncommitted file in
# there is one the next push applies to the live fundraiser. The point of the
# waiting room is that it is checked BEFORE it is committed, and checking it
# only once it moves across is checking it one step too late.
bad=0
for m in supabase/migrations/*.sql supabase/migrations.pending/*.sql; do
  [ -f "$m" ] || continue
  out=$(CA "$m") || {
    bad=$((bad+1))
    [ "$bad" = 1 ] && echo "  FAIL a migration would not apply to a project built by following SETUP.md"
    echo "    $(basename "$m"): $(echo "$out" | grep -o 'ERROR:.*' | head -1)"
  }
done
if [ "$bad" = 0 ]; then
  pass=$((pass+1)); echo "  every migration applies to a project built this way"
else
  fail=$((fail+1))
fi

# AND IT IS THE SAME DATABASE, not merely one that did not error. These are the
# three things the drift between functions.sql and the migrations could silently
# get wrong, checked on the build rather than on the files.
ok "$(C "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sell_books'")" "1" \
   "one sell_books, so a sale is not ambiguous between two signatures"
ok "$(C "select bool_or(pg_get_functiondef(p.oid) ~ 'settled_by_agent') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='settle_book'")" "t" \
   "and it can write down who a settled book's money belongs to"
ok "$(C "select count(*) from information_schema.columns where table_name='books' and column_name='settled_by_agent'")" "1" \
   "with a column for it to write to"
ok "$(C "select count(*) from information_schema.views where table_schema='public' and table_name in ('agent_money','book_ledger_all','book_ledger')")" "3" \
   "the three money views survived the push that replaces them"
ok "$(C "select count(*) from config")" "26" \
   "and the raffle knows how to number a ticket"

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
