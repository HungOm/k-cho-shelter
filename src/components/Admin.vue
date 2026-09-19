<script setup>
/**
 * Who can sign in, and what the raffle is set to.
 *
 * The super admin is a rung above admin: it lives in a Script Property, outside
 * the spreadsheet, so nothing in this screen can grant it or take it away.
 */
import { ref, onMounted, computed, watch } from 'vue'
import { state, setConfig, api, toast, isAdmin, isSuper, go } from '../lib/store.js'
import { money, date, dateTime, ROLE_WORDS } from '../lib/format.js'
import { applyBrand, inkFor } from '../lib/brand.js'
import { toPayload, reject as rejectLogo } from '../lib/logofile.js'
import Logo from './ui/Logo.vue'

/*
 * WHICH BUILD THIS IS. Replaced at build time by vite.config.js — the running
 * app has no other way to know, and an organiser reporting something is
 * otherwise describing "the latest one", which is the question rather than the
 * answer.
 */
const appVersion = __APP_VERSION__
const appSha = __APP_SHA__

const emit = defineEmits(['add-user', 'edit-user', 'make-tickets', 'tickets-in-play', 'deadlines'])

/**
 * Three numbers, and keeping them apart is the whole point of this card.
 *
 *   made    — ticket rows that exist. Only ever goes up, and not easily.
 *   live    — how many of those are sellable right now. Moves freely.
 *   waiting — the difference: printed, paid for, and deliberately not yet out.
 *
 * `totalTickets` means LIVE, which is right for the progress bar and the money
 * target — a raffle holding half its tickets back should read "1,248 of 10,000",
 * not "of 20,000". It is the wrong number for anything about creating rows.
 */
const made = computed(() => c.value?.generatedTickets ?? c.value?.totalTickets ?? 0)
const live = computed(() => c.value?.totalTickets || 0)
const waiting = computed(() => c.value?.heldBackTickets ?? Math.max(0, made.value - live.value))

/**
 * Whether any more rows could ever be created. A ceiling of 0 means none was
 * set, so headroom is unknown rather than zero — offering the button is right
 * in that case, refusing to is not.
 */
const allMade = computed(() =>
  !!c.value?.ticketCeiling && made.value >= c.value.ticketCeiling)

const users = ref(null)
const audit = ref(null)
const superAdmin = ref('')
const c = computed(() => state.cfg)

/* ---------- branding ---------- */

/**
 * The raffle's own mark and colour.
 *
 * Both are settings rather than code now, so this is where they are set. The
 * mark falls back to Raffled's own, drawn in whatever colour is chosen — which
 * is why the colour is worth setting even before a logo exists.
 */
const logoInput = ref(null)
const brand = ref('')
const brandSaving = ref(false)
const logoBusy = ref(false)
const logoErr = ref('')

onMounted(() => { brand.value = c.value?.brandColor || '' })

/**
 * Preview as they type, not on save.
 *
 * A colour is chosen by looking at it. Applying it live means the whole
 * interface answers immediately — including the primary button below, which is
 * the only thing here that can show the real problem: an organisation picks a
 * colour for a letterhead, and nobody checks whether white text survives on it.
 */
watch(brand, v => applyBrand(v))

/** What the button will actually look like, in the colour currently typed. */
const previewInk = computed(() => inkFor(brand.value) || 'var(--brand-ink)')
const previewBrand = computed(() => inkFor(brand.value) ? brand.value.replace(/^#?/, '#') : 'var(--brand)')

function revertBrand() {
  brand.value = c.value?.brandColor || ''
  applyBrand(brand.value)
}

/**
 * Taking it off again.
 *
 * An organisation rebrands, or the wrong file goes up. Without an explicit
 * path the only way back is to upload something blank, which leaves a real
 * object in the bucket pretending to be an absence.
 */
async function removeLogo() {
  logoBusy.value = true
  logoErr.value = ''
  try {
    const r = await api('upload_logo', { remove: true })
    if (r?.config) setConfig(r.config)
    toast('Logo removed', 'ok')
  } catch (err) {
    logoErr.value = err.message
  } finally { logoBusy.value = false }
}

async function saveBrand() {
  brandSaving.value = true
  try {
    const r = await api('set_brand_color', { color: brand.value.trim() })
    // The action returns whoami's config object, so there is one shape and
    // nothing to merge. Assign it whole rather than patching a field.
    if (r?.config) setConfig(r.config)
    brand.value = state.cfg?.brandColor || ''
    toast('Colour saved', 'ok')
  } catch (err) {
    toast(err.message, 'bad', err.code)
    revertBrand()
  } finally { brandSaving.value = false }
}

/**
 * Picked, shrunk on the device, sent.
 *
 * The resize is a courtesy — the server caps and type-checks both images
 * independently and does not trust which one was labelled small — but it is the
 * difference between sending 6 KB to every volunteer's phone and sending
 * whatever came off a designer's machine.
 */
async function pickLogo(ev) {
  const file = ev.target.files?.[0]
  ev.target.value = ''          // so choosing the same file twice still fires
  if (!file) return
  logoErr.value = rejectLogo(file) || ''
  if (logoErr.value) return

  logoBusy.value = true
  try {
    const r = await api('upload_logo', await toPayload(file))
    if (r?.config) setConfig(r.config)
    toast('Logo saved', 'ok')
  } catch (err) {
    logoErr.value = err.message
    if (err.code) toast(err.message, 'bad', err.code)
  } finally { logoBusy.value = false }
}


onMounted(loadUsers)

async function loadUsers() {
  try {
    const r = await api('list_users', {})
    users.value = r.users
    superAdmin.value = r.superAdmin || ''
  } catch (err) { toast(err.message, 'bad', err.code); users.value = [] }
}

/**
 * What an account is, in one word.
 *
 * The column said on/off while the gate had four states. "off" covered three
 * of them — waiting to be let in, paused, and stopped for good — which are not
 * the same thing to the person refused, and not the same decision to the person
 * looking at the list.
 */
/* ---------- resetting the raffle ---------- */

/*
 * THE MOST DESTRUCTIVE CONTROL IN THE APP, so it behaves like one.
 *
 * Nothing loads until it is asked for, and the feature list comes FROM THE
 * SERVER rather than being written here — so the screen cannot offer something
 * the server will refuse, and the counts come from the same code that does the
 * deleting. A preview assembled separately is a preview that lies.
 *
 * The confirmation is not a fixed word. It carries the row counts, so it cannot
 * be learned in advance and cannot be typed without reading what is about to be
 * destroyed. The server counts again on the way in and refuses if the numbers
 * moved while this sat open — somebody selling at a table does not know a reset
 * is being considered.
 */
const resetInfo = ref(null)
const resetPick = ref([])
const resetPhrase = ref('')
const resetBusy = ref(false)
const resetErr = ref('')
const acceptPrinted = ref(false)
const resetDone = ref(null)

async function previewReset() {
  resetBusy.value = true
  resetErr.value = ''
  resetDone.value = null
  try {
    resetInfo.value = await api('reset_preview', { features: resetPick.value })
  } catch (e) {
    resetErr.value = e.message
    if (e.code) toast(e.message, 'bad', e.code)
  } finally {
    resetBusy.value = false
  }
}

function toggleReset(id) {
  resetPick.value = resetPick.value.includes(id)
    ? resetPick.value.filter((x) => x !== id)
    : [...resetPick.value, id]
  /* A phrase belongs to a selection. Changing the selection changes what is
   * about to be destroyed, so anything already typed stops being consent. */
  resetPhrase.value = ''
  acceptPrinted.value = false
  previewReset()
}

const resetReady = computed(() => {
  const i = resetInfo.value
  if (!i || !i.total || !i.willReset?.length) return false
  if (i.printed > 0 && !acceptPrinted.value) return false
  return resetPhrase.value.trim().replace(/\s+/g, ' ').toUpperCase() === i.phrase
})

async function applyReset() {
  if (!resetReady.value) return
  resetBusy.value = true
  resetErr.value = ''
  try {
    resetDone.value = await api('reset_apply', {
      features: resetPick.value,
      phrase: resetPhrase.value,
      acceptPrinted: acceptPrinted.value,
    })
    toast('The raffle was reset', 'ok')
    resetPick.value = []
    resetPhrase.value = ''
    acceptPrinted.value = false
    resetInfo.value = null
  } catch (e) {
    resetErr.value = e.message
    if (e.code) toast(e.message, 'bad', e.code)
    /* The counts moved under us. Show the new ones rather than the stale. */
    if (e.code === 'CONFIRM_MISMATCH') previewReset()
  } finally {
    resetBusy.value = false
  }
}

const STATUS_WORDS = {
  active: 'on', pending: 'waiting', suspended: 'paused', banned: 'stopped',
}
const statusOf = u => u.status || (u.active ? 'active' : 'suspended')

/**
 * Only the changes THIS person may actually make to THIS row.
 *
 * Built from the gate's own rules rather than guessed, because offering a
 * button that comes back SUPER_ADMIN_ONLY is the failure this app keeps
 * repeating: a control that looks available, refuses, and leaves somebody
 * pressing it again. The rules, from setUserStatus:
 *   - the super admin's own row cannot be changed from the app at all
 *   - you cannot stop your own account
 *   - anybody who is not a seller is the owner's business only
 *   - letting somebody IN is the owner's alone; pausing them is not
 * Pausing is the urgent one — a lost phone on a Sunday should not wait for the
 * owner to wake up — and it is the only one safe to delegate.
 */
function actionsFor(u) {
  if (u.isSuperAdmin) return []
  const now = statusOf(u)
  const mine = []
  if (isSuper.value) {
    if (now !== 'active') mine.push({ status: 'active', label: 'Let in', tone: 'primary' })
    if (now !== 'suspended' && !u.isYou) mine.push({ status: 'suspended', label: 'Pause' })
    if (now !== 'banned' && !u.isYou) mine.push({ status: 'banned', label: 'Stop' })
    return mine
  }
  // An organiser: sellers only, and never the decision to let somebody in.
  if (u.role !== 'agent' || u.isYou) return []
  if (now !== 'suspended') mine.push({ status: 'suspended', label: 'Pause' })
  if (now !== 'banned') mine.push({ status: 'banned', label: 'Stop' })
  return mine
}

/** The seller a selling account is tied to, by name rather than by id alone. */
function sellerName(id) {
  return state.agents.find(a => a.id === id)?.name || ''
}

/*
 * WHO MAY CHANGE AN ACCOUNT, matching what the server will accept rather than
 * what the table can draw. upsert_user is the owner's; an organiser's attempt
 * comes back as a request for the owner to approve, which is a real path and
 * not an error — so they are offered it too, for the accounts they may ask
 * about. Nobody is offered it against an organiser or the owner: that is the
 * owner's alone and would be refused.
 */
function canEdit(u) {
  if (u.isSuperAdmin) return isSuper.value
  if (u.role === 'admin') return isSuper.value
  return isAdmin.value
}

const SAID = {
  active: 'Let in — they can sign in now',
  suspended: 'Paused — they lose access within a minute',
  banned: 'Stopped — they lose access within a minute',
  pending: 'Set to waiting',
}

async function setStatus(u, status) {
  try {
    await api('set_user_status', { email: u.email, status })
    toast(SAID[status] || 'Changed', 'ok')
    loadUsers()
  } catch (err) { toast(err.message, 'bad', err.code) }
}

const scrubbed = ref(false)

async function loadAudit() {
  audit.value = 'loading'
  try {
    const got = await api('read_audit', { limit: 100 })
    audit.value = got.entries
    scrubbed.value = !!got.scrubbed
  } catch (err) { toast(err.message, 'bad', err.code); audit.value = null }
}

/**
 * The details, as a sentence rather than as [object Object].
 *
 * This was String(e.details) against a jsonb column, so every line of the
 * change log read "[object Object]" — the log had an action, a name, and
 * nothing whatever about what was done. Nobody reported it, which is what a
 * screen only the super admin could open looks like when it is broken.
 *
 * Key: value, in the order the handler wrote them, with lists spelled out. No
 * cleverness: the keys are already words somebody chose (count, status,
 * reason, books), and renaming them here would mean two vocabularies for one
 * record.
 */
function details(d) {
  if (d === null || d === undefined || d === '') return ''
  if (typeof d === 'string') return d
  if (Array.isArray(d)) return d.join(', ')
  return Object.entries(d)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    .join(' · ')
}
</script>

<template>
  <div>
    <h1>Setup</h1>
    <!-- Where the person who would ever quote it can see it. Sellers never open
         this screen, so it costs nobody else any room. -->
    <p class="muted tiny" style="margin:-8px 0 16px">
      Raffled v{{ appVersion }} · {{ appSha }}
    </p>

    <div class="card">
      <div class="spread"><h3 style="margin:0">Who can sign in</h3>
        <button class="btn sm primary" @click="emit('add-user')">Add someone</button></div>
      <p class="muted small">Turn someone off here and they lose access within a minute.</p>

      <div v-if="users === null" class="col" style="gap:10px"><div v-for="i in 3" :key="i" class="skel"></div></div>
      <div v-else class="tablewrap">
        <table>
          <thead><tr><th>Email</th><th>Can do</th><th>As seller</th><th>Status</th><th></th></tr></thead>
          <tbody>
            <tr v-for="u in users" :key="u.email">
              <td>
                {{ u.email }}
                <span v-if="u.isYou" class="pill info">you</span>
                <span v-if="u.isSuperAdmin" class="pill ok">System Admin</span>
              </td>
              <!-- The super admin's row role is only what their ordinary user
                   record says; their actual authority sits outside the database
                   and outranks every role here. Printing "Organiser" against
                   their name read as a ceiling, which it is not. -->
              <td>{{ u.isSuperAdmin ? 'Everything' : (ROLE_WORDS[u.role] || u.role) }}</td>
              <!-- WHICH SELLER THIS ACCOUNT IS, which decides everything a
                   selling account can do and was shown nowhere at all. A seller
                   with no link refuses every sale its owner tries to make, on a
                   screen that tells them the book is with somebody else — whose
                   name is their own. Red, because it is the reason. -->
              <td>
                <template v-if="u.role === 'agent'">
                  <span v-if="u.agentId">{{ sellerName(u.agentId) }}
                    <span class="muted">{{ u.agentId }}</span></span>
                  <span v-else class="bad">no seller</span>
                </template>
                <span v-else class="muted">—</span>
              </td>
              <td>
                <span :class="['pill', statusOf(u) === 'active' ? 'ok'
                                     : statusOf(u) === 'pending' ? 'info' : 'bad']">
                  {{ STATUS_WORDS[statusOf(u)] || statusOf(u) }}
                </span>
              </td>
              <td>
                <!-- Only what this person may actually do to this row. An
                     organiser is not shown "Let in" at all, rather than being
                     shown it and refused. -->
                <!-- upsert_user is keyed on the address, so this is the
                     mechanism that has always existed and had no button. -->
                <button v-if="canEdit(u)" class="btn sm" style="margin-right:6px"
                        @click="emit('edit-user', u)">Change</button>
                <button v-for="a in actionsFor(u)" :key="a.status"
                        :class="['btn', 'sm', a.tone || '']" style="margin-right:6px"
                        @click="setStatus(u, a.status)">{{ a.label }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-if="!isSuper" class="hint">
        Only the System Admin can add or change an organiser.
      </p>
    </div>

    <div v-if="isSuper" class="card">
      <div class="spread">
        <div class="grow">
          <h3 style="margin:0">Who can do what</h3>
          <p class="muted small" style="margin:4px 0 0">
            Turn any feature on or off for each kind of user.
          </p>
        </div>
        <button class="btn" @click="go('permissions')">Open</button>
      </div>
    </div>

    <div v-if="isSuper && c" class="card">
      <div class="spread">
        <div class="grow">
          <h3 style="margin:0">Tickets in play</h3>
          <p class="muted small" style="margin:4px 0 0">
            <template v-if="waiting">
              {{ live.toLocaleString() }} of {{ made.toLocaleString() }} can be sold.
              {{ waiting.toLocaleString() }} are printed and waiting.
            </template>
            <template v-else>
              All {{ live.toLocaleString() }} tickets that have been made are in play.
            </template>
          </p>
        </div>
        <button class="btn" @click="emit('tickets-in-play')">Change</button>
      </div>

      <!-- Creating rows is a different and heavier thing, so it sits under a
           divider rather than beside the everyday button. -->
      <div class="sub">
        <span class="muted small grow">
          <template v-if="allMade">
            All {{ made.toLocaleString() }} planned tickets have been made.
          </template>
          <template v-else>
            Need more than {{ made.toLocaleString() }} tickets altogether?
          </template>
        </span>
        <button v-if="!allMade" class="btn sm ghost" @click="emit('make-tickets')">
          Make more
        </button>
      </div>
    </div>

    <div v-if="c" class="card">
      <h3>How this raffle is set up</h3>
      <div class="tablewrap">
        <table>
          <tbody>
            <tr><td>Tickets in play</td><td>{{ live.toLocaleString() }} — {{ c.ticketPrefix }}{{ String(c.ticketStart).padStart(c.ticketDigits, '0') }} onwards</td></tr>
            <tr v-if="waiting"><td>Printed and waiting</td><td>{{ waiting.toLocaleString() }}</td></tr>
            <tr v-if="waiting"><td>Made altogether</td><td>{{ made.toLocaleString() }}</td></tr>
            <tr v-if="c.ticketCeiling"><td>Planned total</td><td>{{ c.ticketCeiling.toLocaleString() }}</td></tr>
            <tr><td>In each book</td><td>{{ c.ticketsPerBook }} — that makes {{ c.totalBooks }} books</td></tr>
            <tr><td>Price</td><td>{{ money(c.ticketPrice, c.currency) }} each</td></tr>
            <tr><td>If all sold</td><td>{{ money(live * c.ticketPrice, c.currency) }}<span v-if="waiting" class="muted small"> — of what is in play</span></td></tr>
            <tr>
              <td>Everybody reports by</td>
              <td>
                {{ c.checkInDate ? date(c.checkInDate) : 'not set' }}
                <span class="muted small">— the same date for every seller</span>
              </td>
            </tr>
            <tr>
              <td>Everything back by</td>
              <td>
                <template v-if="c.finalDeadline">{{ date(c.finalDeadline) }}</template>
                <span v-else class="pill warn">not set</span>
              </td>
            </tr>
            <tr><td>Draw date</td><td>{{ c.drawDate || 'not set' }}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="sub">
        <span class="muted small grow">
          The check-in date moves on a month at a time, up to the final deadline.
        </span>
        <button class="btn sm ghost" @click="emit('deadlines')">Deadlines</button>
      </div>
      <!-- Backend-aware, because it names WHERE the settings live and the two
           backends keep them in different places. On Supabase the spreadsheet
           is not read by anything, so sending somebody to its Config tab sends
           them somewhere that cannot work — and they would see the change stick
           in the sheet and nothing happen in the app. -->
      <p class="hint">
        Ticket numbers are fixed once the tickets are made — the database
        refuses to change them, because every number already printed was built
        from them. The dates and the number of tickets are changed here.
        Anything else — the price, the event name, how many to a book — is in
        the <b>config</b> table, which whoever set this up can open.
      </p>
    </div>

    <div class="card">
      <h3>How this raffle looks</h3>
      <p class="muted small">
        Your own logo and colour, on every screen and on the receipt a seller hands over.
      </p>

      <div class="row wrap gap" style="align-items:flex-start;margin-top:12px">
        <div class="col" style="align-items:center;gap:8px">
          <Logo :size="76" big />
          <span class="tiny muted">{{ c?.orgLogo ? 'Your logo' : 'Raffled\u2019s mark' }}</span>
        </div>

        <div class="col grow" style="gap:8px;min-width:220px">
          <button class="btn sm" :disabled="logoBusy" @click="logoInput?.click()">
            {{ logoBusy ? 'Uploading\u2026' : (c?.orgLogo ? 'Replace logo' : 'Upload a logo') }}
          </button>
          <input ref="logoInput" type="file" accept="image/png,image/jpeg,image/webp"
                 :disabled="logoBusy" @change="pickLogo" hidden>
          <p class="tiny muted">
            PNG, JPEG or WebP. It is shrunk on this device before it is sent, so a
            large file is fine — and a small one reaches every volunteer\u2019s phone faster.
          </p>
          <button v-if="c?.orgLogo" class="btn sm ghost" :disabled="logoBusy"
                  @click="removeLogo">Remove logo</button>
          <p v-if="logoErr" class="note bad tiny">{{ logoErr }}</p>
          <p v-if="!c?.orgLogo" class="tiny muted">
            Until one is set, the mark above is drawn in the colour below.
          </p>
        </div>
      </div>

      <div class="field" style="margin-top:18px">
        <label for="bc">Colour</label>
        <div class="row wrap gap" style="align-items:center">
          <input id="bc" type="color" class="swatch" :value="previewBrand"
                 @input="brand = $event.target.value">
          <!-- Typed as well as picked: a brand colour usually arrives as a
               string in an email from whoever made the logo, and a swatch alone
               makes somebody eyeball-match it. -->
          <input v-model="brand" style="max-width:150px" placeholder="#0d7a6f"
                 spellcheck="false" aria-label="Colour code">
          <span v-if="brand && !inkFor(brand)" class="pill bad">not a colour</span>
        </div>
      </div>

      <!-- The real button with its real words, not a colour square. What goes
           wrong with a chosen colour is contrast on the control that says
           "Count a book in", and a square cannot show that. -->
      <p class="tiny muted" style="margin:12px 0 6px">This is how a button will read:</p>
      <span class="btn primary"
            :style="{ background: previewBrand, borderColor: previewBrand, color: previewInk }">
        Count a book in
      </span>

      <div class="sub">
        <span class="muted small grow">
          Previewed at once, saved when you say so. Clear the box and save to go
          back to Raffled&rsquo;s own colour.
        </span>
        <button class="btn sm ghost" :disabled="brandSaving" @click="revertBrand">Undo</button>
        <button class="btn sm primary" :disabled="brandSaving || (!!brand && !inkFor(brand))"
                @click="saveBrand">{{ brandSaving ? 'Saving\u2026' : 'Save colour' }}</button>
      </div>

      <!-- The ticket itself is a screen of its own rather than another card
           here: it carries a picture, a live preview and a dozen measurements,
           and none of that belongs beside a colour swatch. -->
      <div class="sub" style="margin-top:14px">
        <span class="muted small grow">
          The ticket your buyers hold &mdash; its artwork, and where the number is printed on it.
          <template v-if="!c?.ticketArtwork"><b>No artwork uploaded yet</b>, so tickets cannot be printed.</template>
        </span>
        <button class="btn sm" @click="go('ticketdesign')">Ticket design &rarr;</button>
      </div>
    </div>

    <!-- An organiser may read the change log of their own raffle. It used to be
         behind isSuper, which meant the person actually running the raffle
         could not answer "who changed this book" about their own books. -->
    <div class="card">
      <div class="spread"><h3 style="margin:0">What people have been doing</h3>
        <button class="btn sm" @click="loadAudit">Show</button></div>
      <div v-if="audit === 'loading'" class="col" style="gap:10px">
        <div v-for="i in 3" :key="i" class="skel"></div>
      </div>
      <div v-else-if="audit">
        <!-- Said out loud, so "the system admin" reads as a deliberate omission
             rather than as a gap somebody has to wonder about. -->
        <p v-if="scrubbed" class="tiny muted">
          Everything is here. The system admin's own actions show as
          <b>the system admin</b> rather than by email address.
        </p>
        <div v-for="(e, i) in audit" :key="i" class="log">
          <div class="small"><b>{{ e.action }}</b> <span class="muted">{{ e.email }}</span></div>
          <!-- e.time never existed: the column is `at`, so every line read "—". -->
          <div class="tiny muted">{{ dateTime(e.at) }}<template v-if="details(e.details)"> · {{ details(e.details).slice(0, 160) }}</template></div>
        </div>
      </div>
      <p v-else class="hint">Every change anybody has made, most recent first.</p>
    </div>

    <!--
      LAST ON THE SCREEN, and only for the system admin. It is the only control
      here that destroys anything, and it is not something to meet on the way to
      something else.
    -->
    <div v-if="isSuper" class="card wipe">
      <div class="spread">
        <h3 style="margin:0">Reset this raffle</h3>
        <button class="btn sm" :disabled="resetBusy" @click="previewReset">
          {{ resetInfo ? 'Refresh' : 'Show' }}
        </button>
      </div>
      <p class="muted small">
        Empties what you choose, and cannot be undone. Nothing goes until you have
        seen the counts and typed them back. There is no backup in here &mdash; take
        one first if this raffle holds anything worth keeping.
      </p>

      <template v-if="resetInfo">
        <ul class="feats">
          <li v-for="f in resetInfo.features" :key="f.id">
            <label class="choice">
              <input type="checkbox" :checked="resetPick.includes(f.id)"
                     :disabled="!f.offered || resetBusy"
                     :title="f.offered ? `Reset ${f.name}` : f.never"
                     @change="toggleReset(f.id)">
              <span>{{ f.name }}
                <span class="why">{{ f.offered ? f.why : f.never }}</span>
              </span>
            </label>
          </li>
        </ul>

        <template v-if="resetPick.length">
          <p v-if="resetInfo.added.length" class="note tiny">
            <b>This takes more with it.</b>
            <span v-for="a in resetInfo.added" :key="a.id"><br>{{ a.name }} &mdash; {{ a.why }}</span>
          </p>
          <p v-if="resetInfo.refused.length" class="note bad tiny">
            <span v-for="r in resetInfo.refused" :key="r.id">{{ r.why }}<br></span>
          </p>
          <p v-if="resetInfo.loosens.length" class="note tiny">
            <b>These rows stay, pointing at nothing.</b>
            <span v-for="l in resetInfo.loosens" :key="l.table + l.by"><br>{{ l.why }}</span>
          </p>

          <table v-if="resetInfo.total" class="counts">
            <tbody>
              <tr v-for="(n, t) in resetInfo.counts" :key="t">
                <td>{{ String(t).replace(/_/g, ' ') }}</td>
                <td class="n">{{ n }}</td>
              </tr>
              <tr class="tot"><td>in total</td><td class="n">{{ resetInfo.total }}</td></tr>
            </tbody>
          </table>
          <p v-else class="tiny muted">There is nothing in what you chose.</p>

          <label v-if="resetInfo.printed > 0" class="choice">
            <input v-model="acceptPrinted" type="checkbox">
            <span>Yes, stop {{ resetInfo.printed }} printed ticket{{ resetInfo.printed === 1 ? '' : 's' }} verifying
              <span class="why">
                They are on paper in people&rsquo;s hands. Emptying their codes means
                whoever holds one is told no ticket matches their link.
              </span>
            </span>
          </label>

          <template v-if="resetInfo.total">
            <p class="tiny muted" style="margin-top:10px">Type this, exactly:</p>
            <p class="phrase">{{ resetInfo.phrase }}</p>
            <input v-model="resetPhrase" class="phrasein" spellcheck="false"
                   aria-label="Type the confirmation" placeholder="Type it here">
            <button class="btn danger wide" :disabled="!resetReady || resetBusy"
                    :title="resetReady ? 'Empty everything listed above' : 'Tick what to reset, then type the line above exactly'"
                    @click="applyReset">
              {{ resetBusy ? 'Working…' : 'Reset it' }}
            </button>
          </template>
        </template>
        <p v-else class="tiny muted">Choose what to empty.</p>
      </template>

      <p v-if="resetErr" class="note bad tiny">{{ resetErr }}</p>
      <p v-if="resetDone" class="note tiny">
        Reset: {{ resetDone.reset.map(r => r.name).join(', ') }} &mdash; {{ resetDone.total }} rows.
      </p>
    </div>
  </div>
</template>

<style scoped>
.swatch {
  width: 46px; height: 38px; padding: 2px;
  cursor: pointer; flex: 0 0 auto;
}

.sub {
  display: flex; align-items: center; gap: 10px;
  margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border);
}
.log { padding: 10px 0; border-bottom: 1px solid var(--border); }
.log:last-child { border-bottom: 0; }

/* The one card here that destroys things, edged so it does not read as another
 * settings box. */
.wipe { border-left: 3px solid var(--bad); }
.feats { list-style: none; margin: 10px 0 0; padding: 0 }
.feats li { border-bottom: 1px solid var(--border) }
.feats li:last-child { border-bottom: 0 }
.counts { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 10px }
.counts td { padding: 3px 0; border-bottom: 1px solid var(--border) }
.counts td.n { text-align: right; font-variant-numeric: tabular-nums;
               font-family: ui-monospace, SFMono-Regular, Menlo, monospace }
.counts tr.tot td { font-weight: 600; border-bottom: 0 }
/* The sentence is the thing being agreed to, so it is set as a quotation rather
 * than as body text somebody skims past. */
.phrase {
  margin: 4px 0 8px; padding: 10px 12px; border-radius: var(--r-sm);
  background: var(--bad-soft); color: var(--bad); font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-word;
}
.phrasein { width: 100%; font-family: ui-monospace, SFMono-Regular, Menlo, monospace }
.btn.danger { background: var(--bad); color: #fff; border-color: var(--bad) }
.btn.danger:disabled { opacity: .5 }
.wide { width: 100%; margin-top: 10px }
</style>
