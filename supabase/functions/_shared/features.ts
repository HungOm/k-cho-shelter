/*
 * WHAT AN ORGANISATION MAY USE AT ALL — the outer of the three walls.
 *
 * Three layers decide whether an action runs, each able only to narrow the one
 * before it, exactly as `gate.ts` already narrows a registry default with an
 * override:
 *
 *   1. ORGANISATION ENTITLEMENT (system admin) — is this feature switched on
 *      for the organisation? Off, and nobody has it, the organiser included.
 *   2. ORGANISER'S PERMISSIONS (per project) — which roles may use it. The
 *      existing `permissions` table and Access screen.
 *   3. REGISTRY DEFAULTS and the organiser-only actions. Unchanged.
 *
 * This file is layer 1's vocabulary and nothing else. IT GRANTS NOTHING AND
 * REFUSES NOTHING TODAY. There is no entitlement check yet — that needs
 * `org_features`, which is Stage 3. What lands now is the tagging, so that when
 * the check arrives it has a complete list to read rather than a list somebody
 * has to finish first.
 *
 * WHY THE TAG IS REQUIRED AND NOT OPTIONAL. The plan's sentence is "an action
 * that names none is core", and read as a runtime default that is a rule which
 * fails OPEN: forget the field on a new action and it becomes always-on,
 * unswitchable, for every organisation — silently, because an absent property
 * and a deliberate one are the same thing to the reader. This repo has the
 * receipt for that already, three lines away: ACTION_META is optional, ninety-
 * two of the ninety-five actions have an entry, and the three that do not
 * render on the Access screen under a group called "Other" with their raw
 * snake_case id as the label. Nobody chose that. So `feature` is a required
 * field on ActionSpec, `core` is a value somebody must type, and
 * tests/features.test.mjs fails an action that names a feature not in this
 * list. Optional in code is absent in practice.
 *
 * `standard` IS ABOUT A NEW ORGANISATION, NOT ABOUT IMPORTANCE. It is the set
 * switched on when an organisation is created; a system admin moves any of them
 * afterwards. Printing, cards, studio, seed and reset are off to begin with
 * because they cost storage or rewrite data, not because they matter less.
 *
 * `always` IS THE ONE THAT CANNOT MOVE. `core` has no row in `org_features` at
 * all — `seed_tenancy()` seeds the other twelve and skips it — so the Stage 3
 * check must treat core as on WITHOUT LOOKING, rather than looking and finding
 * nothing. A missing row and a row saying false are the same absence to a
 * query that is not careful, and the difference is whether `whoami` works.
 */

export interface Feature {
  /** Stored in `org_features.feature`; a test keeps the two lists equal. */
  id: string
  /** What a system admin sees beside the switch. */
  name: string
  /** Switched on for a NEW organisation. */
  standard: boolean
  /** On for every organisation, unswitchable, and holds no `org_features` row. */
  always?: boolean
}

export const FEATURES: Feature[] = [
  { id: 'core', name: 'The raffle itself', standard: true, always: true },
  { id: 'tickets', name: 'Selling tickets', standard: true },
  { id: 'books', name: 'Ticket books and custody', standard: true },
  { id: 'money', name: 'Money and statements', standard: true },
  { id: 'checkins', name: 'Check-in rounds', standard: true },
  { id: 'approvals', name: 'Two-person approval', standard: true },
  { id: 'prizes', name: 'Prizes and winners', standard: true },
  { id: 'reports', name: 'Reports and exports', standard: true },
  { id: 'printing', name: 'Printed tickets', standard: false },
  { id: 'cards', name: 'Digital tickets', standard: false },
  { id: 'studio', name: 'Design studio', standard: false },
  { id: 'seed', name: 'Demo data', standard: false },
  { id: 'reset', name: 'Clearing the raffle', standard: false },
]

export type FeatureId =
  | 'core' | 'tickets' | 'books' | 'money' | 'checkins' | 'approvals'
  | 'prizes' | 'reports' | 'printing' | 'cards' | 'studio' | 'seed' | 'reset'

export const FEATURE_IDS: string[] = FEATURES.map((f) => f.id)

/** The twelve that get an `org_features` row. `core` is not among them. */
export const SWITCHABLE: string[] = FEATURES.filter((f) => !f.always).map((f) => f.id)

/** What a new organisation starts with, minus the one that needs no row. */
export const STANDARD: string[] =
  FEATURES.filter((f) => f.standard && !f.always).map((f) => f.id)

export const isFeature = (v: unknown): v is FeatureId =>
  typeof v === 'string' && FEATURE_IDS.includes(v)
