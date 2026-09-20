/*
 * The organiser's contacts, checked before anything on the public page points
 * at them.
 *
 * WHY THESE ARE THEIR OWN FILE. Everything else in main.js runs on load and
 * talks to the network, so it cannot be imported and asked questions. These
 * three decide what goes inside an `href` on a page served to strangers,
 * which is the one place on it where a bad value is not a wrong sentence but
 * a script — so they are the part that most needs testing directly rather
 * than through a rendered page.
 *
 * THE SERVER ALSO CHECKS THEM, when they are saved. That check is a courtesy
 * to the person typing; this one is the thing that has to hold. Same argument
 * the page already makes about escaping the about text twice.
 *
 * EACH ANSWERS WITH THE VALUE OR WITH NOTHING, never with a reason. A caller
 * that gets '' renders no control at all, which on this page is the correct
 * answer to every way a contact can be unusable: unset by the organiser,
 * malformed, or not yet deployed. A stranger holding a ticket does not care
 * which; they care that they are not shown a button that does nothing.
 */

/** A telephone number somebody could actually dial, or ''. */
export function telOf(raw) {
  const v = String(raw ?? '').trim()
  return /^[+0-9][0-9 ()+-]{4,24}$/.test(v) ? v : ''
}

/** An address that could receive a report, or ''. */
export function emailOf(raw) {
  const v = String(raw ?? '').trim()
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(v) ? v : ''
}

/*
 * A page somebody could open, or ''.
 *
 * THE SCHEME IS CHECKED AND NEVER GUESSED. `javascript:` in this field would
 * run on a page that has no session and no framework between it and a
 * stranger's phone, and "it came from our own database" is not a defence when
 * the row is typed in through a web form. Anything that is not plainly http
 * or https is not a website as far as this page is concerned.
 */
export function siteOf(raw) {
  const v = String(raw ?? '').trim()
  return /^https?:\/\/[^\s"'<>]+$/i.test(v) ? v : ''
}

/** Dialling strips the prettiness; `tel:` wants digits and a plus. */
export function dialOf(tel) {
  return telOf(tel).replace(/[^+0-9]/g, '')
}
