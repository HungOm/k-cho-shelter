<script setup>
/**
 * One seller's money, on its own.
 *
 * WHY IT IS A SHEET AND NOT A ROW THAT GROWS. This was a table row that opened
 * into another table — a statement, an audit trail and three actions, nested
 * inside the row it belonged to, pushing every seller below it off the screen.
 * On a phone it was a column of numbers inside a column of numbers, and the
 * person reading it had lost the list they were comparing against. Every other
 * detail view in this app is a sheet, and a treasurer opening a seller is doing
 * exactly what somebody opening a book is doing.
 *
 * FETCHED WHEN IT OPENS, and only then. The money screen holds one line per
 * seller and nothing else: a raffle with two hundred sellers is two hundred
 * rows, and the detail behind any one of them — every book, every payment, a
 * running balance — is a request that happens when a person asks for it.
 * Mounting is that request, which is the whole of the lazy-loading story now
 * that the panel is a component: it cannot be built before somebody opens it.
 */
import { ref, onMounted, computed, watch } from 'vue'
import { api, state, isAdmin } from '../../lib/store.js'
import { money, date, COUNTED_IN_HELP } from '../../lib/format.js'
// Asked here as well as by the screen that built the link. Every component that
// turns a phone number into something pressable asks whether it can be dialled
// at all — a number nobody can ring is not the same as no number, and a link
// that looks like the real one is how somebody reaches a stranger.
import { isDialable } from '../../lib/search.js'
/* Shared with the draw's entry list, so the two exports cannot disagree about
   quoting or about the BOM Excel needs to read a Burmese name. */
import { downloadCsv, csvName } from '../../lib/csv.js'
import Sheet from '../ui/Sheet.vue'
import Pager from '../ui/Pager.vue'
import Who from '../ui/Who.vue'
import Filters from '../ui/Filters.vue'
import History from './History.vue'

const props = defineProps({
  agent: { type: Object, required: true },
  // Built by the screen that opens this, which already holds the rules for
  // whether a number can be dialled at all. Passing the finished links keeps
  // that judgement in one place rather than repeating it here.
  wa: { type: String, default: '' },
  tel: { type: String, default: '' },
})
const emit = defineEmits(['close', 'record-payment'])

const currency = computed(() => state.cfg?.currency || '')
/*
 * WHO MAY WRITE DOWN A HAND-OVER: whoever received it.
 *
 * This was canWrite, which includes sellers — so a seller looking at their own
 * money was offered a button that credited themselves a hand-over nobody had
 * received. The money a seller handles is the cash a buyer puts in their hand,
 * and the record of that is the ticket. What they give an organiser is an act
 * with two people in it, and the person receiving the cash is the only one who
 * can honestly write it down.
 */
const canRecord = computed(() => isAdmin.value || state.user?.role === 'recorder')

/** Looking at your own money, which is most of what a seller opens this for. */
const isMine = computed(() => state.user?.agentId === props.agent.agentId)
const canRing = computed(() => isDialable(props.agent.phone))

const st = ref({ loading: true })

/*
 * ITS OWN FUNCTION, CALLED ON MOUNT. Mounting is the request — the sheet cannot
 * be built before somebody opens it, which is a stronger guarantee than a call
 * guarded by a flag. It is named rather than inlined so a test can render this
 * component and drive it: server rendering never fires onMounted, so a fetch
 * that exists only inside one is a panel no test can look at.
 */
async function load() {
  try {
    st.value = { loading: false, data: await api('agent_statement', { agentId: props.agent.agentId }) }
    // Land on the closing balance, which is what somebody opened this for.
    linePage.value = Math.max(1, Math.ceil(entries.value.length / LINES))
  } catch (err) {
    st.value = { loading: false, error: err.message }
  }
}
onMounted(load)

/**
 * THE AUDIT TRAIL, which is a different question from the statement.
 *
 * The statement shows the lines that make up the debt. This shows every row in
 * the payments ledger, including the settlement rows that a re-count reverses
 * and rewrites — six of them, netting to nothing, which is what this panel used
 * to be in its entirety. They are not noise in the right context: "why does
 * this book say RM100 when I remember RM90" is answered here and nowhere else.
 * So they keep a home, one press further in, labelled for what they are.
 */
const payments = ref(null)
const showAudit = ref(false)
async function loadPayments() {
  if (payments.value) return
  try {
    const r = await api('list_payments', { agentId: props.agent.agentId })
    payments.value = r.payments || []
  } catch { payments.value = [] }
}
async function toggleAudit() {
  showAudit.value = !showAudit.value
  if (showAudit.value) await loadPayments()
}

/**
 * THE RECEIPT FOR ONE HAND-OVER, which is what a seller is owed by this screen.
 *
 * A seller cannot write a payment down — the person receiving the cash does
 * that — so the only evidence they have that their money arrived is what this
 * app shows them. A line in a running balance is not evidence: it says an
 * amount and a date. A receipt says who took it, when, how, against which book,
 * and whether anything has happened to it since.
 *
 * NOTHING HERE IS EDITABLE, BY ANYBODY, and that is the part worth showing. A
 * payment row is never altered and never deleted: a correction is an opposing
 * row with a reason on it, so a receipt that was undone still exists and says
 * so. That is what makes it worth trusting — and worth showing to the person
 * whose money it was.
 */
/*
 * A STATEMENT IS READ FROM THE BOTTOM, so that is the page it opens on.
 *
 * A seller with sixty books has hundreds of lines, and the line that matters is
 * the last one: a running balance answers "where do I stand now", and the
 * answer is at the end of it. Opening on page one of nine and making somebody
 * press Next eight times to reach their own balance is the wrong way round —
 * and the wrong way round is what every list defaults to.
 *
 * The oldest-first ORDER is kept, because a running balance only reads in one
 * direction. What changes is which page you land on.
 */
const LINES = 20
const entries = computed(() => st.value.data?.entries || [])
const linePage = ref(1)
const payPage = ref(1)

/*
 * FILTERING THE ACCOUNT — and every row belongs to exactly one filter.
 *
 * The obvious shape is All / Charges / Payments / Reversed, which is what the
 * mockup draws. It leaves `writeoff` in no group at all: a written-off debt
 * would then be visible under All and nowhere else, which is the "everything
 * except X" trap this repository has paid for three times. A row that vanishes
 * from every named view is worse than one that is hard to find, because the
 * filter reads as exhaustive.
 *
 * So the groups are named after what the row DOES to the balance, and the six
 * kinds map onto five groups with nothing left over. Written off gets its own
 * chip because it is the one credit that is not money — somebody deciding a
 * debt will not be collected is not somebody handing cash over, and a statement
 * that shows them together cannot be used to chase either.
 */
const GROUP = {
  sale: 'charge',
  payment: 'in',
  settlement: 'in',
  writeoff: 'off',
  'payment-reversal': 'rev',
  'settlement-reversal': 'rev',
}
const FILTERS = [
  { k: 'all', t: 'All' },
  { k: 'charge', t: 'Charges' },
  { k: 'in', t: 'Money in' },
  { k: 'off', t: 'Written off' },
  { k: 'rev', t: 'Reversed' },
]
const filter = ref('all')
const groupOf = (e) => GROUP[e.kind] || 'charge'
const counts = computed(() => {
  const c = { all: entries.value.length }
  for (const e of entries.value) c[groupOf(e)] = (c[groupOf(e)] || 0) + 1
  return c
})
const filtered = computed(() => filter.value === 'all'
  ? entries.value
  : entries.value.filter((e) => groupOf(e) === filter.value))
/* A filter that leaves you on page 4 of a one-page list shows an empty table
   and looks like a screen with no data in it. */
watch(filter, () => { linePage.value = 1 })

/*
 * The supporting line under each figure in the identity above the table. These
 * are DERIVED here rather than asked of the server: the counts are already in
 * the rows it sent, and a second field to keep in step is a second field that
 * can disagree with the first.
 */
const handOvers = computed(() => entries.value.filter((e) => groupOf(e) === 'in').length)

const shownEntries = computed(() =>
  filtered.value.slice((linePage.value - 1) * LINES, linePage.value * LINES))
const shownPayments = computed(() =>
  (payments.value || []).slice((payPage.value - 1) * LINES, payPage.value * LINES))

const receipt = ref(null)
async function openReceipt(ref_) {
  const id = String(ref_ || '').replace(/^#/, '')
  if (!id) return
  await loadPayments()
  receipt.value = (payments.value || []).find((p) => String(p.id) === id) || { missing: id }
}

/** The row that undid this one, if anything did. */
const undoneBy = computed(() => !receipt.value?.id ? null
  : (payments.value || []).find((p) => String(p.reverses) === String(receipt.value.id)) || null)

/* On top of this sheet, so closing the book puts you back on the seller. */
const showHistory = ref(null)

/*
 * THE STATEMENT AS A FILE, which is card 4d's Export beside the filters.
 *
 * It exports WHAT IS ON SCREEN, filter and all, and puts the filter's name in
 * the filename — "TEST-A001-charges.csv", not "statement.csv". Exporting the
 * whole account regardless would be the safer-sounding choice and is worse: a
 * reader who filtered to Charges and pressed Export would get a file that
 * disagrees with the screen they were looking at, and would have no way to
 * tell. The screen already takes this seriously one line above, where it says
 * "Showing N of M lines" rather than letting a highlighted chip carry it.
 *
 * The Balance column is copied as the RUNNING balance the server computed, not
 * recomputed here. Money has two doors — a book figure and hand payments — and
 * a file that re-derived the balance a second way would be a second opinion
 * about what a seller owes, printed and taken to a meeting.
 */
function exportStatement() {
  const head = ['When', 'What', 'Reference', 'Description', 'To',
                `Charged (${currency.value})`, `Received (${currency.value})`,
                `Balance (${currency.value})`]
  const rows = filtered.value.map((e) => [
    e.at ? date(e.at) : '',
    KINDS[e.kind] || e.kind,
    e.ref || '',
    e.description || '',
    e.by || '',
    e.charge || '',
    e.credit || '',
    e.balance,
  ])
  const which = filter.value === 'all' ? '' : (FILTERS.find((f) => f.k === filter.value) || {}).t
  downloadCsv(csvName(props.agent.name || props.agent.agentId, props.agent.agentId,
                      which || 'statement'), head, rows)
}

/** A statement line's own word for itself, so the table reads without a key. */
const KINDS = {
  sale: 'Tickets sold',
  settlement: 'Book counted in',
  'settlement-reversal': 'Count-in reversed',
  payment: 'Handed in',
  'payment-reversal': 'Payment undone',
  writeoff: 'Written off',
}
</script>

<template>
  <Sheet :title="agent.name || agent.agentId"
         :subtitle="agent.agentId ? `Seller ${agent.agentId}` : ''" wide @close="emit('close')">
    <!-- THE ANSWER FIRST. Somebody opens a seller to find out one thing, and it
         is this: what is still to come in from them. The lines below are the
         working, and the working should not come before the answer. -->
    <div class="head">
      <div class="big" :class="{ owed: agent.outstanding > 0 }">
        {{ money(agent.outstanding, currency) }}
      </div>
      <div class="muted">
        <template v-if="agent.outstanding > 0">still to come in</template>
        <template v-else-if="agent.outstanding < 0">handed in beyond what is charged</template>
        <template v-else>nothing outstanding</template>
      </div>
      <div class="pills">
        <span class="pill">{{ agent.booksOut }} out</span>
        <span v-if="agent.booksSettled" class="pill">{{ agent.booksSettled }} counted in</span>
        <span v-if="agent.overdueBooks" class="pill bad">{{ agent.overdueBooks }} late</span>
        <span class="pill">{{ agent.ticketsSold }} sold</span>
      </div>
    </div>

    <!-- Three states, not two. A number nobody can ring is not the same as no
         number, and hiding the difference is how somebody presses a button that
         reaches a stranger. -->
    <p v-if="!canRing && agent.phone" class="note warn tiny">
      The number on file — <b>{{ agent.phone }}</b> — cannot be dialled. It looks
      incomplete; check it against the seller list.
    </p>
    <p v-else-if="!agent.phone" class="tiny muted">No phone number on file for this seller.</p>

    <!-- WHERE A SELLER'S MONEY GOES, said on the screen where they would
         otherwise look for a button. Every line below is the record of a
         hand-over an organiser accepted; the way to add another is to send a
         report, not to type one here. -->
    <p v-if="isMine && !canRecord" class="note info tiny">
      Cash you hand over is recorded by the organiser who receives it. Send it with
      your report, and it appears here once they accept it — with their name on it,
      which is what makes it a receipt.
    </p>

    <div v-if="st.loading" class="skel" style="height:64px"></div>
    <div v-else-if="st.error" class="note bad">
      <b>The statement could not be loaded.</b> {{ st.error }}
    </div>

    <template v-else-if="st.data">
      <!-- The identity this screen is accountable for, written out rather than
           implied: charged, less what came in, less what was forgiven, is what
           is left. A reader who checks one thing should be able to check that. -->
      <!-- Each figure says what it is COUNTED FROM, not only what it comes to.
           "Received 380.00" is a number to be trusted or not; "380.00, over 3
           hand-overs" is a number somebody can go and check, which is the
           difference between a statement and a claim. -->
      <div class="recon">
        <span><i>Charged</i><b>{{ money(st.data.expected, currency) }}</b>
          <small v-if="agent.ticketsSold">{{ agent.ticketsSold }} tickets written down</small>
        </span>
        <span class="op">−</span>
        <span><i>Received</i><b>{{ money(st.data.collected, currency) }}</b>
          <small v-if="handOvers">{{ handOvers }} hand-over{{ handOvers === 1 ? '' : 's' }}</small>
        </span>
        <template v-if="st.data.writtenOff">
          <span class="op">−</span>
          <span><i>Written off</i><b>{{ money(st.data.writtenOff, currency) }}</b></span>
        </template>
        <span class="op">=</span>
        <span><i>Balance due</i>
          <b :class="st.data.outstanding > 0 ? 'owed' : ''">{{ money(st.data.outstanding, currency) }}</b>
        </span>
      </div>

      <!-- A statement that disagrees with the line it expands is worse than
           none: an audit trail that cannot be trusted, looking like one that
           can. The server checks its own arithmetic against the figure this
           table reads, and says so when they differ. -->
      <div v-if="st.data.reconciles === false" class="note bad">
        <b>These lines do not add up to the balance above.</b>
        The lines come to {{ money(st.data.ledgerBalance, currency) }} and the account says
        {{ money(st.data.outstanding, currency) }}. Do not chase this figure until somebody
        has looked — send this screen to whoever keeps the books.
      </div>

      <div v-if="!(st.data.entries || []).length" class="tiny muted">
        Nothing has been charged to this seller and nothing has come in.
      </div>
      <template v-else>
      <!-- WHAT IS BEING SHOWN, said above the table rather than left to be
           inferred from a highlighted chip. A filtered statement still ends in
           the account's own balance, so without this line a reader can take a
           short list of charges for the whole account. -->
      <Filters v-model="filter" :items="FILTERS" :counts="counts">
        <template #after>
          <span v-if="filter !== 'all'" class="tiny muted grow">
            Showing {{ filtered.length }} of {{ entries.length }} lines. The balance
            below is the whole account's.
          </span>
          <span v-else class="grow"></span>
          <!-- Takes the statement to whoever keeps the books. Disabled with its
               reason rather than hidden when the filter has emptied the table,
               per permissionui — a button that vanishes reads as a broken
               screen, and an empty file reads as an account with no history. -->
          <button type="button" class="btn sm ghost" :disabled="!filtered.length"
                  :title="filtered.length
                    ? 'Save these lines as a spreadsheet file'
                    : 'Nothing to export — this filter matches no lines'"
                  @click="exportStatement">Export</button>
        </template>
      </Filters>

      <div class="tablewrap">
        <table class="statement">
          <thead>
            <tr>
              <th>When</th><th>What</th><th>Reference</th>
              <th class="num">Charged</th><th class="num">Received</th><th class="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(e, i) in shownEntries" :key="i"
                :class="{ writeoff: e.kind === 'writeoff' }">
              <td class="tiny muted when">{{ e.at ? date(e.at) : '—' }}</td>
              <!-- "Counted in" is this app's word for the last step of a book,
                   and a statement is exactly where somebody meets it without
                   context: their debt is one line and the line is a phrase they
                   have not been taught. -->
              <td :class="{ helpword: String(e.kind).startsWith('settlement') }"
                  :title="String(e.kind).startsWith('settlement') ? COUNTED_IN_HELP : undefined">
                {{ KINDS[e.kind] || e.kind }}
              </td>
              <td class="tiny">
                <!-- A book reference opens the book; a payment reference opens
                     its receipt. Both are the same act from the reader's side:
                     "show me what is behind this line". -->
                <button v-if="e.ref && !e.ref.startsWith('#')" class="linkish"
                        @click="showHistory = e.ref">{{ e.ref }}</button>
                <button v-else-if="e.ref" class="linkish" @click="openReceipt(e.ref)">{{ e.ref }}</button>
                <template v-if="e.description"> · {{ e.description }}</template>
                <!-- Who the money went to, on the line that says it moved. -->
                <div v-if="e.by" class="muted">to <Who :email="e.by" /></div>
              </td>
              <td class="num">{{ e.charge ? money(e.charge, currency) : '' }}</td>
              <td class="num">{{ e.credit ? money(e.credit, currency) : '' }}</td>
              <td class="num bal">{{ money(e.balance, currency) }}</td>
            </tr>
          </tbody>
          <!-- The closing balance is the whole account's, not the page's, and
               it stays under the table on every page: a running balance whose
               last line is out of sight is a table with no answer in it. -->
          <tfoot>
            <tr>
              <td colspan="3"><b>Balance due</b></td>
              <td class="num"></td><td class="num"></td>
              <td class="num bal"><b>{{ money(st.data.outstanding, currency) }}</b></td>
            </tr>
          </tfoot>
        </table>
        <Pager v-model:page="linePage" :total="filtered.length" :size="LINES" noun="entries" />
      </div>

      </template>

      <p class="tiny muted" style="margin-top:8px">
        <button class="linkish" @click="toggleAudit">
          {{ showAudit ? 'Hide' : 'Show' }} every payment row
        </button>
        · the full ledger, including rows a re-count reversed
      </p>

      <div v-if="showAudit" class="tablewrap">
        <table>
          <thead>
            <tr><th>When</th><th class="num">Amount</th><th>How</th><th>Taken by</th><th>Note</th></tr>
          </thead>
          <tbody>
            <tr v-for="p in shownPayments" :key="p.id">
              <td class="tiny muted">{{ p.receivedAt ? date(p.receivedAt) : '' }}</td>
              <td class="num" :class="p.amount < 0 ? 'bad' : ''">{{ money(p.amount, currency) }}</td>
              <!-- A settlement row and a hand-over row are the same money
                   arriving by different routes, and only one of them has a name
                   a volunteer has to be taught. -->
              <td :class="{ helpword: p.source === 'settlement' }"
                  :title="p.source === 'settlement' ? COUNTED_IN_HELP : undefined">
                {{ p.source === 'settlement' ? 'counted in with a book' : (p.source || 'handed in') }}
              </td>
              <td class="tiny"><Who v-if="p.receivedBy" :email="p.receivedBy" /></td>
              <td class="tiny muted">{{ p.note || '' }}</td>
            </tr>
          </tbody>
        </table>
        <Pager v-model:page="payPage" :total="(payments || []).length" :size="LINES" noun="rows" />
        <p v-if="payments && !payments.length" class="tiny muted">
          No payment rows at all for this seller.
        </p>
      </div>

      <!-- The one case the Books column reads as innocent: nothing held, money
           still owed. -->
      <p v-if="agent.outstanding > 0 && !agent.booksOut" class="tiny">
        Every book is back<template v-if="agent.booksSettled">
        — {{ agent.booksSettled }} counted in</template>. Only the money is outstanding.
      </p>
      <p class="tiny muted" style="margin-top:6px">
        Every line above opens the book it came from — who has had it, and which
        tickets went out of it.
      </p>
    </template>

    <!-- ON TOP OF THE STATEMENT, so closing it puts you back on the line you
         were reading. -->
    <div v-if="receipt" class="receipt">
      <div class="spread">
        <b>Receipt</b>
        <button class="linkish" @click="receipt = null">Close</button>
      </div>
      <template v-if="receipt.missing">
        <p class="tiny">That payment is not in the last 200 rows for this seller.</p>
      </template>
      <template v-else>
        <div class="amount" :class="{ bad: receipt.amount < 0 }">{{ money(receipt.amount, currency) }}</div>
        <div class="f"><span>When</span><b>{{ receipt.receivedAt ? date(receipt.receivedAt) : '—' }}</b></div>
        <div class="f"><span>Received by</span><b><Who :email="receipt.receivedBy" /></b></div>
        <div class="f"><span>How</span><b>{{ receipt.method || 'cash' }}</b></div>
        <div class="f"><span>What it was</span>
          <b>{{ receipt.source === 'settlement' ? 'counted in with a book'
               : receipt.source === 'writeoff' ? 'written off' : 'handed over' }}</b>
        </div>
        <div v-if="receipt.note" class="f"><span>Note</span><b>{{ receipt.note }}</b></div>
        <div v-if="receipt.reverses" class="note warn tiny">
          This row undoes an earlier one. Both stay on the record.
        </div>
        <div v-else-if="undoneBy" class="note warn tiny">
          <b>This was undone</b> on {{ date(undoneBy.receivedAt) }} by
          <Who :email="undoneBy.receivedBy" />. Both rows stay on the record.
        </div>
        <p class="tiny muted">
          Nobody can edit or delete this, including an organiser. A correction is a
          new row that says what it undoes, which is why this one can be relied on.
        </p>
      </template>
    </div>

    <template #actions>
      <a v-if="wa" class="btn" :href="wa" target="_blank" rel="noopener"
         title="Message this seller on WhatsApp">WhatsApp</a>
      <a v-if="tel && canRing" class="btn ghost" :href="tel">{{ agent.phone }}</a>
      <!-- "Money handed in", not "Record payment": the two doors this app
           counts money through are the book figure and money handed in BY
           HAND, and a button that says only "payment" is the one somebody
           presses for the wrong one. The verb moves to the title and to the
           sheet it opens, which is titled with it. -->
      <button v-if="canRecord" class="btn primary"
              title="Record money handed in — it does not settle or close a book"
              @click="emit('record-payment', agent)">
        Money handed in
      </button>
      <button class="btn ghost" @click="emit('close')">Close</button>
    </template>

    <History v-if="showHistory" :book="showHistory" @close="showHistory = null" />
  </Sheet>
</template>

<style scoped>
.head { margin-bottom: 16px; }
.big {
  font-size: 2rem; font-weight: 800; line-height: 1.1;
  font-family: var(--font-data); font-variant-numeric: tabular-nums;
}
.big.owed { color: var(--warn); }
.pills { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
/*
 * THE BAND HAD NO EDGE. It was --surface sitting on a sheet that is also
 * --surface, so the one row carrying the whole identity — charged, less
 * received, less written off, equals the balance — was four figures floating
 * in the page with nothing to say they belonged together. Invisible for as
 * long as it has existed, because a background that matches its parent looks
 * exactly like a background that was never set.
 *
 * A border and a rule between each figure, which is also what makes it read as
 * an equation rather than a row of statistics that happen to be adjacent.
 */
.recon {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px 0;
  padding: 0; margin: 14px 0; border-radius: var(--r-sm);
  border: 1px solid var(--border); background: var(--surface); overflow: hidden;
}
.recon > span { padding: 11px 16px; }
/* The operators keep the figures apart; the rules keep the GROUPS apart, so a
   divider goes before each operator rather than between every child. */
.recon > .op + span { border-left: 1px solid var(--border); }
.recon i { display: block; font-style: normal; font-size: .76rem; color: var(--muted); }
.recon b { font-size: 1.05rem; font-family: var(--font-data); font-variant-numeric: tabular-nums; }
.recon b.owed { color: var(--warn); }
.recon .op { color: var(--muted); font-size: 1.1rem; }
/* What the figure above was counted from. Deliberately quieter than the caption
   — the caption names the figure, this one only says where to go and check it. */
.recon small { display: block; font-size: .72rem; color: var(--muted); margin-top: 2px; }

.tablewrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: .9rem; }
th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--border); }
th { font-size: .74rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
.num { text-align: right; font-family: var(--font-data); font-variant-numeric: tabular-nums; }
/* The date column is data too — a statement is read by running down it looking
   for a day, and a proportional face makes every row a different length. */
td.when { font-family: var(--font-data); }
.bal { font-weight: 700; }
tr.writeoff td { color: var(--muted); }
.receipt {
  margin-top: 14px; padding: 14px 16px; border-radius: var(--r-sm);
  border: 1.5px solid var(--brand); background: var(--brand-soft);
}
.receipt .spread { align-items: center; margin-bottom: 8px; }
.receipt .amount { font-size: 1.6rem; font-weight: 800; font-variant-numeric: tabular-nums; }
.receipt .amount.bad { color: var(--bad); }
.receipt .f { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; font-size: .9rem; }
.receipt .f span { color: var(--muted); }
.linkish { background: none; border: 0; padding: 0; color: var(--brand); cursor: pointer; font: inherit; }
/* A reference is an identity somebody will read out, type in, or match against
   a paper stub — Book-004, #13. Same face as the figures it sits beside. */
td .linkish { font-family: var(--font-data); }
</style>
