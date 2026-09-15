/*
 * The return-date reminder, which nobody can make go away.
 *
 * THE POINT IS THAT THERE IS NO DISMISSAL. An alert somebody can tick away is
 * an alert everybody ticks away, and by the one time it matters it has been
 * trained into furniture. The counts come from the books, so the banner clears
 * when the books come back and at no other moment. There is nothing to dismiss
 * because there is nothing storing a dismissal — and that is a property worth
 * asserting, because "just let them hide it for today" is a reasonable-sounding
 * request that would quietly undo the whole thing.
 *
 * AND IT HAS TO BE READABLE. Every sentence here carries a count, and this app
 * is bilingual everywhere else. A counted sentence assembled from fragments
 * cannot be translated — the number ends up stranded where English puts it, not
 * where Burmese does. So each is one template key with a {n}, and every key
 * reachable from the component is asserted to have Burmese. The i18n suite
 * scans STATIC labels and would not see these, which is exactly why they need
 * their own check.
 */
import { readFileSync } from 'node:fs'
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const { LINES } = await import('../src/lib/returnlines.js')
const { my, fill } = await import('../src/lib/i18n.js')
const raw = read('../src/components/ui/ReturnDue.vue')

/** Code only. The file's own comments explain WHY there is no dismissal, and a
 *  search for the word would otherwise match the explanation. */
const src = raw
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n')

console.log('nothing can dismiss it')
ok(!/dismiss|hide|snooze|localStorage|sessionStorage/i.test(src),
   'the component stores no dismissal of any kind')
ok(!/@click="[^"]*close|✕|&times;/.test(src), 'and draws no close button')
ok(/v-if="show"/.test(src) && /late > 0 \|\| r\.value\.dueSoon > 0/.test(src),
   'it is shown purely from the counts, so it clears when the books return')

console.log('every sentence it can produce has Burmese')
ok(Object.keys(LINES).length >= 12, `the sentences are enumerated (${Object.keys(LINES).length})`)
for (const [k, text] of Object.entries(LINES)) {
  ok(my(text) !== '', `${k} is translated: "${text}"`)
}

console.log('and a count lands inside the sentence, not beside it')
ok(fill('{n} books are late', { n: 3 }) === '3 books are late', 'English fills')
ok(/\{n\}/.test(my('{n} books are past their return date')) === false ||
   my('{n} books are past their return date', { n: 3 }).includes('3'),
   'Burmese fills the same placeholder')
for (const t of Object.values(LINES)) {
  if (!/\{n\}/.test(t)) continue
  ok(/\{n\}/.test(my(t)), `the Burmese for "${t}" keeps its {n} placeholder`)
}

console.log('one book does not read as "1 books"')
ok(!/\{n\}/.test(LINES.lateMineOne) && !/\{n\}/.test(LINES.lateAllOne),
   'the singular sentences carry no count at all')
ok(LINES.lateMineOne !== LINES.lateAllMany, 'a seller and an organiser get different words')
ok(/your/i.test(LINES.lateMineOne) && !/your/i.test(LINES.lateAllOne),
   'a seller is told about THEIR book; an organiser is not')

console.log('a seller is not given a number they cannot act on')
ok(/scope === 'mine'/.test(src), 'the scope comes from the server, not guessed from the role')
ok(/v-if="!mine"/.test(src), 'and only an organiser gets the button to go and chase them')

/*
 * The Home "needs looking at" list is the other one every role reads.
 *
 * It sat in assembled English until today — "3 books not returned", "2 tickets
 * with no phone number" — rendered as plain text on the one screen a seller
 * always opens. Same failure as the return banner and invisible the same way:
 * a key built at run time never reaches the i18n suite's scan of static labels.
 */
console.log('and every Home attention row has Burmese too')
{
  const { ATTN } = await import('../src/lib/attentionlines.js')
  const rows = Object.entries(ATTN)
  ok(rows.length >= 15, `the rows are enumerated (${rows.length})`)
  for (const [k, text] of rows) {
    ok(my(text) !== '', `${k} is translated: "${text}"`)
  }
  for (const [, text] of rows) {
    const holes = text.match(/\{\w+\}/g) || []
    for (const h of holes) {
      ok(my(text).includes(h), `the Burmese for "${text}" keeps ${h}`)
    }
  }
  // Singular rows must carry no count at all, or "1 books" comes back.
  for (const k of ['overdueOne', 'silentOne', 'contactOne', 'openOne']) {
    ok(!/\{n\}/.test(ATTN[k]), `${k} is a true singular, not a count of one`)
  }
  const store = readFileSync(new URL('../src/lib/store.js', import.meta.url), 'utf8')
  ok(!/title: `/.test(store.slice(store.indexOf('export const attention'),
                                  store.indexOf('export const gettingStarted'))),
     'no attention row assembles its title as a template string any more')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
