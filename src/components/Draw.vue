<script setup>
/**
 * Getting ready for the draw.
 *
 * The number that matters is how many sold tickets have nobody's phone on
 * them. Every one of those is a winner you would not be able to find.
 */
import { ref, onMounted, computed, watch } from 'vue'
import { state, api, toast, isSuper, isAdmin, canWrite, drawStamp, go } from '../lib/store.js'
import { moneyShort, money, date } from '../lib/format.js'
/* Was a local function here; the Money statement needs the same one, and two
   copies is how two exports come to disagree about quoting. See lib/csv.js. */
import { downloadCsv } from '../lib/csv.js'
import Empty from './ui/Empty.vue'
import Icon from './ui/Icon.vue'
import Bi from './ui/Bi.vue'

const emit = defineEmits(['open-ticket', 'record-winner', 'edit-prize'])

/*
 * WHERE EACH BLOCKER IS FIXED.
 *
 * Keyed on what the server SENDS, never on the sentence it sends. A blocker's
 * prose is the most rewordable text in the product — somebody will improve
 * "books not yet settled" one afternoon — and a screen that matched on it would
 * quietly stop offering the way out, with nothing failing to say so.
 *
 * 'here' is a real value and deliberately has no button: tickets with nobody's
 * name are fixed on THIS screen, a few inches further down, and sending
 * somebody elsewhere for them would be wrong.
 */
const WHERE = {
  books: 'Open Books',
  money: 'Open Money',
  search: 'Find them',
  approvals: 'Open Approvals',
  prize: 'Add a prize',
}
function fix(where) {
  if (where === 'prize') return emit('edit-prize', null)
  go(where)
}

const ready = ref(null)
const missing = ref(null)
const winners = ref([])
const schedule = ref(null)
// True only when the backend has no list_prizes at all — an older Edge Function,
// or one deployed before the prize schedule was.
const prizesUnavailable = ref(false)
const currency = computed(() => state.cfg?.currency || '')

/*
 * HOW FAR AWAY THE DRAW IS, said before what is in the way.
 *
 * Card 4e leads with a count — "Four things stand between you and drawing" —
 * and lists them underneath. This screen had the heading and the list and
 * nothing in between, so the same facts read differently: a list of four is
 * read as four problems, and "four things stand between you and drawing" is
 * read as four steps left. Same data, and the second is the screen an
 * organiser wants to be looking at the week before a draw.
 *
 * Counted off `problems` with `blockers` behind it, for the reason the panel
 * below already renders both: the Edge Function and the browser bundle deploy
 * by different routes, and a client newer than the function must not announce
 * that nothing is in the way.
 */
const blockerCount = computed(() =>
  ready.value?.problems?.length ?? ready.value?.blockers?.length ?? 0)

/* Spelled out to ten. A numeral at the head of a sentence reads as a quantity
   being measured; a word reads as a number of steps left. */
const WORDS = ['no', 'One', 'Two', 'Three', 'Four', 'Five',
               'Six', 'Seven', 'Eight', 'Nine', 'Ten']
const countWord = (n) => WORDS[n] ?? String(n)

/*
 * WHAT THIS CARD ALREADY KNOWS BEFORE ANYBODY PRESSES ANYTHING.
 *
 * The heading was permanently "Tickets with nobody's name" and the good news —
 * "Every sold ticket has a name and a phone number" — only appeared inside the
 * card AFTER pressing "Show them". But `ready.totals.missingContact` is on
 * this screen already; it is the third figure in the stat row two inches
 * above. So the screen held the answer and still made somebody press a button
 * to be told it, and until they did, a raffle with nothing wrong was headed
 * with the name of a problem it did not have.
 *
 * 'unknown' is a real third state, not a default: before `ready` arrives the
 * card must not assert either, because asserting the bad one is how a screen
 * says something is wrong while it is still loading.
 */
const contactState = computed(() => {
  if (!ready.value) return 'unknown'
  return Number(ready.value.totals?.missingContact ?? 0) ? 'some' : 'none'
})

onMounted(load)
async function load() {
  try {
    ready.value = await api('report_draw_ready', {})
    winners.value = (await api('list_winners', {})).winners
  } catch (err) { toast(err.message, 'bad', err.code) }

  /*
   * THE PRIZE BOARD IS ITS OWN READ, AND ITS OWN FAILURE.
   *
   * Pushing to master deploys the frontend and nothing else — the Edge Function
   * and the migration are both applied by hand. So there is a real window, on a
   * raffle that is already running, where this screen is live against a backend
   * that has never heard of list_prizes. Sharing a try with the two reads above
   * meant that window took the whole screen down: the throw skipped the toast
   * for the reads that HAD worked and left the board on skeletons for ever.
   *
   * Nothing is toasted for the one error that means "not deployed yet". The
   * organiser cannot act on it, it would fire on every visit, and the card
   * below says the same thing in words they can use.
   */
  try {
    schedule.value = await api('list_prizes', {})
    prizesUnavailable.value = false
  } catch (err) {
    prizesUnavailable.value = true
    schedule.value = { prizes: [], types: [], collected: 0 }
    if (err.code !== 'UNKNOWN_ACTION') toast(err.message, 'bad', err.code)
  }
}

// The prize board and the winners list are this screen's own reads, not part of
// the ticket snapshot the poller keeps fresh — and the screen is kept alive, so
// it is never mounted a second time. Without this, saving a prize closed the
// dialog onto a board that did not have it.
watch(drawStamp, load)

/*
 * WHAT IS LEFT TO GIVE, TOTALLED. The board is read out in rank order and the
 * running count beside each line is the thing an announcer actually needs —
 * "three of ten hampers gone" — which nothing could say while the prize was a
 * typed phrase on a winner row.
 */
const prizes = computed(() => schedule.value?.prizes ?? [])
const stillToGive = computed(() =>
  prizes.value.filter(p => p.active !== false).reduce((n, p) => n + p.remaining, 0))

/*
 * Declared value, and only where a figure was actually stated. A prize typed as
 * "nothing declared" comes back as null and is left out of the sum rather than
 * added as a zero — a donated service with no agreed value is worth unstated,
 * and a total that silently counts it as nothing is a total that is wrong in a
 * direction nobody can see.
 */
const declaredValue = computed(() => prizes.value
  .filter(p => p.active !== false && p.unitValue !== null)
  .reduce((n, p) => n + p.unitValue * p.quantity, 0))
const anyUnstated = computed(() =>
  prizes.value.some(p => p.active !== false && p.unitValue === null))

/** Where a winner has got to, in one word. */
function stateOf(w) {
  if (w.forfeited_at || w.forfeitedDate) return { word: 'not collected', pill: 'bad' }
  if (w.claimed) return { word: 'collected', pill: 'ok' }
  if (w.notified) return { word: 'told', pill: 'warn' }
  return { word: 'new', pill: '' }
}

/*
 * A HELPER MOVES THESE, not the owner. A helper rings the winners and a helper
 * is standing there when one turns up for their hamper — the same reasoning
 * that lets a helper record cash at the table.
 */
const busyTicket = ref('')
async function mark(w, patch) {
  const ticket = w.ticket || w.tickets?.number
  busyTicket.value = ticket
  try {
    await api('set_winner_status', { ticketNumber: ticket, ...patch })
    await load()
  } catch (err) { toast(err.message, 'bad', err.code) }
  finally { busyTicket.value = '' }
}

async function loadMissing() {
  missing.value = 'loading'
  try {
    missing.value = await api('report_missing_contact', { limit: 200 })
  } catch (err) { toast(err.message, 'bad', err.code); missing.value = null }
}

async function exportEntries() {
  try {
    const r = await api('export_entries', {})
    const head = ['Ticket', 'Book', 'Buyer', 'Phone', 'Area', 'Seller', 'Can contact']
    const rows = r.entries.map(e => [e.ticket, e.book, e.buyerName, e.buyerPhone,
      e.buyerZone, e.agentName, e.contactable ? 'yes' : 'NO'])
    downloadCsv(`entries-${new Date().toISOString().slice(0, 10)}.csv`, head, rows)
    toast(`${r.count} entries saved`, 'ok')
  } catch (err) { toast(err.message, 'bad', err.code) }
}

</script>

<!--
  Where each blocker is fixed. The server sends a KEY, never a label — a screen
  name matched on the blocker's prose would break the first time somebody
  reworded a sentence, which is the least stable text there is.
-->
<template>
  <div>
    <h1>The draw</h1>

    <p v-if="ready && !ready.ready && blockerCount" class="lede">
      {{ countWord(blockerCount) }}
      {{ blockerCount === 1 ? 'thing stands' : 'things stand' }}
      between you and drawing.
    </p>

    <!--
      WHAT STANDS BETWEEN YOU AND DRAWING — as a list you can act on.

      This was a bullet list of sentences: "books not yet settled (3)", and
      nothing else. The server has always built each blocker with the REASON it
      blocks and now says which screen fixes it, and all of that was being
      thrown away one line before it reached the page. So an organiser was told
      what was wrong, never why it mattered, and left to work out for themselves
      where to go — on the one screen in the app that exists to say "not yet".

      `problems` is the structured list; `blockers` is the flattened one this
      screen used to read. Both are rendered, because the Edge Function and the
      browser bundle deploy by different routes: a client newer than the
      function would otherwise show an empty readiness card, which reads as
      "nothing is wrong" — the most expensive wrong answer this screen has.
    -->
    <div v-if="ready" :class="['note ready', ready.ready ? 'ok' : 'warn']">
      <b class="row">
        <Icon :name="ready.ready ? 'check' : 'clock'" :size="20" />
        <Bi :text="ready.ready ? 'Ready to draw' : 'Not ready yet'" />
      </b>
      <template v-if="ready.problems?.length">
        <div v-for="b in ready.problems" :key="b.what" class="blocker">
          <span class="grow">
            <!--
              THE COUNT STAYS WHERE THE SERVER PUT IT, in brackets after the
              phrase. Leading with it reads better — "3 books not yet settled" —
              right up until the count is one, and the sentence becomes "1
              requests waiting for approval". The phrase is written on the
              server in one grammatical number and no client can re-inflect
              somebody else's prose, so the bracket is the only form that is
              correct for every count.
            -->
            <span class="t">{{ b.what }}<template v-if="b.count"> ({{ b.count }})</template></span>
            <span v-if="b.why" class="d">{{ b.why }}</span>
          </span>
          <button v-if="b.where && b.where !== 'here'" class="btn sm ghost fix"
                  @click="fix(b.where)">{{ WHERE[b.where] }} &rarr;</button>
        </div>
      </template>
      <div v-else v-for="b in ready.blockers" :key="b" class="blocker">
        <span class="t">{{ b }}</span>
      </div>
    </div>
    <div v-else class="skel" style="height:60px;margin-bottom:14px"></div>

    <div v-if="ready" class="stats" style="margin-bottom:16px">
      <div class="stat"><div class="n">{{ ready.totals.eligibleEntries.toLocaleString() }}</div><div class="l">In the draw</div></div>
      <div class="stat"><div class="n">{{ ready.totals.ticketsAvailable.toLocaleString() }}</div><div class="l">Not sold</div></div>
      <!--
        THE ONE STAT HERE THAT IS A FAULT RATHER THAN A FIGURE. A sold ticket
        with no way to reach the buyer is a winner who cannot be told, so it is
        the only one of the four that carries a colour at all — and it carries
        it only when there are any.
      -->
      <div class="stat" :class="{ accent: ready.totals.missingContact }">
        <div class="n" :class="{ bad: ready.totals.missingContact }">
          {{ ready.totals.missingContact }}
        </div>
        <div class="l">No phone number</div>
      </div>
      <div class="stat"><div class="n">{{ moneyShort(ready.totals.outstanding, currency) }}</div><div class="l">Still owed</div></div>
    </div>

    <div class="card">
      <div class="spread">
        <!--
          `missing` — a dashed outline with a slash — not `phoneOff`. The check
          behind this card is name OR phone, and a crossed-out handset says only
          the second, under a heading that says the first.
        -->
        <h3 class="head" style="margin:0">
          <Icon v-if="contactState !== 'unknown'"
                :name="contactState === 'none' ? 'check' : 'missing'" :size="18"
                :class="contactState === 'none' ? 'ok' : 'bad'" />
          {{ contactState === 'none'
             ? 'Every sold ticket has a name and a phone number'
             : "Tickets with nobody's name" }}
        </h3>
        <!--
          "Show", NOT "Show them", AND DISABLED WHEN THERE IS NO THEM.

          Two things were wrong with one control. It said "Show them" beside a
          heading that flips to "Every sold ticket has a name and a phone
          number" — offering to fetch a list the stat directly above has
          already reported as zero. Pressing it spent a request to be told
          nothing, which is the absent-target case: the most expensive state an
          interface has, and here the screen already knew the answer.

          It is DISABLED WITH THE REASON rather than hidden, which is the rule
          permissionui pins for controls generally and is right for the same
          reason: a screen that changes shape between a healthy raffle and a
          faulty one teaches the reader that the control does not exist.

          And it is "Show" because the heading beside it names the thing. A set
          that has not been fetched cannot be named in the button — "Show every
          ticket" would promise a count this screen does not have yet, which is
          why Money's controls name their set and this one does not.
        -->
        <button class="btn sm" :disabled="contactState !== 'some'"
                :title="contactState === 'none'
                  ? 'Every sold ticket already has a name and a phone number'
                  : contactState === 'unknown' ? 'Still counting the raffle up'
                  : 'List the sold tickets with nobody to contact'"
                @click="loadMissing">Show</button>
      </div>
      <!--
        WHY IT MATTERS ALWAYS; WHAT TO DO ONLY WHEN THERE IS SOMETHING TO DO.
        The heading now flips to the good news, and this line sat under it
        still saying "Fix these before the draw" over a raffle with nothing to
        fix. Only visible in a picture: both halves are correct sentences and
        the bug is that one of them is answering a question nobody asked.
      -->
      <p class="muted small">
        A sold ticket with no name or phone is a winner you cannot find.<template
          v-if="contactState === 'some'"> Fix these before the draw.</template>
      </p>

      <div v-if="missing === 'loading'" class="col" style="gap:10px">
        <div v-for="i in 3" :key="i" class="skel"></div>
      </div>
      <template v-else-if="missing">
        <div v-if="!missing.total" class="note ok">Every sold ticket has a name and a phone number.</div>
        <template v-else>
          <p class="small muted">{{ missing.total }} in total<template v-if="missing.total > missing.returned">, showing {{ missing.returned }}</template></p>
          <ul class="list">
            <li v-for="t in missing.tickets" :key="t.ticket">
              <button class="item" @click="emit('open-ticket', t.ticket)">
                <span class="grow">
                  <span class="lead">{{ t.ticket }}</span>
                  <span class="sub">
                    {{ t.book }} · {{ t.buyerName ? 'no phone number' : 'no name' }}
                    <template v-if="t.source === 'settlement'"> · filled in when the book was counted</template>
                  </span>
                </span>
                <span class="pill bad">fix</span>
              </button>
            </li>
          </ul>
        </template>
      </template>
    </div>

    <!-- THE PRIZE BOARD. What is on offer, in the order it is read out, with
         the running count an announcer actually needs beside each line. -->
    <div class="card">
      <div class="spread"><h3 style="margin:0">The prizes</h3>
        <button v-if="isAdmin && !prizesUnavailable" class="btn sm primary"
                @click="emit('edit-prize', null)">
          Add a prize
        </button></div>

      <div v-if="!schedule" class="col" style="gap:10px">
        <div v-for="i in 2" :key="i" class="skel"></div>
      </div>

      <template v-else-if="prizes.length">
        <p class="small muted">
          {{ stillToGive }} still to give.
          <template v-if="declaredValue > 0">
            {{ money(declaredValue, currency) }} declared<template v-if="anyUnstated">,
            plus prizes with no value stated</template>.
          </template>
        </p>
        <ul class="list">
          <li v-for="p in prizes" :key="p.prize_id">
            <button class="item" :disabled="!isAdmin" @click="emit('edit-prize', p)">
              <span class="grow">
                <span class="lead">
                  {{ p.tier }}<template v-if="p.name"> — {{ p.name }}</template>
                </span>
                <span class="sub">
                  <template v-if="p.quantity > 1">{{ p.quantity }} of them · </template>
                  <template v-if="p.unitValue !== null && p.unitValue > 0">
                    {{ money(p.unitValue, currency) }} each<template v-if="p.valuing === 'percent'">
                      ({{ p.value_amount }}% of takings)</template> ·
                  </template>
                  <template v-else>no value stated · </template>
                  {{ p.typeLabel }}
                  <template v-if="p.donor"> · given by {{ p.donor }}</template>
                  <template v-if="p.active === false"> · not being offered</template>
                </span>
              </span>
              <span :class="['pill', p.remaining === 0 ? 'ok' : p.awarded ? 'warn' : '']">
                {{ p.remaining === 0 ? 'all given' : p.awarded
                   ? `${p.remaining} of ${p.quantity} left` : `${p.quantity} to give` }}
              </span>
            </button>
          </li>
        </ul>
      </template>

      <div v-else-if="prizesUnavailable" class="note warn">
        This raffle's server does not have the prize list yet. Everything else on this
        screen is up to date, and a winner can still be recorded against a typed
        prize in the meantime.
      </div>

      <template v-else>
        <p class="muted small">
          No prizes have been set up. Until there are, a winner can only be recorded
          against a typed phrase — so nothing can count what is left to give, and the
          same prize can go out twice.
        </p>
      </template>
    </div>

    <div class="card">
      <div class="spread"><h3 style="margin:0">Winners</h3>
        <button v-if="isSuper" class="btn sm primary" @click="emit('record-winner')">Add a winner</button></div>
      <div v-if="winners.length">
        <div v-for="w in winners" :key="w.ticket || w.tickets?.number" class="winner">
          <div class="grow">
            <b>{{ w.ticket || w.tickets?.number }}</b> — {{ w.prize }}
            <template v-if="w.seq && w.seq > 1"> <span class="tiny muted">(no. {{ w.seq }})</span></template>
            <div class="tiny muted">
              {{ w.buyerName || w.buyer_name || 'no name written down' }}
              <template v-if="w.buyerPhone || w.buyer_phone"> · {{ w.buyerPhone || w.buyer_phone }}</template>
            </div>
            <!-- A helper moves these, which is the whole reason they exist: the
                 pills have been rendered since the beginning and nothing could
                 set them, so every winner read "new" for ever. -->
            <div v-if="canWrite" class="row wrap" style="gap:6px;margin-top:6px">
              <button class="btn sm" :disabled="busyTicket === (w.ticket || w.tickets?.number)"
                      @click="mark(w, { notified: !w.notified })">
                {{ w.notified ? 'Not told after all' : 'Told them' }}
              </button>
              <button class="btn sm" :disabled="busyTicket === (w.ticket || w.tickets?.number)"
                      @click="mark(w, { claimed: !w.claimed })">
                {{ w.claimed ? 'Not collected after all' : 'Collected it' }}
              </button>
              <button v-if="!w.claimed" class="btn sm"
                      :disabled="busyTicket === (w.ticket || w.tickets?.number)"
                      @click="mark(w, { forfeited: !(w.forfeited_at || w.forfeitedDate) })">
                {{ (w.forfeited_at || w.forfeitedDate) ? 'Back in play' : 'Never claimed' }}
              </button>
            </div>
          </div>
          <span :class="['pill', stateOf(w).pill]">{{ stateOf(w).word }}</span>
        </div>
      </div>
      <p v-else class="muted small">No winners yet.</p>
    </div>

    <div v-if="isSuper" class="card">
      <h3>The list of entries</h3>
      <p class="muted small">Every sold and given ticket. Cancelled and unsold ones are left out.</p>
      <button class="btn" @click="exportEntries">Save the list (CSV)</button>
      <p class="hint">This file has everyone's phone number in it. Keep it safe and do not put it online.</p>
    </div>
    <div v-else-if="isAdmin" class="note">
      Only the System Admin can download the entry list or add winners.
    </div>
  </div>
</template>

<style scoped>
/*
 * A blocker is a row, not a bullet. It has three parts — what, why, and the way
 * out — and a `•` in front of a sentence can carry only the first.
 */
.ready .row { gap: 8px; margin-bottom: 4px; }
.blocker {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 8px 0; border-top: 1px solid color-mix(in srgb, currentColor 18%, transparent);
}
.blocker .t { display: block; font-weight: 650; }
/* The reason is quieter than the problem but it is not decoration — it is why
   the organiser should care, in the server's own words. */
.blocker .d { display: block; font-size: .88em; opacity: .85; margin-top: 2px; }
.blocker .fix { flex: 0 0 auto; color: inherit; font-weight: 650; text-decoration: underline; }
.winner { display: flex; align-items: center; gap: 12px; padding: 12px 0;
  border-bottom: 1px solid var(--border); }
.winner:last-child { border-bottom: 0; }

/* How far away the draw is. Sits between the heading and the panel that lists
   what is in the way, so it is the second thing read and not competing with
   either — --muted would make it an aside, and it is the summary. */
.lede { margin: -4px 0 14px; color: var(--text); font-size: 1.05rem; }

/* The icon rides with the words rather than sitting in a column of its own:
   this heading CHANGES with the data, and a mark that moves with the sentence
   it qualifies is read as part of it. */
.head { display: flex; align-items: center; gap: 8px; }
</style>
