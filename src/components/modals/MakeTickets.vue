<script setup>
/**
 * Creating ticket rows that do not exist yet.
 *
 * Not to be confused with TicketsInPlay, which is the one people will actually
 * use. That moves a line and can be moved back; this writes rows and cannot be
 * undone. The two were briefly the same idea and the words still want to blur,
 * so this screen says MAKE throughout and never "release" — release now means
 * putting existing tickets into play, which is the reversible one.
 *
 * The flow is preview first, always: ask the server what it would do, show the
 * ticket range in words, and only then let them type the number back to
 * confirm. A tickbox would be too easy to tick past; the number they type is
 * the same digit that would have been wrong.
 */
import { ref, computed, watch } from 'vue'
import { state, api, toast, refresh } from '../../lib/store.js'
import Sheet from '../ui/Sheet.vue'

const emit = defineEmits(['close', 'released'])

const target = ref('')
const typed = ref('')
const preview = ref(null)
const problem = ref(null)
const busy = ref(false)
const done = ref(false)

const cfg = computed(() => state.cfg)
// Expansion creates ROWS, so it counts from what has been generated — not from
// what is in play. These are different numbers now: a raffle can have 20,000
// made with 10,000 sellable, and expanding from 10,000 would refuse as
// CANNOT_SHRINK while looking to the reader like it should obviously work.
const current = computed(() => cfg.value?.generatedTickets ?? cfg.value?.totalTickets ?? 0)
const inPlay = computed(() => cfg.value?.totalTickets || 0)
const ceiling = computed(() => cfg.value?.ticketCeiling || 0)
const headroom = computed(() => ceiling.value ? ceiling.value - current.value : null)
const perBook = computed(() => cfg.value?.ticketsPerBook || 10)

/** Whole books only, and never past the ceiling. */
const steps = computed(() =>
  [1000, 2000, 5000].filter(n =>
    (!ceiling.value || current.value + n <= ceiling.value) &&
    // The "all the rest" chip already offers this exact number, and the same
    // figure twice makes people hunt for a difference that is not there.
    n !== headroom.value))

const wanted = computed(() => parseInt(String(target.value).replace(/\D/g, ''), 10) || 0)
const adding = computed(() => Math.max(0, wanted.value - current.value))
const confirmed = computed(() =>
  preview.value && typed.value.replace(/\D/g, '') === String(wanted.value))

function choose(n) { target.value = String(current.value + n) }

// Any change to the target invalidates a preview taken against the old one.
watch(target, () => { preview.value = null; problem.value = null; typed.value = '' })

/** Explains the refusals worth more than their message. */
function explain(err) {
  const d = err.details || {}
  switch (err.code) {
    case 'ABOVE_CEILING':
      return `This raffle is planned to end at ${Number(d.ceiling).toLocaleString()} tickets, ` +
             `and ${Number(d.requested).toLocaleString()} is past that. If the plan really has ` +
             `changed, only the System Admin can raise the ceiling — but check the ` +
             `number first, because making tickets cannot be undone.`
    case 'CANNOT_SHRINK':
      return 'Ticket rows cannot be removed once they exist. This can only go up.'
    case 'NO_CHANGE':
      return 'That is the number you already have.'
    case 'PARTIAL_BOOK':
      return `Tickets come in books of ${perBook.value}, so the total has to be a whole ` +
             `number of books.`
    case 'NUMBERING_TOO_SMALL':
      return 'The ticket numbers do not have enough digits to go that high, and that ' +
             'cannot be changed now that tickets are printed. This raffle cannot grow ' +
             'to that size.'
    case 'SHEET_DRIFT':
      return 'The spreadsheet and the settings disagree about how many tickets exist. ' +
             'Nothing should be released until that is sorted — run verifyIntegrity in ' +
             'the Apps Script editor first.'
    case 'TOO_MANY':
      return 'That is too many to create in one go. Release them in smaller batches.'
    default:
      return err.message
  }
}

async function look() {
  if (!wanted.value) return toast('How many tickets in total?', 'bad')
  busy.value = true
  preview.value = null
  problem.value = null
  try {
    preview.value = await api('expand_tickets', { totalTickets: wanted.value, dryRun: true })
  } catch (err) {
    problem.value = { code: err.code, text: explain(err) }
  } finally {
    busy.value = false
  }
}

async function release() {
  busy.value = true
  try {
    const r = await api('expand_tickets', {
      totalTickets: wanted.value, dryRun: false, confirm: String(wanted.value)
    })
    preview.value = r
    done.value = true
    refresh()
  } catch (err) {
    problem.value = { code: err.code, text: explain(err) }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Sheet title="Make more tickets"
         subtitle="Create new ticket rows that do not exist yet" @close="emit('close')">

    <!-- done -->
    <template v-if="done">
      <div class="ok">
        <div class="tick">✓</div>
        <h2>{{ preview.addedTickets.toLocaleString() }} tickets made</h2>
        <p class="muted">
          {{ preview.firstNewTicket }} to {{ preview.lastNewTicket }},
          in {{ preview.addedBooks }} new {{ preview.addedBooks === 1 ? 'book' : 'books' }}
          ({{ preview.firstNewBook }}–{{ preview.lastNewBook }})
        </p>
      </div>
      <div class="note info">
        These now exist and are in play. Print them before you hand them out.
      </div>
    </template>

    <template v-else>
      <div class="now">
        <div><span>Made so far</span><b>{{ current.toLocaleString() }}</b></div>
        <div v-if="inPlay < current"><span>Of those, in play</span><b>{{ inPlay.toLocaleString() }}</b></div>
        <div v-if="ceiling">
          <span>Planned total</span><b>{{ ceiling.toLocaleString() }}</b>
        </div>
        <div v-if="headroom !== null">
          <span>Still to make</span><b>{{ headroom.toLocaleString() }}</b>
        </div>
      </div>

      <div v-if="headroom === 0" class="note warn">
        Every ticket in the plan has already been made.
      </div>

      <template v-else>
        <div class="note plain">
          This creates tickets that do not exist yet, and cannot be undone. To
          sell fewer of the tickets you already have, use <b>Tickets in play</b>
          instead — that one can be moved back.
        </div>

        <label>How many more?</label>
        <div class="chips">
          <button v-for="n in steps" :key="n" class="chip" @click="choose(n)">
            + {{ n.toLocaleString() }}
          </button>
          <button v-if="headroom" class="chip" @click="choose(headroom)">
            + {{ headroom.toLocaleString() }} (the rest of the plan)
          </button>
        </div>

        <div class="field mt">
          <label for="rt">Or set the new total</label>
          <input id="rt" v-model="target" class="xl" inputmode="numeric"
                 :placeholder="String(current + 1000)">
          <p v-if="adding" class="hint">
            That makes <b>{{ adding.toLocaleString() }}</b> more
            ({{ Math.ceil(adding / perBook) }} books).
          </p>
        </div>

        <div v-if="problem" class="note bad">{{ problem.text }}</div>

        <!-- the preview, which wrote nothing -->
        <div v-if="preview && !problem" class="note info">
          <b>This would make {{ preview.addedTickets.toLocaleString() }} new tickets</b><br>
          {{ preview.firstNewTicket }} to {{ preview.lastNewTicket }},
          making {{ preview.addedBooks }} new
          {{ preview.addedBooks === 1 ? 'book' : 'books' }}
          ({{ preview.firstNewBook }}–{{ preview.lastNewBook }}).
          <div v-if="preview.unchanged" class="small" style="margin-top:6px">
            {{ preview.unchanged }}
          </div>
          <div class="small" style="margin-top:6px">Nothing has been created yet.</div>
        </div>

        <div v-if="preview && !problem" class="field">
          <label for="rc">
            Type <b>{{ wanted.toLocaleString() }}</b> to confirm
          </label>
          <input id="rc" v-model="typed" inputmode="numeric" autocomplete="off"
                 :placeholder="String(wanted)">
          <p class="hint">
            Making tickets cannot be undone — rows can never be removed once they
            exist. Typing the number is the check.
          </p>
        </div>
      </template>
    </template>

    <template #actions>
      <button v-if="done" class="btn primary block" @click="emit('released')">Done</button>
      <template v-else-if="headroom !== 0">
        <button class="btn" @click="emit('close')">Cancel</button>
        <button v-if="!preview" class="btn primary" :disabled="busy || !adding" @click="look">
          {{ busy ? 'Checking…' : 'See what this does' }}
        </button>
        <button v-else class="btn primary" :disabled="busy || !confirmed" @click="release">
          {{ busy ? 'Making…' : 'Make them' }}
        </button>
      </template>
      <button v-else class="btn block" @click="emit('close')">Close</button>
    </template>
  </Sheet>
</template>

<style scoped>
.now {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 12px; margin-bottom: 18px;
}
.now > div { background: var(--surface-2); border-radius: var(--r-sm); padding: 12px 14px; }
.now span { display: block; font-size: .8rem; color: var(--muted); font-weight: 600; }
.now b { font-size: 1.25rem; font-variant-numeric: tabular-nums; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
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
