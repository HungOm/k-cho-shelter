/*
 * THE DIGITAL CARD'S TWO FACES, IN THE CARD'S OWN WORDS.
 *
 * The printed side names its faces after the fonts — Times and Padauk — because
 * a print shop asks which font. The card names the same two for what they are
 * FOR — Everyday and Figures — because nobody asks that of a picture sent on
 * WhatsApp (ruled by the user 2026-09-23). Two vocabularies on purpose; see
 * UI-EVIDENCE.md Phase 1.
 *
 * ONE LIST, TWO PANELS. It lived inside CardInspector.vue. Drawn words on the
 * card (STUDIO-ESSENTIALS Phase 9) are lettered in the drawn-shape inspector,
 * which needs the same two names — and a second copy of a vocabulary is exactly
 * how the printed tab once named one font two ways a click apart (UI-EVIDENCE
 * F1). So the list is here, and both panels import it.
 *
 * The `stack` is the face each option is drawn in, taken from the printed
 * side's FAMILIES so both preview from one definition, pinned against the
 * renderer in tests/ticketart.test.mjs.
 */
import { FAMILIES } from './ticketelements.js'

const stackOf = (id) => FAMILIES.find((f) => f.id === id)?.stack || ''

export const CARD_FACES = [
  /* One clause each: these sit under a two-way choice the reader has already
     narrowed to two. */
  { id: 'text', name: 'Everyday', why: 'Renders Burmese. Use it for anything typed.', stack: stackOf('text') },
  { id: 'number', name: 'Figures', why: 'Figures of one width, so numbers line up. English only.', stack: stackOf('number') },
]
