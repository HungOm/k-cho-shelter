<script setup>
/**
 * The handover receipt.
 *
 * Without a signed record of what went out, "I never got those books" is an
 * argument you cannot win.
 */
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { api, toast, state } from '../../lib/store.js'
import { money, date } from '../../lib/format.js'
import { waNumber, isDialable } from '../../lib/search.js'
import Sheet from '../ui/Sheet.vue'
import Logo from '../ui/Logo.vue'

const props = defineProps({ agentId: String })
const emit = defineEmits(['close'])
const r = ref(null)
const nothing = ref('')
const ack = ref(null)
const acking = ref(false)

/**
 * WHOSE WORD THIS PIECE OF PAPER IS.
 *
 * The receipt has always had two signature lines on it, which is the right
 * idea on paper and nothing at all in the record: the printed sheet goes in a
 * drawer, and what the system holds is still only the organiser saying they
 * gave the books out. "I never got those books" is an argument you cannot win
 * with a document you printed yourself.
 *
 * Two ways to close that, and they are NOT the same strength, so the screen
 * must not let them look the same:
 *
 *   the seller, signed in, taps it       — their own word, and only they can give it
 *   an organiser records a signed paper  — better than nothing, still the organiser typing
 *
 * Which one this tap produces is decided by the server from who is asking, not
 * by anything sent from here. This component only has to be honest about which
 * one it is about to make, so nobody taps "confirm" believing they are
 * recording something stronger than they are.
 */
const isTheSeller = computed(() => !!state.user?.agentId && state.user.agentId === props.agentId)
const unconfirmed = computed(() => ack.value?.unconfirmed ?? [])
const canConfirm = computed(() =>
  !!ack.value && unconfirmed.value.length > 0 && !nothing.value)

async function loadAck() {
  // Recording WHOSE word a confirmation is — the seller's own tap, against an
  // organiser typing that they saw a signed paper — needs a row nobody can edit
  // afterwards. That is why it is a table and not a column.
  try { ack.value = await api('acknowledged_books', { agentId: props.agentId }) } catch { ack.value = null }
}

async function confirm() {
  if (acking.value) return
  acking.value = true
  try {
    const got = await api('acknowledge_books', { agentId: props.agentId })
    toast(got.method === 'app'
      ? `You confirmed ${got.confirmed.length} ${got.confirmed.length === 1 ? 'book' : 'books'}`
      : `Recorded: ${r.value?.agent?.name || 'the seller'} signed for ${got.confirmed.length}`, 'ok')
    await loadAck()
  } catch (e) {
    toast(e.message, 'bad', e.code)
  } finally { acking.value = false }
}

/*
 * A sheet that closes itself is the worst answer to "why is there no receipt".
 *
 * Both of these used to toast and emit('close'). The sheet opened, showed its
 * skeletons, and vanished — and a toast is gone in seconds, so what the person
 * is left with is a dialog that dismissed itself for no stated reason. That is
 * indistinguishable from a bug, and it was reported as one.
 *
 * It stays open and says which of the two happened, because they need different
 * things: nothing to print is a fact about the seller, and a failed call is a
 * reason to try again.
 */
onMounted(async () => { await load(); await loadAck() })

async function load() {
  try {
    const got = await api('handover_receipt', { agentId: props.agentId })
    if (!got.books?.length) {
      /*
       * NAMED, because "this seller" cannot be checked.
       *
       * The reply resolves the seller before it looks at their books, so the
       * name is always here — and without it this message is unanswerable. A
       * raffle with two sellers gives you a dialog saying somebody is holding
       * nothing, on a screen that does not say who, opened from a row you may
       * have mis-tapped. The reader cannot tell a correct empty sheet from the
       * wrong person, and the honest reaction is to assume the app is broken.
       *
       * It also says what to do instead, because "nothing to print" is only
       * half an answer to somebody who came here wanting a sheet of paper.
       */
      const who = got.agent?.name || 'That seller'
      nothing.value = `${who} is not holding any books right now, so there is nothing to ` +
        'hand over and nothing to print. A receipt lists what somebody has in their hands ' +
        'at this moment — once the books are counted back in, they leave it. To see what ' +
        'they have had in the past, open a book and look at where it has been.'
      return
    }
    r.value = got
  } catch (err) {
    toast(err.message, 'bad', err.code)
    nothing.value = err.message
  }
}

/**
 * The books listed here are whatever the seller holds *right now*, so this
 * sheet can be produced again any time — a lost paper is not a lost record.
 * But a reprint must never pass for the original handover, so it carries the
 * day the books actually went out, not the day someone hit Print.
 */
const givenOn = computed(() => {
  if (!r.value) return null
  const days = r.value.books.map(b => b.issued).filter(Boolean).sort()
  return days[0] || r.value.generatedAt
})

/*
 * Fails CLOSED, because the stamp is a claim about the paper.
 *
 * This compared two toDateString()s, and an absent generatedAt makes that
 * "Invalid Date" — which never equals the day the books went out, so every
 * receipt printed at the table was stamped a copy of an earlier handover that
 * had never happened. A stamp nobody can trust is worse than no stamp: the
 * seller signs the original either way, and the one thing this line exists to
 * do is stop a reprint being mistaken for one.
 */
const isReprint = computed(() => {
  if (!r.value || !givenOn.value) return false
  const given = new Date(givenOn.value)
  const printed = new Date(r.value.generatedAt)
  if (isNaN(given) || isNaN(printed)) return false
  return given.toDateString() !== printed.toDateString()
})

/**
 * `window` is not in scope inside a template, so the old inline handler threw
 * and the dialog never opened. Printing also has to hide the screen behind
 * this sheet, which is what the body class switches on.
 */
function done() { document.body.classList.remove('printing') }

function print() {
  document.body.classList.add('printing')
  window.addEventListener('afterprint', done, { once: true })
  window.print()
}

onUnmounted(done)

/*
 * money() rather than toFixed, and it is not a style preference.
 *
 * This read `valueIfAllSold.toFixed(2)`, and a backend that did not send that
 * field made the computed THROW — during render, because the template asks for
 * waLink to decide whether to show the button. One absent number took the whole
 * sheet down, so the receipt did not render at all for any seller with a
 * dialable phone. money() is the same helper the table above uses, it formats
 * an absent number as 0.00 instead of exploding, and one screen should not
 * carry two ways of writing an amount anyway.
 */
const waLink = computed(() => {
  // Not merely present: a number we cannot place sends this handover receipt,
  // naming books and their value, to whoever owns that number elsewhere.
  if (!isDialable(r.value?.agent?.phone)) return null
  const list = r.value.books.map(b => `${b.book} (${b.firstTicket}-${b.lastTicket})`).join(', ')
  const text = `${r.value.org}\n${r.value.event}\n\nBooks given to ${r.value.agent.name}:\n${list}\n\n` +
    `${r.value.bookCount} books, ${r.value.ticketCount} tickets, worth ` +
    `${money(r.value.valueIfAllSold, r.value.currency)} if they all sell.\n` +
    `Please bring back unsold tickets and the money by ${date(r.value.books[0].due)}. Thank you!`
  return `https://wa.me/${waNumber(r.value.agent.phone)}?text=${encodeURIComponent(text)}`
})
</script>

<template>
  <Sheet title="Handover receipt" wide @close="emit('close')">
    <p v-if="nothing" class="note">{{ nothing }}</p>

    <div v-else-if="!r" class="col" style="gap:12px">
      <div v-for="i in 5" :key="i" class="skel"></div>
    </div>
    <div v-else class="paper">
      <p v-if="isReprint" class="stamp">Reprint — a copy of the books still out, not a new handover</p>
      <div class="head">
        <Logo :size="54" big />
        <div class="grow">
          <h2 style="margin-bottom:2px">{{ r.org }}</h2>
          <p class="muted small" style="margin:0">{{ r.event }}</p>
        </div>
      </div>
      <hr class="hr">
      <div class="facts">
        <div class="f"><span>Given to</span><b>{{ r.agent.name }}</b></div>
        <div v-if="r.agent.phone" class="f"><span>Phone</span><b>{{ r.agent.phone }}</b></div>
        <div class="f"><span>Books</span><b>{{ r.bookCount }}</b></div>
        <div class="f"><span>Tickets</span><b>{{ r.ticketCount }}</b></div>
        <div class="f"><span>Worth if all sold</span><b>{{ money(r.valueIfAllSold, r.currency) }}</b></div>
        <div class="f"><span>Given by</span><b>{{ r.issuedBy }}</b></div>
        <div class="f"><span>Given on</span><b>{{ date(givenOn) }}</b></div>
        <div v-if="isReprint" class="f"><span>This copy printed</span><b>{{ date(r.generatedAt) }}</b></div>
      </div>
      <hr class="hr">
      <div class="tablewrap">
        <table>
          <thead><tr><th>Book</th><th>Tickets</th><th class="num">How many</th><th>Back by</th></tr></thead>
          <tbody>
            <tr v-for="b in r.books" :key="b.book">
              <td>{{ b.book }}</td>
              <td>{{ b.firstTicket }} – {{ b.lastTicket }}
                <!-- Offered and not yet accepted. On the sheet because this is
                     the paper that goes across the table with them; marked
                     because until they accept, the books are not theirs. -->
                <em v-if="b.awaiting" class="await">— waiting to be accepted</em>
              </td>
              <td class="num">{{ b.tickets }}</td>
              <td>{{ date(b.due) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <hr class="hr">
      <p class="small">
        I have received the books listed above, and I will bring back all unsold
        tickets and the money collected by the date shown.
      </p>
      <div class="sign">
        <div><span></span><small>Seller's signature</small></div>
        <div><span></span><small>Given by</small></div>
      </div>
    </div>

    <!-- Not printed: this is the record, and the paper above is the copy. -->
    <div v-if="ack && !nothing" class="noprint ackbox">
      <div v-if="!unconfirmed.length" class="note ok">
        <b>All {{ ack.confirmed }} confirmed received.</b>
        <div v-for="b in ack.books.filter(x => x.confirmed)" :key="b.book" class="tiny">
          {{ b.book }} — {{ b.method === 'app' ? 'confirmed by the seller' : 'signed paper' }}
          <template v-if="b.at">· {{ date(b.at) }}</template>
        </div>
      </div>
      <div v-else class="note warn">
        <b>{{ unconfirmed.length }} of {{ ack.held }} not yet confirmed received</b>
        <div class="tiny">{{ unconfirmed.join(', ') }}</div>
        <p class="tiny" style="margin-top:6px">
          <template v-if="isTheSeller">
            Tapping below records that <b>you</b> received them — your own confirmation,
            which only you can give.
          </template>
          <template v-else>
            Tapping below records that you <b>watched them sign</b> the paper above. It is
            witnessed by you, not by them, and it says so.
          </template>
        </p>
      </div>
    </div>

    <template #actions>
      <button class="btn" @click="emit('close')">Close</button>
      <!-- Nothing to send and nothing to print when there is no receipt. Two
           buttons that cannot work is how a person concludes the app is broken
           rather than that the seller is holding no books. -->
      <a v-if="waLink && !nothing" class="btn" :href="waLink" target="_blank" rel="noopener">
        Send on WhatsApp
      </a>
      <button v-if="canConfirm" class="btn" :disabled="acking" @click="confirm">
        {{ acking ? 'Saving…' : (isTheSeller ? 'I received these' : 'They signed for these') }}
      </button>
      <button v-if="!nothing" class="btn primary" @click="print()">Print / Save as PDF</button>
    </template>
  </Sheet>
</template>

<style scoped>
.await { color: var(--warn); font-style: normal; font-size: .85rem; }
.stamp {
  margin: 0 0 14px; padding: 8px 12px; border: 1.5px dashed var(--warn);
  border-radius: var(--r-sm); color: var(--warn);
  font-weight: 600; font-size: .85rem;
}
.head { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
.facts { display: grid; gap: 12px; }
.f { display: flex; justify-content: space-between; gap: 14px; }
.f span { color: var(--muted); }
.sign { display: flex; gap: 28px; margin-top: 40px; }
.sign > div { flex: 1; }
.sign span { display: block; border-top: 1.5px solid var(--text); margin-bottom: 6px; }
.sign small { color: var(--muted); font-size: .8rem; }
</style>
