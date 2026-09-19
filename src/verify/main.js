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
function say(key) {
  const s = S[key]
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
function topbar() {
  return `<header class="topbar">
    <span class="logo" aria-hidden="true"></span>
    <span class="brand">${say('brandCheck')}</span>
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
function about() {
  const more = String(import.meta.env.VITE_ABOUT_URL || '').trim()
  const link = more
    ? `<p class="aboutlink"><a href="${escapeHtml(more)}" rel="noopener noreferrer">${say('aboutMore')}</a></p>`
    : ''
  return `<p class="about">${say('whatThisIs')}</p>` + link
}

/*
 * WHY EVERY FAILURE LOOKS THE SAME, shown on every failure.
 *
 * The endpoint answers identically for a number never issued, a ticket never
 * printed and a code out by one character, so that it cannot be used to map the
 * raffle. Unexplained that reads as a page that does not know much; explained,
 * it reads as a page refusing to help somebody forging tickets.
 */
function whyOneAnswer() {
  return `<section class="why">
    <h2>${say('whyOneAnswer')}</h2>
    <p>${say('whyOneAnswerNote')}</p>
  </section>`
}

function panel(tone, headKey, noteKey, extra = '') {
  return `
    <div class="card ${tone}">
      <div class="mark" aria-hidden="true">${tone === 'good' ? '✓' : tone === 'bad' ? '✗' : '!'}</div>
      <h1>${say(headKey)}</h1>
      ${extra}
      <p class="note">${say(noteKey)}</p>
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
  // The compact form the QR uses: everything after the ? is <number>.<code>.
  const raw = url.search.replace(/^\?/, '')
  if (raw && raw.includes('.')) return { query: `?${raw}` }
  return null
}

async function run() {
  render(`<div class="card wait"><p>${say('checking')}</p></div>`)

  const p = params()
  if (!p) {
    render(panel('bad', 'notGenuine', 'malformedNote') + whyOneAnswer())
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
    if (res.status === 400) { render(panel('bad', 'notGenuine', 'malformedNote') + whyOneAnswer()); return }
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
    const todo = `<p class="todo">${say('showSeller')}</p>`
    render(panel('bad', 'notGenuine', 'notGenuineNote', todo) + whyOneAnswer())
    return
  }

  const stateKey = body.state === 'sold' ? 'sold' : body.state === 'void' ? 'void' : 'unsold'
  const noteKey = body.state === 'unsold' ? 'unsoldNote' : 'photocopy'
  const tone = body.state === 'void' ? 'warn' : 'good'

  const details = `
    <p class="number"><span class="label">${say('ticketNo')}</span><b>${escapeHtml(body.number)}</b></p>
    <p class="state">${say(stateKey)}</p>
    <p class="privacy">${say('privacyNote')}</p>`

  render(panel(tone, 'genuine', noteKey, details) + `
    <p class="stamp">${say('checkedAt')} ${escapeHtml(new Date(body.checkedAt).toLocaleString())}</p>`)
}

/* The number comes from the server, but it began life in somebody's URL. */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

run()
