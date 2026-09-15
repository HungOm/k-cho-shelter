/*
 * A ticket sold out of a seller's own book names the SELLER, and says so.
 *
 * The rule the user set: a seller only has to hand back enough money. They know
 * who bought each ticket and may never pass the details on, so the contact of
 * record becomes theirs. settle_book writes the seller's name with " (seller)"
 * appended and the seller's phone.
 *
 * WHY THE MARKER EXISTS, since it would be tidier without one. Copying the bare
 * name would make the winners list say the seller bought their own ticket, and
 * would erase the difference between "the seller knows the buyer" and "the
 * seller bought it themselves" — both of which happen, and only one of which
 * means you have found your winner. One field carrying a marker is honest; two
 * fields that quietly disagree is the failure this repo produced four ways in a
 * day.
 *
 * So the screen must not undo that by printing "Bought by JOHN (seller)". The
 * label follows the fact instead.
 */
import { readFileSync } from 'node:fs'
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const { plainName, isSellerContact } = await import('../src/lib/format.js')

console.log('the marker is recognised exactly as the database writes it')
ok(isSellerContact('JOHN (seller)'), 'a settled ticket is a seller contact')
ok(plainName('JOHN (seller)') === 'JOHN', `and strips to the bare name (${plainName('JOHN (seller)')})`)
ok(isSellerContact('Ma Ma Aye (seller)'), 'names with spaces work')
ok(plainName('Ma Ma Aye (seller)') === 'Ma Ma Aye', 'and strip correctly')

console.log('a real buyer is left alone')
ok(!isSellerContact('Amos Hung'), 'an ordinary name is not a seller contact')
ok(plainName('Amos Hung') === 'Amos Hung', 'and is unchanged')
ok(plainName('') === '' && !isSellerContact(''), 'an empty name is neither')
ok(plainName(null) === '' && !isSellerContact(null), 'and neither is nothing at all')

console.log('and somebody whose real name contains the word is not mangled')
// Anchored at the end for this reason: the marker is a suffix, not a substring.
ok(!isSellerContact('The (seller) Shop Ltd'), 'not a seller contact when it is mid-name')
ok(plainName('A (seller) B') === 'A (seller) B', 'and nothing is stripped from the middle')
ok(isSellerContact('X (seller) (seller)'), 'a trailing marker still counts')
ok(plainName('X (seller) (seller)') === 'X (seller)', 'and exactly one is removed')

console.log('the ticket sheet does not claim the seller bought it')
{
  const st = read('../src/components/SellTicket.vue')
  ok(/isSellerContact\(t\.name\) \? 'Ask' : 'Bought by'/.test(st),
     'the label changes with the fact')
  ok(/plainName\(t\.name\)/.test(st), 'the name is shown without the marker')
  ok(/class="pill">seller</.test(st), 'and the marker is shown as a marker')
  ok(/ring them\s*\n?\s*to reach the buyer|ring them/.test(st),
     'and it says what to actually do about it')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
