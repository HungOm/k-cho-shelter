/*
 * THE SAMPLE BOOK, AND THE ONE THING IT MUST NEVER DO.
 *
 * Ten tickets somebody can print to show a committee, teach a volunteer, or
 * test a printer's registration, without spending a real ticket number.
 *
 * WHAT IS ACTUALLY AT RISK HERE is not the printing. It is that a sample is a
 * piece of paper anybody with the app can produce, and the check page is what
 * a buyer trusts. If a sample ever rendered as genuine, the sample book would
 * become a forgery kit aimed at precisely the attack the stored code was
 * introduced to stop — a plausible number on paper that nothing can contradict.
 * So the properties pinned below are mostly about the ways a sample must FAIL.
 *
 * The second theme is that a sample has no row anywhere. Not in tickets, not
 * in books, not in ticket_codes. Every figure in this app is derived from the
 * tickets table, and "every count except samples" is the shape AUDIT.md §X
 * records as three defects in one day. There is nothing to exclude here
 * because there is nothing to count, and the test for that is that no SQL and
 * no server file has ever heard the word.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SAMPLE_PREFIX, SAMPLE_COUNT, SAMPLE_BOOK,
  sampleNumber, sampleCode, sampleBook, sampleVerifyUrl, sampleFromSearch,
} from '../src/verify/sample.js'
import { numberLayerSVG, watermarkSVG } from '../src/lib/ticketart.js'
import { DEFAULT_DESIGN, designFor } from '../src/lib/ticketdesign.js'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const read = (f) => readFileSync(join(ROOT, f), 'utf8')

console.log('the book is ten tickets and always the same ten')
{
  const book = sampleBook()
  eq(book.length, SAMPLE_COUNT, 'ten tickets')
  eq(book[0].number, 'Sample-001', 'first')
  eq(book[9].number, 'Sample-010', 'last')
  eq(new Set(book.map((t) => t.code)).size, SAMPLE_COUNT, 'every code is different')
  ok(book.every((t) => t.book === SAMPLE_BOOK), 'all in one book')
  ok(book.every((t) => /^[0-9A-HJKMNP-TV-Z]{12}$/.test(t.code)),
    'codes are twelve Crockford characters, like a real one')
  // Printed paper outlives the browser that drew it: the same ticket has to
  // produce the same code next year or a reprint disagrees with the stub.
  ok(sampleBook().every((t, i) => t.code === book[i].code), 'stable across calls')
  eq(sampleCode('Sample-001'), book[0].code, 'and derived, not stored')
  eq(sampleNumber(7), 'Sample-007', 'padded to three')
}

console.log('the QR marker cannot be mistaken for a ticket lookup')
{
  const url = sampleVerifyUrl('https://example.org', 'Sample-001')
  const query = url.split('?')[1]
  /*
   * The page forwards anything shaped <number>.<code> to the server. A dot in
   * a sample address would mean a lookup, a miss, and a demonstration ticket
   * shown to somebody in red as if they had forged it.
   */
  ok(!query.includes('.'), 'no dot, so the lookup path cannot claim it')
  eq(sampleFromSearch('?' + query), 'Sample-001', 'and the page reads it back')
  ok(url.startsWith('https://example.org/?'), 'points at the check page')
}

console.log('it fails in the safe direction')
{
  // Strip the marker and you get a lookup for a ticket that does not exist,
  // which answers "not a valid ticket". That is the right way to be wrong.
  eq(sampleFromSearch('?Sample-001.E4TY26GY41AC'), '', 'marker removed is not a sample')
  eq(sampleFromSearch('?t=Sample-001&c=E4TY26GY41AC'), '', 'nor the readable lookup form')
  eq(sampleFromSearch('?s=KS-00001'), '', 'a real ticket number is never a sample')
  eq(sampleFromSearch('?s=Sample-01'), '', 'nor a number of the wrong shape')
  eq(sampleFromSearch('?s='), '', 'nor an empty one')
  eq(sampleFromSearch(''), '', 'nor an address with nothing in it')
  eq(sampleFromSearch('?s=%2E%2E%2Fetc'), '', 'nor anything smuggled through encoding')
}

console.log('the page answers a sample itself, and never in green')
{
  const main = read('src/verify/main.js')
  const at = (needle) => main.indexOf(needle)
  ok(at('sampleFromSearch(') > -1, 'the page recognises the marker')
  /*
   * BEFORE params(), or params() hands it to the server — which is both a
   * request that cannot succeed and a red verdict on a sample.
   */
  ok(at('sampleFromSearch(') < at('const p = params()'), 'and does so before the lookup path')
  const branch = main.slice(at('sampleFromSearch('), at('const p = params()'))
  ok(/panel\('sample'/.test(branch), "it renders the sample tone")
  ok(!/fetch\(/.test(branch), 'without asking the server anything')
  ok(/\breturn\b/.test(branch), 'and stops there')
  // The property ff asked to have pinned: a sample is never the good tone.
  ok(!/panel\('good'/.test(branch), 'a sample link never renders as genuine')
  ok(/tone === 'sample' \? '✱'/.test(main), 'the sample mark is its own, not the tick')
  ok(read('src/verify/verify.css').includes('.sample .mark'), 'and has its own colour')
  // Both languages, like every other verdict on this page.
  const strings = read('src/verify/strings.js')
  for (const key of ['sampleHead', 'sampleNote']) {
    ok(new RegExp(`${key}:\\s*\\{[\\s\\S]{0,400}?my:`).test(strings), `${key} carries Burmese`)
  }
}

console.log('the watermark is drawn, and drawn where it does no harm')
{
  for (const [name, design] of [['legacy', DEFAULT_DESIGN], ['elements', designFor(null)]]) {
    const layer = numberLayerSVG(design, 'Sample-001', { watermark: 'SAMPLE', book: SAMPLE_BOOK })
    ok(/SAMPLE/.test(layer), `${name}: the watermark is there`)
    ok(/Sample-001/.test(layer), `${name}: and the number survives it`)
    /*
     * Painted before the codes on purpose: qrLayer lays a white rectangle
     * under every QR, so a watermark drawn first is punched out from under it
     * and the code still scans. Drawn after, it is a diagonal stroke across
     * modules about 0.39mm wide.
     */
    ok(layer.indexOf('rotate(') < layer.lastIndexOf('Sample-001'),
      `${name}: painted before the number and the codes`)
    ok(!/textLength/.test(watermarkSVG(design, 'SAMPLE')),
      `${name}: no pinned width on text nobody measured`)
    const plain = numberLayerSVG(design, 'KS-00001', {})
    ok(!/SAMPLE/.test(plain), `${name}: a real ticket gets no watermark`)
  }
  const wm = watermarkSVG(DEFAULT_DESIGN, 'SAMPLE')
  // The main half is dark and the stub is white; one ink cannot read on both.
  eq((wm.match(/<svg /g) || []).length, 2, 'drawn once per half of the ticket')
  ok(/#ffffff/.test(wm) && /#111111/.test(wm), 'with a light ink and a dark one')
  const angle = Number((wm.match(/rotate\((-?[\d.]+)/) || [])[1])
  ok(angle < -10 && angle > -25, `follows the ticket's own diagonal (${angle}°), not 45°`)
  eq(watermarkSVG(DEFAULT_DESIGN, ''), '', 'and nothing at all when not asked for')
}

console.log('the stub boundary comes from the design, never from a copy of it')
{
  /*
   * stubAt was 0.6875 for a day, taken from a mockup rather than measured off
   * the artwork, and the real perforation is at 0.7394 — 83px further right.
   * Six files had the old number written into them as a fallback and none of
   * them moved when it was corrected. Here the cost was quiet: the strip
   * between the two values got the stub's near-black ink on the buyer's DARK
   * half, so five per cent of the ticket width carried a watermark nobody
   * could see and nobody would report.
   *
   * So this asserts the property rather than the number — a design that does
   * not carry stubAt must land wherever the real default landed, whatever
   * that becomes next time somebody measures it.
   */
  const bare = { artwork: { width: 1600, height: 517 } }
  const splitOf = (d) => [...watermarkSVG(d, 'SAMPLE').matchAll(/<svg x="([\d.]+)"/g)].map((m) => Number(m[1]))[1]
  eq(splitOf(bare).toFixed(1), splitOf(DEFAULT_DESIGN).toFixed(1),
    'a design with no stubAt splits where the real default splits')
  /*
   * Read the CODE, not the prose. The first version of this check matched the
   * comment above the fix — which explains the old value by name — and failed
   * on a file that was correct. A guard that cannot tell an explanation from
   * an instruction is one somebody switches off.
   */
  const renderer = readFileSync(join(ROOT, 'src/lib/ticketart.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  ok(!/stubAt\s*\?\?\s*0\.6875/.test(renderer),
    'and the old value is not written into the renderer as a fallback')
  ok(/stubShare\(design\)/.test(renderer),
    'the boundary is asked for through stubShare, which owns the default AND the clamp')
  ok(!/Math\.min\(width, width \*/.test(renderer),
    'and the renderer no longer keeps a clamp of its own to disagree with it')
  // The QR must clear the cut, or the buyer's half arrives with half a code on
  // it — which is how the boundary was found to be wrong in the first place.
  const qr = DEFAULT_DESIGN.qrMain
  ok(qr.x + qr.size < DEFAULT_DESIGN.stubAt * 1600,
    `the QR (${qr.x}..${qr.x + qr.size}) clears the cut at ${Math.round(DEFAULT_DESIGN.stubAt * 1600)}`)
}

console.log('the layer is well-formed XML, and says so where node can check it')
{
  /*
   * THIS IS THE TEST THAT WOULD HAVE CAUGHT IT, AND THE SUITE COULD NOT.
   *
   * The family was emitted with JSON.stringify, which escapes the quotes
   * inside TEXT_FAMILY as \" — meaningless in XML. The attribute ends at the
   * first real quote and the document is malformed. Node never parses the SVG
   * it builds, so every assertion here passed while the output was broken;
   * only a browser finds it, and then only sometimes: inline in HTML the
   * parser is lenient and silently falls back to a default font, while the
   * same string as a data: URI is strict XML, fails to load, and takes the
   * digital ticket's canvas export down with it — into a fallback that looks
   * like ordinary behaviour.
   *
   * So the invariant is checked on the STRING: this file emits no backslash
   * anywhere, ever. textEl has always quoted the family with single quotes for
   * this exact reason, 480 lines above where it was got wrong.
   */
  for (const [name, design] of [['legacy', DEFAULT_DESIGN], ['elements', designFor(null)]]) {
    const layer = numberLayerSVG(design, 'Sample-001', { watermark: 'SAMPLE', book: SAMPLE_BOOK })
    ok(!layer.includes('\\'), `${name}: no backslash — an XML attribute cannot escape a quote`)
    ok(/font-family='[^']*'/.test(layer), `${name}: the family is single-quoted, so its own quotes survive`)
  }

  /*
   * A WATERMARK IN BURMESE MUST NOT TAKE THE SHEET WITH IT. advanceOf raises
   * on any glyph it has no measured width for, which is all of them here, and
   * "နမူနာ" is the obvious thing to ask for on a ticket that is bilingual
   * everywhere else. The number it feeds is only a repeat count.
   */
  for (const label of ['နမူနာ', 'SAMPLE', 'ГОБРАЗЕЦ', '見本']) {
    let out = null
    try { out = watermarkSVG(DEFAULT_DESIGN, label) } catch (e) { out = null }
    ok(out !== null && out.length > 0, `a watermark reading "${label}" renders instead of throwing`)
  }
}

console.log('the two halves were measured, not guessed')
{
  /*
   * White at 0.24 on the dark half is a stroke of about 33 by mean luma;
   * matching it on the white stub takes 0.18. 0.13 looks right on screen and
   * leaves the stub at three-quarters the weight, and grayscale widens the
   * gap rather than closing it. Pinned so that changing either is a decision
   * somebody re-measures rather than an eye-balled tidy-up.
   */
  const ops = [...watermarkSVG(DEFAULT_DESIGN, 'SAMPLE').matchAll(/fill-opacity="([\d.]+)"/g)].map((m) => m[1])
  eq(ops.length, 2, 'one opacity per half')
  eq(ops[0], '0.24', 'the dark half')
  eq(ops[1], '0.18', 'the stub, measured to match it')
  ok(ops[0] !== ops[1], 'and they are not the same number, because the paper is not')
}

console.log('a sample is written down nowhere')
{
  /*
   * The whole safety argument rests on this. If a sample ever became a row,
   * every count in the app would need to know to skip it.
   */
  const serverFiles = []
  const walk = (d) => {
    for (const e of readdirSync(join(ROOT, d), { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name))
      else if (/\.(ts|sql)$/.test(e.name)) serverFiles.push(join(d, e.name))
    }
  }
  walk('supabase')
  ok(serverFiles.length > 20, `${serverFiles.length} server files checked`)
  for (const f of serverFiles) {
    ok(!/Sample-\d|sampleBook|SAMPLE_PREFIX/.test(read(f)),
      `${f} knows nothing about samples`)
  }
  // And the print screen asks the server for artwork only — never to make one.
  const print = read('src/components/modals/PrintTickets.vue')
  ok(/loadSample/.test(print), 'the print screen builds the batch itself')
  const fn = print.slice(print.indexOf('async function loadSample'), print.indexOf('function look()'))
  ok(/render_tickets/.test(fn) && !/generate_tickets/.test(fn),
    'reading the artwork, never generating anything')
  ok(/sampleVerifyUrl/.test(print), 'and prints the marker into the QR')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
