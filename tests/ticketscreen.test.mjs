/*
 * THE TICKET DESIGN SCREEN ACTUALLY RENDERS.
 *
 * A screen can compile, pass eslint, and still throw the moment somebody opens
 * it — a binding the template reaches on its own, a measurement read off an
 * object that is null until a request comes back. The build does not catch it
 * and neither does a handler test. Only rendering it does.
 *
 * This repository has been bitten by exactly that four times, which is why
 * tests/screen.mjs exists. This file uses it for the one screen phase 1 adds.
 *
 * WHAT IT DELIBERATELY DOES NOT TEST. Whether the measurements are right —
 * tests/ticketart.test.mjs owns that — or whether the server refuses the wrong
 * people, which is tests/strictactions.test.mjs and tests/templates.test.mjs.
 * This one owns a narrower question: does an organiser see a working screen,
 * before any artwork exists and after.
 */
import { renderScreen, visibleText } from './screen.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

/**
 * A stubbed store whose `list_templates` answers with whatever is wanted.
 *
 * The reply shape is the handler's own, copied here on purpose rather than
 * imported: if templates.ts changes what it sends, this file should fail and
 * say so, instead of following it silently.
 */
const store = (user, reply) => `
import { reactive } from 'vue'
export const state = reactive({
  cfg: { ticketPrefix: 'KS-', ticketDigits: 5, currency: 'RM', ticketArtwork: ${!!reply.active} },
  user: ${JSON.stringify(user)},
})
export const asked = []
export const api = async (action) => { asked.push(action); return ${JSON.stringify(reply)} }
export const setConfig = () => {}
export const toast = () => {}
export const go = () => {}
export const isAdmin = ${user.role === 'admin'}
export const isSuper = false
`

const ADMIN = { email: 'a@x.com', role: 'admin', isSuperAdmin: false }
const SELLER = { email: 's@x.com', role: 'agent', isSuperAdmin: false }

const EMPTY = { templates: [], active: '', sizes: [], verifyUrl: '' }

const ONE = {
  templates: [{
    id: 'tpl-1', name: 'Front', contentType: 'image/png',
    width: 1600, height: 517, bytes: 576542,
    url: 'https://x/storage/v1/object/public/ticket-artwork/tpl-1.png',
    design: {}, uploadedBy: 'a@x.com', uploadedAt: '2026-09-20T10:00:00Z',
  }],
  active: 'tpl-1',
  sizes: [{ id: 'ceam-190x61', label: '190 × 61 mm', widthMM: 190, heightMM: 61.39, tolerance: 0.02, minWidthPx: 1600 }],
  verifyUrl: '',
}

/*
 * The screen loads its artwork in onMounted, and server rendering never runs
 * mounted hooks — so a plain render shows "Loading" forever and every assertion
 * below would fail against a screen that is perfectly fine.
 *
 * `load` is the same function the mounted hook calls, so driving it exercises
 * the real path rather than reaching past it.
 */
const settle = async (b) => { await b.load() }

console.log('a seller is not shown the screen at all')
{
  const html = await renderScreen('src/components/TicketDesign.vue', store(SELLER, EMPTY), {
    drive: settle,
  })
  const text = visibleText(html)
  ok(/organiser/i.test(text), 'they are told whose screen it is')
  ok(!/Accepted sizes/.test(text), 'and none of it is rendered')
}

console.log('with no artwork yet, an organiser is told so and can upload')
{
  const html = await renderScreen('src/components/TicketDesign.vue', store(ADMIN, EMPTY), {
    drive: settle,
  })
  const text = visibleText(html)
  ok(/Upload the ticket artwork/.test(text), 'the upload button is the first thing offered')
  ok(/cannot be printed/i.test(text), 'and it says plainly that tickets cannot be printed yet')
  ok(/Accepted sizes/.test(text), 'the accepted sizes are editable even before anything is uploaded')
  // The measurement fields belong to an artwork. Rendering them against nothing
  // is the crash this file exists to catch.
  ok(!/Where the number goes/.test(text), 'and the measurements are not offered against no picture')
}

console.log('with artwork, the whole editor renders')
{
  const html = await renderScreen('src/components/TicketDesign.vue', store(ADMIN, ONE), {
    drive: settle,
  })
  const text = visibleText(html)
  ok(/Front/.test(text), 'the uploaded artwork is listed')
  ok(/1600/.test(text) && /517/.test(text), 'with the size it was measured at')
  ok(/printing from this/.test(text), 'and which one tickets print from')
  ok(/Where the number goes/.test(text), 'the measurements are offered')
  ok(/The QR code/.test(text), 'so is the QR box')
  ok(/Printing/.test(text), 'and the print settings')
  ok(/Print a test page/.test(text), 'and a way to see it on paper')

  /*
   * The preview is the point of the screen, and it is built by the same code
   * that draws a real ticket. An empty one means the geometry threw and was
   * swallowed — which would look like a design decision rather than a fault.
   */
  ok(/<svg/.test(html), 'the ticket preview is drawn')
  ok(/<text/.test(html), 'with the number on it')
  ok(/KS-88888/.test(html), 'showing this raffle\'s widest number, not a flattering one')
  ok(/ticket-artwork\/tpl-1\.png/.test(html), 'over the artwork itself')
}

console.log('the screen asks the server for what it draws')
{
  // A screen that renders from nothing renders the same as one whose request
  // failed. Asserting the call is what tells them apart.
  let asked = []
  const html = await renderScreen('src/components/TicketDesign.vue', store(ADMIN, ONE), {
    drive: async (b) => { await b.load(); asked = b.templates.value.map((t) => t.id) },
  })
  ok(asked.includes('tpl-1'), 'it took the artwork from the server rather than inventing one')
  ok(html.length > 500, 'and produced a screen rather than an empty shell')
}

/*
 * PLACING THINGS BY DRAGGING THEM.
 *
 * Every coordinate on this screen used to be reachable only by typing into a
 * number field. The handles are a second way into the same values, and the
 * risk they carry is silence: a handle layer that renders nothing looks
 * identical to one that is working until somebody tries to drag.
 *
 * So this checks they are actually emitted, that each is positioned from the
 * artwork rather than from a guess, and that one that is switched off says so
 * instead of being quietly dropped — which is the permissionui rule applied to
 * a handle rather than to a button.
 */
console.log('the placement handles are on the picture')
{
  const html = await renderScreen('src/components/TicketDesign.vue', store(ADMIN, ONE), {
    drive: settle,
  })

  const handles = html.match(/class="[^"]*\bhandle\b[^"]*"/g) ?? []
  ok(handles.length >= 8, `a handle for each placeable thing (got ${handles.length})`)

  // Two numbers, four buyer lines, two QR boxes — named, because a bare dot on
  // a picture is unusable by keyboard and unreadable by a screen reader.
  for (const name of ['Number — buyer half', 'Number — stub', 'Buyer — name', 'QR — buyer half']) {
    ok(html.includes(`aria-label="${name}"`), `${name} is a named control`)
  }

  /*
   * Positions are percentages of the artwork, never pixels. The picture is
   * drawn at whatever width the column allows, so a pixel offset would put the
   * handle in the right place on one screen and the wrong place on every other.
   */
  ok(/left:\s*[\d.]+%/.test(html), 'handles are placed as a share of the artwork, not in pixels')
  ok(!/left:\s*\d+px/.test(html), 'and never in raw pixels')

  /*
   * qrStub ships disabled in DEFAULT_DESIGN. It stays on the picture, greyed
   * and disabled with the reason — the same honesty the rest of the app owes a
   * control somebody cannot use.
   */
  ok(/class="[^"]*handle[^"]*off/.test(html), 'a switched-off element still shows, greyed')
  ok(/disabled/.test(html), 'and is disabled rather than removed')
  ok(/is turned off below/.test(html), 'with the reason it cannot be moved')

  // Nothing is selected on arrival, so the inspector is not taking up room.
  ok(!/class="inspector"/.test(html), 'the inspector waits until something is picked')
}

console.log('picking one opens the numbers for it')
{
  const html = await renderScreen('src/components/TicketDesign.vue', store(ADMIN, ONE), {
    drive: async (b) => { await b.load(); b.sel.value = 'main' },
  })
  ok(/class="inspector"/.test(html), 'the inspector appears')
  const text = visibleText(html)
  ok(/Number — buyer half/.test(text), 'saying which thing is being moved')
  ok(/Shift/.test(text), 'and how to move it faster')
  /*
   * The measurements themselves are <Dim> props, and this harness renders a
   * child's slots and not its props — so asserting on "Across" here would fail
   * against a screen that is perfectly fine. The block below renders Dim on its
   * own, where its template really runs, and checks the readout there instead.
   */
  ok(/class="pad"/.test(html), 'and the nudge pad, which is the no-typing route')
}


/*
 * A MEASUREMENT IS DRAGGED, AND STILL READS AS A NUMBER.
 *
 * Rendered directly rather than through the screen, because the screen stubs
 * its children: inside TicketDesign a <Dim> contributes nothing to the HTML, so
 * every assertion about a measurement has to happen here.
 */
console.log('a dimension is a slider that still shows its number')
{
  const html = await renderScreen('src/components/ui/Dim.vue', 'export const state = {}', {
    props: { label: 'Letter height', modelValue: 21, min: 4, max: 80, mm: 0.11875 },
  })

  ok(/type="range"/.test(html), 'it is a slider')
  ok(/value="21"/.test(html), 'set to the value it was given')
  ok(/min="4"/.test(html) && /max="80"/.test(html), 'within the range it was given')
  ok(visibleText(html).includes('Letter height'), 'and says what it measures')

  /*
   * RULE: anything positioned by dragging must still show its exact number.
   * The slider answers "does that look right"; the number is what makes the
   * answer reproducible on a second artwork and sayable over the phone.
   */
  ok(/type="number"/.test(html), 'the exact figure is there to be read')
  ok(/class="num"/.test(html), 'and to be typed when the slider will not do')

  // 21 px at 0.11875 mm/px is 2.49 mm. The file counts pixels; the organiser
  // is holding a printed ticket and a ruler.
  ok(visibleText(html).includes('2.49 mm'), 'shown in millimetres as well as pixels')

  // Keyboard: the slider itself must be reachable, or the only way to place
  // something by keyboard is to type a coordinate — the thing this replaces.
  ok(!/tabindex="-1"/.test(html), 'the slider is in the tab order')
  ok(!/aria-hidden/.test(html), 'and is not hidden from a screen reader')
}


/*
 * A PRINTING COLOUR HAS THREE WAYS IN, and needs all three.
 *
 * Detection measures area, and the colour somebody actually wants is often the
 * one with least of it: the gold this raffle's number is printed in covers
 * about a tenth of one per cent of the ticket, so no amount of counting will
 * surface it. Hence the swatches for what WAS found, and a dropper for what
 * cannot be.
 */
console.log('a colour can be taken from the artwork, pointed at, or typed')
{
  const html = await renderScreen('src/components/ui/Ink.vue', 'export const state = {}', {
    props: {
      label: 'Ink', modelValue: '#0F490E',
      swatches: ['#36C08F', '#FEFEFF', '#164A2D'], canDrop: true,
    },
  })

  ok(/type="color"/.test(html), 'a swatch to open a picker')
  ok(/type="text"/.test(html) && /#0F490E/.test(html), 'the hex, visible and editable')
  ok(/Pick Ink off the ticket/.test(html), 'and a dropper, named for what it does')

  // The colours found in the picture are offered AS colours. A list of hex
  // strings is not something anybody can choose between.
  ok((html.match(/class="chip"/g) ?? []).length === 3, 'each detected colour is a swatch')
  ok(/background:\s*#36C08F/i.test(html), 'shown as itself, not as its name')
  ok(/aria-label="Use #36C08F, from the artwork"/.test(html), 'and reachable without sight of it')
}

console.log('where the browser has no dropper, nothing is lost')
{
  const html = await renderScreen('src/components/ui/Ink.vue', 'export const state = {}', {
    props: { label: 'Ink', modelValue: '#0F490E', swatches: [], canDrop: false },
  })
  ok(!/Pick Ink off the ticket/.test(html), 'the dropper is absent rather than broken')
  ok(/type="color"/.test(html) && /type="text"/.test(html), 'the picker and the hex remain')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
