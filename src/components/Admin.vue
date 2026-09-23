<script setup>
/**
 * Who can sign in, and what the raffle is set to.
 *
 * The super admin is a rung above admin: it lives in a Script Property, outside
 * the spreadsheet, so nothing in this screen can grant it or take it away.
 */
import { ref, onMounted, computed, watch } from 'vue'
import { state, setConfig, api, toast, isAdmin, isSuper, go } from '../lib/store.js'
import { money, date, dateTime, ROLE_WORDS, orgNameOf, APP_NAME } from '../lib/format.js'
import { applyBrand, inkFor } from '../lib/brand.js'
import { PRESETS, SLOTS, DEFAULT_BOOKS, presetById, ladderFrom } from '../lib/ranks.js'
/* The rung's position as the buyer's card draws it, so Setup and the seal
   cannot number one ladder two ways. */
import { RUNG_NUMERAL } from '../lib/cardbadges.js'
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

/*
 * What the SWATCH shows. The examples below no longer need a companion for the
 * ink: applyBrand() has already put --brand-ink on the document by the time
 * they render, so they read the same token every other screen does. A second
 * computed copy of that decision was one more place for the preview and the
 * app to disagree.
 */
const previewBrand = computed(() => inkFor(brand.value) ? brand.value.replace(/^#?/, '#') : 'var(--brand)')

/* ---------- how to reach the raffle ---------- */

/**
 * The office number, address and website.
 *
 * WHY THEY EXIST AT ALL, and it is not "an organisation has contact details".
 * The public ticket-check page is opened by a stranger holding a paper ticket,
 * and its worst moment is the one where the ticket does not verify. Until now
 * that page could say only that it did not match. "Ring the office" had nothing
 * to ring. These three fields are what it offers instead.
 *
 * ALL THREE ARE OPTIONAL AND BLANK IS A REAL VALUE. An organiser taking a
 * number down is as ordinary as putting one up, so an empty box is sent as an
 * empty string rather than skipped — skipping it would make removal impossible
 * from the only screen that can do it.
 *
 * NO SECOND COPY OF THE RULES. The server validates and its refusals are
 * written to be read by whoever typed — BAD_PHONE says what a number may
 * contain, BAD_WEBSITE says a link has to start with https:// and why. A
 * client-side regex beside them would be a second definition to drift, and the
 * one that a person actually hits is the server's.
 */
/*
 * One sentence, used on every control in the card. `permissionui`: a control
 * somebody cannot use is shown disabled WITH THE REASON, never hidden — and
 * five copies of the reason is five things to reword badly.
 */
const ADMIN_ONLY_WHY = 'Only an organiser can change how the raffle is contacted'

const contact = ref({ phone: '', email: '', website: '' })
const savedContact = ref({ phone: '', email: '', website: '' })
const contactSaving = ref(false)
const contactErr = ref('')

function seedContact() {
  savedContact.value = {
    phone: c.value?.orgPhone || '',
    email: c.value?.orgEmail || '',
    website: c.value?.orgWebsite || '',
  }
  contact.value = { ...savedContact.value }
}
const contactDirty = computed(() =>
  contact.value.phone !== savedContact.value.phone ||
  contact.value.email !== savedContact.value.email ||
  contact.value.website !== savedContact.value.website)

onMounted(seedContact)
/*
 * AND AGAIN WHEN THE CONFIG ARRIVES. On a cold load this screen mounts before
 * whoami has answered, so seeding on mount alone fills the boxes from a config
 * that is not there yet and they stay empty over real stored values — the
 * organiser then sees three blank fields and concludes nothing was ever saved.
 * Re-seeding is skipped once they have typed, or a slow reply would wipe what
 * they are in the middle of writing.
 */
watch(() => [c.value?.orgPhone, c.value?.orgEmail, c.value?.orgWebsite].join('\u0000'),
      () => { if (!contactDirty.value) seedContact() })

async function saveContact() {
  contactErr.value = ''
  contactSaving.value = true
  try {
    // Sent as a set, always all three. The handler writes all three keys, so a
    // partial payload would blank the two that were left out.
    const r = await api('set_org_contact', {
      phone: contact.value.phone.trim(),
      email: contact.value.email.trim(),
      website: contact.value.website.trim(),
    })
    if (r?.config) setConfig(r.config)
    seedContact()
    toast('Contact details saved', 'ok')
  } catch (err) {
    /*
     * INLINE, NOT A TOAST. Every one of these refusals is a correction to
     * something still on the screen, and a toast slides away while the person
     * is still looking at the box it was about.
     */
    contactErr.value = err.message
  } finally { contactSaving.value = false }
}

/*
 * WHAT THE PUBLIC TICKET-CHECK PAGE SAYS THIS RAFFLE IS.
 *
 * The page carries a paragraph under every verdict describing what somebody
 * has been handed. It shipped as a fixed sentence about volunteers and a
 * community, which is true of the raffle it was written for and is not what
 * every organiser would write — and there was no way to change it short of a
 * deploy. Both halves are optional and each falls back on its own, so an
 * organiser who writes only Burmese has improved the page for nearly everybody
 * who scans a ticket without being made to write English first.
 */
/* Matches ABOUT_MAX in supabase/functions/api/branding.ts. */
const ABOUT_MAX = 600
const about = ref({ my: '', en: '' })
const savedAbout = ref({ my: '', en: '' })
const aboutSaving = ref(false)
const aboutErr = ref('')

function seedAbout() {
  savedAbout.value = {
    my: c.value?.orgAboutMy || '',
    en: c.value?.orgAboutEn || '',
  }
  about.value = { ...savedAbout.value }
}
const aboutDirty = computed(() =>
  about.value.my !== savedAbout.value.my ||
  about.value.en !== savedAbout.value.en)

onMounted(seedAbout)
// Re-seeded when the config lands, and skipped once they have typed — the same
// cold-load problem the contact boxes have, for the same reason.
watch(() => [c.value?.orgAboutMy, c.value?.orgAboutEn].join('\u0000'),
      () => { if (!aboutDirty.value) seedAbout() })

async function saveAbout() {
  aboutErr.value = ''
  aboutSaving.value = true
  try {
    // Both halves every time: the handler writes both keys, so a partial
    // payload would blank the one left out.
    const r = await api('set_org_about', {
      my: about.value.my.trim(),
      en: about.value.en.trim(),
    })
    if (r?.config) setConfig(r.config)
    seedAbout()
    toast('Description saved', 'ok')
  } catch (err) {
    // Inline, beside the box it is about — a toast slides away while the
    // person is still reading the sentence they just typed.
    aboutErr.value = err.message
  } finally { aboutSaving.value = false }
}

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

/*
 * THE NUMBERING, EDITABLE FOR THE ONE WINDOW IT CAN BE.
 *
 * Every ticket number is stored on its row, so changing the prefix after the
 * first ticket exists does not renumber anything — it makes the setting
 * disagree with the paper. The database refuses it and so does the server; this
 * shows the fields DISABLED WITH THE REASON rather than hiding them, per
 * permissionui, so an organiser learns why instead of concluding it is missing.
 *
 * It had no control anywhere before this. A raffle generated with the wrong
 * prefix was wrong for its whole life, and the only way out was emptying it.
 */
const nb = ref({ ticketPrefix: '', ticketDigits: 5, ticketStart: 1,
                 ticketsPerBook: 10, bookPrefix: 'Book-', bookDigits: 4 })
const nbSaving = ref(false)
const numberingLocked = computed(() => made.value > 0)
const numberingWhy = computed(() => (numberingLocked.value
  ? `${made.value.toLocaleString()} tickets already exist. Every number written down was built `
    + 'from these settings, so changing them would stop the tickets matching.'
  : ''))
const nbExample = computed(() =>
  String(nb.value.ticketPrefix || '')
  + String(Math.max(0, Number(nb.value.ticketStart) || 0))
      .padStart(Math.min(9, Math.max(1, Number(nb.value.ticketDigits) || 1)), '0'))

function loadNumbering() {
  const cf = c.value || {}
  nb.value = {
    ticketPrefix: cf.ticketPrefix ?? '', ticketDigits: cf.ticketDigits ?? 5,
    ticketStart: cf.ticketStart ?? 1, ticketsPerBook: cf.ticketsPerBook ?? 10,
    bookPrefix: cf.bookPrefix ?? 'Book-', bookDigits: cf.bookDigits ?? 4,
  }
}
watch(c, loadNumbering, { immediate: true })

async function saveNumbering() {
  nbSaving.value = true
  try {
    const r = await api('set_numbering', { ...nb.value })
    if (r?.config) setConfig(r.config)
    loadNumbering()
    toast(`Numbering saved — the first ticket will be ${r?.example || nbExample.value}`, 'ok')
  } catch (err) {
    toast(err.message, 'bad', err.code)
    loadNumbering()
  } finally { nbSaving.value = false }
}

/*
 * WHAT THIS RAFFLE CALLS ITS SUPPORTERS.
 *
 * Five rungs, lowest first, each a name and a threshold in whole BOOKS. The
 * ladder used to be four words written into the code, rewritten three times in
 * two days while people argued about which vocabulary was right. It was the
 * wrong argument: the same app runs a raffle for a community centre, a refugee
 * learning centre, a fellowship and a shelter, and "Mentor" is right in one of
 * those rooms and meaningless in another.
 *
 * WHAT IS NOT SETTABLE HERE, and the screen says so rather than leaving it to
 * be assumed: WHO is on a rung. That is counted from the tickets a buyer holds,
 * by the same function on both sides of the wall, and there is no screen
 * anywhere that awards one. An organiser chooses what to call five books.
 */
const bands = ref({ preset: '', rungs: [] })
const bandsSaving = ref(false)

function loadBands() {
  const stored = state.cfg?.supporterBands
  const rungs = Array.isArray(stored?.rungs) && stored.rungs.length === SLOTS.length
    ? stored.rungs.map((r) => ({ name: String(r.name ?? ''), minBooks: Number(r.minBooks ?? 0) }))
    : [...ladderFrom(stored)].reverse().map((r) => ({ name: r.name, minBooks: r.minBooks }))
  bands.value = { preset: String(stored?.preset ?? ''), rungs }
}

/*
 * IMMEDIATE, AND BELOW `bands` RATHER THAN THIRTY LINES ABOVE IT.
 *
 * Immediate for the same reason as numbering: this screen mounts before the
 * config arrives on a cold load, so a one-shot read on mount leaves every rung
 * blank until something else happens to touch it.
 *
 * IT SAT BEFORE THE `const bands` IT ASSIGNS TO, and `immediate: true` means
 * the callback runs SYNCHRONOUSLY during setup — inside that ref's temporal
 * dead zone. `loadBands` has no early return, so it reached `bands.value` and
 * threw on every single mount. Vue catches a watcher's error and reports it to
 * the app's error handler, and this app installs none, so it was a console
 * warning nobody was reading and nothing else at all.
 *
 * What it cost: the guard the comment above describes never once worked. On a
 * cold load the rungs filled anyway, because `c` changes when config arrives
 * and the watcher ran again properly — which is exactly why nobody saw it. On
 * a warm navigation to Setup, with config already loaded and `c` never
 * changing again, the editor would have kept `{ preset: '', rungs: [] }`.
 *
 * Found by rendering this card rather than by reading it, and it reproduces on
 * HEAD as well as on this change, so it is not something today introduced.
 */
watch(c, loadBands, { immediate: true })

/*
 * A preset fills the WORDS and leaves the thresholds alone. The two are
 * independent — a raffle may want a fellowship's vocabulary at its own book
 * counts — and overwriting numbers somebody had tuned, because they clicked a
 * column of names, is the kind of helpfulness that gets undone by hand.
 */
function applyPreset(id) {
  const preset = presetById(id)
  bands.value = {
    preset: preset.id,
    rungs: preset.rungs.map((name, i) => ({
      name,
      minBooks: Number(bands.value.rungs[i]?.minBooks ?? DEFAULT_BOOKS[i]),
    })),
  }
}

/*
 * THE ONE RULE A LADDER HAS TO OBEY, checked here so the reason is on screen
 * rather than in a toast after a refused save. rankFor takes the FIRST rung
 * whose threshold is met, reading from the top, so a rung that does not sit
 * strictly above the one below it can never be returned — it stays listed,
 * stays named, and simply never happens to anybody.
 */
const bandsFault = computed(() => {
  const rungs = bands.value.rungs || []
  for (let i = 0; i < rungs.length; i++) {
    const name = String(rungs[i]?.name ?? '').trim()
    if (!name) return `Rung ${i + 1} has no name, and every rung is printed on somebody's card.`
    if (name.length > 24) return `Rung ${i + 1} is ${name.length} characters and a card holds 24.`
    const n = Number(rungs[i]?.minBooks)
    if (!Number.isFinite(n) || n < 0 || n !== Math.floor(n)) {
      return `Rung ${i + 1} needs a whole number of books, counting from 0.`
    }
    if (i > 0 && n <= Number(rungs[i - 1].minBooks)) {
      return `${name} starts at ${n} books, which is not above ${rungs[i - 1].name} `
        + `at ${rungs[i - 1].minBooks}. Nobody could ever reach it.`
    }
  }
  return ''
})

/*
 * WHAT A RUNG COSTS A BUYER, so the ladder is chosen against money rather than
 * against book counts nobody converts in their head.
 *
 * NOTHING FOR THE BOTTOM RUNG, and that is the fix rather than a gap. It read
 * "any tickets · RM 10.00", which is the price of the ONE ticket it takes to
 * get there and reads as the price of the rung. Every other row is "3 books ·
 * RM 300" — a floor — so a number in the same column on the row that HAS no
 * floor says the opposite of what the row means. The words carry it alone.
 *
 * Absent rather than zero when the raffle has no price or book size set yet,
 * which is the state a new raffle is in.
 */
function rungWorth(minBooks) {
  const per = Number(state.cfg?.ticketsPerBook ?? 0)
  const price = Number(state.cfg?.ticketPrice ?? 0)
  if (!per || !price || !minBooks) return ''
  return money(minBooks * per * price, state.cfg?.currency)
}

async function saveBands() {
  bandsSaving.value = true
  try {
    const r = await api('set_supporter_bands', {
      preset: bands.value.preset,
      rungs: bands.value.rungs.map((x) => ({ name: String(x.name).trim(), minBooks: Number(x.minBooks) })),
    })
    if (r?.config) setConfig(r.config)
    loadBands()
    toast('Supporter rungs saved', 'ok')
  } catch (err) {
    toast(err.message, 'bad', err.code)
    loadBands()
  } finally { bandsSaving.value = false }
}

/*
 * THE TWO SENTENCES THE SUPPORTER CARD SAYS, and the reason they are HERE
 * rather than in Ticket Studio.
 *
 * The studio is where a card is DRAWN — artwork, boxes, which treatment. These
 * are what the raffle claims: what somebody could win, and what their money
 * does. An organiser writes those once for the whole raffle and never touches
 * them again, which is Setup's job; putting them in the studio would file a
 * fundraising decision under a design tool.
 *
 * They ride on set_card_design because that call is already the card's WORDS —
 * the motto has always been set there — and a second endpoint writing a third
 * sentence onto the same object is a second place for two screens to disagree
 * about what a card holds.
 */
const cardWords = ref({ topPrize: '', impactLine: '' })
const wordsSaving = ref(false)
const wordsDirty = computed(() =>
  cardWords.value.topPrize !== String(c.value?.topPrize ?? '')
  || cardWords.value.impactLine !== String(c.value?.impactLine ?? ''))

function loadCardWords() {
  cardWords.value = {
    topPrize: String(c.value?.topPrize ?? ''),
    impactLine: String(c.value?.impactLine ?? ''),
  }
}
watch(c, loadCardWords, { immediate: true })

async function saveCardWords() {
  wordsSaving.value = true
  try {
    /*
     * The treatment and the motto go back UNCHANGED rather than being left
     * out. setCardDesign writes CARD_DESIGN and MOTTO on every call — omitting
     * them would blank the raffle's motto every time somebody saved a prize.
     * The two new lines are the ones that may be absent, and absent means
     * "do not touch" on that side.
     */
    const r = await api('set_card_design', {
      cardDesign: String(c.value?.cardDesign ?? ''),
      motto: String(c.value?.motto ?? ''),
      topPrize: cardWords.value.topPrize.trim(),
      impactLine: cardWords.value.impactLine.trim(),
    })
    if (r?.config) setConfig(r.config)
    toast('Saved', 'ok')
  } catch (err) {
    toast(err.message, 'bad', err.code)
    loadCardWords()
  } finally { wordsSaving.value = false }
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
/* ---------- filling a raffle with sample data ---------- */

/*
 * THE CONSTRUCTIVE HALF OF THE SAME CONTROL, and it sits ABOVE the reset
 * because of what each one is for. This is what a new install needs; the reset
 * is what a finished raffle needs, and meeting it on the way to this one is how
 * somebody empties a raffle they meant to fill.
 *
 * It is built exactly like the reset — the feature list comes from the server,
 * the counts come from the code that does the work, and the confirmation is
 * typed. The differences are the two that matter and both are deliberate:
 *
 *   IT SAYS WHAT IT WOULD MAKE BEFORE MAKING IT, in the same shape the reset
 *   says what it would destroy, so the two screens read as one idea.
 *
 *   AND THE SERVER CAN REFUSE THE WHOLE THING. A raffle that has printed a
 *   ticket, taken a payment or recorded a sale by a real person is in use, and
 *   sample sellers must never join it. That refusal is shown here as a sentence
 *   with the reason, not as a failed press.
 */
const seedInfo = ref(null)
const seedPick = ref([])
const seedSize = ref('')
const seedPhrase = ref('')
const seedBusy = ref(false)
const seedErr = ref('')
const seedDone = ref(null)
/* Same window as the reset: the browser app deploys on a push and the edge
 * function is deployed by hand, so this screen can exist before the action
 * behind it does. A sentence, not an error. */
const seedUnavailable = ref(false)

async function previewSeed() {
  seedBusy.value = true
  seedErr.value = ''
  seedDone.value = null
  try {
    seedInfo.value = await api('seed_preview', {
      features: seedPick.value,
      size: seedSize.value,
    })
    /* The server owns the list of sizes and which one is the default. Taking it
     * from the answer rather than naming one here is what stops the screen
     * offering a size the server does not have. */
    if (!seedSize.value) seedSize.value = seedInfo.value.size
  } catch (e) {
    if (e.code === 'UNKNOWN_ACTION') {
      seedUnavailable.value = true
    } else {
      seedErr.value = e.message
      if (e.code) toast(e.message, 'bad', e.code)
    }
  } finally {
    seedBusy.value = false
  }
}

function toggleSeed(id) {
  seedPick.value = seedPick.value.includes(id)
    ? seedPick.value.filter((x) => x !== id)
    : [...seedPick.value, id]
  /* A phrase belongs to a selection, and the counts in it change with one. */
  seedPhrase.value = ''
  previewSeed()
}

function pickSize(id) {
  seedSize.value = id
  seedPhrase.value = ''
  previewSeed()
}

const seedReady = computed(() => {
  const i = seedInfo.value
  if (!i || i.inUse || !i.total || !i.willFill?.length) return false
  return seedPhrase.value.trim().replace(/\s+/g, ' ').toUpperCase() === i.phrase
})

async function applySeed() {
  if (!seedReady.value) return
  seedBusy.value = true
  seedErr.value = ''
  try {
    seedDone.value = await api('seed_apply', {
      features: seedPick.value,
      size: seedSize.value,
      phrase: seedPhrase.value,
    })
    toast('The raffle was filled with sample data', 'ok')
    seedPick.value = []
    seedPhrase.value = ''
    seedInfo.value = null
  } catch (e) {
    seedErr.value = e.message
    if (e.code) toast(e.message, 'bad', e.code)
    /*
     * BOTH OF THESE MEAN THE ANSWER ON SCREEN IS STALE, and for opposite
     * reasons. A mismatch means the counts moved; a stop part way means some of
     * it is now there. Either way the next thing this person needs is the
     * current state rather than the one they were looking at.
     */
    if (e.code === 'CONFIRM_MISMATCH' || e.code === 'SEED_FAILED') previewSeed()
  } finally {
    seedBusy.value = false
  }
}

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
/*
 * THE SERVER MIGHT NOT HAVE THIS YET, and that has to be a sentence rather than
 * an error.
 *
 * A push to master deploys the browser app on its own; the edge function is
 * deployed by hand. So there is always a window — minutes if somebody is
 * watching, longer if they are not — where this screen exists and the action
 * behind it does not. Left alone the System Admin presses Show and gets
 * "unknown action", which reads as the app being broken rather than as a deploy
 * half done.
 *
 * Saying so turns a deploy ORDER into a deploy PREFERENCE: migration, function,
 * push is still right, but getting it wrong now costs a sentence instead of a
 * dead control on the most dangerous screen in the app.
 */
const resetUnavailable = ref(false)

async function previewReset() {
  resetBusy.value = true
  resetErr.value = ''
  resetDone.value = null
  try {
    resetInfo.value = await api('reset_preview', { features: resetPick.value })
  } catch (e) {
    if (e.code === 'UNKNOWN_ACTION') {
      resetUnavailable.value = true
    } else {
      resetErr.value = e.message
      if (e.code) toast(e.message, 'bad', e.code)
    }
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
    <!-- Where the person who would ever quote it can see it. Sellers never open
         this screen, so it costs nobody else any room. Beside the heading
         rather than under it: it belongs to the screen, not to the first card,
         and stacked under a h1 it read as a subtitle for "Setup".

         The sha is set in --font-data because it is read character by
         character — somebody types it into a bug report having compared it
         against a deploy log, and 48ed3f8 against 48e6f38 is exactly the
         comparison a proportional face makes hardest. -->
    <div class="spread" style="margin-bottom:16px">
      <h1>Setup</h1>
      <p class="muted tiny" style="margin:0">
        {{ APP_NAME }} v{{ appVersion }} &middot; <span class="data">{{ appSha }}</span>
      </p>
    </div>

    <!--
      FOUR GROUPS, AND THE GROUP IS A HEADING PLUS SPACE, NOT A BOX.

      This screen was twelve sibling `.card` blocks at one visual weight, every
      heading an h3, in no stated order. That is not merely slow to scan: a
      stack of equals is the measured signature of a design people rate badly,
      because the eye has nothing to prune by and ends up reading everything or
      nothing.

      IT ALSO HID A BROKEN CARD FOR MONTHS. `Supporter titles` had a watcher
      throwing inside a const's temporal dead zone, so its list never loaded on
      warm navigation — and nobody noticed, because an empty rung list is
      exactly what a raffle that has not set its rungs up looks like. There was
      no anomaly to see. A card at the same weight as eleven others gets
      scanned, not read, and that was the last cue gone.

      NO NEW CONTAINERS. Four boxes around twelve boxes adds eight edges and
      removes none, and edge density is the most expensive kind of visual
      complexity there is. A group here is a small label and 32px of air above
      it, against the 14px that separates two cards — more space around a group
      than within it, which is the whole mechanism.

      AND NOTHING INSIDE A CARD IS TOUCHED. The regroup moves cards; it does
      not rewrite them. That boundary is what stops a grouping pass quietly
      undoing somebody else's work — `Supporter titles` and the printed
      Supporter card were deliberately aligned to say the earned word first
      with the evidence quiet underneath, and a pass that edits card internals
      can flatten that without anybody noticing.
    -->
    <h2 class="section">People</h2>

    <div class="card">
      <div class="spread"><h3>Who can sign in</h3>
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
          <h3>Who can do what</h3>
          <p class="muted small" style="margin:4px 0 0">
            Turn any feature on or off for each kind of user.
          </p>
        </div>
        <button class="btn" @click="go('permissions')">Open</button>
      </div>
    </div>
    <!-- An organiser may read the change log of their own raffle. It used to be
         behind isSuper, which meant the person actually running the raffle
         could not answer "who changed this book" about their own books. -->
    <div class="card">
      <div class="spread"><h3>What people have been doing</h3>
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


    <h2 class="section">The raffle itself</h2>

    <div v-if="isSuper && c" class="card">
      <div class="spread">
        <div class="grow">
          <h3>Tickets in play</h3>
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
          <!--
            "Make more" is the wrong verb when there are none. A raffle that has
            never made a ticket reads "Need more than 0 tickets altogether?" over
            a button offering to add to nothing, and the one moment this control
            matters most — the first run — is the one it was not written for.
          -->
          <template v-else-if="!made">
            No tickets have been made yet.
          </template>
          <template v-else>
            Need more than {{ made.toLocaleString() }} tickets altogether?
          </template>
        </span>
        <button v-if="!allMade" class="btn sm ghost" @click="emit('make-tickets')">
          {{ made ? 'Make more' : 'Make the first tickets' }}
        </button>
      </div>
    </div>

    <div v-if="c && isSuper" class="card">
      <h3>Ticket numbering</h3>
      <p class="muted small">
        <template v-if="numberingLocked">{{ numberingWhy }}</template>
        <template v-else>
          Set before the first ticket is made. It cannot be changed afterwards,
          because the number is written onto every ticket as it is created.
        </template>
      </p>

      <div class="nbgrid">
        <div class="field">
          <label for="nbp">Ticket prefix</label>
          <input id="nbp" v-model="nb.ticketPrefix" autocomplete="off" placeholder="e.g. KS-"
                 :disabled="numberingLocked" :title="numberingWhy">
        </div>
        <div class="field">
          <label for="nbd">Digits</label>
          <input id="nbd" v-model.number="nb.ticketDigits" inputmode="numeric"
                 :disabled="numberingLocked" :title="numberingWhy">
        </div>
        <div class="field">
          <label for="nbs">First number</label>
          <input id="nbs" v-model.number="nb.ticketStart" inputmode="numeric"
                 :disabled="numberingLocked" :title="numberingWhy">
        </div>
        <div class="field">
          <label for="nbpb">Tickets in a book</label>
          <input id="nbpb" v-model.number="nb.ticketsPerBook" inputmode="numeric"
                 :disabled="numberingLocked" :title="numberingWhy">
        </div>
        <div class="field">
          <label for="nbbp">Book prefix</label>
          <input id="nbbp" v-model="nb.bookPrefix" autocomplete="off" placeholder="e.g. Book-"
                 :disabled="numberingLocked" :title="numberingWhy">
        </div>
        <div class="field">
          <label for="nbbd">Book digits</label>
          <input id="nbbd" v-model.number="nb.bookDigits" inputmode="numeric"
                 :disabled="numberingLocked" :title="numberingWhy">
        </div>
      </div>

      <!-- What it will actually produce, before it is saved. A prefix is easy
           to get subtly wrong — a missing hyphen reads as correct in a form
           field and wrong on ten thousand tickets. -->
      <p class="hint">
        The first ticket will be <b class="data">{{ nbExample }}</b>.
      </p>

      <button class="btn primary" :disabled="numberingLocked || nbSaving"
              :title="numberingWhy || 'Save the numbering for this raffle'"
              @click="saveNumbering">
        {{ nbSaving ? 'Saving…' : 'Save numbering' }}
      </button>
    </div>

    <div v-if="c" class="card">
      <h3>How this raffle is set up</h3>
      <div class="tablewrap">
        <table>
          <tbody>
            <!--
              COUNTS, SERIALS AND MONEY ARE SET IN --font-data. Every figure in
              this table is read character by character rather than skimmed: a
              serial is compared against a printed ticket, a count against an
              invoice from the printer, a price against what a seller is
              charging at a table. Tabular figures come with it, so the column
              lines up on the digit instead of on the label.
            -->
            <tr><td>Tickets in play</td><td><span class="data">{{ live.toLocaleString() }}</span> &mdash; <span class="data">{{ c.ticketPrefix }}{{ String(c.ticketStart).padStart(c.ticketDigits, '0') }}</span> on</td></tr>
            <tr v-if="waiting"><td>Printed and waiting</td><td><span class="data">{{ waiting.toLocaleString() }}</span></td></tr>
            <tr v-if="waiting"><td>Made altogether</td><td><span class="data">{{ made.toLocaleString() }}</span></td></tr>
            <tr v-if="c.ticketCeiling"><td>Planned total</td><td><span class="data">{{ c.ticketCeiling.toLocaleString() }}</span></td></tr>
            <tr><td>In each book</td><td><span class="data">{{ c.ticketsPerBook }}</span> &middot; <span class="data">{{ c.totalBooks.toLocaleString() }}</span> books</td></tr>
            <tr><td>Price</td><td><span class="data">{{ money(c.ticketPrice, c.currency) }}</span> each</td></tr>
            <tr><td>If all sold</td><td><span class="data">{{ money(live * c.ticketPrice, c.currency) }}</span><span v-if="waiting" class="muted small"> &mdash; of what is in play</span></td></tr>
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

    <h2 class="section">What a buyer sees</h2>

    <!--
      ITS OWN CARD, AND NOT A BLOCK INSIDE THE ONE ABOVE. These are settings
      about how the raffle is set up, which is where they belong in the chapter
      — but the card above ends by saying that what it lists is changed
      elsewhere, in the config table. Three editable boxes under that sentence
      would contradict it in the same breath. They are also a different kind of
      thing: the table above is the raffle's arithmetic, and this is how a
      stranger reaches a human.
    -->
    <div class="card">
      <h3>How people can reach you</h3>
      <!--
        WHAT THIS SAYS AND WHAT IT CAREFULLY DOES NOT.
        It said "this is what that page can offer them instead", which was a
        claim about today and was false: supabase/functions/verify/index.ts
        reads none of these three. The card would have been telling an organiser
        that saving a number changed what a stranger sees, and it does not.

        The WARNING half is true whatever happens next and stays — the reason to
        think before typing is that these are destined for a page nobody signs
        in to, and that is as true the day before it is wired as the day after.
        The PROMISE half moved into a note that says plainly where it has got to.

        AND THE AUDIENCE IS EVERYONE, which the first wording understated. It
        said "somebody checks a ticket and it does not match", which reads as a
        warning about one unlucky visitor. Anybody can open that page and type
        any code, so a failed check is reachable by a stranger with no ticket at
        all — the moment these appear on any state of it they are public to
        every visitor, crawlers included. A poster is the right mental model:
        the risk is not that the wrong person might see it, it is that everyone
        will. Put that way the advice gets STRONGER rather than more
        frightening, because an organiser who understands it is a poster picks
        the office line themselves.
      -->
      <p class="muted small">
        Anyone who opens the public ticket-check page can see these, search engines
        included. Put only what you would print on a poster &mdash; an office line
        rather than a volunteer&rsquo;s mobile. Their job is to give somebody holding a
        ticket that does not verify a person to contact.
      </p>

      <!--
        ABSENT MACHINERY, NAMED. A control over a pipeline that does not exist
        is the thing this rollout is meant not to ship, and the honest form is
        not to withhold the control — the values are real config, stored and
        audited from today — but to stop the screen implying an effect it does
        not have.

        THE TELEPHONE USED TO HAVE A SECOND REASON AND NO LONGER DOES. The
        privacy guard on the public function forbade the bare word phone, which
        refused the office number along with every buyer's. The organiser
        narrowed it to official contacts on 2026-09-20, so all three fields are
        allowed there now and only the wiring is outstanding — one reason, not
        two. Written down because the opposite was true this morning, and the
        note above reads differently depending on which it is.

        WHEN TO DELETE THE NOTE, because this screen cannot work it out for
        itself. The note that used to sit here said the public page did not read
        these yet, and named its own removal trigger: the DEPLOYED verify
        function returning them, not the code landing on master, because the
        function and this bundle deploy by different routes.

        That trigger fired on 2026-09-20. Measured against the platform rather
        than the tree — GET /functions/v1/verify?about returns 200 with the org
        block — so the claim became false and the note is gone. Saving one now
        does change what a stranger sees.
      -->
      <p class="note tiny">
        These are shown on the public ticket-check page. Leaving one empty shows
        nothing rather than an empty heading, so a detail you have not got is a
        detail nobody is offered.
      </p>

      <div class="field" style="margin-top:14px">
        <label for="ophone">Office telephone</label>
        <!-- Set in --font-data: a telephone number is read and repeated digit by
             digit, which is the same reason a serial is. Stored exactly as it is
             typed, so +60 3-1234 5678 keeps the spacing that makes it readable
             rather than being flattened to a run of digits. -->
        <input id="ophone" v-model="contact.phone" class="data"
               type="tel" inputmode="tel" autocomplete="off"
               placeholder="+60 3-1234 5678"
               :disabled="!isAdmin || contactSaving"
               :title="isAdmin ? 'The number the ticket-check page offers' : ADMIN_ONLY_WHY">
      </div>

      <div class="field">
        <label for="oemail">Email address</label>
        <input id="oemail" v-model="contact.email" type="email" autocomplete="off"
               placeholder="raffle@example.org"
               :disabled="!isAdmin || contactSaving"
               :title="isAdmin ? 'Where somebody can write instead of ringing' : ADMIN_ONLY_WHY">
      </div>

      <div class="field">
        <label for="oweb">Website</label>
        <input id="oweb" v-model="contact.website" type="url" spellcheck="false"
               autocomplete="off" placeholder="https://example.org"
               :disabled="!isAdmin || contactSaving"
               :title="isAdmin ? 'Shown as a link on the public ticket-check page' : ADMIN_ONLY_WHY">
        <p class="hint">
          It has to start with <span class="data">https://</span> &mdash; that is what
          makes it a link somebody can safely follow from a page they reached without
          signing in.
        </p>
      </div>

      <!-- The server's refusal, where the boxes are. Each one says what to do
           rather than only what is wrong, so it is shown as written. -->
      <p v-if="contactErr" class="note bad tiny">{{ contactErr }}</p>

      <div class="sub">
        <span class="muted small grow">
          All three are optional. Clearing one and saving takes it off the page.
        </span>
        <button class="btn sm ghost" :disabled="!contactDirty || contactSaving"
                :title="contactDirty ? 'Put back what is saved' : 'Nothing has been changed'"
                @click="seedContact">Undo</button>
        <button class="btn sm primary" :disabled="!isAdmin || !contactDirty || contactSaving"
                :title="isAdmin
                  ? (contactDirty ? 'Save these three' : 'Nothing has been changed')
                  : ADMIN_ONLY_WHY"
                @click="saveContact">
          {{ contactSaving ? 'Saving\u2026' : 'Save contact details' }}
        </button>
      </div>
    </div>

    <div class="card">
      <h3>What the check page says this raffle is</h3>
      <p class="muted small">
        Under every answer on the public ticket-check page there is a short
        paragraph saying what kind of thing somebody is holding. Leave a box
        empty to use the wording the page comes with.
      </p>

      <label class="lbl" for="aboutmy">In Burmese</label>
      <textarea id="aboutmy" v-model="about.my" rows="4" :maxlength="ABOUT_MAX"
                placeholder="Leave empty to use the built-in wording"></textarea>
      <!--
        The count is beside the box rather than in a toast on refusal: the limit
        is a fact about the box while somebody is typing in it, not news about
        something that has finished.
      -->
      <p class="muted tiny">{{ about.my.length }} / {{ ABOUT_MAX }}</p>

      <label class="lbl" for="abouten">In English</label>
      <textarea id="abouten" v-model="about.en" rows="4" :maxlength="ABOUT_MAX"
                placeholder="Leave empty to use the built-in wording"></textarea>
      <p class="muted tiny">{{ about.en.length }} / {{ ABOUT_MAX }}</p>

      <p v-if="aboutErr" class="note bad tiny">{{ aboutErr }}</p>

      <div class="sub">
        <span class="muted small grow">
          Shown to anybody who scans a ticket. It is the only thing on that page
          written by you.
        </span>
        <button class="btn sm ghost" :disabled="!aboutDirty || aboutSaving"
                :title="aboutDirty ? 'Put back what is saved' : 'Nothing has been changed'"
                @click="seedAbout">Undo</button>
        <button class="btn sm primary" :disabled="!isAdmin || !aboutDirty || aboutSaving"
                :title="isAdmin
                  ? (aboutDirty ? 'Save both' : 'Nothing has been changed')
                  : ADMIN_ONLY_WHY"
                @click="saveAbout">
          {{ aboutSaving ? 'Saving\u2026' : 'Save description' }}
        </button>
      </div>
    </div>

    <div class="card">
      <h3>How this raffle looks</h3>
      <p class="muted small">
        Your own logo and colour, on every screen and on the receipt a seller hands over.
      </p>

      <!--
        THE NAME BELONGS BESIDE THE MARK, because that is how the two are
        printed. A receipt is headed by a name and a logo together, and an
        organiser judging "does this look like us" cannot do it from a picture
        alone.

        READ-ONLY, AND SAYING SO. Nothing in the app can set ORG_NAME — it is
        a config-table value like the price and the event name, exactly as the
        card above says. An editable box here would be a control over a pipeline
        that does not exist; drawing nothing leaves an organiser unable to see
        what their receipts are actually headed with.

        Through orgNameOf, never the fallback spelled out again. It is one
        decision, and this is the screen where somebody would most plausibly
        write a second copy of it.
      -->
      <div class="row wrap gap" style="align-items:flex-start;margin-top:12px">
        <div class="col" style="align-items:center;gap:8px">
          <Logo :size="76" big />
          <span class="tiny muted">
            <template v-if="c?.orgLogo">Your logo</template>
            <template v-else>{{ APP_NAME }}&rsquo;s mark</template>
          </span>
        </div>

        <div class="col grow" style="gap:8px;min-width:220px">
          <p style="margin:0">
            <b>{{ orgNameOf(c) }}</b>
            <span v-if="!c?.orgName" class="tiny muted">
              &mdash; no name set, so the app&rsquo;s own is used on receipts and reports
            </span>
          </p>
          <button class="btn sm" :disabled="logoBusy" @click="logoInput?.click()">
            {{ logoBusy ? 'Uploading\u2026' : (c?.orgLogo ? 'Replace logo' : 'Upload a logo') }}
          </button>
          <input ref="logoInput" type="file" accept="image/png,image/jpeg,image/webp"
                 :disabled="logoBusy" @change="pickLogo" hidden>
          <p class="tiny muted">
            PNG, JPEG or WebP. It is shrunk on this device before it is sent, so a
            large file is fine — and a small one reaches every volunteer&rsquo;s phone faster.
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
          <input v-model="brand" class="data" style="max-width:150px" placeholder="#0d7a6f"
                 spellcheck="false" aria-label="Colour code">
          <span v-if="brand && !inkFor(brand)" class="pill bad">not a colour</span>
        </div>
        <!-- Said where the box is, not only in the footer. Somebody who wants
             the default back looks at the thing holding the value. -->
        <p class="hint">Clear it to go back to {{ APP_NAME }}&rsquo;s own colour.</p>
      </div>

      <!--
        HOW IT WILL READ — real chrome, not a swatch.

        FOUR EXAMPLES RATHER THAN ONE, because a brand colour fails in more
        than one place and the primary button only proves the first of them.

          1. "Count a book in"  — brand fill, ink chosen by inkFor(). This is
             the pair the code already guarantees: luminance decides between
             near-black and white, so this one is readable by construction.
          2. "Give out books"   — an ordinary button, which is most of the app.
             It shows how much of a screen the colour does NOT touch, and that
             is worth seeing before somebody picks a colour expecting it to.
          3. a "Sold" pill      — the SEMANTIC vocabulary, deliberately not
             brand-coloured. A raffle choosing a green brand needs to see it
             sitting next to the green that means "sold", because those two
             greens being near-identical is a misreading nobody can be trained
             out of.
          4. a "Recorded" pill  — brand text on --brand-soft, which is a fixed
             14% mix of the brand against the page. Nothing computes that pair
             the way inkFor() computes the button's, so a pale brand makes this
             pill unreadable while the button beside it stays perfect. This is
             the example that earns its place: it is the failure the old
             single-button preview could not show.

        None of them carry inline colours. applyBrand() has already written
        --brand, --brand-ink and --brand-soft onto the document as the colour is
        typed, so these are the app's own classes reacting exactly as every
        other screen will. A preview painted by hand is a preview that can
        disagree with the thing it previews.
      -->
      <p class="tiny muted" style="margin:16px 0 8px">How it will read:</p>
      <div class="row wrap gap preview">
        <span class="btn primary">Count a book in</span>
        <span class="btn">Give out books</span>
        <span class="pill ok">Sold</span>
        <span class="pill brand">Recorded</span>
      </div>

      <div class="sub">
        <!-- How to clear it is said once, under the box that holds it. It was
             here as well, which put the same instruction on screen twice four
             lines apart — and the second copy is the one nobody reads. -->
        <span class="muted small grow">
          Previewed at once, saved when you say so.
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
        <button class="btn sm" @click="go('ticketdesign')">Ticket Studio &rarr;</button>
      </div>

      <!--
        WHAT THE CARD CLAIMS, as opposed to what it looks like.

        Two lines on the card a buyer keeps: what they could win, and what
        their money does. Both blank by default and both draw NOTHING when
        blank rather than a label over an empty space — a raffle that has not
        decided what to claim should not claim anything, and that is a real
        answer rather than an unfinished one.

        Under the Ticket Studio row because they are about the same object and
        an organiser thinking about the card is already looking here. Not IN
        the studio, because these are a fundraising decision and the studio is
        a drawing tool.
      -->
      <hr class="hr">
      <div class="field">
        <label for="topprize">Headline prize <span class="opt">&mdash; on the card</span></label>
        <input id="topprize" v-model="cardWords.topPrize" maxlength="48"
               placeholder="A motorbike" autocomplete="off">
        <p class="hint">
          How the card advertises the prize. Not taken from the draw schedule:
          that list carries values, and a card sent weeks early should not
          quote a figure you did not mean to publish.
        </p>
      </div>
      <div class="field">
        <label for="impact">What the money does <span class="opt">&mdash; on the card</span></label>
        <input id="impact" v-model="cardWords.impactLine" maxlength="96"
               placeholder="Your RM 200 helps a family through a month." autocomplete="off">
        <p class="hint">One sentence, under the tear line. Blank prints the ordinary thank-you.</p>
      </div>
      <div class="spread">
        <span class="tiny muted">Both are blank until you write them, and print nothing when blank.</span>
        <button class="btn sm primary" :disabled="wordsSaving || !wordsDirty"
                :title="wordsDirty ? undefined : 'Nothing changed'"
                @click="saveCardWords">{{ wordsSaving ? 'Saving\u2026' : 'Save' }}</button>
      </div>
    </div>

    <!--
      WHAT SUPPORTERS ARE CALLED.

      Its own card rather than a row inside the brand card, because it is not
      the raffle's APPEARANCE: these five words are printed on the card a buyer
      keeps and stated again on the public page anybody can scan, and they are
      the only part of that sentence anybody here chooses.

      THE SENTENCE UNDER THE HEADING IS LOAD-BEARING, not filler. The single
      most likely misreading of this screen is that it awards ranks — it is a
      form, on an admin page, with people's titles in it. Saying "counted, never
      awarded" once, where somebody is about to type, is cheaper than explaining
      it afterwards to an organiser who has gone looking for the box that sets
      a particular buyer to Pillar.
    -->
    <div class="card">
      <h3 style="margin:0 0 2px">Supporter titles</h3>
      <!--
        A TITLE, NOT A SETTING, AND THE HEADING NOW SAYS SO.
        This was "What supporters are called" over three lines of prose. Both
        were accurate and both described a configuration screen. What these five
        words actually are is the thing the raffle CALLS a person on the ticket
        they keep and the page they scan — an honorific, conferred by what they
        bought, and the only thing on any of these screens addressed to the
        buyer rather than about them.

        The one sentence that had to survive the cut is "counted, never given":
        without it an organiser goes looking for the box that sets a particular
        buyer to Pillar, which is the confusion the old paragraph existed to
        prevent. It is four words now instead of two lines.
      -->
      <p class="muted small" style="margin:0 0 12px">
        Printed on the ticket they keep and the page they scan.
        <b>Counted, never given by hand.</b>
      </p>

      <!-- THE PRESETS ARE A STARTING POINT AND SAY SO. They fill the words and
           leave the book counts alone, because the two are independent and
           overwriting numbers somebody tuned, on a click meant to change
           vocabulary, is the kind of help that gets undone by hand. -->
      <p class="tiny muted" style="margin:0 0 6px">Start from:</p>
      <div class="row wrap" style="margin-bottom:14px">
        <button v-for="p in PRESETS" :key="p.id" type="button"
                class="btn sm" :class="{ primary: bands.preset === p.id }"
                :disabled="bandsSaving"
                :title="'Use the ' + p.name + ' wording: ' + p.rungs.join(', ')"
                @click="applyPreset(p.id)">{{ p.name }}</button>
      </div>

      <!--
        LOWEST FIRST, which is the order somebody reads a ladder they are
        building and the opposite of the order the code evaluates it in. The
        code reads highest-first because it takes the first threshold met; a
        person fills in the bottom rung and works up. One of the two has to be
        turned round and it should not be the person.
      -->
      <div class="col" style="gap:8px">
        <div v-for="(r, i) in bands.rungs" :key="i" class="row" style="align-items:center">
          <!-- `.data` rather than `.mono`: .mono is declared in the studio's own
               scoped stylesheet and does not exist out here, so it would have
               been a class that silently styled nothing. .data is the global
               utility that gives numerals the app's tabular face. -->
          <!--
            THE SAME NUMERAL THE BUYER SEES. The seal on their card carries
            I–V — see cardbadges.js, where it is the rung's position and the
            one thing about a rung that is not free text. Showing the Arabic
            index here and the Roman one there made them two different
            numbering schemes for one ladder; an organiser typing "Pillar"
            beside a V is looking at what the person will be wearing.
          -->
          <span class="rungmark" :title="'Rung ' + (i + 1) + ' of ' + bands.rungs.length">
            {{ RUNG_NUMERAL[i] }}
          </span>
          <!-- Set as the title it is rather than as a settings value: this is
               the word somebody is given, and an organiser choosing it should
               see it at the weight it will be worn at. -->
          <input v-model="r.name" type="text" maxlength="24" class="grow rungname"
                 :disabled="bandsSaving" :placeholder="'Rung ' + (i + 1)"
                 :aria-label="'What rung ' + (i + 1) + ' is called'">
          <input v-model.number="r.minBooks" type="number" min="0" step="1" inputmode="numeric"
                 :disabled="bandsSaving" style="width:5.5em"
                 :aria-label="'Books needed for rung ' + (i + 1)">
          <!-- The count in MONEY, because a ladder is chosen against what a
               buyer spends and nobody converts books to ringgit in their head.

               `nowrap` and a width that fits the longest form it can take. At
               9em "any tickets · RM 10.00" broke over two lines and every row
               was a different height — the column is the one thing here the eye
               scans down, so a ragged one defeats its own purpose. -->
          <span class="tiny muted" style="width:11.5em; text-align:right; white-space:nowrap">
            {{ r.minBooks === 0 ? 'any tickets' : r.minBooks + (r.minBooks === 1 ? ' book' : ' books') }}
            <template v-if="rungWorth(r.minBooks)"> &middot; {{ rungWorth(r.minBooks) }}</template>
          </span>
        </div>
      </div>

      <div class="sub">
        <!-- The fault is stated here AND the button is disabled with it in the
             title, rather than the button being enabled and the save refused.
             Same rule the rest of this app is held to: the reason is the useful
             half. -->
        <span class="muted small grow">
          <template v-if="bandsFault"><b>{{ bandsFault }}</b></template>
          <template v-else>Each rung has to start above the one below it.</template>
        </span>
        <button class="btn sm ghost" :disabled="bandsSaving" @click="loadBands">Undo</button>
        <button class="btn sm primary" :disabled="bandsSaving || !!bandsFault"
                :title="bandsFault || 'Save what this raffle calls its supporters'"
                @click="saveBands">{{ bandsSaving ? 'Saving\u2026' : 'Save rungs' }}</button>
      </div>
    </div>


    <!--
      THE TWO THAT ACT ON EVERYTHING. Every other card on this screen changes
      one setting; these two put the whole raffle into a different state. That
      difference in KIND is what the heading states, and it is the only thing
      that was missing — both cards already carry a coloured left edge, and
      both keep their red behind a preview you have to ask for, which is where
      a destructive action's emphasis belongs: on the confirmation step, where
      it genuinely is the primary action, not on the card in the list.
    -->
    <h2 class="section">The whole raffle at once</h2>

    <!--
      THE SEED, above the reset, because this is what an empty install needs and
      that is what a finished raffle needs.
    -->
    <div v-if="isSuper" class="card fill">
      <div class="spread">
        <h3>Fill this raffle with sample data</h3>
        <button class="btn sm" :disabled="seedBusy || seedUnavailable"
                :title="seedUnavailable ? 'The server has not been updated with this yet' : 'Work out what would be made'"
                @click="previewSeed">
          {{ seedInfo ? 'Refresh' : 'Show' }}
        </button>
      </div>
      <p class="muted small">
        Makes a raffle that looks like one in flight &mdash; sellers, books, some out
        and some sold, money handed in &mdash; so the screens can be seen with something
        on them. Everything is made by the app&rsquo;s own actions, so nothing here is a
        state the raffle could not reach on its own. Undone by the reset below.
      </p>

      <p v-if="seedUnavailable" class="note tiny">
        This raffle&rsquo;s server has not been updated with this yet, so there is nothing
        to work out. The browser app and the server are deployed separately and the
        server goes first; whoever deploys will know.
      </p>

      <template v-else-if="seedInfo">
        <!--
          THE REFUSAL THAT MATTERS, said before anything is chosen rather than
          after it is pressed. A raffle somebody is using must never take sample
          sellers, and the reason is the useful part.
        -->
        <p v-if="seedInfo.inUse" class="note bad tiny">
          <b>This raffle is in use, so sample data cannot be added to it.</b>
          <span v-for="(w, i) in seedInfo.inUseWhy" :key="i"><br>{{ w }}</span>
        </p>

        <ul class="feats">
          <li v-for="f in seedInfo.features" :key="f.id">
            <label class="choice">
              <input type="checkbox" :checked="seedPick.includes(f.id)"
                     :disabled="!f.offered || seedBusy || seedInfo.inUse"
                     :title="!f.offered ? f.never : (seedInfo.inUse ? 'This raffle is in use' : `Fill ${f.name}`)"
                     @change="toggleSeed(f.id)">
              <span>{{ f.name }}
                <span class="why">{{ f.offered ? f.makes : f.never }}</span>
              </span>
            </label>
          </li>
        </ul>

        <template v-if="seedPick.length">
          <p class="tiny muted" style="margin-top:10px">How much of it:</p>
          <div class="sizes">
            <button v-for="z in seedInfo.sizes" :key="z.id" class="btn sm"
                    :class="{ on: seedSize === z.id }"
                    :disabled="seedBusy || seedInfo.inUse"
                    :title="seedInfo.inUse ? 'This raffle is in use' : `${z.tickets} tickets, ${z.sellers} sellers`"
                    @click="pickSize(z.id)">
              {{ z.name }}
            </button>
          </div>

          <p v-if="seedInfo.added.length" class="note tiny">
            <b>This needs more first.</b>
            <span v-for="a in seedInfo.added" :key="a.id"><br>{{ a.name }} &mdash; {{ a.why }}</span>
          </p>
          <p v-if="seedInfo.refused.length" class="note bad tiny">
            <span v-for="r in seedInfo.refused" :key="r.id">{{ r.why }}<br></span>
          </p>
          <!--
            ALREADY THERE IS NOT THE SAME AS REFUSED, and saying so is the
            difference between "the seed left your sellers alone" and "the seed
            did not work". The rows count as present, which is what anything
            depending on them needed.
          -->
          <p v-if="seedInfo.already.length" class="note tiny">
            <b>Left alone, because there is already something there.</b>
            <span v-for="k in seedInfo.already" :key="k.id"><br>{{ k.name }} &mdash;
              {{ k.rows }} row{{ k.rows === 1 ? '' : 's' }} already. Anything that needed
              this has it.</span>
          </p>

          <table v-if="seedInfo.total" class="counts">
            <tbody>
              <tr v-for="(n, t) in seedInfo.makes" :key="t">
                <td>{{ String(t).replace(/_/g, ' ') }}</td>
                <td class="n">{{ n }}</td>
              </tr>
              <tr class="tot"><td>in total</td><td class="n">{{ seedInfo.total }}</td></tr>
            </tbody>
          </table>
          <p v-else class="tiny muted">There is nothing left to make from what you chose.</p>

          <template v-if="seedInfo.total">
            <p class="tiny muted" style="margin-top:10px">Type this, exactly:</p>
            <p class="phrase">{{ seedInfo.phrase }}</p>
            <input v-model="seedPhrase" class="phrasein" spellcheck="false"
                   :disabled="seedInfo.inUse"
                   aria-label="Type the confirmation" placeholder="Type it here">
            <button class="btn wide" :disabled="!seedReady || seedBusy"
                    :title="seedInfo.inUse ? 'This raffle is in use, so sample data cannot be added to it'
                            : (seedReady ? 'Make everything listed above' : 'Tick what to fill, then type the line above exactly')"
                    @click="applySeed">
              {{ seedBusy ? 'Filling…' : 'Fill it' }}
            </button>
          </template>
        </template>
        <p v-else class="tiny muted">Choose what to fill.</p>
      </template>

      <p v-if="seedErr" class="note bad tiny">{{ seedErr }}</p>
      <p v-if="seedDone" class="note tiny">
        Filled: {{ seedDone.made.map(m => `${m.count} ${m.what}`).join(', ') }}.
      </p>
    </div>

    <!--
      LAST ON THE SCREEN, and only for the system admin. It is the only control
      here that destroys anything, and it is not something to meet on the way to
      something else.
    -->
    <div v-if="isSuper" class="card wipe">
      <div class="spread">
        <h3>Reset this raffle</h3>
        <button class="btn sm" :disabled="resetBusy || resetUnavailable"
                :title="resetUnavailable ? 'The server has not been updated with this yet' : 'Count what a reset would destroy'"
                @click="previewReset">
          {{ resetInfo ? 'Refresh' : 'Show' }}
        </button>
      </div>
      <p class="muted small">
        Empties what you choose, and cannot be undone. Nothing goes until you have
        seen the counts and typed them back. There is no backup in here &mdash; take
        one first if this raffle holds anything worth keeping.
      </p>

      <!--
        Shown, disabled, with the reason — the same rule the rest of the app
        follows for a control somebody cannot use. Hiding the card would make
        the screen differ between two deploys with nothing to say why.
      -->
      <p v-if="resetUnavailable" class="note tiny">
        This raffle&rsquo;s server has not been updated with the reset yet, so there is
        nothing to count. The browser app and the server are deployed separately and
        the server goes first; whoever deploys will know.
      </p>

      <template v-else-if="resetInfo">
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
.nbgrid { display: grid; gap: 12px; grid-template-columns: 1fr }
@media (min-width: 720px) { .nbgrid { grid-template-columns: 2fr 1fr 1fr } }

.swatch {
  width: 46px; height: 38px; padding: 2px;
  cursor: pointer; flex: 0 0 auto;
}

/*
 * The examples are SPANS carrying button classes, so nothing here is focusable
 * or pressable — but `.btn` still sets a pointer cursor and a hover border, and
 * a control that lights up under the finger and then does nothing is a control
 * somebody presses twice before concluding the screen is broken. This says
 * "picture of a button" rather than "button".
 */
.preview { align-items: center; }
.preview .btn { cursor: default; }
.preview .btn:hover { border-color: var(--border); }
.preview .btn.primary:hover { background: var(--brand); border-color: var(--brand); box-shadow: none; }

.sub {
  display: flex; align-items: center; gap: 10px;
  margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border);
}
.log { padding: 10px 0; border-bottom: 1px solid var(--border); }
.log:last-child { border-bottom: 0; }

/* The one card here that destroys things, edged so it does not read as another
 * settings box. */
.wipe { border-left: 3px solid var(--bad); }
/* The constructive twin of .wipe, and the only difference is which edge of the
 * status vocabulary it borrows. Both are tokens; neither is a new colour. */
.fill { border-left: 3px solid var(--brand); }
.sizes { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px }
.sizes .btn.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-ink) }
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
.btn.danger { background: var(--bad); color: var(--bad-ink); border-color: var(--bad) }
.btn.danger:disabled { opacity: .5 }
.wide { width: 100%; margin-top: 10px }

/*
 * A SUPPORTER'S TITLE, SET AS ONE.
 *
 * These five inputs were the same weight as every other field on Setup, which
 * is right for a number of books and wrong for the word a person is given. An
 * organiser choosing between "Friend" and "Neighbour" is choosing what somebody
 * reads on the ticket they keep, and should see it at the size it will be worn.
 */
.rungname {
  font-size: 1.05rem; font-weight: 650; letter-spacing: -.01em;
}
/* The position, in the numerals the buyer's seal uses. Quiet, fixed width so
   the five names start on one line however wide the numeral is — I and VIII
   are not the same width and a ragged left edge defeats a ladder. */
.rungmark {
  width: 2.4em; flex: none; text-align: center;
  font-size: .78rem; font-weight: 700; letter-spacing: .08em;
  color: var(--muted); font-variant-numeric: tabular-nums;
}
</style>
