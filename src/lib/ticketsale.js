/**
 * RECORDING A SALE: the rules, once, for every screen that records one.
 *
 * WHY THIS IS A MODULE AND NOT A COMPONENT. It was written when two screens
 * wrote a sale — the sheet you open from anywhere, and a dock beside the
 * results on Find — which had to share every rule without sharing markup. The
 * organiser removed the dock on 2026-09-22, so today SellTicket.vue is the
 * only caller, and the module stays anyway: the rules are what a second
 * surface would copy, and this repository's most frequent bug is two halves of
 * one fact drifting. The rules are that a sale needs a name and a telephone
 * number somebody can actually ring; a book in somebody else's bag refuses
 * rather than warns; an organiser writing into such a book has to say why, and
 * that sentence goes onto the book's own trail.
 *
 * Two copies of those rules is the shape of bug this repository has produced
 * more than any other — two halves of one fact drifting — and the half that
 * drifts here decides whether a sale is refused at the desk or recorded
 * against the wrong person.
 *
 * WHAT IT DELIBERATELY DOES NOT OWN: focus, steps-versus-quick layout, and
 * anything holding a DOM node. Those belong to whichever markup is on screen.
 * `step` is here because it is a position in a rule ("a name before a phone
 * number"), not a position on a screen.
 */
import { ref, computed } from 'vue'
import { state, optimistic, toast, agentMap, whereIs, sellBlock, sellOverrideNeeded, isSold } from './store.js'
import { phoneDigits } from './search.js'

/**
 * @param ticket   a ref or computed holding the ticket being recorded
 * @param onSaved  called after a write lands, so the caller can close or move on
 */
export function useTicketSale(ticket, onSaved = () => {}) {
  const name = ref(ticket.value?.name || '')
  const phone = ref(ticket.value?.phone || '')
  const zone = ref(ticket.value?.zone || '')
  const reason = ref('')
  const step = ref(1)
  const busy = ref(false)
  const done = ref(false)
  
  const t = computed(() => ticket.value)
  const cfg = computed(() => state.cfg)
  const mode = computed(() => state.sellMode)
  const isAvailable = computed(() => t.value?.status === 'Available')
  const isReserved = computed(() => t.value?.status === 'Reserved')
  const isDone = computed(() => isSold(t.value))
  
  const nameOk = computed(() => name.value.trim().length > 0)
  const phoneOk = computed(() => phoneDigits(phone.value).length >= 7)
  const canSell = computed(() => nameOk.value && phoneOk.value)
  
  const agent = computed(() => agentMap.value[t.value?.agent])
  const place = computed(() => whereIs(t.value))
  
  /*
   * IS THIS BOOK IN MY OWN HANDS?
   *
   * Every warning below is written for somebody looking at a ticket that is
   * SOMEWHERE ELSE — 200km away in a seller's bag, possibly already sold on
   * paper. Shown to the seller who is holding it, it says "this one is with TEST"
   * to TEST, and tells them to check with themselves before selling it. Reported
   * exactly that way, from their own account, while the sale worked perfectly.
   */
  const mine = computed(() =>
    !!state.user?.agentId && place.value?.agentId === state.user.agentId)
  
  /**
   * Set when the backend will REFUSE this sale, not merely when it is unwise.
   *
   * The warning below it has always said "check with them first" — advice, with
   * the button still live. This is the harder case: the book is not here, and
   * pressing Sold produces an error rather than a sale. Saying so before the
   * press, and taking the button away, is the difference between a rule and a
   * trap.
   */
  const blocked = computed(() => (done.value ? null : sellBlock(t.value)))
  
  /**
   * WRITING INTO A BOOK SOMEBODY ELSE IS CARRYING, which an organiser may do and
   * which now says why.
   *
   * The note underneath has always warned that the seller may have sold this
   * already — advice, with the button live. That was the whole of the record:
   * "sold", credited to the holder, indistinguishable from a sale invented at
   * this desk, which the seller meets at settlement with nothing to check it
   * against. The sentence goes into the book's own trail, where they will see it.
   *
   * A SEPARATE FIELD FROM `reason`, which belongs to the correction flow in the
   * already-sold branch. One ref serving two unrelated questions is how a
   * sentence typed about a spelling correction ends up on somebody's book.
   */
  const onBehalf = ref('')
  const needsReason = computed(() => !done.value && !blocked.value && sellOverrideNeeded(t.value))
  
  function next() {
    if (!nameOk.value) return toast('Please write who bought it', 'bad')
    step.value = 2
  }
  
  async function sell() {
    if (!canSell.value) return toast('A name and phone number are both needed', 'bad')
    if (needsReason.value && !onBehalf.value.trim()) {
      return toast('Say why you are recording this for them', 'bad')
    }
    busy.value = true
    try {
      await optimistic(t.value.number, {
        status: 'Sold', name: name.value.trim(), phone: phone.value.trim(),
        zone: zone.value.trim(), payment: 'Paid'
      }, 'sell_ticket', {
        ticketNumber: t.value.number, buyerName: name.value.trim(),
        buyerPhone: phone.value.trim(), buyerZone: zone.value.trim(),
        reason: onBehalf.value.trim(), expectedVersion: t.value.version
      })
      done.value = true
      toast(`${t.value.number} sold`, 'ok')
      setTimeout(() => onSaved(), 900)
    } catch (err) {
      toast(err.message, 'bad', err.code)
    } finally {
      busy.value = false
    }
  }
  
  async function hold() {
    if (!nameOk.value) return toast('Who is it being held for?', 'bad')
    // Holding a number in somebody else's book has the same hazard as selling one
    // out of it — two people believe they have it — so it asks the same question.
    if (needsReason.value && !onBehalf.value.trim()) {
      return toast('Say why you are holding this one from their book', 'bad')
    }
    busy.value = true
    try {
      await optimistic(t.value.number, {
        status: 'Reserved', name: name.value.trim(), phone: phone.value.trim()
      }, 'reserve_ticket', {
        ticketNumber: t.value.number, buyerName: name.value.trim(),
        buyerPhone: phone.value.trim(), reason: onBehalf.value.trim(),
        expectedVersion: t.value.version
      })
      toast(`${t.value.number} is being held`, 'ok')
      onSaved()
    } catch (err) {
      toast(err.message, 'bad', err.code)
    } finally { busy.value = false }
  }
  
  async function release() {
    busy.value = true
    try {
      await optimistic(t.value.number, {
        status: 'Available', name: '', phone: '', zone: ''
      }, 'release_ticket', {
        ticketNumber: t.value.number, expectedVersion: t.value.version
      })
      toast(`${t.value.number} is free again`, 'ok')
      onSaved()
    } catch (err) {
      toast(err.message, 'bad', err.code)
    } finally { busy.value = false }
  }
  
  async function correct() {
    if (!reason.value.trim()) return toast('Please say what you are fixing', 'bad')
    busy.value = true
    try {
      await optimistic(t.value.number, {
        name: name.value.trim(), phone: phone.value.trim()
      }, 'correct_ticket', {
        ticketNumber: t.value.number, reason: reason.value.trim(),
        // ONE SPELLING NOW. This sent Buyer_Name AND buyerName, because the two
        // backends disagreed about this one action: the spreadsheet read sheet
        // column names, the Edge Function read camelCase, and each ignored the
        // other's — so a correction carrying only one silently did nothing on the
        // backend it was not speaking to. It came back "No changed fields were
        // supplied", which was true and useless.
        //
        // The handler still accepts the sheet spellings as aliases, so a stale
        // cached bundle sending them keeps working. Nothing sends them any more.
        buyerName: name.value.trim(), buyerPhone: phone.value.trim(),
        expectedVersion: t.value.version
      })
      toast('Fixed', 'ok')
      onSaved()
    } catch (err) {
      toast(err.message, 'bad', err.code)
    } finally { busy.value = false }
  }

  return {
    name, phone, zone, reason, onBehalf, step, busy, done,
    t, cfg, mode, isAvailable, isReserved, isDone,
    nameOk, phoneOk, canSell, agent, place, mine, blocked, needsReason,
    next, sell, hold, release, correct,
  }
}
