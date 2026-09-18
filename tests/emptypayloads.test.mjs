/*
 * A field the server omits must not take the page down.
 *
 * This has now happened three times, from three different fields, and each time
 * the handler was healthy by every measure we had: it returned successfully,
 * passed its gate, appeared in both registries, and handed back something the
 * browser could not use. read_snapshot with no `fields`. list_permissions with
 * `overrides` where the screen reads `actions`. list_books with no `stats` —
 * which put undefined into state.bookStats, and the next render read
 * state.bookStats.Out and whited out the whole app on the Sellers screen.
 *
 * payloads.test.mjs covers the server half: it runs each handler and walks the
 * paths the browser walks. This is the client half, and it asks the opposite
 * question — not "does the server send it" but "what happens when it does not".
 * Both are needed: the server can only be right about the fields it knows the
 * client reads, and the client is the only place that knows what it reads.
 *
 * The standard being enforced: a missing count shows an empty grid, a missing
 * list shows an empty list, and the failure still reaches state.problems. It
 * degrades and it reports. What it must never do is leave a volunteer staring
 * at a blank page with nothing to describe.
 */
globalThis.localStorage = {
  _d: {}, getItem(k) { return this._d[k] ?? null },
  setItem(k, v) { this._d[k] = String(v) }, removeItem(k) { delete this._d[k] }
}

/*
 * DIRECT READS OFF, because these suites stub `fetch` and drive the store.
 *
 * backend.js sends row reads straight to PostgREST rather than through the Edge
 * Function — that shortcut is the whole performance difference and is on by
 * default. It goes through the Supabase client, not through `fetch`, so a
 * stubbed transport never sees the call and every read comes back NO_CONNECTION.
 *
 * Set before backend.js is imported: `directReads` is decided once, at module
 * load, from this key.
 */
globalThis.localStorage.setItem('kcho_direct_reads', 'off')
globalThis.indexedDB = undefined

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const FIELDS = ['Ticket_Number','Status','Book_Number','Buyer_Name','Buyer_Phone',
  'Buyer_Zone','Sold_By_Agent','Amount','Payment_Status','Sale_Date','Notes',
  'Source','Version','Recorded_By','Modified_Date']
const row = n => {
  const r = new Array(FIELDS.length).fill('')
  r[0] = 'KS-' + String(n).padStart(5, '0'); r[1] = 'Available'
  r[2] = 'Book-001'; r[12] = 1
  return r
}

/**
 * A server that answers every read with {} — successfully.
 *
 * Deliberately not an error and not a network failure: those paths are already
 * covered and already behave. This is the shape that keeps getting through —
 * ok:true, and nothing inside it.
 */
globalThis.fetch = async (url, o) => {
  const { action } = JSON.parse(o.body)
  const reply = d => ({ text: async () => JSON.stringify({ ok: true, data: d }),
                        json: async () => ({ ok: true, data: d }) })
  if (action === 'read_snapshot') {
    return reply({ fields: FIELDS, rows: [row(1), row(2)], offset: 0, returned: 2,
                   total: 2, hasMore: false, version: 1, serverTime: '2026-01-01T00:00:00Z' })
  }
  return reply({})          // every other read: successful, and empty
}

const store = await import('../src/lib/store.js')
const { configure } = await import('../src/lib/supabaseApi.js')
configure({ apiUrl: 'https://example.test/exec', idToken: 'x.y.z' })

// Admin from the start: report_overdue is only requested for an admin or a
// recorder, so a test that signs in afterwards never reaches its assignment.
store.state.user = { name: 'T', role: 'admin', isAdmin: true }

console.log('refresh survives a server that omits every field')
let threw = null
try { await store.refresh() } catch (err) { threw = err }
ok(threw === null, `refresh did not throw (${threw && threw.message})`)

console.log('and the store keeps a usable shape rather than undefined')
const { state } = store
ok(state.bookStats && typeof state.bookStats === 'object',
   `bookStats stayed an object, got ${state.bookStats}`)
ok(Array.isArray(state.agents), `agents stayed an array, got ${state.agents}`)
ok(Array.isArray(state.books), `books stayed an array, got ${state.books}`)
ok(Array.isArray(state.overdue), `overdue stayed an array, got ${state.overdue}`)

console.log('so the screens that read them still render')
// attention() is where the white screen happened: state.bookStats.Out and
// state.overdue.length, two lines apart.
let crash = null
try {
  const items = store.attention.value
  ok(Array.isArray(items), 'the home screen attention list built')
} catch (err) { crash = err; ok(false, `attention threw: ${err.message}`) }

/*
 * A REFUSAL YOU HAVE NOT ANSWERED IS TOLD TO YOU, rather than left in an
 * archive nobody opens. A seller disputing a count-in means the figures are
 * wrong now and stay wrong until somebody reads their words and asks again, so
 * it goes ABOVE overdue books: an overdue book is drifting, a refusal has
 * already gone wrong and is sitting still.
 *
 * The server counts only refusals the asker has not followed up, so the row
 * clears by being ACTED ON — this app's rule is that an alert you can tick away
 * is one everybody ticks away.
 */
{
  const was = store.state.refusedApprovals
  store.state.refusedApprovals = 0
  ok(!store.attention.value.some((i) => i.key === 'refused'),
     'nothing is said when nothing of yours was turned down')

  store.state.refusedApprovals = 2
  const rows = store.attention.value
  const row = rows.find((i) => i.key === 'refused')
  ok(!!row, 'a refusal you have not answered is on the list')
  ok(row && /\{n\}|turned down/i.test(row.title?.text || ''), 'and says what happened')
  ok(row && row.title?.vars?.n === 2, 'counting them, through a template the other language can place')
  ok(row && row.go === 'approvals', 'and sends you where the words are')
  ok(rows.indexOf(row) === 0, 'first, above books that are merely drifting')

  store.state.refusedApprovals = was
}

// As an ADMIN specifically: gettingStarted returns null for everyone else, so
// a non-admin never reaches the state.bookStats.Out on its third step — which
// is the same dereference that whited out the Sellers screen.
try {
  const steps = store.gettingStarted.value
  ok(Array.isArray(steps), `the admin getting-started checklist built, got ${steps}`)
  ok(steps.some(x => x.title === 'Give out books'),
     'including the step that reads bookStats.Out')
} catch (err) { ok(false, `gettingStarted threw: ${err.message}`) }

/*
 * "FOUR THINGS, ONCE" HAS TO MEAN ONCE.
 *
 * The third step asked whether any book is Out RIGHT NOW, so a raffle well past
 * setting up — money collected, tickets sold — had the entire first-run card
 * come back the moment every book happened to be sitting at the desk. Reported
 * from a live screen reading RM190 collected and 19 of 10,000 sold, with
 * "Let's get started. Four things, once." above it.
 *
 * Books that have been out do not go back to Unassigned by themselves, so the
 * honest question is whether this raffle has EVER handed one over.
 */
{
  const setStats = (stats) => { store.state.bookStats = stats }
  const stepDone = (title) => (store.gettingStarted.value || []).find(x => x.title === title)?.done

  setStats({ Unassigned: 2000 })
  ok(stepDone('Give out books') === false,
     'a raffle that has never issued a book still has that step to do')

  setStats({ Unassigned: 1998, Out: 2 })
  ok(stepDone('Give out books') === true, 'books out counts as done')

  // THE CASE THAT FAILED: everything handed back in. Nothing is Out, and the
  // old test flipped the step — and the whole card — back to not-done.
  setStats({ Unassigned: 1998, Returned: 2 })
  ok(stepDone('Give out books') === true,
     'and so does a book that went out and came back — the card does not return')

  setStats({ Unassigned: 1999, Settled: 1 })
  ok(stepDone('Give out books') === true, 'and one that was counted in')
}

try {
  ok(store.overview.value === null || typeof store.overview.value === 'object',
     'overview returned null rather than throwing')
} catch (err) { ok(false, `overview threw: ${err.message}`) }

try {
  ok(typeof store.agentMap.value === 'object', 'agentMap built from an empty list')
} catch (err) { ok(false, `agentMap threw: ${err.message}`) }

console.log('and the tickets that DID arrive are still there')
ok(state.tickets.length === 2, `the snapshot survived the empty reports (${state.tickets.length})`)
ok(!!state.byNumber['KS-00001'], 'and is still indexed')

console.log('degrading is not hiding — the trouble is still reported')
ok(Array.isArray(state.problems), 'problems is a list')

console.log('the list_books guard holds even when the report that masks it fails')
{
  // bookStats is set from list_books and then again from report_draw_ready.
  // The second assignment repairs the first, so a missing `stats` is invisible
  // until that report fails — and then the grid loses its counts for a reason
  // nobody connects back to list_books. That is the case under test.
  globalThis.fetch = async (url, o) => {
    const { action } = JSON.parse(o.body)
    const body = action === 'report_draw_ready'
      ? { ok: false, error: { code: 'QUERY_FAILED', message: 'the report is down' } }
      : { ok: true, data: {} }
    return { text: async () => JSON.stringify(body), json: async () => body }
  }
  state.bookStats = { sentinel: 1 }
  let boom = null
  try { await store.refresh() } catch (err) { boom = err }
  ok(boom === null, `refresh survived the failing report (${boom && boom.message})`)
  ok(state.bookStats && typeof state.bookStats === 'object' && !state.bookStats.sentinel,
     `bookStats came from list_books and stayed an object, got ${JSON.stringify(state.bookStats)}`)
  let crashed = null
  try { store.attention.value; store.gettingStarted.value } catch (err) { crashed = err }
  ok(crashed === null, `the screens still built (${crashed && crashed.message})`)
  ok(state.problems.some(p => p.code === 'QUERY_FAILED'), 'and the failure was reported, not hidden')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
