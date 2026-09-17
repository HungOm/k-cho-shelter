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
import { ref, onMounted, onActivated, computed, watch } from 'vue'
import { api, toast, state, go, isAdmin } from '../lib/store.js'
import { dateTime, relative } from '../lib/format.js'
import Empty from './ui/Empty.vue'

const rows = ref(null)
const youDecide = ref(false)
const busy = ref('')
const note = ref('')

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

/** Whether this reader can decide THIS row, which is not one answer any more. */
function canDecide(r) {
  return youDecide.value || (isAdmin.value && isRequest(r))
}

const pending = computed(() => (rows.value || []).filter(r => r.status === 'Pending'))
const settled = computed(() => (rows.value || []).filter(r => r.status !== 'Pending'))

async function decide(r, approve) {
  busy.value = r.requestId
  try {
    // The organiser's door, not the System Admin's. Both end in the same
    // handler; which one is called is what decides whether this reader is
    // allowed to touch the row, and the server refuses the wrong pairing.
    const res = await api(youDecide.value ? 'decide_approval' : 'decide_book_request', {
      requestId: r.requestId, approve, note: note.value.trim()
    })
    note.value = ''
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
    await api('cancel_approval', { requestId: r.requestId })
    toast('Withdrawn', 'ok')
    await load()
  } catch (err) {
    toast(err.message, 'bad', err.code)
  } finally { busy.value = '' }
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
      <div v-for="r in pending" :key="r.requestId" class="card req">
        <div class="spread" style="margin-bottom:8px">
          <span class="pill warn">Waiting</span>
          <span class="tiny muted">lapses {{ relative(r.expiresAt) }}</span>
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

        <!-- Look before you decide. A sentence alone turns an approval into a
             rubber stamp for anything bigger than a name. -->
        <button v-if="subjectOf(r)" class="btn sm ghost look" @click="lookAt(r)">
          {{ subjectOf(r).label }} →
        </button>

        <div v-if="canDecide(r)" class="mt">
          <input v-model="note" placeholder="A note, if you want (optional)">
          <div class="row mt">
            <button class="btn danger grow" :disabled="busy === r.requestId" @click="decide(r, false)">
              {{ isReport(r) ? 'Not yet' : isRequest(r) ? 'Say no' : 'Turn down' }}
            </button>
            <button class="btn primary grow" :disabled="busy === r.requestId" @click="decide(r, true)">
              {{ busy === r.requestId ? 'Working…'
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
            <template v-else>
              Approving carries it out straight away, in {{ r.requestedBy }}'s name.
            </template>
          </p>
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
      <div class="card flush">
        <ul class="list">
          <li v-for="r in settled.slice(0, 25)" :key="r.requestId">
            <div class="item" style="cursor:default">
              <span class="grow">
                <!-- Its own line. Run together, the summary's full stop met the
                     next word with no gap: "sign in as Helper.<name>.oct19@…" -->
                <span class="sub" style="white-space:normal;display:block">{{ r.summary }}</span>
                <span class="sub" style="display:block">
                  Asked by {{ r.requestedBy }} · {{ dateTime(r.decidedAt || r.requestedAt) }}
                  <template v-if="r.note"> · “{{ r.note }}”</template>
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
.look { margin-top: 8px; }
.linkrow {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 8px 14px 12px; border-top: 1px solid var(--border);
}
.linkrow code {
  font-size: .82rem; color: var(--muted); word-break: break-all; flex: 1 1 200px;
}
.req { border-left: 4px solid var(--warn); }
.what { font-size: 1.08rem; font-weight: 650; line-height: 1.4; }
.stake { font-size: 1.25rem; font-weight: 800; color: var(--bad); margin-bottom: 2px; }
</style>
