#!/usr/bin/env node
/*
 * A PROOF SHEET, WITHOUT A BROWSER OR A DATABASE.
 *
 * This was the pilot's main command. The pilot is over — the geometry it
 * established now lives in src/lib/ and is used by the app itself — and what
 * survives here is the part that is still worth having: a way to render the
 * real artwork with real numbers on it from a terminal, with no sign-in, no
 * Supabase and no browser in the loop.
 *
 * WHAT IT IS FOR NOW. Looking at the drawing code in isolation when something
 * about the placement is in question. The app draws the same thing from the
 * same modules; this cuts out everything else, so if a number lands wrong here
 * it is the geometry and not the screen.
 *
 *   node ticket-lab/generate.mjs --from 1 --to 4
 *   node ticket-lab/generate.mjs --number KS-03291 --guides
 *   node ticket-lab/generate.mjs --from 1 --to 4 --format json | python3 proof.py
 *
 * It reads the DEFAULT design — the measurements of the artwork in artwork/ —
 * and not anything an organiser has saved, because it has no database to read
 * it from. That is the one way its output can differ from the app's.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { designFor, REFERENCE } from '../src/lib/ticketdesign.js'
import { placeBoth, checkSerial } from '../src/lib/ticketart.js'
import { sheetHTML } from '../src/lib/ticketsheet.js'

const here = dirname(fileURLToPath(import.meta.url))
const ARTWORK = 'artwork/ticket-front.jpg'

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) { out._.push(a); continue }
    const key = a.slice(2)
    if (key.startsWith('no-')) { out[key.slice(3)] = false; continue }
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) { out[key] = true; continue }
    out[key] = next
    i++
  }
  return out
}

const num = (v, what) => {
  const n = Number(v)
  if (!Number.isInteger(n)) throw new Error(`--${what} needs a whole number, got "${v}"`)
  return n
}

/* The raffle's own numbering, matching what the database seeds. */
const PREFIX = 'KS-'
const DIGITS = 5
const serial = (n) => PREFIX + String(n).padStart(DIGITS, '0')

const USAGE = `
ticket-lab — draw the ticket artwork with numbers on it, from a terminal.

  which numbers (pick one)
    --from N --to N        a run, both ends included
    --number X             one number, exactly as given

  how it is drawn
    --guides               the baseline, the number's box and the no-go line
    --qr                   outline where the QR will go
    --scale N              digit height against the printed label, 1 = the same

  output
    --format sheet|json    (default: sheet)
    --out PATH             where to write it
`.trim()

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || args.h || process.argv.length === 2) { console.log(USAGE); return 0 }

  let numbers
  if (args.number !== undefined) {
    numbers = [String(args.number)]
  } else if (args.from !== undefined || args.to !== undefined) {
    const from = num(args.from ?? 1, 'from')
    const to = num(args.to ?? from, 'to')
    if (to < from) throw new Error(`--to (${to}) is below --from (${from}) — nothing would print`)
    numbers = []
    for (let n = from; n <= to; n++) numbers.push(serial(n))
  } else {
    throw new Error('nothing to draw — say --from/--to or --number')
  }

  for (const n of numbers) {
    const c = checkSerial(n)
    if (!c.ok) throw new Error(`cannot draw "${n}": ${c.problems.join('; ')}`)
  }

  /*
   * The artwork's real size, read from its JPEG header, so the design scales to
   * the file on disk rather than to an assumption about it.
   */
  const bytes = readFileSync(join(here, ARTWORK))
  let i = 2, width = REFERENCE.width, height = REFERENCE.height
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue }
    const marker = bytes[i + 1]
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      height = bytes.readUInt16BE(i + 5); width = bytes.readUInt16BE(i + 7); break
    }
    i += 2 + bytes.readUInt16BE(i + 2)
  }

  const design = designFor({ width, height, design: {} })
  const opts = {
    guides: args.guides === true,
    qrBoxes: args.qr === true,
    ...(args.scale !== undefined ? { scale: Number(args.scale) } : {}),
  }

  for (const n of numbers) {
    const p = placeBoth(design, n, opts)
    for (const half of ['main', 'stub']) {
      if (p[half].shrunk) {
        console.warn(`  note: "${n}" on the ${half} half was scaled to ${p[half].appliedScale.toFixed(3)} to stay clear of the logo`)
      }
      if (!p[half].clearsTop) {
        console.warn(`  warning: "${n}" on the ${half} half is too tall for the ticket at this scale`)
      }
    }
  }

  const tag = `${numbers[0]}-${numbers[numbers.length - 1]}`.replace(/[^\w.-]/g, '_')

  if (args.format === 'json') {
    const data = numbers.map((n) => ({ number: n, ...placeBoth(design, n, opts) }))
    const out = args.out ? resolve(String(args.out)) : join(here, 'out', `placement-${tag}.json`)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, JSON.stringify({ artwork: { file: ARTWORK, width, height }, tickets: data }, null, 2))
    console.log(out)
    return 0
  }

  const href = `data:image/jpeg;base64,${bytes.toString('base64')}`
  const html = sheetHTML(design, numbers, href, { ...opts, title: 'ticket-lab proof sheet' })
  const out = args.out ? resolve(String(args.out)) : join(here, 'out', `tickets-${tag}.html`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, html)
  console.log(`${numbers.length} ticket${numbers.length === 1 ? '' : 's'} → ${out}`)
  return 0
}

try {
  process.exit(main())
} catch (err) {
  console.error(`ticket-lab: ${err.message}`)
  process.exit(1)
}
