/*
 * THE TICKET ARTWORK, AND WHERE THE NUMBER SITS ON IT.
 *
 * A raffle ticket is a piece of paper somebody designed — green, in two
 * languages, with a stub down one side. This module accepts that picture, works
 * out how big it is, refuses it if it is not one of the shapes the raffle is
 * set up to print, and remembers where on it the number and the QR belong.
 *
 * NOTHING HERE DRAWS ANYTHING. The artwork is stored once; the tickets are
 * drawn in the browser at the moment somebody prints or opens one, from this
 * design plus a ticket number. That is what lets twenty thousand tickets cost
 * nothing until one of them is looked at.
 *
 * ORGANISERS AND THE SYSTEM ADMIN ONLY, AND NOT NEGOTIABLE. Every action here
 * is registered ADMIN_ONLY *and* kind 'write', including the two that only
 * read. That is not an oversight. A permissions row may hand any 'read' or
 * 'report' action to another role — that is what the Access screen is for —
 * and gate.ts refuses to widen a 'write'. Registering a read as a write is the
 * only way to say "this one cannot be given away", and tests/strictactions
 * pins every line so a later tidy-up cannot quietly undo it.
 *
 * WHY THE VALIDATORS COME FROM branding.ts. Accepting a picture is the same
 * problem here as it was for the logo, down to the renamed SVG, and a second
 * copy of a security check is a second thing to remember. Only the size cap
 * differs: a logo drawn at 40px has no business being 4 MB, and a ticket going
 * to a press does.
 *
 * ON ADR-5 (business writes belong in SQL functions). These are config-shaped
 * writes — a picture and a set of coordinates — and touch no ticket, book or
 * money row. branding.ts writing config straight from TypeScript is the stated
 * precedent, and this follows it.
 */
import { ApiError, type AppUser } from './gate.ts'
import { faultsIn, MAX_DECORATIONS } from '../_shared/designelements.js'
import { configPayload } from './config.ts'
import { ALLOWED, decode, sniff } from './branding.ts'

type Ctx = {
  supabaseAdmin: {
    from: (t: string) => any
    storage: { from: (b: string) => any }
  }
}

/** Its own bucket, so it exposes only its own contents. */
export const BUCKET = 'ticket-artwork'

/*
 * 4 MB. Base64 inflates by a third, so about 5.4 MB on the wire.
 *
 * The number is a compromise between two real things. A ticket printed at
 * 190 mm wants about 2244 pixels across to hit 300 dpi, and a photographic
 * green background at that width is a megabyte or two of JPEG. Against that,
 * this arrives as base64 inside a JSON body, and the browser doing the sending
 * is often a phone on mobile data. The design page re-encodes anything larger
 * before it is sent and says that it did, rather than refusing outright.
 */
export const MAX_BYTES = 4 * 1024 * 1024

/*
 * HOW MANY ARTWORKS ONE RAFFLE MAY HOLD.
 *
 * Every one of these is up to MAX_BYTES in Storage, kept for the life of the
 * raffle, on a free tier shared with the ticket images and the logo. Four is
 * the number because the reasons to hold more than one are countable: the
 * ticket, a second size, last year's for reference, and the one being replaced
 * — and a fifth is almost always a draft nobody went back and removed.
 *
 * A CEILING IS NOT A CLEANUP. This refuses the fifth; it never deletes the
 * first, because deleting somebody's artwork to make room for an upload they
 * have not finished describing is not a trade this screen may make on their
 * behalf. The organiser chooses which one goes.
 */
export const MAX_TEMPLATES = 4

/*
 * WHAT SHAPE OF TICKET THIS RAFFLE PRINTS.
 *
 * Ships with one: the ticket CEAM already has. A new raffle is not asked to
 * invent a paper size before it can upload anything, and an organiser who
 * changes printer can add theirs on the design page.
 *
 * `tolerance` is on the ASPECT RATIO, not on the pixels, because that is the
 * thing that cannot be corrected later — a picture of the wrong shape either
 * gets stretched or gets cropped, and both are visible on every ticket. The
 * pixel width is a floor rather than a match: more resolution is always
 * welcome, less of it is a blurry press run.
 */
export const DEFAULT_SIZES = [
  {
    id: 'ceam-190x61',
    label: '190 × 61 mm',
    widthMM: 190,
    heightMM: 61.39,
    tolerance: 0.02,
    minWidthPx: 1600,
  },
]

export type TicketSize = typeof DEFAULT_SIZES[number]

/** The accepted sizes for this raffle. Blank config means the built-in list. */
export function acceptedSizes(cfg: Record<string, string>): TicketSize[] {
  const raw = String(cfg.TICKET_SIZES ?? '').trim()
  if (!raw) return DEFAULT_SIZES
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length) return parsed as TicketSize[]
  } catch {
    // A setting nobody can parse is a setting nobody set. Falling back to the
    // built-in list keeps uploading possible while it is being fixed, which is
    // better than a raffle that cannot print because of a stray comma.
  }
  return DEFAULT_SIZES
}

/*
 * Does this picture fit one of them?
 *
 * Returns the size it matched, or null. The caller turns null into a refusal
 * that NAMES what was uploaded and what is accepted — "1600 × 517" on its own
 * tells somebody nothing about what to do next.
 */
export function matchSize(width: number, height: number, sizes: TicketSize[]): TicketSize | null {
  if (!(width > 0 && height > 0)) return null
  const ratio = width / height
  for (const s of sizes) {
    const want = Number(s.widthMM) / Number(s.heightMM)
    const tol = Number(s.tolerance ?? 0.02)
    if (!(want > 0)) continue
    if (Math.abs(ratio - want) / want > tol) continue
    if (width < Number(s.minWidthPx ?? 0)) continue
    return s
  }
  return null
}

/** Why a picture of the right shape was still refused, for the message. */
export function sizeComplaint(width: number, height: number, sizes: TicketSize[]): string {
  const near = sizes.find((s) => {
    const want = Number(s.widthMM) / Number(s.heightMM)
    return want > 0 && Math.abs(width / height - want) / want <= Number(s.tolerance ?? 0.02)
  })
  if (near && width < Number(near.minWidthPx ?? 0)) {
    return `It is the right shape for ${near.label}, but ${width} pixels wide. ` +
      `${near.minWidthPx} is the minimum, and about ${Math.round(Number(near.widthMM) / 25.4 * 300)} ` +
      'would print sharply.'
  }
  const shapes = sizes.map((s) => `${s.label} (${(Number(s.widthMM) / Number(s.heightMM)).toFixed(2)} : 1)`)
  return `That picture is ${(width / height).toFixed(2)} : 1. This raffle prints ` +
    (shapes.length === 1 ? shapes[0] : shapes.join(', ')) + '.'
}

/*
 * HOW BIG IS IT, read out of the file's own header.
 *
 * No image library, on either side of the wire — the repository does not have
 * one and this does not justify the first. Every one of these formats writes
 * its dimensions within the first few dozen bytes, and the bytes have already
 * been proved to BE that format by branding.ts's sniff before this is called.
 *
 * Returns null when the header is truncated or malformed, which the caller
 * reports as an unreadable picture rather than guessing at a size.
 */
export function imageSize(bytes: Uint8Array, type: string): { width: number; height: number } | null {
  const be16 = (i: number) => (bytes[i] << 8) | bytes[i + 1]
  const be32 = (i: number) => ((bytes[i] << 24) >>> 0) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3]
  const tag = (i: number, s: string) => s.split('').every((c, k) => bytes[i + k] === c.charCodeAt(0))

  if (type === 'image/png') {
    // IHDR is required by the spec to be the first chunk, at a fixed offset.
    if (bytes.length < 24 || !tag(12, 'IHDR')) return null
    return { width: be32(16), height: be32(20) }
  }

  if (type === 'image/jpeg') {
    /*
     * JPEG keeps its size in a frame header somewhere after the markers, so it
     * has to be walked. SOF0..SOF15 carry the dimensions, EXCEPT c4 (Huffman
     * table), c8 (reserved) and cc (arithmetic coding table), which share the
     * range and are not frame headers at all — reading those as a size is how
     * a picture comes out 1 × 4 and gets refused for its shape.
     */
    let i = 2
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue }
      const marker = bytes[i + 1]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: be16(i + 5), width: be16(i + 7) }
      }
      const len = be16(i + 2)
      if (len < 2) return null
      i += 2 + len
    }
    return null
  }

  if (type === 'image/webp') {
    if (bytes.length < 30) return null
    // Extended: the canvas size is authoritative and stored minus one.
    if (tag(12, 'VP8X')) {
      const w = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16))
      const h = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16))
      return { width: w, height: h }
    }
    // Lossy: a three-byte frame tag, then the sync code, then 14-bit sizes.
    if (tag(12, 'VP8 ')) {
      if (!(bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a)) return null
      return {
        width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
        height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
      }
    }
    // Lossless: signature byte, then two 14-bit fields packed across bytes.
    if (tag(12, 'VP8L')) {
      if (bytes[20] !== 0x2f) return null
      const b = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)
      return { width: 1 + (b & 0x3fff), height: 1 + ((b >>> 14) & 0x3fff) }
    }
    return null
  }

  return null
}

/* ============ plumbing ============ */

async function currentConfig(ctx: Ctx): Promise<Record<string, string>> {
  const { data } = await ctx.supabaseAdmin.from('config').select('key,value')
  const out: Record<string, string> = {}
  for (const r of data ?? []) out[r.key] = r.value
  return out
}

async function writeConfig(ctx: Ctx, rows: Record<string, string>) {
  const payload = Object.entries(rows).map(([key, value]) => ({ key, value }))
  const { error } = await ctx.supabaseAdmin.from('config').upsert(payload, { onConflict: 'key' })
  if (error) throw new ApiError('QUERY_FAILED', error.message)
}

async function allTemplates(ctx: Ctx) {
  const { data, error } = await ctx.supabaseAdmin
    .from('ticket_templates')
    .select('id,name,content_type,width_px,height_px,bytes,url,design,uploaded_by,uploaded_at')
    .order('uploaded_at', { ascending: false })
  if (error) throw new ApiError('QUERY_FAILED', error.message)
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id ?? ''),
    name: String(r.name ?? ''),
    contentType: String(r.content_type ?? ''),
    width: Number(r.width_px ?? 0),
    height: Number(r.height_px ?? 0),
    bytes: Number(r.bytes ?? 0),
    url: String(r.url ?? ''),
    design: (r.design ?? {}) as Record<string, unknown>,
    uploadedBy: String(r.uploaded_by ?? ''),
    uploadedAt: String(r.uploaded_at ?? ''),
  }))
}

/**
 * Everything the design page draws itself with.
 *
 * `active` is an id and lives in config, not in a column on the table. One
 * place holds which artwork is in use, so there is no pair of facts to drift
 * apart, and whoami can tell a screen whether printing is possible without a
 * second query.
 */
export async function listTemplates(_p: Record<string, unknown>, _user: AppUser, ctx: Ctx) {
  const cfg = await currentConfig(ctx)
  return {
    templates: await allTemplates(ctx),
    active: String(cfg.TICKET_ARTWORK_ID ?? ''),
    sizes: acceptedSizes(cfg),
    verifyUrl: String(cfg.VERIFY_URL ?? ''),
  }
}

/* ============ the actions ============ */

/**
 * Take a picture of a ticket and keep it.
 *
 * The refusals are the substance. In order: something was sent; it is small
 * enough; it really is a PNG, JPEG or WebP (not a renamed SVG); its header can
 * be read; and its shape is one this raffle prints. Each one says what to do
 * next, because the person holding the file is usually not the person who made
 * it and cannot fix what they are not told.
 *
 * The first artwork uploaded becomes the active one. A raffle with exactly one
 * ticket design — which is nearly all of them — never has to find the switch.
 */
export async function uploadTemplate(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  /*
   * THE CEILING IS CHECKED FIRST, before a base64 payload of up to 4 MB is
   * decoded and long before anything reaches Storage. Refusing after the write
   * is how a bucket collects files no row points at: the insert fails, the
   * object stays, and nothing afterwards knows it is there.
   */
  const held = await allTemplates(ctx)
  if (held.length >= MAX_TEMPLATES) {
    throw new ApiError('TOO_MANY_TEMPLATES',
      `This raffle already holds ${held.length} artworks, which is the limit. ` +
      'Remove one you no longer print from, then upload this again.',
      { limit: MAX_TEMPLATES, held: held.map((t) => ({ id: t.id, name: t.name })) })
  }

  const declared = String(p.contentType ?? '')
  const bytes = decode(String(p.data ?? ''))

  if (bytes.length > MAX_BYTES) {
    throw new ApiError('TEMPLATE_TOO_BIG',
      `That picture is ${Math.round(bytes.length / 1024 / 1024 * 10) / 10} MB. The limit is ` +
      `${MAX_BYTES / 1024 / 1024} MB. Save it as a JPEG, or at a smaller size — ` +
      'about 2244 pixels wide is enough to print sharply at 190 mm.')
  }

  const real = sniff(bytes)
  if (real === 'image/svg+xml') {
    throw new ApiError('SVG_REFUSED',
      'SVG artwork cannot be accepted, because an SVG can carry code. ' +
      'Save it as a PNG or JPEG and upload that instead.')
  }
  if (!real || !ALLOWED[declared]) {
    throw new ApiError('BAD_IMAGE', 'That file is not a PNG, JPEG or WebP image.')
  }
  if (real !== declared) {
    throw new ApiError('WRONG_IMAGE_TYPE',
      `That file is named as ${declared} but is really ${real}. Re-save it, or choose it again.`)
  }

  const size = imageSize(bytes, real)
  if (!size) {
    throw new ApiError('BAD_IMAGE',
      'That picture could not be measured — the file looks damaged. Try exporting it again.')
  }

  const cfg = await currentConfig(ctx)
  const sizes = acceptedSizes(cfg)
  const matched = matchSize(size.width, size.height, sizes)
  if (!matched) {
    throw new ApiError('BAD_SIZE', sizeComplaint(size.width, size.height, sizes), {
      width: size.width,
      height: size.height,
      accepted: sizes,
    })
  }

  /*
   * Stamped, so a new upload never serves a stale file from a CDN that has
   * already seen the old one at the same path — and with a random tail, because
   * the stamp alone is not unique.
   *
   * `tpl-${Date.now()}` was the first version of this line and it is wrong for
   * a reason worth keeping: two uploads inside the same millisecond get the
   * same id, and the id is the primary key. In production that is rare; in a
   * test that uploads twice in a row it is certain, which is how it was found.
   * A rare collision would be the worse outcome of the two — one artwork
   * overwriting another's file, or an insert failing for no visible reason.
   */
  const id = `tpl-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
  const name = `${id}.${ALLOWED[declared].ext}`
  const bucket = ctx.supabaseAdmin.storage.from(BUCKET)
  const { error: upErr } = await bucket.upload(name, bytes, {
    contentType: declared, upsert: true, cacheControl: '31536000',
  })
  if (upErr) throw new ApiError('UPLOAD_FAILED', upErr.message)
  const { data: pub } = bucket.getPublicUrl(name)
  const url = String(pub?.publicUrl ?? '')

  const { error } = await ctx.supabaseAdmin.from('ticket_templates').insert({
    id,
    name: String(p.name ?? '').trim() || matched.label,
    content_type: declared,
    width_px: size.width,
    height_px: size.height,
    bytes: bytes.length,
    url,
    design: {},
    uploaded_by: user.email,
  })
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  const templates = await allTemplates(ctx)
  const active = String(cfg.TICKET_ARTWORK_ID ?? '')
  if (!active || !templates.some((t) => t.id === active)) {
    await writeConfig(ctx, { TICKET_ARTWORK_ID: id })
  }

  await ctx.supabaseAdmin.from('audit_log').insert({
    action: 'TEMPLATE_UPLOADED',
    details: { id, bytes: bytes.length, width: size.width, height: size.height, size: matched.id },
    email: user.email,
  })

  const after = await currentConfig(ctx)
  return {
    template: templates.find((t) => t.id === id) ?? null,
    templates,
    active: String(after.TICKET_ARTWORK_ID ?? ''),
    sizes,
    config: configPayload(after),
  }
}

/**
 * Where the number and the QR sit on this artwork.
 *
 * Stored as it arrives, after being checked for shape and size. The design is
 * the client's contract with itself — it is written by the design page and read
 * by the printing code — so this validates that it is storable rather than
 * trying to have an opinion about every field. The one thing it does enforce is
 * a ceiling, because a jsonb column with no limit is a place to put a megabyte.
 */
export async function setTemplateDesign(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const id = String(p.id ?? '').trim()
  if (!id) throw new ApiError('MISSING_FIELD', 'Which artwork? No template was named.')

  const design = p.design
  if (!design || typeof design !== 'object' || Array.isArray(design)) {
    throw new ApiError('BAD_DESIGN', 'That design could not be read.')
  }
  let encoded: string
  try {
    encoded = JSON.stringify(design)
  } catch {
    throw new ApiError('BAD_DESIGN', 'That design could not be read.')
  }
  /*
   * THE LIMIT WENT UP WHEN DESIGNS GAINED THINGS SOMEBODY DRAWS.
   *
   * 8192 was right while a design held nothing but coordinates, and the
   * sentence it carried is still the point: this column holds a design, not a
   * picture. What changed is that a design can now carry up to
   * MAX_DECORATIONS shapes, and one of those with every field set is about a
   * kilobyte — so sixty of them plus the measurements is around 60k, and the
   * old ceiling would have refused a ticket somebody had legitimately drawn.
   *
   * IT IS BOUNDED BY CONSTRUCTION RATHER THAN BY THIS NUMBER, which is the part
   * that makes raising it safe. A decoration cannot carry a picture: an image
   * refers to one already uploaded, by address, and a `data:` URI is refused in
   * designelements.js precisely so that this ceiling stays a formality instead
   * of becoming the thing standing between the column and a photograph.
   */
  if (encoded.length > 65536) {
    throw new ApiError('BAD_DESIGN',
      `That design is ${encoded.length} characters. The limit is 65536 — it holds ` +
      `coordinates and up to ${MAX_DECORATIONS} drawn shapes, not pictures.`)
  }
  // A coordinate that is not a number puts the ticket number nowhere, and NaN
  // survives JSON.stringify as null rather than failing here.
  const numbersAreReal = (v: unknown): boolean => {
    if (typeof v === 'number') return Number.isFinite(v)
    if (Array.isArray(v)) return v.every(numbersAreReal)
    if (v && typeof v === 'object') return Object.values(v).every(numbersAreReal)
    return true
  }
  if (!numbersAreReal(design)) {
    throw new ApiError('BAD_DESIGN', 'That design has a measurement that is not a number.')
  }

  /*
   * AND THE THINGS SOMEBODY DREW, checked by the same module the studio draws
   * them with rather than by a second opinion written here.
   *
   * That is the whole reason designelements lives in _shared. A copy of these
   * rules in this file would agree with the studio on the day it was written
   * and then let somebody draw a thing the server refuses — or, worse, accept
   * one it should not have. branding.ts had exactly that shape this week: a
   * hardcoded list of card treatments that a fourth treatment was missing from,
   * so a card could be previewed and not saved.
   *
   * THE CODE BOXES COME FROM THE DESIGN'S OWN ELEMENTS, so the rule is checked
   * against where the QR actually is on THIS ticket rather than where it
   * usually is. Both halves — a printed ticket carries one on each.
   */
  const d = design as { decorations?: unknown; elements?: unknown }
  if (d.decorations !== undefined) {
    const codeBoxes = (Array.isArray(d.elements) ? d.elements : [])
      .filter((e: { kind?: string; enabled?: boolean }) => e?.kind === 'code' && e?.enabled !== false)
      .map((e: { box?: unknown }) => e.box)
    const faults = faultsIn(d.decorations, { codeBoxes })
    if (faults.length) {
      throw new ApiError('BAD_DESIGN', faults.join(' '), { faults })
    }
  }

  const { data, error } = await ctx.supabaseAdmin
    .from('ticket_templates').update({ design }).eq('id', id).select('id')
  if (error) throw new ApiError('QUERY_FAILED', error.message)
  if (!data || !data.length) {
    throw new ApiError('TEMPLATE_NOT_FOUND', 'That artwork is no longer here. Reload the page.')
  }

  await ctx.supabaseAdmin.from('audit_log').insert({
    action: 'TEMPLATE_DESIGN', details: { id, bytes: encoded.length }, email: user.email,
  })
  const cfg = await currentConfig(ctx)
  return {
    templates: await allTemplates(ctx),
    active: String(cfg.TICKET_ARTWORK_ID ?? ''),
    sizes: acceptedSizes(cfg),
  }
}

/** Which artwork the tickets are printed from. */
export async function setActiveTemplate(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const id = String(p.id ?? '').trim()
  const templates = await allTemplates(ctx)
  if (id && !templates.some((t) => t.id === id)) {
    throw new ApiError('TEMPLATE_NOT_FOUND', 'That artwork is no longer here. Reload the page.')
  }
  await writeConfig(ctx, { TICKET_ARTWORK_ID: id })
  await ctx.supabaseAdmin.from('audit_log')
    .insert({ action: 'TEMPLATE_ACTIVE', details: { id }, email: user.email })
  const cfg = await currentConfig(ctx)
  return { templates, active: id, sizes: acceptedSizes(cfg), config: configPayload(cfg) }
}

/**
 * Take one away.
 *
 * The row goes first and the file second, the same ordering uploadLogo uses: if
 * the delete fails, the page shows one fewer artwork, which is what was asked
 * for. The other order leaves a deleted file still named in a row and a broken
 * picture on the design page.
 *
 * Removing the active one leaves the raffle with no artwork rather than
 * silently promoting another — printing stops and says so, which is better than
 * a press run on a design nobody chose.
 */
export async function removeTemplate(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const id = String(p.id ?? '').trim()
  if (!id) throw new ApiError('MISSING_FIELD', 'Which artwork? No template was named.')

  const before = await allTemplates(ctx)
  const row = before.find((t) => t.id === id)
  if (!row) throw new ApiError('TEMPLATE_NOT_FOUND', 'That artwork is no longer here. Reload the page.')

  const cfg = await currentConfig(ctx)
  if (String(cfg.TICKET_ARTWORK_ID ?? '') === id) {
    await writeConfig(ctx, { TICKET_ARTWORK_ID: '' })
  }
  const { error } = await ctx.supabaseAdmin.from('ticket_templates').delete().eq('id', id)
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  const path = String(row.url ?? '').split(`/${BUCKET}/`)[1]
  if (path) await ctx.supabaseAdmin.storage.from(BUCKET).remove([path])

  await ctx.supabaseAdmin.from('audit_log')
    .insert({ action: 'TEMPLATE_REMOVED', details: { id }, email: user.email })

  const after = await currentConfig(ctx)
  return {
    templates: await allTemplates(ctx),
    active: String(after.TICKET_ARTWORK_ID ?? ''),
    sizes: acceptedSizes(after),
    config: configPayload(after),
  }
}

/**
 * The shapes of paper this raffle prints.
 *
 * An empty list restores the built-in one rather than leaving a raffle that can
 * accept nothing — "I have deleted all of them" should not be a state a person
 * has to recover from by editing the database.
 */
export async function setTicketSizes(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const raw = p.sizes
  if (!Array.isArray(raw)) {
    throw new ApiError('BAD_SIZES', 'That list of sizes could not be read.')
  }
  const clean: TicketSize[] = []
  for (const s of raw) {
    if (!s || typeof s !== 'object') {
      throw new ApiError('BAD_SIZES', 'That list of sizes could not be read.')
    }
    const row = s as Record<string, unknown>
    const widthMM = Number(row.widthMM)
    const heightMM = Number(row.heightMM)
    const label = String(row.label ?? '').trim()
    if (!label) throw new ApiError('BAD_SIZES', 'Every size needs a name.')
    if (!(widthMM > 0 && heightMM > 0)) {
      throw new ApiError('BAD_SIZES',
        `"${label}" needs a width and a height in millimetres, both above nought.`)
    }
    const tolerance = Number(row.tolerance ?? 0.02)
    if (!(tolerance >= 0 && tolerance <= 0.5)) {
      throw new ApiError('BAD_SIZES',
        `"${label}" has a tolerance of ${row.tolerance}. It is a fraction of the shape — ` +
        '0.02 allows two per cent, and half is as loose as it goes.')
    }
    const minWidthPx = Math.max(0, Math.round(Number(row.minWidthPx ?? 0)) || 0)
    clean.push({
      id: String(row.id ?? '').trim() || label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      label, widthMM, heightMM, tolerance, minWidthPx,
    })
  }

  await writeConfig(ctx, { TICKET_SIZES: clean.length ? JSON.stringify(clean) : '' })
  await ctx.supabaseAdmin.from('audit_log')
    .insert({ action: 'TICKET_SIZES', details: { count: clean.length }, email: user.email })

  const cfg = await currentConfig(ctx)
  return {
    templates: await allTemplates(ctx),
    active: String(cfg.TICKET_ARTWORK_ID ?? ''),
    sizes: acceptedSizes(cfg),
  }
}
