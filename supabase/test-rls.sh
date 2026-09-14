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

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running — skipping."
  exit 0
fi

NAME=kcho-rlstest
pass=0; fail=0
ok() { if [ "$1" = "$2" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "  FAIL $3"; echo "    got:  $1"; echo "    want: $2"; fi; }

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "Starting Postgres…"
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=t -e POSTGRES_DB=kcho -p 55435:5432 postgres:16 >/dev/null
for _ in $(seq 1 60); do docker exec "$NAME" psql -U postgres -d kcho -c "select 1" >/dev/null 2>&1 && break; sleep 1; done

for f in schema.sql functions.sql rls.sql; do docker cp "supabase/$f" "$NAME":/tmp/ >/dev/null; done
docker exec "$NAME" psql -U postgres -d kcho -q -v ON_ERROR_STOP=1 -f /tmp/schema.sql    >/dev/null 2>&1 || { echo "schema failed"; exit 1; }
docker exec "$NAME" psql -U postgres -d kcho -q -v ON_ERROR_STOP=1 -f /tmp/functions.sql >/dev/null 2>&1 || { echo "functions failed"; exit 1; }
docker exec "$NAME" psql -U postgres -d kcho -q -v ON_ERROR_STOP=1 -f /tmp/rls.sql       >/dev/null 2>&1 || { echo "rls failed"; exit 1; }

# PostgREST connects as a role called `authenticated`; recreate that here so the
# policies are exercised as they will be in production rather than as superuser,
# who bypasses row security entirely and would make every test pass.
docker exec "$NAME" psql -U postgres -d kcho -q -c "
  create role authenticated nologin;
  grant usage on schema public to authenticated;
  grant select on tickets_readable, book_ledger, agents_readable, config_readable to authenticated;
  grant execute on all functions in schema public to authenticated;" >/dev/null 2>&1

docker exec "$NAME" psql -U postgres -d kcho -q -c "
  insert into config(key,value) values
    ('TOTAL_TICKETS','60'),('TICKETS_PER_BOOK','10'),('TICKET_PRICE','10'),('ACTIVE_TICKETS','30');
  insert into agents(agent_id,name,phone) values ('A001','Pa Thang','0125551111'),('A002','Ma Nu','0125552222');
  insert into books(idx,number,first_ticket,last_ticket,status,held_by_agent)
    select g,'Book-'||lpad(g::text,4,'0'),'KS-'||lpad(((g-1)*10+1)::text,5,'0'),
           'KS-'||lpad((g*10)::text,5,'0'),'Out', case when g<=2 then 'A001' else 'A002' end
    from generate_series(1,6) g;
  insert into tickets(idx,number,book_idx,status,buyer_name,buyer_phone,amount,sold_at)
    select i,'KS-'||lpad(i::text,5,'0'),ceil(i/10.0),'Sold','Buyer '||i,'0125550'||lpad((100+i)::text,3,'0'),10,now()
    from generate_series(1,60) i;
  insert into app_users(email,name,role,active,agent_id) values
    ('admin@x.com','Admin','admin',true,null),
    ('view@x.com','Viewer','viewer',true,null),
    ('a1@x.com','Agent One','agent',true,'A001'),
    ('off@x.com','Disabled','admin',false,null);" >/dev/null 2>&1

# Runs a query as `authenticated` with a given email in the JWT claims.
AS() {
  local email="$1" sql="$2" claims
  if [ -z "$email" ]; then claims='{}'; else claims="{\"email\":\"$email\"}"; fi
  docker exec "$NAME" psql -U postgres -d kcho -tAc \
    "begin;
     select set_config('request.jwt.claims', '$claims', true);
     set local role authenticated;
     $sql" 2>&1 | tail -1
}

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
  out="$(docker exec "$NAME" psql -U postgres -d kcho -tAc \
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
docker exec "$NAME" psql -U postgres -d kcho -tAc \
  "insert into app_users(email,name,role,active) values ('super2@x.com','Second','superadmin',true)" >/dev/null
ok "$(AS 'super2@x.com' 'select app_role()')" "admin" "app_role resolves superadmin to admin"
ok "$(AS 'super2@x.com' 'select count(*) from tickets_readable')" "30" "and they see every ticket in play"
ok "$(AS 'super2@x.com' "select buyer_phone from tickets_readable where number='KS-00001'")" "0125550101" "with phone numbers unmasked, as an admin"
ok "$(AS 'super2@x.com' 'select count(*) from book_ledger')" "3" "and every book in play"
docker exec "$NAME" psql -U postgres -d kcho -tAc \
  "delete from app_users where email='super2@x.com'" >/dev/null

echo "the base tables are not reachable at all"
# The masking only means something if the unmasked table is out of reach.
denied 'view@x.com'  'select buyer_phone from tickets limit 1' "a viewer could read the tickets table directly"
denied 'admin@x.com' 'select count(*) from app_users'          "an admin could read app_users directly"
denied 'admin@x.com' 'select count(*) from audit_log'          "an admin could read the audit log directly"
denied 'admin@x.com' 'select count(*) from pending_approvals'  "an admin could read the approvals queue directly"
denied 'admin@x.com' 'select count(*) from permissions'        "an admin could read the permissions table directly"

echo "nobody can write through the browser path"
denied 'admin@x.com' "update tickets set buyer_name='hacked' where idx=1" "an admin could write directly"
denied 'admin@x.com' "delete from tickets where idx=1"                    "an admin could delete directly"
denied 'admin@x.com' "insert into tickets(idx,number,book_idx) values (999,'X',1)" "an admin could insert directly"
denied 'admin@x.com' "update config set value='99' where key='ACTIVE_TICKETS'" "an admin could change config directly"
ok "$(docker exec "$NAME" psql -U postgres -d kcho -tAc "select buyer_name from tickets where idx=1")" "Buyer 1" "and the row is untouched"

echo "releasing more tickets widens what is readable"
docker exec "$NAME" psql -U postgres -d kcho -q -c "update config set value='60' where key='ACTIVE_TICKETS'" >/dev/null
ok "$(AS 'admin@x.com' 'select count(*) from tickets_readable')" "60" "the whole raffle once released"

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
