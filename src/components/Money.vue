<script setup>
/**
 * Money. One number matters most — what each seller still owes — so it is the
 * last column and the only one in colour.
 */
import { ref, onMounted, computed, watch } from 'vue'
import { state, api, toast, canWrite, isAdmin, isSold } from '../lib/store.js'
import { money, moneyShort, date } from '../lib/format.js'
import { waNumber, isDialable } from '../lib/search.js'
import Empty from './ui/Empty.vue'
import SellerMoney from './modals/SellerMoney.vue'
import Pager from './ui/Pager.vue'

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
/*
 * Whoever RECEIVED the money writes it down. canWrite includes sellers, and a
 * seller recording their own hand-over is a receipt with nobody on the other
 * end of it — see record_payment in the registry.
 */
const canRecord = computed(() => isAdmin.value || state.user?.role === 'recorder')

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

/*
 * THE SELLER WHOSE MONEY IS OPEN, or null.
 *
 * This used to be a row that grew: a statement, an audit trail and three
 * actions nested inside the row they belonged to, pushing every other seller
 * off the screen. On a phone it was a column of numbers inside a column of
 * numbers, and the reader had lost the list they were comparing against. It is
 * a sheet now, like every other detail view in this app — and the statement is
 * fetched by that sheet when it mounts, which is to say when somebody asks for
 * it, rather than by this screen for everybody up front.
 */
const openSeller = ref(null)

/*
 * FINDING ONE SELLER AMONG TWO HUNDRED, which is the size this raffle runs at.
 *
 * A full list is the friendliest thing possible at a dozen sellers and a wall
 * at two hundred — scrolled past, on a phone, by somebody with a queue in front
 * of them. Three controls make it a tool instead: type a name, choose what to
 * order by, and take it a page at a time.
 *
 * THE DESK LINE IS PINNED TO THE TOP and never filtered out. It is not a
 * person, it carries money nobody can be chased for, and a reader who filters
 * to "Daw" and sees the raffle's desk takings vanish would reasonably conclude
 * the figures had changed.
 */
const q = ref('')
const sortBy = ref('outstanding')
const page = ref(1)
const PAGE = 25

const SORTS = [
  { v: 'outstanding', t: 'Owes most' },
  { v: 'name', t: 'Name' },
  { v: 'expected', t: 'Sold most' },
  { v: 'booksOut', t: 'Books out' },
]

const matching = computed(() => {
  const needle = q.value.trim().toLowerCase()
  const all = rows.value || []
  const hits = !needle ? all : all.filter(a =>
    String(a.name || '').toLowerCase().includes(needle) ||
    String(a.agentId || '').toLowerCase().includes(needle) ||
    String(a.phone || '').includes(needle))
  const sorted = [...hits].sort((x, y) => {
    if (!x.agentId) return -1          // the desk stays at the top
    if (!y.agentId) return 1
    if (sortBy.value === 'name') return String(x.name || '').localeCompare(String(y.name || ''))
    return Number(y[sortBy.value] ?? 0) - Number(x[sortBy.value] ?? 0)
  })
  return sorted
})

/* A filter that shortens the list must not leave somebody on an empty page. */
watch([q, sortBy, scope], () => { page.value = 1 })

const shownRows = computed(() =>
  matching.value.slice((page.value - 1) * PAGE, page.value * PAGE))

/*
 * A CAP on the helper's own list of sales, because an afternoon at the desk is
 * hundreds of tickets. It is read to settle an argument about one of them, not
 * scrolled end to end, and rendering every row is how the screen locks up on
 * the phone of the person trying to use it. The count is always stated, so a
 * cap never reads as "that is all of them".
 */
const CAP = 50

/** Column totals for the seller table, rounded once at the end. */
function totalOf(field) {
  const n = matching.value.reduce((t, r) => t + Number(r[field] ?? 0), 0)
  return Math.round(n * 100) / 100
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
  <!--
    DENSE, AND WHAT THAT DOES NOT MEAN.

    This is the screen somebody reads a hundred rows of, so at desk width it
    takes the compact scale: 12.6px type, 34px rows, tighter cards. `.dense` is
    an opt-in class AND a >= 1024px media query, so a seller who follows a link
    into their own money on a phone gets the ordinary 17px screen with 52px
    targets — the compact scale never reaches a thumb. See style.css.

    The modal below inherits it, which is right: a statement opened from a
    dense table that suddenly doubled in size would read as a different app.
  -->
  <div class="dense">
    <!--
      THE SAME SCREEN ANSWERS TWO DIFFERENT QUESTIONS, and it used to ask both
      readers the organiser's one.

      An organiser opens this to find out who still owes the raffle money. A
      seller opens it to find out where THEIR money stands: what the buyers have
      paid them, and what of that has reached the organiser. "What each seller
      owes", to somebody who is one seller, is a page about themselves written
      in the third person — and the figure it leads with is a debt rather than
      an account.
    -->
    <h1>{{ scope === 'mine' ? 'Your money' : 'Money' }}</h1>
    <p class="muted">
      <template v-if="scope === 'mine'">
        What the buyers have handed you, and what of it has reached the organiser.
        Cash you pass on is recorded by whoever receives it.
      </template>
      <template v-else>
        The system records money — it never touches it. Cash is handled in person.
      </template>
    </p>

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
      <h3>
        {{ scope === 'recorded' ? 'What you wrote down'
           : scope === 'mine' ? 'Where your money stands' : 'What each seller owes' }}
      </h3>
      <p v-if="scope === 'recorded'" class="muted small">
        Every sale recorded under your name, and whether the buyer had paid when
        you wrote it down.
      </p>
      <p v-else-if="scope === 'mine'" class="muted small">
        Your tickets written down as sold, less the cash an organiser has confirmed
        receiving from you. Open the line for every dated entry behind it.
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

      <!-- ONE BRANCH, holding the controls and the table together. They were
           two branches of the same v-if for a moment, which meant the controls
           appeared and the table they control did not. -->
      <template v-else-if="showsSellerLines && rows.length">
        <!-- Only once the list is long enough to need them. Three controls
             above a table of four sellers is furniture. -->
        <div v-if="rows.length > 8" class="row wrap gap find" style="margin-top:12px">
          <input v-model="q" class="grow" type="search"
                 placeholder="Find a seller by name, ID or phone">
          <select v-model="sortBy" aria-label="Order by" style="max-width:170px">
            <option v-for="s2 in SORTS" :key="s2.v" :value="s2.v">{{ s2.t }}</option>
          </select>
        </div>

        <p v-if="q && !matching.length" class="note info" style="margin-top:12px">
          Nobody matches “{{ q }}”.
          <button class="linkish" @click="q = ''">Show everybody</button>
        </p>

        <div v-else class="tablewrap" style="margin-top:8px">
        <table>
          <thead>
            <tr>
              <th>Seller</th><th class="num">Books</th><th class="num">Sold</th>
              <th class="num">Should have</th><th class="num">Handed in</th><th class="num">Owes</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="a in shownRows" :key="a.agentId">
              <!--
                THE DESK IS A LINE AND NOT A PERSON. Tickets sold out of books
                nobody holds are counted here, and the row carries no agentId
                because there is nobody to carry one. It used to be clickable
                anyway: the chevron invited a press and the press did nothing,
                which reads as a screen that has stopped responding. It says
                what it is instead.
              -->
              <tr :class="{ deskrow: !a.agentId }"
                  @click="a.agentId && (openSeller = a)">
                <td>
                  <span v-if="a.agentId" class="chev">›</span>
                  {{ a.name || a.agentId }}
                  <span v-if="a.overdueBooks" class="pill bad">{{ a.overdueBooks }} late</span>
                  <span v-if="!a.agentId" class="tiny muted deskwhy">
                    the money went into the tin as each sale was written down, so there is
                    nobody to chase — each ticket says who recorded it
                  </span>
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

            </template>
          </tbody>
          <!--
            COLUMN TOTALS, because a money table without them asks the reader to
            add it up themselves and then argues with the four figures at the top
            of the page. These are summed from the rows on screen, so if they
            ever disagree with the cards above, the disagreement is visible
            rather than hidden in a report nobody can see.
          -->
          <!-- SUMMED OVER EVERYTHING THE FILTER MATCHES, not over the page:
               a total that changes when you turn the page is a total nobody can
               use, and the label says which set it covers. -->
          <tfoot v-if="matching.length > 1">
            <tr>
              <td><b>{{ matching.length }} {{ matching.length === 1 ? 'seller' : 'sellers' }}<template v-if="q"> matching</template></b></td>
              <td class="num">{{ totalOf('booksOut') }}</td>
              <td class="num">{{ totalOf('ticketsSold') }}</td>
              <td class="num"><b>{{ money(totalOf('expected'), currency) }}</b></td>
              <td class="num"><b>{{ money(totalOf('collected'), currency) }}</b></td>
              <td class="num"><b>{{ money(totalOf('outstanding'), currency) }}</b></td>
            </tr>
          </tfoot>
        </table>
        <Pager v-model:page="page" :total="matching.length" :size="PAGE" noun="sellers" />
        </div>
      </template>

      <Empty v-else art="💰" title="Nothing given out yet">
        Once books are with sellers, what they owe shows up here.
      </Empty>
    </div>

    <!-- One seller, on its own, fetched when it opens. The links are built here
         because this screen already holds the rule for whether a number can be
         dialled at all, and that judgement should live in one place. -->
    <SellerMoney v-if="openSeller" :agent="openSeller"
                 :wa="waLink(openSeller)"
                 :tel="isDialable(openSeller.phone) ? telHref(openSeller.phone) : ''"
                 @close="openSeller = null"
                 @record-payment="a => emit('record-payment', a)" />
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

/* Not a person, so not a row that invites a press. */
.deskrow { cursor: default; }
.deskwhy { display: block; max-width: 46ch; margin-top: 2px; }
</style>
