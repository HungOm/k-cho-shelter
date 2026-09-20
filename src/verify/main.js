/*
 * THE PAGE A STRANGER REACHES BY SCANNING A TICKET.
 *
 * Plain DOM, no framework, no store, no Supabase client, no sign-in. It exists
 * to answer one question — is this ticket real — for somebody standing in a
 * hall holding a piece of paper, on whatever phone and whatever signal they
 * have.
 *
 * WHY IT IS NOT PART OF THE APP. The app is a 400 KB bundle that boots a
 * session, loads twenty thousand tickets and knows about sellers and money.
 * None of that can be on this page: there is no session to boot, nothing here
 * may see a buyer, and the person reading it may be on one bar of signal. So
 * it is a second, tiny entry point — and tests/verifypage.test.mjs fails if it
 * ever imports its way back into the app.
 *
 * THE LINK IT ANSWERS is what the QR carries:
 *   /v/?KS-00123.ABCDEFGH01234567
 * and the readable form somebody might type or be sent:
 *   /v/?t=KS-00123&c=ABCDEFGH01234567
 *
 * It sends both to the verify function exactly as it received them and shows
 * what comes back. It makes no decision of its own about whether a ticket is
 * real — that is the server's job, and a page that could decide would be a page
 * somebody could edit.
 */
import { S } from './strings.js'
import { sampleFromSearch } from './sample.js'
import { telOf, emailOf, siteOf, dialOf } from './contacts.js'

const root = document.getElementById('app')

/**
 * Both languages, always, because the page has no way to ask which is wanted.
 *
 * BURMESE FIRST, AND THIS IS THE ONLY PLACE THAT DECIDES IT. The page used to
 * lead with English. Nearly everybody who scans one of these tickets reads
 * Burmese, and making them skip a line to reach their own language on a verdict
 * about their money is the wrong way round.
 *
 * Every string on the page goes through here, which is the point: the failure
 * this avoids is a page half-inverted, carrying two conventions at once,
 * shipped because nothing noticed. tests/verifypage.test.mjs pins the order so
 * that a future edit cannot quietly reintroduce it.
 */
function say(key, pair) {
  /*
   * `pair` lets a caller supply the two halves instead of naming a key, and it
   * exists so that this stays the ONLY function emitting a language pair.
   * verifypage counts the pairs in this file and fails at more than one,
   * deliberately: the failure it guards is a page half-inverted, carrying two
   * orders at once because somebody added a second emitter and changed one.
   *
   * A caller passing `pair` is passing text this page did not write, so it
   * escapes its own halves before handing them over — see aboutText().
   */
  const s = pair || S[key]
  if (!s) return ''
  return `<span class="my" lang="my">${s.my}</span><span class="en">${s.en}</span>`
}

function render(html) {
  root.innerHTML = topbar() + html + about()
}

/*
 * WHO IS ANSWERING, above everything.
 *
 * Without it the page opens on a coloured tick and a sentence about a number,
 * with nothing saying what has been reached. It is deliberately quiet — a
 * heading, not a banner — because the verdict underneath is the thing somebody
 * came for.
 */
/*
 * TWO LINES, AND THE SECOND ONE IS NOT A CLAIM ABOUT WHO WE ARE.
 *
 * "Ticket check" alone left a stranger unsure what they had landed on. The
 * second line says what the SERVICE is, which is sayable without naming a
 * charity — and naming one would be wrong on every other raffle's tickets,
 * since several run off this one deployment. strings.js carries that reasoning
 * at length and it is the reason brandCheck has never said CEAM.
 *
 * The organisation's name appears only when config carries one. Unset, the line
 * is simply absent: no placeholder, and not the app's own name either, because
 * telling a stranger checking a charity's ticket the name of the software says
 * the wrong thing. supabase/functions/verify/index.ts makes the same argument
 * where the value is read.
 */
function topbar() {
  const named = String(orgContact.name || '').trim()
  return `<header class="topbar">
    <span class="logo" aria-hidden="true"></span>
    <span class="brandwrap">
      <span class="brand">${named ? escapeHtml(named) + ' ' : ''}${say('brandCheck')}</span>
      <span class="service">${say('officialService')}</span>
    </span>
  </header>`
}

/*
 * UNDER EVERY ANSWER, INCLUDING THE ONES THAT FAILED.
 *
 * Kept out of panel() so that it cannot be forgotten by a branch: "could not
 * check" and a malformed link are exactly the moments a stranger is left
 * looking at a bare page and forming an impression of what they have been sold.
 * It sits OUTSIDE the card because the answer to "is this ticket real" is what
 * the page is for, and this must not compete with it.
 *
 * The link is optional and prints nothing when no address is configured, rather
 * than offering a stranger somewhere that does not exist.
 */
/*
 * THE ORGANISER'S OWN WORDS, WHEN THEY HAVE WRITTEN ANY.
 *
 * `whatThisIs` describes one particular raffle — volunteers, a community, not
 * a commercial sale. That is true of the raffle it was written for and is not
 * the sentence every other organiser would write, and there was no way to
 * change it short of a deploy. ORG_ABOUT_MY and ORG_ABOUT_EN replace either
 * half; an unset half keeps the built-in one, so a raffle that has written only
 * Burmese still reads correctly in both.
 *
 * ESCAPED, UNLIKE EVERY OTHER STRING ON THIS PAGE. Everything else here comes
 * from strings.js, which is code. This comes from a database row somebody
 * typed into, is served to strangers, and is the only untrusted text the page
 * renders — so it goes through escapeHtml even though setOrgAbout already
 * rejects angle brackets. Two places, because the server-side check is a
 * courtesy to the person typing and this one is the thing that actually has to
 * hold.
 */
let orgAbout = { my: '', en: '' }

function aboutText() {
  if (!orgAbout.my && !orgAbout.en) return say('whatThisIs')
  /*
   * Only the organiser's halves are escaped. The built-in ones are code, and
   * running them through escapeHtml would be a no-op that implied otherwise.
   */
  return say(null, {
    my: orgAbout.my ? escapeHtml(orgAbout.my) : S.whatThisIs.my,
    en: orgAbout.en ? escapeHtml(orgAbout.en) : S.whatThisIs.en,
  })
}

function about() {
  const more = String(import.meta.env.VITE_ABOUT_URL || '').trim()
  const link = more
    ? `<p class="aboutlink"><a href="${escapeHtml(more)}" rel="noopener noreferrer">${say('aboutMore')}</a></p>`
    : ''
  return `<p class="about">${aboutText()}</p>` + link
}

/*
 * WHERE "CALL THE OFFICE" POINTS.
 *
 * ORG_PHONE, ORG_EMAIL and ORG_WEBSITE have been stored and validated for a
 * while and nothing had ever read them; schema.sql says outright that they
 * were added "when the public check page needed somewhere for 'call the
 * office' to point". This is that somewhere.
 *
 * EVERY ONE OF THESE IS UNTRUSTED, exactly like the about text beside them:
 * typed into a database by somebody, served to strangers. The server checks
 * them when they are saved, which is a courtesy to the person typing; these
 * checks are the ones that have to hold. A site especially — an href is the
 * one field on this page where a bad value is not a wrong sentence but a
 * script, so nothing but http and https is allowed near it.
 */
let orgContact = { name: '', tel: '', email: '', site: '' }

/*
 * WHAT TO DO ABOUT A TICKET THAT IS NOT REAL, under the explanation.
 *
 * NOTHING RATHER THAN A DEAD BUTTON. A raffle that has set no telephone
 * number gets no telephone button — the same argument the about link already
 * makes next door. And a button that cannot be pressed is worse here than on
 * any other screen in this system, because the person reading it is standing
 * in front of somebody who may have just tried to sell them a forgery.
 *
 * This is also what a page whose ?about has not deployed yet looks like, and
 * deliberately the same. A stranger holding a ticket does not care whether
 * the office telephone is missing because nobody set one or because a
 * function is a version behind; they care that the page is not lying about
 * what it can do for them. The difference between those two is real and it
 * belongs on the organiser's own screen, where somebody can act on it.
 */
function actions() {
  const tel = telOf(orgContact.tel)
  const email = emailOf(orgContact.email)
  if (!tel && !email) return ''
  const call = tel
    ? `<a class="act primary" href="tel:${escapeHtml(dialOf(tel))}">${say('callOffice')}</a>`
    : ''
  const report = email
    ? `<a class="act" href="mailto:${escapeHtml(email)}">${say('reportIt')}</a>`
    : ''
  return `<div class="acts">${call}${report}</div>`
}

/*
 * THE FOOT: WHEN IT WAS CHECKED, AND WHO IS ASKING.
 *
 * The time was already here as a stamp. What it lacked is whose raffle this
 * is — the card the mockup draws puts the charity's identity at the foot of
 * every verdict, which is the difference between a page that has told you
 * something and a page you can act on.
 *
 * THE NAME IS THE RAFFLE'S OR IT IS ABSENT. Nothing falls back to the
 * product's name here. Telling a stranger checking a charity's ticket the
 * name of the software would be a worse sentence than saying nothing, which
 * is the argument Logo.vue makes about alt text and verify/index.ts makes
 * about this very field.
 *
 * The mockup's second line reads "CEAM Malaysia · Kajang, Selangor". There is
 * no location in ?about and none is being invented for it: a config key added
 * to satisfy a picture is a schema grown from a mock.
 */
function orgFoot(checkedAt, withContact) {
  const site = siteOf(orgContact.site)
  const email = emailOf(orgContact.email)
  const href = site || (email ? `mailto:${email}` : '')
  const contact = withContact && href
    ? `<a class="act" href="${escapeHtml(href)}"${site ? ' rel="noopener noreferrer"' : ''}>${say('contactUs')}</a>`
    : ''
  const name = String(orgContact.name ?? '').trim()
  return `<footer class="orgfoot">
    <p class="stamp">
      <span>${say('checkedAt')} ${escapeHtml(new Date(checkedAt).toLocaleString())}</span>
      ${name ? `<span class="who">${escapeHtml(name)}</span>` : ''}
    </p>
    ${contact}
  </footer>`
}

/*
 * Repainted when the contacts arrive, because they arrive after the verdict
 * has already been drawn — see loadAbout. Both regions are rendered empty and
 * filled in place, so nothing moves on the screen except the buttons
 * appearing, and nothing appears at all if the raffle has set nothing.
 */
function paintOrg() {
  const acts = root.querySelector('.acts-slot')
  if (acts) acts.innerHTML = actions()
  const foot = root.querySelector('.orgfoot-slot')
  if (foot && foot.dataset.at) foot.innerHTML = orgFoot(foot.dataset.at, foot.dataset.contact === '1')
}

/*
 * FETCHED ALONGSIDE THE VERDICT, NEVER IN FRONT OF IT.
 *
 * This is a second request, and the whole design of this page is somebody on
 * one bar of signal waiting to find out whether the ticket in their hand is
 * real. So it never blocks: the verdict renders with the built-in sentence, and
 * if the organiser's own arrives it is swapped into the paragraph already on
 * screen. If the request is slow, fails, or the raffle has set nothing, the
 * page is exactly what it was before — which is also what makes this safe to
 * add to a page that must work when the network barely does.
 */
async function loadAbout() {
  const base = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
  if (!base) return
  try {
    const res = await fetch(`${base}/functions/v1/verify?about=1`, { method: 'GET' })
    if (!res.ok) return
    const body = await res.json()
    /*
     * The contacts are taken before the early return below: a raffle may well
     * have set a telephone number and no description, and the buttons are the
     * half somebody standing in a hall actually needs.
     */
    orgContact = {
      name: String(body?.org?.name ?? '').trim(),
      tel: String(body?.org?.tel ?? '').trim(),
      email: String(body?.org?.email ?? '').trim(),
      site: String(body?.org?.site ?? '').trim(),
    }
    paintOrg()

    const my = String(body?.org?.aboutMy ?? '').trim()
    const en = String(body?.org?.aboutEn ?? '').trim()
    if (!my && !en) return
    orgAbout = { my, en }
    const el = root.querySelector('.about')
    if (el) el.innerHTML = aboutText()
  } catch {
    /* The built-in sentence stands. Nothing about a verdict depends on this. */
  }
}

/*
 * WHY EVERY FAILURE LOOKS THE SAME, shown on every failure.
 *
 * The endpoint answers identically for a number never issued, a ticket never
 * printed and a code out by one character, so that it cannot be used to map the
 * raffle. Unexplained that reads as a page that does not know much; explained,
 * it reads as a page refusing to help somebody forging tickets.
 */
/*
 * WHAT WAS ACTUALLY SCANNED, shown back on a failure.
 *
 * This is the line somebody reads down a telephone to the office, and it is the
 * only place this page echoes anything a stranger controls — so it goes through
 * escapeHtml, and it shows the RAW thing rather than a tidied one.
 *
 * params() already refuses to canonicalise before the lookup, on the grounds
 * that "a page that tidied the number first would be a page that could make a
 * wrong number look right". Displaying it is the same argument: a ticket whose
 * code is one character off must look one character off here, because that
 * single character is the whole reason the answer was no.
 *
 * Only on failure. On a genuine ticket the number is already shown, larger and
 * in its own right; repeating the URL underneath would be noise.
 *
 * IT GOES INSIDE THE CARD, through panel()'s `extra`, which lands between the
 * headline and the note. Hung underneath as a sibling it read as a third peer
 * of the verdict and the explanation — a separate thing the page also wanted to
 * say. It is not: it is what the verdict is ABOUT, and the sentence under it
 * ("do not pay for this ticket") is advice about this link specifically.
 */
function linkScanned() {
  const raw = String(window.location.search || '').replace(/^\?/, '')
  if (!raw) return ''
  const shown = window.location.pathname + '?' + raw
  return `<section class="scanned">
    <p class="scannedcap">${say('linkScanned')}</p>
    <p class="scannedval">${escapeHtml(shown)}</p>
  </section>`
}

function whyOneAnswer() {
  return `<section class="why">
    <h2>${say('whyOneAnswer')}</h2>
    <p>${say('whyOneAnswerNote')}</p>
  </section>`
}

function panel(tone, headKey, noteKey, extra = '') {
  const mark = tone === 'good' ? '✓' : tone === 'bad' ? '✗' : tone === 'sample' ? '✱' : '!'
  /*
   * The watermark is on the card for the same reason it is on the paper: this
   * page is a screenshot away from being passed around on its own. It is one
   * Latin word, aria-hidden and decorative — the verdict itself is in both
   * languages, through say(), like everything else here.
   */
  const wash = tone === 'sample'
    ? '<div class="wash" aria-hidden="true"><span>SAMPLE SAMPLE SAMPLE SAMPLE</span></div>'
    : ''
  /*
   * THE VERDICT IS A BAND, NOT THE TOP OF A CARD.
   *
   * The card used to be one white box with a coloured roundel floating in it,
   * so the answer and the facts about the ticket sat at the same visual weight
   * and the eye had to read to find out which was which. The mockup tints the
   * verdict across the full width and lets the facts sit on plain paper below
   * it — "a clear verdict first, the ticket's facts second", which is the
   * sentence the card is titled with.
   *
   * The tint is the same hue as the mark and much weaker, so the band reads as
   * belonging to the tick rather than as a second status of its own.
   */
  return `
    <div class="card ${tone}">
      ${wash}
      <div class="band">
        <div class="mark" aria-hidden="true">${mark}</div>
        <h1>${say(headKey)}</h1>
      </div>
      <div class="body">
        ${extra}
        <p class="note">${say(noteKey)}</p>
      </div>
    </div>`
}

/*
 * The parameters, taken from the address as they were found.
 *
 * Deliberately not cleaned up or "corrected" here. Everything about whether
 * this is a valid ticket is decided by the server, and a page that tidied the
 * number first would be a page that could make a wrong number look right.
 */
function params() {
  const url = new URL(window.location.href)
  const t = url.searchParams.get('t')
  const c = url.searchParams.get('c')
  if (t || c) return { query: `?t=${encodeURIComponent(t ?? '')}&c=${encodeURIComponent(c ?? '')}` }
  // A receipt: one code standing for the tickets one buyer took. Both spellings
  // again — `?r=CODE` for a person typing it, `?r.CODE` for the QR.
  const r = url.searchParams.get('r')
  if (r) return { query: `?r=${encodeURIComponent(r)}` }
  // The compact form the QR uses: everything after the ? is <number>.<code>,
  // or `r.<code>` for a receipt.
  const raw = url.search.replace(/^\?/, '')
  if (raw && raw.includes('.')) return { query: `?${raw}` }
  return null
}

async function run() {
  /*
   * BEFORE params(), because params() would hand this to the server.
   *
   * A sample has nothing to verify and nothing to look up — there is no row
   * behind it anywhere, by design. Answering it here means a sample QR works
   * off a printer with no connection, on a raffle that has not been numbered,
   * and years after the one it was printed for was wiped.
   */
  /*
   * STARTED HERE AND NEVER AWAITED. It updates a paragraph that is already on
   * the screen whenever it arrives, including on the sample path below, which
   * returns early and would otherwise be the one verdict that never got the
   * organiser's own words.
   */
  loadAbout()

  const sample = sampleFromSearch(window.location.search)
  if (sample) {
    render(panel('sample', 'sampleHead', 'sampleNote',
      `<p class="number"><span class="label">${say('ticketNo')}</span><b>${escapeHtml(sample)}</b></p>`))
    return
  }

  render(`<div class="card wait"><p>${say('checking')}</p></div>`)

  const p = params()
  if (!p) {
    render(panel('bad', 'notGenuine', 'malformedNote', linkScanned()) + whyOneAnswer())
    return
  }

  const base = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
  if (!base) {
    render(panel('warn', 'cannotCheck', 'cannotCheckNote'))
    return
  }

  let body
  try {
    const res = await fetch(`${base}/functions/v1/verify${p.query}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    body = await res.json()
    /*
     * A malformed link reads as "not a valid ticket" rather than as a broken
     * page. From where the person is standing those are the same thing, and the
     * distinction would only be useful to somebody probing the endpoint.
     */
    if (res.status === 400) { render(panel('bad', 'notGenuine', 'malformedNote', linkScanned()) + whyOneAnswer()); return }
    if (!res.ok || !body || body.ok !== true) { render(panel('warn', 'cannotCheck', 'cannotCheckNote')); return }
  } catch {
    // No signal, or the function is down. Not the same as a forged ticket, and
    // must never be shown as one.
    render(panel('warn', 'cannotCheck', 'cannotCheckNote'))
    return
  }

  if (!body.genuine) {
    /* What to do about it, which the refusal on its own does not say: the person
     * who sold it is usually standing there. */
    /*
     * WHAT TO DO SITS WITH THE THING THAT DOES IT. This sentence used to be
     * inside the card, above the explanation; the mockup puts it under the
     * explanation and directly over the two buttons, which is where an
     * instruction belongs when the next thing on the screen is the way to
     * carry it out.
     *
     * The buttons land in the slot when ?about answers, which is after this
     * render. An empty slot rather than a conditional render, so the page
     * does not reflow under somebody reading a verdict.
     */
    const todo = `<p class="todo">${say('showSeller')}</p>`
    render(panel('bad', 'notGenuine', 'notGenuineNote', linkScanned())
      + todo
      + `<div class="acts-slot">${actions()}</div>`
      + whyOneAnswer()
      + `<div class="orgfoot-slot" data-at="${escapeHtml(new Date().toISOString())}" data-contact="0">${orgFoot(new Date().toISOString(), false)}</div>`)
    return
  }

  /*
   * A RECEIPT ANSWERS FOR EVERY TICKET ON IT, in one scan.
   *
   * A buyer who took ten tickets was given ten pictures and ten QR codes, and
   * had to scan them one at a time — as did anybody standing beside them at the
   * draw. The reply carries the same two facts per ticket that a single ticket's
   * answer carries, so the panel is the same panel with a list in it: a number
   * and one of the three sentences, per line. Nothing new is said about a
   * ticket, because nothing about a ticket changed.
   *
   * THE TONE FOLLOWS THE WORST LINE. A receipt where one ticket is cancelled is
   * not a clean receipt, and a green tick over a list containing a cancelled
   * ticket is the page telling somebody the opposite of what it is showing them.
   */
  if (body.receipt) {
    const list = (body.tickets || []).map((t) => {
      const key = t.void ? 'void' : t.sold ? 'sold' : 'unsold'
      return `<li><b>${escapeHtml(String(t.number))}</b><span>${say(key)}</span></li>`
    }).join('')
    const anyVoid = (body.tickets || []).some((t) => t.void)
    const anyUnsold = (body.tickets || []).some((t) => !t.sold && !t.void)
    const details = `
      <p class="state">${say('receiptCount').replace(/\{n\}/g, String(body.count ?? 0))}</p>
      <ul class="tickets">${list}</ul>
      <p class="privacy">${say('privacyNote')}</p>`
    render(panel(anyVoid ? 'warn' : 'good', 'receiptGenuine',
                 anyUnsold ? 'unsoldNote' : 'photocopy', details)
      + `<div class="orgfoot-slot" data-at="${escapeHtml(body.checkedAt)}" data-contact="1">${orgFoot(body.checkedAt, true)}</div>`)
    return
  }

  const stateKey = body.state === 'sold' ? 'sold' : body.state === 'void' ? 'void' : 'unsold'
  const noteKey = body.state === 'unsold' ? 'unsoldNote' : 'photocopy'
  const tone = body.state === 'void' ? 'warn' : 'good'

  /*
   * THE NUMBER STANDS ALONE AND THE STATE IS A ROW.
   *
   * They were two centred paragraphs of equal weight, so "KS-00842" and
   * "Recorded as sold" competed. The number is the ticket's identity and the
   * thing somebody compares against the paper in their hand, so it keeps the
   * middle of the card to itself; the state is a FACT ABOUT it and takes a
   * labelled row, which is the shape the mockup gives every such fact and the
   * shape that lets more of them be added without redesigning anything.
   *
   * Only one row today. The mockup also draws `Recorded` and `Draw date`, and
   * those are not here on purpose: this endpoint answers anybody with no
   * session, and what it discloses is a ruling rather than a layout decision —
   * see the comment at the head of supabase/functions/verify/index.ts about
   * every failure returning the same answer.
   */
  const details = `
    <p class="number"><span class="label">${say('ticketNo')}</span><b>${escapeHtml(body.number)}</b></p>
    <dl class="facts">
      <div class="fact">
        <dt>${say('statusLabel')}</dt>
        <dd class="state">${say(stateKey)}</dd>
      </div>
    </dl>
    <p class="privacy">${say('privacyNote')}</p>`

  render(panel(tone, 'genuine', noteKey, details)
    + `<div class="orgfoot-slot" data-at="${escapeHtml(body.checkedAt)}" data-contact="1">${orgFoot(body.checkedAt, true)}</div>`)
}

/* The number comes from the server, but it began life in somebody's URL. */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

run()
