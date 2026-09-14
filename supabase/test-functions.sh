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
   insert into agents(agent_id,name) values ('A001','Pa Thang'),('A002','Ma Nu');
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

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
