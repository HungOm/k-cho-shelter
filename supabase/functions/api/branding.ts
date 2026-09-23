/*
 * The raffle's own mark and colour.
 *
 * Raffled is a product; the raffle belongs to whoever is running it. The logo
 * and the colour are that organisation's identity, so they live in config and
 * in a storage bucket rather than in the code — the alternative, which this app
 * shipped until today, was one organisation's logo on every deployment's
 * screens and printed receipts.
 *
 * BOTH ACTIONS WRITE CONFIG AND RETURN THE WHOLE CONFIG, deliberately. The
 * alternative — return a URL and let the client write it back — can half-fail:
 * bytes stored, config not written, an orphan file and still no logo, on the
 * connection where the second call is the one that drops. Returning whoami's
 * own config object means a screen does exactly one thing afterwards,
 * state.cfg = res.config, with no second shape to diverge from.
 */
import { ApiError, type AppUser } from './gate.ts'
import { CARD_TREATMENT_IDS, isCardTreatment } from '../_shared/cardtreatments.js'
import { configPayload } from './config.ts'
import { PRESETS, SLOTS } from '../_shared/ranks.ts'
import { libraryFaults, normalLibrary } from '../_shared/designlibrary.js'

type Ctx = {
  supabaseAdmin: {
    from: (t: string) => any
    storage: { from: (b: string) => any }
  }
}

/** Where branding lives. Its own bucket, so it exposes only its own contents. */
export const BUCKET = 'branding'

/*
 * `decode`, `sniff` and `ALLOWED` are exported for templates.ts, which accepts
 * the ticket artwork and needs exactly the same refusals — a renamed SVG is no
 * safer on a ticket than on a logo, and both are served from this origin.
 *
 * Exported rather than copied on purpose. The sniff is a security check, and a
 * second copy is a second thing to remember when a format is added or a hole is
 * found; the WebP RIFF/WEBP pair below was already subtle enough to get wrong
 * once. templates.ts sets its own size cap, because a print-resolution ticket
 * is legitimately larger than a logo drawn at 40px.
 */

/*
 * WHAT MAY BE STORED, and SVG is refused on purpose.
 *
 * An SVG can carry script, and this one would be served from the raffle's own
 * origin — the same origin as the session, next to several thousand people's
 * telephone numbers. That is stored cross-site scripting with an upload button
 * in front of it. Sanitising SVG properly is a library and a running argument;
 * refusing it is one line, and a logo that only exists as SVG can be exported
 * to PNG by whoever supplies it.
 */
export const ALLOWED: Record<string, { ext: string; magic: number[][] }> = {
  'image/png': { ext: 'png', magic: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] },
  'image/jpeg': { ext: 'jpg', magic: [[0xff, 0xd8, 0xff]] },
  'image/webp': { ext: 'webp', magic: [] },   // checked below: RIFF....WEBP
}

/** 512 KB per file. Base64 inflates by a third, so ~683 KB on the wire. */
const MAX_BYTES = 512 * 1024

export function decode(b64: string): Uint8Array {
  const clean = String(b64 ?? '').replace(/^data:[^,]*,/, '').replace(/\s/g, '')
  if (!clean) throw new ApiError('MISSING_FIELD', 'No image was sent.')
  let bin: string
  try {
    bin = atob(clean)
  } catch {
    throw new ApiError('BAD_IMAGE', 'That file could not be read. Try choosing it again.')
  }
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/*
 * WHAT THE FILE ACTUALLY IS, not what it says it is.
 *
 * Both the filename and the declared content type are supplied by whoever
 * picked the file, and a browser reports image/png for a renamed SVG without
 * hesitating. So the declared type must be on the allowlist AND the first bytes
 * must match it. The filename is not consulted at all here — the stored name is
 * ours, so the one the browser sent tells us nothing an attacker cannot change.
 */
export function sniff(bytes: Uint8Array): string | null {
  const starts = (sig: number[]) => sig.every((b, i) => bytes[i] === b)
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg'
  // RIFF alone is also WAV and AVI, so the WEBP tag at offset 8 is required.
  if (starts([0x52, 0x49, 0x46, 0x46]) &&
      [0x57, 0x45, 0x42, 0x50].every((b, i) => bytes[8 + i] === b)) return 'image/webp'
  if (/^\s*(<\?xml|<svg)/i.test(new TextDecoder().decode(bytes.slice(0, 64)))) return 'image/svg+xml'
  return null
}

function checkImage(b64: unknown, declared: string, which: string): Uint8Array {
  const bytes = decode(String(b64 ?? ''))
  if (bytes.length > MAX_BYTES) {
    throw new ApiError('IMAGE_TOO_BIG',
      `That ${which} is ${Math.round(bytes.length / 1024)} KB. The limit is ` +
      `${MAX_BYTES / 1024} KB — a logo drawn at 40px does not need more, and ` +
      'volunteers open this on mobile data.')
  }
  const real = sniff(bytes)
  if (real === 'image/svg+xml') {
    throw new ApiError('SVG_REFUSED',
      'SVG logos cannot be accepted, because an SVG can carry code. ' +
      'Save it as a PNG and upload that instead.')
  }
  if (!real || !ALLOWED[declared]) {
    throw new ApiError('BAD_IMAGE',
      'That file is not a PNG, JPEG or WebP image.')
  }
  // A genuine picture under the wrong name gets its own sentence: it is almost
  // always a mistake, and "unreadable" sends somebody hunting the wrong problem.
  if (real !== declared) {
    throw new ApiError('WRONG_IMAGE_TYPE',
      `That file is named as ${declared} but is really ${real}. ` +
      'Re-save it, or choose it again.')
  }
  return bytes
}

/*
 * CARD 8c — WHAT THE BUYER RECEIVES.
 *
 * The three treatments were drawable and pickable and nothing could SAVE a
 * choice: ViewTicket read `cardDesign` off the config and no key of that name
 * was ever written, so every raffle quietly used Grand. The motto is worse —
 * all three cards draw `values.motto`, cardValues passes `state.cfg.motto`, and
 * there was no field anywhere in the product that set it. A drawn element with
 * no way to fill it is a feature that exists only in the source.
 *
 * FORTY-EIGHT CHARACTERS, REFUSED RATHER THAN SHRUNK, which is 8c's own rule.
 * The motto is drawn at one size on a card whose width is fixed, so a longer
 * line either overflows the card or has to be scaled down until it is a
 * different typographic decision from the one that was designed. Refusing says
 * so while somebody can still edit it; shrinking hides it until it prints.
 */
export async function setCardDesign(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  /*
   * THE LIST IS IMPORTED AND NEVER WRITTEN HERE. It was a hand-typed
   * `['grand', 'certificate', 'stub']`, a fourth treatment was added on the
   * client, and this copy did not learn about it — so the Supporter card could
   * be chosen in the studio, previewed, and refused on save. See
   * _shared/cardtreatments.js; there is a guard in tests/cardlayout that fails
   * if an array like that is ever written in this file again.
   */
  const design = String(p.cardDesign ?? '').trim().toLowerCase()
  if (!isCardTreatment(design)) {
    throw new ApiError('BAD_DESIGN',
      `${design} is not one of the ticket treatments (${CARD_TREATMENT_IDS.join(', ')}).`)
  }

  const motto = String(p.motto ?? '').replace(/\s+/g, ' ').trim()
  if (motto.length > 48) {
    throw new ApiError('MOTTO_TOO_LONG',
      `The motto is ${motto.length} characters and the card holds 48. ` +
      'A longer line is refused rather than shrunk, because shrinking it changes ' +
      'the design silently and you would not see it until it printed.',
      { length: motto.length, max: 48 })
  }
  /* The only free text on a card a buyer is sent. Angle brackets go for the
     same reason they go from the about text — this ends up inside an SVG. */
  if (/[<>]/.test(motto)) {
    throw new ApiError('BAD_MOTTO', 'The motto cannot contain < or >.')
  }

  /*
   * WHERE THE PARTS OF THE CARD SIT, when the organiser has moved any.
   *
   * Absent means "do not touch it", not "clear it". The treatment and the
   * motto can be saved by a screen that never opened the layout — and an
   * older bundle posts neither — so a missing key has to leave the stored
   * layout alone. `null` is the explicit way back to the standard card.
   *
   * VALIDATED THE WAY `setTemplateDesign` VALIDATES A PRINTED DESIGN, and for
   * the same reason: the shape, the size and whether every number is a real
   * number. What a sensible box IS belongs to `cardelements.js`, which draws
   * the card and is the only thing that can say — and which refuses a bad
   * value on the way IN as well, so a layout that got past this is still drawn
   * at its standard position rather than off the card.
   */
  let layout: unknown
  if (p.cardLayout !== undefined) {
    layout = p.cardLayout === null ? {} : p.cardLayout
    if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
      throw new ApiError('BAD_CARD_LAYOUT', 'That card layout could not be read.')
    }
    for (const [treatment, parts] of Object.entries(layout as Record<string, unknown>)) {
      /*
       * `isCardTreatment`, NOT A LOCAL `ALLOWED`. This read
       * `ALLOWED.includes(treatment)` against a local array of treatment ids,
       * and when that array moved to _shared/cardtreatments.js the call site
       * thirty lines below the replacement was missed. The name did not go
       * undefined — it rebound to the MODULE-LEVEL `ALLOWED` at the top of
       * this file, which is the allowed IMAGE MIME TYPES and is a Record. A
       * Record has no `.includes`, so every save carrying a cardLayout threw
       * "ALLOWED.includes is not a function" and the studio could not save.
       *
       * noundef cannot see this: the name IS defined. That is the whole shape
       * of it — deleting a local const does not break a reference, it silently
       * hands it to an outer binding of a different type.
       */
      if (!isCardTreatment(treatment)) {
        throw new ApiError('BAD_CARD_LAYOUT',
          `${treatment} is not one of the ticket treatments (${CARD_TREATMENT_IDS.join(', ')}).`)
      }
      if (!parts || typeof parts !== 'object' || Array.isArray(parts)) {
        throw new ApiError('BAD_CARD_LAYOUT', `The ${treatment} layout is not a set of parts.`)
      }
    }
    // NaN survives JSON.stringify as null rather than failing, so a coordinate
    // that is not a number has to be looked for rather than caught.
    const numbersAreReal = (v: unknown): boolean => {
      if (typeof v === 'number') return Number.isFinite(v)
      if (Array.isArray(v)) return v.every(numbersAreReal)
      if (v && typeof v === 'object') return Object.values(v).every(numbersAreReal)
      return true
    }
    if (!numbersAreReal(layout)) {
      throw new ApiError('BAD_CARD_LAYOUT', 'That card layout has a measurement that is not a number.')
    }
    const encoded = JSON.stringify(layout)
    if (encoded.length > 8192) {
      throw new ApiError('BAD_CARD_LAYOUT',
        `That card layout is ${encoded.length} characters. The limit is 8192 — it holds ` +
        'the parts somebody has moved, not the whole card.')
    }
  }

  /*
   * THE OTHER TWO SENTENCES THE CARD SAYS, and they arrive here rather than in
   * an action of their own because this IS the card's words: the motto has
   * always been set on this call, and a second endpoint writing a third
   * sentence onto the same object is a second place for a screen to disagree
   * about what a card holds.
   *
   * ABSENT MEANS "DO NOT TOUCH", the same rule the layout above follows and
   * for the same reason: an older bundle posts neither, and a missing key that
   * cleared the value would empty an organiser's words the next time somebody
   * saved a treatment from a screen that has never heard of them. Only an
   * explicit empty string clears one.
   */
  const words: Record<string, string> = {}
  for (const [key, field, limit] of [
    ['TOP_PRIZE', 'topPrize', 48],
    ['IMPACT_LINE', 'impactLine', 96],
  ] as const) {
    if (p[field] === undefined) continue
    const text = String(p[field] ?? '').replace(/\s+/g, ' ').trim()
    if (text.length > limit) {
      throw new ApiError('CARD_WORDS_TOO_LONG',
        `That line is ${text.length} characters and the card holds ${limit}. ` +
        'A longer one is refused rather than shrunk, because shrinking changes ' +
        'the card where nobody is looking.',
        { field, length: text.length, max: limit })
    }
    /* Same reason as the motto: this ends up inside an SVG. */
    if (/[<>]/.test(text)) {
      throw new ApiError('BAD_CARD_WORDS', 'That line cannot contain < or >.')
    }
    words[key] = text
  }

  const rows: Record<string, string> = { CARD_DESIGN: design, MOTTO: motto, ...words }
  if (layout !== undefined) {
    /* An empty overlay is stored as the empty string rather than as "{}", so
       "has this raffle designed its card" is the same question as "is this
       value blank" — which is how every other config key answers it. */
    const encoded = JSON.stringify(layout)
    rows.CARD_LAYOUT = encoded === '{}' ? '' : encoded
  }

  await writeConfig(ctx, rows)
  await ctx.supabaseAdmin.from('audit_log').insert({
    action: 'SET_CARD_DESIGN',
    details: {
      design, motto, ...words,
      layout: layout === undefined ? 'unchanged' : Object.keys(layout as object),
    },
    email: user.email,
  })
  return { config: configPayload(await currentConfig(ctx)) }
}

async function writeConfig(ctx: Ctx, rows: Record<string, string>) {
  const payload = Object.entries(rows).map(([key, value]) => ({ key, value }))
  const { error } = await ctx.supabaseAdmin
    .from('config').upsert(payload, { onConflict: 'key' })
  if (error) throw new ApiError('QUERY_FAILED', error.message)
}

async function currentConfig(ctx: Ctx): Promise<Record<string, string>> {
  const { data } = await ctx.supabaseAdmin.from('config').select('key,value')
  const out: Record<string, string> = {}
  for (const r of data ?? []) out[r.key] = r.value
  return out
}

/* ============ THE ACTIONS ============ */

/**
 * Store the organiser's logo, or take it off.
 *
 * `remove: true` clears both keys and deletes the stored objects; nothing else
 * is read when it is set. Without an explicit removal path the only way to undo
 * an upload is to upload something else, which is how a wrong logo stays.
 */
export async function uploadLogo(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const bucket = ctx.supabaseAdmin.storage.from(BUCKET)

  if (p.remove) {
    const cfg = await currentConfig(ctx)
    const paths = [cfg.ORG_LOGO, cfg.ORG_LOGO_SMALL]
      .map((u) => String(u ?? '').split(`/${BUCKET}/`)[1])
      .filter(Boolean) as string[]
    // The config rows go first. If the delete fails the page shows no logo,
    // which is what was asked for; the other order leaves a deleted file still
    // named in config and a broken image on every screen.
    await writeConfig(ctx, { ORG_LOGO: '', ORG_LOGO_SMALL: '' })
    if (paths.length) await bucket.remove(paths)
    await ctx.supabaseAdmin.from('audit_log')
      .insert({ action: 'LOGO_REMOVED', details: { files: paths.length }, email: user.email })
    return { config: configPayload(await currentConfig(ctx)) }
  }

  const declared = String(p.contentType ?? '')
  const big = checkImage(p.data, declared, 'logo')
  const small = p.dataSmall ? checkImage(p.dataSmall, declared, 'small logo') : null

  const ext = ALLOWED[declared].ext
  // Stamped, so a new upload never serves a stale file from a cache or a CDN
  // that has already seen the old one at the same path.
  const stamp = Date.now()
  const put = async (name: string, bytes: Uint8Array) => {
    const { error } = await bucket.upload(name, bytes, {
      contentType: declared, upsert: true, cacheControl: '31536000',
    })
    if (error) throw new ApiError('UPLOAD_FAILED', error.message)
    const { data } = bucket.getPublicUrl(name)
    return String(data?.publicUrl ?? '')
  }

  const bigUrl = await put(`logo-${stamp}.${ext}`, big)
  const smallUrl = small ? await put(`logo-${stamp}-small.${ext}`, small) : ''

  await writeConfig(ctx, { ORG_LOGO: bigUrl, ORG_LOGO_SMALL: smallUrl })
  await ctx.supabaseAdmin.from('audit_log').insert({
    action: 'LOGO_UPLOADED',
    details: { bytes: big.length, smallBytes: small?.length ?? 0, type: declared },
    email: user.email,
  })
  return { config: configPayload(await currentConfig(ctx)) }
}

/**
 * The one colour everything else is derived from.
 *
 * Blank clears it, which is the same meaning blank has everywhere else in this
 * config rather than a new rule to learn — applyBrand removes the tokens and
 * the stylesheet's own colour stands.
 *
 * Only --brand is stored. The text colour on top is COMPUTED from it, because
 * an organisation choosing a colour is not choosing a contrast ratio, and the
 * primary button says "Count a book in" on a phone held outdoors.
 */
/*
 * WHAT THIS RAFFLE CALLS ITS SUPPORTERS.
 *
 * Five rungs, bottom first, each a name and a threshold in whole BOOKS. The
 * names are the organiser's; the thresholds are theirs too. What is NOT theirs
 * is who lands on which rung — that is counted from the tickets a buyer holds,
 * here and on the public check page, and there is no screen that awards one.
 *
 * REFUSED RATHER THAN REPAIRED, and every refusal says which rung and why.
 * `ladderFrom` on the reading side falls back to the default preset for
 * anything it cannot use, silently, because it runs inside a page that is
 * drawing somebody's ticket and must never throw. That safety is exactly why
 * this side has to be strict: a ladder quietly replaced by the default at READ
 * time is an organiser who saved their words, saw the screen say "Saved", and
 * is being shown somebody else's on every card. The error belongs where
 * somebody is looking at a form.
 */
export async function setSupporterBands(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const preset = String(p.preset ?? '').trim()
  if (preset && !PRESETS.some((x) => x.id === preset)) {
    throw new ApiError('BAD_BANDS',
      `${preset} is not one of the presets (${PRESETS.map((x) => x.id).join(', ')}).`)
  }

  const raw = p.rungs
  if (!Array.isArray(raw) || raw.length !== SLOTS.length) {
    throw new ApiError('BAD_BANDS',
      `A supporter ladder has ${SLOTS.length} rungs, lowest first. This has ` +
      `${Array.isArray(raw) ? raw.length : 'none'}.`)
  }

  const rungs: { name: string; minBooks: number }[] = []
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i] as { name?: unknown; minBooks?: unknown } | null
    const where = `Rung ${i + 1}`
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      throw new ApiError('BAD_BANDS', `${where} could not be read.`)
    }
    const name = String(r.name ?? '').trim().replace(/\s+/g, ' ')
    if (!name) {
      throw new ApiError('BAD_BANDS',
        `${where} has no name. Every rung is printed on somebody's card, so ` +
        'none of them can be blank.')
    }
    if (name.length > 24) {
      throw new ApiError('BAD_BANDS',
        `${where} is ${name.length} characters and a card holds 24. A longer ` +
        'name is refused rather than shrunk, because shrinking it changes the ' +
        'card silently and you would not see it until it was sent.',
        { rung: i + 1, length: name.length, max: 24 })
    }
    /* The same two characters the motto refuses, and for the same reason: this
       ends up inside an SVG that goes to a buyer as a picture. */
    if (/[<>]/.test(name)) {
      throw new ApiError('BAD_BANDS', `${where} cannot contain < or >.`)
    }

    const minBooks = Number(r.minBooks)
    if (!Number.isFinite(minBooks) || minBooks < 0 || minBooks !== Math.floor(minBooks)) {
      throw new ApiError('BAD_BANDS',
        `${where} needs a whole number of books, counting from 0.`)
    }
    if (minBooks > 10000) {
      throw new ApiError('BAD_BANDS', `${where} is more books than any raffle has.`)
    }
    rungs.push({ name, minBooks })
  }

  /*
   * STRICTLY ASCENDING, which is the one property the rest of the app depends
   * on. `rankFor` takes the FIRST rung whose threshold is met, reading from the
   * top — so a rung that does not sit strictly above the one below it can never
   * be returned. It would still be listed, still be named, and simply never
   * happen to anybody: a rung nobody can reach is not a validation nicety, it
   * is a name the organiser typed and will never see.
   */
  for (let i = 1; i < rungs.length; i++) {
    if (rungs[i].minBooks <= rungs[i - 1].minBooks) {
      throw new ApiError('BAD_BANDS',
        `Rung ${i + 1} ("${rungs[i].name}") starts at ${rungs[i].minBooks} books, ` +
        `which is not above rung ${i} ("${rungs[i - 1].name}") at ${rungs[i - 1].minBooks}. ` +
        'Each rung has to start higher than the one below it, or nobody can ever reach it.',
        { rung: i + 1, minBooks: rungs[i].minBooks, below: rungs[i - 1].minBooks })
    }
  }

  await writeConfig(ctx, { SUPPORTER_BANDS: JSON.stringify({ preset, rungs }) })
  await ctx.supabaseAdmin.from('audit_log').insert({
    action: 'SET_SUPPORTER_BANDS',
    details: { preset, rungs: rungs.map((r) => `${r.name} @ ${r.minBooks}`) },
    email: user.email,
  })
  return { config: configPayload(await currentConfig(ctx)) }
}

/*
 * WHAT THIS RAFFLE KEEPS.
 *
 * Refused rather than repaired, and every fault named — the pair this repo
 * settled on for the supporter ladder and for decorations, and for the same
 * reason: the reading side normalises silently because it runs inside a screen
 * drawing somebody's ticket, and a library quietly repaired on the way in is
 * an organiser being shown a badge they did not save.
 *
 * WHOLE, NOT PATCHED. The panel sends the library it is holding, and this
 * replaces the row. A per-item add and remove would be four more actions and
 * four more races between two people with the same screen open; the library is
 * small enough that sending all of it is simpler and cannot half-apply.
 */
export async function setDesignLibrary(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const faults = libraryFaults(p.library)
  if (faults.length) throw new ApiError('BAD_LIBRARY', faults.join(' '), { faults })

  const lib = normalLibrary(p.library)
  const encoded = JSON.stringify(lib)
  /*
   * Bounded by the per-kind caps rather than by this number — 40 shapes of at
   * most 12 pieces is the real ceiling, and a piece cannot carry a picture
   * because an image refers to one already uploaded. This is the formality
   * behind that, the same shape as the design limit in templates.ts.
   */
  if (encoded.length > 65536) {
    throw new ApiError('BAD_LIBRARY',
      `That library is ${encoded.length} characters. The limit is 65536.`)
  }

  /* An empty library is stored as the empty string rather than as three empty
     lists, so "has this raffle saved anything" is the same question as "is
     this value blank" — which is how every other config key answers it. */
  const bare = !lib.shapes.length && !lib.colours.length && !lib.styles.length
  await writeConfig(ctx, { DESIGN_LIBRARY: bare ? '' : encoded })
  await ctx.supabaseAdmin.from('audit_log').insert({
    action: 'SET_DESIGN_LIBRARY',
    details: { shapes: lib.shapes.length, colours: lib.colours.length, styles: lib.styles.length },
    email: user.email,
  })
  return { config: configPayload(await currentConfig(ctx)) }
}

export async function setBrandColor(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const raw = String(p.color ?? '').trim()
  if (raw === '') {
    await writeConfig(ctx, { BRAND_COLOR: '' })
    return { config: configPayload(await currentConfig(ctx)) }
  }
  const hex = raw.startsWith('#') ? raw : '#' + raw
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) {
    throw new ApiError('BAD_COLOUR',
      `"${raw}" is not a colour. It should look like #0B7285 — six letters or ` +
      'numbers after a hash. Leave it empty to use the standard colour.')
  }
  await writeConfig(ctx, { BRAND_COLOR: hex.toLowerCase() })
  await ctx.supabaseAdmin.from('audit_log')
    .insert({ action: 'BRAND_COLOR', details: { colour: hex }, email: user.email })
  return { config: configPayload(await currentConfig(ctx)) }
}

/**
 * HOW TO REACH THE ORGANISERS — phone, email, website.
 *
 * WHY THIS EXISTS. The public check page offers a stranger holding a ticket
 * that does not verify three actions — call the office, contact us, report it —
 * and until now none of them had anywhere to point. There is no phone, email or
 * address for the organisation anywhere in config or schema. A dial button that
 * dials nothing is worse than no button on that page: it spends the one moment
 * somebody was willing to act in, and the person it fails is the one who has
 * just been sold a forgery.
 *
 * ALL THREE ARE OPTIONAL AND BLANK IS A REAL ANSWER. An organiser who has not
 * given a website gets no website link, not a broken one. Nothing here is ever
 * defaulted or guessed: a wrong number on a fraud-report page reaches a
 * stranger who is already suspicious, and the wrong charity gets the call.
 *
 * THE WEBSITE IS THE ONE THAT NEEDS GUARDING. It is the only field here that
 * becomes an href on a page anybody can reach without signing in, so the scheme
 * is checked rather than the shape: http and https only, and nothing else gets
 * near an anchor. `javascript:` and `data:` are the reason — a settings field
 * that reaches an unauthenticated page is a stored-XSS hole if it is trusted,
 * and the organiser who types it is not necessarily the person who owns the
 * raffle a week later.
 *
 * The phone is stored AS TYPED. It is dialled by a human reading it as much as
 * by a tel: link, and the shapes are genuinely various — +60 3-1234 5678,
 * 03-1234 5678, extensions. Stripping it to digits would lose what makes it
 * readable and would not make it more correct.
 */
export async function setOrgContact(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const phone = String(p.phone ?? '').trim()
  const email = String(p.email ?? '').trim()
  const website = String(p.website ?? '').trim()

  if (phone && !/^[+\d][\d\s()\-.]{4,24}$/.test(phone)) {
    throw new ApiError('BAD_PHONE',
      `"${phone}" does not look like a telephone number. Digits, spaces, ` +
      'brackets and dashes, starting with a number or +. Leave it empty if ' +
      'there is no office number to give.')
  }
  if (email && !/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(email)) {
    throw new ApiError('BAD_EMAIL',
      `"${email}" does not look like an email address. Leave it empty if there ` +
      'is no address to give.')
  }
  if (website) {
    /*
     * Scheme first, because that is the security question, and the message says
     * what to do rather than only what is wrong — somebody typing their own
     * charity's address will most often have left the https:// off.
     */
    if (!/^https?:\/\//i.test(website)) {
      throw new ApiError('BAD_WEBSITE',
        `"${website}" is not a web address this can use. It has to start with ` +
        'https:// — that is what makes it a link somebody can safely follow ' +
        'from the public ticket-check page.')
    }
    if (/\s/.test(website)) {
      throw new ApiError('BAD_WEBSITE', 'A web address cannot contain a space.')
    }
  }

  await writeConfig(ctx, {
    ORG_PHONE: phone,
    ORG_EMAIL: email,
    ORG_WEBSITE: website,
  })
  /*
   * Audited by WHICH FIELDS CHANGED, not by their values. The audit log is read
   * by more people than the settings screen, and an office number is not a
   * secret but it is not something to scatter through a log either.
   */
  await ctx.supabaseAdmin.from('audit_log').insert({
    action: 'ORG_CONTACT',
    details: { phone: !!phone, email: !!email, website: !!website },
    email: user.email,
  })
  return { config: configPayload(await currentConfig(ctx)) }
}

/**
 * WHAT THE PUBLIC TICKET-CHECK PAGE SAYS THIS RAFFLE IS.
 *
 * The page carries a paragraph under every verdict explaining what kind of
 * thing somebody has been handed — a community raffle sold by volunteers, not
 * a commercial ticket. It shipped as a fixed string in two languages, which
 * was right for the raffle it was written for and wrong for every other one:
 * a different charity, a different cause, a different sentence, and no way to
 * say so without a deploy.
 *
 * BOTH HALVES OR NEITHER IS NOT ENFORCED, and that is deliberate. An organiser
 * who writes only the Burmese has improved the page for nearly everybody who
 * scans a ticket; refusing that until they also write English would be the
 * app preferring its own tidiness to the reader's. Each half falls back to the
 * built-in default on its own.
 *
 * PLAIN TEXT ONLY. This goes onto a page served to strangers, and although the
 * page escapes it on the way out, a `<` is rejected HERE so that somebody
 * pasting formatted text finds out at the moment they paste rather than seeing
 * their angle brackets appear literally on the public page later.
 */
export const ABOUT_MAX = 600

export async function setOrgAbout(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const my = String(p.my ?? '').trim()
  const en = String(p.en ?? '').trim()

  for (const [label, v] of [['Burmese', my], ['English', en]] as const) {
    if (v.length > ABOUT_MAX) {
      throw new ApiError('ABOUT_TOO_LONG',
        `The ${label} description is ${v.length} characters and the limit is ` +
        `${ABOUT_MAX}. This sits under the answer on the ticket-check page, ` +
        'which somebody reads on a phone in a hall — a paragraph, not a page.')
    }
    if (/[<>]/.test(v)) {
      throw new ApiError('ABOUT_MARKUP',
        `The ${label} description cannot contain < or >. It is shown as plain ` +
        'text on the public page, so any markup would appear literally.')
    }
  }

  await writeConfig(ctx, { ORG_ABOUT_MY: my, ORG_ABOUT_EN: en })
  /*
   * Audited by which halves were set, not by their text — the same reasoning as
   * ORG_CONTACT. This one is public copy rather than a contact detail, but the
   * audit log is still read by more people than the settings screen and a
   * paragraph repeated into it every time somebody fixes a typo is noise.
   */
  await ctx.supabaseAdmin.from('audit_log').insert({
    action: 'ORG_ABOUT',
    details: { my: !!my, en: !!en },
    email: user.email,
  })
  return { config: configPayload(await currentConfig(ctx)) }
}
