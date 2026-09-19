<script setup>
/**
 * The check-in report: one seller, one round, on paper, signed.
 *
 * WHAT IT IS FOR. A checkpoint is two people agreeing about where things stand,
 * and until now the agreement lived in somebody's memory of a conversation in a
 * car park. This is the page they both look at: what the seller brought, what
 * the system has, and — the line that did not exist before — whether the paper
 * adds up. It prints, and the printed copy is the one that gets signed.
 *
 * DECLARED AND RECORDED ARE NEVER MERGED. The left of every pair is what the
 * seller said while standing there; the right is what somebody typed into the
 * app. Merging them into a single "sold" figure destroys the only thing on this
 * page worth printing, which is the gap between the two. A gap is not an
 * accusation — it is most often sales that have not been entered yet — but it
 * is always something to do TODAY, while both people are here.
 *
 * PDF IS PRINT, and that is a decision rather than a shortcut. The browser's own
 * print dialog saves as PDF on every phone and laptop this raffle runs on, it
 * needs no library, no server, no fonts to ship and no font to go missing; and
 * the same stylesheet that makes it a PDF makes it an actual sheet of paper,
 * which is what a signature needs. The receipt learned this first.
 *
 * NOTHING IS DECIDED HERE. Every number comes from one server call so the whole
 * page is one measurement — a sheet whose money was read at 10:04 and whose
 * books at 10:06 can disagree with itself about a book settled at 10:05.
 */
import { ref, computed, onMounted } from 'vue'
import { api, state } from '../../lib/store.js'
import { date, dateTime, money, plural } from '../../lib/format.js'
import Sheet from '../ui/Sheet.vue'
import Logo from '../ui/Logo.vue'

const props = defineProps({
  /** Whose sheet. Omitted for a seller printing their own — the server decides. */
  agentId: String,
  /** Which round. Omitted is the live one. */
  round: Number,
})
const emit = defineEmits(['close'])

const r = ref(null)
const problem = ref('')

onMounted(load)

async function load() {
  /*
   * THE SPREADSHEET BACKEND CANNOT ANSWER THIS, and saying so beats letting it
   * refuse. The two columns this page is built on and the frozen round behind
   * it exist only in the database; asking Apps Script would come back as an
   * unknown action, which reads to a volunteer as the app being broken rather
   * than as a report that lives somewhere else.
   */
  try {
    r.value = await api('check_in_sheet', {
      agentId: props.agentId || '', round: props.round || 0,
    })
  } catch (err) {
    // Stays open and says what happened, for the same reason the history sheet
    // does: a panel that dismisses itself cannot be told apart from a crash.
    problem.value = err.message
  }
}

const cur = computed(() => r.value?.currency || state.cfg?.currency || '')
const org = computed(() => state.cfg?.orgName || '')
const event = computed(() => state.cfg?.eventName || '')
const project = computed(() => state.cfg?.projectCode || '')

/** RM 0.00 rather than a bare number, everywhere money appears on paper. */
const cash = (n) => money(Number(n || 0), cur.value)

/**
 * The paper line, in the words somebody reads out.
 *
 * Positive is the only direction that is a question. Negative means more paper
 * came in than the returned books held, which is what a seller mid-book does
 * every time they hand over stubs from a book they are keeping.
 */
const paperLine = computed(() => {
  const p = r.value?.paper
  if (!p || !r.value?.declared) return ''
  if (p.unaccounted > 0) {
    return `${plural(p.unaccounted, 'ticket is', 'tickets are')} not accounted for.`
  }
  if (p.unaccounted < 0) {
    return `${plural(-p.unaccounted, 'ticket', 'tickets')} more than the returned books held — ` +
           'stubs out of a book still being sold from.'
  }
  return 'Every ticket in the books handed back is accounted for.'
})

const paperTone = computed(() => {
  const u = r.value?.paper?.unaccounted ?? 0
  return u > 0 ? 'bad' : (u < 0 ? '' : 'ok')
})

/** What is left to chase, said once, at the top, where it is read. */
const headline = computed(() => {
  const d = r.value
  if (!d) return ''
  if (!d.declared) return 'Has not reported this round.'
  const owed = d.recorded.outstanding
  if (owed > 0) return `${cash(owed)} still to come in.`
  if (owed < 0) return `${cash(-owed)} more has come in than the books account for.`
  return 'Nothing outstanding.'
})

function print() {
  document.body.classList.add('printing')
  window.addEventListener('afterprint', () => document.body.classList.remove('printing'), { once: true })
  window.print()
}
</script>

<template>
  <Sheet :title="r ? `${r.agent.name} — check-in report` : 'Check-in report'"
         :subtitle="r ? `Round ${r.round}${r.dueAt ? ` — due ${date(r.dueAt)}` : ''}` : ''"
         @close="emit('close')">

    <p v-if="problem" class="note bad">{{ problem }}</p>

    <div v-else-if="!r" class="col" style="gap:12px">
      <div v-for="i in 5" :key="i" class="skel"></div>
    </div>

    <div v-else class="doc">
      <!-- The letterhead only paper needs. On screen the app is already
           branded; on a page that leaves the building it has to say who is
           asking, or it is an anonymous demand for money. -->
      <header class="head">
        <Logo class="mark" />
        <div>
          <h2 class="org">{{ org || event || 'Raffle' }}</h2>
          <p class="sub">
            <template v-if="org && event">{{ event }} · </template>
            Check-in report, round {{ r.round }}
            <template v-if="project"> · {{ project }}</template>
          </p>
        </div>
      </header>

      <div class="who">
        <div>
          <b>{{ r.agent.name }}</b>
          <span v-if="r.agent.zone" class="muted"> · {{ r.agent.zone }}</span>
          <span v-if="r.agent.phone" class="muted"> · {{ r.agent.phone }}</span>
        </div>
        <div class="muted small">
          Reported by {{ r.dueAt ? date(r.dueAt) : 'this round' }}<template v-if="r.declared">,
          recorded {{ dateTime(r.declared.reportedAt) }} by {{ r.declared.recordedBy }}</template>
        </div>
      </div>

      <p :class="['headline', r.recorded.outstanding > 0 ? 'owed' : '']">{{ headline }}</p>

      <!-- 1. CUSTODY -->
      <h3>Books</h3>
      <div class="facts">
        <div class="f"><span>Held when they reported</span><b>{{ r.paper.booksAtHand }}</b></div>
        <div class="f"><span>Brought back</span><b>{{ r.paper.booksBack }}</b></div>
        <div class="f"><span>Still out with them</span><b>{{ Math.max(0, r.paper.booksAtHand - r.paper.booksBack) }}</b></div>
        <div v-if="r.recorded.booksOverdue" class="f">
          <span>Past their due date</span><b class="bad">{{ r.recorded.booksOverdue }}</b>
        </div>
      </div>

      <table v-if="r.books.length" class="tbl">
        <thead>
          <tr>
            <th>Book</th><th>Tickets</th><th class="n">Sold</th>
            <th class="n">Left</th><th class="n">Held</th><th class="n">Due</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in r.books" :key="b.number">
            <td>{{ b.number }}</td>
            <td class="muted">{{ b.firstTicket }}–{{ b.lastTicket }}</td>
            <td class="n">{{ b.sold }}</td>
            <td class="n">{{ b.available }}</td>
            <td class="n">{{ b.reserved || '' }}</td>
            <td class="n" :class="b.daysOverdue > 0 ? 'bad' : ''">
              {{ b.due ? date(b.due) : '—' }}
            </td>
          </tr>
        </tbody>
      </table>

      <!-- 2. THE PAPER -->
      <h3>Tickets counted</h3>
      <div class="facts">
        <div class="f">
          <span>Tickets they were carrying</span>
          <b>{{ r.paper.ticketsInHand }}</b>
        </div>
        <div class="f"><span>In the books handed back</span><b>{{ r.paper.inBooksHandedBack }}</b></div>
        <div class="f"><span>Stubs handed in</span><b>{{ r.paper.stubsReturned }}</b></div>
        <div class="f"><span>Unsold tickets handed back</span><b>{{ r.paper.unsoldReturned }}</b></div>
        <div class="f"><span>Still out with them</span><b>{{ r.paper.stillWithThem }}</b></div>
      </div>
      <p v-if="r.declared" :class="['note', paperTone]">{{ paperLine }}</p>
      <p v-else class="note">
        Nothing counted yet — this sheet is the one to take to the table.
      </p>

      <!-- 3. DECLARED vs RECORDED -->
      <h3>What was said, and what is on record</h3>
      <table class="tbl pair">
        <thead>
          <tr><th></th><th class="n">They said</th><th class="n">On record</th><th class="n">Difference</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Tickets sold</td>
            <td class="n">{{ r.gap ? r.gap.stubsToDate : '—' }}</td>
            <td class="n">{{ r.recorded.ticketsSold }}</td>
            <td class="n" :class="r.gap && r.gap.tickets ? 'bad' : ''">
              {{ r.gap ? (r.gap.tickets > 0 ? '+' + r.gap.tickets : r.gap.tickets) : '—' }}
            </td>
          </tr>
          <tr>
            <td>Money handed over</td>
            <td class="n">{{ r.gap ? cash(r.gap.paidToDate) : '—' }}</td>
            <td class="n">{{ cash(r.recorded.collected) }}</td>
            <td class="n" :class="r.gap && r.gap.money ? 'bad' : ''">
              {{ r.gap ? cash(r.gap.money) : '—' }}
            </td>
          </tr>
        </tbody>
      </table>
      <p class="tiny muted">
        Both columns are running totals for the whole raffle, so they are the
        same measurement twice. A difference is usually sales not yet entered —
        it is not a count of anything missing.
      </p>

      <!-- 4. MONEY -->
      <h3>Money</h3>
      <div class="facts">
        <div class="f"><span>Value of sales on their books</span><b>{{ cash(r.recorded.expected) }}</b></div>
        <div class="f"><span>Received</span><b>{{ cash(r.recorded.collected) }}</b></div>
        <div class="f big">
          <span>Still outstanding</span>
          <b :class="r.recorded.outstanding > 0 ? 'bad' : 'ok'">{{ cash(r.recorded.outstanding) }}</b>
        </div>
        <div v-if="r.declared" class="f">
          <span>Handed over at this check-in</span><b>{{ cash(r.declared.amountPaid) }}</b>
        </div>
      </div>

      <!-- The one fault on this page that cannot be repaired after the draw. -->
      <p v-if="r.recorded.missingContact" class="note bad">
        {{ plural(r.recorded.missingContact, 'sold ticket has', 'sold tickets have') }}
        nobody written down as the buyer. Those entries cannot be drawn. Get the
        names and numbers now — after the draw there is no way to fix it.
      </p>

      <!-- 5. STANDING -->
      <div v-if="r.standing.missedBefore || r.standing.daysLate" class="facts">
        <div v-if="r.standing.daysLate" class="f">
          <span>Days past the check-in date</span><b>{{ r.standing.daysLate }}</b>
        </div>
        <div v-if="r.standing.missedBefore" class="f">
          <span>Earlier rounds not answered</span><b>{{ r.standing.missedBefore }}</b>
        </div>
      </div>

      <p v-if="r.declared && r.declared.note" class="said">
        “{{ r.declared.note }}”
      </p>

      <!-- 6. WHAT THE ROUND SAID WHEN IT CLOSED -->
      <div v-if="r.frozen" class="frozen">
        <h3>What this round said when it closed</h3>
        <div class="facts">
          <div class="f"><span>Books out</span><b>{{ r.frozen.booksOut }}</b></div>
          <div class="f"><span>Tickets sold</span><b>{{ r.frozen.ticketsSold }}</b></div>
          <div class="f"><span>Outstanding then</span><b>{{ cash(r.frozen.outstanding) }}</b></div>
          <div class="f"><span>Outstanding now</span><b>{{ cash(r.recorded.outstanding) }}</b></div>
        </div>
        <p class="tiny muted">
          Frozen {{ dateTime(r.frozen.takenAt) }} when the round was closed. Figures
          since then have moved for the ordinary reason: money came in.
        </p>
      </div>

      <div class="dates">
        <span v-if="r.salesCloseDate">Selling stops {{ date(r.salesCloseDate) }}</span>
        <span v-if="r.finalDeadline">Everything back by {{ date(r.finalDeadline) }}</span>
        <span>Reports every {{ r.cadence }}</span>
      </div>

      <!-- Two signatures, because the page exists to record an agreement. -->
      <div class="sign">
        <div><span class="line"></span>Seller — {{ r.agent.name }}</div>
        <div><span class="line"></span>Organiser</div>
      </div>

      <p class="tiny muted foot">
        Printed {{ dateTime(r.takenAt) }} by {{ r.printedBy }}.
        <template v-if="!r.roundClosed">
          Round {{ r.round }} is still open, so these figures are today's.
        </template>
      </p>
    </div>

    <template #actions>
      <button class="btn" @click="emit('close')">Close</button>
      <button v-if="r" class="btn primary" @click="print()">Print / Save as PDF</button>
    </template>
  </Sheet>
</template>

<style scoped>
.doc { font-size: .95rem; }

.head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.mark { flex: 0 0 auto; }
.org { margin: 0; font-size: 1.15rem; }
.sub { margin: 2px 0 0; font-size: .82rem; color: var(--muted); }

.who { padding: 8px 0 10px; border-bottom: 1px solid var(--border); }
.small { font-size: .82rem; }

.headline { margin: 12px 0 4px; font-size: 1.05rem; font-weight: 600; }
.headline.owed { color: var(--bad); }

h3 { margin: 18px 0 6px; font-size: .9rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }

.facts { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 18px; }
@media (max-width: 420px) { .facts { grid-template-columns: 1fr; } }
.f { display: flex; justify-content: space-between; gap: 10px; padding: 3px 0; }
.f.big { grid-column: 1 / -1; border-top: 1px solid var(--border); margin-top: 4px; padding-top: 6px; font-size: 1.05rem; }
.f span { color: var(--muted); }
.bad { color: var(--bad); }
.ok { color: var(--ok, inherit); }

.tbl { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: .88rem; }
.tbl th, .tbl td { padding: 4px 6px; border-bottom: 1px solid var(--border); text-align: left; }
.tbl th { font-weight: 600; color: var(--muted); font-size: .78rem; }
.tbl .n { text-align: right; }
.pair td:first-child { color: var(--muted); }

.said { margin: 10px 0 0; padding-left: 10px; border-left: 2px solid var(--border); font-style: italic; }

.frozen { margin-top: 10px; padding-top: 4px; border-top: 1px dashed var(--border); }

.dates { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 16px; font-size: .8rem; color: var(--muted); }

.sign { display: flex; gap: 24px; margin-top: 28px; font-size: .82rem; color: var(--muted); }
.sign > div { flex: 1; }
.line { display: block; border-top: 1px solid var(--border, #999); margin-bottom: 4px; height: 24px; }

.tiny { font-size: .78rem; }
.foot { margin-top: 14px; }
</style>
