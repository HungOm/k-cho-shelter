/**
 * The raffle's own colour.
 *
 * One config value moves the whole interface, because every button, tab, link
 * and focus ring already reads var(--brand). What it cannot move is the text
 * drawn ON the brand colour: that has to be light on a dark brand and dark on a
 * light one, and an organisation choosing a colour is not choosing a contrast
 * ratio. So --brand-ink is COMPUTED, not configured.
 *
 * Getting that wrong is not a cosmetic matter. The primary button carries "Sell
 * a ticket" and "Count a book in"; white text on a pale yellow brand is
 * unreadable in sunlight, which is where half of this app is used — outdoors,
 * on a phone, by somebody holding a book of tickets and somebody else's money.
 */

/** #abc, #aabbcc, or nothing. Anything else is not a colour we will act on. */
export function parseHex(value) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value || '').trim())
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map(c => c + c).join('') : m[1]
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
}

/**
 * Relative luminance, the sRGB way rather than the quick way.
 *
 * The tempting shortcut is (r+g+b)/3, which calls #0000ff bright and #ffff00
 * dark — both backwards, and both plausible brand colours. Blue and yellow are
 * exactly where the cheap formula fails, so it is not worth the four lines it
 * saves.
 */
export function luminance([r, g, b]) {
  const f = c => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** White or near-black, whichever the brand colour can actually be read on. */
export function inkFor(value) {
  const rgb = parseHex(value)
  if (!rgb) return null
  // 0.179 is where contrast against white and against black are equal. Picking
  // the better of the two is the whole decision.
  return luminance(rgb) > 0.179 ? '#11181c' : '#ffffff'
}

/**
 * Put it on the document, or take it off again.
 *
 * Only the three tokens that depend on the choice. Everything else in the
 * stylesheet is derived from them with color-mix, so a raffle sets one value
 * and the rest follows — including the drawn mark, which is why an organisation
 * that has picked a colour but not uploaded a logo still looks like itself.
 */
export function applyBrand(value, root = typeof document !== 'undefined' ? document.documentElement : null) {
  if (!root) return false
  const ink = inkFor(value)
  if (!ink) {
    // An unset or malformed value restores the stylesheet's own colour rather
    // than leaving half a theme applied. A typo in a config cell should cost
    // the custom colour, not the readability of every button in the app.
    for (const k of ['--brand', '--brand-soft', '--brand-ink']) root.style.removeProperty(k)
    return false
  }
  const hex = String(value).trim().replace(/^#?/, '#')
  root.style.setProperty('--brand', hex)
  root.style.setProperty('--brand-ink', ink)
  // Soft is the tinted background behind pills and chips. Mixed against the
  // page rather than against white, so it works in dark mode without a second
  // configured value.
  root.style.setProperty('--brand-soft', `color-mix(in srgb, ${hex} 14%, var(--bg))`)
  return true
}
