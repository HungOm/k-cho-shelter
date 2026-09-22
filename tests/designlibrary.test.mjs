/*
 * THE LIBRARY — the only part of the studio that outlives one design.
 *
 * The whole thing turns on ONE decision, and it is the one this file exists to
 * pin: a saved shape holds its parts as shares of ITS OWN BOUNDS, not of the
 * artboard. Get that wrong and a saved badge is only reusable at the exact size
 * and position it was saved from, which is the same as not saving it — and the
 * bug is invisible in any test that places a shape back at the size it came
 * from. So every round-trip here changes the size.
 */
import {
  MAX_PARTS, MAX_SHAPES, MAX_COLOURS, BUILT_IN,
  normalLibrary, shapeFrom, placeShape, libraryFaults,
} from '../supabase/functions/_shared/designlibrary.js'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => {
  String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`))
}
const near = (g, w, what) => ok(Math.abs(g - w) < 1e-6, `${what}: got ${g}, want ${w}`)
const at = (left, top, width, height) => ({ left, top, width, height })

console.log('reading never throws, whatever it is handed')
{
  for (const raw of [undefined, null, 0, '', 'nonsense', '{"shapes":5}', [], { shapes: 'x' },
    { colours: [{ value: 'banana' }] }, { styles: [null] }]) {
    let lib
    try { lib = normalLibrary(raw) } catch (e) {
      fail++; console.log(`  FAIL threw on ${JSON.stringify(raw)}: ${e.message}`); continue
    }
    ok(Array.isArray(lib.shapes) && Array.isArray(lib.colours) && Array.isArray(lib.styles),
      'three lists come back')
  }
  const lib = normalLibrary({ colours: [{ name: 'Press green', value: 'not a colour' }] })
  eq(lib.colours[0].value, '#000000', 'a colour it cannot draw becomes one it can')
  eq(lib.colours[0].name, 'Press green', 'and the name survives')
  eq(normalLibrary('{"shapes":[{"name":"x","parts":[{"kind":"rect"}]}]}').shapes.length, 1,
    'a library stored as text is parsed')
}

console.log('a saved shape holds its parts relative to ITSELF')
{
  /*
   * THE CASE THAT SEPARATES THE TWO IMPLEMENTATIONS. Two decorations sitting
   * in the middle of the artboard: a panel, and a rule a quarter of the way
   * down it. Saved and placed back SOMEWHERE ELSE, AT A DIFFERENT SIZE.
   *
   * If the boxes were stored as artboard shares, the parts would come back
   * where they were first drawn and the placement box would be ignored — which
   * a test that placed it back at the original size could never tell apart.
   */
  const drawn = [
    { id: 'a', kind: 'rect', box: at(0.40, 0.20, 0.20, 0.40) },
    { id: 'b', kind: 'line', box: at(0.40, 0.30, 0.20, 0) },
  ]
  const saved = shapeFrom(drawn, 'Badge')
  eq(saved.name, 'Badge', 'it keeps the name it was given')
  eq(saved.parts.length, 2, 'and both pieces')
  near(saved.parts[0].box.left, 0, 'the outermost piece starts at its own origin')
  near(saved.parts[0].box.width, 1, 'and fills its own bounds')
  near(saved.parts[1].box.top, 0.25, 'the rule sits a quarter of the way down the GROUP')

  const placed = placeShape(saved, at(0.05, 0.60, 0.40, 0.10), (() => {
    let n = 0; return () => `p${n++}`
  })())
  eq(placed.length, 2, 'both pieces come back')
  near(placed[0].box.left, 0.05, 'the group lands where it was put')
  near(placed[0].box.top, 0.60, 'on both axes')
  near(placed[0].box.width, 0.40, 'at the size it was given, not the size it was saved at')
  near(placed[1].box.top, 0.625, 'and the rule is still a quarter of the way down')
  near(placed[1].box.width, 0.40, 'scaled with it')

  /* Placed twice, two things somebody can move apart. */
  const again = placeShape(saved, at(0.5, 0.1, 0.2, 0.2))
  ok(again[0].id !== placed[0].id, 'a second placement is not the same object')
}

console.log('one piece and six behave the same way')
{
  const one = shapeFrom([{ id: 'x', kind: 'rect', box: at(0.3, 0.3, 0.1, 0.05) }], 'Block')
  near(one.parts[0].box.left, 0, 'a single piece becomes its own full bleed')
  near(one.parts[0].box.width, 1, 'on both axes')
  const back = placeShape(one, at(0.1, 0.1, 0.5, 0.25))
  near(back[0].box.left, 0.1, 'and places exactly into the box it is given')
  near(back[0].box.width, 0.5, 'at that width')

  /*
   * A GROUP WITH NO EXTENT IN ONE AXIS — three flat rules stacked at the same
   * height — would divide by zero. It keeps that axis whole instead, so it
   * places back as the same flat run at whatever width it is dropped.
   */
  const flat = shapeFrom([
    { id: 'a', kind: 'line', box: at(0.1, 0.5, 0.3, 0) },
    { id: 'b', kind: 'line', box: at(0.5, 0.5, 0.3, 0) },
  ], 'Two rules')
  ok(flat && flat.parts.length === 2, 'a group with no height still saves')
  const flatBack = placeShape(flat, at(0, 0.2, 1, 0.1))
  ok(Number.isFinite(flatBack[0].box.top) && Number.isFinite(flatBack[1].box.left),
    'and places back without dividing by zero')
}

console.log('a shape is a motif, not a design')
{
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `d${i}`, kind: 'rect', box: at(0, 0, 0.1, 0.1) }))
  eq(shapeFrom(many, 'Too much').parts.length, MAX_PARTS,
    `a saved shape is cut to ${MAX_PARTS} pieces`)
  eq(shapeFrom([], 'Nothing'), null, 'and nothing saved is nothing, not an empty shape')
  eq(normalLibrary({ shapes: Array.from({ length: 99 }, () => ({ name: 'x', parts: [{ kind: 'rect' }] })) }).shapes.length,
    MAX_SHAPES, `and the library holds ${MAX_SHAPES} of them`)
}

console.log('saving refuses, and says which one and why')
{
  const say = (o) => libraryFaults(o).join(' | ')
  eq(libraryFaults(null).length, 0, 'nothing stored is not a fault')
  eq(libraryFaults('').length, 0, 'and neither is a blank row')
  ok(libraryFaults('{oops').length === 1, 'text that is not a library is refused')
  ok(/has to be an object/.test(say([])), 'and a list is not a library')

  ok(/has no name/.test(say({ shapes: [{ id: 's1', parts: [{ kind: 'rect' }] }] })),
    'an unnamed shape is refused — the panel is a list somebody reads later')
  ok(/has nothing in it/.test(say({ shapes: [{ id: 's1', name: 'Empty' }] })),
    'and one with no pieces')
  ok(/repeats the id/.test(say({ colours: [{ id: 'c', name: 'A', value: '#ffffff' }, { id: 'c', name: 'B', value: '#000000' }] })),
    'a repeated id is caught')
  ok(/not a colour this app can draw/.test(say({ colours: [{ id: 'c', name: 'Ink', value: 'greenish' }] })),
    'and a colour it cannot draw')
  ok(libraryFaults({ colours: Array.from({ length: 99 }, (_, i) => ({ id: `c${i}`, name: 'x', value: '#000000' })) })
    .some((f) => /limit is/.test(f)), `and more than ${MAX_COLOURS} colours`)

  /* All of them, not the first — see designelements for the same reasoning. */
  ok(libraryFaults({ shapes: [{ id: 'a', parts: [{ kind: 'rect' }] }, { id: 'a', name: 'B' }] }).length >= 3,
    'every fault is reported')

  eq(libraryFaults({
    shapes: [{ id: 's', name: 'Badge', parts: [{ kind: 'rect' }] }],
    colours: [{ id: 'c', name: 'Press green', value: '#0d7a6f' }],
    styles: [{ id: 't', name: 'Heading', family: 'number', weight: 'bold' }],
  }).length, 0, 'while a library that is fine passes')
}

console.log('four things ship, so the panel is not empty on the first day')
{
  ok(BUILT_IN.length >= 4, `there are ${BUILT_IN.length} built-in shapes`)
  ok(BUILT_IN.every((s) => s.name && s.parts.length), 'each is named and has pieces')
  ok(BUILT_IN.every((s) => s.parts.length <= MAX_PARTS), 'and none exceeds what a shape may hold')
  eq(new Set(BUILT_IN.map((s) => s.id)).size, BUILT_IN.length, 'with no repeated id')
  /*
   * AND EVERY ONE OF THEM PLACES. A built-in that produced nothing would be a
   * panel entry that looks like a broken tool the first time anybody presses
   * it — which is the worst possible first impression of a library.
   */
  for (const s of BUILT_IN) {
    const out = placeShape(s, at(0.1, 0.1, 0.3, 0.2))
    eq(out.length, s.parts.length, `${s.name} places every piece`)
    ok(out.every((d) => Number.isFinite(d.box.left) && d.box.width > 0 || d.kind === 'line'),
      `${s.name} places somewhere real`)
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
