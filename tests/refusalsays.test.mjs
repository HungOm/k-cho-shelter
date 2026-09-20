/*
 * What turning a request down actually does, said before it is pressed.
 *
 * WHY THIS IS NEEDED. The waiting-request card tells an approver what YES
 * does — "Granting hands the books over straight away" — and said nothing at
 * all about NO. A two-button decision that describes one button is half a
 * decision, and the missing half is the irreversible-feeling one: turning
 * down a volunteer who counted a book and sent the money in.
 *
 * AND THE HALF THAT IS EASY TO GET WRONG IS CUSTODY. Only an OFFER has books
 * reserved behind it, so only an offer releases anything when it is refused —
 * `decideApproval` calls `releaseOffered` inside `if (offer)` and nothing
 * else moves for any other kind. A card that told an organiser "the books go
 * back on the shelf" when they were never off it sends them to the Books
 * screen looking for stock that was always there, and teaches them the
 * screen's sentences are approximate. That is the failure these assertions
 * pin: the shelf claim belongs to exactly one kind of request.
 *
 * WHAT THIS CANNOT DO. It does not prove the server releases the books — that
 * is approvals.ts and the RLS suite. It proves the SCREEN's claim matches the
 * one case where the server does it, which is the half that drifts, because
 * the sentence and the release live in different files and different
 * languages.
 */
import { renderScreen, visibleText } from './screen.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const ADMIN = { email: 'org@x.com', role: 'admin', agentId: '', isSuperAdmin: false }

/* One pending row of whatever kind, and an organiser who may decide it. */
const STORE = (detail, user = ADMIN, youDecide = true) => `
import { reactive } from 'vue'
export const state = reactive({ user: ${JSON.stringify(user)}, cfg: { currency: 'RM' }, pendingApprovals: 1 })
export const api = async (action) => {
  if (action !== 'list_approvals') return {}
  return {
    youDecide: ${youDecide},
    requests: [{
      requestId: 'r1', status: 'Pending', action: 'issue_books',
      requestedBy: 'seller@x.com', requestedAt: '2026-09-20T10:00:00Z',
      summary: 'Give Book-002 to TEST',
      detail: ${JSON.stringify(detail)},
    }],
  }
}
export const toast = () => {}
export const go = () => {}
export const isAdmin = ${user.role === 'admin'}
`

const card = async (detail, user, youDecide) =>
  visibleText(await renderScreen('src/components/Approvals.vue', STORE(detail, user, youDecide),
    { drive: async (b) => { await b.load() } }))

/* The seller an offer is addressed to — only they may answer it. */
const SELLER = { email: 's@x.com', role: 'agent', agentId: 'A001', isSuperAdmin: false }

console.log('an approver is told what saying no does, not only what yes does')
{
  const text = await card({ runAs: 'approver', agentName: 'TEST' })
  ok(/Granting hands the books over/.test(text),
     `what yes does is still said (${text.slice(0, 60)})`)
  ok(/[Ss]aying no/.test(text),
     'and what no does is said beside it, on the same card, before either is pressed')
}

console.log('the shelf is only claimed where the server actually clears it')
{
  /*
   * An offer is the one kind with books reserved behind it, so it is the one
   * kind whose refusal frees them. Mutation-check: widen the offer condition
   * on that sentence to cover requests and this pair fails while every other
   * assertion in this file stays green.
   */
  const offer = await card({ kind: 'offer', agentId: 'A001', agentName: 'TEST', book: 'Book-002' },
                           SELLER, false)
  ok(/back on the shelf/.test(offer),
     `refusing an offer says the books go back (${offer.slice(-110)})`)

  const request = await card({ runAs: 'approver', agentName: 'TEST' })
  ok(!/back on the shelf/.test(request),
     'but a request nobody reserved anything for does not claim the shelf changes')

  const countIn = await card({ kind: 'count_in', agentId: 'A001', agentName: 'TEST', book: 'Book-002' },
                             SELLER, false)
  ok(!/back on the shelf/.test(countIn),
     'and a count-in leaves the book where it is, which is out with them')
}

console.log('every refusal says the reason reaches the person who sent it')
{
  /*
   * The server requires ten characters and shows them to the requester. The
   * screen asks for the words in its own box; what it never said on the card
   * is that they are delivered. Somebody who thinks a refusal note is filing
   * writes "no" — which the server then rejects, after the press.
   */
  const text = await card({ runAs: 'approver', agentName: 'TEST' })
  ok(/they (see|will see|read)|sees your|reaches them/i.test(text),
     `the card says the words are delivered (${text.slice(0, 70)})`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
