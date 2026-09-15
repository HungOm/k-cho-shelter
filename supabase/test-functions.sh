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
ok "$(P "select round(counted_expected) from book_ledger where idx=2")" "30" "three sold: RM 30 expected while the book is out"
P "update books set status='Lost', notes='seller says lost' where idx=2" >/dev/null
ok "$(P "select round(counted_expected) from book_ledger where idx=2")" "30" "still RM 30 once it is marked lost — the sales did not stop existing"
ok "$(P "select counted_sold from book_ledger where idx=2")" "3" "and the three sales are still counted"
ok "$(P "select unidentified_sold from book_ledger where idx=2")" "0" "with nothing unidentified, because nothing was declared"

echo "sold by count with no numbers is money, and the ledger says how many cannot be drawn"
P "update books set status='Out', held_by_agent='A002', declared_sold=null, amount_due=null, amount_paid=null where idx=4;
   update tickets set status='Available', buyer_name='', buyer_phone='', source='', sold_by_agent=null, amount=null, payment_status='' where book_idx=4" >/dev/null
r=$(P "select settle_book('Book-0004','[]'::jsonb,60,true,6,false,'me@x.com','stubs lost')")
has "$r" '"declaredSold": 6' "six declared"
ok "$(P "select unidentified_sold from book_ledger where idx=4")" "6" "none of them identified"
ok "$(P "select round(unidentified_amount) from book_ledger where idx=4")" "60" "worth RM 60 the draw cannot include"
ok "$(P "select round(counted_expected) from book_ledger where idx=4")" "60" "and still expected in full — the money is real"

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

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
