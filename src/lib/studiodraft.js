/*
 * A DESIGN THAT HAS NOT BEEN SAVED, KEPT ON THIS COMPUTER.
 *
 * The studio held unsaved work only in memory. A reload, a crashed tab, a
 * laptop lid closed on a dead battery — each threw away every placement since
 * the last Save, with nothing on screen afterwards to say anything had been
 * lost. An hour of positioning a ticket number to the tenth of a millimetre is
 * the most expensive thing anybody does in this app that is not money.
 *
 * So the unsaved design is written to local storage as it changes, per
 * template, and offered back when that template is next opened. Nothing is
 * restored without being asked: a draft is shown as an offer with a time on it.
 *
 * FOUR STATES, NOT TWO, and the difference between the last two is the reason
 * this module exists rather than a single `localStorage.setItem`:
 *
 *   none    nothing kept
 *   same    what was kept IS what is saved — a draft that outlived its save;
 *           cleared, never offered
 *   newer   kept from edits made on top of the design that is saved now
 *   stale   kept from edits made on top of an OLDER saved design — somebody
 *           saved since (another organiser, another tab). Still offered,
 *           because it is still somebody's work, but the offer says so
 *
 * PURE, AND THE STORAGE IS HANDED IN. Every function takes a Storage-shaped
 * object, so the tests use a plain one and nothing here touches `window`. The
 * one browser fact — whether local storage exists and may be used at all — is
 * `browserStorage()`, which answers null rather than throwing: private windows
 * and locked-down browsers refuse it, and a studio that cannot keep a draft
 * must still open.
 */

/* Neutral on purpose: orgidentity refuses an organisation's name anywhere in
   src/, and a storage key is no exception unless it predates the rule. */
const PREFIX = 'studio.draft.'
const VERSION = 1

export const draftKey = (id) => `${PREFIX}${id}`

/** Local storage if this browser will let it be used, otherwise null. */
export function browserStorage() {
  try {
    if (typeof localStorage === 'undefined') return null
    const probe = `${PREFIX}probe`
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return localStorage
  } catch {
    return null
  }
}

/**
 * The design as it would be SAVED, as text. `artwork` is a fact about the
 * picture that `designFor` adds on the way in and `saveDesign` takes out on
 * the way back; comparing with it in would compare the picture, not the work.
 */
export function designText(design) {
  if (!design || typeof design !== 'object') return ''
  const { artwork, ...rest } = design
  void artwork
  return JSON.stringify(rest)
}

/**
 * Keep a draft. `design` and `saved` are TEXT — the unsaved state and the
 * saved state it was made on top of — so a later comparison can tell "newer"
 * from "stale". Returns false when the storage refused it (full, or revoked
 * since it was probed), which the caller may say or ignore; it never throws.
 */
export function writeDraft(storage, id, { design, saved, editedAt = '' }, now = Date.now()) {
  if (!storage || !id || !design) return false
  try {
    storage.setItem(draftKey(id), JSON.stringify({
      v: VERSION, design, saved: saved || '', editedAt: String(editedAt || ''), keptAt: now,
    }))
    return true
  } catch {
    return false
  }
}

/** The kept draft, or null — for nothing kept, and for anything unreadable. */
export function readDraft(storage, id) {
  if (!storage || !id) return null
  try {
    const raw = storage.getItem(draftKey(id))
    if (!raw) return null
    const d = JSON.parse(raw)
    if (!d || d.v !== VERSION || typeof d.design !== 'string' || !d.design) return null
    /* The design itself must parse, or restoring it would put a broken object
       on the canvas; better to report nothing kept. */
    JSON.parse(d.design)
    return {
      design: d.design,
      saved: typeof d.saved === 'string' ? d.saved : '',
      editedAt: typeof d.editedAt === 'string' ? d.editedAt : '',
      keptAt: Number.isFinite(d.keptAt) ? d.keptAt : 0,
    }
  } catch {
    return null
  }
}

export function clearDraft(storage, id) {
  if (!storage || !id) return
  try { storage.removeItem(draftKey(id)) } catch { /* nothing to do */ }
}

/**
 * Where a kept draft stands against the design that is saved now.
 * `savedText` is `designText` of the saved design, or '' when there is none.
 */
export function compareDraft(draft, savedText) {
  if (!draft) return 'none'
  if (draft.design === savedText) return 'same'
  if (draft.saved === savedText) return 'newer'
  return 'stale'
}
