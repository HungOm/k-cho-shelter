# Organisations management: the system admin's surface

`MULTI-TENANCY-PLAN.md` names this in one line of Stage 5 and one of Stage 6 —
"control-plane actions (system admin and organiser)" and "system-admin screen
(organisations, organiser, status, feature switches)". That is enough to agree
to and not enough to build, so this file writes it out: who the system admin
is, what they can press, what they must never see, and what still needs an
answer from the owner.

Owner's instruction, 2026-09-25: organisations management must be planned and
included, not left implicit inside two stage rows.

Nothing here is built yet. Stage 0 created the tables it reads
(`organisations`, `org_features`, `org_defaults`, `platform_admins`,
`projects`, `project_members`) and they hold exactly one organisation: this
raffle's.

---

## 1. Who the system admin is

Two ways in, deliberately, because the first must work before any table does.

1. **The `SUPER_ADMIN_EMAIL` secret.** Already how the system admin is
   recognised today. It is the bootstrap: it works when `platform_admins` is
   empty, and it cannot be removed by anybody using the application.
2. **Rows in `platform_admins`**, which the secret's holder may add. This is
   how a second person becomes a system admin without sharing a secret.

`resolve_member()` already returns `is_platform_admin`; the surface below is
refused to everybody else with `FORBIDDEN`, not hidden — the house rule
(`permissionui`) is that a control you cannot use is disabled with the reason
in its title, and a screen you cannot reach is not in the navigation at all.

**The system admin is not an organiser.** Inside any project they are
break-glass only: every read or write they make on another organisation's raffle
data is audited with `platform_override: true` and they are never listed as a
member. That is the plan's ruling and it is the part most worth not eroding —
see D-029, which asks whether break-glass should exist at all.

---

## 2. The screen

One screen, `src/components/Platform.vue`, reachable only by a system admin.
Composition follows the design director's rule that different information
deserves different structure: this is a **register**, not a dashboard, so it is
a table of organisations with a detail panel, not a grid of cards.

```
Organisations                                          [ New organisation ]

  NAME              SLUG        ORGANISER              PROJECTS  STATUS
  K Cho Shelter     k-cho       hung@…                        1  active
  Hope Foundation   hope        (not appointed)               0  draft      ⚠

  ── selected: Hope Foundation ─────────────────────────────────────────────
     Organiser     (not appointed)                    [ Appoint organiser ]
     Status        draft                              [ Activate ]
     Features      tickets books money checkins …     [ Change ]
     Created       2026-09-25 by hung@…
     Projects      none yet
     Danger        [ Deactivate ]  [ Delete for good ]
```

Rules the screen follows, each from an existing house rule rather than invented
here:

- **The organisation with no organiser is the alarming row**, because it grants
  nobody anything. It carries the warning, not a neutral badge.
- **Counts are numbers, so they are tabular and right-aligned** (`td.num`).
- **Status is one word** and uses the existing `--ok`/`--warn`/`--bad` tokens;
  no new colour.
- **Destructive controls are last, separated, and named for what they do** —
  "Delete for good", not "Remove". Deactivate is reversible and says so;
  delete is not and takes the typed-phrase confirmation `reset_apply` already
  uses.
- **Every label needs a Burmese line** or a written exemption — see D-024,
  which asks whether these two screens are English-only by rule.

---

## 3. The actions

All system-admin-only, all audited, all on the control plane, so all reached
through `ctx.supabasePlatform` rather than the scoped client (D-027): these
tables have no `project_id` to filter on.

| Action | Takes | Refuses when |
|---|---|---|
| `list_organisations` | — | not a system admin |
| `create_organisation` | `name`, `slug` | slug taken, slug not `^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$`, name blank |
| `set_organiser` | `org_id`, `email` | not a valid address; organisation deleted. Replacing an organiser is allowed and audited with the old address in `details` |
| `set_org_status` | `org_id`, `status` | an unknown status; activating an organisation with no organiser (it would grant nobody anything) |
| `set_org_features` | `org_id`, `{feature: bool}` | a feature not in `_shared/features.ts`; `core`, which has no row and cannot be switched |
| `add_platform_admin` | `email` | not a valid address; already one |
| `remove_platform_admin` | `email` | it is the last one, or it is the address in `SUPER_ADMIN_EMAIL` (which is not a row and cannot be removed here) |
| `delete_organisation` | `org_id`, typed phrase | the phrase does not match; the organisation still has an active project and the caller has not said `also_projects: true` |

Two that are deliberately **not** here, because they belong to the organiser:
`create_project` and `set_org_defaults`. A system admin who wants a project
made asks the organiser, or appoints themselves organiser and is audited for it.

`set_org_features` is the one to be careful with: switching `money` off for an
organisation mid-raffle does not delete a payment, but it does refuse every
money action for everybody including the organiser (`FEATURE_NOT_ENABLED`).
The screen says so in the confirmation, with the count of what would stop
working — see D-030.

---

## 4. What a system admin can see

This is the part that needs deciding rather than describing, so it is stated as
the current intent and asked as D-029.

**Intended:** the register above — names, slugs, organiser addresses, project
counts, statuses, features, audit lines. Not one buyer name, phone number,
ticket or payment belonging to an organisation they do not organise.

**The hole:** the service key bypasses row security, and until Stage 8 the
write path's isolation is the wrapper plus explicit project plus tests. A system
admin who can reach the platform client can reach everything. So "cannot see"
today means "has no screen, no action and no audited path that shows it", not
"is refused by the database".

---

## 5. Cards, so it can actually be built

Each is small enough to gate on its own. None can start before Stage 3 gives
the function `resolve_member()` and `is_platform_admin`.

| Id | Ships | Depends on |
|---|---|---|
| MT-O1 | `supabase/functions/api/orgs.ts`: the eight actions above, registry entries with `feature: 'core'`, `sup`-equivalent gate on `is_platform_admin`, audit lines; `tests/orgactions.test.mjs` driving each against fakedb with two organisations | Stage 3 |
| MT-O2 | SQL: `create_organisation`/`set_org_features` as plpgsql where a constraint is cheaper than a handler check; `organisations.status` enum widened to draft/active/deactivated/deleted; `deactivated_at`/`deleted_at` per D-006 | Stage 3 |
| MT-O3 | `src/components/Platform.vue` and `modals/OrgForm.vue`, `modals/OrganiserForm.vue`, `modals/FeatureSwitches.vue`; navigation entry shown only to a system admin; Burmese per D-024 | MT-O1 |
| MT-O4 | `tests/platformscreen.test.mjs`, `screencalls`/`modalwiring`/`permissionui` extensions; T8 (the powers suite) gains: an organiser cannot call any of the eight, and a platform override writes `platform_override: true` | MT-O3 |
| MT-O5 | The retention job that finishes a deletion after ninety days (D-013), wherever D-026 puts it | MT-O2 |

Rough size, in the plan's own units: 4–6 engineering days, inside Stage 5's
6–8 and Stage 6's 10–14 rather than on top of them.

---

## 6. What this file does not answer

D-024 (Burmese for this screen), D-026 (the retention job), D-029 (whether
break-glass exists), D-030 (switching a feature off mid-raffle), D-031 (how an
organiser who has never signed in is appointed), D-032 (what a suspended
organisation's members see). All in `MULTI-TENANCY-DECISIONS.md` with options
and a recommendation.
