/*
 * THE CARD A BUYER IS SENT DID NOT CHANGE WHEN IT BECAME DESIGNABLE.
 *
 * `digitalCardSVG` and its two siblings carried about ninety hard-coded
 * coordinates each. They now ask `cardelements.js` where every part goes, so
 * that Ticket Studio can move one. That is a refactor of the drawing of every
 * ticket this raffle has ever sent, and the one thing it must not do is
 * redraw them.
 *
 * SO THE FIRST TEST IN THIS FILE IS A GOLDEN ONE, and the fixture beside it
 * was generated from the renderers AS THEY WERE — `git show HEAD:…` into a
 * scratch directory, rendered, committed. Not from the new code, which would
 * be a test of nothing. Six renders: each treatment with everything on it, and
 * each with the motto, the sold chip, the supporter band, the price, the book
 * and the sale date all absent, because that is the state where the cards move
 * their own lines about and where a mistake would hide.
 *
 * The fixture is rendered WITHOUT the encoder, so it holds no QR. That is what
 * keeps it 21 KB instead of 300, and the QR is not lost: `thecodeissquare`
 * below renders one for real and checks the box it lands in, which is the only
 * part of it this change could affect.
 *
 * WHAT THE REST OF THE FILE IS FOR. A layer list is a promise — every row in
 * it is a thing you can move, hide and recolour. `everypartisreallydrawn`
 * keeps that promise honest by hiding each part in turn and insisting the
 * picture changes. A row that draws nothing is exactly the defect this kind of
 * screen ships: it looks complete, and one of the eight controls does nothing
 * at all.
 */
import { readFileSync } from 'node:fs'
import { cardSVG, CARD, CARD_CERT, CARD_STUB } from '../src/lib/ticketart.js'
import {
  CARD_SIZES, CARD_TREATMENTS, standardParts, resolveParts, partBoxes,
  layoutFrom, validateCardLayout,
} from '../src/lib/cardelements.js'
import { encode } from '../src/lib/qrcodegen.js'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => {
  String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`))
}

const V = {
  number: 'KS-00031', name: 'Daw Hla Myint Aung', org: 'CEAM Shelter',
  event: 'Fundraising Raffle', price: 'RM 10.00', book: 'Book-004',
  soldOn: '14 Sep 2026', drawOn: '31 Dec 2026', sold: true,
  motto: 'Love is patient, love is kind', brand: '#0d7a6f', ink: '#ffffff',
  thanks: 'Thank you — this keeps the shelter open.',
  link: 'shrtickets.ceamalaysia.org/v/?KS-00031',
  rankName: 'Gold supporter', rankCount: '6 books',
}
const BARE = {
  ...V, motto: '', sold: false, rankName: '', rankCount: '',
  book: '', price: '', soldOn: '', logo: '',
}
const QR = { qrUrl: 'https://x.test/v/?KS-00031&c=ABCDEFGH', encode }

/* ---------- the cards did not change ---------- */

console.log('the standard layout draws the card the renderers already drew')
{
  const golden = JSON.parse(readFileSync(new URL('./fixtures/cards.golden.json', import.meta.url), 'utf8'))
  const keys = Object.keys(golden)
  /* A loop that finds nothing passes silently. Say how many there should be. */
  eq(keys.length, 6, 'the fixture holds six renders')
  for (const id of CARD_TREATMENTS) {
    ok(golden[id] !== undefined, `the fixture has a ${id} render`)
    eq(cardSVG(id, V, {}), golden[id], `${id} is drawn exactly as it was`)
    eq(cardSVG(id, BARE, {}), golden[`${id}:bare`], `${id} with nothing optional on it is drawn exactly as it was`)
  }
  /* An empty overlay and no overlay at all have to mean the same thing: a
     raffle that opened the tab, changed nothing and saved would otherwise get
     a different card from one that never opened it. */
  for (const id of CARD_TREATMENTS) {
    eq(cardSVG(id, V, { layout: {} }), golden[id], `an empty layout leaves ${id} alone`)
    eq(cardSVG(id, V, { layout: { [id]: {} } }), golden[id], `an empty ${id} overlay leaves it alone`)
  }
}

/* ---------- every row in the list is a real part of the drawing ---------- */

console.log('every part in the list changes the card when it is hidden')
{
  let checked = 0
  for (const id of CARD_TREATMENTS) {
    const whole = cardSVG(id, V, QR)
    const parts = standardParts(id)
    ok(parts.length >= 8, `${id} has a list of parts`)
    for (const p of parts) {
      if (p.locked) {
        /* The background cannot be hidden, and the model refuses it rather
           than leaving a control that quietly does nothing. */
        const tried = cardSVG(id, V, { ...QR, layout: { [id]: { [p.id]: { enabled: false } } } })
        eq(tried, whole, `${id}/${p.id} cannot be hidden`)
        eq(resolveParts(id, { [id]: { [p.id]: { enabled: false } } }).find((x) => x.id === p.id).enabled,
          'true', `${id}/${p.id} stays shown in the model too`)
        continue
      }
      const without = cardSVG(id, V, { ...QR, layout: { [id]: { [p.id]: { enabled: false } } } })
      ok(without !== whole, `${id}/${p.id} draws something, so hiding it changes the card`)
      ok(without.length < whole.length, `${id}/${p.id} draws LESS when hidden`)
      checked += 1
    }
  }
  /* The enumeration itself is the thing that can silently find nothing. */
  ok(checked >= 20, `enough parts were actually checked (${checked})`)
}

console.log('moving a part moves what is drawn')
{
  const std = cardSVG('grand', V, {})
  const moved = cardSVG('grand', V, { layout: { grand: { motto: { box: { left: 0.4, top: 0.5, width: 0.5, height: 0.05 } } } } })
  ok(moved !== std, 'a moved motto is drawn somewhere else')
  /* 0.4 of 1200 is 480, and the motto's baseline is 30 px down its own box at
     the standard scale. The box is shorter than standard, so the type scales
     with it — which is the whole reason height is a control and not a label. */
  ok(moved.includes('x="480"'), 'the motto is drawn at the left edge it was given')
  ok(!moved.includes('y="664"'), 'and not at the baseline it had')

  /* TYPE TAKES ITS SIZE FROM THE HEIGHT OF ITS BOX and its measure from the
     width, which is how a text frame behaves anywhere else. */
  const wide = partBoxes('grand', { grand: { motto: { box: { left: 0.05, top: 0.8, width: 0.9, height: 0.0526316 } } } })
  eq(Math.round(wide.motto.k), 1, 'a box the standard height keeps the standard scale, however wide it is')
  const tall = partBoxes('grand', { grand: { motto: { box: { left: 0.05, top: 0.6, width: 0.9, height: 0.1052632 } } } })
  ok(tall.motto.k > 1.9 && tall.motto.k < 2.1, 'twice the height is twice the scale')
  /* A PICTURE FITS ITS BOX INSTEAD — whichever axis is tighter — so that a
     code dragged sideways does not come out an oblong nobody can scan. */
  const squashed = partBoxes('grand', { grand: { code: { box: { left: 0.1, top: 0.1, width: 0.9, height: 0.1552632 } } } })
  ok(squashed.code.k > 0.49 && squashed.code.k < 0.51, 'a wide, short code takes its scale from the short side')
}

console.log('the parts answer for their own lettering, colour and alignment')
{
  const at = (l) => cardSVG('grand', V, { layout: { grand: l } })
  ok(at({ number: { align: 'centre' } }).includes('text-anchor="middle"'), 'centre gives the number a middle anchor')
  ok(at({ number: { align: 'right' } }).includes('text-anchor="end"'), 'right gives it an end anchor')
  ok(at({ number: { ink: '#ff0000' } }).includes('fill="#ff0000"'), 'a colour set on a part is the colour it prints in')
  ok(!cardSVG('grand', V, {}).includes('fill="#ff0000"'), 'and is not there when nothing set one')
  ok(at({ buyer: { family: 'number' } }).includes('Liberation Serif'), 'the serif face reaches the buyer\'s name')
  ok(!at({ buyer: { weight: 'regular' } }).match(/Daw Hla[^<]*<\/text>/)
    || !at({ buyer: { weight: 'regular' } }).includes('font-weight="700" xml:space="preserve">Daw'),
  'unbolding the name takes the weight off it')
  /* The card's own colour is the default, and the way back to it is storing
     nothing rather than storing white — which on a pale brand is invisible. */
  eq(resolveParts('grand', { grand: { number: { ink: '' } } }).find((p) => p.id === 'number').ink,
    '', 'an empty colour means the card decides')
  eq(resolveParts('grand', { grand: { number: { ink: 'not a colour' } } }).find((p) => p.id === 'number').ink,
    '', 'and so does a colour that is not one')
}

console.log('the code is square however its box is dragged')
{
  const wide = partBoxes('grand', { grand: { code: { box: { left: 0.1, top: 0.1, width: 0.6, height: 0.3105263 } } } })
  /* k takes the tighter axis, so a box stretched sideways draws the same
     square code rather than an oblong one that will not scan. */
  eq(Math.round(wide.code.own), Math.round(wide.code.h), 'the drawn code stays square in a wide box')
  const drawn = cardSVG('grand', V, QR)
  const first = drawn.match(/<rect x="884" y="250" width="236" height="236" fill="#ffffff"\/>/)
  ok(!!first, 'the standard code lands in the box cardelements gives it')
  for (const id of CARD_TREATMENTS) {
    ok(cardSVG(id, V, QR).length > cardSVG(id, V, {}).length + 2000,
      `${id} draws a real QR when it is given an encoder`)
  }
}

console.log('hiding the motto lifts the two lines under it')
{
  const withMotto = cardSVG('grand', V, QR)
  const hidden = cardSVG('grand', V, { ...QR, layout: { grand: { motto: { enabled: false } } } })
  const empty = cardSVG('grand', { ...V, motto: '' }, QR)
  ok(withMotto.includes('y="702"'), 'the thank-you sits under the motto when there is one')
  ok(hidden.includes('y="676"') && !hidden.includes('y="702"'),
    'and rises into its place when the motto is switched off')
  ok(empty.includes('y="676"'), 'the same when the motto is simply blank')
}

/* ---------- only what was changed is stored ---------- */

console.log('a layout stores the differences and nothing else')
{
  for (const id of CARD_TREATMENTS) {
    eq(JSON.stringify(layoutFrom(id, standardParts(id), {})), '{}',
      `${id} untouched stores nothing at all`)
  }
  const parts = standardParts('grand')
  parts.find((p) => p.id === 'motto').box.left = 0.2
  const out = layoutFrom('grand', parts, {})
  eq(Object.keys(out).join(), 'grand', 'one treatment is stored')
  eq(Object.keys(out.grand).join(), 'motto', 'one part is stored')
  eq(Object.keys(out.grand.motto).join(), 'box', 'one field of it is stored')
  eq(out.grand.motto.box.left, 0.2, 'and it is the value that was set')

  /* The other treatments are not on screen and must survive being saved. */
  const kept = layoutFrom('grand', parts, { stub: { number: { align: 'centre' } } })
  eq(kept.stub.number.align, 'centre', 'another treatment is carried through untouched')

  /* Round trip: resolve what was stored and it stores back the same. */
  const again = layoutFrom('grand', resolveParts('grand', out), out)
  eq(JSON.stringify(again), JSON.stringify(out), 'resolving and folding is a round trip')

  /* And putting a part back where it started removes it from storage, so a
     card that has been arranged and unarranged is not frozen at that layout. */
  const back = resolveParts('grand', out)
  back.find((p) => p.id === 'motto').box = standardParts('grand').find((p) => p.id === 'motto').box
  eq(JSON.stringify(layoutFrom('grand', back, out)), '{}', 'putting it back stores nothing again')
}

console.log('a layout this build does not understand is ignored, never thrown on')
{
  const odd = {
    grand: { motto: { box: { left: 0.2 } }, nosuchpart: { box: { left: 0.9 } } },
    nosuchtreatment: { whatever: { enabled: false } },
  }
  let threw = ''
  let parts = []
  try { parts = resolveParts('grand', odd) } catch (e) { threw = String(e) }
  eq(threw, '', 'an unknown part and an unknown treatment do not throw')
  eq(parts.find((p) => p.id === 'motto').box.left, 0.2, 'the part it did understand is applied')
  eq(parts.length, standardParts('grand').length, 'and no phantom part is invented')
  /* One bad field must not discard the good ones beside it. */
  const half = resolveParts('grand', { grand: { motto: { box: { left: 0.3, width: 0 }, align: 'sideways' } } })
  const m = half.find((p) => p.id === 'motto')
  eq(m.align, 'left', 'an alignment that is not one keeps the standard')
  eq(m.box.width, standardParts('grand').find((p) => p.id === 'motto').box.width,
    'a width of zero keeps the standard width')
  ok(m.box.left !== 0.3, 'a box is taken whole or not at all, so the left goes with it')
}

console.log('what the server and the screen both refuse')
{
  eq(validateCardLayout({}).length, 0, 'an empty layout is fine')
  eq(validateCardLayout(null).length, 0, 'nothing at all is fine')
  /* The watermark's own standard box runs off the right edge of the card on
     purpose — a bleed. A rule that clamped boxes to 0..1 would refuse the
     layout this app ships with, which is the classic "everything except X". */
  for (const id of CARD_TREATMENTS) {
    const all = Object.fromEntries(standardParts(id).map((p) => [p.id, { box: p.box }]))
    eq(validateCardLayout({ [id]: all }).length, 0, `${id}'s own standard layout passes`)
  }
  ok(validateCardLayout([]).length > 0, 'an array is refused')
  ok(validateCardLayout({ nosuch: {} }).length > 0, 'an unknown treatment is refused')
  ok(validateCardLayout({ grand: [] }).length > 0, 'a treatment that is not a set of parts is refused')
  ok(validateCardLayout({ grand: { motto: { box: { width: 0 } } } }).length > 0, 'a zero width is refused')
  ok(validateCardLayout({ grand: { motto: { box: { left: 9 } } } }).length > 0, 'a part nine cards away is refused')
  ok(validateCardLayout({ grand: { motto: { ink: 'red' } } }).length > 0, 'a colour that is not a hex is refused')
  ok(validateCardLayout({ grand: { motto: { ink: '' } } }).length === 0, 'an empty colour is allowed — it means the card decides')
  ok(validateCardLayout({ grand: { watermark: { opacity: 4 } } }).length > 0, 'a strength above one is refused')
  /* An id this build has dropped must pass, or an older browser cannot save. */
  eq(validateCardLayout({ grand: { gonepart: { box: { left: 0.5 } } } }).length, 0,
    'a part this build no longer has is passed through, not refused')
}

/* ---------- the two files agree about the shapes ---------- */

console.log('one set of measurements, imported rather than copied')
{
  eq(JSON.stringify(CARD), JSON.stringify(CARD_SIZES.grand), 'ticketart re-exports the Grand size')
  eq(JSON.stringify(CARD_CERT), JSON.stringify(CARD_SIZES.certificate), 'and the Certificate size')
  eq(JSON.stringify(CARD_STUB), JSON.stringify(CARD_SIZES.stub), 'and the Stub size')
  for (const id of CARD_TREATMENTS) {
    const svg = cardSVG(id, V, {})
    const s = CARD_SIZES[id]
    ok(svg.includes(`viewBox="0 0 ${s.width} ${s.height}"`), `${id} is drawn at the size its layout measures against`)
  }
}

/* ---------- the arrangement reaches the buyer, not only the preview ---------- */

/*
 * THE FAULT THIS EXISTS TO CATCH HAS ALREADY HAPPENED ONCE ON THIS CARD.
 *
 * ViewTicket used to offer three treatment buttons that changed its own
 * preview and nothing a buyer ever received: press Stub, send the ticket, the
 * buyer gets Grand. That picker was removed and the treatment moved to the
 * studio. A layout saved in the studio and not passed on here would be the
 * identical fault one layer down, and it would look completely fine — the
 * studio's own preview draws from the same list it saves, so the ONLY place
 * the gap shows is in what somebody is sent.
 *
 * Read from the source, because there is nothing to render: `cardFor` is
 * called by the share path and by the modal, and both go through this one
 * line.
 */
console.log('what the studio saves is what a buyer is sent')
{
  const view = readFileSync(new URL('../src/components/modals/ViewTicket.vue', import.meta.url), 'utf8')
  const call = (view.match(/cardSVG\([\s\S]*?\n\}\)/) || [''])[0]
  ok(call.length > 0, 'ViewTicket draws the card with cardSVG')
  ok(/layout:/.test(call), 'and hands it the raffle\'s saved layout')
  ok(/state\.cfg\?\.cardLayout/.test(call), 'read off config, which is where the studio writes it')
  /* The server has to send it in the first place, or the line above reads a
     field that is never populated and nothing anywhere fails. */
  const cfg = readFileSync(new URL('../supabase/functions/api/config.ts', import.meta.url), 'utf8')
  ok(/cardLayout:/.test(cfg), 'and the config payload carries it to every screen')
  const brand = readFileSync(new URL('../supabase/functions/api/branding.ts', import.meta.url), 'utf8')
  ok(/CARD_LAYOUT/.test(brand), 'and set_card_design is what writes it down')
  /* Absent means "leave it alone", so a screen saving only the motto cannot
     wipe an arrangement. The condition is the whole of that promise. */
  ok(/p\.cardLayout !== undefined/.test(brand),
    'a save that does not mention the layout leaves the stored one alone')
}

console.log('every part is named, unique, and drawn with an icon the set has')
{
  const icons = readFileSync(new URL('../src/components/ui/Icon.vue', import.meta.url), 'utf8')
  for (const id of CARD_TREATMENTS) {
    const parts = standardParts(id)
    const ids = parts.map((p) => p.id)
    eq(new Set(ids).size, ids.length, `${id} has no repeated part id`)
    for (const p of parts) {
      ok(p.name && p.name !== p.id, `${id}/${p.id} has a name a person would use`)
      ok(p.what && p.what.length > 3, `${id}/${p.id} says where it is`)
      /* The layer list and the inspector both draw `kind` as an icon. Icon.vue
         renders an unknown name as nothing at all, so a typo here is a row
         with a hole in it and no error anywhere. */
      ok(new RegExp(`^\\s+${p.kind}:`, 'm').test(icons), `${id}/${p.id} uses an icon the set has (${p.kind})`)
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
