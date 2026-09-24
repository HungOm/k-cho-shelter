/**
 * Every registered action has a name and a home on the Access screen.
 *
 * `list_permissions` builds that screen from `Object.entries(REGISTRY)` and
 * reads each action's words out of `ACTION_META`:
 *
 *     const m = ACTION_META[action] ?? {}
 *     group: m.group ?? 'Other',
 *     label: m.label ?? action,
 *
 * Both fallbacks are silent and both produce something an organiser can see.
 * An action with no entry appears on the grid as a row labelled with its raw
 * snake_case id, in a card headed "Other" — and Permissions.vue renders
 * `a.group` and `a.label` straight through, so nothing downstream repairs it.
 *
 * THIS HAS HAPPENED BEFORE AND WAS FIXED WITHOUT A GATE. There is a comment
 * above `set_org_contact` in index.ts that says, in capitals, that meta is
 * optional in code and not in practice, and describes this exact failure. Whoever
 * wrote it fixed the one entry they had noticed. Three more were missing at the
 * time or arrived afterwards — `search`, `agent_statement`, and `set_org_about`,
 * which is the immediate sibling of the entry that comment sits on. Nothing in
 * tests/ read ACTION_META at all, so the fix could not hold and did not.
 *
 * That is the reason this file exists rather than three more entries being
 * enough: a defect gets fixed once, a gate keeps finding it.
 *
 * BOTH DIRECTIONS. An action with no meta is a raw id on screen. A meta entry
 * with no action is a label for something that cannot be called — harmless to
 * look at, but it is how a list drifts out of correspondence with the thing it
 * describes, and the next person cannot tell which of the two is wrong.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const INDEX = path.join(ROOT, 'supabase/functions/api/index.ts')

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const src = fs.readFileSync(INDEX, 'utf8')

/** The object literal between `const NAME` and the first line that is just `}`. */
function objectBlock(name) {
  const start = src.indexOf(`const ${name}`)
  if (start === -1) return null
  const end = src.indexOf('\n}\n', start)
  return end === -1 ? null : src.slice(start, end)
}

/*
 * KEYS ARE READ WITHOUT READING THE BODY, deliberately.
 *
 * A pattern that requires the whole entry on one line is a pattern that stops
 * seeing an entry somebody reformats across two — and an entry it cannot see
 * fails nothing at all. That exact hole shipped in features.test.mjs a few
 * hours before this file was written: a floor of `>= 90` against 95 entries
 * could not tell 94 from 95, so deleting a field from a reformatted entry gave
 * 187 passed, 0 failed.
 *
 * So the key pattern here needs only two spaces, a name and a colon, which an
 * indented inner property (`    roles:`) cannot match whatever the formatting.
 */
const keysOf = (block) => [...block.matchAll(/^  ([a-z_]+):/gm)].map((m) => m[1])

const registryBlock = objectBlock('REGISTRY')
const metaBlock = objectBlock('ACTION_META')

console.log('both lists can be read at all')
ok(!!registryBlock, 'index.ts still declares `const REGISTRY`')
ok(!!metaBlock, 'index.ts still declares `const ACTION_META`')
if (!registryBlock || !metaBlock) { console.log(`\n${pass} passed, ${fail} failed`); process.exit(1) }

const actions = keysOf(registryBlock)
const metas = keysOf(metaBlock)

ok(actions.length > 0, 'the REGISTRY parse found at least one action (a zero means this file stopped reading index.ts)')
ok(metas.length > 0, 'the ACTION_META parse found at least one entry (a zero means this file stopped reading index.ts)')
ok(actions.length === new Set(actions).size, 'no action is registered twice')
ok(metas.length === new Set(metas).size, 'no action has two ACTION_META entries')

const metaSet = new Set(metas)
const actionSet = new Set(actions)

console.log('\nevery registered action has words of its own')
const unnamed = actions.filter((a) => !metaSet.has(a))
ok(unnamed.length === 0,
  `these actions have no ACTION_META entry, so the Access screen shows their raw ids under "Other": ${unnamed.join(', ')}`)

console.log('\nevery ACTION_META entry describes something that exists')
const orphan = metas.filter((m) => !actionSet.has(m))
ok(orphan.length === 0,
  `these ACTION_META entries name no registered action: ${orphan.join(', ')}`)

/*
 * The labels themselves, because an entry that exists but repeats the id is the
 * same row on screen as no entry at all — and it passes the check above.
 */
console.log('\nthe words are words, not ids')
for (const m of metaBlock.matchAll(/^  ([a-z_]+): \{ group: '([^']*)', label: '((?:[^'\\]|\\.)*)'/gm)) {
  const [, action, group, label] = m
  ok(group !== 'Other',
    `${action} is filed under "Other", which is the fallback group and not a place to put something on purpose`)
  ok(label !== action,
    `${action}'s label is its own id, which is exactly what the missing-entry fallback produces`)
  ok(!/^[a-z]+(_[a-z]+)+$/.test(label),
    `${action}'s label "${label}" is snake_case, so it reads as a slug rather than as something an organiser would say`)
}

/* The matcher, against a sample with a known answer rather than against the
 * tree — self-testing on the real file proves nothing, because if it matched
 * nothing then every loop above was vacuous and so is this. */
console.log('\nthe parse itself')
{
  const sample = [
    "const X: Record<string, unknown> = {",
    "  alpha: { group: 'Basics', label: 'Do a thing' },",
    "  beta: {",
    "    group: 'Money', label: 'Another thing',",
    "  },",
    "    roles: ['recorder'],",
    "}",
  ].join('\n')
  const got = [...sample.matchAll(/^  ([a-z_]+):/gm)].map((m) => m[1])
  ok(got.join(',') === 'alpha,beta',
    `the key matcher reads a one-line entry AND a reformatted one, and ignores an indented inner property (got ${got.join(',') || 'nothing'})`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
