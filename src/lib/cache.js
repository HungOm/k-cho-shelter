/**
 * A local copy of the ticket table, so the app opens instantly instead of
 * staring at a loading bar while six thousand rows come down the wire.
 *
 * WHAT IS DELIBERATELY NOT STORED
 *
 * Buyer names, phone numbers, areas and notes are stripped before anything is
 * written. This app records refugees' contact details, and a phone that is
 * lost, sold or borrowed would otherwise carry that list in its browser
 * storage indefinitely.
 *
 * So the cache holds the skeleton — which ticket, in which book, sold or not,
 * by which seller — which is what the first paint needs. The personal columns
 * arrive over the network each session and live in memory only, which is why
 * search by name still works but nothing survives a closed tab.
 *
 * IndexedDB rather than localStorage: writing several hundred kilobytes
 * synchronously blocks the main thread, and the phones this runs on are cheap.
 */

const DB_NAME = 'kcho-shelter'
const DB_VERSION = 1
const STORE = 'app'

/** Columns never written to disk. Indexes into the wire row are resolved live. */
export const PRIVATE_FIELDS = ['Buyer_Name', 'Buyer_Phone', 'Buyer_Zone', 'Notes']

let dbPromise = null

function open() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no indexedDB'))
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }).catch(err => {
    // Private windows and locked-down browsers refuse IndexedDB outright.
    // A missing cache is a slower app, never a broken one.
    dbPromise = null
    throw err
  })
  return dbPromise
}

async function tx(mode, fn) {
  try {
    const db = await open()
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode)
      const req = fn(t.objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

const get = key => tx('readonly', s => s.get(key))
const put = (key, val) => tx('readwrite', s => s.put(val, key))
const del = key => tx('readwrite', s => s.delete(key))

/**
 * Blanks the personal columns, leaving the row shape intact so the rest of the
 * app does not need to know a cached row from a live one.
 */
export function redact(fields, rows) {
  const strip = PRIVATE_FIELDS.map(f => fields.indexOf(f)).filter(i => i >= 0)
  return rows.map(row => {
    const copy = row.slice()
    for (const i of strip) copy[i] = ''
    return copy
  })
}

export async function saveTickets({ fields, rows, version, serverTime }) {
  await put('tickets', {
    fields,
    rows: redact(fields, rows),
    version: version || 0,
    serverTime: serverTime || '',
    savedAt: Date.now(),
    // Recorded so a future change to the list forces a rebuild rather than
    // quietly serving rows redacted under the old rules.
    redactedFields: PRIVATE_FIELDS.join(',')
  })
}

export async function loadTickets() {
  const v = await get('tickets')
  if (!v || !v.rows || !v.fields) return null
  if (v.redactedFields !== PRIVATE_FIELDS.join(',')) return null
  return v
}

/**
 * Called on sign-out and on any authentication failure.
 *
 * Someone who has lost access must not still have the ticket table sitting on
 * their phone, even without the names.
 */
export async function clearCache() {
  await del('tickets')
}
