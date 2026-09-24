/*
 * FILLING A RAFFLE UP, DECLARED BEFORE ANYTHING IS FILLED.
 *
 * The other half of TICKETS-PLAN.md phase 7. resetplan.ts answers "what would
 * be destroyed"; this answers "what would be made", and it is deliberately the
 * same shape, read by the same screen, using the same feature ids. A demo
 * install and a finished raffle are the same set of things — one has them and
 * the other does not.
 *
 * WHY A SEED EXISTS AT ALL. An empty raffle cannot be evaluated. Every screen
 * in this app is a view onto tickets, custody and money, and with none of those
 * the reconciliation table is an empty table, the chase list is an empty list,
 * and somebody deciding whether to use this is looking at scaffolding. The seed
 * is for demonstrations, for training a volunteer before the paper arrives, and
 * for a developer who needs a raffle shaped like a real one.
 *
 * THE DIRECTION IS THE MIRROR OF THE RESET, AND IT FALLS OUT OF THE SAME EDGE.
 *
 * `payments.agent_id references agents on delete restrict`. For the reset that
 * means emptying the sellers drags the money with it — the parent cannot go
 * while the child points at it. For the seed it means the opposite and for the
 * same reason: a payment cannot be MADE until the seller it names exists. One
 * foreign key, two readings, and they are exact reflections. So `needsFor` here
 * walks LINKS in the direction `dragsIn` does not, and the table order is the
 * reverse of the reset's: parents first.
 *
 * tests/seedplan.test.mjs asserts that reflection on every hard edge, because
 * two hand-written traversals of one graph is exactly the shape that drifts.
 *
 * WHAT THIS FILE DOES NOT DO, and it matters as much as with the reset: it
 * writes nothing and names no handler. It is a declaration — features, the
 * tables each one fills, what it needs first, and the sample content itself —
 * read by seed.ts and by the tests. The content lives here rather than in the
 * handler so that "what would this put in my raffle" is a question somebody can
 * answer by reading one file, before running it.
 *
 * AND THE SEED NEVER REACHES A TABLE THE RESET CANNOT CLEAR. Every table named
 * in `writes` below must belong to a RESETTABLE feature in resetplan.ts, and a
 * test enforces it. Otherwise the seed could leave something behind that the
 * only cleanup route in the app cannot remove — demo rows in a raffle about to
 * go live, with no button that takes them out.
 */
import { FEATURES, LINKS, featureOf } from './resetplan.ts'

/*
 * WHO THE SEED IS, and this is a label rather than an identity.
 *
 * Every row the seed makes goes through the same handler a person would use,
 * so every row carries `recorded_by` / `received_by` — and the seed puts THIS
 * in it rather than the System Admin's own address. That single fact is what
 * lets the guard in seed.ts be stated positively: a raffle may be seeded while
 * every sale and every payment in it was recorded by the seed. Anything else
 * means a person has used this raffle, and demo data must not join it.
 *
 * `.invalid` is reserved by RFC 2606 and can never be delivered to, so no real
 * person can ever hold this address and no real row can ever carry it. The
 * audit row for the seed itself names the System Admin who ran it; these rows
 * describe seeded events, and saying the seed made them is the truth.
 *
 * IT IS NOT A PRIVILEGE. The authorisation decision is made once, at the top of
 * seedApply, against the real caller. The label is attached afterwards and
 * grants nothing — see the note on `asSeed` in seed.ts.
 */
export const SEED_EMAIL = 'seed@demo.invalid'

/*
 * Phone numbers nobody can ring.
 *
 * A demo seller list full of plausible Myanmar mobile numbers is a list
 * somebody will eventually call. 09 is the real prefix, so the list still looks
 * and sorts like the real thing, and the body is zeros — which reads as a
 * placeholder to anybody in the country at a glance.
 */
const PHONE = (n: number) => '09000000' + String(n).padStart(2, '0')

/*
 * THE SAMPLE SELLERS.
 *
 * Real-shaped names, because the point of a demo is that the screens look like
 * screens rather than like a test fixture, and a column of "Seller 1..12" tells
 * a person nothing about how the interface handles a name of ordinary length.
 * Zones are repeated on purpose: the grouping is what several reports are for,
 * and one seller per zone would hide it.
 */
export const SAMPLE_SELLERS: { name: string; zone: string }[] = [
  { name: 'Daw Hla Hla Win', zone: 'Mindat' },
  { name: 'U Kyaw Zin Oo', zone: 'Mindat' },
  { name: 'Ma Thiri Aung', zone: 'Mindat' },
  { name: 'Ko Sai Lin Htet', zone: 'Kanpetlet' },
  { name: 'Daw Nwe Nwe Yi', zone: 'Kanpetlet' },
  { name: 'U Maung Maung Gyi', zone: 'Kanpetlet' },
  { name: 'Ma Ei Phyu Sin', zone: 'Matupi' },
  { name: 'Ko Zaw Lin Naing', zone: 'Matupi' },
  { name: 'Daw Khin Mya Mya', zone: 'Matupi' },
  { name: 'U Aung Ko Latt', zone: 'Yangon' },
  { name: 'Ma Su Myat Noe', zone: 'Yangon' },
  { name: 'Ko Htet Wai Yan', zone: 'Yangon' },
]

export const sellerPhone = (i: number) => PHONE(i + 1)

/*
 * THE SAMPLE BUYERS, used as the names on sold books.
 *
 * Shorter than the seller list and reused around it, which is realistic: a
 * raffle sells to the same neighbourhoods its sellers live in, and a buyer
 * column where every value is unique is a buyer column nobody has to read
 * carefully.
 */
export const SAMPLE_BUYERS: { name: string; phone: string }[] = [
  { name: 'Ma Phyu Phyu Khaing', phone: PHONE(51) },
  { name: 'U Tin Maung Aye', phone: PHONE(52) },
  { name: 'Daw Cho Cho Lwin', phone: PHONE(53) },
  { name: 'Ko Naing Lin Aung', phone: PHONE(54) },
  { name: 'Ma Yadanar Htun', phone: PHONE(55) },
  { name: 'U Soe Moe Kyaw', phone: PHONE(56) },
  { name: 'Daw Aye Aye Mar', phone: PHONE(57) },
  { name: 'Ko Pyae Sone Win', phone: PHONE(58) },
]

/*
 * THE SAMPLE PRIZES.
 *
 * A first, a second, a third and a handful of consolations, because that is the
 * shape of every raffle this system has been pointed at, and because a prize
 * list with one row does not show what the draw screen does with several.
 */
export const SAMPLE_PRIZES:
  { tier: string; name: string; typeId: string; quantity: number; value: number }[] = [
  { tier: 'First', name: 'Motorbike', typeId: 'goods', quantity: 1, value: 4000000 },
  { tier: 'Second', name: 'Solar panel set', typeId: 'goods', quantity: 1, value: 850000 },
  { tier: 'Third', name: 'Rice, one sack', typeId: 'goods', quantity: 3, value: 120000 },
  { tier: 'Consolation', name: 'Blanket', typeId: 'goods', quantity: 10, value: 25000 },
]

/**
 * How much of it. The screen shows these numbers before anything is made, so
 * they are declared rather than computed — a size somebody cannot read in
 * advance is a size they find out about afterwards.
 *
 * `books` figures are CEILINGS, not promises: how many books exist depends on
 * TICKETS_PER_BOOK, which is this raffle's setting and not ours. seed.ts clamps
 * them and reports what it actually did.
 */
export type Size = {
  id: string
  name: string
  sellers: number
  tickets: number
  /** Books handed out to sellers, of the books that exist. */
  issued: number
  /** Books sold through, of the books handed out. */
  sold: number
  /** Sellers who have handed money in. */
  payments: number
}

export const SIZES: Size[] = [
  {
    id: 'small', name: 'Small — enough to look at',
    sellers: 5, tickets: 100, issued: 4, sold: 2, payments: 3,
  },
  {
    id: 'demo', name: 'Demonstration — a raffle mid-flight',
    sellers: 12, tickets: 500, issued: 20, sold: 9, payments: 8,
  },
]

export const sizeOf = (id: string): Size => SIZES.find((s) => s.id === id) ?? SIZES[0]

/**
 * What the seed can fill, and what it deliberately will not.
 *
 * `writes` is the subset of the feature's tables the seed actually puts rows
 * in, and it is not the same as the feature's table list. `prizes` owns
 * `winners`, and the seed does not draw: a demonstration where the draw has
 * already happened cannot demonstrate the draw. That distinction is load
 * bearing — the dependency graph below is derived from `writes`, so declaring
 * `winners` here would make the prize list require tickets for no reason.
 */
export type Seedable = {
  id: string
  /** Tables it puts rows in. Every one must belong to this feature in resetplan. */
  writes: string[]
  /** What it makes, in the words the screen shows. */
  makes: string
  /** Features that must exist first with no foreign key behind the requirement. */
  needs?: { feature: string; why: string }[]
  /** Not offered, and the sentence saying why. */
  never?: string
}

export const SEEDS: Seedable[] = [
  {
    id: 'sellers',
    writes: ['agents'],
    makes: 'Sellers with names, phone numbers and zones. The phone numbers are placeholders '
      + 'nobody can ring.',
  },
  {
    id: 'tickets',
    writes: ['tickets', 'books'],
    makes: 'A run of tickets numbered the way this raffle\'s settings say, in books — some '
      + 'still on the shelf, some out with sellers, some sold through.',
    needs: [{
      feature: 'sellers',
      why: 'Books are carried by people. With nobody to carry them every book stays on the '
        + 'shelf, and custody — which is what half these screens are about — has nothing to show.',
    }],
  },
  {
    id: 'money',
    writes: ['payments'],
    makes: 'Cash handed in by some of the sellers, so what is collected and what is still owed '
      + 'are both real figures rather than zero.',
    needs: [{
      feature: 'tickets',
      why: 'What a seller owes is the books they are carrying. Payments against sellers who are '
        + 'carrying nothing would show every one of them in credit, which is not a raffle.',
    }],
  },
  {
    /*
     * `prize_types` IS NOT IN `writes`, AND THAT IS NOT AN OMISSION.
     *
     * schema.sql ships four built-in types — cash, donated goods, voucher,
     * share of takings — so that table is never empty on any install, and the
     * emptiness guard would refuse this feature on a brand new database. The
     * sample prizes use the built-in ids. Emptiness is asked of the tables the
     * seed WRITES, and a table that arrives already populated is not one.
     */
    id: 'prizes',
    writes: ['prizes'],
    makes: 'A prize list — a first, a second, a third and consolations. Nothing is drawn: a '
      + 'demonstration where the draw has already happened cannot demonstrate the draw.',
  },

  /*
   * AND THE ONES IT WILL NOT, each with the sentence rather than an absence.
   * They are shown on the screen disabled with the reason, which is the rule
   * the rest of this app follows (tests/permissionui) and is the difference
   * between a feature that is not offered and one that looks broken.
   */
  {
    id: 'artwork', writes: [], makes: '',
    never: 'The seed cannot invent a picture of your ticket. Upload one on the Ticket Studio '
      + 'screen — that screen works on an empty raffle, and it is the one thing here worth '
      + 'setting up by hand.',
  },
  {
    id: 'checkins', writes: [], makes: '',
    never: 'A check-in report answers a round, and rounds are counted from the final deadline '
      + 'this raffle has not set yet. Set the deadlines first and the reports become something '
      + 'the app fills in by being used.',
  },
  {
    id: 'approvals', writes: [], makes: '',
    never: 'An approval is somebody\'s request waiting for an answer. The seed would have to '
      + 'invent the request, and a queue of requests nobody made is the one thing on that '
      + 'screen that has to be true.',
  },
  {
    id: 'rounds', writes: [], makes: '',
    never: 'A snapshot is the figures frozen when a check-in round rolls. It appears by using '
      + 'the app, not by being written into it, and one written by hand would be a set of '
      + 'totals that never reconciled against anything.',
  },
  {
    id: 'settings', writes: [], makes: '',
    never: 'Every raffle already has these from the day it is created, and they are the '
      + 'numbering your tickets are issued under. Filling them again would renumber a raffle '
      + 'rather than demonstrate one.',
  },
  {
    id: 'access', writes: [], makes: '',
    never: 'Accounts are how people sign in. Inventing them would mean inventing addresses that '
      + 'can receive mail, and a demonstration raffle with sign-in accounts nobody controls is '
      + 'a door left open.',
  },
  {
    id: 'tenancy', writes: [], makes: '',
    never: 'Organisations and projects say which raffle is which. The seed fills the raffle it is '
      + 'run inside; it does not invent another organisation for that raffle to belong to.',
  },
  {
    id: 'audit', writes: [], makes: '',
    never: 'The log records what was done. Writing entries for things nobody did is the only '
      + 'change that could make an audit log worse than not having one.',
  },
]

const byId = new Map(SEEDS.map((s) => [s.id, s]))
const nameOf = (id: string) => FEATURES.find((f) => f.id === id)?.name ?? id

/** Everything the seed will ever offer to fill. */
export const SEEDABLE = SEEDS.filter((s) => !s.never).map((s) => s.id)

/** Tables the seed puts rows in, for a set of features. */
export function tablesFor(features: string[]): string[] {
  const out: string[] = []
  for (const s of SEEDS) if (features.includes(s.id)) out.push(...s.writes)
  return out
}

/*
 * The same predicate resetplan uses, and it is the same predicate on purpose.
 *
 * `restrict` and `cascade` are the two actions that mean a child row cannot
 * outlive its parent — which, read backwards, is exactly "a child row cannot be
 * created before its parent". `set null` means neither: `books.held_by_agent`
 * is nullable, so a book can be made with nobody holding it, and the seed's
 * wish to hand some out is a preference rather than a requirement. That is why
 * it is declared as a soft `needs` above instead of being derived here.
 */
const REQUIRES_PARENT = (a: string) => a === 'restrict' || a === 'cascade'

/**
 * Features that must be filled BEFORE `id`, and why.
 *
 * The reflection of resetplan's `dragsIn`. That one asks which rows point AT
 * this feature's tables and so must be deleted first; this asks which tables
 * this feature's rows point at, and so must be filled first. Same list of
 * edges, read from the other end.
 */
export function needsFor(id: string): { feature: string; why: string }[] {
  const out = new Map<string, string>()
  const s = byId.get(id)
  if (!s) return []

  for (const [from, to, act] of LINKS) {
    if (!s.writes.includes(from) || !REQUIRES_PARENT(act)) continue
    const other = featureOf(to)
    if (!other || other === id) continue
    if (out.has(other)) continue
    /*
     * SAID IN THE FEATURES' OWN NAMES, not the tables'.
     *
     * The first version of this read "Every payments row names a agents row" —
     * a broken article, and two table names on a screen whose reader is a
     * System Admin rather than somebody who has seen schema.sql. It was written
     * by reading the code and found by rendering the screen and reading it,
     * which is the whole argument for doing the second.
     *
     * Phrased around "which" on purpose: feature names are plural in form
     * ("Sellers", "Prizes and winners") and singular in sense, so any sentence
     * that makes one the subject of a verb gets the agreement wrong half the
     * time.
     */
    out.set(other, `${nameOf(id)} is recorded against ${nameOf(other)}, which therefore has `
      + 'to be filled first — the database refuses a row that names something not there.')
  }
  for (const n of s.needs ?? []) if (!out.has(n.feature)) out.set(n.feature, n.why)

  return [...out].map(([feature, why]) => ({ feature, why }))
}

export type SeedPlan = {
  /** Feature ids that will be filled, parents before children. */
  features: string[]
  /** What was added to the selection, and why. */
  added: { feature: string; why: string }[]
  /** Selections that cannot be done from here at all. */
  refused: { feature: string; why: string }[]
}

/*
 * Parents first — the reverse of the reset's `childrenFirst`, by the same walk.
 * A feature may only be filled once everything it points at has been.
 */
function parentsFirst(features: string[]): string[] {
  const want = new Set(features)
  const out: string[] = []
  const seen = new Set<string>()
  const visit = (id: string) => {
    if (seen.has(id) || !want.has(id)) return
    seen.add(id)
    for (const n of needsFor(id)) visit(n.feature)
    out.push(id)
  }
  for (const id of features) visit(id)
  return out
}

/**
 * Turn a set of ticked features into what will actually be made.
 *
 * Expands the same way the reset's plan does, and says what it expanded and
 * why, for the same reason: a screen that quietly grows a selection is one that
 * does more than somebody agreed to. The difference is only the direction.
 */
export function seedPlanFor(selected: string[]): SeedPlan {
  const asked = new Set(selected.filter((s) => byId.has(s)))
  const refused: { feature: string; why: string }[] = []

  for (const id of [...asked]) {
    const s = byId.get(id)!
    if (s.never) { refused.push({ feature: id, why: s.never }); asked.delete(id) }
  }

  const added: { feature: string; why: string }[] = []
  for (let pass = 0; pass < SEEDS.length; pass++) {
    let grew = false
    for (const id of [...asked]) {
      for (const n of needsFor(id)) {
        if (asked.has(n.feature)) continue
        const nf = byId.get(n.feature)
        if (!nf) continue
        if (nf.never) {
          /* A requirement the seed refuses to make is a selection it cannot
           * honour. Said out loud rather than filled halfway. */
          if (!refused.some((r) => r.feature === id)) {
            refused.push({
              feature: id,
              why: `${nameOf(id)} cannot be filled here: it would need ${nameOf(n.feature)}, `
                + `and ${nf.never.charAt(0).toLowerCase()}${nf.never.slice(1)}`,
            })
          }
          asked.delete(id)
          grew = true
          continue
        }
        asked.add(n.feature)
        added.push({ feature: n.feature, why: n.why })
        grew = true
      }
    }
    if (!grew) break
  }

  return { features: parentsFirst([...asked]), added, refused }
}
