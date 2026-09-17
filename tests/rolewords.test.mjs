/*
 * The words for people, in the places roles.test.mjs cannot see.
 *
 * A raffle is supported over the phone. When an organiser reads a refusal out
 * loud, the person on the other end has to be able to find that word on their
 * own screen — so the interface saying "Organiser" while the server says
 * "admin" is not a tidiness problem, it is a support call that cannot be
 * resolved. The wire keeps its names (role values, agentId, Held_By_Agent);
 * nobody reads a field name. Only prose aimed at a person is covered here.
 *
 * roles.test.mjs owns the vocabulary itself — that ROLE_WORDS and ROLE_BLURB
 * cover exactly the roles a row may say. wording.test.mjs owns src/. This file
 * takes the three neither reaches: the Apps Script strings, the two backends
 * agreeing with each other, and Burmese completeness across every role word.
 */
import { readFileSync, readdirSync } from 'node:fs'
const ROOT = new URL('..', import.meta.url).pathname
const read = p => readFileSync(ROOT + p, 'utf8')

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

/**
 * Quoted strings, with comments stripped first.
 *
 * A comment saying "the super admin is an environment variable" is written for
 * us and should stay exactly as it is. Only what reaches a volunteer counts,
 * and the cheapest reliable way to tell them apart is to delete the comments
 * and look at what is left in quotes.
 */
function proseOf(src) {
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/([^:'"])\/\/.*$/gm, '$1')
  /*
   * TEMPLATE LITERALS COUNT, and leaving them out was a hole the size of the
   * backend. Every refusal in the Edge Function written with backticks — which
   * is most of them, because most name a book or a seller — was invisible to
   * both checks in this file: the banned-word scan never read them, and the
   * assertion that SOMETHING names the top role could not see the one sentence
   * that does.
   *
   * The `${…}` holes are replaced with a space rather than removed, so two
   * words either side of a value do not run together into a third.
   */
  return [...code.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)]
    .map(m => m[1] ?? m[2] ?? m[3])
    .map(t => t.replace(/\$\{[^}]*\}/g, ' '))
}

/**
 * Wire words in prose. Each is a word the app never puts on screen, so a person
 * reading it has nowhere to look it up.
 *
 * "admin" is deliberately matched with a leading article or possessive rather
 * than bare: `role === 'admin'` and `ADMIN_ONLY` are the wire and are correct,
 * while "an admin", "the admin" and "super admin" are somebody being described.
 */
const BANNED = [
  [/\b(an|the|any|a)\s+admins?\b/i, 'an/the admin'],
  [/\bsuper\s*admins?\b/i, 'super admin'],
  [/\badministrator\b/i, 'administrator'],
  // 'agent' lowercase only: "the Agents tab" is the literal name of a sheet
  // and cannot be reworded, while "an agent user" is somebody being described.
  [/\b(?:[Aa]n?|[Tt]he|[Aa]ny)\s+agents?\b/, 'an/the agent'],

  // NOT wire words — previous ANSWERS. The top role has been called super
  // admin, then owner, then System Admin, all in a day. A wire-word list would
  // never catch "owner" creeping back, because to anybody who was not present
  // for the reversals it reads as perfectly correct prose. After two renames
  // the stale answer is the likelier regression, not the database word.
  [/\bowners?\b/i, 'owner (a previous answer — the word is System Admin)'],
  [/\b(?:an|the|any|a)\s+organisers?\b(?=[^.]*\bsigns? in\b)/i,
    'organiser used where System Admin is meant'],
]

/** What the top role is called this week, read rather than retyped. */
const { ROLE_WORDS: RW } = await import('../src/lib/format.js')
const TOP_WORD = RW.superadmin

// ---------------------------------------------------------------- 1. server

console.log('the backend calls people what the app calls them')
{
  /*
   * RE-POINTED AT THE EDGE FUNCTION. This scanned `apps_script/*.gs` — so the
   * rule that a refusal must not speak in wire words was enforced on the
   * backend being deleted and never on the one a volunteer actually reads
   * messages from.
   */
  const files = readdirSync(ROOT + 'supabase/functions/api').filter(f => f.endsWith('.ts'))
  ok(files.length >= 9, `read the backend: ${files.length} handler files`)

  const offences = []
  for (const f of files) {
    for (const s of proseOf(read('supabase/functions/api/' + f))) {
      // Sheet and tab names are real objects in the spreadsheet and keep their
      // names; so do role values and the permission column headers.
      if (['admin', 'recorder', 'agent', 'viewer', 'superadmin', 'Agents', 'agents'].includes(s)) continue
      for (const [re, what] of BANNED) if (re.test(s)) offences.push(`${f}: "${s.slice(0, 64)}" (${what})`)
    }
  }
  ok(offences.length === 0, 'wire words in prose:\n      ' + offences.join('\n      '))
}

console.log('and the top role is called what it is called now')
{
  // Asserting the CURRENT word rather than the absence of old ones. A test that
  // only forbids yesterday's vocabulary passes a file that has quietly reverted
  // to the day before yesterday's.
  ok(/^[A-Z]/.test(TOP_WORD), `the top role has a word: ${TOP_WORD}`)

  /*
   * THE WHOLE DIRECTORY, not two files by name. This listed Auth.gs and
   * People.gs because that is where the Apps Script refusals lived; naming
   * files couples the check to a layout when the claim is about a RULE, and
   * this repository has been caught by that three times. The sentence that
   * names the top role is in prizes.ts today and could be anywhere tomorrow.
   */
  const surfaces = readdirSync(ROOT + 'supabase/functions/api')
    .filter(f => f.endsWith('.ts'))
    .map(f => ['supabase/functions/api/' + f, read('supabase/functions/api/' + f)])
  for (const [name, src] of surfaces) {
    const prose = proseOf(src).join(' | ')
    ok(!/\bowner\b/i.test(prose), `${name} still says "owner" to somebody`)
  }

  // At least one of them has to name it, or the refusal a volunteer reads
  // identifies nobody.
  const named = surfaces.some(([, src]) => proseOf(src).some(p => p.includes(TOP_WORD)))
  ok(named, `no backend refusal names the ${TOP_WORD}`)
}

// ------------------------------------------------- 2. the refusal a volunteer reads

console.log('the refusal for the wrong role is written for a person')
{
  /*
   * This compared the INSUFFICIENT_ROLE sentence between the two backends,
   * because the same refusal reaching a volunteer in two wordings is how a
   * support call turns into "well it says something else on mine". There is one
   * wording now, so what is checked is that it EXISTS and is a sentence rather
   * than a role name — which is the half that was ever about the reader.
   */
  const ts = read('supabase/functions/api/tickets.ts')
  const m = ts.match(/'INSUFFICIENT_ROLE',\s*'([^']+)'/)
  ok(!!m, 'there is an INSUFFICIENT_ROLE message')
  const msg = m ? m[1] : ''
  ok(msg.split(' ').length >= 4, `and it is a sentence, not a code: "${msg}"`)
  for (const [re, what] of BANNED) {
    ok(!re.test(msg), `and does not say ${what} to a volunteer: "${msg}"`)
  }
}

// ------------------------------------------------------------- 3. Burmese

console.log('every role word has a Burmese one')
{
  const { ROLE_WORDS } = await import('../src/lib/format.js')
  const { MY } = await import('../src/lib/i18n.js')

  /**
   * Words known to be untranslated, each with the reason. A bare exemption list
   * rots quietly, so this fails BOTH ways: an unlisted gap, and a listed one
   * that has since been translated and should have been taken off the list.
   */
  const NEEDS_A_SPEAKER = {
    'Seller who signs in':
      'Burmese has "Seller" but not this phrase, which has to distinguish a ' +
      'seller who carries books from one who also has a login. Needs a native ' +
      'speaker; inventing it would be worse than leaving it in English.',
  }

  for (const [role, word] of Object.entries(ROLE_WORDS)) {
    const translated = !!MY[word]
    const exempt = word in NEEDS_A_SPEAKER
    if (exempt) {
      ok(!translated,
        `"${word}" is listed as needing a speaker but now HAS a translation — take it off the list`)
    } else {
      ok(translated, `${role} shows as "${word}", which has no Burmese`)
    }
  }
  ok(Object.keys(NEEDS_A_SPEAKER).every(w => Object.values(ROLE_WORDS).includes(w)),
    'the exemption list names a word that is no longer a role word')
}

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
