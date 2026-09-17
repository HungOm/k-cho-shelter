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

NAME=kcho-sqltest
PORT=55434
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
P "insert into config(key,value) values
     ('TOTAL_TICKETS','50'),('TICKETS_PER_BOOK','10'),('TICKET_PRICE','10'),('ACTIVE_TICKETS','');
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

echo "a whole-book sale skips rather than overwrites"
r=$(P "select sell_books('Book-0001',null,null,'Ma Hlaing','0125550999','',false,'admin@x.com','admin',null)")
has "$r" '"sold": 8'      "eight of ten sold"
has "$r" "already sold"   "and the other two reported as already sold"
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

echo "sold by count with no numbers is money, and the ledger says how many cannot be drawn"
P "update books set status='Out', held_by_agent='A002', declared_sold=null, amount_due=null, amount_paid=null where idx=4;
   update tickets set status='Available', buyer_name='', buyer_phone='', source='', sold_by_agent=null, amount=null, payment_status='' where book_idx=4" >/dev/null
r=$(P "select settle_book('Book-0004','[]'::jsonb,60,true,6,false,'me@x.com','stubs lost')")
has "$r" '"declaredSold": 6' "six declared"
ok "$(P "select unidentified_sold from book_ledger_all where idx=4")" "6" "none of them identified"
ok "$(P "select round(unidentified_amount) from book_ledger_all where idx=4")" "60" "worth RM 60 the draw cannot include"
ok "$(P "select round(counted_expected) from book_ledger_all where idx=4")" "60" "and still expected in full — the money is real"

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
   update books set status='Settled', held_by_agent='AM', declared_sold=8, amount_due=80, amount_paid=55 where idx=3;
   delete from payments where agent_id='AM';
   insert into payments(agent_id,amount,source,note) values ('AM',12.35,'hand','part'),('AM',7.65,'writeoff','gone away and not coming back')" >/dev/null
ok "$(P "select expected||'/'||collected||'/'||written_off||'/'||outstanding from agent_money where agent_id='AM'")" "80.00/67.35/7.65/5.00" "expected, cash, forgiven and the gap"
ok "$(P "select (select outstanding from agent_money where agent_id='AM') = (
             (select coalesce(sum(counted_expected),0) from book_ledger_all where held_by_agent='AM')
           - (select coalesce(sum(counted_collected),0) from book_ledger_all where held_by_agent='AM')
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

echo "money taken at the desk is counted, paid or not"
P "update config set value='' where key='ACTIVE_TICKETS';
   update books set status='Unassigned', held_by_agent=null, declared_sold=null, amount_due=null, amount_paid=null where idx=1;
   update tickets set status='Sold', buyer_name='Desk '||idx, buyer_phone='0125550'||lpad(idx::text,3,'0'), amount=10,
     payment_status='Paid', sold_at=now(), source='app', sold_by_agent=null where book_idx=1;
   update tickets set payment_status='Unpaid' where number='KS-00001'" >/dev/null
r=$(P "select desk_money()")
has "$r" '"sold": 10' "ten sales out of a book nobody holds"
has "$r" '"expected": 100' "worth RM 100"
has "$r" '"collected": 90' "of which RM 90 was paid at the desk and RM 10 is owed by a named buyer"


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

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
