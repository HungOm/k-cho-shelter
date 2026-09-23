/*
 * What may be stored as a raffle's logo.
 *
 * THE ATTACK THIS REFUSES: an SVG can carry script, and a logo is served from
 * the raffle's OWN origin — the same origin as the session, next to several
 * thousand people's telephone numbers. An upload form that accepts SVG is
 * stored cross-site scripting with a button in front of it.
 *
 * Both the filename and the declared content type are supplied by whoever
 * picked the file, and a browser reports image/png for a renamed SVG without
 * hesitating. So the check is on the BYTES. The filename is never consulted at
 * all — the stored name is ours, so the one the browser sent tells us nothing
 * an attacker cannot change.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig, users, codeOf } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const branding = await loadModule('branding.ts')

const b64 = (bytes) => Buffer.from(bytes).toString('base64')
const PNG = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(64).fill(0)])
const JPEG = b64([0xff, 0xd8, 0xff, ...Array(64).fill(0)])
const WEBP = b64([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, ...Array(64).fill(0)])
const WAV = b64([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, ...Array(64).fill(0)])
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64')
const XML_SVG = Buffer.from('<?xml version="1.0"?><svg onload="alert(1)"/>').toString('base64')

/** A world whose storage records what it was asked to store. */
function world() {
  const stored = []
  const removed = []
  const db = fakeDb({ config: baseConfig({}), audit_log: [] })
  db.ctx.supabaseAdmin.storage = {
    from: () => ({
      upload: async (name, bytes) => { stored.push({ name, bytes }); return { error: null } },
      remove: async (paths) => { removed.push(...paths); return { error: null } },
      getPublicUrl: (name) => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/branding/${name}` } }),
    }),
  }
  return { db, stored, removed }
}
const upload = (w, p) => branding.uploadLogo(p, users.admin, w.db.ctx)

console.log('an SVG is refused however it is dressed up')
{
  for (const [data, what] of [[SVG, 'a plain SVG'], [XML_SVG, 'one behind an xml declaration']]) {
    // Declared as PNG, which is exactly what a renamed file reports.
    eq(await codeOf(() => upload(world(), { data, contentType: 'image/png' })),
       'SVG_REFUSED', `${what}, declared image/png`)
  }
  // And nothing reached storage.
  const w = world()
  await codeOf(() => upload(w, { data: SVG, contentType: 'image/png' }))
  eq(w.stored.length, 0, 'and not one byte was stored')
}

console.log('the bytes decide, not the declared type')
{
  eq(await codeOf(() => upload(world(), { data: JPEG, contentType: 'image/png' })),
     'WRONG_IMAGE_TYPE', 'a real JPEG called a PNG is refused')
  // Its own sentence, because it is almost always a mistake rather than an
  // attack, and "unreadable" sends somebody hunting the wrong problem.
  let msg = ''
  try { await upload(world(), { data: JPEG, contentType: 'image/png' }) } catch (e) { msg = e.message }
  ok(/named as image\/png but is really image\/jpeg/.test(msg),
     `and says which it really is (${msg.slice(0, 60)})`)
}

console.log('RIFF alone is not enough — it is also WAV and AVI')
{
  eq(await codeOf(() => upload(world(), { data: WAV, contentType: 'image/webp' })),
     'BAD_IMAGE', 'a WAV file with a RIFF header is not a logo')
  const w = world()
  const r = await upload(w, { data: WEBP, contentType: 'image/webp' })
  ok(!!r.config, 'while a real WebP is accepted')
}

console.log('the three real formats are stored, and the URL lands in config')
{
  for (const [data, type] of [[PNG, 'image/png'], [JPEG, 'image/jpeg'], [WEBP, 'image/webp']]) {
    const w = world()
    const r = await upload(w, { data, contentType: type })
    eq(w.stored.length, 1, `${type} stored`)
    ok(/^https:\/\//.test(r.config.orgLogo), `${type} URL written to config`)
  }
}

console.log('it answers with whoami\'s own config object, not a second shape')
{
  /*
   * The whole reason this action writes config itself. A screen does exactly one
   * thing afterwards — state.cfg = res.config — and there is no second contract
   * to diverge from. Six field-shape divergences in this repository were a key
   * built one way and read another.
   */
  const w = world()
  const r = await upload(w, { data: PNG, contentType: 'image/png' })
  for (const k of ['ticketPrefix', 'ticketsPerBook', 'currency', 'orgName', 'orgLogo', 'brandColor']) {
    ok(k in r.config, `config carries ${k}, like whoami`)
  }
  ok(!('ORG_LOGO' in r.config), 'and not the raw config keys')
}

console.log('a small version is optional and only ever a size choice')
{
  const w = world()
  const r = await upload(w, { data: PNG, dataSmall: PNG, contentType: 'image/png' })
  eq(w.stored.length, 2, 'both files stored')
  ok(r.config.orgLogoSmall !== '', 'and the small URL is recorded')

  const one = world()
  const r2 = await upload(one, { data: PNG, contentType: 'image/png' })
  eq(r2.config.orgLogoSmall, '', 'omitted leaves it blank, which falls back to the large one')
}

console.log('too big is refused with a number somebody can act on')
{
  const huge = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(600 * 1024).fill(0)])
  let msg = ''
  try { await upload(world(), { data: huge, contentType: 'image/png' }) } catch (e) { msg = e.message }
  ok(/\d+ KB\. The limit is 512 KB/.test(msg), `says how big it is and what is allowed (${msg.slice(0, 70)})`)
}

console.log('removing takes the config down before the files')
{
  const w = world()
  await upload(w, { data: PNG, dataSmall: PNG, contentType: 'image/png' })
  const r = await upload(w, { remove: true })
  eq(r.config.orgLogo, '', 'the logo is cleared')
  eq(r.config.orgLogoSmall, '', 'and the small one')
  eq(w.removed.length, 2, 'and both stored files are deleted')
}

console.log('a colour is a colour, and blank means the standard one')
{
  const set = (p) => branding.setBrandColor(p, users.admin, world().db.ctx)
  eq((await set({ color: '#0B7285' })).config.brandColor, '#0b7285', 'a hex is accepted and lowercased')
  eq((await set({ color: '0B7285' })).config.brandColor, '#0b7285', 'with or without the hash')
  eq((await set({ color: '' })).config.brandColor, '', 'blank clears it')
  eq(await codeOf(() => set({ color: 'teal' })), 'BAD_COLOUR', 'a word is not a colour')
  eq(await codeOf(() => set({ color: '#12345' })), 'BAD_COLOUR', 'nor five digits')
  let msg = ''
  try { await set({ color: 'teal' }) } catch (e) { msg = e.message }
  ok(/#0B7285/.test(msg), 'and the refusal shows what one looks like')
}

/*
 * THE CARD LAYOUT IS RUN, NOT READ.
 *
 * THE OUTAGE THIS EXISTS FOR, 2026-09-23. `setCardDesign` validated each
 * layout key with `ALLOWED.includes(treatment)` against a local array of
 * treatment ids. When that array moved to _shared/cardtreatments.js the
 * definition and one call site were updated and this one, thirty lines below,
 * was not. The name did not go undefined — it rebound to the MODULE-LEVEL
 * `ALLOWED` at the top of branding.ts, which is the allowed image MIME types
 * and is a Record. A Record has no `.includes`, so every save carrying a
 * cardLayout threw "ALLOWED.includes is not a function" and Ticket Studio
 * could not save at all. Reported from the screen, by the person using it.
 *
 * NOTHING COULD SEE IT, and the reason is the level rather than the coverage.
 * noundef cannot: the name IS defined. cardlayout.test.mjs already asserted
 * this exact code path — `ok(/p\.cardLayout !== undefined/.test(brand))` — but
 * that is a regex over the SOURCE, and a regex confirms a line exists while
 * saying nothing about what happens when it runs. The handler had never been
 * executed with a layout by anything.
 *
 * So this block CALLS it. A source check cannot raise a TypeError; only
 * running the function can.
 */
console.log('a card layout is validated by running the handler, not by reading it')
{
  const set = (p) => branding.setCardDesign(p, users.admin, world().db.ctx)

  /*
   * CAUGHT, so the failure is a FAIL LINE rather than a stack trace. Against
   * the broken build this throws TypeError, and an uncaught throw kills the
   * suite before it prints its summary — which run.sh reads as no summary line
   * at all rather than as a failure. The exit code still catches it, but the
   * person looking at the log sees nothing about what broke.
   */
  let ok1 = null, why1 = ''
  try {
    ok1 = await set({ design: 'shelter', cardLayout: { shelter: { seal: { x: 10 } } } })
  } catch (e) { why1 = e.message }
  ok(!!ok1?.config,
     `a layout for a real treatment is accepted and comes back on the config${why1 ? ' — threw: ' + why1 : ''}`)

  eq(await codeOf(() => set({ design: 'shelter', cardLayout: { nosuch: { seal: {} } } })),
     'BAD_CARD_LAYOUT', 'a treatment nobody has heard of is refused')

  /*
   * The refusal has to NAME the treatments. That is what turned the outage
   * from "is not a function" into something an organiser could act on, and it
   * is the half that silently disappeared when the array became a Record —
   * `Record.join` does not exist either.
   */
  let msg = ''
  try { await set({ design: 'shelter', cardLayout: { nosuch: {} } }) } catch (e) { msg = e.message }
  ok(/grand/.test(msg) && /shelter/.test(msg),
     'and the refusal lists the treatments that do exist')

  /* Absent means "do not touch", which is the whole reason the key is optional. */
  const ok2 = await set({ design: 'shelter' })
  ok(!!ok2?.config, 'a save with no layout at all still works')
}

console.log(`\n${pass} passed, ${fail} failed`)
cleanup()
process.exit(fail ? 1 : 0)
