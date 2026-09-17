<script setup>
/**
 * Money. One number matters most — what each seller still owes — so it is the
 * last column and the only one in colour.
 */
import { ref, onMounted, computed } from 'vue'
import { state, api, toast, canWrite, isSold } from '../lib/store.js'
import { money, moneyShort, date, COUNTED_IN_HELP } from '../lib/format.js'
import { waNumber, isDialable } from '../lib/search.js'
import Empty from './ui/Empty.vue'
import History from './modals/History.vue'

const rows = ref(null)
const scope = ref('all')
const currency = computed(() => state.cfg?.currency || '')
const o = computed(() => state.totals)

/*
 * WHO SEES WHOSE, decided by the server and merely rendered here.
 *
 *   all       an organiser: every seller
 *   mine      a seller, or a helper who also carries books: their own line
 *   totals    a viewer: the raffle's figures, nobody's name
 *   recorded  a helper carrying nothing: the sales THEY wrote down
 *
 * 'totals' used to cover the last two, and they want opposite screens. A viewer
 * is here to check that the raffle's money is healthy, so they need the figures
 * and none of the names. A helper is not carrying any of it, so the figures are
 * not theirs to read at all — but the afternoon they spent writing sales down
 * is, and that is the one thing the old screen could not show them.
 *
 * The screen never filters the SELLER table — it would be a second opinion
 * about a question the report has already answered, and the two would disagree
 * the first time one of them changed. What it does assemble locally is the
 * helper's own record, which is not a narrowing of that table: it is the
 * tickets already on this device carrying their name, and no money at all.
 */
const emit = defineEmits(['record-payment'])

/**
 * Anybody who can take cash can write it down. A viewer cannot, and the server
 * refuses it regardless of what this draws — the button is hidden as a courtesy,
 * not as the control.
 */
const canRecord = canWrite

onMounted(load)
async function load() {
  try {
    const r = await api('report_outstanding', {})
    rows.value = r.agents || []
    scope.value = r.scope || 'all'
  } catch (err) {
    toast(err.message, 'bad', err.code)
    rows.value = []
  }
}

/** Which tickets make up the debt — who bought them, and what came in. */
const open = ref('')
function toggle(id) {
  open.value = open.value === id ? '' : id
  audit.value = ''
  if (open.value) loadStatement(id)
}

/*
 * A CAP, because a seller with sixty books has six hundred tickets.
 *
 * This list is read to settle an argument about a particular ticket, not to be
 * scrolled end to end, and rendering every row of a raffle this size is how the
 * screen locks up on the phone of the person trying to use it. The count is
 * always stated, so a cap never reads as "that is all of them".
 */
const CAP = 50
/**
 * ONE SELLER'S STATEMENT, FETCHED WHEN SOMEBODY ASKS FOR IT.
 *
 * The screen holds one line per seller and nothing else until a line is opened.
 * That is the whole scalability story here and it is deliberate: a raffle with
 * two hundred sellers is two hundred rows, and the detail behind any one of
 * them — every book, every payment, a running balance — is a request that
 * happens when a person decides they want it. Loading all of it up front is how
 * a page that works for five sellers stops working for two hundred, and it
 * fails on the phone of whoever is standing at the desk.
 *
 * Cached per seller for the life of the screen, because the common motion is
 * open, read, close, open again while comparing two people.
 */
const statements = ref({})
async function loadStatement(agentId) {
  if (statements.value[agentId]) return
  statements.value = { ...statements.value, [agentId]: { loading: true } }
  try {
    const r = await api('agent_statement', { agentId })
    statements.value = { ...statements.value, [agentId]: { loading: false, data: r } }
  } catch (err) {
    statements.value = { ...statements.value, [agentId]: { loading: false, error: err.message } }
  }
}
const statementOf = (id) => statements.value[id] || {}

/**
 * THE AUDIT TRAIL, which is a different question from the statement.
 *
 * The statement shows the lines that make up the debt. This shows every row in
 * the payments ledger, including the settlement rows that a re-settle reverses
 * and rewrites — the ones that used to be the entire detail panel, six of them,
 * netting to nothing. They are not noise in the right context: "why does this
 * book say RM100 when I remember RM90" is answered here and nowhere else. So
 * they keep a home, one click further in, labelled for what they are.
 */
const payments = ref({})
const audit = ref('')
async function loadPayments(agentId) {
  if (payments.value[agentId]) return
  try {
    const r = await api('list_payments', { agentId })
    payments.value = { ...payments.value, [agentId]: r.payments || [] }
  } catch { payments.value = { ...payments.value, [agentId]: [] } }
}
function toggleAudit(agentId) {
  audit.value = audit.value === agentId ? '' : agentId
  if (audit.value) loadPayments(agentId)
}

/*
 * The book whose trail is open, or null. On top of this screen rather than
 * instead of it: a treasurer checks a book and comes back to the row they were
 * chasing, and losing the seller they had open to read it is how a screen stops
 * being worth opening.
 */
const showHistory = ref(null)

/** Column totals for the seller table, rounded once at the end. */
function totalOf(field) {
  const n = (rows.value || []).reduce((t, r) => t + Number(r[field] ?? 0), 0)
  return Math.round(n * 100) / 100
}

/** A statement line's own word for itself, so the table reads without a key. */
const KINDS = {
  sale: 'Tickets sold',
  settlement: 'Book counted in',
  'settlement-cash': 'Cash with count-in',
  hand: 'Handed in',
  writeoff: 'Written off',
}

/*
 * WHAT THIS PERSON WROTE DOWN — the 'recorded' scope, assembled here rather
 * than fetched.
 *
 * NOT A NARROWED report_outstanding, and it must not become one. That report
 * answers "who owes what", and a helper is in none of its rows by design:
 * money follows custody, so a sale a helper records is credited to whoever
 * holds the book and the helper owes nothing, ever. Filtering a debt table
 * down to them would correctly produce nothing, which is exactly the blank
 * screen this is fixing.
 *
 * What is theirs is the RECORD: the tickets carrying their email in
 * recorded_by. Those rows are already on the device — the snapshot carries
 * Recorded_By, and a helper is the one role whose own sales come back
 * unmasked — so this is a filter over what the app already has, not a new
 * report and not a new permission.
 *
 * The email guard is load-bearing. Before the user is known, `me` is '' and an
 * unguarded comparison would match every ticket nobody recorded — the whole
 * desk's sales, shown to a helper, which is the class of bug this screen was
 * being fixed for in the first place.
 *
 * WHY IT SITS ABOVE isPaid, WHICH IT CALLS. moneyowed.test.mjs evaluates the
 * rest of this script in three spans — isPaid to telHref, telHref to waLink,
 * and waLink to the closing script tag — which between them cover every line
 * below. Those evals have no Vue in scope, so a `computed` dropped into any of
 * them is a ReferenceError in a test about payment chips. Everything under
 * isPaid is a small pure helper the tests run on its own; this is data
 * derivation and belongs up here with the rest of it. The forward reference is
 * safe: a computed's getter does not run until the first render, by which time
 * every const in this module has been initialised, and copying the paid test
 * instead would put the one rule this screen has already got wrong once into
 * two places again.
 *
 * That last span's marker is NAMED rather than written out above, and it has
 * to be: spelled literally, the closing tag ends the span early, because the
 * slice runs to the first match in the file — which would be the sentence
 * describing it. A comment about a marker is indistinguishable from the
 * marker, the same trap as a file that explains a rule reading as the rule.
 */
const mine = computed(() => {
  const me = String(state.user?.email || '')
  if (!me) return []
  return state.tickets
    .filter(t => isSold(t) && String(t.by || '') === me)
    .sort((x, y) => String(x.number).localeCompare(String(y.number)))
})

/*
 * THE FOUR NUMBERS A VOLUNTEER ACTUALLY WANTS at the end of an afternoon.
 *
 * None of them is money owed, and none of them is the raffle's. "What they came
 * to" is the face value of what this person wrote down; "buyers paid" is the
 * ticket's own payment_status, which is the buyer paying the seller at the desk
 * — the other money event this screen has always had to keep apart.
 */
const myTally = computed(() => {
  const list = mine.value
  const sum = ts => ts.reduce((s, t) => s + (Number(t.amount) || 0), 0)
  const value = sum(list)
  const paid = sum(list.filter(isPaid))
  return { count: list.length, value, paid, unpaid: Math.round((value - paid) * 100) / 100 }
})

/*
 * WHO SEES THE RAFFLE'S OWN MONEY — named, not negated.
 *
 * This was `scope !== 'recorded'`, and it is the third time today this
 * codebase has written "everything except the one I thought of". The other two
 * were `scope !== 'totals'` deciding who got the debt table, which handed a
 * helper every seller's line the moment a fourth scope existed, and
 * `source <> 'settlement'` summing a write-off as cash arriving. Both were
 * correct the day they were typed and wrong the day somebody added a value.
 *
 * IT WAS NOT LEAKING, and that is the reason to fix it rather than a reason
 * not to. state.totals is scoped by totalsAgents on the server, so a scope
 * nobody has written yet would show zeroes rather than the raffle's takings.
 * A guard that is correct only because a different guard is correct is not a
 * second layer — it is one layer and a coincidence, and the coincidence is
 * what changes when somebody edits the other end.
 *
 * A HAND-KEPT COPY OF showsSellerNames()'s RULE, deliberately. The browser
 * cannot import the edge function, so this cannot be spelled once; a copy that
 * says it is a copy is the honest answer, and naming the three scopes that get
 * the figures means a fourth has to be added here on purpose.
 */
const showsRaffleMoney = computed(() => ['all', 'mine', 'totals'].includes(scope.value))

/*
 * WHO GETS THE SELLER TABLE — the client's hand-kept copy of showsSellerNames.
 *
 * The table branch was `v-else-if="rows.length"`, the last arm of the chain,
 * so it caught everything the named arms did not. That is the same negation in
 * a different costume: not a `!==` anywhere, just a fall-through, which is what
 * "everything except the ones I thought of" looks like in a template.
 *
 * It did not leak, because report_outstanding sends `agents: []` to any scope
 * showsSellerNames refuses, so rows.length was 0 and the arm never fired. Hand
 * the screen rows anyway and it renders every seller — which is what the test
 * below now does, because a test that asserts against an empty array cannot
 * tell a screen that WITHHOLDS from one that is merely relying on the server
 * to. Credit to the round report for making that distinction first.
 */
const showsSellerLines = computed(() => ['all', 'mine'].includes(scope.value))

// The same cap, for the same reason: a busy desk is hundreds of rows.
const showAllMine = ref(false)
const mineShown = computed(() => showAllMine.value ? mine.value : mine.value.slice(0, CAP))

/*
 * WHETHER THE BUYER PAID THE SELLER — which is NOT whether the seller has
 * handed it in, and conflating the two is what made this column meaningless.
 *
 * It was `/paid|received|in/i`, and the only two values ever written are 'Paid'
 * and 'Unpaid'. "Unpaid" contains "paid", so every ticket in the raffle showed
 * the green chip, including the ones nobody had paid for. The column could not
 * say "not in" — it had no reachable state that did.
 */
const isPaid = t => String(t.payment || '').trim().toLowerCase() === 'paid'


/*
 * The number comes with the report, not from the seller list.
 *
 * It used to fall back to agentMap, which worked and was still wrong: a chase
 * list that cannot produce the number it is telling you to ring has not
 * answered its own question, and the fallback hid that for as long as some
 * other screen happened to have loaded the sellers first.
 */
/** Shown as written down; dialled with the spaces and dashes taken out. */
function telHref(phone) {
  return 'tel:' + String(phone).replace(/[^\d+]/g, '')
}


function waLink(a) {
  // Not just "is there a number". A number we cannot place is a link to a
  // stranger, and it looks exactly like a link that works.
  if (!isDialable(a.phone)) return ''
  const msg = `Hello ${a.name}, the raffle shows ${money(a.outstanding, currency.value)} ` +
    `still to come in from ${a.ticketsSold} ticket${a.ticketsSold === 1 ? '' : 's'}. ` +
    `Could you let us know when you can hand it in? Thank you.`
  return `https://wa.me/${waNumber(a.phone)}?text=${encodeURIComponent(msg)}`
}
</script>

<template>
  <div>
    <h1>Money</h1>
    <p class="muted">The system records money — it never touches it. Cash is handled in person.</p>

    <!-- THE RAFFLE'S MONEY, for the three scopes it belongs to in some part.
         A helper is not one of them: those figures are the whole raffle's
         takings, from transactions that were not theirs, and showing them
         zeroed instead would be honest and still pointless. A VIEWER is one —
         this once read `scope !== 'totals'`, which hid the figures from the
         one role that exists to check them. Named rather than negated; see
         showsRaffleMoney. -->
    <div v-if="o && showsRaffleMoney" class="stats" style="margin-bottom:16px">
      <div class="stat"><div class="n">{{ moneyShort(o.expected, currency) }}</div><div class="l">Should have</div></div>
      <div class="stat"><div class="n">{{ moneyShort(o.collected, currency) }}</div><div class="l">Handed in</div></div>
      <div class="stat" :class="{ accent: o.outstanding > 0 }">
        <div class="n" :style="o.outstanding > 0 ? 'color:var(--warn)' : ''">
          {{ moneyShort(o.outstanding, currency) }}
        </div>
        <div class="l">Still owed</div>
      </div>
      <div class="stat"><div class="n">{{ (o.ticketsSold || 0).toLocaleString() }}</div><div class="l">Tickets sold</div></div>
    </div>

    <!-- A HELPER'S OWN FOUR NUMBERS. Not a share of the raffle's: what they
         wrote down, what it came to, and how much of it the buyers had paid
         over by the time they wrote it. -->
    <div v-else-if="scope === 'recorded'" class="stats" style="margin-bottom:16px">
      <div class="stat"><div class="n">{{ myTally.count.toLocaleString() }}</div><div class="l">You wrote down</div></div>
      <div class="stat"><div class="n">{{ moneyShort(myTally.value, currency) }}</div><div class="l">What they came to</div></div>
      <div class="stat"><div class="n">{{ moneyShort(myTally.paid, currency) }}</div><div class="l">Buyers paid</div></div>
      <div class="stat" :class="{ accent: myTally.unpaid > 0 }">
        <div class="n" :style="myTally.unpaid > 0 ? 'color:var(--warn)' : ''">
          {{ moneyShort(myTally.unpaid, currency) }}
        </div>
        <div class="l">Not paid yet</div>
      </div>
    </div>

    <div class="card">
      <h3>{{ scope === 'recorded' ? 'What you wrote down' : 'What each seller owes' }}</h3>
      <p v-if="scope === 'recorded'" class="muted small">
        Every sale recorded under your name, and whether the buyer had paid when
        you wrote it down.
      </p>
      <p v-else class="muted small">Tickets written down as sold, minus the cash handed in.</p>

      <div v-if="rows === null" class="col" style="gap:12px;margin-top:14px">
        <div v-for="i in 4" :key="i" class="skel"></div>
      </div>

      <!--
        A HELPER'S OWN RECORD.
        Placed before the 'totals' branch because the two used to be one scope
        and said the same unhelpful thing to both. A helper owes nothing, so
        there is no line for them in the table above — but the afternoon they
        spent at the desk is a real record and it is theirs.
      -->
      <template v-else-if="scope === 'recorded'">
        <div class="note info" style="margin-top:12px">
          The cash goes to the organiser and every sale is credited to whoever
          holds the book, so none of the raffle's money is owed by you or to
          you. This is the record of what you wrote down.
        </div>

        <div v-if="!mine.length" class="tiny muted" style="margin-top:12px">
          Nothing yet. Sales you record on the Sell screen show up here, with
          what each one came to.
        </div>

        <div v-else class="tablewrap" style="margin-top:12px">
          <table>
            <thead>
              <!-- "Buyer paid", the same distinction the seller table makes:
                   whether the buyer handed the money over is not whether it has
                   reached the organiser, and this person did neither. -->
              <tr><th>Ticket</th><th>Book</th><th>Bought by</th>
                  <th class="num">Amount</th><th>Buyer paid</th><th>When</th></tr>
            </thead>
            <tbody>
              <tr v-for="t in mineShown" :key="t.number">
                <td><b>{{ t.number }}</b></td>
                <td>{{ t.book }}</td>
                <td>{{ t.name || '—' }}<template v-if="t.phone"> · {{ t.phone }}</template></td>
                <td class="num">{{ money(t.amount) }}</td>
                <td>
                  <span :class="['pill', isPaid(t) ? 'ok' : 'bad']">
                    {{ isPaid(t) ? 'paid' : 'not paid' }}
                  </span>
                </td>
                <td class="tiny muted">{{ t.saleDate ? date(t.saleDate) : '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p v-if="mine.length > mineShown.length" class="tiny muted" style="margin-top:8px">
          Showing {{ mineShown.length }} of {{ mine.length }}.
          <button class="linkish" @click="showAllMine = true">Show them all</button>
        </p>
      </template>

      <div v-else-if="scope === 'totals'" class="note info" style="margin-top:12px">
        The figures above are the raffle's. Who owes what is the organiser's to
        see — this screen shows you whether the money is healthy, not the people
        behind it.
      </div>

      <div v-else-if="showsSellerLines && rows.length" class="tablewrap" style="margin-top:8px">
        <table>
          <thead>
            <tr>
              <th>Seller</th><th class="num">Books</th><th class="num">Sold</th>
              <th class="num">Should have</th><th class="num">Handed in</th><th class="num">Owes</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="a in rows" :key="a.agentId">
              <tr :class="{ openrow: open === a.agentId }" @click="toggle(a.agentId)">
                <td>
                  <span class="chev">{{ open === a.agentId ? '▾' : '▸' }}</span>
                  {{ a.name || a.agentId }}
                  <span v-if="a.overdueBooks" class="pill bad">{{ a.overdueBooks }} late</span>
                </td>
                <td class="num">{{ a.booksOut }}</td>
                <td class="num">{{ a.ticketsSold }}</td>
                <td class="num">{{ money(a.expected, currency) }}</td>
                <td class="num">{{ money(a.collected, currency) }}</td>
                <td class="num">
                  <b :style="a.outstanding > 0 ? 'color:var(--warn)' : 'color:var(--muted)'">
                    {{ money(a.outstanding, currency) }}
                  </b>
                </td>
              </tr>

              <!-- WHICH tickets. The total answers "how much"; chasing it needs
                   "which ones, sold to whom, and what has already come in" —
                   otherwise the conversation with the seller starts by both
                   sides trying to reconstruct the same list from memory. -->
              <tr v-if="open === a.agentId" class="detail">
                <td colspan="6">
                  <div class="row wrap gap" style="margin-bottom:10px">
                    <a v-if="waLink(a)" class="btn sm" :href="waLink(a)"
                       target="_blank" rel="noopener">Message on WhatsApp</a>
                    <a v-if="isDialable(a.phone)" class="btn sm ghost"
                       :href="telHref(a.phone)">{{ a.phone }}</a>
                    <!-- Three states, not two. A number nobody can ring is not
                         the same as no number, and hiding the difference is how
                         somebody presses a button that reaches a stranger. The
                         digits are shown so whoever can fix the record sees
                         what is actually stored. -->
                    <span v-else-if="a.phone" class="tiny">
                      The number on file — <b>{{ a.phone }}</b> — cannot be dialled.
                      It looks incomplete; check it against the seller list.
                    </span>
                    <span v-else class="tiny muted">No phone number on file for this seller.</span>
                  </div>

                  <!--
                    RECORDING CASH IS A SEPARATE ACT FROM SETTLING A BOOK.
                    Settling counts a book and declares its figures; this only
                    says money arrived. A seller bringing part of it had no way
                    to be recorded at all before, so the organiser either waited
                    or closed a book nobody had counted.
                  -->
                  <div v-if="canRecord" class="row wrap gap" style="margin-bottom:10px">
                    <button class="btn sm primary" @click.stop="emit('record-payment', a)">
                      Record money handed in
                    </button>
                  </div>

                  <!--
                    THE STATEMENT, which is what this panel should have been.

                    What it replaced was a list of payment rows in the order the
                    database returned them, each one a figure and a phrase with
                    no column of its own — including the settlement rows a
                    re-settle reverses, so a seller who owed RM90 was shown
                    three minus-hundreds and three hundreds and no arithmetic
                    that led anywhere. Every number on the screen was true and
                    the screen was unreadable.

                    A statement of account is the ordinary answer and it is
                    ordinary on purpose: dated lines, what was charged, what
                    came in, what is left after each one. Nobody has to be
                    taught it.
                  -->
                  <div v-if="statementOf(a.agentId).loading" class="tiny muted">Loading the statement…</div>
                  <div v-else-if="statementOf(a.agentId).error" class="note bad">
                    <b>The statement could not be loaded.</b>
                    {{ statementOf(a.agentId).error }}
                  </div>
                  <template v-else-if="statementOf(a.agentId).data">
                    <!--
                      The identity this screen is accountable for, written out
                      rather than implied: charged, less what came in, less what
                      was forgiven, is what is left. A reader who checks one
                      thing should be able to check that.
                    -->
                    <div class="recon">
                      <span><i>Charged</i><b>{{ money(statementOf(a.agentId).data.expected, currency) }}</b></span>
                      <span class="op">−</span>
                      <span><i>Received</i><b>{{ money(statementOf(a.agentId).data.collected, currency) }}</b></span>
                      <template v-if="statementOf(a.agentId).data.writtenOff">
                        <span class="op">−</span>
                        <span><i>Written off</i><b>{{ money(statementOf(a.agentId).data.writtenOff, currency) }}</b></span>
                      </template>
                      <span class="op">=</span>
                      <span><i>Balance due</i><b :class="statementOf(a.agentId).data.outstanding > 0 ? 'owed' : ''">
                        {{ money(statementOf(a.agentId).data.outstanding, currency) }}</b></span>
                    </div>

                    <!--
                      A statement that disagrees with the line it expands is
                      worse than none: it is an audit trail that cannot be
                      trusted and looks like one that can. The server checks its
                      own arithmetic against the figure this table reads, and
                      when they differ the screen says so instead of showing two
                      numbers and letting the reader choose.
                    -->
                    <div v-if="statementOf(a.agentId).data.reconciles === false" class="note bad">
                      <b>These lines do not add up to the balance above.</b>
                      The lines come to
                      {{ money(statementOf(a.agentId).data.ledgerBalance, currency) }} and the
                      account says {{ money(statementOf(a.agentId).data.outstanding, currency) }}.
                      Do not chase this figure until somebody has looked — send this screen to
                      whoever keeps the books.
                    </div>

                    <!--
                      The page and the function deploy separately, so for a
                      minute after a release one can be older than the other. An
                      older function answers without entries at all, and a
                      statement that throws is a money screen that is simply
                      gone. It says "nothing yet" for that minute instead.
                    -->
                    <div v-if="!(statementOf(a.agentId).data.entries || []).length" class="tiny muted">
                      Nothing has been charged to this seller and nothing has come in.
                    </div>
                    <div v-else class="tablewrap">
                      <table class="inner statement">
                        <thead>
                          <tr>
                            <th>When</th><th>What</th><th>Reference</th>
                            <th class="num">Charged</th><th class="num">Received</th><th class="num">Balance</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="(e, i) in (statementOf(a.agentId).data.entries || [])" :key="i"
                              :class="{ writeoff: e.kind === 'writeoff' }">
                            <td class="tiny muted">{{ e.at ? date(e.at) : '—' }}</td>
                            <!-- "Counted in" is this app's word for the last step
                                 of a book, and a statement is exactly where somebody
                                 meets it without context: their debt is one line and
                                 the line is a phrase they have not been taught. -->
                            <td :class="{ helpword: String(e.kind).startsWith('settlement') }"
                                :title="String(e.kind).startsWith('settlement') ? COUNTED_IN_HELP : undefined">
                              {{ KINDS[e.kind] || e.kind }}
                            </td>
                            <!--
                              ONE FETCH PER CLICK, and only when somebody clicks.
                              The book is the drill-down, not the ticket: a
                              statement line says "Book-230, ten sold, RM100",
                              and which ten is a question about that book, which
                              the history sheet already answers in one
                              permissioned call. The alternative — the list this
                              panel used to build — walked every ticket the
                              browser had in memory, which is fine at fifty and
                              is the whole page at ten thousand.
                            -->
                            <td class="tiny">
                              <button v-if="e.ref && !e.ref.startsWith('#')" class="linkish"
                                      @click.stop="showHistory = e.ref">{{ e.ref }}</button>
                              <template v-else>{{ e.ref }}</template>
                              <template v-if="e.description"> · {{ e.description }}</template>
                            </td>
                            <td class="num">{{ e.charge ? money(e.charge, currency) : '' }}</td>
                            <td class="num">{{ e.credit ? money(e.credit, currency) : '' }}</td>
                            <td class="num bal">{{ money(e.balance, currency) }}</td>
                          </tr>
                        </tbody>
                        <tfoot>
                          <!-- The closing balance repeated where the eye ends up,
                               because a running balance is read down the right
                               and the last line is the answer. -->
                          <tr>
                            <td colspan="3"><b>Balance due</b></td>
                            <td class="num"></td><td class="num"></td>
                            <td class="num bal"><b>{{ money(statementOf(a.agentId).data.outstanding, currency) }}</b></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    <p class="tiny muted" style="margin-top:8px">
                      <button class="linkish" @click.stop="toggleAudit(a.agentId)">
                        {{ audit === a.agentId ? 'Hide' : 'Show' }} every payment row
                      </button>
                      · the full ledger, including rows a re-count reversed
                    </p>

                    <div v-if="audit === a.agentId" class="tablewrap">
                      <table class="inner">
                        <thead>
                          <tr><th>When</th><th class="num">Amount</th><th>How</th><th>Note</th></tr>
                        </thead>
                        <tbody>
                          <tr v-for="p in (payments[a.agentId] || [])" :key="p.id">
                            <td class="tiny muted">{{ p.receivedAt ? date(p.receivedAt) : '' }}</td>
                            <td class="num" :class="p.amount < 0 ? 'bad' : ''">{{ money(p.amount, currency) }}</td>
                            <!-- A settlement row and a hand-over row are the same money
                                 arriving by different routes, and only one of them has a
                                 name a volunteer has to be taught. -->
                            <td :class="{ helpword: p.source === 'settlement' }"
                                :title="p.source === 'settlement' ? COUNTED_IN_HELP : undefined">
                              {{ p.source === 'settlement' ? 'counted in with a book' : (p.source || 'handed in') }}
                            </td>
                            <td class="tiny muted">{{ p.note || '' }}</td>
                          </tr>
                        </tbody>
                      </table>
                      <p v-if="!(payments[a.agentId] || []).length" class="tiny muted">
                        No payment rows at all for this seller.
                      </p>
                    </div>
                  </template>

                  <!-- Books out now means books actually out; until the port was
                       fixed it counted every book the seller had ever touched,
                       so nought was unreachable and this sentence impossible.
                       It is the one case the Books column reads as innocent:
                       nothing held, money still owed. -->
                  <p v-if="a.outstanding > 0 && !a.booksOut" class="tiny">
                    Every book is back<template v-if="a.booksSettled">
                    — {{ a.booksSettled }} settled</template>. Only the money is outstanding.
                  </p>
                  <p v-else-if="a.booksSettled" class="tiny muted">
                    {{ a.booksOut }} still out · {{ a.booksSettled }} settled
                  </p>

                  <p class="tiny muted" style="margin-top:6px">
                    Every line above opens the book it came from — who has had it,
                    and which tickets went out of it.
                  </p>
                </td>
              </tr>
            </template>
          </tbody>
          <!--
            COLUMN TOTALS, because a money table without them asks the reader to
            add it up themselves and then argues with the four figures at the top
            of the page. These are summed from the rows on screen, so if they
            ever disagree with the cards above, the disagreement is visible
            rather than hidden in a report nobody can see.
          -->
          <tfoot v-if="rows.length > 1">
            <tr>
              <td><b>{{ rows.length }} sellers</b></td>
              <td class="num">{{ totalOf('booksOut') }}</td>
              <td class="num">{{ totalOf('ticketsSold') }}</td>
              <td class="num"><b>{{ money(totalOf('expected'), currency) }}</b></td>
              <td class="num"><b>{{ money(totalOf('collected'), currency) }}</b></td>
              <td class="num"><b>{{ money(totalOf('outstanding'), currency) }}</b></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <Empty v-else art="💰" title="Nothing given out yet">
        Once books are with sellers, what they owe shows up here.
      </Empty>
    </div>

    <!-- On top of the table, so closing it puts you back on the same seller. -->
    <History v-if="showHistory" :book="showHistory" @close="showHistory = null" />
  </div>
</template>

<style scoped>
/*
 * A STATEMENT IS READ DOWN THE RIGHT-HAND EDGE, so the money columns are
 * tabular-figured and right-aligned and the balance is the one in ink. Without
 * tabular figures the digits change width between rows and a column of money
 * stops lining up, which is the difference between a table you can scan and one
 * you have to read.
 */
.statement td.num, .statement th.num, .recon b { font-variant-numeric: tabular-nums; }
.statement td.bal { font-weight: 600; }
.statement tfoot td { border-top: 2px solid var(--border); }

/*
 * The reference is the way into the book, so it has to look like a way in and
 * not like a form control. A bordered chip in a money column reads as an input
 * somebody is meant to type in.
 */
.statement .linkish {
  border: 0; background: none; padding: 0; font: inherit; color: var(--brand);
  text-decoration: underline; text-underline-offset: 2px; cursor: pointer;
}
.statement .linkish:hover { text-decoration-thickness: 2px; }

/* A write-off reduces the debt and is not cash, so it is legible and quiet
   rather than sitting in the same weight as money that arrived. */
.statement tr.writeoff td { color: var(--muted); font-style: italic; }

/*
 * The identity the screen is accountable for, laid out as the sum it is:
 * charged, less received, less forgiven, is what is left. It wraps on a phone
 * rather than scrolling sideways — a treasurer checks this standing up.
 */
.recon {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px;
  margin: 2px 0 12px; padding: 10px 12px;
  background: var(--surface-2); border-radius: 10px;
}
.recon span { display: flex; flex-direction: column; line-height: 1.25; }
.recon i { font-style: normal; font-size: .72rem; color: var(--muted); text-transform: uppercase; letter-spacing: .03em; }
.recon b { font-size: 1.02rem; }
.recon b.owed { color: var(--warn); }
.recon .op { font-size: 1.1rem; color: var(--muted); align-self: center; }
</style>
