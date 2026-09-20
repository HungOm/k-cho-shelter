<script setup>
/**
 * Finding things. On a wide screen the list keeps its place beside the ticket
 * you opened, so you can work down a stack without losing where you were.
 */
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { state, searchResults, agentMap, whereIs, isSold, isAdmin, api, toast, go, sellBlock } from '../lib/store.js'
import { STATUS_WORDS } from '../lib/format.js'
import { isFreeToIssue } from '../lib/books.js'
import StatusPill from './ui/StatusPill.vue'
import Empty from './ui/Empty.vue'
import History from './modals/History.vue'
import Icon from './ui/Icon.vue'
/*
 * BOTH OF THESE WERE USED WITHOUT BEING IMPORTED, and Vue renders an unknown
 * element as nothing rather than as an error — so a seller's own ticket panel
 * and the pager under both result lists have been invisible on this screen,
 * silently, in production. Found by enabling vue/no-undef-components, which is
 * the half of "no undefined names" that noundef.test.mjs was not checking.
 */
import YourStock from './ui/YourStock.vue'
import Pager from './ui/Pager.vue'
import TicketDock from './ui/TicketDock.vue'

const emit = defineEmits(['open'])
const box = ref(null)

/*
 * The ticket whose trail is open, or null. Held here rather than in the row so
 * that closing it puts you back on the list exactly where you were.
 */
const showHistory = ref(null)

const examples = computed(() => {
  const c = state.cfg
  if (!c) return []
  const tail = String(c.ticketStart + 720).slice(-3)
  return [
    { text: tail, why: 'the last few numbers on the ticket' },
    { text: '012', why: 'part of a phone number' },
    { text: c.bookPrefix + '1', why: 'a whole book' }
  ]
})

function use(text) {
  state.query = text
  box.value?.focus()
}

function clear() {
  state.query = ''
  state.filterStatus = ''
  state.filterAgent = ''
  state.filterWhere = ''
}

const hasFilters = computed(() =>
  !!(state.query || state.filterStatus || state.filterAgent || state.filterWhere))

function subtitle(t) {
  const bits = [t.book]
  // The marker stays visible in a results list — "JOHN (seller)" tells you at a
  // glance that the contact is the seller, which is the thing you would
  // otherwise have to open the ticket to discover.
  if (t.name) bits.push(t.name)
  else if (isSold(t)) bits.push('no name written down')
  const a = agentMap.value[t.agent]
  if (a) bits.push(a.name)
  if (t.phone) bits.push(t.phone)
  return bits.join(' · ')
}

/**
 * Where the ticket physically is — which is not the same question as whether it
 * has been sold. An unsold ticket in a book that is out with somebody cannot be
 * sold from the office, and may already have been sold on paper.
 */
function place(t) {
  const w = whereIs(t)
  if (!w) return null
  if (w.out) return { text: `with ${w.agentName || w.agentId}`, tone: 'info' }
  if (w.status === 'Unassigned') return { text: 'in the office', tone: '' }
  if (w.status === 'Returned') return { text: 'brought back', tone: 'warn' }
  if (w.status === 'Lost') return { text: 'book lost', tone: 'bad' }
  return null
}

/**
 * ASKING FOR THE BOOK A TICKET IS IN.
 *
 * WHY THE BOOK AND NOT THE TICKET. A ticket has no custody of its own: what
 * makes a ticket somebody's to sell is books.held_by_agent, and its owner is
 * derived from its book. So this screen answers "3291 is in Book-330, in the
 * office" and offers the book — asking for one ticket out of a book would be
 * asking for a thing the raffle has no way to give.
 *
 * WHO IS OFFERED IT. Somebody who cannot issue books to themselves and whose
 * account is linked to a seller, which is exactly the person the fence stops:
 * they may only sell from books they are carrying. An organiser is not offered
 * it because they can simply take the book.
 *
 * AND ONLY FOR A BOOK THAT CAN ACTUALLY BE GIVEN. Asking for one already in
 * somebody's bag produces a refusal at the moment of granting, which is the
 * worst place to discover it — so the offer follows the same rule the issuing
 * screen uses.
 */
const canAsk = computed(() => !isAdmin.value && !!state.user?.agentId)

function askable(t) {
  const w = whereIs(t)
  return canAsk.value && !!w && isFreeToIssue(w) ? w : null
}

const asking = ref('')

async function askFor(t) {
  const book = askable(t)
  if (!book) return
  asking.value = t.number
  try {
    const r = await api('request_approval', {
      action: 'issue_books',
      payload: { bookNumbers: [book.book] },
    })
    // Named, and pointed at where the answer will arrive. "Request sent" leaves
    // somebody refreshing the list they are already on.
    toast(`Asked for ${book.book} — ${r.summary}`, 'ok')
    go('approvals')
  } catch (err) {
    toast(err.message, 'bad', err.code)
  } finally {
    asking.value = ''
  }
}
/*
 * A PAGE OF RESULTS, NOT THE FIRST THREE HUNDRED.
 *
 * This drew every hit in one list and said "(showing first 300)" underneath —
 * a wall to scroll on a phone AND a list somebody had to notice was cut. The
 * pager states the total where it can be acted on, and the search itself is no
 * longer truncated, so page nine is real.
 */
const PAGE = 25
const page = ref(1)
const pageRows = computed(() =>
  searchResults.value.results.slice((page.value - 1) * PAGE, page.value * PAGE))

/* Back to the first page whenever the query or a filter changes: a new search
   that lands somebody on page seven of the old one looks like no results. */
watch(() => [state.query, state.filterStatus, state.filterAgent, state.filterWhere],
      () => { page.value = 1 })

/*
 * ================= WORKING DOWN A STACK, FROM THE KEYBOARD =================
 *
 * TWO PRESENTATIONS OF ONE SELECTION. Wide enough for a column beside the
 * list and the ticket opens in a dock; otherwise it opens in the sheet, as it
 * always has. A phone has no room for a dock and no keyboard to earn one, and
 * a seller standing up holding a book is the person on the phone. 1024px is
 * the same gate the dense reading mode uses.
 *
 * The match is read once and listened to, and it answers false on the server,
 * where there is no window — so a server render is the phone shape, which is
 * the safe one to be wrong about.
 */
const wide = ref(false)
let mq = null
const onWide = (e) => { wide.value = e.matches; if (!e.matches) selected.value = null }
onMounted(() => {
  if (typeof window === 'undefined' || !window.matchMedia) return
  mq = window.matchMedia('(min-width: 1024px)')
  wide.value = mq.matches
  mq.addEventListener('change', onWide)
})
onUnmounted(() => mq?.removeEventListener('change', onWide))

/*
 * The ticket in the dock. Held as the OBJECT rather than as a number, which
 * is safe here and was worth checking before relying on: loadDelta merges
 * with Object.assign onto the row already in state and reindex remaps the
 * same objects, so a held reference keeps updating across a poll instead of
 * going stale. Holding a number and looking it up every render would also
 * work; it would just be re-deriving something the tree already gives us.
 */
const selected = ref(null)

function openTicket(t) {
  if (wide.value) { selected.value = t; focusNum.value = t.number }
  else emit('open', t)
}

/*
 * ---- ROVING FOCUS ----
 *
 * KEYED ON THE TICKET NUMBER, NOT ON A ROW INDEX. The results are a
 * TransitionGroup and the list re-sorts and re-pages underneath; an index
 * survives none of that and would move the focus ring to whichever ticket
 * happened to land in that position. The number is the identity.
 */
const focusNum = ref('')
const listEl = ref(null)

/* The one row in the tab order. Everything else is reachable by arrow. */
const rovingFor = (t) => (t.number === focusNum.value
  || (!pageRows.value.some((r) => r.number === focusNum.value) && t === pageRows.value[0]) ? 0 : -1)

/*
 * SAID OUT LOUD, because three of the things this keyboard does are invisible.
 * Turning a page, refusing to sell, and reaching the end of the results all
 * change what the next key will do, and a sighted user sees the list move
 * while a screen-reader user gets nothing at all.
 */
const said = ref('')
function say(words) { said.value = words }

const pageCount = computed(() => Math.max(1, Math.ceil(searchResults.value.results.length / PAGE)))

async function focusRow(number) {
  focusNum.value = number
  await nextTick()
  listEl.value?.querySelector(`[data-num="${number}"]`)?.focus()
}

/*
 * DOWN AT THE BOTTOM OF A PAGE TURNS THE PAGE. The alternative is stopping
 * dead on row 25 of a 601-ticket search, which reads as the key having
 * stopped working — the page boundary is an artefact of drawing, not
 * something the person searching asked for. It is announced, because the
 * list changing under a held key is exactly the moment somebody loses their
 * place.
 */
async function move(by) {
  const rows = pageRows.value
  if (!rows.length) return
  const at = rows.findIndex((r) => r.number === focusNum.value)
  const to = at < 0 ? 0 : at + by

  if (to < 0) {
    if (page.value === 1) return say('Top of the results.')
    page.value -= 1
    await nextTick()
    const last = pageRows.value[pageRows.value.length - 1]
    say(`Page ${page.value} of ${pageCount.value}.`)
    return focusRow(last.number)
  }
  if (to >= rows.length) {
    if (page.value >= pageCount.value) return say('End of the results.')
    page.value += 1
    await nextTick()
    say(`Page ${page.value} of ${pageCount.value}.`)
    return focusRow(pageRows.value[0].number)
  }
  return focusRow(rows[to].number)
}

/*
 * S IS THE ONE SHORTCUT THAT CAN BE REFUSED, and a shortcut has no title
 * attribute to carry the reason. permissionui's rule — never hidden, always
 * with the reason — is satisfiable on the mouse path by a disabled button
 * with a tooltip and has no equivalent here, so the live region is where the
 * reason goes. Silently doing nothing would be the one outcome the rule
 * exists to forbid.
 */
function sellFocused() {
  const t = pageRows.value.find((r) => r.number === focusNum.value)
  if (!t) return
  if (isSold(t)) return say(`${t.number} is already sold.`)
  const why = sellBlock(t)
  if (why) return say(`${t.number} cannot be sold from here. ${why}`)
  openTicket(t)
  say(`${t.number} open. Who bought it?`)
}

function onKey(ev) {
  if (ev.key === 'ArrowDown') { ev.preventDefault(); move(1) }
  else if (ev.key === 'ArrowUp') { ev.preventDefault(); move(-1) }
  else if (ev.key === 'Enter') {
    const t = pageRows.value.find((r) => r.number === focusNum.value)
    if (t) { ev.preventDefault(); openTicket(t) }
  } else if (ev.key === 's' || ev.key === 'S') {
    ev.preventDefault()
    sellFocused()
  }
}

/** The next number worth typing into, so the dock can point at it. */
const nextUnsold = computed(() => {
  if (!selected.value) return null
  const rows = searchResults.value.results
  const at = rows.findIndex((r) => r.number === selected.value.number)
  return rows.slice(at + 1).find((r) => !isSold(r) && !sellBlock(r)) || null
})

function goNext() {
  const t = nextUnsold.value
  if (t) { selected.value = t; focusRow(t.number) }
}
</script>

<template>
  <div>
    <!-- WHAT THEY ARE HOLDING, BEFORE THEY SEARCH FOR IT. A seller is confined
         to the books in their hands, so on this screen the numbers that are
         theirs are usually the answer — and looking one up by typing it is the
         long way round. The same panel as the Sell screen, shared so the two
         cannot disagree about what somebody is holding. It renders nothing for
         an organiser, who holds no books. -->
    <YourStock title="Your tickets" @open="t => emit('open', t)" />

    <h1>Find a ticket</h1>

    <div class="card searchcard">
      <input ref="box" v-model="state.query" class="xl" type="search"
             placeholder="Number, name or phone"
             autocomplete="off" autocapitalize="off" spellcheck="false"
             aria-label="Search tickets">

      <div class="row wrap" style="margin-top:12px">
        <select v-model="state.filterStatus" class="grow" aria-label="Filter by status">
          <option value="">Any ticket</option>
          <option v-for="(word, key) in STATUS_WORDS" :key="key" :value="key">{{ word }}</option>
        </select>
        <select v-model="state.filterAgent" class="grow" aria-label="Filter by seller">
          <option value="">Any seller</option>
          <option v-for="a in state.agents" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
        <select v-model="state.filterWhere" class="grow" aria-label="Filter by where it is">
          <option value="">Anywhere</option>
          <option value="office">In the office</option>
          <option value="out">Out with a seller</option>
        </select>
        <button v-if="hasFilters" class="btn sm" @click="clear">Clear</button>
      </div>

      <div v-if="!state.query" class="chips">
        <span class="tiny muted" style="align-self:center">Try:</span>
        <button v-for="e in examples" :key="e.text" class="chip" :title="e.why" @click="use(e.text)">
          {{ e.text }}
        </button>
      </div>
    </div>

    <div class="spread count">
      <span class="small muted">
        <template v-if="state.loadProgress">
          Loading {{ state.loadProgress.done.toLocaleString() }} of
          {{ state.loadProgress.total.toLocaleString() }}…
        </template>
        <template v-else-if="searchResults.total">
          <b class="data">{{ searchResults.total.toLocaleString() }}</b>
          {{ searchResults.total === 1 ? 'ticket' : 'tickets' }}
          <!--
            PRINTED ONLY WHERE IT IS TRUE. These keys exist on the wide
            layout, where the list keeps focus beside the dock. Printing them
            on a phone would describe affordances that are not there, and a
            header that promises a keyboard to somebody who has none is worse
            than a header that says nothing.
          -->
          <span v-if="wide" class="keys">↑↓ to move · Enter to open · S to sell</span>
          <!-- No "showing first N" any more: the pager under the list says which
               page this is and how many there are in total, which is the same
               fact stated where somebody can act on it. -->
        </template>
      </span>
    </div>

    <!--
      THE PAGER, TOP AND BOTTOM, and the top one is the point.
      It was under the list only — below twenty-five rows, off the bottom of
      every screen — so it was reported as not existing at all. A control nobody
      scrolls to is a control nobody has. The top copy also puts the page you are
      on beside the count, which is where somebody looks to find out where they
      are in a long list.
      Both sit OUTSIDE the v-if chain below. Wedged between the results and the
      empty states, the pager orphaned them from the v-if they belonged to —
      "nothing matches" then hung off the pager's own condition and could never
      show while a search was running.
    -->
    <Pager v-if="!state.loadProgress" v-model:page="page"
           :total="searchResults.results.length" :size="PAGE" noun="tickets" />

    <div class="findsplit" :class="{ docked: wide && selected }">
    <!-- The ref and the key handler sit on the container, not on the
         TransitionGroup: a ref on a component hands back the component, and
         keydown bubbles up from whichever row has focus anyway. -->
    <div ref="listEl" class="card flush" @keydown="onKey">
      <!-- loading -->
      <ul v-if="state.loadProgress" class="list">
        <li v-for="i in 6" :key="i" class="skelrow">
          <div class="skel" style="width:35%"></div>
          <div class="skel" style="width:62%;height:11px;margin-top:8px"></div>
        </li>
      </ul>

      <!-- results -->
      <TransitionGroup v-else-if="searchResults.results.length" name="list"
                       tag="ul" class="list">
        <li v-for="t in pageRows" :key="t.number" class="rowpair"
            :class="{ picked: selected && selected.number === t.number }">
          <button class="item" :data-num="t.number" :tabindex="rovingFor(t)"
                  @click="openTicket(t)" @focus="focusNum = t.number">
            <span class="grow">
              <span class="lead">{{ t.number }}</span>
              <span class="sub">{{ subtitle(t) }}</span>
            </span>
            <span v-if="place(t) && !isSold(t)" :class="['pill', place(t).tone]">
              {{ place(t).text }}
            </span>
            <StatusPill :status="t.status" />
            <span class="chev">›</span>
          </button>
          <!-- WHERE IT HAS BEEN, FROM THE LIST ITSELF.
               It used to be two taps down, inside the sell sheet — so the one
               question you ask about a ticket somebody hands you across a table
               ("who had this before?") cost you opening a form that can record
               a sale. Its own control, with its own label, because a row that
               does two things from one tap does the wrong one eventually. -->
          <button class="rowhist" :title="`Where ${t.number} has been`"
                  :aria-label="`Where ${t.number} has been`" @click="showHistory = t"><Icon name="clock" :size="17" /></button>
          <!-- A THIRD CONTROL, for the same reason the second one exists: a row
               that does several things from one tap does the wrong one
               eventually. A seller may only sell out of books they are
               carrying, and until now the screen showed them a ticket they
               could not have with no way to ask for it. -->
          <button v-if="askable(t)" class="rowhist ask" :disabled="asking === t.number"
                  :title="`Ask for ${askable(t).book}`"
                  :aria-label="`Ask for ${askable(t).book}`" @click="askFor(t)"><Icon name="hand" :size="17" /></button>
        </li>
      </TransitionGroup>

      <!-- nothing -->
      <Empty v-else-if="!state.tickets.length" art="🎟️" title="No tickets yet">
        The tickets have not been made. The organiser needs to set the numbers
        and run setup.
      </Empty>
      <Empty v-else art="🔍" :title="state.query ? `Nothing matches “${state.query}”` : 'Nothing here'"
             :action="hasFilters ? 'Clear and start again' : ''" @action="clear">
        Try the last few numbers on the ticket, part of a name,
        or a phone number written any way you like.
      </Empty>
    </div>

    <!--
      THE TICKET, BESIDE THE LIST. Only on the wide layout, and only once
      something is selected — an empty column is furniture. On a phone this
      never renders and the sheet opens as it always did.
    -->
    <TicketDock v-if="wide && selected" :ticket="selected" :next-unsold="nextUnsold"
                @close="selected = null" @saved="selected = null"
                @open-full="(t) => emit('open', t)" @go-next="goNext" />
    </div>

    <Pager v-if="!state.loadProgress" v-model:page="page"
           :total="searchResults.results.length" :size="PAGE" noun="tickets" />

    <!-- Nothing to look at, and the only way three of these keys say anything. -->
    <p class="sr" aria-live="polite">{{ said }}</p>

    <!-- On top of the list, not instead of it. -->
    <History v-if="showHistory" :ticket="showHistory" @close="showHistory = null" />
  </div>
</template>

<style scoped>
.searchcard { padding: 16px; }
/* One column until there is room for two. The dock is sticky inside its own
   column so the list scrolls past it rather than dragging it along. */
.findsplit { display: block }
@media (min-width: 1024px) {
  .findsplit.docked { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 14px; align-items: start }
}
/* .sr is defined only inside TicketDesign's SCOPED block, so it does not
   reach here — a live region without it is a stray paragraph of text on the
   screen. Copied rather than left broken; it belongs in style.css as a
   utility and e3 owns that file this round. */
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%) }
.keys { margin-left: 10px; font-size: .74rem; color: var(--muted-2, var(--muted)) }
.rowpair.picked { background: var(--brand-soft) }
.item:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px }
/* The same shape as the history control beside it: a small square that does one
   named thing, rather than a word competing with the row itself. */
.ask:disabled { opacity: .5; }
.chips { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.count { margin: 0 4px 8px; min-height: 22px; }
.skelrow { padding: 18px; }
</style>
