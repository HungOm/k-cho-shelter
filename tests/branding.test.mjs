/*
 * The raffle's own colour and the raffle's own mark.
 *
 * ONE VALUE MOVES THE WHOLE INTERFACE, because every button, tab, link and
 * focus ring already reads var(--brand). What it cannot move is the text drawn
 * ON that colour, and that is the part worth testing: an organisation choosing
 * a colour is not choosing a contrast ratio, so --brand-ink is computed rather
 * than configured. White on a pale yellow brand is unreadable in sunlight,
 * which is where half of this app is used — outdoors, on a phone, by somebody
 * holding a book of tickets and somebody else's money. The primary button says
 * "Count a book in".
 *
 * The luminance is the sRGB one rather than (r+g+b)/3. The cheap version calls
 * pure blue bright and pure yellow dark — both backwards, and both entirely
 * plausible brand colours, so the shortcut fails exactly where a raffle is
 * likeliest to land.
 *
 * AND THE MARK. Logo.vue used to serve one organisation's PNG unconditionally.
 * It now takes the logo from config, and when none is set it draws Raffled's
 * own — in var(--brand), so a deployment that has picked a colour but not yet
 * uploaded a logo already looks like itself. The test that matters most here is
 * the negative one: no image filename may reappear in that file.
 */
import { readFileSync } from 'node:fs'
import { parseHex, luminance, inkFor, applyBrand } from '../src/lib/brand.js'

const logo = readFileSync(new URL('../src/components/ui/Logo.vue', import.meta.url), 'utf8')
let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

console.log('a colour is read, or rejected')
ok(String(parseHex('#0d7a6f')) === '13,122,111', 'six digits')
ok(String(parseHex('0d7a6f')) === '13,122,111', 'with or without the hash')
ok(String(parseHex('#abc')) === '170,187,204', 'and three digits expand')
for (const bad of ['', null, undefined, 'teal', '#12', '#1234567', 'rgb(1,2,3)', '#zzzzzz']) {
  ok(parseHex(bad) === null, `${JSON.stringify(bad)} is not a colour we act on`)
}

console.log('the ink is computed, and the cheap formula would get these wrong')
ok(inkFor('#0000ff') === '#ffffff', 'white on pure blue — dark, though r+g+b calls it middling')
ok(inkFor('#ffff00') === '#11181c', 'dark on pure yellow — bright, though r+g+b calls it middling')
ok(luminance([0, 0, 255]) < luminance([255, 255, 0]),
   'blue really is darker than yellow, which (r+g+b)/3 denies')
ok(inkFor('#000000') === '#ffffff' && inkFor('#ffffff') === '#11181c', 'and the two extremes')
ok(inkFor('#0d7a6f') === '#ffffff', 'the shipped brand keeps white text')
// The extremes agree under almost any threshold, so they do not pin one. These
// sit between 0.179 and the naive 0.5, which is where ordinary brand colours
// actually land — a mid blue, a mid red, a mid grey.
ok(inkFor('#808080') === '#11181c', 'a mid grey takes dark ink, not white')
ok(inkFor('#3aa0d0') === '#11181c', 'and so does a mid blue somebody might pick')
ok(inkFor('#7a1f1f') === '#ffffff', 'while a deep red still takes white')
ok(inkFor('nonsense') === null, 'an unreadable value yields no ink rather than a guess')

console.log('applying it, and taking it back off')
{
  const set = {}
  const root = {
    style: {
      setProperty: (k, v) => { set[k] = v },
      removeProperty: k => { delete set[k] }
    }
  }
  ok(applyBrand('#ffff00', root) === true, 'a good colour applies')
  ok(set['--brand'] === '#ffff00', 'the brand itself')
  ok(set['--brand-ink'] === '#11181c', 'with ink that can be read on it')
  ok(/color-mix/.test(set['--brand-soft']) && /var\(--bg\)/.test(set['--brand-soft']),
     'and a soft tint mixed against the page, so dark mode needs no second value')
  ok(applyBrand('0d7a6f', root) && set['--brand'] === '#0d7a6f', 'a missing hash is added')

  // A typo in a config cell must cost the custom colour, not the readability of
  // every button in the app.
  ok(applyBrand('teal', root) === false, 'a malformed value is refused')
  ok(!('--brand' in set) && !('--brand-ink' in set) && !('--brand-soft' in set),
     'and clears back to the stylesheet rather than leaving half a theme on')
  ok(applyBrand('#0d7a6f', null) === false, 'with no document there is nothing to do')
}

console.log('the mark, and what must not come back')
ok(/state\.cfg\?\.orgLogo/.test(logo), 'the logo comes from config')
// Comments stripped first: the file SHOULD say what it used to serve — that is
// how the next person learns why the fallback is absent — but the code must not
// be able to serve it. Testing the raw text would have forced a choice between
// an honest comment and a working assertion.
const code = logo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')
ok(!/ceam|\.png|\.jpg/i.test(code),
   'and no image filename appears in the CODE at all — the bug this replaced')
ok(/<svg/.test(logo) && /v-else/.test(logo), 'an unset logo draws the built-in mark')
// Counted, not matched. The mark has several fills and a stroke, and a regex
// that stops at the first one reports a half-hardcoded mark as fine — which is
// the third time today a pattern has been satisfied by its first hit.
ok((code.match(/var\(--brand(-ink)?\)/g) || []).length >= 5,
   'every part of the mark is drawn from the brand tokens')
ok(!/#[0-9a-f]{3,8}\b/i.test(code),
   'and not one literal colour survives in it — a mark that ignores the setting is worse than none')
ok(/aria-hidden="true"/.test(logo),
   'and announced to nobody: the product\'s mark must not read out where the organisation belongs')
ok(/:alt="label"/.test(logo) && /state\.cfg\?\.orgName/.test(logo),
   'an uploaded logo is labelled with whoever actually runs the raffle')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
