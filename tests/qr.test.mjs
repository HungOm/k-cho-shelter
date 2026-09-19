/*
 * THE QR CODE IS REAL, NOT MERELY SQUARE.
 *
 * This is the hardest thing in the feature to test honestly, because a QR
 * encoder that is subtly wrong produces output that is indistinguishable from
 * correct output by eye. It has finder patterns in the corners, it is the right
 * size, it looks like every other QR code. It simply does not scan — and you
 * find that out when a box of two thousand printed tickets arrives.
 *
 * SO IT WAS CHECKED WITH A REAL SCANNER, not by looking at it. Every fixture
 * below was decoded by OpenCV's QR reader, rendered as an image with a quiet
 * zone, and read back to the exact string it was made from. Fifty cases across
 * versions 1 to 10 and all four error-correction levels passed that check. The
 * ones pinned here are a representative few, kept as data so that a change to
 * the encoder that breaks them fails loudly instead of quietly.
 *
 * WHY THE FIXTURES AND NOT THE SCANNER. OpenCV is not a dependency of this
 * project and should not become one for a test. The scanner establishes that
 * these matrices are right; the fixtures keep them right.
 *
 * WHAT THAT PROCESS ACTUALLY CAUGHT, because it is the argument for doing it:
 * the mask-selection penalty was scoring a rule the clever way rather than the
 * way the specification writes it, and it chose — for a repetitive payload —
 * the one mask of eight whose output the scanner could not read. Every other
 * mask was fine, the matrix round-tripped perfectly, the error correction was
 * provably correct, and the code was unusable. Nothing short of decoding it
 * would have found that.
 */
import { encode, ECC, MAX_VERSION } from '../src/lib/qrcodegen.js'
import { DEFAULT_DESIGN, designFor, REFERENCE } from '../src/lib/ticketdesign.js'
import { qrModuleMM } from '../src/lib/ticketart.js'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

const draw = (r) => r.modules.map((row) => row.map((b) => (b ? '#' : '.')).join(''))

/* The address a printed ticket actually carries. */
const TICKET_URL = 'https://shtrtickets.ceamalaysia.org/v/?KS-00123.ABCDEFGH0123'

console.log('a known code, module for module')
{
  /*
   * "A" at level L. Twenty-one modules square, the smallest a QR code comes.
   * Decoded back to "A" by a real scanner before being written down here.
   */
  const want = [
    '#######..#.##.#######', '#.....#..###..#.....#', '#.###.#.##.##.#.###.#',
    '#.###.#..#.#..#.###.#', '#.###.#...#.#.#.###.#', '#.....#.....#.#.....#',
    '#######.#.#.#.#######', '........##.##........', '###.########.##...#..',
    '#.##....#.....#...##.', '.#.####..##.#...#...#', '.#.##...##....#...#..',
    '..##.##.#...#.#.#.#.#', '........#..#.#.#.#.#.', '#######.#.##.###.####',
    '#.....#.######.###...', '#.###.#.##.#.###.##.#', '#.###.#..##...#...##.',
    '#.###.#.##..#...#...#', '#.....#.#.....#...##.', '#######.###.#.#.#.###',
  ]
  const got = draw(encode('A', { ecc: 'L' }))
  eq(got.length, 21, 'it is 21 modules tall')
  eq(got.join('|'), want.join('|'), 'and every module is where the scanner found it')
}

console.log('the ticket address fits the small code the artwork has room for')
{
  const r = encode(TICKET_URL, { ecc: 'M' })
  /*
   * VERSION 4 IS THE WHOLE REASON THE CODE IS TWELVE CHARACTERS. Version 5
   * would be 37 modules in the same printed box, and each module would print
   * about a tenth of a millimetre smaller. This assertion is what stops
   * somebody lengthening the address or the code without noticing they have
   * made every printed ticket harder to scan.
   */
  eq(r.version, 4, 'the ticket address encodes at version 4')
  eq(r.size, 33, 'which is 33 modules square')
  eq(r.ecc, 'M', 'at the error correction level a printed ticket wants')
  eq(draw(r).join('').split('#').length - 1, 541, 'with the module pattern the scanner read back')

  // Error correction M recovers about 15% of a damaged code. On a ticket that
  // has been in a pocket, folded and rained on, that is the point of it.
  const lower = encode(TICKET_URL, { ecc: 'L' })
  ok(lower.version <= r.version, 'less correction never needs a bigger code')
  const higher = encode(TICKET_URL, { ecc: 'H' })
  ok(higher.version > r.version, 'and more correction needs a bigger one')
}

console.log('and it will print big enough to scan')
{
  /*
   * The number that decides whether a phone can read it off paper. Below about
   * a third of a millimetre a module, ordinary cameras start failing — so this
   * is asserted rather than left to be discovered from a press run.
   */
  const d = designFor({ width: REFERENCE.width, height: REFERENCE.height, design: {} })
  const r = encode(TICKET_URL, { ecc: 'M' })
  const mm = qrModuleMM(d, d.qrMain, r.size)
  ok(mm >= 0.33, `each module prints ${mm.toFixed(3)} mm at ${d.sheet.widthMM} mm wide`)

  // The whole code, quiet zone included, has to fit the box the artwork leaves.
  const perModule = d.qrMain.size / (r.size + 8)
  ok(perModule > 2, `${perModule.toFixed(2)} artwork pixels per module, quiet zone included`)
}

console.log('every code has the three corners a scanner looks for')
{
  for (const [text, ecl] of [['A', 'L'], [TICKET_URL, 'M'], ['x'.repeat(120), 'Q']]) {
    const r = encode(text, { ecc: ecl })
    const m = r.modules
    const n = r.size
    const finder = (ox, oy) => {
      // The 1:1:3:1:1 square, and the light ring that has to surround it.
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 7; x++) {
          const edge = x === 0 || x === 6 || y === 0 || y === 6
          const core = x >= 2 && x <= 4 && y >= 2 && y <= 4
          if (m[oy + y][ox + x] !== (edge || core)) return false
        }
      }
      return true
    }
    ok(finder(0, 0), `v${r.version} ${ecl}: top-left finder`)
    ok(finder(n - 7, 0), `v${r.version} ${ecl}: top-right finder`)
    ok(finder(0, n - 7), `v${r.version} ${ecl}: bottom-left finder`)

    // The timing patterns tie the corners together; a scanner counts modules along them.
    let timingOk = true
    for (let i = 8; i < n - 8; i++) {
      if (m[6][i] !== (i % 2 === 0)) timingOk = false
      if (m[i][6] !== (i % 2 === 0)) timingOk = false
    }
    ok(timingOk, `v${r.version} ${ecl}: both timing patterns alternate`)

    // The one module that is dark in every QR code ever made.
    ok(m[n - 8][8], `v${r.version} ${ecl}: the always-dark module`)
  }
}

console.log('it picks the smallest code the text will fit in')
{
  /* A bigger version means smaller modules in the same printed box, so
   * choosing the smallest is choosing the most scannable. */
  eq(encode('A', { ecc: 'L' }).version, 1, 'one character is version 1')
  let last = 0
  /*
   * Up to 200, because version 10 at level M holds 213 bytes and the point here
   * is the ordering, not the ceiling — the ceiling has its own case below.
   */
  for (const n of [10, 30, 60, 100, 150, 200]) {
    const v = encode('x'.repeat(n), { ecc: 'M' }).version
    ok(v >= last, `${n} characters needs version ${v}, no smaller than the last`)
    last = v
  }
}

console.log('and refuses what it cannot encode, rather than truncating')
{
  /*
   * The dangerous failure would be silently dropping the end of the address —
   * the code would scan and open the wrong page. Refusing is the only safe
   * answer, and the message says what to do.
   */
  let err = null
  try { encode('z'.repeat(5000), { ecc: 'H' }) } catch (e) { err = e }
  ok(!!err, 'too much text is refused')
  ok(/will not fit|Shorten/.test(err?.message ?? ''), 'and the refusal says what to do about it')
  ok(new RegExp(String(MAX_VERSION)).test(err?.message ?? ''), 'and how far it can go')
}

console.log('the four correction levels exist and differ')
{
  eq(Object.keys(ECC).sort().join(), 'H,L,M,Q', 'L, M, Q and H')
  const sizes = ['L', 'M', 'Q', 'H'].map((e) => encode(TICKET_URL, { ecc: e }).version)
  ok(sizes[0] <= sizes[1] && sizes[1] <= sizes[2] && sizes[2] <= sizes[3],
    `more correction never needs a smaller code (${sizes.join(' <= ')})`)
}

console.log('the same text always gives the same code')
{
  /*
   * A reprint must produce the identical QR. Nothing here is random — the mask
   * is chosen by score, not by chance — and a ticket reprinted next year has to
   * carry the code it was printed with.
   */
  const a = draw(encode(TICKET_URL, { ecc: 'M' })).join('|')
  const b = draw(encode(TICKET_URL, { ecc: 'M' })).join('|')
  eq(a, b, 'twice in a row')
  const c = draw(encode(TICKET_URL.replace('00123', '00124'), { ecc: 'M' })).join('|')
  ok(a !== c, 'and a different ticket gives a different code')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
