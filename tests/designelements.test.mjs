/*
 * THE THINGS SOMEBODY DRAWS, as opposed to the things the raffle fills in.
 *
 * A decoration says nothing the app knows about — it is a rectangle, a rule, a
 * mark, a line of somebody's own words — which means nothing downstream can
 * check it against a value. That makes the two ends of this file carry the
 * whole weight: reading, which must never throw because it runs inside a screen
 * drawing somebody's ticket; and saving, which must refuse clearly because a
 * design quietly repaired on the way in is an organiser being shown something
 * they did not draw.
 *
 * THE ONE RULE HERE THAT IS ABOUT DESIGN AND NOT ABOUT DATA is the QR. A tint
 * across a code, a rule through it or a mark in its corner looks fine on screen
 * and fine on paper, and does not scan. The person who finds out is at a door
 * with a phone, and the run is already printed. So it is a refusal, and it is
 * the only refusal in this file that a valid value can trip.
 */
import {
  KINDS, FILLS, BLENDS, MAX_DECORATIONS,
  normalDecoration, normalDecorations, faultsIn,
  decorationSVG, decorationLayerSVG, printWarnings,
} from '../supabase/functions/_shared/designelements.js'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => {
  String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`))
}
const at = (left, top, width, height) => ({ left, top, width, height })
const W = 1000, H = 400

console.log('reading never throws, whatever it is handed')
{
  ok(KINDS.length === 6, `six kinds to check, not zero (${KINDS.join(', ')})`)
  const rubbish = [
    undefined, null, 0, '', 'a string', [], { kind: 'banana' },
    { box: { left: 'x', top: NaN, width: -5, height: Infinity } },
    { opacity: 99, rotation: 1e9, blend: 'colour-dodge', fill: { type: 'plaid' } },
    { stroke: { width: 'thick', dash: 'wavy' }, radius: 40 },
    { text: { value: 'x'.repeat(500), align: 'justified', family: 'comic' } },
    { shadow: { blur: 'lots', opacity: -3 } },
  ]
  for (const raw of rubbish) {
    let d
    try { d = normalDecoration(raw) } catch (e) { fail++; console.log(`  FAIL threw on ${JSON.stringify(raw)}: ${e.message}`); continue }
    ok(KINDS.includes(d.kind), 'a kind it knows')
    ok(d.box.width > 0 && d.box.height > 0, 'a box with real sides')
    ok(d.opacity >= 0 && d.opacity <= 1, 'an opacity between 0 and 1')
    ok(BLENDS.includes(d.blend), 'a blend it can draw')
    ok(FILLS.includes(d.fill.type), 'a fill it can draw')
  }
  eq(normalDecorations('not a list').length, 0, 'a list that is not one reads as empty')
  eq(normalDecorations(null).length, 0, 'and so does nothing at all')
}

console.log('the defaults are the ones that make a new thing visible')
{
  const r = normalDecoration({ kind: 'rect' })
  eq(r.fill.type, 'solid', 'a new rectangle is filled, or it is drawn and invisible')
  eq(r.stroke.width, 0, 'and has no outline, which would be a second decision nobody made')
  eq(r.opacity, 1, 'fully opaque')
  eq(r.enabled, true, 'and on')
  eq(r.locked, false, 'and not pinned')
  eq(r.shadow, null, 'no shadow until one is asked for')

  const l = normalDecoration({ kind: 'line' })
  eq(l.fill.type, 'none', 'a line has no fill — a filled line is a rectangle')
  ok(l.stroke.width > 0, 'and it does have a stroke, or it draws nothing at all')

  /*
   * A ZERO SIDE IS WHAT A HORIZONTAL RULE IS, and this was wrong until a
   * rendered ticket showed it. The default for a missing side was applied with
   * `||`, so a deliberate 0 — falsy — became 0.1, and a rule drawn across a
   * card came out as a diagonal over a tenth of its height.
   */
  eq(normalDecoration({ kind: 'line', box: { width: 0.8, height: 0 } }).box.height, 0,
    'a line keeps a height of zero, which is a horizontal rule')
  eq(normalDecoration({ kind: 'line', box: { width: 0, height: 0.8 } }).box.width, 0,
    'and a width of zero, which is a vertical one')
  eq(normalDecoration({ kind: 'rect', box: { width: 0.5 } }).box.height, 0.1,
    'while a side that is genuinely ABSENT still gets a visible default')
  ok(normalDecoration({ kind: 'rect', box: { width: 0.5, height: 0 } }).box.height > 0,
    'and a rect with no area is not one, so it keeps a floor')
  eq(faultsIn([{ id: 'a', kind: 'line', box: { left: 0, top: 0, width: 0.5, height: 0 } }]).length, 0,
    'saving a flat line is allowed')
  ok(faultsIn([{ id: 'a', kind: 'rect', box: { left: 0, top: 0, width: 0.5, height: 0 } }]).length > 0,
    'and saving a rect with no height is not')

  /* The cap is the honest place to say a ticket is not a canvas. */
  eq(normalDecorations(new Array(500).fill({ kind: 'rect' })).length, MAX_DECORATIONS,
    `a list longer than ${MAX_DECORATIONS} is cut to it`)
}

console.log('every kind draws something, and draws nothing when it cannot')
{
  const ctx = { icons: { check: 'M4 12l5 5L20 6' }, textFamily: 'Padauk', numberFamily: 'Georgia' }
  const drawn = {}
  for (const kind of KINDS) {
    const raw = {
      kind, box: at(0.1, 0.1, 0.3, 0.2),
      text: { value: 'Thank you' }, icon: { name: 'check' },
      image: { src: 'https://example.org/x.png' },
    }
    const svg = decorationSVG(raw, W, H, ctx)
    drawn[kind] = svg
    ok(svg.length > 0, `${kind} draws something`)
  }
  ok(/<rect /.test(drawn.rect), 'a rect is a rect')
  ok(/<ellipse /.test(drawn.ellipse), 'an ellipse is an ellipse')
  ok(/<line /.test(drawn.line), 'a line is a line')
  ok(/<text /.test(drawn.text) && /Thank you/.test(drawn.text), 'text carries its words')
  ok(/<image /.test(drawn.image), 'an image is an image')
  ok(/<path /.test(drawn.icon) && /M4 12l5 5L20 6/.test(drawn.icon), 'an icon draws the set\'s own path')

  /*
   * NOTHING, RATHER THAN AN EMPTY BOX. An icon whose name the set does not have
   * and an image with no source are the two cases where a decoration has been
   * created but not finished, and drawing a rectangle where they will go puts a
   * stray shape on a printed ticket.
   */
  eq(decorationSVG({ kind: 'icon', icon: { name: 'nosuch' } }, W, H, ctx), '',
    'an icon the set does not have draws nothing')
  eq(decorationSVG({ kind: 'image', image: { src: '' } }, W, H, ctx), '',
    'and an image with no picture draws nothing')
  eq(decorationSVG({ kind: 'rect', enabled: false }, W, H, ctx), '',
    'and one switched off draws nothing')
}

console.log('the effects are wrapped, not baked into the shape')
{
  const base = { kind: 'rect', box: at(0.1, 0.1, 0.3, 0.2) }
  ok(/<linearGradient /.test(decorationSVG({ ...base, fill: { type: 'gradient' } }, W, H)),
    'a gradient fill defines a gradient')
  ok(/url\(#/.test(decorationSVG({ ...base, fill: { type: 'gradient' } }, W, H)),
    'and points the fill at it')
  ok(/feDropShadow/.test(decorationSVG({ ...base, shadow: { blur: 0.01 } }, W, H)),
    'a shadow is a filter')
  ok(/mix-blend-mode:multiply/.test(decorationSVG({ ...base, blend: 'multiply' }, W, H)),
    'a blend is a style on the group')
  ok(/rotate\(15 /.test(decorationSVG({ ...base, rotation: 15 }, W, H)),
    'a rotation turns about the box\'s own centre')
  ok(/opacity="0.4"/.test(decorationSVG({ ...base, opacity: 0.4 }, W, H)),
    'and opacity is on the group, so it fades the shape and its outline together')

  /* An unrotated, fully opaque, unblended shape gets no wrapper at all —
     sixty of those on one ticket is sixty groups the renderer does not need. */
  const plain = decorationSVG(base, W, H)
  ok(!/^<g /.test(plain), 'a plain shape is not wrapped in a group it does not need')

  /* Two decorations must not share a gradient id, or the second silently takes
     the first one's colours. */
  const two = decorationLayerSVG([
    { id: 'a', kind: 'rect', fill: { type: 'gradient', colour: '#ff0000' } },
    { id: 'b', kind: 'rect', fill: { type: 'gradient', colour: '#00ff00' } },
  ], W, H)
  const ids = [...two.matchAll(/<linearGradient id="([^"]+)"/g)].map((m) => m[1])
  eq(ids.length, 2, 'two gradients are defined')
  eq(new Set(ids).size, 2, 'and they do not share an id, which would give both the same colours')
}

/*
 * WELL-FORMEDNESS, WHICH IS THE CHECK THIS FILE DID NOT HAVE AND SHOULD HAVE.
 *
 * Every assertion above looks for a SUBSTRING — `<rect `, `feDropShadow`, the
 * words somebody typed. All of them passed on output that no renderer would
 * draw: `font-family="Padauk, "Noto Sans Myanmar", …"` closed its own attribute
 * at the first inner quote and turned the rest of the element into rubbish. The
 * picture came out blank and the suite was green. It was found by LOOKING at a
 * card, which is the one thing a substring test cannot do for itself.
 *
 * So this walks the tags and refuses anything whose attributes do not close.
 * It is not a full parser and does not need to be — the failure it exists to
 * catch is a value that ends its own attribute, which is the only way a string
 * built by templates like these goes wrong.
 */
function illFormed(svg) {
  const bad = []
  for (const m of String(svg).matchAll(/<([a-zA-Z][\w:-]*)((?:[^<>"']|"[^"]*"|'[^']*')*)\/?>/g)) {
    /*
     * CONSUMED AS PAIRS, not scanned for stray quotes — which was the first
     * version of this and it passed the very string it exists to catch.
     * `font-family="a "b" c"` has an even number of quotes and survives any
     * check that only counts them; what gives it away is that once every
     * well-formed `name="value"` has been eaten, something is LEFT.
     */
    let rest = m[2]
    for (;;) {
      const before = rest
      rest = rest.replace(/^\s*[\w:.-]+\s*=\s*("[^"]*"|'[^']*')/, '')
      if (rest === before) break
    }
    /* The slash of a self-closing tag is not an attribute. */
    rest = rest.replace(/\/\s*$/, '')
    if (rest.trim() !== '') {
      bad.push(`<${m[1]}> has an attribute that does not close, at: ${rest.trim().slice(0, 60)}`)
    }
  }
  /* And a tag that never closed at all leaves a bare angle bracket behind. */
  const stray = String(svg).replace(/<[^<>]*>/g, '')
  if (/[<>]/.test(stray)) bad.push('a tag is left open')
  return bad
}

console.log('what it draws is well-formed, not merely the right substrings')
{
  /* The real stack, double quotes and all — which is what broke it. */
  const ctx = {
    icons: { trophy: 'M7 4h10v5a5 5 0 0 1-10 0Z' },
    textFamily: 'Padauk, "Noto Sans Myanmar", "Myanmar Text", system-ui, sans-serif',
    numberFamily: '"Times New Roman", "Liberation Serif", Times, serif',
  }
  for (const kind of KINDS) {
    const svg = decorationSVG({
      kind, box: at(0.1, 0.1, 0.3, 0.2),
      text: { value: 'Ma & Pa "quoted" <x>', family: kind === 'text' ? 'number' : 'text' },
      icon: { name: 'trophy' }, image: { src: 'https://example.org/a"b.png' },
      fill: { type: 'gradient' }, shadow: { blur: 0.01 }, rotation: 12, blend: 'multiply',
    }, W, H, ctx)
    const bad = illFormed(svg)
    ok(bad.length === 0, `${kind} draws well-formed SVG${bad.length ? ' — ' + bad[0] : ''}`)
  }
  /* And the scanner itself can fail, or it is worth nothing. */
  ok(illFormed('<text font-family="a "b" c">x</text>').length > 0,
    'and the check can tell a broken attribute from a good one')
  ok(illFormed('<rect x="1" y="2"/>').length === 0, 'while passing an ordinary tag')
}

console.log('text that could break the picture is escaped')
{
  const svg = decorationSVG(
    { kind: 'text', box: at(0, 0, 1, 0.1), text: { value: 'Ma & Pa <script>' } }, W, H)
  ok(/Ma &amp; Pa/.test(svg), 'an ampersand is escaped')
  ok(!/<script>/.test(svg), 'and a tag cannot be opened')
  ok(/&lt;script&gt;/.test(svg), 'it is drawn as the words somebody typed')
}

console.log('saving refuses, and says which one and why')
{
  eq(faultsIn(null).length, 0, 'nothing stored is not a fault')
  eq(faultsIn([]).length, 0, 'and neither is nothing drawn')
  ok(faultsIn('x').length === 1, 'a list that is not one is refused')

  const say = (list, opts) => faultsIn(list, opts).join(' | ')
  ok(/not one of/.test(say([{ id: 'a', kind: 'banana' }])), 'an unknown kind is named')
  ok(/repeats the id/.test(say([{ id: 'a' }, { id: 'a' }])), 'a repeated id is caught')
  ok(/has no id/.test(say([{ kind: 'rect' }])), 'and a missing one')
  ok(/off the artboard/.test(say([{ id: 'a', box: { left: 9 } }])), 'a box off the artboard')
  ok(/cannot contain/.test(say([{ id: 'a', kind: 'text', text: { value: 'a <b> c' } }])),
    'angle brackets, which end up inside an SVG')
  ok(/limit is 120/.test(say([{ id: 'a', kind: 'text', text: { value: 'x'.repeat(200) } }])),
    'and a value longer than a ticket holds')
  ok(/coordinates, not pictures/.test(say([{ id: 'a', kind: 'image', image: { src: 'file:///etc/passwd' } }])),
    'an image from somewhere this app will not fetch')
  /*
   * AND A data: URI IS REFUSED THOUGH IT WOULD RENDER PERFECTLY. It is the one
   * thing that can make a decoration unbounded in size, and a printed design is
   * stored whole in a column whose limit says "coordinates, not pictures". One
   * pasted photograph is larger than every measurement in the design together.
   */
  ok(/coordinates, not pictures/.test(say([{ id: 'a', kind: 'image', image: { src: 'data:image/png;base64,iVBOR' } }])),
    'and a picture pasted in as data, which would render and could not be saved')
  eq(faultsIn([{ id: 'a', kind: 'image', image: { src: 'https://x.test/a.png' } }]).length, 0,
    'while one already uploaded, referred to by address, is fine')
  ok(faultsIn(new Array(MAX_DECORATIONS + 5).fill(0).map((_, i) => ({ id: `d${i}` }))).some((f) => /limit is/.test(f)),
    'and more decorations than the limit')

  /*
   * ALL OF THEM, NOT THE FIRST. Somebody who has drawn twelve things wants to
   * be told about all three that are wrong rather than fixing one and pressing
   * Save again to discover the next.
   */
  const several = faultsIn([{ id: 'a', kind: 'banana' }, { id: 'a' }, { id: 'c', box: { left: 9 } }])
  ok(several.length >= 3, `every fault is reported, not just the first (${several.length})`)
}

console.log('nothing may sit on the check code')
{
  const code = at(0.7, 0.55, 0.2, 0.4)
  const over = (b) => faultsIn([{ id: 'a', kind: 'rect', box: b }], { codeBoxes: [code] })
    .some((f) => /check code/.test(f))

  ok(over(at(0.75, 0.6, 0.1, 0.1)), 'a mark inside it is refused')
  ok(over(at(0.6, 0.5, 0.3, 0.3)), 'and one that covers it')
  ok(over(at(0.65, 0.5, 0.1, 0.1)), 'and one that clips its corner')
  ok(over(at(0, 0.7, 1, 0.02)), 'and a rule drawn straight through it')

  ok(!over(at(0, 0, 0.5, 0.4)), 'a decoration well clear of it is fine')
  ok(!over(at(0.9, 0.55, 0.1, 0.4)), 'and one that stops exactly where the code starts')
  ok(!faultsIn([{ id: 'a', kind: 'rect', box: at(0.75, 0.6, 0.1, 0.1), enabled: false }], { codeBoxes: [code] })
    .some((f) => /check code/.test(f)), 'and one that is switched off is not on the ticket at all')

  /*
   * BOTH CODES, because a printed ticket carries one on the main half and one
   * on the stub. A rule that knew only about the first would protect half the
   * tickets while looking like it worked, which is worse than not having it.
   */
  const stubCode = at(0.05, 0.1, 0.1, 0.2)
  const twoCodes = { codeBoxes: [code, stubCode] }
  ok(faultsIn([{ id: 'a', kind: 'rect', box: at(0.06, 0.12, 0.05, 0.05) }], twoCodes)
    .some((f) => /check code/.test(f)), 'a mark on the stub\'s code is caught too')
  ok(faultsIn([{ id: 'a', kind: 'rect', box: at(0.75, 0.6, 0.05, 0.05) }], twoCodes)
    .some((f) => /check code/.test(f)), 'and one on the main half\'s')
  eq(faultsIn([{ id: 'a', kind: 'rect', box: at(0.3, 0.05, 0.2, 0.1) }], twoCodes).length, 0,
    'while the space between them is free')

  /* No code on the design means no rule to apply — a card treatment with its
     QR hidden must not refuse every decoration anybody draws. */
  eq(faultsIn([{ id: 'a', kind: 'rect', box: at(0.75, 0.6, 0.1, 0.1) }], {}).length, 0,
    'with no code box given, there is no rule to break')
}

console.log('what will not survive a press is reported, and only for paper')
{
  const risky = [
    { id: 'a', kind: 'rect', fill: { type: 'gradient' } },
    { id: 'b', kind: 'rect', shadow: { blur: 0.01 } },
    { id: 'c', kind: 'rect', blend: 'screen' },
    { id: 'd', kind: 'line', stroke: { width: 0.0002 } },
  ]
  const warned = printWarnings(risky, { printed: true })
  ok(warned.length >= 4, `every one of the four is reported (${warned.length})`)
  ok(warned.some((w) => /bands/.test(w)), 'a gradient bands')
  ok(warned.some((w) => /absorbent/.test(w)), 'a shadow fills in')
  ok(warned.some((w) => /multiply/.test(w)), 'and only multiply behaves on paper')
  ok(warned.some((w) => /hairline/.test(w)), 'and a hairline breaks up')

  /*
   * AND NONE OF IT ON THE CARD. The digital ticket is a picture on a lit
   * screen: it has no press, no stock and no grey. Warning about a gradient
   * there would be a screen crying wolf about the one place the effect is
   * exactly right, which is how people learn to ignore warnings.
   */
  eq(printWarnings(risky, { printed: false }).length, 0, 'the card is warned about none of it')
  eq(printWarnings(risky, {}).length, 0, 'and neither is anything that did not say it prints')
  eq(printWarnings([{ id: 'a', kind: 'rect' }], { printed: true }).length, 0,
    'an ordinary filled rectangle is warned about nothing')
}

console.log('a group is a shared name, and a mirror is about the shape\'s own centre')
{
  /*
   * STUDIO-ESSENTIALS Phase 2. A placed library shape is several parts under
   * one group, so a click on any part takes them all; a pasted group must get
   * a NEW group, or clicking the copy selects the original too. The model's
   * half is that a group survives normalising, and that a name the studio
   * could not have made is refused where it is saved.
   */
  const g = normalDecoration({ kind: 'rect', group: 'g1abc', box: at(0.1, 0.1, 0.2, 0.2) })
  eq(g.group, 'g1abc', 'a group name survives normalising')
  eq(normalDecoration({ kind: 'rect' }).group, '', 'and a shape with none is in no group')
  eq(normalDecoration({ kind: 'rect', group: 'a b<c>' }).group, 'abc', 'odd characters are dropped on the way in')
  eq(normalDecorations([{ kind: 'rect', group: 'gx' }, { kind: 'line', group: 'gx' }])
    .filter((d) => d.group === 'gx').length, 2, 'two parts keep one group through a whole list')
  ok(faultsIn([{ id: 'd1', kind: 'rect', group: 'x'.repeat(41) }]).some((f) => /group/.test(f)),
    'a forty-one character group is refused where it is saved')
  ok(faultsIn([{ id: 'd1', kind: 'rect', group: 'a b' }]).some((f) => /group/.test(f)),
    'and so is one the studio could not have made')
  ok(!faultsIn([{ id: 'd1', kind: 'rect', group: 'g12' }]).some((f) => /group/.test(f)),
    'while a real one is accepted')

  const base = { kind: 'rect', box: at(0.1, 0.1, 0.3, 0.2) }
  const flat = decorationSVG(base, W, H)
  const across = decorationSVG({ ...base, flipX: true }, W, H)
  const down = decorationSVG({ ...base, flipY: true }, W, H)
  ok(!/scale\(/.test(flat), 'an unmirrored shape carries no mirror')
  ok(/scale\(-1 1\)/.test(across), 'flipped across, it is mirrored left for right')
  ok(/scale\(1 -1\)/.test(down), 'flipped down, top for bottom')
  ok(/translate\(250\.00 80\.00\)/.test(across), 'about the centre of its own box (250, 80), not the corner of the ticket')
  const both = decorationSVG({ ...base, flipX: true, rotation: 30 }, W, H)
  ok(/rotate\(30\) scale\(-1 1\)/.test(both), 'turned and mirrored in one transform, mirror applied first')
  ok(/rotate\(15 250\.00 80\.00\)/.test(decorationSVG({ ...base, rotation: 15 }, W, H)),
    'and a shape that is only turned is drawn exactly as it was before mirrors existed')
}

console.log('a drawn shape can be called something, within reason')
{
  eq(normalDecoration({ kind: 'rect', name: '  Price tint  ' }).name, 'Price tint', 'a name is kept, trimmed')
  eq(normalDecoration({ kind: 'rect' }).name, '', 'and without one it is called by its kind on screen')
  eq(normalDecoration({ kind: 'rect', name: 'a<b>c' }).name, 'abc', 'angle brackets never reach the markup it is shown in')
  eq(normalDecoration({ kind: 'rect', name: 'x'.repeat(60) }).name.length, 40, 'forty characters at most')
  ok(faultsIn([{ id: 'd1', kind: 'rect', name: 'x'.repeat(41) }]).some((f) => /name/.test(f)), 'a longer one is refused on save')
  ok(faultsIn([{ id: 'd1', kind: 'rect', name: '<b>' }]).some((f) => /name/.test(f)), 'and so is markup')
  ok(!faultsIn([{ id: 'd1', kind: 'rect', name: 'Price tint' }]).some((f) => /name/.test(f)), 'while an ordinary one is fine')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
