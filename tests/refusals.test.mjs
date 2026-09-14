/**
 * Being refused is not the same as being broken.
 *
 * A seller signing in was met with "Some things could not be loaded — totals:
 * Your role (agent) cannot do this", in a warning box, above a Try again
 * button that could never succeed. Nothing was wrong: they are not supposed to
 * see the money totals. But the screen said the app was failing, and the only
 * thing a volunteer can do with that is go and ask an organiser about it.
 *
 * A panel you may not have should be absent, not reported as an error.
 */
const mem = new Map()
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k)
}

const { configure } = await import('../src/lib/api.js')
const { state, refresh } = await import('../src/lib/store.js')

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

configure({ apiUrl: 'https://example.test/exec', idToken: '' })

/** Whatever `replies` does not name comes back as a plain empty success. */
const DEFAULTS = {
  read_snapshot: { fields: ['Ticket_Number', 'Status'], rows: [], version: 1, total: 0, hasMore: false, returned: 0, serverTime: '2026-09-14T00:00:00Z' },
  list_agents: { agents: [] },
  list_books: { books: [], stats: {} },
  report_draw_ready: { totals: { collected: 0, expected: 0, outstanding: 0, ticketsSold: 0, ticketsAvailable: 0, missingContact: 0 }, booksByStatus: {} },
  report_overdue: { overdue: [] },
  list_approvals: { requests: [] }
}

let asked = []
function serve(replies) {
  asked = []
  globalThis.fetch = async (_url, opts) => {
    const { action } = JSON.parse(opts.body)
    asked.push(action)
    const fixed = replies[action]
    if (fixed && fixed.error) {
      return { text: async () => JSON.stringify({ ok: false, error: fixed.error }) }
    }
    return { text: async () => JSON.stringify({ ok: true, data: fixed || DEFAULTS[action] || {} }) }
  }
}
const refusal = (code, message) => ({ error: { code, message } })
const problemCodes = () => state.problems.map(p => p.code)

// ============ 1. a seller who may not see the totals ============
console.log('a seller is refused the totals')
state.tickets = []
state.user = { email: 'seller@x.com', role: 'agent', agentId: 'A001' }
state.cfg = { totalTickets: 100, ticketPrice: 10, currency: 'RM', ticketsPerBook: 10 }
serve({ report_draw_ready: refusal('INSUFFICIENT_ROLE', 'Your role (agent) cannot do this.') })
await refresh()

eq(state.problems.length, 0, 'nothing is reported as a problem')
eq(state.totals, 'null', 'and the totals stay empty, so the panel does not render')
ok(asked.includes('report_draw_ready'), 'the call was still made — only the server decides')
ok(!asked.includes('report_overdue'), 'and a seller is not asked for the overdue list at all')

// ============ 2. a super-admin-only action is equally quiet ============
console.log('a super-admin-only refusal is equally quiet')
state.tickets = []
serve({ report_draw_ready: refusal('SUPER_ADMIN_ONLY', 'That can only be done by the super admin.') })
await refresh()
eq(state.problems.length, 0, 'still nothing reported')

// ============ 3. a real failure is still reported ============
console.log('a real failure still shows')
state.tickets = []
serve({ list_books: refusal('NETWORK', 'Could not reach the server.') })
await refresh()
eq(state.problems.length, 1, 'the broken panel is reported')
eq(problemCodes()[0], 'NETWORK', 'with its code')
eq(state.problems[0].what, 'books', 'and which panel it was')

console.log('a server error is reported too')
state.tickets = []
serve({ list_agents: refusal('ERROR', 'Something went wrong.') })
await refresh()
eq(problemCodes().join(), 'ERROR', 'an unexpected code is not swallowed')

// ============ 4. a spreadsheet that was never set up ============
console.log('a missing spreadsheet still asks for setup')
state.tickets = []
serve({ list_books: refusal('SHEET_MISSING', 'Sheet "Books" not found. Run setup() first.') })
await refresh()
ok(state.needsSetup === true, 'needsSetup is raised')
ok(state.problems.length > 0, 'and it is a genuine problem, not a quiet skip')

// ============ 5. a refusal does not hide a real failure beside it ============
console.log('one refusal and one genuine failure together')
state.tickets = []
serve({
  report_draw_ready: refusal('INSUFFICIENT_ROLE', 'Your role (agent) cannot do this.'),
  list_books: refusal('NETWORK', 'Could not reach the server.')
})
await refresh()
eq(state.problems.length, 1, 'only the genuine one is listed')
eq(problemCodes()[0], 'NETWORK', 'and it is the right one')

// ============ 6. an organiser still gets everything ============
console.log('an admin is refused nothing')
state.tickets = []
state.user = { email: 'boss@x.com', role: 'admin', agentId: '' }
serve({})
await refresh()
eq(state.problems.length, 0, 'no problems')
ok(state.totals !== null, 'the totals arrive')
ok(asked.includes('report_overdue'), 'and the overdue list is asked for')

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
