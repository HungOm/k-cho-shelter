<script setup>
/**
 * The round report: the whole raffle at one checkpoint, on one page.
 *
 * WHO IT IS FOR. The seller sheet is for the two people at the table. This is
 * for the meeting afterwards, and for the person who has to explain the raffle
 * to whoever paid for it. It is the document somebody prints before the final
 * deadline and puts in front of a committee.
 *
 * THEN AND NOW, SIDE BY SIDE, because that is the whole question. A closed round
 * has frozen figures — taken at the moment the check-in rolled, append-only,
 * unrewritable — and today has live ones. "Round 2 said RM120 and today says
 * RM40" is an answer; either number alone is half of one. The server returns
 * both, which is why this screen does no arithmetic to find the gap.
 *
 * TWO CALLS, NOT ONE, and the seam is deliberate. round_snapshot is per seller
 * and scoped: an organiser sees names, a seller sees their own line, a viewer
 * sees totals without names. report_draw_ready is the raffle's own position and
 * is the same for everybody who may see it. Merging them into one action would
 * mean one scoping rule for two different questions, which is how the wrong
 * person ends up reading a list of names.
 *
 * WHAT IT REFUSES TO BE is a live dashboard. Everything on the Money screen is
 * current by design. This page's value is that it is DATED — printed, filed,
 * and still true about the day it describes a year later.
 */
import { ref, computed, onMounted } from 'vue'
import { api, state } from '../../lib/store.js'
import { isSupabase } from '../../lib/backend.js'
import { date, dateTime, money, plural } from '../../lib/format.js'
import Sheet from '../ui/Sheet.vue'
import Logo from '../ui/Logo.vue'

const props = defineProps({
  /** Which round. Omitted is the most recently closed one. */
  round: Number,
})
const emit = defineEmits(['close'])

const snap = ref(null)
const draw = ref(null)
const problem = ref('')

onMounted(load)

async function load() {
  // A round is frozen into an append-only table the spreadsheet does not have,
  // and a figure anybody can retype is the one thing a snapshot exists to stop
  // being true. So this report is the database backend's, and says so.
  if (!isSupabase) {
    problem.value = 'This report is built from the database backend — the frozen round, and the stub counts the spreadsheet has no columns for. Switch to the Supabase backend to read it.'
    return
  }
  try {
    snap.value = await api('round_snapshot', { round: props.round || 0 })
  } catch (err) {
    problem.value = err.message
    return
  }
  // The raffle's own position, and never at the cost of the page. A viewer or a
  // helper may be refused this one; the per-seller half still prints.
  try { draw.value = await api('report_draw_ready') } catch { /* the lines are the point */ }
}

const cur = computed(() => state.cfg?.currency || '')
const org = computed(() => state.cfg?.orgName || '')
const event = computed(() => state.cfg?.eventName || '')
const project = computed(() => state.cfg?.projectCode || '')
const cash = (n) => money(Number(n || 0), cur.value)

const lines = computed(() => snap.value?.lines || [])

/**
 * Whether this reader gets the seller-by-seller table, NAMED POSITIVELY.
 *
 * Not `scope !== 'totals'`. money.ts carries that warning in as many words —
 * two screens each wrote the negation for themselves and both broke the moment
 * a fourth scope existed, handing a helper the rows the split was made to keep
 * from them. This screen was the third to write it, on the day the warning was
 * already in the file.
 *
 * It did not leak, because the server sends a helper no lines at all. That is
 * the part worth being uncomfortable about: the screen was relying on the
 * server's withholding rather than saying the rule, so it rendered a "Seller by
 * seller" heading over nothing and offered no explanation — and the day the
 * server's answer widened, it would have printed them.
 *
 * Kept in step with showsSellerNames() in money.ts by hand, because the client
 * cannot import the edge function. Both are 'all' or 'mine' and nothing else.
 */
const named = computed(() => ['all', 'mine'].includes(snap.value?.scope))
const nothing = computed(() => !!snap.value && !snap.value.round)

/** Sorted by what is still owed, because that is the list somebody acts on. */
const ordered = computed(() =>
  [...lines.value].sort((a, b) => (b.now?.outstanding ?? 0) - (a.now?.outstanding ?? 0)))

/**
 * THE SERVER'S TOTALS, not a sum of the rows on this page.
 *
 * A viewer is handed totals and NO lines — that is the whole of what the viewer
 * role means — so a page that adds up its own table shows that person a column
 * of zeroes and calls it the raffle. The server has already added them up for
 * exactly the set of sellers this caller may be told about.
 */
const t = computed(() => snap.value?.totals ?? null)

/** Books out is the one figure only the lines carry, and only organisers get lines. */
const booksOut = computed(() =>
  lines.value.reduce((n, l) => n + (l.then?.booksOut ?? 0), 0))

const silent = computed(() => {
  const x = t.value
  return x ? Math.max(0, (x.sellers ?? 0) - (x.then?.reported ?? 0)) : 0
})

/** What came in after the round closed — the number the freezing exists to show. */
const sinceClose = computed(() => {
  const x = t.value
  if (!x) return 0
  return Math.round(((x.now?.collected ?? 0) - (x.then?.collected ?? 0)) * 100) / 100
})

function print() {
  document.body.classList.add('printing')
  window.addEventListener('afterprint', () => document.body.classList.remove('printing'), { once: true })
  window.print()
}
</script>

<template>
  <Sheet :title="snap && snap.round ? `Round ${snap.round} report` : 'Round report'"
         :subtitle="snap && snap.round ? `Frozen when the check-in moved on` : ''"
         @close="emit('close')">

    <p v-if="problem" class="note bad">{{ problem }}</p>

    <div v-else-if="!snap" class="col" style="gap:12px">
      <div v-for="i in 5" :key="i" class="skel"></div>
    </div>

    <!-- No round has closed yet is an answer, and a different one from an
         empty report. -->
    <p v-else-if="nothing" class="note">{{ snap.message }}</p>

    <div v-else class="doc">
      <header class="head">
        <Logo class="mark" />
        <div>
          <h2 class="org">{{ org || event || 'Raffle' }}</h2>
          <p class="sub">
            <template v-if="org && event">{{ event }} · </template>
            Check-in round {{ snap.round }}
            <template v-if="project"> · {{ project }}</template>
          </p>
        </div>
      </header>

      <!-- 1. THE RAFFLE, AT THE CHECKPOINT -->
      <h3>Where the raffle stood</h3>
      <div v-if="t" class="facts">
        <div class="f"><span>Sellers</span><b>{{ t.sellers }}</b></div>
        <div v-if="booksOut" class="f"><span>Books out</span><b>{{ booksOut }}</b></div>
        <div class="f"><span>Expected</span><b>{{ cash(t.then.expected) }}</b></div>
        <div class="f"><span>Collected</span><b>{{ cash(t.then.collected) }}</b></div>
        <div class="f big">
          <span>Outstanding when the round closed</span>
          <b :class="t.then.outstanding > 0 ? 'bad' : 'ok'">{{ cash(t.then.outstanding) }}</b>
        </div>
        <div class="f big">
          <span>Outstanding today</span>
          <b :class="t.now.outstanding > 0 ? 'bad' : 'ok'">{{ cash(t.now.outstanding) }}</b>
        </div>
      </div>
      <p v-if="sinceClose" class="note">
        {{ cash(sinceClose) }} has come in since the round closed.
      </p>
      <p v-if="silent" class="note warn">
        {{ plural(silent, 'seller', 'sellers') }} did not answer this round.
      </p>

      <!-- 2. SELLER BY SELLER -->
      <h3 v-if="named">Seller by seller</h3>
      <table v-if="named && ordered.length" class="tbl">
        <thead>
          <tr>
            <th>Seller</th>
            <th class="n">Books</th>
            <th class="n">Sold</th>
            <th class="n">Owed then</th>
            <th class="n">Owed now</th>
            <th class="c">Reported</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in ordered" :key="l.agentId">
            <td>
              {{ l.name }}
              <span v-if="l.then && l.then.missedBefore" class="muted tiny">
                · missed {{ l.then.missedBefore }}
              </span>
            </td>
            <td class="n">{{ l.then ? l.then.booksOut : '—' }}</td>
            <td class="n">{{ l.then ? l.then.ticketsSold : '—' }}</td>
            <td class="n">{{ l.then ? cash(l.then.outstanding) : '—' }}</td>
            <td class="n" :class="l.now && l.now.outstanding > 0 ? 'bad' : ''">
              {{ l.now ? cash(l.now.outstanding) : '—' }}
            </td>
            <td class="c">{{ l.then && l.then.reported ? 'Yes' : 'No' }}</td>
          </tr>
        </tbody>
      </table>
      <!-- Every reader who is not shown the table is told why, rather than only
           the one scope somebody happened to think of. -->
      <p v-else-if="!named" class="tiny muted">
        Totals only — the seller-by-seller list goes to organisers, and to each
        seller for their own line.
      </p>

      <!-- 3. WHETHER THE DRAW CAN ACTUALLY HAPPEN -->
      <template v-if="draw">
        <h3>Before the draw</h3>
        <div class="facts">
          <div class="f"><span>Tickets sold</span><b>{{ draw.totals.ticketsSold }}</b></div>
          <div v-if="draw.totals.missingContact" class="f">
            <span>Sold with nobody to draw</span><b class="bad">{{ draw.totals.missingContact }}</b>
          </div>
          <div class="f"><span>Expected</span><b>{{ cash(draw.totals.expected) }}</b></div>
          <div class="f"><span>Collected</span><b>{{ cash(draw.totals.collected) }}</b></div>
          <div class="f"><span>Outstanding</span><b>{{ cash(draw.totals.outstanding) }}</b></div>
        </div>
        <ul v-if="draw.blockers && draw.blockers.length" class="blockers">
          <li v-for="(b, i) in draw.blockers" :key="i">{{ b }}</li>
        </ul>
        <p v-else class="note ok">Nothing is standing between this raffle and its draw.</p>
      </template>

      <div class="dates">
        <span v-if="state.cfg && state.cfg.salesCloseDate">
          Selling stops {{ date(state.cfg.salesCloseDate) }}
        </span>
        <span v-if="state.cfg && state.cfg.finalDeadline">
          Everything back by {{ date(state.cfg.finalDeadline) }}
        </span>
        <span v-if="state.cfg && state.cfg.drawDate">Draw {{ date(state.cfg.drawDate) }}</span>
      </div>

      <div class="sign">
        <div><span class="line"></span>Organiser</div>
        <div><span class="line"></span>Checked by</div>
      </div>

      <p class="tiny muted foot">
        Figures for round {{ snap.round }} were frozen when the check-in moved on and
        cannot be changed. “Owed now” is today, and the difference between them is
        what has moved since — which is the reason both are printed.
      </p>
    </div>

    <template #actions>
      <button class="btn" @click="emit('close')">Close</button>
      <button v-if="snap && snap.round" class="btn primary" @click="print()">Print / Save as PDF</button>
    </template>
  </Sheet>
</template>

<style scoped>
.doc { font-size: .95rem; }

.head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.mark { flex: 0 0 auto; }
.org { margin: 0; font-size: 1.15rem; }
.sub { margin: 2px 0 0; font-size: .82rem; color: var(--muted); }

h3 { margin: 18px 0 6px; font-size: .9rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }

.facts { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 18px; }
@media (max-width: 420px) { .facts { grid-template-columns: 1fr; } }
.f { display: flex; justify-content: space-between; gap: 10px; padding: 3px 0; }
.f.big { grid-column: 1 / -1; border-top: 1px solid var(--line, #e3e3e3); margin-top: 4px; padding-top: 6px; font-size: 1.02rem; }
.f span { color: var(--muted); }
.bad { color: var(--bad); }
.ok { color: var(--ok, inherit); }

.tbl { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: .88rem; }
.tbl th, .tbl td { padding: 4px 6px; border-bottom: 1px solid var(--line, #e3e3e3); text-align: left; }
.tbl th { font-weight: 600; color: var(--muted); font-size: .78rem; }
.tbl .n { text-align: right; }
.tbl .c { text-align: center; }

.blockers { margin: 6px 0 0; padding-left: 18px; }
.blockers li { margin: 3px 0; color: var(--bad); }

.dates { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 16px; font-size: .8rem; color: var(--muted); }

.sign { display: flex; gap: 24px; margin-top: 28px; font-size: .82rem; color: var(--muted); }
.sign > div { flex: 1; }
.line { display: block; border-top: 1px solid var(--border, #999); margin-bottom: 4px; height: 24px; }

.tiny { font-size: .78rem; }
.foot { margin-top: 14px; }
</style>
