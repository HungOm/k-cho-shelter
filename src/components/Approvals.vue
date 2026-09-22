<script setup>
/**
 * Things waiting on a second person.
 *
 * The organiser sees everybody's requests and decides them; everyone else sees
 * only their own and can withdraw them.
 *
 * Approving executes there and then, under the requester's name, so what was
 * approved is what happens — an approval that merely unlocked the action for
 * later would let the payload change in between.
 */
import { ref, onMounted, onActivated, computed, watch, nextTick } from 'vue'
import { api, toast, state, go, isAdmin } from '../lib/store.js'
import { dateTime, relative, money, possessive, COUNTED_IN_HELP } from '../lib/format.js'
import Empty from './ui/Empty.vue'
import Filters from './ui/Filters.vue'

/** The seller this account is linked to, or '' for anybody who is not one. */
const myAgentId = computed(() => state.user?.agentId || '')

const rows = ref(null)
const youDecide = ref(false)
const busy = ref('')
const note = ref('')
/** Which row has opened its "why" box. One at a time: this is a list. */
const wantsReason = ref('')
const whyInput = ref(null)

function askWhy(r) {
  wantsReason.value = r.requestId
  note.value = ''
  // Focus it, so the keyboard is already up on a phone and the chips are
  // reachable without a second tap.
  nextTick(() => {
    const el = Array.isArray(whyInput.value) ? whyInput.value[0] : whyInput.value
    el?.focus?.()
  })
}

/*
 * THE COMMON REASONS, WORDED AS THE VOLUNTEER WILL READ THEM.
 *
 * Not categories and not codes — the chip text goes straight into the note and
 * straight to the person who sent it. Different for each kind of request,
 * because "the money does not match" means nothing on a request for books.
 */
function reasonChips(r) {
  if (isReport(r)) {
    return ['The money does not match what you counted',
            'Some books are not here yet',
            'Please count the unsold stubs again']
  }
  if (isCountIn(r)) {
    return ['I sold some of those numbers — they are not unsold',
            'The money is not right',
            'I have not finished this book yet']
  }
  if (isOffer(r)) {
    return ['I have not been given these books',
            'These are not mine — wrong seller',
            'I cannot take them this time']
  }
  return ['Not right now — ask me again later',
          'Somebody else is taking these',
          'Please come and see me first']
}

onMounted(load)

/*
 * Reload when there is something new to show, and when you look at the screen.
 *
 * onMounted alone was not enough and the reason is easy to miss: screens live
 * inside <KeepAlive>, so this component mounts ONCE for the whole session.
 * Navigating away and back does not remount it. The list a person saw at boot
 * was the list they kept, however long they sat on it — which is how the badge
 * could say 1 while the page underneath said "No one has asked for anything".
 * Two numbers from the same app disagreeing in front of somebody is worse than
 * either being late.
 *
 * onActivated covers coming back to the tab; the watch covers sitting ON it
 * when a request arrives, since the poll updates the count every thirty
 * seconds and the count changing is exactly the signal that the list is stale.
 */
onActivated(load)
watch(() => state.pendingApprovals, (now, before) => {
  if (now !== before) load()
})

async function load() {
  try {
    const r = await api('list_approvals', {})
    rows.value = r.requests
    youDecide.value = !!r.youDecide
  } catch (err) {
    toast(err.message, 'bad', err.code)
    rows.value = []
  }
}

/**
 * Where a request points, so you can look before you decide.
 *
 * An approval asks somebody to say yes to a sentence. For anything bigger than
 * a name change, the sentence is not enough on its own — "mark 12 books Lost"
 * is a different decision depending on whose books they are and what is still
 * in them. Deciding without being able to look is how a rubber stamp forms.
 *
 * Built from the structured `detail` the server sends rather than by reading
 * the summary text, because the summary is prose written for a person and
 * parsing it back into facts is how the two end up disagreeing.
 */
function subjectOf(r) {
  const d = r.detail || {}
  if (d.kind === 'upsert_user' || r.action === 'upsert_user' || r.action === 'set_user_status') {
    return { screen: 'admin', label: 'See who can sign in' }
  }
  if (d.firstBook) {
    return { screen: 'search', query: d.firstBook,
             label: d.lastBook && d.lastBook !== d.firstBook
               ? `Look inside ${d.firstBook}–${d.lastBook}` : `Look inside ${d.firstBook}` }
  }
  if (/book/.test(r.action)) return { screen: 'books', label: 'Look at the books' }
  if (/ticket/.test(r.action)) return { screen: 'search', label: 'Find the tickets' }
  return null
}

function lookAt(r) {
  const s = subjectOf(r)
  if (!s) return
  if (s.query) state.query = s.query
  go(s.screen)
}

/**
 * The link the new person needs, for a request that was about letting somebody
 * sign in.
 *
 * Approving grants the access; it does not tell them where to go. Without this
 * the organiser approves, nothing visible happens, and the person waiting still
 * cannot find the site — so the last step of "let them in" happens over the
 * phone, badly, or not at all.
 */
const signInLink = computed(() => location.origin + location.pathname)

function isSignIn(r) {
  return (r.detail?.kind === 'upsert_user' || r.action === 'upsert_user')
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(signInLink.value)
    toast('Link copied — send it to them', 'ok')
  } catch {
    // Clipboard refused (an insecure origin, or permission denied). Showing the
    // link is not as good as copying it, but it is the difference between a
    // person who can do the thing and one who cannot.
    toast(signInLink.value, '')
  }
}

/**
 * A SELLER ASKING FOR A BOOK, which is a different thing from a two-person
 * control and is decided by a different person.
 *
 * The controls in this queue exist to put somebody above an organiser, so the
 * System Admin decides them. A book request is the opposite shape: somebody who
 * cannot issue books is asking somebody whose job that is. So an organiser
 * decides it, through its own action, and the bar on the controls does not move.
 *
 * Read off `detail.runAs`, which the server wrote when the request was made —
 * not guessed from the action name, so a request made before a deploy is still
 * decided the way it was made.
 */
const isRequest = (r) => r.detail?.runAs === 'approver'

/*
 * A SELLER'S REPORT IS A PETITION TOO, and it is not a book request.
 *
 * Both run as the approver and both are the organiser's to decide, so they
 * share the queue and the buttons. What they must not share is the sentence
 * underneath: granting a book request hands paper out, and accepting a report
 * brings paper back, marks tickets sold and puts money on the ledger. An
 * approver reading the wrong one of those is exactly the rubber stamp this
 * screen is written to prevent.
 */
const isReport = (r) => r.detail?.kind === 'report_back'
/*
 * AN OFFER OF BOOKS, which is the first row in this queue a SELLER answers.
 * Its own predicate rather than reusing either of the two above: isRequest is
 * "somebody asked and an organiser grants it" and isReport is the count-in, and
 * an offer is neither — it is the organiser asking and the seller deciding.
 */
const isOffer = (r) => r.detail?.kind === 'offer'
/*
 * A COUNT-IN THE DESK IS ASKING THIS SELLER TO CONFIRM.
 *
 * Addressed to them like an offer, and answered through the same door, but it
 * is a different thing to read: an offer asks "will you take these books", and
 * this asks "are these the ones that did not sell". The seller is holding the
 * stubs, so the numbers have to be laid out as numbers they can look down —
 * a sentence saying "3 tickets unsold" is not checkable against a handful of
 * paper.
 */
const isCountIn = (r) => r.detail?.kind === 'count_in'
const unsoldOf = (r) => Array.isArray(r.detail?.unsold) ? r.detail.unsold : []
/** Mine to answer: the books were offered to the seller I am linked to. */
const isMineToAccept = (r) => (isOffer(r) || isCountIn(r)) && !!myAgentId.value &&
  r.detail?.agentId === myAgentId.value
/** Mine to withdraw: I am an organiser and nobody has answered yet. */
const canWithdraw = (r) => (isOffer(r) || isCountIn(r)) && isAdmin.value && r.status === 'Pending' &&
  !isMineToAccept(r)

/**
 * WHAT WILL HAPPEN TO EACH BOOK, AND WHETHER IT STILL CAN.
 *
 * REPORTED FROM THE LIVE RAFFLE. A report was accepted and came back as a red
 * toast: "Book-004 is returned already, Book-001 is settled already, Book-002 is
 * settled already. Nothing was changed." The guard is right — a report is
 * judged against the books as they are NOW, and half a checkpoint landing is
 * worse than none — but the organiser learned it AFTER pressing, from an error,
 * with a seller in front of them.
 *
 * Every fact in that sentence was already on this device. `state.books` carries
 * the status of every book an organiser can see, and the request says which
 * books it names. So the same check runs here, before the press, per book,
 * beside what the report wants to do with it.
 *
 * A COURTESY, LIKE EVERY OTHER CLIENT-SIDE RULE HERE: the server decides, and
 * it will still refuse a report that went stale in the seconds after this
 * rendered. What this removes is the ordinary case — a book counted in by hand
 * an hour ago, which nobody could see from this screen.
 */
function reportLines(r) {
  const byNumber = new Map(state.books.map(b => [b.book, b]))
  return (r.detail?.lines ?? []).map((l) => {
    const book = byNumber.get(l.book)
    const status = book?.status ?? ''
    // Out with the seller who sent it is the only state either act can start
    // from: bringing a book back and counting one in both begin with a book
    // that is still in somebody's hands.
    const ready = status === 'Out'
    return {
      ...l,
      status,
      ready,
      why: ready ? ''
        : !book ? 'not a book this screen can see'
        : status === 'Settled' ? 'counted in already'
        : status === 'Returned' ? 'brought back already'
        : `is ${String(status).toLowerCase()} now`,
    }
  })
}

/** Nothing in it can still be carried out, so accepting would only fail. */
const nothingLeft = (r) => {
  const lines = reportLines(r)
  return lines.length > 0 && lines.every(l => !l.ready)
}

/*
 * WHAT THE APPROVER COUNTED, which is the point of them being there.
 *
 * The figures on a report are a CLAIM about two physical things: an envelope of
 * cash and a bundle of stubs. The organiser counts both at the table — that is
 * the whole of what a checkpoint is — and until now the only ways to record a
 * count that differed from the claim were to accept a figure nobody counted or
 * to send the seller away and ask them to type it again.
 *
 * Prefilled with what was claimed, so the ordinary case is one press. Both
 * figures survive: what is typed here is recorded and reaches the ledger, and
 * the claim stays on the request for ever, with the difference written onto the
 * check-in in words.
 */
const counted = ref({})
function countedFor(r) {
  if (!counted.value[r.requestId]) {
    counted.value[r.requestId] = {
      amountHanded: String(r.detail?.handed ?? 0),
      stubsReturned: String(r.detail?.stubsReturned ?? 0),
    }
  }
  return counted.value[r.requestId]
}
const differs = (r) => {
  const c = counted.value[r.requestId]
  if (!c) return false
  return Number(c.amountHanded) !== Number(r.detail?.handed ?? 0) ||
         Number(c.stubsReturned) !== Number(r.detail?.stubsReturned ?? 0)
}

/** Whether this reader can decide THIS row, which is not one answer any more. */
function canDecide(r) {
  // An offer is answered by ONE named seller and by nobody else — not by an
  // organiser and not by the system admin, because a handover agreed to on the
  // seller's behalf is the thing this whole feature exists to stop. The server
  // refuses it too; this is so the buttons are not there to press.
  if (isOffer(r) || isCountIn(r)) return isMineToAccept(r)
  return youDecide.value || (isAdmin.value && isRequest(r))
}

const pending = computed(() => (rows.value || []).filter(r => r.status === 'Pending'))
const settled = computed(() => (rows.value || []).filter(r => r.status !== 'Pending'))

/*
 * NARROWING WHAT HAS ALREADY BEEN DECIDED.
 *
 * "Already dealt with" was the last 25 rows in one undifferentiated list, and
 * the question somebody actually brings to it is narrow: what did we turn down,
 * or what did we cancel. Scrolling a mixed list for a rejection among approvals
 * is the work this saves.
 *
 * THE LAST GROUP IS 'ELSE', ON PURPOSE. Approved, Rejected and Cancelled are
 * the three the server writes today, but the status is a string from a database
 * and a fourth would otherwise belong to no chip — visible under All and
 * nowhere else, which is the trap the statement's filters were written to
 * avoid. Anything unrecognised lands in Other, so the counts always sum to All
 * and nothing can hide.
 */
const DECIDED = [
  { k: 'all', t: 'All' },
  { k: 'Approved', t: 'Approved' },
  { k: 'Rejected', t: 'Rejected' },
  { k: 'Cancelled', t: 'Cancelled' },
  { k: 'other', t: 'Other' },
]
const decidedFilter = ref('all')
const groupOfRow = (r) =>
  ['Approved', 'Rejected', 'Cancelled'].includes(r.status) ? r.status : 'other'
const decidedCounts = computed(() => {
  const c = { all: settled.value.length }
  for (const r of settled.value) c[groupOfRow(r)] = (c[groupOfRow(r)] || 0) + 1
  return c
})
const settledShown = computed(() => decidedFilter.value === 'all'
  ? settled.value
  : settled.value.filter((r) => groupOfRow(r) === decidedFilter.value))

async function decide(r, approve) {
  busy.value = r.requestId
  try {
    // The organiser's door, not the System Admin's. Both end in the same
    // handler; which one is called is what decides whether this reader is
    // allowed to touch the row, and the server refuses the wrong pairing.
    const door = (isOffer(r) || isCountIn(r)) ? 'decide_offer'
               : youDecide.value ? 'decide_approval'
               : 'decide_book_request'
    const res = await api(door, {
      requestId: r.requestId, approve, note: note.value.trim(),
      // Only for a report, and only what was actually counted. Every other kind
      // of request runs exactly the payload that was stored, untouched.
      ...(approve && isReport(r) ? { verified: counted.value[r.requestId] } : {})
    })
    note.value = ''
    wantsReason.value = ''
    if (res.executed) {
      toast(`Done — ${res.summary}`, 'ok')
    } else {
      toast(approve ? 'Approved, but it did not run' : 'Turned down', approve ? 'bad' : '')
    }
    await load()
  } catch (err) {
    // The list can be a moment out of date: a request may have lapsed, been
    // withdrawn, or the person who asked may have lost access since.
    const said = {
      APPROVAL_EXPIRED: 'That request has lapsed. Ask again if it is still needed.',
      NOTHING_TO_DO: 'That one has already been dealt with.',
      REQUESTER_UNAVAILABLE: 'The person who asked no longer has access, so it was not run.',
      REQUESTER_NOT_ALLOWED: 'The person who asked is no longer allowed to do that, so it was not run.'
    }[err.code]
    toast(said || err.message, 'bad', err.code)
    await load()
  } finally {
    busy.value = ''
  }
}

async function withdraw(r) {
  busy.value = r.requestId
  try {
    /*
     * AN OFFER IS WITHDRAWN THROUGH ITS OWN DOOR, because taking one back has
     * to put the books on the shelf as well as close the row. cancel_approval
     * only closes the row — used here it would leave the stock reserved for a
     * seller who is never going to be asked again, and nothing would ever say
     * so. withdraw_offer frees the books first and cancels second, so the
     * failure that can happen leaves an offer somebody can withdraw again
     * rather than books nobody can reach.
     */
    await api(isOffer(r) ? 'withdraw_offer' : 'cancel_approval', { requestId: r.requestId })
    toast('Withdrawn', 'ok')
    await load()
  } catch (err) {
    toast(err.message, 'bad', err.code)
  } finally { busy.value = '' }
}

/*
 * WHO TURNED IT DOWN, in the fewest words that are true. A seller answering a
 * row addressed to them is named; anybody else is "the organiser" or "the
 * System Admin", because on this screen the role is the useful fact and the
 * address is already on the line above.
 */
function whoSaidNo(r) {
  if (isOffer(r) || isCountIn(r)) return r.detail?.agentName || 'The seller'
  if (r.decidedBy && r.decidedBy === state.user?.email) return 'You'
  return 'The organiser'
}

const TONE = { Approved: 'ok', Rejected: 'bad', Expired: '', Cancelled: '' }
</script>

<template>
  <div>
    <h1>Waiting for approval</h1>
    <!-- THREE READERS, THREE SENTENCES. The System Admin decides the controls;
         an organiser decides who gets which books and may also be waiting on
         the System Admin themselves; everybody else is waiting. One sentence
         for all three described the wrong screen to two of them. -->
    <p class="muted">
      <template v-if="youDecide">Changes big enough to need two people. Nothing has happened yet.</template>
      <template v-else-if="isAdmin">Sellers asking for books, and anything you have asked the System Admin to approve.</template>
      <template v-else>Books you have asked for, and anything waiting on the System Admin.</template>
    </p>

    <div v-if="rows === null" class="card">
      <div v-for="i in 2" :key="i" class="skel" style="margin-bottom:10px"></div>
    </div>

    <template v-else-if="pending.length">
      <div v-for="r in pending" :key="r.requestId" class="card reqcard">
        <div class="spread" style="margin-bottom:8px">
          <span class="pill warn">Waiting</span>
          <!--
            ONLY WHEN THERE IS A DATE. `relative()` answers "" for a missing
            one, so this rendered the bare word "lapses" with nothing after it —
            a label with no value, on the one card an organiser decides from.
            Not every kind of request carries an expiry, so this was not a
            hypothetical: it is whatever the server leaves out.
          -->
          <span v-if="r.expiresAt" class="tiny muted">lapses {{ relative(r.expiresAt) }}</span>
        </div>
        <!-- The server sends the facts beside the sentence. "40 tickets leave
             the draw" is the number an approver needs; "4 books" hides it. -->
        <p v-if="r.detail?.voidsTickets" class="stake">
          {{ r.detail.tickets }} {{ r.detail.tickets === 1 ? 'ticket leaves' : 'tickets leave' }} the draw
        </p>
        <!-- The numbers, not the noun. "A report from Amos" is not a thing
             anybody can weigh; what accepting it writes is. -->
        <p v-if="isReport(r)" class="stake">
          {{ r.detail.ticketsSold }} {{ r.detail.ticketsSold === 1 ? 'ticket' : 'tickets' }}
          marked sold<template v-if="r.detail.handed > 0">, {{ r.detail.handed.toFixed(2) }}
          on the ledger</template>
        </p>
        <p class="what">{{ r.summary }}</p>
        <p class="tiny muted">Asked by {{ r.requestedBy }} · {{ dateTime(r.requestedAt) }}</p>

        <!-- BOOK BY BOOK, because that is how the paper is checked: a stack in
             one hand, this list in the other. Each line says what accepting
             would do to that book and whether it still can — the same check the
             server makes, made here, before the press rather than as a red
             error after it. -->
        <template v-if="isCountIn(r)">
          <div class="cin">
            <div class="cin-h">
              <b>{{ r.detail?.book }}</b>
              <span class="muted small">check this against the stubs in your hand</span>
            </div>

            <!-- THE NUMBERS, AS NUMBERS. Laid out as tiles in ticket order so a
                 seller can run down them against the paper — which is the whole
                 act being asked for. A count in a sentence cannot be checked. -->
            <p class="cin-lab">
              These are the ones the office thinks did <b>not</b> sell
              <template v-if="unsoldOf(r).length"> — {{ unsoldOf(r).length }} of them</template>:
            </p>
            <div v-if="unsoldOf(r).length" class="cin-tix">
              <span v-for="n in unsoldOf(r)" :key="n">{{ n }}</span>
            </div>
            <p v-else class="cin-none">
              None — the office thinks the whole book sold.
            </p>

            <div class="cin-sum">
              <span><b>{{ r.detail?.recordedSold ?? 0 }}</b> sold</span>
              <span><b>{{ money(r.detail?.amount, state.cfg?.currency) }}</b> to hand over</span>
            </div>
            <p class="hint tiny">
              If you sold any of the numbers above, say no and tell them which —
              agreeing puts those tickets back and takes the money off your total.
            </p>
          </div>
        </template>

        <template v-if="isReport(r) && reportLines(r).length">
          <ul class="lines">
            <li v-for="l in reportLines(r)" :key="l.book" :class="{ stale: !l.ready }">
              <b>{{ l.book }}</b>
              <span class="grow">
                <template v-if="l.action === 'count'">
                  <span class="helpword" :title="COUNTED_IN_HELP">count in</span> ·
                  {{ l.unsold }} {{ l.unsold === 1 ? 'ticket' : 'tickets' }} unsold
                </template>
                <template v-else>coming back unsold</template>
              </span>
              <span v-if="!l.ready" class="pill bad">{{ l.why }}</span>
            </li>
          </ul>
          <p v-if="reportLines(r).some(l => !l.ready)" class="note bad tiny">
            <template v-if="nothingLeft(r)">
              None of these books can be moved any more — this report has been
              overtaken. Say no, and they can send a fresh one.
            </template>
            <template v-else>
              Some of these books have moved since this was sent. Accepting will be
              refused outright rather than doing the rest — say no, and they can send
              it again.
            </template>
          </p>
        </template>

        <!-- Look before you decide. A sentence alone turns an approval into a
             rubber stamp for anything bigger than a name. -->
        <button v-if="subjectOf(r)" class="btn sm ghost look" @click="lookAt(r)">
          {{ subjectOf(r).label }} →
        </button>

        <div v-if="canDecide(r)" class="mt">
          <!-- WHAT YOU COUNTED, prefilled with what they claimed, so the
               ordinary case is one press and a disagreement is one keystroke.
               Both figures survive: this is what gets recorded, and what they
               said stays on the request with the difference written onto the
               check-in. -->
          <div v-if="isReport(r)" class="row counted">
            <div class="field grow">
              <label :for="'m' + r.requestId">Money you counted</label>
              <input :id="'m' + r.requestId" v-model="countedFor(r).amountHanded"
                     type="number" inputmode="decimal" step="0.01">
            </div>
            <div class="field grow">
              <label :for="'s' + r.requestId">Stubs you counted</label>
              <input :id="'s' + r.requestId" v-model="countedFor(r).stubsReturned"
                     type="number" inputmode="numeric" min="0">
            </div>
          </div>
          <p v-if="isReport(r) && differs(r)" class="note warn tiny">
            This is not what they said. What you counted is what gets recorded; their
            figures stay on this request, and the difference goes on their check-in.
          </p>
          <!--
            THE REASON, AND WHY IT IS NOT JUST A REQUIRED BOX.
            Making a field mandatory is the lazy half of this. The person here
            is an organiser with twenty of these to get through, and a blank box
            marked * is a thing to get past — which is how you get "no" typed
            into it. So the common reasons are one tap, and the box is there for
            everything else. Tapping fills it rather than submitting, because
            the words are what the volunteer reads and they stay editable.
          -->
          <div v-if="wantsReason === r.requestId" class="whybox">
            <label :for="`why-${r.requestId}`" class="whylab">
              Why are you turning this down? <span class="req">*</span>
            </label>
            <div class="chips">
              <button v-for="c in reasonChips(r)" :key="c" type="button" class="chip"
                      @click="note = c">{{ c }}</button>
            </div>
            <input :id="`why-${r.requestId}`" v-model="note" ref="whyInput"
                   placeholder="In your own words — they will read this">
            <p class="hint tiny">
              {{ note.trim().length >= 10
                 ? 'They will see this and can put it right.'
                 : 'A few words at least — "no" on its own tells them nothing.' }}
            </p>
          </div>
          <input v-else v-model="note" placeholder="A note, if you want (optional)">

          <div class="row mt">
            <!-- FIRST PRESS ASKS, SECOND PRESS SENDS. Turning somebody down is
                 not a thing to do by accident, and the reason is the part that
                 makes it survivable — so the button opens the box, and only
                 becomes a refusal once there is something to send. -->
            <button v-if="wantsReason !== r.requestId" class="btn danger grow"
                    :disabled="busy === r.requestId" @click="askWhy(r)">
              {{ isOffer(r) ? 'No, not mine'
                 : isCountIn(r) ? 'No — that is not right'
                 : isReport(r) ? 'Not yet' : isRequest(r) ? 'Say no' : 'Turn down' }}
            </button>
            <button v-else class="btn danger grow"
                    :disabled="busy === r.requestId || note.trim().length < 10"
                    :title="note.trim().length < 10 ? 'Say why first' : undefined"
                    @click="decide(r, false)">
              {{ busy === r.requestId ? 'Working…' : 'Send the refusal' }}
            </button>
            <button class="btn primary grow" :disabled="busy === r.requestId" @click="decide(r, true)">
              {{ busy === r.requestId ? 'Working…'
                 : isOffer(r) ? 'Yes, I have them'
                 : isCountIn(r) ? 'Yes, that is right'
                 : isReport(r) ? 'Accept the report'
                 : isRequest(r) ? 'Give them the books' : 'Approve and do it' }}
            </button>
          </div>
          <!-- WHOSE ACT IT IS, said plainly, because the two differ. A control
               runs in the requester's name; granting a book is the organiser
               handing it over, and the book's record will say so. -->
          <p class="hint">
            <!-- SAID BEFORE THE PRESS, because this one moves money. Accepting
                 is the moment the cash stops being something a seller says they
                 have and becomes something the raffle has been given. Do it
                 with the envelope in front of you. -->
            <template v-if="isReport(r)">
              Accepting brings those books back, counts in the ones they counted, and
              records the money against them — all in your name, straight away. Do it
              when the books and the cash are in front of you; say no if they are not,
              and they can send it again.
            </template>
            <template v-else-if="isRequest(r)">
              Granting hands the books over straight away, in your name, and they
              are nobody else's to sell until they come back.
            </template>
            <template v-else-if="isOffer(r)">
              Saying yes puts these books on your record. They are yours to sell
              and yours to bring back.
            </template>
            <template v-else-if="isCountIn(r)">
              Saying yes counts the book in and settles what is on it.
            </template>
            <template v-else>
              Approving carries it out straight away, in {{ r.requestedBy }}'s name.
            </template>
          </p>
          <!--
            AND WHAT THE OTHER BUTTON DOES. This card described one of its two
            buttons. The undescribed one is the one that feels irreversible —
            turning down a volunteer who counted a book and sent the money in —
            so it was the half somebody most needed before pressing.

            EACH SENTENCE IS THE SERVER'S ACTUAL BEHAVIOUR, and they differ in
            the way that matters. `decideApproval` releases stock inside
            `if (offer)` and nowhere else, so an OFFER is the only refusal that
            puts anything back on the shelf. Saying that on a request — where
            nothing was ever reserved — sends an organiser to the Books screen
            looking for stock that never moved, and spends the trust that makes
            these sentences worth reading. tests/refusalsays pins it.
          -->
          <p class="hint">
            <template v-if="isReport(r)">
              Saying no leaves the books with them and counts nothing in.
            </template>
            <template v-else-if="isOffer(r)">
              Saying no puts the books back on the shelf. Nothing was ever on
              your balance.
            </template>
            <template v-else-if="isCountIn(r)">
              Saying no leaves {{ r.detail?.book || 'the book' }} exactly where it
              is, with {{ r.detail?.agentName || 'them' }}. Nothing is counted in.
            </template>
            <template v-else-if="isRequest(r)">
              Saying no moves nothing and puts nothing on
              {{ possessive(r.detail?.agentName) }} balance.
            </template>
            <template v-else>
              Saying no runs nothing at all.
            </template>
            They see your reason and can put it right or ask again.
          </p>
        </div>
        <div v-else-if="canWithdraw(r)" class="mt">
          <button class="btn" :disabled="busy === r.requestId" @click="withdraw(r)">
            {{ isCountIn(r) ? 'Take the question back' : 'Take the offer back' }}
          </button>
          <!-- Two different consequences, so two different sentences. Taking an
               OFFER back frees reserved books; taking a COUNT-IN question back
               frees nothing — the book was never going anywhere, and what ends
               is only the asking. -->
          <p class="hint">
            <template v-if="isCountIn(r)">
              {{ r.detail?.book }} stays where it is, with
              {{ r.detail?.agentName || 'them' }}. Nothing is counted in.
            </template>
            <template v-else>
              The books go back on the shelf. Nothing was ever on
              {{ possessive(r.detail?.agentName) }} balance.
            </template>
          </p>
        </div>
        <div v-else-if="isOffer(r) || isCountIn(r)" class="mt">
          <!-- An offer somebody else has to answer. Said rather than shown as an
               empty space, because a queue row with no controls and no sentence
               reads as broken. -->
          <p class="hint">Waiting for {{ r.detail?.agentName || 'the seller' }} to answer.</p>
        </div>
        <div v-else class="mt">
          <button class="btn" :disabled="busy === r.requestId" @click="withdraw(r)">Withdraw</button>
        </div>
      </div>
    </template>

    <Empty v-else art="✅" title="Nothing waiting">
      {{ youDecide || isAdmin ? 'No one has asked for anything.' : 'You have not asked for anything.' }}
    </Empty>

    <template v-if="settled.length">
      <h3 class="mt">Already dealt with</h3>
      <Filters v-model="decidedFilter" :items="DECIDED" :counts="decidedCounts" />
      <div class="card flush">
        <ul class="list">
          <li v-for="r in settledShown.slice(0, 25)" :key="r.requestId">
            <div class="item" style="cursor:default">
              <span class="grow">
                <!-- Its own line. Run together, the summary's full stop met the
                     next word with no gap: "sign in as Helper.<name>.oct19@…" -->
                <span class="sub" style="white-space:normal;display:block">{{ r.summary }}</span>
                <span class="sub" style="display:block">
                  Asked by {{ r.requestedBy }} · {{ dateTime(r.decidedAt || r.requestedAt) }}
                  <template v-if="r.note && r.status !== 'Rejected'"> · “{{ r.note }}”</template>
                </span>
                <!--
                  WHY IT WAS TURNED DOWN, ON ITS OWN AND LOOKING LIKE THE POINT.
                  It was a small grey clause at the end of an email address and a
                  timestamp, in the same colour as both — present, and invisible.
                  Reported as "the reason is not displayed", which is what being
                  invisible means in practice.
                  It is the one thing on a refused row that anybody can act on:
                  the whole reason refusals now require words is so the person
                  reading this can put it right.
                -->
                <span v-if="r.status === 'Rejected'" class="why">
                  <template v-if="r.note">
                    <b>{{ whoSaidNo(r) }} said:</b> “{{ r.note }}”
                  </template>
                  <template v-else>
                    <b>No reason was given.</b>
                    Turned down before a reason was required.
                  </template>
                </span>
              </span>
              <span :class="['pill', TONE[r.status] || '']">{{ r.status }}</span>
            </div>
            <!-- Approving grants the access; it does not tell them where to go.
                 Without this the last step of letting somebody in happens over
                 the phone, badly, or not at all. -->
            <div v-if="r.status === 'Approved' && isSignIn(r)" class="linkrow">
              <code>{{ signInLink }}</code>
              <button class="btn sm" @click="copyLink">Copy link</button>
            </div>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* THE REFUSAL REASON. Tinted and set apart, because it is the one thing on a
   refused row anybody can act on — and as a grey clause on the meta line it was
   read as part of the timestamp. */
.why {
  display: block; margin-top: 7px; padding: 8px 10px;
  border-radius: 9px; font-size: .9rem; line-height: 1.35;
  background: color-mix(in srgb, var(--bad) 9%, transparent);
  border-left: 3px solid color-mix(in srgb, var(--bad) 55%, transparent);
  white-space: normal;
}

/* A COUNT-IN PUT TO THE SELLER. The numbers are the point of the panel, so they
   get the room: tiles in ticket order that a thumb can run down against the
   paper, rather than a sentence with a total in it. */
.cin {
  margin-top: 10px; padding: 12px; border-radius: var(--r);
  background: var(--surface-2); border: 1px solid var(--border);
}
.cin-h { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.cin-h b { font-size: 1.05rem; }
.cin-lab { margin: 10px 0 7px; font-size: .92rem; }
.cin-tix { display: flex; flex-wrap: wrap; gap: 5px; }
.cin-tix span {
  border: 1px solid var(--border); background: var(--surface);
  border-radius: 7px; padding: 6px 9px;
  font-weight: 700; font-variant-numeric: tabular-nums; font-size: .88rem;
}
.cin-none { margin: 4px 0 0; font-size: .92rem; font-weight: 600; }
.cin-sum {
  display: flex; gap: 16px; flex-wrap: wrap;
  margin-top: 11px; padding-top: 10px; border-top: 1px solid var(--border);
  font-size: .95rem;
}

/* THE REASON STEP. Tinted with the refusal colour rather than neutral, so the
   panel itself says what is about to happen — an organiser who opened it by
   mistake should see that before they read a word. */
.whybox {
  margin-top: 10px; padding: 12px; border-radius: var(--r);
  background: color-mix(in srgb, var(--bad) 7%, transparent);
  border: 1px solid color-mix(in srgb, var(--bad) 28%, transparent);
}
.whylab { display: block; font-weight: 700; font-size: .92rem; margin-bottom: 8px; }
.whybox .req { color: var(--bad); }
/* Wrapped, not scrolled: these are sentences, and a sideways scroller hides the
   one somebody wanted. */
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 9px; }
.chip {
  border: 1px solid var(--border); background: var(--surface); color: inherit;
  border-radius: 99px; padding: 6px 11px; font-size: .84rem;
  font-weight: 600; cursor: pointer; text-align: left; line-height: 1.25;
  transition: border-color .12s var(--ease), color .12s var(--ease);
}
.chip:hover, .chip:focus-visible { border-color: var(--bad); color: var(--bad); }
.whybox input { width: 100%; }
.whybox .hint { margin: 6px 0 0; }

.look { margin-top: 8px; }
.lines { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 6px; }
.lines li {
  display: flex; align-items: center; gap: 10px; font-size: .9rem;
  padding: 8px 10px; border-radius: var(--r-sm); background: var(--surface);
  border: 1px solid var(--border);
}
.lines li.stale { opacity: .65; border-style: dashed; }
.lines .grow { flex: 1; color: var(--muted); }
.counted { gap: 10px; margin-bottom: 8px; }
.note.tiny { font-size: .84rem; }
.linkrow {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 8px 14px 12px; border-top: 1px solid var(--border);
}
.linkrow code {
  font-size: .82rem; color: var(--muted); word-break: break-all; flex: 1 1 200px;
}
/*
 * RENAMED FROM `.req`, WHICH WAS COLLIDING WITH A GLOBAL.
 *
 * style.css defines `.req { color: var(--bad) }` — the red asterisk that marks
 * a required field, and this file uses it correctly for that three lines below.
 * The pending-request CARD was also called `.req`, and a global rule is not
 * scoped, so every waiting request has been drawing its summary in alarm red:
 * the sentence an organiser reads before approving somebody's book, coloured
 * as though something had gone wrong.
 *
 * Nothing failed. A scoped rule and a global one with the same name simply both
 * apply, and only the global one carried a colour. Found by rendering the
 * screen and looking at it.
 */
.reqcard { border-left: 4px solid var(--warn); }
.what { font-size: 1.08rem; font-weight: 650; line-height: 1.4; }
.stake { font-size: 1.25rem; font-weight: 800; color: var(--bad); margin-bottom: 2px; }
</style>
