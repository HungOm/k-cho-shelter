/*
 * The counting-in screen has to describe the room it is actually in.
 *
 * Two different moments reach it. An `Out` book is still with the seller, who
 * is standing there with the unsold tickets. A `Returned` book was handed back
 * days ago — the tickets are in the office and the seller has gone home. The
 * screen was written for the first and shown for both, so an organiser counting
 * yesterday's returns was told "the seller is holding the tickets that did not
 * sell" about somebody who was not in the building.
 *
 * Nothing broke. The numbers were right and the settlement was correct. It just
 * told a volunteer to go and find a person who was not there, which is the kind
 * of wrong that never shows up in a stack trace.
 *
 * What is pinned here is the invariant rather than the wording: every status
 * that can reach this screen has to be a status the screen speaks to. A third
 * one added to canSettle without a word written for it fails here.
 */
import { readFileSync } from 'node:fs'
const ROOT = new URL('..', import.meta.url).pathname
const read = p => readFileSync(ROOT + p, 'utf8')

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

const detail = read('src/components/modals/SettleBook.vue')
const opener = read('src/components/modals/BookDetail.vue')

console.log('the screen knows which statuses can reach it')
{
  // Read from the component rather than retyped, so widening canSettle without
  // writing the words for it is caught here instead of by a volunteer.
  const m = opener.match(/canSettle\s*=\s*computed\(\(\)\s*=>\s*\[([^\]]*)\]/)
  ok(m, 'BookDetail declares which statuses may be counted in')
  const settleable = (m?.[1] ?? '').match(/'([^']+)'/g)?.map(s => s.slice(1, -1)) ?? []
  eq(settleable.sort().join(','), 'Out,Returned', 'the two statuses that can be settled')

  // Each needs a branch. 'Out' is the default case and is named in prose rather
  // than in code, so the check is that the component distinguishes the other.
  ok(/const handedBack\s*=\s*computed\(\(\)\s*=>\s*props\.book\.status\s*===\s*'Returned'\)/.test(detail),
    'the screen separates a handed-back book from one still out')
}

console.log('and says something true in each')
{
  const seller = detail.indexOf('The seller is holding the tickets')
  const office = detail.indexOf('These tickets are back in the office')
  ok(office !== -1, 'a handed-back book is described as being in the office')
  ok(seller !== -1, 'a book still out is described as being with the seller')

  // The office line must be the one guarded by handedBack, and the seller line
  // its alternative — reversed, it is wrong in both directions at once.
  const note = detail.slice(detail.indexOf('<div class="note info">'), detail.indexOf('</div>', office))
  ok(note.indexOf('v-if="handedBack"') !== -1 && note.indexOf('v-if="handedBack"') < note.indexOf('v-else'),
    'the office wording is the one conditioned on handedBack')
  ok(note.indexOf('These tickets are back in the office') < note.indexOf('The seller is holding'),
    'and the seller wording is the fallback, not the other way round')

  // "They lost them" is about a person who still had them. Once a book is back,
  // the leftovers are missing from a box in the office and nobody lost anything.
  ok(/v-if="handedBack">The leftover tickets did not come back/.test(detail),
    'a handed-back book does not accuse the seller of losing them')
  ok(/v-else>They lost the leftover tickets/.test(detail),
    'a book still out still says they lost them')
}

console.log('and the server agrees a returned book can still be settled')
{
  /*
   * THE CLIENT SENTENCE ABOVE IS ONLY TRUE IF THE SERVER ALLOWS IT. The dialog
   * offers a "handed back" branch that speaks to a book already returned; if
   * settling were restricted to Out, that whole branch would be unreachable and
   * the wording would be promising something the server refuses.
   *
   * This was asserted against `handleSettleBook` in Books.gs. The rule now lives
   * in SQL — `settleBook` in books.ts is a thin wrapper over the `settle_book`
   * function — so the claim is checked where the decision is actually made.
   */
  const sql = read('supabase/functions.sql')
  /*
   * CUT AT THE FUNCTION'S OWN END, not at the end of the file.
   *
   * This looked for '\n$$;' — a terminator functions.sql does not use, it ends
   * every function with `end $$ language plpgsql;` — so the fallback took
   * everything from settle_book to EOF. That was harmless only while settle_book
   * happened to be the last thing in the file. The moment another function was
   * appended, its status tests were read as settle_book's and the assertion
   * below reported a gate this function does not have.
   *
   * A slice that silently runs to EOF is the same class of bug as a regex that
   * matches more than it means: it passes for years and then reports on code it
   * was never pointed at.
   */
  const fn = sql.slice(sql.indexOf('create or replace function settle_book'))
  const stop = fn.indexOf('end $$ language plpgsql;')
  ok(stop > 0, 'the settle_book body has a terminator to cut at')
  const body = fn.slice(0, stop + 'end $$ language plpgsql;'.length)
  ok(body.length > 200, `found the settle_book body (${body.length} chars)`)

  // Stated as the positive: the ONLY status it refuses on is one already
  // settled. Written this way round because "not restricted to Out" is an
  // everything-except-X claim, and those have gone wrong here before —
  // supabase/AUDIT.md §X.
  const refusals = [...body.matchAll(/b\.status\s*(?:=|<>|!=)\s*'(\w+)'/g)].map((m) => m[1])
  ok(refusals.length > 0, `the function does test the status (${refusals.join(', ') || 'none'})`)
  ok(refusals.every((st) => st === 'Settled'),
     `settling is gated on 'Settled' alone, so a Returned book can still be counted in ` +
     `(found: ${[...new Set(refusals)].join(', ')})`)
}

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
