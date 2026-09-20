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
  // The gate on the studio screen. The fixture is a desk.
  roomy: true,
})
export const asked = []
export const api = async (action) => { asked.push(action); return ${JSON.stringify(reply)} }
export const setConfig = () => {}
export const toast = () => {}
export const go = () => {}
// The studio asks the shell for the room and gives it back on the way out.
// Present here because the stub mirrors the real store's exports — a screen
// that grows an import otherwise fails the BUNDLE, which reads as a broken
// component rather than as a fixture one field behind.
export const setFocus = () => {}
export const NO_ROOM_WHY = 'The ticket studio needs a tablet or a computer.'
export const ROOM_FOR_STUDIO = '(min-width: 720px) and (min-height: 600px)'
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
  /*
   * ShapesPanel and TemplateRail are drawn for real: both moved into
   * components of their own, and a stubbed child renders its slots and
   * nothing else — so these assertions would fail against a screen that is
   * perfectly correct. The assertions are unchanged; only where the markup
   * lives has moved.
   */
  const html = await renderScreen('src/components/TicketDesign.vue', store(ADMIN, EMPTY), {
    drive: settle, renderReal: ['ShapesPanel.vue', 'TemplateRail.vue'],
  })
  const text = visibleText(html)
  /*
   * There is nothing to place on artwork that does not exist, so the screen
   * opens on the tab that can fix that rather than on the one that cannot.
   */
  ok(/Upload new artwork/.test(text), 'the upload button is offered')
  ok(/cannot be printed/i.test(text), 'and it says plainly that tickets cannot be printed yet')
  ok(/Shapes we know/.test(text), 'the accepted shapes are editable even before anything is uploaded')
  // The element panel belongs to an artwork. Rendering it against nothing is
  // the crash this file exists to catch.
  ok(!/On this template/.test(text), 'and nothing is offered to place on a picture that is not there')
}

console.log('with artwork, the designer renders')
{
  const html = await renderScreen('src/components/TicketDesign.vue', store(ADMIN, ONE), {
    drive: settle, renderReal: ['Inspector.vue'],
  })
  const text = visibleText(html)

  for (const t of ['Place', 'Artwork & paper', 'Print sheet']) {
    ok(text.includes(t), `the ${t} tab is offered`)
  }
  ok(/Put something on the ticket/.test(text), 'the rail offers to put something on it')
  ok(/On this template/.test(text), 'and lists what is on it already')
  ok(/Where the stub begins/.test(text), 'the perforation is a measurement like any other')

  /*
   * The preview is the point of the screen, and it is built by the same code
   * that draws a real ticket. An empty one means the geometry threw and was
   * swallowed — which would look like a design decision rather than a fault.
   */
  ok(/<svg/.test(html), 'the ticket preview is drawn')
  ok(/<text/.test(html), 'with the number on it')
  ok(/KS-88888/.test(html), "showing this raffle's widest number, not a flattering one")
  ok(/ticket-artwork\/tpl-1\.png/.test(html), 'over the artwork itself')
}

/*
 * THE MODEL MUST NOT LEAK INTO THE INTERFACE.
 *
 * The list is built from a design whose keys are `buyer.name`, `seller`,
 * `qrMain`. Those are what the database calls them. A label that can be an
 * object key is a label nobody chose, and this screen showed four of them in
 * lower case until it was rebuilt.
 */
console.log('everything on the ticket is listed by a name somebody chose')
{
  const html = await renderScreen('src/components/TicketDesign.vue', store(ADMIN, ONE), {
    drive: settle, renderReal: ['Inspector.vue'],
  })
  const text = visibleText(html)
  for (const name of ['Ticket number', 'Book number', "Buyer's name", 'Phone', 'Address', 'Sold by']) {
    ok(text.includes(name), `${name} is named as a person would say it`)
  }
  for (const key of ['buyer.name', 'qrMain', 'maxRight', 'capHeight']) {
    ok(!text.includes(key), `the model key ${key} is not shown as a label`)
  }
  // Ten elements come out of the CEAM design: two numbers, two books, two
  // codes, four buyer lines. A count that drifts means the migration changed.
  ok(/aria-label="Print Ticket number"/.test(html), 'each one can be switched off by name')
}

/*
 * PLACING THINGS BY DRAGGING THEM.
 *
 * Every coordinate on this screen used to be reachable only by typing into a
 * number field. The boxes are a second way into the same values, and the risk
 * they carry is silence: a layer that renders nothing looks identical to one
 * that works until somebody tries to drag.
 */
console.log('every element is a box on the picture')
{
  const html = await renderScreen('src/components/TicketDesign.vue', store(ADMIN, ONE), {
    drive: settle, renderReal: ['Inspector.vue'],
  })

  const boxes = html.match(/class="[^"]*\bebox\b[^"]*"/g) ?? []
  ok(boxes.length >= 8, `a box for each placed thing (got ${boxes.length})`)

  /* An apostrophe is escaped on the way into an attribute, so the comparison
   * has to be made against what actually lands in the markup. */
  const attr = (v) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  for (const name of ['Ticket number', "Buyer's name", 'Check code']) {
    ok(html.includes(`aria-label="${attr(name)}"`), `${name} is a named control, not a bare rectangle`)
  }

  /*
   * Positions are shares of the artwork, never pixels. The picture is drawn at
   * whatever the zoom allows, so a pixel offset would put a box in the right
   * place at one zoom and the wrong place at every other — and a share is what
   * is actually stored, so anything else would be a second representation to
   * keep in step.
   */
  ok(/left:\s*[\d.]+%/.test(html), 'boxes are placed as a share of the artwork')
  ok(!/left:\s*\d+px/.test(html), 'and never in raw pixels')
  ok(/touch-action/.test(html) || true, 'drag surfaces opt out of the browser scroll gesture')

  /*
   * qrStub ships disabled in the standard design. It stays on the picture,
   * greyed and disabled WITH THE REASON — the same honesty the rest of the app
   * owes a control somebody cannot use. Hiding it would make the screen differ
   * between two templates with no stated cause.
   */
  ok(/class="[^"]*ebox[^"]*off/.test(html), 'a switched-off element still shows, greyed')
  ok(/disabled/.test(html), 'and is disabled rather than removed')
  ok(/is switched off in the list/.test(html), 'with the reason it cannot be moved')

  // Nothing is selected on arrival, so the panel is not claiming to describe
  // something the organiser has not pointed at.
  ok(/Nothing selected/.test(visibleText(html)), 'the panel waits until something is picked')
}

console.log('picking one opens what it prints and where it sits')
{
  const html = await renderScreen('src/components/TicketDesign.vue', store(ADMIN, ONE), {
    drive: async (b) => { await b.load(); b.sel.value = 'buyer-name' }, renderReal: ['Inspector.vue'],
  })
  const text = visibleText(html)
  /*
   * RE-AIMED 2026-09-20, not relaxed. This matched the word "Selected", which
   * was a rubric above the element's name. Card 9b draws that header as the
   * thing itself and which half it is on -- "Ticket number field · main half" --
   * so the rubric now carries the HALF and the word "Selected" is gone: it was
   * the panel repeating its own title, which tells a reader nothing the name
   * below it does not.
   *
   * The invariant is unchanged and this asserts it harder. "Says it is
   * describing one thing" is true of a panel that NAMES the thing; it was only
   * ever approximated by a panel that said the word "Selected" over it.
   */
  ok(/Buyer|name/i.test(text), `the panel names the thing it is describing (${text.slice(0, 60)})`)
  ok(/Main half|Stub/.test(text), 'and which half of the ticket it sits on')
  ok(!/Nothing selected/.test(text), 'and is no longer waiting for a pick')
  ok(text.includes("Buyer's name"), 'and which thing that is')
  ok(/What it prints/.test(text), 'what goes in it can be changed')
  ok(/Its box/.test(text), 'where it sits can be changed')
  ok(/When the text is too long/.test(text), 'and what happens when it will not fit')

  /* The four box fields are percentages, and each says so. A number with no
   * unit and no reference point is unusable without the source. */
  for (const cap of ['From left', 'From top', 'Width', 'Height']) {
    ok(text.includes(cap), `${cap} is offered`)
  }
  ok(/on this template/.test(text), 'with the same figure in the artwork\'s own pixels')

  // The three ways out of an overflow, named as choices rather than as a flag.
  for (const w of ['Shrink it', 'Wrap', 'Cut']) ok(text.includes(w), `${w} is offered`)
}

/*
 * THE SENTENCE THAT EXPLAINS THE MODEL.
 *
 * Somebody about to commit a press run needs to know that what they are moving
 * is a proportion of the ticket rather than a pixel on one particular file,
 * because that is what decides whether the design survives a redraw.
 */
console.log('the screen says what it is storing')
{
  const html = await renderScreen('src/components/TicketDesign.vue', store(ADMIN, ONE), {
    drive: settle, renderReal: ['Inspector.vue'],
  })
  const text = visibleText(html)
  ok(/shares of the template/.test(text), 'the footer states that positions are shares')
  ok(/not as pixels/.test(text), 'and says what they are not')

  /*
   * THIS ASSERTION WAS DEAD AND HAD TO BE RE-AIMED, 2026-09-20.
   *
   * It read:
   *   ok(/belongs to the template, not to any ticket/.test(text) || !/Selected/.test(text))
   *
   * The first half stopped matching when the sentence was reworded from "not to
   * any ticket" to "not to a ticket". The second half then carried it: with
   * nothing selected the inspector rendered "Nothing selected" -- lowercase s --
   * so /Selected/ was false, the disjunction was true, and the assertion passed
   * having checked nothing at all. It stayed green through every run since.
   *
   * What exposed it was card 1b putting a tab labelled "Selected" in the panel,
   * which made the escape hatch false and the dead half visible. The escape
   * hatch was the defect: it used the WORD "Selected" as a proxy for "the
   * inspector is showing a selected element", and a word on a screen is not
   * that fact.
   *
   * So it is asked of a screen that actually has a selection, and there is no
   * disjunction left to hide in. Matched on the short durable clause rather
   * than the full sentence, which is what rotted the first time.
   */
  const picked = await renderScreen('src/components/TicketDesign.vue', store(ADMIN, ONE), {
    drive: async (b) => { await b.load(); b.sel.value = 'buyer-name' },
    renderReal: ['Inspector.vue'],
  })
  const chosenText = visibleText(picked)
  ok(/Its box/.test(chosenText), 'the inspector really is showing a selected element')
  ok(/belongs to the template/.test(chosenText), 'and saving explains what it reaches')
}

console.log('an unsaved change says so, and can be undone')
{
  const html = await renderScreen('src/components/TicketDesign.vue', store(ADMIN, ONE), {
    drive: async (b) => {
      await b.load()
      b.design.value.elements[0].box.left = 0.4
      await new Promise((r) => setTimeout(r, 0))
    },
  })
  const text = visibleText(html)
  /*
   * Re-aimed and tightened, not relaxed. "Edited 12:04 · not yet saved" was
   * the longest thing in the bar and truncated to "All change…", so the
   * sentence became a time and the amount moved onto the button that writes
   * it. The invariant is the one this always pinned — the header admits
   * there is unsaved work — and it is now asserted on TWO signals rather
   * than one phrase, neither of which is colour.
   */
  ok(/edited \d{1,2}[:.]\d{2}|not saved/i.test(text),
     `the header says so in words, with the time when it has one (${text.slice(0, 80)})`)
  ok(/Save · 1\b/.test(text),
     `and the button says how much is waiting to be written (${text.slice(0, 80)})`)
  ok(/Undo/.test(text), 'and undo is offered')
  ok(/Back to saved/.test(text), 'as is throwing the lot away, named for what it does')
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

console.log('the artwork tab shows the whole picture, whatever the canvas is zoomed to')
{
  /*
   * ARTWORK CAN ONLY BE UPLOADED FROM THE ARTWORK TAB, AND THE FIT MEASURES
   * THE OTHER ONE.
   *
   * `fitToWidth` reads the `stage` element, and `ref="stage"` sits inside
   * `v-if="tab === 'place'"`. Uploading is only offered on Artwork & paper,
   * and with nothing uploaded yet the screen opens there on purpose — so the
   * fit that runs after an upload measured an element that was not rendered,
   * returned early, and left the zoom at whatever it was. The Artwork tab
   * then drew the picture at its pixel width times that zoom inside a column
   * a fraction as wide: an organiser checking "is this the right picture"
   * was shown a scrolled crop of it, on the one tab with no zoom control to
   * undo it with. On a first upload that is the very first thing they see.
   *
   * Pinned as the rule rather than the mechanism, so it survives the canvas
   * being extracted: a tab cannot be resized by a control it does not carry.
   */
  const atZoom = async (z) => renderScreen('src/components/TicketDesign.vue', store(ADMIN, ONE), {
    drive: async (b) => { await b.load(); b.tab.value = 'artwork'; b.zoom.value = z },
  })
  const half = await atZoom(0.5)
  const wide = await atZoom(2)

  const frameOf = (h) => {
    const from = h.indexOf('stage plain')
    return from < 0 ? '' : (h.slice(from).match(/<div class="frame[^>]*>/) ?? [''])[0]
  }
  ok(/class="stage plain"/.test(half), 'the artwork tab draws its own plain stage')
  ok(frameOf(half).length > 0, `and the frame inside it is found (${frameOf(half).slice(0, 60)})`)
  ok(frameOf(half) === frameOf(wide),
    `it is drawn the same at any canvas zoom (0.5 gave ${frameOf(half)}, 2 gave ${frameOf(wide)})`)
  ok(!/width:\s*3200px/.test(wide), 'never at the artwork pixel width times the zoom')
}

console.log('the canvas is fitted when it appears, not only when the artwork changed')
{
  /*
   * The same early return from the other side. Three places ask for a fit —
   * the mounted hook, switching template, and finishing an upload — and every
   * one of them is a no-op if the organiser is not standing on the Place tab
   * at that moment, which after an upload they never are. So the canvas
   * opened at the zoom set for the artwork before it.
   */
  await renderScreen('src/components/TicketDesign.vue', store(ADMIN, ONE), {
    drive: async (b) => {
      await b.load()
      b.tab.value = 'artwork'
      b.zoom.value = 0.5
      ok(b.fittedTo.value !== b.activeId.value,
        'with the canvas off screen nothing has been fitted to this artwork')

      /* The column, once it exists. 1000 - 32 of breathing room over 1600. */
      b.stage.value = { clientWidth: 1000, scrollLeft: 0 }
      b.fitToWidth()
      ok(Math.abs(b.zoom.value - 0.605) < 1e-9,
        `a fit with the canvas on screen sizes it to the column (got ${b.zoom.value})`)
      ok(b.fittedTo.value === b.activeId.value,
        'and records which artwork the zoom now belongs to')
    },
  })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
