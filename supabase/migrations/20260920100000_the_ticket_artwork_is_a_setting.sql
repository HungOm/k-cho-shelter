-- The picture a ticket is printed on, and where the number sits on it.
--
-- TICKETS-PLAN.md phase 1. The raffle prints thousands of paper tickets whose
-- numbers are typed in by hand at a print shop. The app has never seen the
-- artwork, so it cannot print a ticket, cannot show one, and cannot put
-- anything on one that would tell a real ticket from a photocopy with a
-- plausible number written on it. This is the first half: the artwork arrives,
-- is measured, and is kept, along with the coordinates of the space it leaves
-- for the number.
--
-- WHAT IS DELIBERATELY NOT HERE. No ticket carries a code yet, nothing is
-- generated, and nothing is printed from this. Those are phases 2 and 3. The
-- table lands first, on its own, so that the day tickets start carrying codes
-- is not also the day the artwork table is new.
--
-- NOTHING IS STORED AS A PICTURE PER TICKET. One artwork file, one row of
-- coordinates. A ticket is drawn in the browser at the moment somebody opens or
-- prints it and is then thrown away, which is what lets twenty thousand tickets
-- cost nothing until one of them is looked at.
--
-- WHICH ARTWORK IS IN USE IS A CONFIG ROW, NOT A COLUMN HERE. TICKET_ARTWORK_ID
-- names it. A boolean column on this table would be a second place for the same
-- fact, and this repository has paid repeatedly for a pair of facts that can
-- disagree. It also means whoami can tell a screen whether printing is possible
-- without a second query, so "Print this book" can be shown disabled WITH THE
-- REASON rather than enabled and then refused.
--
-- THE BUCKETS. `ticket-artwork` is created here. So, at last, is `branding` —
-- it has been assumed to exist since the logo shipped and was created by hand
-- in the dashboard, which ARCHITECTURE-REVIEW.md:250 has listed as debt ever
-- since. Both inserts are guarded, because supabase/test-functions.sh builds a
-- plain postgres image with no storage schema at all and an unguarded insert
-- would fail that harness rather than the thing it is testing.
--
-- DATA LOSS RISK: NO. One table created, three config rows added with
-- `on conflict do nothing`, two storage buckets created if absent. Nothing is
-- dropped, altered or deleted. Re-runnable.

create table if not exists ticket_templates (
  id           text primary key,
  name         text not null default '',
  content_type text not null check (content_type in ('image/png', 'image/jpeg', 'image/webp')),
  width_px     integer not null,
  height_px    integer not null,
  bytes        integer not null default 0,
  url          text not null default '',
  -- Where the number and the QR go, in the artwork's own pixel space. Read and
  -- written by the browser; the server checks it is storable and bounded and
  -- otherwise does not have an opinion about its shape.
  design       jsonb not null default '{}'::jsonb,
  uploaded_by  text not null default '',
  uploaded_at  timestamptz not null default now()
);

alter table ticket_templates enable row level security;

-- Nobody reads this directly. The Edge Function holds the secret key and reads
-- it on the caller's behalf after deciding whether the caller is an organiser;
-- the browser never touches the table. Same shape as ticket_movements.
revoke all on ticket_templates from anon, authenticated;

insert into config (key, value, notes) values
  ('TICKET_ARTWORK_ID', '', 'Which uploaded ticket artwork is printed from. Set on the "Ticket design" screen. Blank means there is none yet and printing is refused.'),
  ('TICKET_SIZES', '', 'The shapes of paper this raffle prints, as JSON. Blank means the built-in list, which is the 190 x 61 mm ticket. An upload whose shape is not on the list is refused, because a picture of the wrong shape is either stretched or cropped on every ticket and neither can be fixed afterwards.'),
  ('VERIFY_URL', '', 'Where the QR code on a printed ticket points. Blank means this site. Printed codes outlive the raffle, so an organiser has to be able to point them at an address they will still control.')
on conflict (key) do nothing;

-- The two buckets. Guarded: test-functions.sh builds a bare postgres with no
-- storage schema, and this must be a no-op there rather than an error.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values
      ('ticket-artwork', 'ticket-artwork', true, 4194304,
       array['image/png', 'image/jpeg', 'image/webp']),
      ('branding', 'branding', true, 524288,
       array['image/png', 'image/jpeg', 'image/webp'])
    on conflict (id) do nothing;
  end if;
end $$;
