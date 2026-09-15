/*
 * An approval you can look into, and a link you can send.
 *
 * DECIDING WITHOUT LOOKING. An approval asks somebody to say yes to a sentence.
 * For anything larger than a name that is not enough: "mark 12 books as Lost"
 * is a different decision depending on whose books they are and what is still
 * inside them. With no way to look, the honest answer is always yes, and a
 * two-person control where the second person cannot check is one person with
 * an extra step.
 *
 * AND THE LAST STEP OF LETTING SOMEBODY IN. Approving grants the access. It
 * does not tell the new person where to go. Without the link, an owner approves,
 * nothing visible happens, and the person waiting still cannot find the site —
 * so the final step happens over the phone, badly, or not at all.
 *
 * The subject is read from the structured `detail` the server sends, never
 * parsed out of the summary. The summary is prose written for a person; turning
 * it back into facts is how the two come to disagree, which is the failure this
 * repo has produced four different ways today.
 */
import { readFileSync } from 'node:fs'
const src = readFileSync(new URL('../src/components/Approvals.vue', import.meta.url), 'utf8')

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

// Run the real function rather than reading it: a regex proves the words are
// there, calling it proves where a request actually points.
const body = src.slice(src.indexOf('function subjectOf'), src.indexOf('function lookAt'))
const subjectOf = new Function(`${body}; return subjectOf`)()

console.log('a request about access points at the access list')
for (const r of [
  { action: 'upsert_user', detail: { kind: 'upsert_user', email: 'a@b.c' } },
  { action: 'set_user_status', detail: {} },
]) {
  const s = subjectOf(r)
  ok(s && s.screen === 'admin', `${r.action} points at Setup, got ${s && s.screen}`)
}

console.log('a request about books points INTO the books it names')
{
  const one = subjectOf({ action: 'set_book_status',
    detail: { firstBook: 'Book-012', lastBook: 'Book-012' } })
  ok(one.screen === 'search', 'a single book opens the finder')
  ok(one.query === 'Book-012', `pre-filled with the book (${one.query})`)
  ok(!/–/.test(one.label), `one book is not shown as a range: "${one.label}"`)

  const many = subjectOf({ action: 'set_book_status',
    detail: { firstBook: 'Book-012', lastBook: 'Book-014' } })
  ok(many.query === 'Book-012', 'a range opens at its first book')
  ok(/Book-012.*Book-014/.test(many.label), `and names the range: "${many.label}"`)
}

console.log('and something with no subject offers no link')
ok(subjectOf({ action: 'read_version', detail: {} }) === null,
   'no button is drawn for a request that points nowhere')

console.log('the subject comes from detail, never from the prose')
ok(!/summary/.test(body),
   'subjectOf does not read the summary — that text is written for a person')

console.log('an approved sign-in hands over the link to send')
ok(/r\.status === 'Approved' && isSignIn\(r\)/.test(src),
   'the link shows only once the request is actually approved')
ok(/navigator\.clipboard\.writeText/.test(src), 'copying is offered')
ok(/catch \{[\s\S]*?toast\(signInLink/.test(src),
   'and a refused clipboard still shows the link rather than failing silently')
ok(/location\.origin \+ location\.pathname/.test(src),
   'the link is this deployment, not a hardcoded address')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
