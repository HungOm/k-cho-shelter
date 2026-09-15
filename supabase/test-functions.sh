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

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running — skipping. These are integration tests; the rest"
  echo "of the suite (./tests/run.sh) does not need it."
  exit 0
fi

NAME=kcho-sqltest
PORT=55434
pass=0; fail=0
ok()  { if [ "$1" = "$2" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "  FAIL $3"; echo "    got:  $1"; echo "    want: $2"; fi; }
has() { if grep -q "$2" <<<"$1"; then pass=$((pass+1)); else fail=$((fail+1)); echo "  FAIL $3"; echo "    got: $1"; fi; }

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "Starting Postgres…"
cleanup
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=t -e POSTGRES_DB=kcho -p $PORT:5432 postgres:16 >/dev/null
for _ in $(seq 1 60); do
  docker exec "$NAME" psql -U postgres -d kcho -c "select 1" >/dev/null 2>&1 && break
  sleep 1
done

P() { docker exec "$NAME" psql -U postgres -d kcho -tAc "$1" 2>&1; }

docker cp supabase/schema.sql    "$NAME":/tmp/ >/dev/null
docker cp supabase/functions.sql "$NAME":/tmp/ >/dev/null
docker exec "$NAME" psql -U postgres -d kcho -q -v ON_ERROR_STOP=1 -f /tmp/schema.sql    >/dev/null 2>&1 || { echo "schema.sql failed"; exit 1; }
docker exec "$NAME" psql -U postgres -d kcho -q -v ON_ERROR_STOP=1 -f /tmp/functions.sql >/dev/null 2>&1 || { echo "functions.sql failed"; exit 1; }

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
ok "$(P "select round(counted_expected-counted_collected) from book_ledger where idx=5")" "60" "and the ledger says so"
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


echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1