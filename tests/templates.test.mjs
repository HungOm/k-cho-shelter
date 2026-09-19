/*
 * WHAT MAY BE STORED AS A TICKET'S ARTWORK.
 *
 * Two separate jobs, and they fail in different directions.
 *
 * THE SECURITY ONE is the same as the logo's, for the same reason: an SVG can
 * carry script, and this picture is served from the raffle's OWN origin, next
 * to the session and several thousand telephone numbers. templates.ts imports
 * branding.ts's sniff rather than copying it, so what is proved here is that
 * the import is wired up and the refusals actually fire on this path too.
 *
 * THE MEASURING ONE has no equivalent for a logo, and it is the reason this
 * file is long. A logo of the wrong shape looks slightly off in a corner. A
 * ticket artwork of the wrong shape is stretched or cropped on every single
 * printed ticket, and nobody finds out until a press run is in a box. So the
 * shape is read out of the file's own header and checked before anything is
 * stored — and the refusal has to SAY what was uploaded and what was wanted,
 * because the person holding the file is usually not the person who made it.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig, users, codeOf, errOf } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const templates = await loadModule('templates.ts')

/* ---------- pictures, built by hand ---------- */

const crc32 = (buf) => {
  const t = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  let crc = 0xFFFFFFFF
  for (const b of buf) crc = t[(crc ^ b) & 0xFF] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

/**
 * A PNG that declares a size and carries no pixels.
 *
 * Header only, on purpose. The handler sniffs the magic bytes and reads IHDR;
 * it never decodes an image, and a fixture that made it do so would be testing
 * a decoder nobody wrote. What matters here is the width and height it claims.
 */
function png(width, height) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64')
}

/** A JPEG with its size in an SOF0 frame, reached by walking the markers. */
function jpeg(width, height) {
  const sof = Buffer.alloc(11)
  sof.writeUInt16BE(0xffc0, 0); sof.writeUInt16BE(9, 2)
  sof[4] = 8; sof.writeUInt16BE(height, 5); sof.writeUInt16BE(width, 7)
  // A comment segment first, so the walk has to skip something to find the SOF.
  const com = Buffer.concat([Buffer.from([0xff, 0xfe, 0x00, 0x08]), Buffer.alloc(6)])
  return Buffer.concat([Buffer.from([0xff, 0xd8]), com, sof, Buffer.from([0xff, 0xd9])]).toString('base64')
}

/** A JPEG whose first c0-range marker is a Huffman table, not a frame. */
function jpegWithHuffmanFirst(width, height) {
  const dht = Buffer.concat([Buffer.from([0xff, 0xc4, 0x00, 0x06]), Buffer.alloc(4)])
  const sof = Buffer.alloc(11)
  sof.writeUInt16BE(0xffc0, 0); sof.writeUInt16BE(9, 2)
  sof[4] = 8; sof.writeUInt16BE(height, 5); sof.writeUInt16BE(width, 7)
  return Buffer.concat([Buffer.from([0xff, 0xd8]), dht, sof, Buffer.from([0xff, 0xd9])]).toString('base64')
}

/** An extended WebP, whose canvas size is stored minus one. */
function webp(width, height) {
  const b = Buffer.alloc(30)
  b.write('RIFF', 0, 'ascii'); b.write('WEBP', 8, 'ascii'); b.write('VP8X', 12, 'ascii')
  const w = width - 1, h = height - 1
  b[24] = w & 0xff; b[25] = (w >> 8) & 0xff; b[26] = (w >> 16) & 0xff
  b[27] = h & 0xff; b[28] = (h >> 8) & 0xff; b[29] = (h >> 16) & 0xff
  return b.toString('base64')
}

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64')
const XML_SVG = Buffer.from('<?xml version="1.0"?><svg onload="alert(1)"/>').toString('base64')
const WAV = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, ...Array(40).fill(0)]).toString('base64')

/* The shape of a raffle ticket: 190 x 61.39 mm, which is 3.09 : 1. */
const TICKET = png(1600, 517)

/* ---------- a world ---------- */

function world(cfg = {}) {
  const stored = []
  const removed = []
  const db = fakeDb({ config: baseConfig(cfg), audit_log: [], ticket_templates: [] })
  db.ctx.supabaseAdmin.storage = {
    from: (b) => ({
      upload: async (name, bytes) => { stored.push({ bucket: b, name, bytes }); return { error: null } },
      remove: async (paths) => { removed.push(...paths); return { error: null } },
      getPublicUrl: (name) => ({
        data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/${b}/${name}` },
      }),
    }),
  }
  return { db, stored, removed }
}
const upload = (w, p) => templates.uploadTemplate(p, users.admin, w.db.ctx)

console.log('a picture that is not a picture is refused')
{
  const w = world()
  eq(await codeOf(() => upload(w, { data: SVG, contentType: 'image/png' })),
    'SVG_REFUSED', 'an SVG named as a PNG')
  eq(await codeOf(() => upload(w, { data: XML_SVG, contentType: 'image/jpeg' })),
    'SVG_REFUSED', 'an SVG that opens with an XML declaration')
  eq(await codeOf(() => upload(w, { data: WAV, contentType: 'image/webp' })),
    'BAD_IMAGE', 'RIFF alone is not WebP — it is also WAV')
  eq(await codeOf(() => upload(w, { data: TICKET, contentType: 'image/jpeg' })),
    'WRONG_IMAGE_TYPE', 'a real PNG under the wrong name gets its own sentence')
  eq(await codeOf(() => upload(w, { data: '', contentType: 'image/png' })),
    'MISSING_FIELD', 'nothing at all')
  eq(w.stored.length, 0, 'and none of them reached the bucket')

  const svgErr = await errOf(() => upload(w, { data: SVG, contentType: 'image/png' }))
  ok(/PNG|JPEG/.test(svgErr.message), 'the SVG refusal says what to do instead')
}

console.log('the shape is read out of the file, in every format')
{
  eq(templates.imageSize(Buffer.from(png(1600, 517), 'base64'), 'image/png').width, 1600, 'PNG width')
  eq(templates.imageSize(Buffer.from(png(1600, 517), 'base64'), 'image/png').height, 517, 'PNG height')
  eq(templates.imageSize(Buffer.from(jpeg(2244, 725), 'base64'), 'image/jpeg').width, 2244, 'JPEG width, past a comment segment')
  eq(templates.imageSize(Buffer.from(jpeg(2244, 725), 'base64'), 'image/jpeg').height, 725, 'JPEG height')
  eq(templates.imageSize(Buffer.from(webp(1600, 517), 'base64'), 'image/webp').width, 1600, 'WebP width')
  eq(templates.imageSize(Buffer.from(webp(1600, 517), 'base64'), 'image/webp').height, 517, 'WebP height')

  /*
   * The marker range c0..cf holds frame headers AND three things that are not:
   * c4 is a Huffman table, c8 is reserved, cc is an arithmetic coding table.
   * Reading one of those as a size is how a picture comes out 1 x 4 and is then
   * refused for its shape, which sends somebody hunting the wrong problem.
   */
  const tricky = templates.imageSize(Buffer.from(jpegWithHuffmanFirst(1600, 517), 'base64'), 'image/jpeg')
  eq(tricky?.width, 1600, 'a Huffman table is not mistaken for a frame header')

  eq(templates.imageSize(Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/png'), null, 'a truncated header measures nothing')
}

console.log('a picture of the wrong shape is refused, and told why')
{
  const w = world()
  const square = await errOf(() => upload(w, { data: png(1000, 1000), contentType: 'image/png' }))
  eq(square.code, 'BAD_SIZE', 'a square is not a ticket')
  ok(/1\.00/.test(square.message), 'the refusal says what shape was uploaded')
  ok(/3\.0/.test(square.message), 'and what shape is wanted')
  eq(square.details?.width, 1000, 'and hands the screen the measurements')
  ok(Array.isArray(square.details?.accepted), 'and the list it failed against')

  // Right shape, too few pixels. A different problem and a different sentence:
  // this one is fixable by exporting again, and saying "wrong shape" would send
  // somebody redrawing a ticket that is already correct.
  const small = await errOf(() => upload(w, { data: png(800, 259), contentType: 'image/png' }))
  eq(small.code, 'BAD_SIZE', 'too few pixels is still a refusal')
  ok(/right shape/.test(small.message), 'but it says the shape is right')
  ok(/800 pixels/.test(small.message), 'and how wide it actually is')

  eq(w.stored.length, 0, 'nothing of the wrong shape reached the bucket')
}

console.log('the ticket this raffle prints is accepted')
{
  const w = world()
  const r = await upload(w, { data: TICKET, contentType: 'image/png', name: 'Front' })
  eq(r.template?.width, 1600, 'it was measured')
  eq(r.template?.height, 517, 'both ways')
  eq(r.template?.name, 'Front', 'and keeps the name it was given')
  eq(w.stored.length, 1, 'one file was stored')
  eq(w.stored[0].bucket, 'ticket-artwork', 'in its own bucket, not the logo\'s')
  ok(/^tpl-\d+-[0-9a-f]{8}\.png$/.test(w.stored[0].name),
    'under a stamped name, so no cache serves the old one')
  eq(r.active, r.template.id, 'the first artwork uploaded is the one tickets print from')
  ok(r.config?.ticketArtwork === true, 'and the client is told printing is now possible')
  eq(w.db.table('audit_log').length, 1, 'and it is on the record')
  eq(w.db.table('audit_log')[0].action, 'TEMPLATE_UPLOADED', 'by name')

  // A second upload does NOT steal the active slot. An organiser trying a new
  // design should not change what the press prints by uploading it.
  const r2 = await upload(w, { data: png(3200, 1034), contentType: 'image/png', name: 'Bigger' })
  eq(r2.templates.length, 2, 'both are kept')
  eq(r2.active, r.template.id, 'and the first is still the one in use')

  /*
   * Two uploads in the same millisecond must not share an id. The id is the
   * primary key and it names the stored file, so a collision is one artwork
   * overwriting another. The first version of that line was `tpl-${Date.now()}`
   * and this is the assertion that caught it.
   */
  ok(r2.templates[0].id !== r2.templates[1].id, 'two uploads never share an id')
  eq(new Set(w.stored.map((s) => s.name)).size, 2, 'nor a filename')
}

console.log('a name is never required')
{
  const w = world()
  const r = await upload(w, { data: TICKET, contentType: 'image/png' })
  ok(r.template.name.length > 0, 'an unnamed artwork is named after its size')
}

console.log('choosing, and removing')
{
  const w = world()
  const a = (await upload(w, { data: TICKET, contentType: 'image/png', name: 'A' })).template
  const b = (await upload(w, { data: png(3200, 1034), contentType: 'image/png', name: 'B' })).template

  const chosen = await templates.setActiveTemplate({ id: b.id }, users.admin, w.db.ctx)
  eq(chosen.active, b.id, 'the chosen artwork is the one tickets print from')

  eq(await codeOf(() => templates.setActiveTemplate({ id: 'nope' }, users.admin, w.db.ctx)),
    'TEMPLATE_NOT_FOUND', 'choosing one that is not there is refused')

  const off = await templates.setActiveTemplate({ id: '' }, users.admin, w.db.ctx)
  eq(off.active, '', 'blank is a real value: print from nothing')
  eq(off.config?.ticketArtwork, false, 'and the client is told printing is off')

  await templates.setActiveTemplate({ id: a.id }, users.admin, w.db.ctx)
  const gone = await templates.removeTemplate({ id: a.id }, users.admin, w.db.ctx)
  eq(gone.templates.length, 1, 'it was removed')
  eq(gone.active, '', 'removing the one in use leaves NO artwork, rather than promoting another')
  ok(w.removed.length === 1, 'and the file was deleted too')

  eq(await codeOf(() => templates.removeTemplate({ id: a.id }, users.admin, w.db.ctx)),
    'TEMPLATE_NOT_FOUND', 'removing it twice is refused rather than silently fine')
}

console.log('the design is stored, within limits')
{
  const w = world()
  const t = (await upload(w, { data: TICKET, contentType: 'image/png' })).template

  const saved = await templates.setTemplateDesign(
    { id: t.id, design: { main: { capHeight: 24 } } }, users.admin, w.db.ctx)
  eq(saved.templates[0].design?.main?.capHeight, 24, 'it comes back as it went in')

  eq(await codeOf(() => templates.setTemplateDesign({ id: 'nope', design: {} }, users.admin, w.db.ctx)),
    'TEMPLATE_NOT_FOUND', 'a design for an artwork that is gone is refused')
  eq(await codeOf(() => templates.setTemplateDesign({ design: {} }, users.admin, w.db.ctx)),
    'MISSING_FIELD', 'and one for no artwork at all')
  eq(await codeOf(() => templates.setTemplateDesign({ id: t.id, design: 'big' }, users.admin, w.db.ctx)),
    'BAD_DESIGN', 'a design that is not an object')
  eq(await codeOf(() => templates.setTemplateDesign({ id: t.id, design: [1, 2] }, users.admin, w.db.ctx)),
    'BAD_DESIGN', 'nor a list')

  /*
   * NaN survives JSON.stringify as null rather than failing, so a coordinate
   * that is not a number would be stored and then put the ticket number
   * nowhere. Caught here rather than discovered on paper.
   */
  eq(await codeOf(() => templates.setTemplateDesign(
    { id: t.id, design: { main: { baseline: NaN } } }, users.admin, w.db.ctx)),
    'BAD_DESIGN', 'a measurement that is not a number')
  eq(await codeOf(() => templates.setTemplateDesign(
    { id: t.id, design: { main: { baseline: Infinity } } }, users.admin, w.db.ctx)),
    'BAD_DESIGN', 'or is not finite')

  // A jsonb column with no ceiling is a place to put a megabyte.
  const huge = { note: 'x'.repeat(9000) }
  const big = await errOf(() => templates.setTemplateDesign({ id: t.id, design: huge }, users.admin, w.db.ctx))
  eq(big.code, 'BAD_DESIGN', 'a design far too large')
  ok(/8192/.test(big.message), 'and the limit is named')
}

console.log('the accepted sizes are a setting, and a sane one')
{
  const w = world()
  const def = templates.acceptedSizes({})
  ok(def.length >= 1, 'there is a built-in list, so a new raffle can upload at once')
  ok(def[0].minWidthPx <= 1600,
    'and it accepts the artwork this raffle already has — a default that refused it would be useless')

  const r = await templates.setTicketSizes({
    sizes: [{ label: 'A7', widthMM: 105, heightMM: 74, tolerance: 0.02, minWidthPx: 800 }],
  }, users.admin, w.db.ctx)
  eq(r.sizes.length, 1, 'a list can be set')
  eq(r.sizes[0].id, 'a7', 'and an id is made from the name when none is given')

  eq(await codeOf(() => templates.setTicketSizes({ sizes: 'A7' }, users.admin, w.db.ctx)),
    'BAD_SIZES', 'a list that is not a list')
  eq(await codeOf(() => templates.setTicketSizes({ sizes: [{ label: '', widthMM: 1, heightMM: 1 }] }, users.admin, w.db.ctx)),
    'BAD_SIZES', 'a size with no name')
  eq(await codeOf(() => templates.setTicketSizes({ sizes: [{ label: 'X', widthMM: 0, heightMM: 10 }] }, users.admin, w.db.ctx)),
    'BAD_SIZES', 'a size with no width')
  eq(await codeOf(() => templates.setTicketSizes({ sizes: [{ label: 'X', widthMM: 10, heightMM: 10, tolerance: 5 }] }, users.admin, w.db.ctx)),
    'BAD_SIZES', 'a tolerance that would accept anything')

  // Deleting them all restores the built-in list rather than leaving a raffle
  // that can accept nothing — a state somebody would have to escape by editing
  // the database.
  const empty = await templates.setTicketSizes({ sizes: [] }, users.admin, w.db.ctx)
  ok(empty.sizes.length >= 1, 'an empty list restores the standard one')

  // A setting nobody can parse is a setting nobody set.
  ok(templates.acceptedSizes({ TICKET_SIZES: '{not json' }).length >= 1,
    'and unreadable JSON falls back rather than stopping uploads')
}

console.log('the shape rule itself')
{
  const sizes = templates.DEFAULT_SIZES
  ok(!!templates.matchSize(1600, 517, sizes), 'the measured artwork matches')
  ok(!!templates.matchSize(3200, 1034, sizes), 'and so does the same shape at twice the size')
  ok(!templates.matchSize(1600, 800, sizes), 'a different shape does not')
  ok(!templates.matchSize(100, 32, sizes), 'nor the right shape far too small')
  ok(!templates.matchSize(0, 0, sizes), 'nor nothing at all')
}

console.log(`\n${pass} passed, ${fail} failed`)
cleanup()
process.exit(fail ? 1 : 0)
