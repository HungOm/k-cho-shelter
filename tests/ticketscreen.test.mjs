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
import { renderScreen, visibleText, setupOf } from './screen.mjs'
import { normalDecoration } from '../src/lib/designelements.js'
import { designFor } from '../src/lib/ticketdesign.js'
import { designText, draftKey } from '../src/lib/studiodraft.js'
import { BUILT_IN } from '../src/lib/designlibrary.js'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

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

  /*
   * "Artwork", not "Artwork & paper", and four of them now. The mockup titles
   * the card "Artwork & paper" and labels the tab "Artwork" — 2a, 2b, 7a and
   * 8c all draw it that way — and "Digital ticket" is card 8c's own tab.
   */
  for (const t of ['Place', 'Artwork', 'Print sheet', 'Digital ticket']) {
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
  /*
   * Toggle IS RENDERED FOR REAL HERE, and it has to be. The visibility control
   * on each row used to be a bare <input type="checkbox"> that this file owned;
   * it is now <Toggle>, and a child left out of renderReal is stubbed to its
   * slots -- so the assertion below would be reading an absence this harness
   * creates rather than anything about the screen.
   */
  const html = await renderScreen('src/components/TicketDesign.vue', store(ADMIN, ONE), {
    drive: settle, renderReal: ['Inspector.vue', 'Toggle.vue'],
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
  /*
   * RE-AIMED, NOT RELAXED. This matched `aria-label="Print Ticket number"`, the
   * old checkbox's label. Card 9b draws an eye instead, and a button is named
   * by what it DOES rather than by its state -- so the control now announces
   * "Hide Ticket number" when the layer is on and "Show Ticket number" when it
   * is off. The invariant is untouched: every row's control is individually
   * addressable and says which element it governs.
   */
  ok(/aria-label="(Hide|Show) Ticket number"/.test(html),
     'each one can be switched off by name')
  ok(!/type="checkbox"[^>]*aria-label="Print /.test(html),
     'and the tick box it replaced is gone rather than doubled up')
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
    /* ToolBar and ToolButton are real here because the panel's own tab strip is
       built from them: stubbed, the control that reveals the box group renders
       as nothing and the assertion below cannot see it. */
    drive: async (b) => { await b.load(); b.sel.value = 'buyer-name' },
    renderReal: ['Inspector.vue', 'ToolBar.vue', 'ToolButton.vue'],
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
  /*
   * "Its box" was the heading of one of six stacked groups. The panel is three
   * tabs now and the group headings went with the stack — the control that
   * selects a group IS its heading — so this asks for the control instead.
   * What the group CONTAINS is asserted by the four-field loop just below,
   * which is the stronger half and was always there.
   */
  ok(/>Box</.test(text) || /\bBox\b/.test(text), 'where it sits can be reached')
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
  /*
   * MATCHED ON THE TWO WORDS THAT CARRY THE MODEL, not on the sentence.
   *
   * It read /shares of the template/ and /not as pixels/ until 2026-09-22,
   * when the studio's prose was cut on a user instruction — "minimum text
   * only" — and the footer became "Held as shares, not pixels, so a design
   * survives a redraw at any size." Both facts are still there and both
   * assertions went red, which is a test pinning phrasing rather than meaning.
   *
   * This file has already paid for that once, thirty lines down: an assertion
   * matching a full sentence stopped matching when "not to any ticket" became
   * "not to a ticket", and a disjunction carried it green for weeks. The
   * lesson taken then was to match the short durable clause. "shares" and
   * "pixels" are the shortest durable thing here — the contrast between them
   * IS the model, and a rewrite that drops either has dropped the point rather
   * than tightened it.
   */
  ok(/\bshares\b/.test(text), 'the footer states that positions are shares')
  ok(/\bpixels\b/.test(text), 'and says what they are not')

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
    drive: async (b) => {
      await b.load()
      b.sel.value = 'buyer-name'
      /*
       * AND MOVED SOMETHING, which this never did. The saving note is now
       * gated on `dirty` — it appears when there is something to save rather
       * than standing on the screen permanently — so a test that only selects
       * can no longer see it. Driving a real edit is the better test anyway:
       * the dirty path had no coverage here at all.
       */
      b.design.value.elements[0].box.left = 0.42
    },
    renderReal: ['Inspector.vue'],
  })
  const chosenText = visibleText(picked)
  /*
   * RE-AIMED A THIRD TIME, 2026-09-23, and this time at the element itself.
   *
   * It matched /Its box/ — the heading of one of six stacked groups. The panel
   * is now three tabs and the group headings are gone, because the tab that
   * selects a group is the heading; so the string went, and with it a proxy
   * that was only ever "some words this panel happens to print".
   *
   * The durable fact is that the panel is showing THE ELEMENT THAT WAS
   * SELECTED, so that is what is asked: sel is 'buyer-name' and the panel
   * names it. That cannot pass while showing a different element, an empty
   * panel, or a skeleton — which is more than the old one could say.
   */
  ok(/Buyer's name/.test(chosenText), 'the inspector really is showing the selected element')
  ok(/From left/.test(chosenText), 'and it opens on the box, the way its slot-mate does')
  /*
   * WHAT IT REACHES, in whatever words. This matched /belongs to the template/
   * — the ownership framing — and the 2026-09-22 cut replaced that abstraction
   * with the consequence it stands for: "Everything printed or sent from now
   * on draws from this, including digital tickets already issued."
   *
   * The assertion's own name is "saving explains what it REACHES", so the
   * concrete clause is the better thing to pin: a reader about to commit a
   * press run needs to know the blast radius, not the data model. Matched on
   * the reach and on the part people misread — that already-issued digital
   * tickets are included — because dropping that half is the way this sentence
   * would actually get worse.
   */
  ok(/from now on/.test(chosenText), 'and saving explains what it reaches')
  ok(/already issued/.test(chosenText), 'including the half people misread')
  /*
   * AND IT IS SAID ONCE. The sentence used to live in the inspector under a
   * heading "What saving changes", which put it on screen again for every
   * element anybody clicked — a property of the Save button, restated per
   * selection. One occurrence is the whole point of having moved it.
   */
  const said = (chosenText.match(/already issued/g) || []).length
  ok(said === 1, `once, not once per selection (found ${said})`)
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

  /*
   * The colours found in the picture are offered AS colours. A list of hex
   * strings is not something anybody can choose between.
   *
   * `class="swatch"`, and this assertion's own wording is why it was renamed:
   * it has always said "each detected colour is a swatch" while matching
   * `.chip`, which in style.css is a 44px rounded pill used for the search
   * screen's suggestions and for filter chips. Two unrelated objects under one
   * name, kept apart only by scoping.
   */
  ok((html.match(/class="swatch"/g) ?? []).length === 3, 'each detected colour is a swatch')
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

      /* The column, once it exists: 1000, less 32 of breathing room and the
         16 px ruler down the left side the artboard now shares it with
         (STUDIO-ESSENTIALS Phase 3), over 1600. */
      b.stage.value = { clientWidth: 1000, scrollLeft: 0 }
      b.fitToWidth()
      ok(Math.abs(b.zoom.value - 0.595) < 1e-9,
        `a fit with the canvas on screen sizes it to the column (got ${b.zoom.value})`)
      ok(b.fittedTo.value === b.activeId.value,
        'and records which artwork the zoom now belongs to')
    },
  })
}

console.log('the grid snaps in millimetres, which is not the same share on both axes')
{
  /*
   * CARD 9b DRAWS `[grid] Grid 2 mm` AND NOTHING IMPLEMENTED IT. Snapping to
   * the other boxes lines a field up with its neighbours; snapping to a grid
   * lines it up with the ticket, which is the alignment a print shop's eye
   * actually reads — a row of fields each aligned to a different neighbour is
   * not aligned to anything.
   *
   * THE BUG THIS FILE EXISTS TO HOLD. Boxes are stored as SHARES of the
   * template, so a step in millimetres has to be divided by the artboard's own
   * size ON THAT AXIS. This fixture's ticket is 190 mm across and 61.39 down.
   * One share for both would make the horizontal grid 2 mm and the vertical
   * grid a little over 6 — and nothing on screen would say so: the inspector
   * would read clean percentages and the fields would be wrong on paper, which
   * is a box of printed tickets rather than a rendering fault.
   */
  const { ctx, cleanup } = await setupOf('src/components/TicketDesign.vue', store(ADMIN, ONE))
  await ctx.load()

  const W = 190, H = 190 * (517 / 1600)
  const near = (a, b, what) => ok(Math.abs(a - b) < 1e-9, `${what} (got ${a}, want ${b})`)

  near(ctx.gridX.value, 2 / W, 'the horizontal step is 2 mm of the artboard\'s width')
  near(ctx.gridY.value, 2 / H, 'the vertical step is 2 mm of its height')
  /*
   * Stated as a ratio as well as a value, because the two assertions above
   * would both pass against a pair of constants that happened to be right for
   * this one fixture. This says the steps are the same DISTANCE, which is the
   * property.
   */
  near(ctx.gridY.value / ctx.gridX.value, W / H,
    'so the two steps are the same distance on the ticket, not the same share')
  ok(ctx.gridY.value > ctx.gridX.value * 3,
    'and on a landscape ticket the vertical share is visibly the larger of the two')

  /*
   * The two tools are independent, which is how 9b draws them — both lit, and
   * either able to be off. Folding the grid into the snap toggle would have
   * made one control that does two things and can only say one of them.
   */
  ctx.snapping.value = false
  near(ctx.snapX(2 / W + 0.001, []), 2 / W, 'with neighbours off, the grid still catches a box')
  ok(ctx.snapX(0.5, [0.501]) === 0.5, 'and a neighbour\'s edge no longer does')

  ctx.snapping.value = true
  ctx.gridding.value = false
  ok(ctx.snapX(2 / W + 0.001, []) === 2 / W + 0.001, 'with the grid off, a grid line does not catch it')
  near(ctx.snapX(0.501, [0.5]), 0.5, 'and a neighbour\'s edge still does')

  /*
   * NEAREST WINS between the two rather than one taking precedence. A field
   * dragged past a neighbour's edge that happens to sit half a grid step away
   * should land on whichever it is actually closer to; a fixed precedence
   * would pull it off the edge it was visibly next to.
   */
  ctx.gridding.value = true
  const g = 4 * (2 / W)
  near(ctx.snapX(g + 0.0005, [g + 0.0002]), g + 0.0002, 'the nearer of an edge and a grid line wins')
  near(ctx.snapX(g + 0.0005, [g + 0.0035]), g, 'and it is the grid when the grid is nearer')

  await cleanup()
}

console.log('a selection is one thing, whichever lists its members came from')
{
  /*
   * FOUR PLACES THE SHELL ONLY EVER LOOKED AT FIELDS, all found by placing a
   * four-part library shape and working with it (STUDIO-ESSENTIALS D1–D4):
   *
   *   a drag moved the fields in a selection and left the drawn shapes behind,
   *     so a placed library shape came apart on its first drag;
   *   ⌘A selected every field and no drawn shape;
   *   the arrow keys moved the primary and not the rest of the selection;
   *   "Save · N" counted fields and never shapes, so a design with only new
   *     shapes in it showed a clean button beside a status saying "edited".
   *
   * Driven through the handlers themselves, because each of these is a
   * decision about WHICH boxes, and the only way to see it is to press the key.
   */
  const { ctx, cleanup } = await setupOf('src/components/TicketDesign.vue', store(ADMIN, ONE))
  await ctx.load()
  ctx.tab.value = 'place'

  const d1 = normalDecoration({ id: 'd-test-1', kind: 'rect', box: { left: 0.1, top: 0.1, width: 0.1, height: 0.1 } })
  const d2 = normalDecoration({ id: 'd-test-2', kind: 'rect', box: { left: 0.3, top: 0.3, width: 0.1, height: 0.1 } })
  ctx.design.value.decorations = [d1, d2]
  const deco = (id) => ctx.design.value.decorations.find((d) => d.id === id)
  const el = ctx.design.value.elements.find((e) => e.id === 'buyer-name')
  ok(el && deco('d-test-1'), 'the fixture has a field and two drawn shapes to select')

  // The save count sees drawn shapes.
  ok(ctx.changeCount.value >= 2, `two new shapes count as two changes (got ${ctx.changeCount.value})`)

  // ⌘A takes both lists.
  const key = (k, mods = {}) => ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false,
    target: null, preventDefault() {}, ...mods })
  ctx.onFocusKey(key('a', { metaKey: true }))
  ok(ctx.picked.value.includes('d-test-1') && ctx.picked.value.includes('d-test-2'),
    '⌘A selects the drawn shapes as well as the fields')
  ok(ctx.picked.value.includes('buyer-name'), 'and still the fields')

  // A drag carries every member.
  ctx.sel.value = 'buyer-name'
  ctx.also.value = ['d-test-1']
  const ev = { stopPropagation() {}, shiftKey: false, metaKey: false,
    currentTarget: {}, pointerId: 1, clientX: 0, clientY: 0 }
  ctx.startMove(el, ev)
  const carried = (ctx.drag.value?.group || []).map((g) => g.id)
  ok(carried.includes('d-test-1'), 'a drag started on a field carries the drawn shape selected with it')
  ctx.drag.value = null

  // A pinned member stays where it was pinned.
  deco('d-test-1').locked = true
  ctx.startMove(el, ev)
  ok(!(ctx.drag.value?.group || []).some((g) => g.id === 'd-test-1'),
    'but not a pinned one, which stays put the same as when it is dragged alone')
  ctx.drag.value = null
  deco('d-test-1').locked = false

  // Snap candidates come from both lists, and never from anything moving.
  const { xs } = ctx.edgesExcept(new Set(['buyer-name', 'd-test-1']))
  ok(xs.includes(0.3), 'a moving box can snap to the edge of a drawn shape')
  ok(!xs.includes(0.1), 'and not to the edge of a shape travelling with it')

  // The arrow keys move the selection as one, and clamp it as one.
  const before = [el.box.left, deco('d-test-1').box.left]
  ctx.onKey(key('ArrowRight'))
  const moved = [el.box.left - before[0], deco('d-test-1').box.left - before[1]]
  ok(Math.abs(moved[0] - 0.001) < 1e-9 && Math.abs(moved[1] - 0.001) < 1e-9,
    `an arrow moves the field and the shape by the same step (moved ${moved.map((m) => m.toFixed(4))})`)

  el.box.left = 1 - el.box.width - 0.0004
  const at = [el.box.left, deco('d-test-1').box.left]
  ctx.onKey(key('ArrowRight'))
  const step = [el.box.left - at[0], deco('d-test-1').box.left - at[1]]
  ok(Math.abs(step[0] - step[1]) < 1e-9 && step[0] > 0 && step[0] < 0.001,
    `at the edge the whole selection stops short together rather than shearing (${step.map((m) => m.toFixed(5))})`)

  await cleanup()
}

console.log('the arrange rail offers all six edges and all four stacking moves')
{
  /*
   * arrange.js has aligned to six edges and stacked four ways since it was
   * written; the rail offered three and three, so lining type up on one
   * baseline — the commonest thing done to a ticket — had no button. Each tool
   * must be present AND, with nothing selected, disabled with its reason: a
   * rail of live buttons that do nothing is the thing permissionui forbids.
   */
  const html = await renderScreen('src/components/TicketDesign.vue', store(ADMIN, ONE), {
    drive: async (b) => { await b.load(); b.tab.value = 'place' },
    renderReal: ['ToolBar.vue', 'ToolButton.vue'],
  })
  const tools = ['Align left', 'Centre across', 'Align right', 'Align top', 'Centre down',
    'Align bottom', 'Bring forward', 'Send backward', 'Bring to front', 'Send to back']
  for (const t of tools) {
    const m = html.match(new RegExp(`<button[^>]*aria-label="${t}"[^>]*>`))
    ok(m, `the rail has "${t}"`)
    ok(m && /disabled/.test(m[0]) && /title="Nothing is selected"/.test(m[0]),
      `"${t}" is disabled with its reason while nothing is selected`)
  }
}

console.log('work that was never saved is offered back, and only when it differs')
{
  /*
   * A reload or a crashed tab used to lose every placement since the last Save,
   * silently. The studio now keeps unsaved work per template in local storage
   * (src/lib/studiodraft.js) and OFFERS it back — it is never restored without
   * being asked. What this pins is the screen's half: the offer appears for
   * work that differs from the save, says when the save moved on since, and
   * does not appear for a draft that equals what is saved (an offer that
   * changes nothing teaches people to dismiss offers).
   *
   * A Storage-shaped object on globalThis stands in for the browser's; the
   * studio probes it at setup exactly as it would the real one.
   */
  const T = ONE.templates[0]
  const savedText = designText(designFor(T))
  const edited = designFor(T)
  edited.stubAt = 0.61
  const withDraft = async (draft) => {
    const m = new Map()
    if (draft) m.set(draftKey(T.id), JSON.stringify({ v: 1, keptAt: Date.now(), editedAt: '', ...draft }))
    globalThis.localStorage = {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => { m.set(k, String(v)) },
      removeItem: (k) => { m.delete(k) },
    }
    try {
      return visibleText(await renderScreen('src/components/TicketDesign.vue', store(ADMIN, ONE), {
        drive: async (b) => { await b.load(); b.tab.value = 'place' },
      }))
    } finally { delete globalThis.localStorage }
  }

  const newer = await withDraft({ design: designText(edited), saved: savedText })
  ok(/were kept on this computer/.test(newer), 'a draft made on top of this save is offered')
  ok(/Restore them/.test(newer) && /Discard them/.test(newer), 'with both answers')

  const stale = await withDraft({ design: designText(edited), saved: '{"older":true}' })
  ok(/has been saved since/.test(stale), 'a draft made before somebody saved again says so')

  const same = await withDraft({ design: savedText, saved: savedText })
  ok(!/Restore them/.test(same), 'a draft that equals the save is not offered')

  const none = await withDraft(null)
  ok(!/Restore them/.test(none), 'and with nothing kept there is no offer')
  ok(/Place|Ticket Studio/.test(none), 'which is the studio rendering, not a blank page reading as "no offer"')
}

console.log('a band selects what it touches, a group comes whole, and a paste stands alone')
{
  /*
   * STUDIO-ESSENTIALS Phase 2, driven through the shell's own handlers. The
   * arithmetic is pinned in selection/clipboard; what can only be seen here is
   * that the studio calls it on the right gesture and with the right lists:
   * a marquee that forgot the drawn shapes, a placement that did not group its
   * parts, or a paste that ignored the sixty-shape cap would each pass those
   * suites and still be wrong on the screen.
   */
  const { ctx, cleanup } = await setupOf('src/components/TicketDesign.vue', store(ADMIN, ONE))
  await ctx.load()
  ctx.tab.value = 'place'
  const ids = () => ctx.picked.value

  // The marquee, across the stub's buyer lines.
  ctx.drag.value = { mode: 'band', add: false }
  ctx.drawn.value = { left: 0.78, top: 0.35, width: 0.2, height: 0.62 }
  ctx.endPointer()
  ok(['buyer-name', 'buyer-phone', 'buyer-address', 'buyer-seller'].every((id) => ids().includes(id)),
    'a band dragged down the stub takes every buyer line it touches')
  ok(!ids().includes('qrStub'), 'but not the stub\'s code, which is switched off and so not on the ticket')
  ok(!ids().includes('number-main'), 'nor anything outside the band')

  ctx.drag.value = { mode: 'band', add: false }
  ctx.drawn.value = { left: 0.5, top: 0.5, width: 0.001, height: 0.001 }
  ctx.endPointer()
  eq(ids().length, 0, 'a click on empty artboard lets go of the selection')

  // A library placement is one group; a click takes it all, ⌘-click one part.
  const seal = BUILT_IN.find((b) => (b.parts || []).length > 1) || BUILT_IN[1]
  ctx.placeFromLibrary(seal)
  const placed = ctx.design.value.decorations.slice(-seal.parts.length)
  ok(placed.length > 1 && placed.every((d) => d.group && d.group === placed[0].group),
    `a placed ${seal.name} is ${placed.length} parts under one group`)
  ctx.pick(placed[0].id)
  eq(ids().length, placed.length, 'a click on one part selects the whole placement')
  ctx.pick(placed[0].id, false, true)
  eq(ids().length, 1, 'a ⌘-click selects the one part')

  const again = ctx.placeFromLibrary(seal) ?? ctx.design.value.decorations.slice(-seal.parts.length)
  ok(again[0].group !== placed[0].group, 'and a second placement is a second group, not the first one again')

  // The rail's group tools and their reasons.
  ctx.pick('buyer-name')
  ok(/field/.test(ctx.whyNotGroup.value), 'grouping a field is refused with the reason')
  ok(/field/.test(ctx.whyNotFlip.value), 'and so is mirroring one')

  // Copy and paste.
  const before = { e: ctx.design.value.elements.length, d: ctx.design.value.decorations.length }
  ctx.sel.value = 'book-main'
  ctx.also.value = [placed[0].id]
  ctx.copyPicked()
  ctx.pastePicked()
  eq(ctx.design.value.elements.length, before.e + 1, 'paste adds the copied field')
  eq(ctx.design.value.decorations.length, before.d + 1, 'and the copied shape')
  const pastedEl = ctx.design.value.elements[ctx.design.value.elements.length - 1]
  ok(pastedEl.id !== 'book-main' && pastedEl.after === '', 'the pasted field is new and flows after nothing')
  ok(ids().includes(pastedEl.id), 'and what was pasted is what is selected afterwards')

  // The cap, and the refusal counted rather than silent.
  const filler = Array.from({ length: 59 - ctx.design.value.decorations.length },
    (_, i) => normalDecoration({ id: `d-fill-${i}`, kind: 'rect' }))
  ctx.design.value.decorations = [...ctx.design.value.decorations, ...filler]
  ctx.clip.value = { elements: [], decorations: placed.map((d) => ({ ...d })) }
  ctx.pastePicked()
  eq(ctx.design.value.decorations.length, 60, 'a paste stops at the sixty a ticket holds')

  // Mirroring a selection turns it over as one.
  const m1 = normalDecoration({ id: 'd-m1', kind: 'rect', box: { left: 0.1, top: 0.1, width: 0.1, height: 0.1 } })
  const m2 = normalDecoration({ id: 'd-m2', kind: 'rect', box: { left: 0.3, top: 0.1, width: 0.1, height: 0.1 } })
  ctx.design.value.decorations = [m1, m2]
  ctx.sel.value = 'd-m1'
  ctx.also.value = ['d-m2']
  ctx.flipPicked('across')
  const [f1, f2] = ctx.design.value.decorations
  ok(f1.flipX && f2.flipX, 'both shapes are mirrored')
  ok(Math.abs(f1.box.left - 0.3) < 1e-9 && Math.abs(f2.box.left - 0.1) < 1e-9,
    'and they swap places within the box they share, rather than each flipping where it stands')

  // A pinned field stays put.
  const pinned = ctx.design.value.elements.find((e) => e.id === 'number-main')
  pinned.locked = true
  const at = pinned.box.left
  ctx.sel.value = 'number-main'
  ctx.also.value = []
  ctx.onKey({ key: 'ArrowRight', shiftKey: true, preventDefault() {} })
  eq(pinned.box.left, at, 'an arrow key does not move a pinned field')
  ctx.startMove(pinned, { stopPropagation() {}, shiftKey: false, metaKey: false, currentTarget: {}, pointerId: 1, clientX: 0, clientY: 0 })
  ok(!ctx.drag.value, 'and a drag does not start on one')

  await cleanup()
}

console.log('several things selected get a panel of their own, and the rail its new tools')
{
  const html = await renderScreen('src/components/TicketDesign.vue', store(ADMIN, ONE), {
    drive: async (b) => {
      await b.load(); b.tab.value = 'place'
      b.sel.value = 'buyer-name'
      b.also.value = ['buyer-phone', 'buyer-address']
    },
    renderReal: ['SelectionInspector.vue', 'ToolBar.vue', 'ToolButton.vue'],
  })
  const text = visibleText(html)
  ok(/3 selected/.test(text), 'the panel says how many are selected')
  ok(/Buyer's name/.test(text) && /Phone/.test(text) && /Address/.test(text), 'and names every one of them')
  for (const t of ['Flip across', 'Flip down', 'Group', 'Ungroup']) {
    const m = html.match(new RegExp(`<button[^>]*aria-label="${t}"[^>]*>`))
    ok(m, `the rail has "${t}"`)
    ok(m && /disabled/.test(m[0]) && /title="[^"]+"/.test(m[0]),
      `"${t}" is disabled with a reason when only fields are selected`)
  }
}

console.log('the canvas measures the paper, draws its grid, and zooms from the keyboard')
{
  /*
   * STUDIO-ESSENTIALS Phase 3. The ruler read shares (0, 25%, 50%…) across the
   * top only, and the 2 mm grid the snapping used was invisible, so a box
   * jumping to it had no reason on screen. Rendered at the fixture's zoom —
   * 800 px for 190 mm, about 4.2 px a millimetre — the ruler must read
   * millimetres both ways and the grid must be drawn.
   */
  const html = await renderScreen('src/components/TicketDesign.vue', store(ADMIN, ONE), {
    drive: async (b) => { await b.load(); b.tab.value = 'place'; b.zoom.value = 0.5 },
    renderReal: ['Rulers.vue'],
  })
  ok(/class="rulers"/.test(html), 'the artboard sits inside its rulers')
  const labels = [...html.matchAll(/<text[^>]*>(\d+)<\/text>/g)].map((m) => Number(m[1]))
  ok(labels.length > 6, `the rulers carry labels (${labels.length})`)
  ok(labels.includes(190), 'the top ruler reaches the ticket\'s 190 mm')
  ok(labels.includes(60), 'the side ruler reaches its 60-odd mm, which was on no ruler before')
  ok(!/>25%</.test(html), 'and no ruler reads in shares any more')
  ok(/class="gridlines"/.test(html), 'the 2 mm grid the snapping uses is drawn')

  const { ctx, cleanup } = await setupOf('src/components/TicketDesign.vue', store(ADMIN, ONE))
  await ctx.load()
  ctx.tab.value = 'place'
  const key = (k, mods = {}) => ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false,
    target: null, preventDefault() {}, ...mods })
  ctx.zoom.value = 0.5
  ctx.onFocusKey(key('+'))
  eq(ctx.zoom.value, 0.75, '+ steps the zoom in')
  ctx.onFocusKey(key('-'))
  eq(ctx.zoom.value, 0.5, 'and − steps it back out')
  ctx.onFocusKey(key('1', { metaKey: true }))
  eq(ctx.zoom.value, 1, '⌘1 is actual size — one artwork pixel to one screen pixel')
  ctx.onFocusKey(key(' '))
  ok(ctx.spaceHeld.value, 'holding Space picks up the hand')
  ctx.onFocusKeyUp({ key: ' ' })
  ok(!ctx.spaceHeld.value, 'and letting go puts it down')

  const { xs } = ctx.edgesExcept(new Set(['number-main']))
  ok(xs.includes(0.5), 'a moving box may snap to the artboard\'s centre')
  const bm = ctx.design.value.elements.find((e) => e.id === 'book-main').box
  ok(xs.some((x) => Math.abs(x - (bm.left + bm.width / 2)) < 1e-9), 'and to the centre of another box')
  await cleanup()
}

console.log('a drawn shape is called what somebody named it')
{
  /*
   * STUDIO-ESSENTIALS Phase 5. A layer list of "Rectangle, Rectangle,
   * Rectangle" is a list somebody clicks through to find the tint behind the
   * price. A named shape must be called by its name everywhere the studio
   * names it — the list, and the box on the canvas a screen reader announces.
   */
  const html = await renderScreen('src/components/TicketDesign.vue', store(ADMIN, ONE), {
    drive: async (b) => {
      await b.load(); b.tab.value = 'place'
      b.design.value.decorations = [normalDecoration({ id: 'd-named', kind: 'rect', name: 'Price tint' })]
    },
  })
  ok(/Price tint/.test(visibleText(html)), 'the layer list calls it by its name')
  ok(/aria-label="Price tint"/.test(html), 'and so does its box on the artboard')

  const { ctx, cleanup } = await setupOf('src/components/TicketDesign.vue', store(ADMIN, ONE))
  await ctx.load()
  const d = normalDecoration({ id: 'd-r', kind: 'rect' })
  ctx.design.value.decorations = [d]
  const live = () => ctx.design.value.decorations[0]
  const undoBefore = ctx.history.value.length
  ctx.renaming.value = 'd-r'
  ctx.commitRename(live(), '  Stub panel  ')
  eq(live().name, 'Stub panel', 'a rename is kept, trimmed')
  eq(ctx.history.value.length, undoBefore + 1, 'as one undo step')
  eq(ctx.renaming.value, '', 'and the field gives the row back')
  ctx.commitRename(live(), 'Ignored')
  eq(live().name, 'Stub panel', 'a commit with no rename in progress changes nothing — Escape then blur must not save')
  await cleanup()
}

console.log('the ticket can be seen in grey, handed over as a file, and lettered from the library')
{
  /*
   * STUDIO-ESSENTIALS Phase 6. The grey view must reach the artwork and not
   * the studio's own boxes (which stay findable in colour); the sample must be
   * downloadable from the stage bar; and a kept lettering style must land on
   * a field AND on drawn words, which store their lettering differently.
   */
  const html = await renderScreen('src/components/TicketDesign.vue', store(ADMIN, ONE), {
    drive: async (b) => { await b.load(); b.tab.value = 'place'; b.inGrey.value = true },
    renderReal: ['ToolBar.vue', 'ToolButton.vue'],
  })
  ok(/class="frame[^"]*\bgrey\b/.test(html), 'the grey view marks the artboard')
  for (const t of ['PNG', 'SVG']) {
    const m = html.match(new RegExp(`<button[^>]*aria-label="${t}"[^>]*>`))
    ok(m && !/disabled/.test(m[0]), `a sample can be downloaded as ${t} once there is artwork`)
  }

  const { ctx, cleanup } = await setupOf('src/components/TicketDesign.vue', store(ADMIN, ONE))
  await ctx.load()
  ok(!ctx.whyNoExport.value, 'with artwork, nothing stands in the way of a download')
  const words = normalDecoration({ id: 'd-words', kind: 'text', text: { value: 'Grand prize' } })
  ctx.design.value.decorations = [words]
  ctx.sel.value = 'buyer-name'
  ctx.also.value = ['d-words']
  const style = { id: 't1', name: 'Prize line', family: 'number', weight: 'bold', align: 'centre', tracking: 0.1, colour: '#b8860b' }
  ctx.useLibraryStyle(style)
  const field = ctx.design.value.elements.find((e) => e.id === 'buyer-name')
  const w = ctx.design.value.decorations[0]
  ok(field.family === 'number' && field.weight === 'bold' && field.align === 'centre' && field.ink === '#b8860b',
    'a kept style letters a field — face, weight, alignment and ink')
  ok(w.text.family === 'number' && w.text.tracking === 0.1 && w.fill.colour === '#b8860b',
    'and drawn words, with their spacing and colour')
  ctx.sel.value = 'd-words'
  ctx.also.value = []
  eq(ctx.pickedLettering.value?.weight, 'bold', 'and the lettering read back off a selection is what was put on it')
  await cleanup()
}

console.log('a picture the raffle already has can be placed, fitted whole, and changed')
{
  /*
   * STUDIO-ESSENTIALS Phase 7. The model and renderer could draw a picture and
   * nothing could place one. What is pinned here is the screen's half: the
   * tool offers what the raffle has uploaded, a placed picture starts fitted
   * whole (a logo cropped to fill its box has lost its edges), and "Change
   * picture" replaces the address in one undo step rather than adding a second.
   */
  const { ctx, cleanup } = await setupOf('src/components/TicketDesign.vue', store(ADMIN, ONE))
  await ctx.load()
  ctx.tab.value = 'place'
  ok(ctx.pictures.value.some((p) => p.src === ONE.templates[0].url), 'the uploaded artwork is on offer')
  eq(ctx.whyNoPicture.value, '', 'so the tool is not disabled')

  ctx.pickPicture(ONE.templates[0].url)
  eq(ctx.pending.value, 'd:image', 'picking a picture waits for its box to be drawn')
  ctx.addDecorationAt('image', { left: 0.1, top: 0.1, width: 0.1, height: 0.1 })
  const placed = ctx.design.value.decorations[ctx.design.value.decorations.length - 1]
  eq(placed.kind, 'image', 'drawing the box places a picture')
  eq(placed.image.src, ONE.templates[0].url, 'of the picture chosen')
  eq(placed.image.fit, 'contain', 'fitted whole to start with')
  eq(ctx.pendingPicture.value, '', 'and nothing is left waiting')

  const before = ctx.design.value.decorations.length
  const undo = ctx.history.value.length
  ctx.sel.value = placed.id
  ctx.changePicture()
  ok(ctx.showPictures.value, '"Change picture" opens the picker')
  ctx.pickPicture('https://x.org/other.png')
  eq(ctx.design.value.decorations.length, before, 'and a new choice replaces the picture rather than adding one')
  eq(ctx.design.value.decorations[ctx.design.value.decorations.length - 1].image.src, 'https://x.org/other.png', 'at the new address')
  eq(ctx.history.value.length, undo + 1, 'in one undo step')
  await cleanup()
}

console.log('the pen draws a path, and a path is edited by its nodes')
{
  /*
   * STUDIO-ESSENTIALS Phase 8, ruled in by the user: paths, drawn with a pen
   * and shaped by their nodes. Driven through the studio's own pen (usePen.js,
   * which the shell exposes) and its key table — the geometry is pinned in
   * pathgeometry.test.mjs; what can only be seen here is that the studio turns
   * presses into a stored path, and that editing refits the box around it.
   */
  const { ctx, cleanup } = await setupOf('src/components/TicketDesign.vue', store(ADMIN, ONE))
  await ctx.load()
  ctx.tab.value = 'place'
  const key = (k, mods = {}) => ({ key: k, code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    target: null, preventDefault() {}, ...mods })

  ctx.onFocusKey(key('p'))
  eq(ctx.pending.value, 'd:path', 'P picks up the pen')
  const pen = ctx.pen
  pen.down([0.10, 0.50]); pen.up()
  pen.down([0.20, 0.30]); pen.move([0.26, 0.24]); pen.up()          // pressed and dragged up-right: a curve that rises past the node
  pen.down([0.30, 0.50]); pen.up()
  ok(ctx.penDrawing.value?.nodes.length === 3, 'three nodes put down')
  ok(ctx.penDrawing.value.nodes[1].hx2 !== undefined, 'the dragged one is smooth, with handles')
  ctx.onFocusKey(key('Enter'))
  const path = ctx.design.value.decorations[ctx.design.value.decorations.length - 1]
  eq(path?.kind, 'path', 'Enter finishes it as a path on the ticket')
  eq(path.path.closed, false, 'an open one')
  ok(path.box.top < 0.30, `and its box reaches the curve's bulge, above the top node (top ${path.box.top.toFixed(4)})`)
  eq(ctx.sel.value, path.id, 'the finished path is selected')
  eq(ctx.pending.value, '', 'and the pen is put down')

  ctx.onFocusKey(key('p'))
  pen.down([0.5, 0.5]); pen.up()
  pen.down([0.6, 0.5]); pen.up()
  pen.down([0.55, 0.6]); pen.up()
  pen.down([0.5, 0.5]); pen.up()
  const tri = ctx.design.value.decorations[ctx.design.value.decorations.length - 1]
  ok(tri.kind === 'path' && tri.path.closed, 'clicking the first node closes the path')
  eq(tri.path.nodes.length, 3, 'without adding a fourth node on top of the first')

  ctx.onFocusKey(key('a'))
  eq(ctx.penEditing.value, tri.id, 'A shows the selected path\'s nodes')
  const before = { ...tri.box }
  const undo = ctx.history.value.length
  pen.gripDown(2, 'node', [0.55, 0.6])
  pen.gripMove([0.55, 0.8])
  pen.gripUp()
  ok(tri.box.height > before.height + 0.15, 'dragging a node below the path grows its box to follow')
  eq(ctx.history.value.length, undo + 1, 'as one undo step')
  pen.toggleNode(0)
  ok(tri.path.nodes[0].hx2 !== undefined, 'double-clicking a corner makes it smooth')
  ctx.chosenNode.value = 1
  ctx.onFocusKey(key('Delete'))
  eq(tri.path.nodes.length, 2, 'Delete with nodes up removes the chosen node, not the path')
  ok(ctx.design.value.decorations.includes(tri), 'the path itself stays')
  ctx.onFocusKey(key('Escape'))
  eq(ctx.penEditing.value, '', 'and Escape puts the nodes away')

  ok(!ctx.onFocusKey(key('Enter')), 'Enter with no path being drawn is not taken from the page')
  await cleanup()
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
