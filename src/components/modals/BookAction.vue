<script setup>
/**
 * Transfer, bring back, put back on the shelf, or report lost — four shapes of
 * the same job, so one dialog rather than four near-identical ones.
 *
 * "Report lost" is the destructive one: it voids every unsold ticket in the
 * range so they cannot win a draw they were never entered in. That is why it
 * may come back asking for a second person's approval.
 *
 * PUTTING BACK ON THE SHELF WAS MISSING FOR THE WHOLE LIFE OF THIS SCREEN, and
 * the way it was reported is the useful part: a book was counted in with nine
 * of ten sold, and the tenth ticket could never be sold again by anybody. The
 * server had restock_books from the beginning, books.ts documents the lifecycle
 * as Returned -> settle -> restock -> issue again, and the client's own action
 * list names it. Nothing called it. A step of the documented lifecycle existed
 * everywhere except where somebody could press it.
 */
import { ref, computed } from 'vue'
import { state, api, toast, refresh, loadDelta } from '../../lib/store.js'
import { inspectRange, bookNumber } from '../../lib/books.js'
import { money, COUNTED_IN_HELP } from '../../lib/format.js'
import Sheet from '../ui/Sheet.vue'
import FreeRuns from '../ui/FreeRuns.vue'

const props = defineProps({ kind: String })   // 'transfer' | 'return' | 'restock' | 'mark'
const emit = defineEmits(['close', 'done', 'needs-approval'])

const from = ref('')
const to = ref('')
const agentId = ref(state.agents[0]?.id || '')
const status = ref('Lost')
const reason = ref('')
const busy = ref(false)
const blocked = ref(null)

const cfg = computed(() => state.cfg)
/*
 * Which books this action can touch, which is a different set for each.
 *
 * Restock is the one that is not "out": a book goes back on the shelf FROM the
 * desk, having been brought back or counted in. Offering the out-with-a-seller
 * runs for it would name every book it cannot act on and none it can.
 */
const isRelevant = computed(() => props.kind === 'mark'
  ? (b => b.status !== 'Unassigned')
  : props.kind === 'restock'
    ? (b => b.status === 'Returned' || b.status === 'Settled')
    : (b => b.status === 'Out'))
const range = computed(() => inspectRange(from.value, to.value, isRelevant.value))
const count = computed(() => range.value?.count || 0)
const usable = computed(() => !!range.value && !range.value.noneFree)

const TITLES = {
  transfer: ['Pass books to someone else', 'They stay out, just with a different person'],
  return:   ['Mark books brought back', 'Any tickets being held in them go back on the shelf'],
  restock:  ['Put books back on the shelf', 'Unsold tickets in them go back into the office'],
  mark:     ['Report books lost', 'Every unsold ticket in them is cancelled']
}
const title = computed(() => TITLES[props.kind][0])
const subtitle = computed(() => TITLES[props.kind][1])

function useRun(r) {
  from.value = String(r.from)
  to.value = r.count <= 50 ? String(r.to) : ''
}

async function go() {
  if (!from.value) return toast('Which books?', 'bad')
  if (props.kind === 'mark' && !reason.value.trim()) return toast('Please say why', 'bad')

  const books = { fromBook: bookNumber(from.value), toBook: bookNumber(to.value || from.value) }
  const call = {
    transfer: ['transfer_books', { ...books, toAgentId: agentId.value }],
    return:   ['return_books', books],
    restock:  ['restock_books', books],
    mark:     ['set_book_status', { ...books, status: status.value, reason: reason.value.trim(), dryRun: false }]
  }[props.kind]

  busy.value = true
  blocked.value = null
  try {
    const r = await api(call[0], call[1])
    const said = {
      transfer: `${r.transferred} books moved to ${r.toAgent}`,
      return: `${r.returned} brought back` + (r.reservationsReleased ? `, ${r.reservationsReleased} holds released` : ''),
      restock: `${r.restocked} back on the shelf` + (r.skipped ? `, ${r.skipped} skipped` : ''),
      mark: `${r.changed} books marked, ${r.ticketsVoided} tickets cancelled`
    }[props.kind]
    toast(said, 'ok')
    emit('done')
    loadDelta().then(refresh)
  } catch (err) {
    // The server decides this needs a second person; it also wrote the sentence
    // the approver will read, so we hand its own summary straight back.
    if (err.code === 'APPROVAL_REQUIRED') {
      emit('needs-approval', {
        action: call[0], payload: call[1],
        summary: err.details?.summary || err.message,
        detail: err.details?.detail || null
      })
      return
    }
    if (err.code === 'TRANSFER_BLOCKED' && err.details?.blocked) blocked.value = err.details.blocked
    // The server refuses to restock a book somebody still owes on, because that
    // would take the debt off the chase list silently. It names them; so do we,
    // rather than showing one sentence and leaving the organiser to guess which.
    else if (err.code === 'MONEY_STILL_OWED' && err.details?.books) {
      blocked.value = err.details.books.map((b) => ({
        book: b.book,
        reason: `${b.agent || 'somebody'} still owes ${money(b.owed, cfg.value?.currency)} on it — count it in first`,
      }))
    }
    else toast(err.message, 'bad', err.code)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Sheet :title="title" :subtitle="subtitle" @close="emit('close')">
    <div v-if="kind === 'mark'" class="note warn">
      This cancels every unsold ticket in those books so they cannot win. Sold tickets are untouched.
    </div>
    <!-- Said before the press rather than after, because two of these three
         facts surprise people: the sales stay, and the count-in comes undone. -->
    <div v-else-if="kind === 'restock'" class="note info">
      Unsold tickets go back into the office and can be sold again. Tickets already
      sold keep their buyers. If the book was
      <span class="helpword" :title="COUNTED_IN_HELP">counted in</span>, that is undone —
      the figures are cleared and the money recorded with it is reversed on the
      ledger, so nothing is counted twice when the book is closed again.
    </div>

    <!-- Transfer and bring-back only make sense for books already out, so the
         runs shown are the ones out with somebody. Restock is the mirror of
         that: the books it can act on are the ones already back at the desk. -->
    <FreeRuns v-if="kind !== 'mark'" :is-free="isRelevant"
              :label="kind === 'restock' ? 'Back at the desk now' : 'Out now'"
              :noun="kind === 'restock' ? 'brought back or counted in' : 'out with sellers'"
              @pick="useRun" />

    <div class="row">
      <div class="field grow">
        <label for="baf">First book <span class="req">*</span></label>
        <input id="baf" v-model="from" class="xl" inputmode="numeric" placeholder="31">
      </div>
      <div class="field grow">
        <label for="bat">Last book</label>
        <input id="bat" v-model="to" class="xl" inputmode="numeric" placeholder="leave empty for one">
      </div>
    </div>
    <div v-if="range?.allFree" class="note info">
      <b>{{ count }} {{ count === 1 ? 'book' : 'books' }}</b>
      · up to {{ count * cfg.ticketsPerBook }} tickets
    </div>
    <div v-else-if="range" :class="['note', range.noneFree ? 'bad' : 'warn']">
      <b v-if="kind === 'mark'">{{ range.message }}</b>
      <b v-else-if="kind === 'restock'">
        {{ range.freeCount }} of {{ count }} can go back on the shelf — the rest are
        still out with somebody, or on the shelf already.
      </b>
      <b v-else>
        {{ range.freeCount }} of {{ count }} can be moved — the rest are not out with anyone.
      </b>
    </div>

    <div v-if="kind === 'transfer'" class="field">
      <label for="bag">Who is taking them? <span class="req">*</span></label>
      <select id="bag" v-model="agentId">
        <option v-for="a in state.agents.filter(x => x.active)" :key="a.id" :value="a.id">{{ a.name }}</option>
      </select>
    </div>

    <template v-if="kind === 'mark'">
      <div class="field">
        <label for="bas">Mark them as</label>
        <select id="bas" v-model="status">
          <option value="Lost">Lost</option>
          <option value="Void">Cancelled</option>
          <option value="Unassigned">Back in the office</option>
        </select>
      </div>
      <div class="field">
        <label for="bar">Why? <span class="req">*</span></label>
        <input id="bar" v-model="reason" placeholder="e.g. the seller moved away">
        <p class="hint">Kept in the record, so everyone can see what happened.</p>
      </div>
    </template>

    <div v-if="blocked" class="note bad">
      <b>Some books could not be moved:</b>
      <div v-for="b in blocked" :key="b.book" class="tiny">{{ b.book }} — {{ b.reason }}</div>
    </div>

    <template #actions>
      <button class="btn" @click="emit('close')">Cancel</button>
      <button :class="['btn', kind === 'mark' ? 'danger' : 'primary']"
              :disabled="busy || !count || !usable" @click="go">
        {{ busy ? 'Saving…' : title }}
      </button>
    </template>
  </Sheet>
</template>
