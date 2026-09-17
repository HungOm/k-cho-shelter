/*
 * THE CUSTODY TRAIL WAS THE ONE HISTORY TABLE NOTHING DEFENDED.
 *
 * payments, ticket_history and round_snapshots each refuse an update, a delete
 * and a truncate at the database, each with the same reasoning written above
 * them: the Edge Function holds the secret key and bypasses row security, so
 * every grant and policy on those tables is irrelevant to the only caller that
 * can reach them, and a trigger is not.
 *
 * book_history — who had a book, who they gave it to, and who moved it — had
 * none of that. It was append-only in the sense that nobody had yet written the
 * code to change it, which is how ticket_history was append-only right up until
 * somebody did.
 *
 * AND THE FOREIGN KEY WAS A CASCADE, so deleting a book deleted the record of
 * where that book had been. Restrict instead. The one deletion this raffle
 * actually performs is reset.sql, which removes book_history before books, in
 * that order and on purpose — and which now disables these triggers in the open
 * alongside the four it already disabled.
 *
 * 239 rows on this fundraiser, none of them reconstructible from anything else.
 */

create or replace function book_history_append_only() returns trigger as $$
begin
  raise exception 'book_history is append only — % is not allowed on it', tg_op
    using errcode = 'restrict_violation',
          hint = 'Move the book instead: the correcting move is appended, and what happened before stays readable.';
end $$ language plpgsql;

drop trigger if exists book_history_no_change on book_history;
create trigger book_history_no_change before update or delete on book_history
  for each row execute function book_history_append_only();

drop trigger if exists book_history_no_truncate on book_history;
create trigger book_history_no_truncate before truncate on book_history
  for each statement execute function book_history_append_only();

alter table book_history drop constraint if exists book_history_book_idx_fkey;
alter table book_history add constraint book_history_book_idx_fkey
  foreign key (book_idx) references books(idx) on delete restrict;
