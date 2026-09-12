<script setup>
/**
 * How many of the tickets that exist are actually in play.
 *
 * All 20,000 tickets may be printed and sitting in a box, but a raffle that
 * puts them all out at once has nothing left to open with later. This screen
 * moves a single line: everything below it is sellable, everything above it is
 * made and waiting.
 *
 * Deliberately NOT the same screen as creating tickets. That writes rows and
 * cannot be undone; this writes one cell and can be moved back. Putting both
 * behind one button would make the safe thing feel as frightening as the
 * dangerous one — and, worse, the reverse.
 *
 * So there is no type-the-number-back step here. The guard against a mistake
 * is that a mistake is fixable, and the server refuses to hide anything anyone
 * is already relying on.
 */
import { ref, computed, watch } from 'vue'
import { state, api, toast, refresh } from '../../lib/store.js'
import Sheet from '../ui/Sheet.vue'

const emit = defineEmits(['close', 'done', 'make-more'])

const target = ref('')
const problem = ref(null)
const busy = ref(false)
const result = ref(null)

const cfg = computed(() => state.cfg)
const live = computed(() => cfg.value?.totalTickets || 0)
const made = computed(() => cfg.value?.generatedTickets || live.value)
const waiting = computed(() => cfg.value?.heldBackTickets ?? Math.max(0, made.value - live.value))
const perBook = computed(() => cfg.value?.ticketsPerBook || 10)

const wanted = computed(() => parseInt(String(target.value).replace(/\D/g, ''), 10) || 0)

/**
 * Zero when nothing has been typed, NOT when the box is empty.
 *
 * An empty box parses to 0, and 0 minus the 10,000 in play reads as "that holds
 * 10,000 back" — the screen announcing the single most destructive thing it can
 * do, unprompted, before anyone has touched it. With Save live underneath.
 */
const change = computed(() => wanted.value ? wanted.value - live.value : 0)

/** Whole books, and never past what has actually been made. */
const steps = computed(() =>
  [1000, 2000, 5000]
    .filter(n => n <= waiting.value && n !== waiting.value)
    .map(n => ({ n, label: '+ ' + n.toLocaleString() })))

const bookCount = computed(() => Math.ceil(Math.abs(change.value) / perBook.value))

function choose(n) { target.value = String(live.value + n) }

watch(target, () => { problem.value = null })

/**
 * The refusals worth more than their message.
 *
 * The two IN_USE ones carry examples, and the examples are the whole point —
 * "something is in the way" sends somebody hunting, "KS-10230 (sold)" tells
 * them exactly which book to go and find.
 */
function explain(err) {
  const d = err.details || {}
  const eg = (d.examples || []).join(', ')
  switch (err.code) {
    case 'NOT_GENERATED':
      return `Only ${Number(d.generated).toLocaleString()} tickets have been made, so ` +
             `${Number(d.requested).toLocaleString()} cannot go into play. The rows have to ` +
             `be created first — that is a separate step, and it cannot be undone.`
    case 'TICKETS_IN_USE':
      return `Some tickets above that line are already spoken for — ${eg}. Holding them ` +
             `back would hide them rather than undo them, so it is refused. Void or correct ` +
             `those tickets first if they really were a mistake.`
    case 'BOOKS_IN_USE':
      return `Some books above that line are out with sellers or already settled — ${eg}. ` +
             `Take them back first, then hold the tickets back.`
    case 'PARTIAL_BOOK':
      return `A book is one physical object, so the line has to fall between books. ` +
             `Choose a multiple of ${perBook.value}.`
    case 'NO_CHANGE':
      return 'That is the number already in play.'
    default:
      return err.message
  }
}

const canMakeMore = computed(() => problem.value?.code === 'NOT_GENERATED')

async function save() {
  if (!wanted.value) return toast('How many tickets should be in play?', 'bad')
  busy.value = true
  problem.value = null
  try {
    result.value = await api('set_active_tickets', { activeTickets: wanted.value })
    refresh()
  } catch (err) {
    problem.value = { code: err.code, text: explain(err) }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Sheet title="Tickets in play"
         subtitle="How many of the printed tickets can be sold right now"
         @close="emit('close')">

    <!-- done -->
    <template v-if="result">
      <div class="ok">
        <div class="tick">✓</div>
        <h2 v-if="result.released">
          {{ result.released.toLocaleString() }} more tickets in play
        </h2>
        <h2 v-else>
          {{ result.pulledBack.toLocaleString() }} tickets held back
        </h2>
        <p class="muted">
          {{ result.firstTicket }} to {{ result.lastTicket }} —
          {{ result.activeBooks.toLocaleString() }}
          {{ result.activeBooks === 1 ? 'book' : 'books' }} can be given out.
        </p>
      </div>
      <div v-if="result.heldBack" class="note info">
        {{ result.heldBack.toLocaleString() }} tickets are still made and waiting.
        You can put them into play whenever you want.
      </div>
    </template>

    <template v-else>
      <div class="now">
        <div class="hi"><span>In play now</span><b>{{ live.toLocaleString() }}</b></div>
        <div><span>Made and waiting</span><b>{{ waiting.toLocaleString() }}</b></div>
        <div><span>Printed in total</span><b>{{ made.toLocaleString() }}</b></div>
      </div>

      <div v-if="!waiting && live >= made" class="note info">
        Every ticket that has been made is already in play. To go further, the
        tickets have to be created first.
      </div>

      <label>Put more into play</label>
      <div class="chips">
        <button v-for="s in steps" :key="s.n" class="chip" @click="choose(s.n)">
          {{ s.label }}
        </button>
        <button v-if="waiting" class="chip" @click="choose(waiting)">
          + {{ waiting.toLocaleString() }} (all of them)
        </button>
        <button v-if="!waiting" class="chip" @click="emit('make-more')">
          Make more tickets
        </button>
      </div>

      <div class="field mt">
        <label for="ap">Or set how many are in play</label>
        <input id="ap" v-model="target" class="xl" inputmode="numeric"
               :placeholder="String(live)">
        <p v-if="change > 0" class="hint">
          That puts <b>{{ change.toLocaleString() }}</b> more into play
          ({{ bookCount }} {{ bookCount === 1 ? 'book' : 'books' }}).
        </p>
        <p v-else-if="change < 0" class="hint warnish">
          That holds <b>{{ Math.abs(change).toLocaleString() }}</b> back
          ({{ bookCount }} {{ bookCount === 1 ? 'book' : 'books' }}).
          They stay printed, and you can put them back at any time.
          Anything already sold or out with a seller will stop this.
        </p>
      </div>

      <div v-if="problem" class="note bad">
        {{ problem.text }}
        <div v-if="canMakeMore" style="margin-top:10px">
          <button class="btn sm" @click="emit('make-more')">Make more tickets</button>
        </div>
      </div>

      <div class="note plain">
        This only moves a line. Nothing is deleted, and moving it back puts the
        tickets straight back into play.
      </div>
    </template>

    <template #actions>
      <button v-if="result" class="btn primary block" @click="emit('done')">Done</button>
      <template v-else>
        <button class="btn" @click="emit('close')">Cancel</button>
        <button class="btn primary" :disabled="busy || !change" @click="save">
          {{ busy ? 'Saving…' : 'Save' }}
        </button>
      </template>
    </template>
  </Sheet>
</template>

<style scoped>
.now {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 12px; margin-bottom: 18px;
}
.now > div { background: var(--surface-2); border-radius: var(--r-sm); padding: 12px 14px; }
.now > div.hi { background: var(--brand-soft); }
.now span { display: block; font-size: .8rem; color: var(--muted); font-weight: 600; }
.now b { font-size: 1.25rem; font-variant-numeric: tabular-nums; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.hint.warnish { color: var(--warn-ink, var(--muted)); }
.note.plain { background: var(--surface-2); color: var(--muted); }
.ok { text-align: center; padding: 18px 0 10px; }
.ok .tick {
  width: 72px; height: 72px; margin: 0 auto 14px; border-radius: 50%;
  background: var(--ok-soft); color: var(--ok);
  display: grid; place-items: center; font-size: 2.2rem; font-weight: 800;
  animation: pop-in .38s var(--ease);
}
@keyframes pop-in { from { transform: scale(.4); opacity: 0 } }
</style>
