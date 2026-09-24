/**
 * Every action names a feature, every feature is named, and the two lists that
 * must agree do agree.
 *
 * WHAT THIS IS FOR. Multi-tenancy adds an outer wall: a system admin decides
 * which features an organisation may use at all, before the organiser's
 * permissions decide who inside it may use them. That wall reads
 * `spec.feature`. Nothing reads it yet — the entitlement check is Stage 3 — so
 * for now this file is the only thing standing between the tagging and rot.
 *
 * THE FAILURE IT EXISTS TO PREVENT IS A TAG THAT IS MISSING RATHER THAN WRONG.
 * A wrong tag is visible: the action turns up under a feature somebody can see
 * it does not belong to. A missing tag is invisible, and under the plan's
 * sentence "an action that names none is core" it fails OPEN — always on,
 * unswitchable, for every organisation, silently. `feature` is therefore
 * REQUIRED on ActionSpec so the compiler objects too; this file is the check
 * that survives somebody widening the type to shut the compiler up.
 *
 * The receipt for that is three lines from the registry: ACTION_META is
 * optional, and 92 of the 95 actions have an entry. The three that do not —
 * `agent_statement`, `search`, `set_org_about` — render on the Access screen
 * under a group called "Other" with their raw snake_case id as the label,
 * because `m.group ?? 'Other'` and `m.label ?? action` do exactly what they
 * say. Nobody decided that. Nothing caught it. Optional in code is absent in
 * practice.
 *
 * BOTH DIRECTIONS, ALWAYS. "Every action names a listed feature" alone passes a
 * list with fifty unused features in it. "Every feature is used" alone passes a
 * registry where half the actions are untagged. Neither half is the check.
 *
 * AND THE PARSE IS GUARDED. Every count this file derives is asserted to be
 * non-zero before anything is concluded from it. A regex that stops matching
 * after somebody reformats the registry would otherwise report 0 actions, find
 * 0 disagreements, and print a pass — the exact shape of a test that has
 * quietly stopped reading its subject.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const FEATURES_TS = path.join(ROOT, 'supabase/functions/_shared/features.ts')
const INDEX_TS = path.join(ROOT, 'supabase/functions/api/index.ts')
const GATE_TS = path.join(ROOT, 'supabase/functions/api/gate.ts')
const SCHEMA = path.join(ROOT, 'supabase/schema.sql')

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const read = (p) => fs.readFileSync(p, 'utf8')

/* ---------- the feature list ---------- */

const featuresSrc = read(FEATURES_TS)
const featureBlock = featuresSrc.match(/export const FEATURES: Feature\[\] = \[([\s\S]*?)\n\]/)
ok(!!featureBlock, 'features.ts still declares `export const FEATURES: Feature[] = [`')
if (!featureBlock) { console.log(`\n${pass} passed, ${fail} failed`); process.exit(1) }

const FEATURES = [...featureBlock[1].matchAll(
  /\{\s*id:\s*'([a-z]+)',\s*name:\s*'([^']+)',\s*standard:\s*(true|false)(,\s*always:\s*(true|false))?\s*\}/g,
)].map((m) => ({ id: m[1], name: m[2], standard: m[3] === 'true', always: m[5] === 'true' }))

const featureIds = new Set(FEATURES.map((f) => f.id))

console.log('the feature list itself')
ok(FEATURES.length > 0, 'the FEATURES parse found at least one feature (a zero here means this file stopped reading features.ts)')
ok(FEATURES.length === 13, `the plan names thirteen features; features.ts declares ${FEATURES.length}`)
ok(featureIds.size === FEATURES.length, 'no feature id is declared twice')
for (const f of FEATURES) {
  ok(/^[a-z][a-z_]*$/.test(f.id), `feature id "${f.id}" is lower snake_case, because it is stored in org_features.feature`)
  ok(f.name.trim().length > 0 && f.name !== f.id,
    `feature "${f.id}" has a name a system admin can read, not a repeat of its id`)
}

/*
 * `core` is the one that cannot be switched off, and it is the one whose
 * absence is dangerous rather than merely wrong: an entitlement check that
 * looks core up in org_features finds no row and must not read that as "off".
 */
const core = FEATURES.find((f) => f.id === 'core')
ok(!!core, 'there is a `core` feature')
ok(core?.always === true, '`core` is marked always, so the Stage 3 check treats it as on without looking')
ok(FEATURES.filter((f) => f.always).length === 1,
  'exactly one feature is `always` — a second unswitchable feature needs its own decision')

/* ---------- the registry ---------- */

const indexSrc = read(INDEX_TS)
const start = indexSrc.indexOf('const REGISTRY:')
ok(start !== -1, 'index.ts still declares `const REGISTRY:`')
const registryBlock = indexSrc.slice(start, indexSrc.indexOf('\n}\n', start))

const entries = [...registryBlock.matchAll(/^  ([a-z_]+): \{ (.*) \},$/gm)]
  .map((m) => ({ action: m[1], body: m[2] }))

/*
 * TWO COUNTS THAT MUST AGREE, because a floor is not a guard.
 *
 * The strict pattern above needs the whole entry on one line. That is how all
 * 95 are written, but it is a formatting convention, not a rule — and an entry
 * broken across two lines is legal TypeScript that simply falls out of the
 * match. It does not fail anything. It stops being looked at.
 *
 * This was shipped with `entries.length >= 90` in place of the identity below,
 * which is worthless for exactly the case it was meant to cover: reformat one
 * entry across two lines AND delete its feature tag, and the suite reported
 * 187 passed, 0 failed. 94 is comfortably more than 90. A floor cannot catch a
 * single disappearance; only comparing against an independent count can.
 *
 * So the loose pattern counts KEYS regardless of what follows them — two
 * spaces then a name then a colon, which an indented inner property like
 * `    roles:` cannot match — and the two counts must be equal. The diagnosis
 * names the missing actions, because "94 != 95" sends somebody hunting.
 *
 * Raised by kcho-shelter-25, who put it exactly right: adding a field to 95
 * entries is safe, adding it to 94 is the failure that looks like success.
 */
const looseKeys = [...registryBlock.matchAll(/^  ([a-z_]+):/gm)].map((m) => m[1])
const strictKeys = new Set(entries.map((e) => e.action))
const unread = looseKeys.filter((k) => !strictKeys.has(k))

console.log('\nevery action names a feature that exists')
ok(entries.length > 0, 'the REGISTRY parse found at least one action (a zero here means this file stopped reading index.ts)')
ok(unread.length === 0,
  `every registry entry was read: ${looseKeys.length} keys are declared but only ${entries.length} matched the entry pattern` +
  (unread.length ? ` — unread: ${unread.join(', ')}. An entry this file cannot read is an entry it cannot check, and it fails NOTHING` : ''))
ok(looseKeys.length === new Set(looseKeys).size, 'no action is declared twice in the registry')

const used = new Set()
for (const { action, body } of entries) {
  const m = body.match(/feature: '([a-z]+)'/)
  if (!m) { ok(false, `${action} has no feature: — an untagged action becomes core silently, which is always on for every organisation`); continue }
  used.add(m[1])
  ok(featureIds.has(m[1]),
    `${action} names feature "${m[1]}", which is not in features.ts`)
}

console.log('\nevery feature is used by at least one action')
for (const f of FEATURES) {
  ok(used.has(f.id),
    `feature "${f.id}" is declared but no action names it — either it is dead, or an action that should carry it does not`)
}

/*
 * The type must require it. If `feature?:` ever appears, the compiler stops
 * objecting to an untagged action and the loop above becomes the only guard —
 * which is fine until somebody adds an action and does not run the suite.
 */
console.log('\nthe type requires the tag')
const gateSrc = read(GATE_TS)
const specBlock = gateSrc.match(/export interface ActionSpec \{([\s\S]*?)\n\}/)
ok(!!specBlock, 'gate.ts still declares `export interface ActionSpec {`')
ok(/\n\s*feature: FeatureId\b/.test(specBlock?.[1] ?? ''),
  'ActionSpec declares `feature: FeatureId` — required, not `feature?:`')

/*
 * ---------- the two lists that must not drift ----------
 *
 * `seed_tenancy()` in schema.sql grants the seed organisation its features by
 * writing a literal array of ids. That array and this list are the same set
 * written twice, so they will drift — a feature added here and not there is an
 * organisation that cannot use it, and the failure appears as a refusal nobody
 * can explain.
 *
 * `core` is deliberately NOT in the SQL array: it holds no org_features row at
 * all. So the comparison is against the switchable twelve, and this file fails
 * if core ever turns up in the SQL, because a row saying core is true is a row
 * that can be set false.
 */
console.log('\nfeatures.ts and seed_tenancy() in schema.sql name the same features')
const schemaSrc = fs.existsSync(SCHEMA) ? read(SCHEMA) : ''

/*
 * CAPTURE BETWEEN THE TWO DOLLAR-QUOTES, not up to a `$$;`.
 *
 * The first version of this ended the match at /\$\$;/ and was wrong in the
 * worst available way: this codebase closes a function with
 * `end $$ language plpgsql security definer set search_path = public;`, so a
 * bare `$$;` occurs nowhere in schema.sql and the match simply failed. The
 * test then printed "seed_tenancy() was not found", which is exactly what it
 * prints when the function genuinely has not landed yet — so a broken regex
 * and a missing dependency were indistinguishable, and I read the first as
 * the second.
 *
 * It was caught only because a mutation harness appended a second definition
 * that DID end in `$$;`: the non-greedy match then ran from the real function
 * through both, and `array[...]` found the REAL array every time, so four
 * deliberately-wrong stubs all came back green with an identical assertion
 * count. Identical counts across different inputs is the tell.
 */
const seedFn = schemaSrc.match(/create or replace function seed_tenancy\b[\s\S]*?\$\$([\s\S]*?)\$\$/)
ok(schemaSrc.split('create or replace function seed_tenancy').length - 1 <= 1,
  'seed_tenancy() is defined once in schema.sql — two definitions mean the later silently wins')

if (!seedFn) {
  ok(false, 'seed_tenancy() was not found in supabase/schema.sql — it arrives with MT-0, and until it lands this check cannot run (it is not skipped, because a silent skip is how the two lists start drifting)')
} else {
  const arr = seedFn[0].match(/array\s*\[([^\]]*)\]/i)
  ok(!!arr, 'seed_tenancy() grants its features from an array literal this file can read')
  const sqlIds = arr ? [...arr[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) : []
  ok(sqlIds.length > 0, 'the seed_tenancy() feature array parsed to at least one id')

  const switchable = FEATURES.filter((f) => !f.always).map((f) => f.id)
  const inSql = new Set(sqlIds)
  for (const id of switchable) {
    ok(inSql.has(id), `features.ts declares "${id}" but seed_tenancy() does not grant it to the seed organisation`)
  }
  for (const id of sqlIds) {
    ok(featureIds.has(id), `seed_tenancy() grants "${id}", which is not a feature in features.ts`)
    ok(id !== 'core', '`core` must not appear in seed_tenancy() — it holds no org_features row, and a row that says true can be set false')
  }
  ok(sqlIds.length === new Set(sqlIds).size, 'seed_tenancy() does not name the same feature twice')
}

/* ---------- the matcher is tested against a sample, not against the tree ----------
 *
 * Self-testing the entry regex on the real registry proves nothing: if it
 * matched nothing, every loop above would be vacuous and this would be too.
 * So it is run against a fixed sample with a known answer.
 */
console.log('\nthe parse itself')
{
  const sample = [
    "  alpha: { roles: null, kind: 'read', fn: a, feature: 'core' },",
    "  beta: { roles: ADMIN_ONLY, sup: true, kind: 'write', fn: b, feature: 'money' },",
    "  gamma: { roles: ['recorder'], kind: 'bulk', fn: c },",
  ].join('\n')
  const got = [...sample.matchAll(/^  ([a-z_]+): \{ (.*) \},$/gm)].map((m) => m[1])
  ok(got.join(',') === 'alpha,beta,gamma', `the entry matcher reads all three sample entries (got ${got.join(',') || 'nothing'})`)
  const tags = [...sample.matchAll(/feature: '([a-z]+)'/g)].map((m) => m[1])
  ok(tags.join(',') === 'core,money', `the tag matcher reads both tags and does not invent one for the untagged entry (got ${tags.join(',') || 'nothing'})`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
