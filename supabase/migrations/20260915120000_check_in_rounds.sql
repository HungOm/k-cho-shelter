-- Check-in rounds, and who has reported in each one.
--
-- Everything here is create-if-not-exists or an upsert, so running it twice
-- changes nothing. Safe on a raffle already in flight: no existing row is
-- touched, and a deployment that never records a report behaves exactly as it
-- did before — the schedule is CALCULATED from the two dates that already
-- exist, and the round starts at 1.

create table if not exists check_in_reports (
  agent_id     text not null references agents(agent_id) on delete cascade,
  round        integer not null check (round >= 1),
  due_at       date not null,
  reported_at  timestamptz not null default now(),
  books_back   integer not null default 0 check (books_back >= 0),
  tickets_sold integer not null default 0 check (tickets_sold >= 0),
  amount_paid  numeric(12,2) not null default 0 check (amount_paid >= 0),
  note         text not null default '',
  recorded_by  text not null default '',
  primary key (agent_id, round)
);

create index if not exists check_in_round_idx on check_in_reports (round);

-- Server-only, like the audit log and the approvals queue. The browser reads
-- this through the Edge Function, which applies the scoping a policy cannot:
-- an organiser sees every seller's standing, a seller sees their own.
alter table check_in_reports enable row level security;
revoke all on check_in_reports from anon, authenticated;

-- ============ THE THREE SETTINGS THE ROUNDS RUN ON ============
-- Inserted, never overwritten: a raffle that has already been tuned keeps its
-- own values, and one upgrading from before rounds existed gets the defaults.

insert into config (key, value, notes) values
  ('CHECK_IN_EVERY_MONTHS', '1',
   'How far apart the reporting rounds are, in months. The dates themselves are '
   || 'worked out from this and the final deadline — nobody types them.'),
  ('REPORT_GRACE_DAYS', '3',
   'Days after the check-in date before a seller who has not reported is shown '
   || 'as late. Somebody who says they will come on Saturday should not be red '
   || 'on Friday.'),
  ('CHECK_IN_ROUND', '1',
   'Which reporting round is live. Moved by the "Deadlines" screen when the '
   || 'check-in date rolls on. Do not edit by hand: it is what every recorded '
   || 'report is filed against.')
on conflict (key) do nothing;
