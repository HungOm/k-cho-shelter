<script setup>
/**
 * Cash handed in, written down at the moment it changes hands.
 *
 * THIS IS THE THING THAT WAS MISSING. Settling a book was the only way to
 * record money: whole book, organiser only, and it closes the book. So a seller
 * who brought half of it, or who is keeping the book to sell the rest, could
 * not be recorded at all — and the organiser's only choices were to wait or to
 * close a book that is not finished.
 *
 * SETTLING IS STILL SEPARATE, deliberately. This records that cash arrived.
 * Settling is where a book is counted and the figures are declared. Somebody
 * handing over RM200 against six books has not settled anything, and a screen
 * that treated it as a settlement would close books nobody has counted.
 */
import { ref, computed } from 'vue'
import { api, state, toast, refresh, isAdmin } from '../../lib/store.js'
import { money } from '../../lib/format.js'
// Aliased: the ref below is also called bookNumber.
import { storedBook, bookNumber as padBook } from '../../lib/books.js'
import Sheet from '../ui/Sheet.vue'

const props = defineProps({ seller: Object })
const emit = defineEmits(['close', 'saved'])

const amount = ref('')
const note = ref('')
const bookNumber = ref('')
/** The example follows this raffle's numbering instead of guessing at it. */
const bookHint = computed(() => padBook('42') || 'Book-0042')
const busy = ref(false)

/*
 * ONE NAME FOR THIS ATTEMPT, KEPT UNTIL IT LANDS.
 *
 * A write that times out may well have landed — that is why the app says
 * "Checking what went through" rather than "failed" — and the next thing that
 * happens is a volunteer with one bar of signal pressing the button again.
 * Cash has no natural key: RM60 twice for one seller is indistinguishable from
 * two genuine RM60 payments, so the server cannot tell a retry from a second
 * handful of notes unless the caller says which it is.
 *
 * Generated once and REUSED until a save succeeds, which is the whole
 * mechanism: the same key is the same payment, a new key is new money. Cleared
 * on success so the next payment from the same form is not read as a replay of
 * this one.
 *
 * randomUUID is not everywhere — an old Android WebView, or any page not served
 * over HTTPS — so the fallback is a plain random string. It has to be unique
 * among one volunteer's retries, not across the universe.
 */
const key = ref('')
function attempt() {
  if (!key.value) {
    key.value = globalThis.crypto?.randomUUID?.()
      || `k-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }
  return key.value
}
const problem = ref('')

const currency = computed(() => state.cfg?.currency || '')
const owed = computed(() => Number(props.seller?.outstanding || 0))

/** Prefilled with what they owe, because that is what usually arrives. */
function fillAll() { amount.value = String(owed.value.toFixed(2)) }

const left = computed(() => {
  const n = Number(amount.value)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round((owed.value - n) * 100) / 100
})

async function save() {
  const n = Number(amount.value)
  if (!Number.isFinite(n) || n <= 0) {
    problem.value = 'How much was handed in?'
    return
  }
  busy.value = true
  problem.value = ''
  try {
    const r = await api('record_payment', {
      agentId: props.seller.agentId,
      amount: n,
      note: note.value.trim(),
      // The spelling the raffle stores, not the one that was typed: the
      // server matches books.number exactly (money.ts), so "42" and
      // "Book-42" were refused as books that do not exist.
      bookNumber: storedBook(bookNumber.value) || bookNumber.value.trim(),
      clientKey: attempt(),
    })
    // "Already recorded" and "recorded" have to read differently, or somebody
    // who pressed twice counts the cash again to find out which it was.
    toast(r.replayed
      ? `${money(r.amount, currency.value)} was already recorded`
      : `${money(r.amount, currency.value)} recorded`, 'ok')
    key.value = ''
    emit('saved')
    refresh()
  } catch (err) {
    problem.value = err.message
  } finally { busy.value = false }
}
</script>

<template>
  <Sheet :title="`Money from ${seller?.name || 'seller'}`"
         subtitle="Recorded as handed in. It does not settle or close a book."
         @close="emit('close')">

    <p class="muted small lead">
      They owe <b class="data">{{ money(owed, currency) }}</b> across
      {{ seller?.booksOut || 0 }} {{ seller?.booksOut === 1 ? 'book' : 'books' }} still out.
    </p>

    <div class="field">
      <label for="pa">How much <span class="req">*</span></label>
      <div class="row">
        <input id="pa" v-model="amount" type="number" inputmode="decimal" min="0"
               step="0.01" class="xl" placeholder="0.00" autofocus>
        <button v-if="owed > 0" class="btn sm" @click="fillAll">All of it</button>
      </div>
      <p v-if="left !== null" class="hint">
        <template v-if="left > 0">{{ money(left, currency) }} would still be owed.</template>
        <template v-else-if="left === 0">That clears what they owe.</template>
        <template v-else>That is {{ money(-left, currency) }} more than they owe — check it.</template>
      </p>
    </div>

    <div class="field">
      <label for="pb">Against a book <span class="opt">— not required</span></label>
      <input id="pb" v-model="bookNumber" autocomplete="off" :placeholder="bookHint">
      <p class="hint">
        Leave empty if it is just cash handed over. Money that arrives before
        anybody counts a book belongs to the seller, not yet to a book.
      </p>
    </div>

    <div class="field">
      <label for="pn">Note <span class="opt">— not required</span></label>
      <input id="pn" v-model="note" autocomplete="off" placeholder="Handed in at the hall">
    </div>

    <div v-if="problem" class="note bad">{{ problem }}</div>

    <p v-if="!isAdmin" class="muted tiny">
      Recorded under your name. Only an organiser can undo it.
    </p>

    <template #actions>
      <button class="btn" @click="emit('close')">Cancel</button>
      <button class="btn primary" :disabled="busy" @click="save">
        {{ busy ? 'Saving…' : 'Record it' }}
      </button>
    </template>
  </Sheet>
</template>

<style scoped>
.lead { margin: 0 0 14px; }
.row { display: flex; gap: 8px; align-items: center; }
.row input { flex: 1; }
</style>
