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

echo "an agent sees only the books they carry"
# A001 holds books 1-2, which is tickets 1-20. Books 3-6 are A002's.
ok "$(AS 'a1@x.com' 'select count(*) from tickets_readable')" "20" "only their own two books"
ok "$(AS 'a1@x.com' "select count(*) from tickets_readable where book_idx=3")" "0" "not another agent's book"
ok "$(AS 'a1@x.com' 'select count(*) from book_ledger')" "2" "and only their books in the ledger"

echo "phone numbers are masked for a view-only account"
ok "$(AS 'view@x.com' "select buyer_phone from tickets_readable where number='KS-00001'")" "012****01" "a viewer gets a masked number"
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
