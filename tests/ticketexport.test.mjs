/*
 * One sample ticket as a file is the size it prints, and says what it lost.
 *
 * WHY THIS IS NEEDED. src/lib/ticketexport.js lets the studio hand over a
 * sample ticket as a 300 dpi PNG or an SVG. Its failures are all quiet ones:
 *
 *   the wrong pixel count is a proof that prints soft or at the wrong size,
 *     and nobody measures a PNG before sending it to a print shop;
 *   an <image href="https://…"> inside an SVG drawn through an <img> is
 *     sandboxed and draws as NOTHING, so a placed logo vanishes from the PNG
 *     without an error — hence inlining, and hence reporting what could not be
 *     inlined rather than handing over a ticket with a hole in it;
 *   the element layer nested twice-sized, or not sized at all, is a file whose
 *     fields sit somewhere other than where the studio drew them.
 *
 * WHAT THIS CANNOT DO. It does not open a browser, so the canvas pass
 * (`rasterise`) is not run here. The one fact that pass depends on — that the
 * artwork bucket answers with `Access-Control-Allow-Origin: *`, so the canvas
 * is not tainted — was checked against the hosted project on 2026-09-23 and is
 * recorded in STUDIO-ESSENTIALS.md Phase 6.
 */
import { exportSize, ticketSVG, layerDocument, inlineImages } from '../src/lib/ticketexport.js'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

const LAYER = '<svg class="numbers" viewBox="0 0 1600 517" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">'
  + '<text x="10" y="20">KS-00001</text><image href="https://x.org/logo.png" x="0" y="0" width="10" height="10"/></svg>'

console.log('the file is the size the ticket prints')
{
  const s = exportSize(190, 1600, 517, 300)
  eq(s.width, 2244, '190 mm at 300 dpi is 2244 pixels across')
  eq(s.height, Math.round(2244 * 517 / 1600), 'and as tall as the artwork\'s own shape makes it')
  eq(exportSize(0, 1600, 517).width, 0, 'no printed width, no picture')
  eq(exportSize(190, 0, 517).width, 0, 'and no artwork shape, no picture')
}

console.log('the SVG is one document: paper, artwork, then the studio\'s layer')
{
  const svg = ticketSVG({ layer: LAYER, artworkHref: 'https://x.org/art.png', artWidth: 1600, artHeight: 517,
    width: '190.00mm', height: '61.39mm' })
  ok(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 1600 517" width="190.00mm" height="61.39mm">/.test(svg),
    'a rooted document, sized in millimetres so it opens at print size')
  ok(svg.indexOf('<rect') < svg.indexOf('<image href="https://x.org/art.png"'), 'white paper under the artwork')
  ok(svg.indexOf('art.png') < svg.indexOf('class="numbers"'), 'and the fields over it')
  eq((svg.match(/<svg x="0" y="0" width="1600" height="517" class="numbers"/g) || []).length, 1,
    'the layer is nested once, at the artwork\'s own size')
  eq((svg.match(/<svg/g) || []).length, 2, 'and there are exactly two svg elements, not a third from a bad splice')
  ok(svg.endsWith('</svg></svg>'), 'closed in the right order')
  ok(!/<image href="https:\/\/x.org\/art.png"/.test(ticketSVG({ layer: LAYER, artWidth: 1600, artHeight: 517 })),
    'without artwork there is no artwork element, rather than an empty one')
}

console.log('pictures inside the layer are inlined, and what could not be is named')
{
  const doc = layerDocument({ layer: LAYER, artWidth: 1600, artHeight: 517 })
  ok(!/art\.png/.test(doc), 'the layer document for the PNG carries no artwork — the canvas draws that itself')
  const good = await inlineImages(doc, async () => 'data:image/png;base64,AAAA')
  ok(/href="data:image\/png;base64,AAAA"/.test(good.svg), 'a placed picture becomes its own bytes')
  ok(!/https:\/\/x.org\/logo.png/.test(good.svg), 'and its address is gone, so the sandbox has nothing to refuse')
  eq(good.failed.length, 0, 'nothing failed')
  const bad = await inlineImages(doc, async () => { throw new Error('404') })
  eq(bad.failed.join(), 'https://x.org/logo.png', 'a picture that could not be fetched is named')
  ok(/https:\/\/x.org\/logo.png/.test(bad.svg), 'and left as it was rather than blanked')
  const plain = await inlineImages('<svg><image href="data:image/png;base64,B"/></svg>', async () => { throw new Error('should not be asked') })
  eq(plain.failed.length, 0, 'a picture already inline is not fetched again')
}

console.log('every caller reads what could not be fetched')
{
  /*
   * inlineImages reports a picture it could not fetch; a caller that drops the
   * report ships a hole with nothing said. ViewTicket did exactly that on the
   * one path whose output reaches a BUYER, while the studio's test send beside
   * it reported the same failure. So every call site must take `failed`.
   */
  const { readdirSync, readFileSync, statSync } = await import('node:fs')
  const { join } = await import('node:path')
  const root = new URL('../src/', import.meta.url).pathname
  const files = []
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : /\.(vue|js)$/.test(n) && files.push(p) } }
  walk(root)
  const calls = []
  for (const f of files) {
    if (f.endsWith('ticketexport.js')) continue
    for (const m of readFileSync(f, 'utf8').matchAll(/const \{([^}]*)\} = await inlineImages\(|await inlineImages\(/g)) calls.push({ f, taken: m[1] || '' })
  }
  ok(calls.length >= 3, `${calls.length} places call inlineImages`)
  for (const c of calls) ok(/\bfailed\b/.test(c.taken), `${c.f.slice(root.length)} reads the pictures that could not be fetched`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
