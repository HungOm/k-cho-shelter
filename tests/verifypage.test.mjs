/*
 * THE PUBLIC PAGE STAYS SEPARATE FROM THE APP.
 *
 * `v/index.html` is opened by a stranger who has scanned the QR on a raffle
 * ticket. There is no session, there cannot be one, and the person is standing
 * in a hall on whatever signal they have.
 *
 * THE FAILURE THIS GUARDS AGAINST IS A SINGLE IMPORT. One `import { state } from
 * '../lib/store.js'` — added for something perfectly reasonable, like reading
 * the raffle's name — drags in the Supabase client, the sign-in flow, the
 * twenty-thousand-ticket store and the IndexedDB cache. The page still works
 * on a developer's laptop. On a phone it becomes a 400 KB download to show four
 * lines of text, and it starts trying to establish a session that a stranger
 * has no way to provide.
 *
 * Nothing about that shows up in a screenshot, which is why it is a test.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const read = (f) => readFileSync(join(ROOT, f), 'utf8')

const files = readdirSync(join(ROOT, 'src/verify'))
  .filter((f) => /\.(js|css)$/.test(f))
  .map((f) => join('src/verify', f))

console.log('the page exists and is its own entry point')
{
  ok(files.length >= 2, `src/verify has ${files.length} files`)
  ok(statSync(join(ROOT, 'v/index.html')).isFile(), 'v/index.html is there')

  const vite = read('vite.config.js')
  ok(/input:\s*\{[\s\S]*main:\s*'index\.html'/.test(vite), 'the app is still an entry point')
  ok(/input:\s*\{[\s\S]*verify:\s*'v\/index\.html'/.test(vite), 'and the verify page is a second one')

  /*
   * A directory with an index.html, not `v.html`. GitHub Pages serves both, but
   * `vite preview` and most static hosts will not reliably answer `/v` for a
   * file called `v.html` — so this is the form that works on the machine of
   * whoever checks it before it goes out, as well as in production.
   */
  ok(/'v\/index\.html'/.test(vite), 'served as a directory, so /v/ works on any static host')
}

console.log('it imports nothing from the app')
{
  const BANNED = ['store.js', 'supabaseAuth', 'supabaseApi', 'backend.js', 'supabaseReads', 'cache.js', 'i18n.js']
  for (const f of files) {
    const src = read(f)
    const specifiers = [
      ...[...src.matchAll(/^\s*(?:import|export)\b[^;\n]*?\bfrom\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]),
      ...[...src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
    ]
    for (const spec of specifiers) {
      ok(!spec.startsWith('../lib/') && !spec.includes('/lib/'),
        `${f} does not reach into the app's lib (found ${spec})`)
      for (const banned of BANNED) {
        ok(!spec.includes(banned), `${f} does not import ${banned}`)
      }
    }
    ok(!/from ['"]vue['"]/.test(src), `${f} does not pull in Vue`)
    ok(!/@supabase/.test(src), `${f} does not create a Supabase client`)
  }
}

console.log('and asks nobody to sign in')
{
  const html = read('v/index.html')
  /*
   * index.html loads Google Identity Services because the app needs a session.
   * On this page that script would be asking a stranger to identify themselves
   * in order to look at a piece of paper they are already holding.
   */
  ok(!/accounts\.google\.com|gsi\/client/.test(html), 'no sign-in script')
  ok(!/client_id|g_id_onload/.test(html), 'and nothing that would ask for an account')
  ok(/noindex/.test(html), 'and it asks not to be indexed — these links are printed, not published')
  ok(/no-referrer/.test(html), 'and does not leak the scanned ticket to anything it loads')
  ok(/Padauk|Myanmar/.test(html), 'the Burmese font is loaded, because half the page is in Burmese')
}

console.log('it decides nothing for itself')
{
  /*
   * Whether a ticket is genuine is the server's answer. A page that worked it
   * out locally would be a page anybody could edit into saying yes — and the
   * whole point of the code is that it cannot be checked without the database.
   */
  const main = read('src/verify/main.js')
  ok(/fetch\(/.test(main), 'it asks the verify function')
  ok(/functions\/v1\/verify/.test(main), 'by name')
  ok(!/equalCodes|ticketcode/.test(main), 'and does not compare codes itself')
  ok(/body\.genuine/.test(main), 'it reports what the server said')

  /*
   * Three outcomes, and keeping them apart is the point. "Could not check"
   * must never render as "not a valid ticket": one is a network that failed and
   * the other is an accusation about somebody's ticket.
   */
  ok(/cannotCheck/.test(main), 'a failed check has its own answer')
  ok(/catch\s*\{[\s\S]{0,200}cannotCheck/.test(main),
    'and a network failure lands on it rather than on "not valid"')
}

console.log('both languages, always')
{
  const strings = read('src/verify/strings.js')
  const entries = [...strings.matchAll(/(\w+):\s*\{\s*en:/g)].map((m) => m[1])
  ok(entries.length >= 10, `the page has ${entries.length} strings`)
  // Every one carries Burmese. A missing gloss on this page is not a cosmetic
  // gap: the reader may not read English at all.
  const pairs = [...strings.matchAll(/en:\s*'(?:[^'\\]|\\.)*'\s*,\s*my:\s*'((?:[^'\\]|\\.)*)'/g)]
  eq(pairs.length, entries.length, 'every string has a Burmese line beside it')
  /*
   * The Myanmar Unicode block, the same check tests/i18n.test.mjs makes of the
   * app's own strings. A Latin value here is an untranslated line that looks
   * translated, which is worse than a missing one — it renders, in the wrong
   * language, under a heading that says it is the right one.
   */
  ok(pairs.every((m) => /[က-႟]/.test(m[1])), 'and every Burmese line is really Burmese')
  const main = read('src/verify/main.js')
  ok(/class="my"/.test(main) && /lang="my"/.test(main), 'and both are rendered, not chosen between')
}

/*
 * BURMESE FIRST, AND ONLY ONE PLACE DECIDES IT.
 *
 * The page leads with Burmese because nearly everybody who scans one of these
 * tickets reads it, and making them skip a line to reach their own language on
 * a verdict about their money is the wrong way round.
 *
 * The failure this guards is not the order itself — it is a page HALF inverted,
 * carrying two conventions at once, shipped because nothing noticed. The
 * existing checks assert that both languages render and that neither is chosen
 * between; none of them would see it. So this pins two things: that the order
 * is Burmese then English, and that exactly one function in the file emits a
 * language pair at all, which is what makes the order impossible to half-change.
 */
console.log('Burmese comes first, and one function decides it')
{
  const main = readFileSync(join(ROOT, 'src/verify/main.js'), 'utf8')
  const langs = [...main.matchAll(/class="(my|en)"/g)].map((m) => m[1])
  eq(langs.length, 2, 'a language pair is emitted in exactly one place')
  eq(langs[0], 'my', 'Burmese is written first')
  eq(langs[1], 'en', 'and English second')
  ok(/lang="my"/.test(main), 'the Burmese is marked as Burmese, for a screen reader')
}

/*
 * WHAT THE PAGE SAYS ABOUT ITSELF.
 *
 * Three things a stranger cannot work out from a verdict card, each of which
 * was missing until the page was redesigned around the question "what does
 * somebody standing in a hall actually need to be told".
 */
console.log('it says who is answering, what it will not show, and why it says so little')
{
  const main = readFileSync(join(ROOT, 'src/verify/main.js'), 'utf8')
  const strings = readFileSync(join(ROOT, 'src/verify/strings.js'), 'utf8')

  ok(/function topbar\(/.test(main), 'the page names what has been reached')
  ok(/render\(html\)\s*\{[\s\S]{0,140}topbar\(\)/.test(main),
    'and does it for every answer, not only the good one')

  /*
   * The privacy line is the page stating a promise the architecture already
   * keeps: verify/index.ts may touch two columns of tickets and one of
   * ticket_codes, and tests/verify.test.mjs fails if it ever mentions a buyer.
   * A stranger has no way to know that, and is entitled to be told.
   */
  ok(/privacyNote/.test(main) && /privacyNote/.test(strings), 'it says the buyer is never shown')

  /*
   * Every refusal carries the explanation. A number never issued, a ticket
   * never printed and a code out by one character all answer identically so
   * that the page cannot be used to map the raffle — which reads as ignorance
   * unless the page says it is a refusal.
   */
  const refusals = [...main.matchAll(/panel\('bad'/g)].length
  const explained = [...main.matchAll(/panel\('bad'[\s\S]{0,160}?\)\s*\+\s*whyOneAnswer\(\)/g)].length
  ok(refusals >= 3, `every way of failing is covered (${refusals} refusal paths)`)
  eq(explained, refusals, 'and every one of them explains why it says nothing more')

  /*
   * "Could not check" must NOT carry it. The explanation is about refusing to
   * leak which numbers exist; on a page that simply could not reach the server
   * it would be answering a question nobody asked, about a verdict that was
   * never given.
   */
  ok(!/cannotCheck'\)\s*\+\s*whyOneAnswer/.test(main),
    'but a failed check is not dressed up as a refusal')
}

/*
 * THE LINE THAT IS NOT THIS SESSION'S TO REWORD.
 *
 * `whatThisIs` was written for the charity whose tickets these are, and its
 * Burmese is reviewed by somebody who reads it. It is pinned here because the
 * risk is not deletion — that would be obvious — but a later redesign quietly
 * moving it inside panel(), where the states that most need it (a link that
 * could not be parsed, a check that could not be made) would silently lose it.
 */
console.log('what the raffle is for survives every answer')
{
  const main = readFileSync(join(ROOT, 'src/verify/main.js'), 'utf8')
  ok(/function about\(/.test(main), 'it has its own function')
  ok(/render\(html\)\s*\{[\s\S]{0,140}about\(\)/.test(main),
    'called from render, so no branch can forget it')
  ok(!/function panel\([\s\S]{0,400}whatThisIs/.test(main),
    'and never from panel, which only the answered states reach')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
