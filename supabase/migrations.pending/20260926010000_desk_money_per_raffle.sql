/*
 * MULTI-TENANCY STAGE 2 (MT-2d, first of the twelve): desk_money.
 *
 * D-021's shape: a sibling overload named p_project carries the body, the old
 * zero-argument form delegates with the coalesce. Kept deliberately consistent
 * with active_tickets, because the scoped client's rpc() injects p_project by
 * NAME into every call once it is wired in (Stage 2's MT-2b), and PostgREST
 * resolves overloads by named arguments — a different parameter name would be
 * a second, silently unreachable overload.
 *
 * closed_desk HAD NO project_id PREDICATE AT ALL before this fix, and unlike
 * open_desk it has no idx ceiling to accidentally protect it either — a desk
 * sale settled in another organisation's raffle summed straight into this
 * one's "money that never had a seller" figure. Proved in test-functions.sh
 * by capturing this raffle's desk_money() before a second project's settled
 * book exists and asserting it is unchanged after; red-checked by removing the
 * predicate and watching the total absorb the other raffle's numbers.
 *
 * ONE CALLER, api/money.ts:236, unchanged: `rpc('desk_money', {})` still
 * resolves to the wrapper until MT-2b wires the scoped client in.
 *
 * NOT APPLIED ANYWHERE. migrations.pending/ until the owner says so (D-003).
 * Rollback: re-apply the previous supabase/functions.sql.
 */

create or replace function desk_money(p_project uuid) returns jsonb as $$
  with open_desk as (
    select count(*) as sold,
           coalesce(sum(t.amount), 0) as expected,
           coalesce(sum(t.amount) filter (where t.payment_status = 'Paid'), 0) as collected
    from tickets t
    join books b on b.idx = t.book_idx and b.project_id = t.project_id
    where t.project_id = p_project
      and t.sold_by_agent is null
      and t.status in ('Sold','Donated')
      and t.idx <= active_tickets(p_project)
      and not (b.status in ('Settled','Lost') and b.declared_sold is not null)
  ),
  closed_desk as (
    select coalesce(sum(b.declared_sold), 0) as sold,
           coalesce(sum(b.amount_due), 0) as expected,
           coalesce(sum(b.amount_paid), 0) as collected
    from books b
    where b.project_id = p_project
      and b.settled_by_agent is null
      and b.status in ('Settled','Lost')
      and b.declared_sold is not null
  )
  select jsonb_build_object(
    'sold',      (select sold from open_desk) + (select sold from closed_desk),
    'expected',  (select expected from open_desk) + (select expected from closed_desk),
    'collected', (select collected from open_desk) + (select collected from closed_desk));
$$ language sql stable;

create or replace function desk_money() returns jsonb as $$
  select desk_money(coalesce(current_project(), seed_project()))
$$ language sql stable;
