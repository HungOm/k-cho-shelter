/*
 * A COMPONENT WITH AN UNRESOLVABLE IMPORT SAT IN THE TREE AND THE SUITE WAS
 * GREEN.
 *
 * `tests/screen.mjs` builds a screen by copying `src/` into a temp directory
 * and bundling from there. `src/lib/ranks.js` re-exports the supporter ladder
 * from `supabase/functions/_shared/ranks.ts` — one definition, read by the
 * server that works a band out and by the client that draws it, so the two
 * cannot drift. Copying only `src/` left that import dangling and esbuild
 * refused outright: "Could not resolve".
 *
 * Nothing caught it, and the reason is the point of this file. Screen coverage
 * here is A LIST, NOT A SWEEP: every render test names the component it
 * renders, and no test happened to name the one modal that imports the ladder.
 * So "the harness works" meant "for the screens something renders", and a trap
 * was set for whoever wrote the next ViewTicket test — they would have got a
 * resolution error about a file that plainly exists, with no reason to suspect
 * the copy.
 *
 * THE SAME FAMILY AS EVERYTHING ELSE THIS WEEK: a check that exists, runs,
 * passes, and answers about something nobody asked it to look at. Named by
 * kcho-shelter-72, who depends on that harness more than anyone.
 *
 * Two halves, and each catches what the other cannot:
 *
 *   THE STRUCTURAL HALF reads which directories the harness copies and asserts
 *   that every import leaving `src/` lands inside one of them. It cannot go
 *   stale against a new escaping import, because it enumerates them.
 *
 *   THE BEHAVIOURAL HALF actually builds the modal. That is the check that
 *   would have failed, and it fails for the real reason rather than for a
 *   proxy: if the copy list and the imports agree but the bundle still will not
 *   come out, this says so.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderScreen, visibleText } from './screen.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f)
  return statSync(p).isDirectory() ? walk(p) : [p]
})

console.log('the harness copies every directory a screen imports from')
{
  /*
   * READ OUT OF THE HARNESS, not written down twice. A list of directories
   * repeated here would agree with screen.mjs on the day it was typed and stop
   * agreeing the first time somebody added one — which is the same drift this
   * whole file is about, one level up.
   */
  const harness = readFileSync(join(ROOT, 'tests/screen.mjs'), 'utf8')
  const copied = [...harness.matchAll(/cpSync\(join\(ROOT,\s*'([^']+)'\)/g)].map((m) => m[1])
  ok(copied.length >= 1, `the harness copies ${copied.length} director${copied.length === 1 ? 'y' : 'ies'}`)
  ok(copied.includes('src'), 'src among them, which is the app itself')

  /*
   * Every relative import in the app, resolved against the file it is written
   * in. Bare specifiers ('vue', '@supabase/…') are somebody else's problem —
   * esbuild is told they are external.
   *
   * BOTH QUOTE STYLES. The first version of these patterns required single
   * quotes, and every relative import in this tree happens to use them — so it
   * worked, and a file written `from "./x"` would have been invisible rather
   * than reported. Unseen is the wrong failure for a guard: an eslint quote
   * rule or a formatter flips a whole tree at once, and the check would have
   * gone from missing one file to reporting nothing, silently, in one commit.
   */
  const files = walk(join(ROOT, 'src')).filter((f) => /\.(vue|js)$/.test(f))
  ok(files.length > 40, `${files.length} source files read`)

  const escaping = []
  /*
   * THE PARSE ITSELF IS GUARDED, and this line is the whole lesson of the file
   * applied one step earlier than I applied it.
   *
   * The two collections feeding this loop were checked — the copy list was
   * parsed, the walk found files — and the collection INSIDE it was not. Break
   * both patterns and `specs` is empty for every file: the per-import checks
   * never run, `escaping` stays empty, and that is indistinguishable from the
   * healthy state where nothing escapes. 311 assertions become 8 and the suite
   * stays green. kcho-shelter-72 reproduced it with those numbers in a scratch
   * copy before telling me, which is the only way that claim was worth making.
   *
   * Note what is asserted and what is only printed, because they are different
   * states. Zero ESCAPING imports is legitimate — somebody may correctly remove
   * the coupling — so that is printed. Zero relative imports INSPECTED across
   * forty-odd source files is not a state this app can be in; it means the
   * parse broke. Same shape as gate.test's `ok(ACTIONS.length > 60)`.
   */
  let seen = 0
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    const specs = [
      ...src.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g),
      ...src.matchAll(/\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g),
    ].map((m) => m[1])
    for (const spec of specs) {
      seen += 1
      const target = resolve(dirname(f), spec)
      const rel = relative(ROOT, target)
      /*
       * EXISTS FIRST. A specifier that points at nothing is a different fault
       * from one that points outside the copy, and reporting the second for the
       * first would send somebody to edit the harness over a typo.
       */
      ok(existsSync(target), `${relative(ROOT, f)} imports ${spec}, which exists`)
      if (rel.startsWith('src/')) continue
      escaping.push({ from: relative(ROOT, f), spec, rel })
      ok(copied.some((d) => rel === d || rel.startsWith(d + '/')),
        `${relative(ROOT, f)} imports ${spec}, which is outside src/ — `
        + `the harness must copy it, and copies ${copied.join(', ')}`)
    }
  }

  ok(seen > 100, `${seen} relative imports inspected`)

  /*
   * Said out loud rather than left implicit. If this ever reads zero the loop
   * above asserted nothing about the escape rule, and a reader deciding whether
   * this file still protects anything needs to see that rather than infer it
   * from a row of passes. Printed and not asserted, because zero escaping
   * imports is a legitimate state — unlike zero inspected, above.
   */
  console.log(`  (${escaping.length} import${escaping.length === 1 ? '' : 's'} leave src/: `
    + `${escaping.map((e) => `${e.from} → ${e.rel}`).join('; ') || 'none'})`)
}

console.log('and the modal that has one actually builds')
{
  /*
   * ViewTicket is the screen that carried the unresolvable import. Rendering it
   * is not a coverage gesture: a bundle failure THROWS out of renderScreen, so
   * this block fails loudly and for the right reason before a single assertion
   * about its markup is reached.
   *
   * The store stub is deliberately thin. What is being proved is that the thing
   * BUILDS and that the ladder it reaches across the tree for is live in the
   * bundle — not how the modal lays out, which is other tests' work.
   */
  const store = `
import { reactive, computed } from 'vue'
export const state = reactive({
  cfg: { orgName: 'CEAM Shelter', eventName: 'Fundraising Raffle', ticketPrice: '10.00',
         currency: 'RM', brandColor: '#0d7a6f', drawDate: '2026-12-31', ticketsPerBook: 10 },
  roomy: true,
  // Forty-one sold tickets to one telephone number: four whole books, which is
  // Gold. A count inside a band's middle would pass even if the ladder were
  // wired to the wrong function.
  tickets: Array.from({ length: 41 }, (_, i) => ({
    number: 'KS-' + String(31 + i).padStart(5, '0'), status: 'Sold',
    buyer: { name: 'John Kui', phone: '012345678' },
  })),
})
export const isAdmin = computed(() => true)
export const go = () => {}
export const goStudio = () => {}
export const toast = () => {}
export const api = async () => ({})
`
  /*
   * Sheet is rendered FOR REAL, and it has to be: everything this modal puts on
   * screen is inside its slots, and a stubbed child renders to nothing. A
   * stubbed Sheet gives an empty string, five assertions fail, and the report
   * reads exactly as it would if the modal were broken.
   *
   * The result is set on the setup context rather than awaited out of `api`,
   * because onMounted does not run under server rendering — the modal would be
   * drawn in its loading state and prove nothing about what it draws with data.
   */
  const html = await renderScreen('src/components/modals/ViewTicket.vue', store, {
    props: { payload: { book: 'Book-004' } },
    renderReal: ['Sheet.vue'],
    drive: async (b) => {
      b.result.value = {
        verifyBase: 'https://shrtickets.example.org/v',
        template: { id: 't1', url: '', width: 4000, height: 1294, name: 'CEAM' },
        notGenerated: [],
        tickets: [{
          number: 'KS-00031', book: 'Book-004', status: 'Sold', code: 'QEH21BBKGFJ6',
          generatedAt: '2026-09-14T00:00:00Z', printedAt: '2026-09-14T00:00:00Z',
          soldAt: '2026-09-14T00:00:00Z',
          buyer: { name: 'John Kui', phone: '012345678', address: 'Kajang', seller: 'KUI HTA' },
        }],
      }
      b.busy.value = false
    },
  })
  const text = visibleText(html)

  ok(text.includes('KS-00031'), 'the modal renders its ticket')
  /*
   * THE LADDER CAME ACROSS THE TREE AND RAN. Forty-one tickets at ten to a book
   * is four books, which is Gold — a band with a threshold on each side of it,
   * so a ladder wired to the wrong end would not land here by accident.
   */
  ok(/Gold supporter/.test(text), 'and the supporter band, read from _shared/ranks.ts')
  ok(/4 books/.test(text), 'counted in books, from this raffle\'s own book size')
  /*
   * And the action that makes the band checkable.
   *
   * IT WAS TWO BUTTONS AND IS NOW ONE. "Send on WhatsApp" sent a picture of
   * this ticket and "Send their receipt" sent a link covering everything the
   * buyer held — two artefacts for one person, which is what a digital ticket
   * being one-per-buyer exists to stop. The label carries the count because
   * that is what is about to be sent, and this fixture's buyer holds
   * forty-one, so a label that had quietly gone back to naming one ticket
   * would fail here rather than passing on the word alone.
   */
  ok(/Send their digital ticket/.test(text), 'and the buyer\'s digital ticket can be sent')
  ok(/41 tickets/.test(text), 'saying how many of them it covers')
  ok(/41 tickets/.test(text), 'covering every ticket that buyer holds')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
