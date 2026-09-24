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

### D-007 · Where the twenty-six unnamed actions go · raised by kcho-shelter-51, 2026-09-24
Blocks: nothing. Tagging is in; this only decides whether the tags stay as written.
Context: the plan's `core` row names ten actions, and its rule for anything unnamed is `core`. Twenty-six end up there, including account administration (`upsert_user`, `set_permission`) and raffle setup (`set_numbering`, `expand_tickets`, `upload_logo`). `core` is unswitchable, so this is the set no system admin can ever turn off.
- A ★ as written: the plan's own default, and none of these is a thing an organisation should lack
- B a fourteenth feature, `settings`, for the sixteen setup and account actions, switchable but standard
- C split further: `branding` for logo/colour/contact/about, `accounts` for users and permissions
Your choice: 

### D-008 · `report_draft` and `report_back` are books, not reports · raised by kcho-shelter-51, 2026-09-24
Blocks: nothing.
Context: the plan's `reports` row reads "report_*", which by name captures these two. They are not report documents — they are the seller's book return-report flow, and grouping them under `reports` would mean switching off reporting also stops sellers returning books. ACTION_META agrees: both sit in the Books group.
- A ★ tagged `books`; `reports` keeps only the six documents plus `export_entries`
- B follow the "report_*" wording literally and tag them `reports`
Your choice: 

### D-009 · `ACTION_META` covers 92 of 95 actions · raised by kcho-shelter-51, 2026-09-24
Blocks: nothing in MT-F. Not fixed here, per rule 1.
Context: `ACTION_META` is optional, so `agent_statement`, `search` and `set_org_about` fall through `m.group ?? 'Other'` and `m.label ?? action` (index.ts:105, 119-120). Permissions.vue renders them in a card headed "Other" with their raw snake_case ids as labels. Nothing in tests/ reads ACTION_META. This is the defect the plan cites as its reason for making `feature` required, three lines from the registry.
- A ★ its own card: add the three entries and a test that ACTION_META covers REGISTRY, both directions
- B fold into whichever card next touches the Access screen
- C leave it; three raw ids on an organiser-only screen is tolerable
Your choice: 


### D-010 · Nothing type-checks the Edge Function · raised by kcho-shelter-51, 2026-09-24
Blocks: nothing now; Stage 3 starts relying on required fields such as `feature`.
Context: `tests/run.sh` has no `deno check` or `tsc` step, so a required TypeScript field is enforced only by a test that reads the source text. Stages 2–5 add more such contracts (`ctx.project`, `p_project`).
- A ★ add a `deno check supabase/functions/api/index.ts supabase/functions/verify/index.ts` step to the gate, failing if Deno is missing, as test-rls.sh does for Docker. Deno is not installed on this machine today, so A also means installing it here and in the Pages workflow
- B keep source-text tests only, one per contract
Your choice: 

## Decided
