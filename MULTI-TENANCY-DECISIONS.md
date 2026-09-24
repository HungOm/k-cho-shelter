# Multi-tenancy: decisions for the owner

Questions that can wait, collected so they can be skimmed and answered in one
sitting. Blocking questions are asked directly, not parked here.

**How to answer.** Write your letter after "Your choice". Until you do, work
continues under the recommended option, marked ★.

**How to add one** (every session): copy the template, give it the next number,
keep it under ten lines.

```
### D-NNN · short title · raised by <session>, <date>
Blocks: <task or stage, or "nothing yet">
Context: one or two sentences.
- A ★ recommended option, and what it costs
- B the alternative, and what it costs
Your choice: 
```

## Open

### D-001 · Who becomes the organiser of the existing organisation · raised by multi-tenancy-architecture-plan, 2026-09-24
Blocks: Stage 3. Stage 0 seeds the organisation with no organiser yet, which grants nobody anything.
Context: a migration cannot read the `SUPER_ADMIN_EMAIL` secret, so it cannot fill `organiser_email` itself.
- A ★ the api function sets it to the secret's address the first time the system admin signs in after Stage 3, and audits it
- B a runbook step: `select seed_tenancy('<email>')` typed by hand in the SQL editor
- C the one `app_users` row whose role is `superadmin`, refused if there is not exactly one
Your choice: 

### D-002 · What today's `superadmin` rows become · raised by multi-tenancy-architecture-plan, 2026-09-24
Blocks: Stage 3.
Context: the plan maps them to `platform_admins`, which gives them power over every future organisation. Today they only run this one raffle.
- A ★ admins of the existing project; platform rights are granted by hand later if wanted
- B platform admins, as the plan first said
- C decided per person on a list the migration prints and refuses to guess
Your choice: 

### D-003 · When pending migrations reach production · raised by multi-tenancy-architecture-plan, 2026-09-24
Blocks: nothing until Stage 2 needs the database.
Context: Stages 0 and 1 are written to `migrations.pending/` and applied nowhere. Your earlier ruling allows Stages 0–3 as each is green.
- A ★ each stage moves into `migrations/` in its own commit only after you say "apply Stage N", then one person runs `db push` on a restored backup and then live
- B Stages 0 and 1 together, once both are green
- C hold everything until Stage 3 is green, then apply 0–3 in one window
Your choice: 

### D-004 · The standard feature set for a new organisation · raised by multi-tenancy-architecture-plan, 2026-09-24
Blocks: Stage 5 (creating organisations).
Context: the plan switches on tickets, books, money, check-ins, approvals, prizes and reports, and leaves printing, the digital card, the studio, seeding and reset off.
- A ★ as the plan says
- B everything on; you switch things off per organisation
- C only tickets and books; everything else is switched on by you
Your choice: 

### D-005 · Signed link lifetime for artwork and logos · raised by multi-tenancy-architecture-plan, 2026-09-24
Blocks: Stage 5.
Context: private buckets need signed links. Longer links survive a long print run; shorter ones limit a leaked link.
- A ★ 12 hours
- B 1 hour, re-signed on every screen load
- C 7 days
Your choice: 

### D-006 · What a full terminal reset does to organisations · raised by multi-tenancy-architecture-plan, 2026-09-24
Blocks: nothing today; matters once a second organisation exists.
Context: `reset.sql` empties the whole database. With one organisation that is the raffle; with several it is everybody's.
- A ★ keep it whole-database, re-seed the original organisation, and make it refuse while more than one organisation exists
- B scope it to one project with a `-v project=` argument
Your choice: 

## Decided
