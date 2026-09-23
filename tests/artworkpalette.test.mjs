/*
 * READING A TICKET'S COLOURS OFF THE TICKET.
 *
 * The defect this closes: every ink in DEFAULT_DESIGN was sampled by hand from
 * the CEAM artwork, and scaleDefaults scales the geometry while leaving the
 * colours literal. A raffle that uploads its own artwork therefore gets CEAM's
 * gold printed on it, and has to find four colour fields to discover why.
 *
 * The assertions that matter are about CONTRAST, not about matching a hex. On a
 * dark ticket the readable ink is the light colour, and a rule that reached for
 * the darkest colour would return near-black on near-black and be confidently
 * unreadable.
 */
import { countColours, palette, inkDesign, saturation, chroma, usable } from '../src/lib/artworkpalette.js'
import { DEFAULT_DESIGN } from '../src/lib/ticketdesign.js'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

/* A canvas is only ever asked for a context and an ImageData, so that is all
 * this provides — no DOM, and the module stays testable in node. */
function canvasOf(pixels) {
  const data = new Uint8ClampedArray(pixels.length * 4)
  pixels.forEach(([r, g, b, a = 255], i) => {
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = a
  })
  return {
    width: pixels.length, height: 1,
    getContext: () => ({ getImageData: () => ({ data }) }),
  }
}
const times = (n, px) => Array.from({ length: n }, () => px)

const GREEN = [15, 73, 14]     // the stub's dark green
const GOLD = [253, 239, 176]   // the number's gold
const WHITE = [255, 255, 255]

console.log('the biggest area is the paper, whatever colour it happens to be')
{
  const b = countColours(canvasOf([...times(70, GREEN), ...times(20, GOLD), ...times(10, WHITE)]))
  const p = palette(b)
  ok(Math.abs(b[0].share - 0.7) < 0.01, 'the green is 70% of the picture')
  eq(p.paper, '#0F490E', 'so the green is the paper')
  ok(p.dark === true, 'and the artwork is recognised as a dark one')
}

console.log('the ink is chosen for contrast, not for being dark')
{
  /*
   * THE ONE THAT WOULD HAVE BEEN A BUG. A near-black is present and is the
   * darkest colour in the picture; picking it would print black on dark green.
   */
  const b = countColours(canvasOf([
    ...times(60, GREEN), ...times(25, GOLD), ...times(15, [8, 8, 8]),
  ]))
  const p = palette(b)
  eq(p.paper, '#0F490E', 'the green is still the paper')
  ok(p.ink === '#FDEFB0', `the readable ink is the gold, not the near-black (got ${p.ink})`)
}

console.log('the accent is the colour somebody chose')
{
  const b = countColours(canvasOf([...times(80, WHITE), ...times(15, [200, 16, 16]), ...times(5, [130, 130, 130])]))
  const p = palette(b)
  eq(p.paper, '#FFFFFF', 'a white ticket')
  ok(chroma([200, 16, 16]) > chroma([130, 130, 130]), 'the red has chroma the grey has not')
  ok(p.accent !== '#FFFFFF' && p.accent !== '#828282', `the red is the accent (got ${p.accent})`)
  ok(p.dark === false, 'and it is a light artwork')
}

console.log('a greyscale ticket still gets a usable answer')
{
  const p = palette(countColours(canvasOf([...times(80, WHITE), ...times(20, [20, 20, 20])])))
  ok(usable(p.paper) && usable(p.ink) && usable(p.accent), 'every colour is a real hex')
  ok(p.ink !== p.paper, 'and the ink is not the paper')
}

console.log('specks do not get to theme the ticket')
{
  /*
   * One pixel of saturated magenta — a JPEG artefact, not a decision — on a
   * ticket that also has something legitimate to read. The white matters: with
   * only green and the speck, the speck IS the sole contrasting colour and
   * becoming the ink is the correct answer. A real ticket always has a
   * readable colour, so testing without one tests a ticket nobody prints.
   */
  const b = countColours(canvasOf([...times(160, GREEN), ...times(39, WHITE), [255, 0, 255]]))
  const p = palette(b)
  ok(p.accent !== '#FF00FF', `a speck does not become the accent (got ${p.accent})`)
  // The real artwork's accent covers 3.5%, so the floor that excludes this
  // has room under it — checked against the actual ticket, not guessed.
  ok(b.find((x) => x.hex === '#FF00FF')?.share <= 0.005, 'the speck is a 0.5% bucket')
  ok(p.ink === '#FFFFFF', 'the white is what gets read, not the speck')
}

console.log('the editor marks itself against the artwork, not with it')
{
  const dark = palette(countColours(canvasOf(times(50, GREEN))))
  const light = palette(countColours(canvasOf(times(50, WHITE))))
  ok(dark.mark !== light.mark, 'a dark ticket and a light one get different handle colours')
  ok(dark.mark !== dark.paper && dark.mark !== dark.accent,
    'and the handle colour is never one of the ticket\'s own, which would vanish into it')
}


/*
 * THE TWO THINGS SYNTHETIC PIXELS DID NOT CATCH.
 *
 * Both were found by running the detector over the real CEAM artwork, and both
 * produced a confident, wrong palette rather than an error. Colour code fails
 * quietly: it always returns a colour, and only a human looking at it knows the
 * colour is useless.
 */
console.log('the accent is never the paper')
{
  // A ticket that is mostly one saturated colour. The dark green is both the
  // largest area and the most colourful, so it wins paper AND accent unless
  // distance from the paper is part of the score.
  const b = countColours(canvasOf([
    ...times(70, [22, 74, 45]), ...times(18, [54, 192, 143]), ...times(12, WHITE),
  ]))
  const p = palette(b)
  eq(p.paper, '#164A2D', 'the dark green is the paper')
  ok(p.accent !== p.paper, `and the accent is a different colour (got ${p.accent})`)
  ok(p.accent === '#36C08F', 'the brighter green off the same ticket')
}

console.log('near-white is not mistaken for a vivid colour')
{
  /*
   * #FEFEFF is white to anyone looking at it, but HSL saturation calls it 1.0:
   * one channel differs by 1/255 and the denominator has collapsed. Scored that
   * way, white was returned as the accent of a dark green ticket.
   */
  ok(saturation([254, 254, 255]) > 0.9, 'HSL saturation really does say white is vivid')
  ok(chroma([254, 254, 255]) < 0.01, 'chroma does not')
  const p = palette(countColours(canvasOf([
    ...times(60, [22, 74, 45]), ...times(30, [254, 254, 255]), ...times(10, [47, 165, 121]),
  ])))
  ok(p.accent !== '#FEFEFF', `so the accent is a real colour (got ${p.accent})`)
}

console.log('inking a design moves the colours and nothing else')
{
  const p = { paper: '#FFFFFF', ink: '#111111', accent: '#C00000', mark: '#B3261E', dark: false }
  const before = JSON.parse(JSON.stringify(DEFAULT_DESIGN))
  const after = inkDesign(DEFAULT_DESIGN, p)

  eq(after.main.ink, '#C00000', 'the buyer\'s half takes the accent')
  eq(after.stub.ink, '#111111', 'the stub takes the readable ink')
  eq(after.buyer.fields.name.ink, '#111111', 'and so does every buyer line')
  eq(after.book.main.ink, '#C00000', 'the book number matches its half')

  /*
   * A colour detection that moved a coordinate would be unforgivable — the
   * placement is the part somebody measured.
   */
  eq(after.main.label.left, before.main.label.left, 'no coordinate moved')
  eq(after.main.capHeight, before.main.capHeight, 'no size changed')
  eq(after.qrMain.x, before.qrMain.x, 'the QR stayed where it was')
  eq(after.buyer.fields.name.enabled, before.buyer.fields.name.enabled, 'no switch flipped')
  eq(DEFAULT_DESIGN.main.ink, before.main.ink, 'and the defaults were not mutated')
}

/*
 * THE SHAPE THE ONLY CALLER ACTUALLY PASSES.
 *
 * REPORTED FROM THE SCREEN: "Failed to execute 'structuredClone' on 'Window':
 * #<Object> could not be cloned." Detecting an artwork's colours died there and
 * the Artwork tab could not be used.
 *
 * WHY EVERY TEST ABOVE PASSED WHILE THE FEATURE HAD NEVER WORKED. They hand
 * inkDesign a PLAIN OBJECT — DEFAULT_DESIGN. TicketDesign.vue hands it
 * `design.value`, which is a Vue reactive PROXY, and structuredClone refuses a
 * Proxy outright. So the fixture was more generous than production in the one
 * dimension that mattered, and the function threw on its first real use rather
 * than on some edge case.
 *
 * That is the same trap as a screen fixture that populates config at tick 0
 * when production populates it later: a test input that is easier to handle
 * than the real one tests a function that does not exist.
 *
 * So this block uses a REAL reactive proxy from Vue, which is already a
 * dependency and is what the caller has.
 */
console.log('a design that cannot be structured-cloned is still inked')
{
  const { reactive } = await import('vue')

  /* Exactly what the browser threw on, reproduced: Node raises DOMException
     "#<Object> could not be cloned" for this value. Asserted, so that a future
     runtime where Proxies DO clone does not leave this test quietly proving
     nothing. */
  const live = reactive({
    main: { ink: '#000000' },
    stub: { ink: '#000000' },
    buyer: { fields: { name: { ink: '#000000' } } },
  })
  let refused = false
  try { structuredClone(live) } catch { refused = true }
  ok(refused, 'the input really is one structuredClone refuses, so this test is testing something')

  /* Caught, so a broken inkDesign FAILS rather than killing the suite before
     its summary — run.sh reads a missing summary as no line at all. */
  let out = null, threw = ''
  try { out = inkDesign(live, { accent: '#123456', ink: '#abcdef' }) } catch (e) { threw = e.message }
  ok(!!out, `inkDesign returns a design rather than throwing${threw ? ' — threw: ' + threw : ''}`)
  if (!out) out = { main: {}, stub: {}, buyer: { fields: { name: {} } } }
  eq(out.main.ink, '#123456', 'the buyer half takes the accent')
  eq(out.stub.ink, '#abcdef', 'the stub takes the ink')
  eq(out.buyer.fields.name.ink, '#abcdef', 'and every buyer field takes the stub ink')
  eq(live.main.ink, '#000000', 'and the design it was given is not mutated')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
