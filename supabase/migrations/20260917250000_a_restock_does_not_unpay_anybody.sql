-- Putting a book back on the shelf un-paid the seller without un-selling anything.
--
-- REPRODUCED BEFORE IT WAS FIXED, on a database built from this repository:
--
--   settle Book-0009  nine sold, one stub back, RM90 handed over
--                     expected 90   collected 90   outstanding 0
--   restock Book-0009
--                     expected 90   collected  0   outstanding 90
--                     and nine tickets are still Sold
--
-- JOHN handed over ninety ringgit on the 14th and the screen says he owes
-- ninety. Reported from the live raffle, on a real seller's line.
--
-- WHY IT HAPPENED. Restock reverses the settlement payment, because it also
-- clears books.amount_paid and the two are the same money — leaving both would
-- count that cash twice. That reasoning was right under the old model, where a
-- closed book's expected came from the book too, so clearing both sides netted
-- out. Money now follows the SALE: the nine tickets are still sold, they still
-- name their seller, so the charge survives the restock through the ticket rows
-- while the credit was thrown away with the book's figure.
--
-- THE FIX IS TO SAY WHAT ACTUALLY HAPPENED. The cash arrived. It did not stop
-- having arrived because the paper went back in the cupboard. So the settlement
-- row is still reversed — the book's figure is gone and nothing may count it
-- twice — and the same amount is written back as an ordinary hand-over, which
-- is what it now is: money this seller gave the raffle, not tied to a book
-- that has been reopened.
--
-- Net effect on what they are shown as having paid: nothing, which is the
-- point. Net effect on the ledger: two more rows, both explaining themselves,
-- and the original settlement row still there to be read.
--
-- WHY NOT UN-SELL THE TICKETS INSTEAD. That would balance too, and it would
-- destroy nine sales and nine buyers who hold tickets for a draw. A restock is
-- a paper movement; it must not reach into what was sold.
--
-- WHY NOT SKIP THE REVERSAL WHEN SALES REMAIN. Then the settlement row and the
-- book disagree the moment amount_paid is cleared, which is the bug this
-- reversal was added to fix. Reverse and re-credit keeps both true.
--
-- DATA LOSS RISK: NO. One function is replaced. Existing rows are untouched —
-- including books already restocked, whose sellers stay wrongly in debt until
-- somebody records the hand-over. See the note at the end for those.

create or replace function restock_books_tx(
  p_idxs integer[],
  p_user text,
  p_note text default ''
) returns integer as $$
declare
  moved integer;
begin
  /*
   * Reverse each settlement payment that is not already reversed, and write the
   * same money straight back as a hand-over, in one statement so that neither
   * can happen without the other.
   *
   * The reversal is bookkeeping: the book's amount_paid is about to be cleared
   * and that row is the same cash. The hand-over is the fact: the seller gave
   * the raffle this money and still has.
   */
  with undone as (
    insert into payments (agent_id, amount, received_by, method, book_idx, source, reverses, note)
    select p.agent_id, -p.amount, p_user, coalesce(p.method, 'cash'), p.book_idx, 'settlement',
           p.id, 'Reversed: book put back on the shelf'
      from payments p
     where p.book_idx = any(p_idxs)
       and p.source = 'settlement'
       and p.reverses is null
       and not exists (select 1 from payments r where r.reverses = p.id)
    returning agent_id, -amount as amount, book_idx, method
  )
  insert into payments (agent_id, amount, received_by, method, book_idx, source, note)
  select u.agent_id, u.amount, p_user, u.method, u.book_idx, 'hand',
         'Cash kept from the count-in of ' ||
         coalesce((select b.number from books b where b.idx = u.book_idx), 'a book') ||
         ', which went back on the shelf'
    from undone u
   where u.amount <> 0;

  insert into book_history (book_idx, from_agent, action, by_user, note)
  select b.idx, b.held_by_agent, 'restock', p_user,
         coalesce(nullif(p_note, ''),
                  case when b.declared_sold is not null
                       then 'Settlement of ' || b.declared_sold || ' cleared.'
                       else '' end)
    from books b where b.idx = any(p_idxs) order by b.idx;

  update books set
    status = 'Unassigned', held_by_agent = null,
    issued_at = null, due_at = null,
    declared_sold = null, amount_due = null, amount_paid = null,
    settled_at = null, settled_by = '', settled_by_agent = null, notes = '',
    modified_by = p_user
   where idx = any(p_idxs);
  get diagnostics moved = row_count;

  update tickets set
    status = 'Available', buyer_name = '', buyer_phone = '', buyer_zone = '',
    sold_by_agent = null, amount = null, payment_status = '', sold_at = null,
    source = '', recorded_by = p_user
   where book_idx = any(p_idxs) and status in ('Available', 'Reserved');

  return moved;
end $$ language plpgsql;

revoke execute on function restock_books_tx(integer[], text, text) from public, anon, authenticated;

-- ============ THE BOOKS THIS ALREADY HAPPENED TO ============
-- Not repaired here, deliberately. A restock that reversed a payment before
-- today left a seller owing money they had handed over, and the row that would
-- put it right is a statement about cash — whose, how much, and on whose word.
-- Writing those from a migration would be this file deciding, silently, that
-- every historical reversal was one of these rather than a genuine undoing.
--
-- They are findable, which is what a migration can honestly offer:
--
--   select p.agent_id, p.book_idx, -r.amount as cash_in_limbo
--     from payments p
--     join payments r on r.reverses = p.id
--    where p.source = 'settlement'
--      and r.note like 'Reversed: book put back%'
--      and exists (select 1 from tickets t
--                   where t.book_idx = p.book_idx and t.status in ('Sold','Donated'));
--
-- Each one is an organiser recording a hand-over with a note, which is a
-- sentence somebody can stand behind.
