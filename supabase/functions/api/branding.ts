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
import { configPayload } from './config.ts'

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
