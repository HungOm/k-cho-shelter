/*
 * THE CODE ITSELF: what it is made of, and how it is compared.
 *
 * Small file, high stakes. Everything about whether a forged ticket can be told
 * from a real one rests on two properties — that a code cannot be predicted,
 * and that comparing one does not leak how nearly right a guess was.
 *
 * Both are the kind of thing that keeps working while being wrong. A generator
 * seeded from the clock produces codes that look perfectly random in a test and
 * can be continued by anybody who has one ticket. A comparison with `===`
 * passes every functional test there is and hands an attacker the code one
 * character at a time. So these are asserted directly rather than through
 * anything that uses them.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const tc = await loadModule('../_shared/ticketcode.ts')

console.log('a code is made of characters a person can read back over the phone')
{
  const code = tc.newCode()
  eq(code.length, tc.DEFAULT_LENGTH, `the default length is ${tc.DEFAULT_LENGTH}`)
  /*
   * Crockford's base32: the digits and the capitals, less I, L, O and U. I and
   * L look like 1, O looks like 0, and U is dropped so the alphabet cannot
   * spell an unfortunate word by accident. It matters because the code is not
   * only scanned — it is printed under the QR and read out loud when a ticket
   * is torn.
   */
  ok(/^[0-9A-HJKMNP-TV-Z]+$/.test(code), `it uses only unambiguous characters (${code})`)
  ok(!/[ILOU]/.test(tc.newCode(32)), 'I, L, O and U never appear')
  eq(tc.newCode(20).length, 20, 'a length can be asked for')
  // Bounded both ways: a one-character code is not a code, and a 400-character
  // one would not fit in the QR it has to be printed in.
  ok(tc.newCode(1).length >= 8, 'an absurdly short length is raised to something safe')
  ok(tc.newCode(1000).length <= 32, 'and an absurdly long one is capped')
}

console.log('a code cannot be predicted from other codes')
{
  /*
   * Ten thousand codes, all different. This does not prove the source is
   * cryptographic — nothing here can — but it does catch the failure that
   * actually happens, which is a generator that repeats or that walks in
   * sequence. A seeded PRNG producing duplicates inside ten thousand draws is
   * the visible end of "predictable".
   */
  const seen = new Set()
  for (let i = 0; i < 10000; i++) seen.add(tc.newCode())
  eq(seen.size, 10000, 'ten thousand codes are ten thousand different codes')

  // Not sequential, and not sharing a prefix: both are what a clock-derived or
  // counter-derived generator looks like.
  const a = tc.newCode(), b = tc.newCode()
  ok(a.slice(0, 6) !== b.slice(0, 6), 'consecutive codes do not share an opening')

  /*
   * Every position uses the whole alphabet. A generator that is biased — the
   * classic being `% alphabet.length` over a range that is not a whole multiple
   * of it — shows up as some characters appearing far more often than others.
   * 32 divides 256 exactly, so this should be flat.
   */
  const counts = new Map()
  for (let i = 0; i < 2000; i++) {
    const c = tc.newCode(16)[0]
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  ok(counts.size >= 28, `the first character takes ${counts.size} of 32 possible values`)
  const most = Math.max(...counts.values())
  ok(most < 2000 / 32 * 3, 'and no character dominates it')
}

console.log('comparing a code does not say how nearly right it was')
{
  const code = 'ABCDEFGH01234567'
  ok(tc.equalCodes(code, code), 'a code equals itself')
  ok(!tc.equalCodes(code, 'ABCDEFGH01234568'), 'one character different is different')
  ok(!tc.equalCodes(code, 'BBCDEFGH01234567'), 'including the first character')
  ok(!tc.equalCodes(code, ''), 'and nothing at all is different')
  ok(!tc.equalCodes(code, code + 'X'), 'a longer string is different')
  ok(!tc.equalCodes(code, code.slice(0, 15)), 'and a shorter one')
  ok(tc.equalCodes('', ''), 'two empties are equal, which the caller must not treat as a pass')

  /*
   * The property that matters, asserted on the source rather than by timing.
   *
   * A timing assertion here would be flaky on a shared machine and would tell
   * us about the JIT rather than about the algorithm. What can be checked
   * exactly is that the implementation has no early exit: it accumulates a
   * difference across the whole length and decides once at the end. An `if`
   * that returns inside the loop is the bug, and it is visible.
   */
  const src = tc.equalCodes.toString()
  ok(!/return\s+(true|false)/.test(src.slice(src.indexOf('for'))),
    'there is no early return inside the comparison loop')
  ok(/\|=|\^/.test(src), 'the difference is accumulated bitwise rather than short-circuited')
}

console.log('what was scanned becomes the number the raffle stores')
{
  const cfg = { prefix: 'KS-', digits: 5 }
  eq(tc.canonicalNumber('KS-03291', cfg), 'KS-03291', 'an exact number is itself')
  eq(tc.canonicalNumber('ks-03291', cfg), 'KS-03291', 'lower case is the same ticket')
  eq(tc.canonicalNumber(' KS-03291 ', cfg), 'KS-03291', 'and so is one with spaces round it')
  /*
   * The useful one: a number typed by hand and a number carried by a QR must
   * land on the same ticket. "3291" is what somebody reads off a torn stub.
   */
  eq(tc.canonicalNumber('3291', cfg), 'KS-03291', 'bare digits are padded and given the prefix')
  eq(tc.canonicalNumber('03291', cfg), 'KS-03291', 'already-padded digits too')

  eq(tc.canonicalNumber('', cfg), null, 'nothing is not a ticket')
  eq(tc.canonicalNumber('   ', cfg), null, 'nor whitespace')
  eq(tc.canonicalNumber('KS-ABC', cfg), null, 'nor letters where digits belong')
  // The shape guard: this value reaches a database query, and an endpoint
  // anybody can reach should refuse rubbish as cheaply as possible.
  eq(tc.canonicalNumber("KS-1' or 1=1--", cfg), null, 'nor anything with punctuation in it')
  eq(tc.canonicalNumber('KS-' + '9'.repeat(40), cfg), null, 'nor something absurdly long')

  const noPrefix = { prefix: '', digits: 4 }
  eq(tc.canonicalNumber('7', noPrefix), '0007', 'a raffle with no prefix still pads')
  eq(tc.canonicalNumber('0007', noPrefix), '0007', 'and leaves a padded number alone')
}

console.log('a code is checked for shape before it is checked for truth')
{
  ok(tc.looksLikeCode('ABCDEFGH01234567'), 'a real code looks like one')
  ok(!tc.looksLikeCode(''), 'nothing does not')
  ok(!tc.looksLikeCode('short'), 'nor something too short')
  ok(!tc.looksLikeCode('ABCDEFGH0123456!'), 'nor anything outside the alphabet')
  ok(!tc.looksLikeCode('ABCDEFGHI1234567'), 'nor a character the alphabet deliberately drops')
  ok(!tc.looksLikeCode('A'.repeat(40)), 'nor something absurdly long')
  ok(!tc.looksLikeCode(null), 'nor nothing at all')
}

console.log(`\n${pass} passed, ${fail} failed`)
cleanup()
process.exit(fail ? 1 : 0)
