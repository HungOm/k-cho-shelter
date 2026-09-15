/*
 * Turning a picked file into the two images the raffle stores.
 *
 * WHAT THIS IS NOT. None of it is a security check. The server caps and
 * type-checks each image independently and does not trust which one was
 * labelled small. Everything here is a courtesy: it fails on the device, with a
 * sentence somebody can act on, instead of after a slow upload on mobile data.
 * A test that treated it as the defence would be describing the wrong system.
 *
 * SVG IS REFUSED, and it gets its own sentence rather than falling into "not a
 * picture we can use" — because it IS a picture, and being told otherwise reads
 * as a bug. The reason is that an SVG can carry script and would be served from
 * the raffle's own origin, next to the session and several thousand phone
 * numbers. That is stored XSS with an upload button in front of it, and
 * refusing is one line where sanitising is a library and an argument.
 *
 * THE RESIZE IS THE POINT, not the cap. The mark is drawn at 40px; the original
 * on this project was 156 KB, sent to every volunteer's phone every day of the
 * raffle. Contain rather than cover, because a logo cropped to fill a square
 * loses the part that was doing the identifying.
 */
import { reject, rejectBytes, sniffType, bare, drawSquare, toPayload,
         ACCEPTED, SIZES, MAX_SOURCE } from '../src/lib/logofile.js'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const file = (type, name = 'logo.png', size = 1000) => ({ type, name, size })

console.log('what comes back, and what is turned away')
ok(reject(file('image/png')) === null, 'a PNG is fine')
ok(reject(file('image/jpeg', 'l.jpg')) === null, 'so is a JPEG')
ok(reject(file('image/webp', 'l.webp')) === null, 'and a WebP')
ok(reject(file('IMAGE/PNG')) === null, 'the type is matched case-insensitively')
ok(/PNG, JPEG or WebP/.test(reject(file('image/gif', 'l.gif'))), 'a GIF is named as unusable')
ok(reject(null) !== null, 'and no file at all is refused rather than crashing')

console.log('SVG is refused by type AND by name, and told why')
for (const f of [file('image/svg+xml', 'l.svg'), file('image/svg+xml', 'l.png'),
                 file('', 'logo.SVG'), file('image/png', 'sneaky.svg')]) {
  const why = reject(f)
  ok(/SVG/.test(why || ''), `refused: ${f.type || 'no type'} / ${f.name}`)
  ok(/carry code/.test(why || ''), 'with the reason, not just a no')
  ok(/save it as a png/i.test(why || ''), 'and what to do instead')
}
// A file claiming image/png but named .svg is the interesting one: trusting
// either field alone lets it through, and the server is the real gate, but a
// courtesy check that can be walked past by renaming is not worth having.
ok(/SVG/.test(reject(file('image/png', 'x.svg')) || ''), 'the name alone is enough to refuse')

console.log('a picture too large to be worth decoding on a phone')
ok(reject(file('image/png', 'l.png', MAX_SOURCE + 1)) !== null, 'over the limit is refused')
ok(/\d+ MB/.test(reject(file('image/png', 'l.png', 9 * 1024 * 1024))),
   'and told how big it actually was, in a unit somebody recognises')
ok(reject(file('image/png', 'l.png', MAX_SOURCE)) === null, 'exactly the limit is allowed')

console.log('and the bytes, which are the only part that is not a claim')
{
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]
  const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]
  const WEBP = [0x52, 0x49, 0x46, 0x46, 9, 9, 9, 9, 0x57, 0x45, 0x42, 0x50]
  const SVG = [...'<svg xmlns="ht'].map(ch => ch.charCodeAt(0))
  const XML = [...'<?xml version'].map(ch => ch.charCodeAt(0))

  ok(sniffType(PNG) === 'image/png', 'a PNG is recognised by its signature')
  ok(sniffType(JPEG) === 'image/jpeg', 'and a JPEG')
  ok(sniffType(WEBP) === 'image/webp', 'and a WebP, whose marker is at byte 8')
  ok(sniffType(SVG) === null && sniffType(XML) === null, 'an SVG is not any of them')
  ok(sniffType([]) === null && sniffType(null) === null, 'and nothing is nothing')

  // RIFF alone is not WebP — it is also WAV and AVI. Checking only the first
  // four bytes would accept an audio file as a logo.
  ok(sniffType([0x52, 0x49, 0x46, 0x46, 9, 9, 9, 9, 0x57, 0x41, 0x56, 0x45]) === null,
     'RIFF alone is not enough — WAVE is not WebP')
  // A truncated PNG signature must not pass on its first few bytes.
  ok(sniffType([0x89, 0x50, 0x4e]) === null, 'half a PNG signature is not a PNG')

  ok(rejectBytes('image/png', PNG) === null, 'a PNG called a PNG is fine')
  const renamed = rejectBytes('image/png', SVG)
  ok(/not a PNG, JPEG or WebP inside/.test(renamed || ''),
     'an SVG renamed .png is caught on content, not on what it claims')
  ok(/save it as a PNG/i.test(renamed || ''), 'and told what to do')
  const wrong = rejectBytes('image/png', JPEG)
  ok(/named as image\/png but is really image\/jpeg/.test(wrong || ''),
     'a genuine picture under the wrong name says exactly that, not "unreadable"')
  ok(rejectBytes('IMAGE/PNG', PNG) === null, 'the declared type is compared case-insensitively')
}

console.log('the base64 arrives bare')
ok(bare('data:image/png;base64,AAAB') === 'AAAB', 'the data: prefix is stripped')
ok(bare('') === '' && bare(null) === '', 'and nothing in gives nothing out')
ok(!bare('data:image/png;base64,AAAB').includes('image/png'),
   'so the type is stated once, on the wire, and cannot disagree with itself')

console.log('contain, not cover — centred, square, both sizes')
{
  const calls = []
  const doc = { createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({ drawImage: (...a) => calls.push(a.slice(1)) }),
    toDataURL: () => 'data:image/png;base64,ZZZ'
  }) }

  const wide = { naturalWidth: 400, naturalHeight: 100 }
  drawSquare(wide, 192, doc)
  const [x, y, w, h] = calls[0]
  ok(w === 192 && h === 48, 'a wide logo is scaled to fit, not cropped to fill')
  ok(y === 72 && x === 0, 'and centred in the square rather than pinned to a corner')

  calls.length = 0
  drawSquare({ naturalWidth: 100, naturalHeight: 400 }, 96, doc)
  const [x2, y2, w2, h2] = calls[0]
  ok(w2 === 24 && h2 === 96, 'a tall one the same way round')
  ok(x2 === 36 && y2 === 0, 'centred on the other axis')

  calls.length = 0
  drawSquare({ width: 50, height: 50 }, 192, doc)
  ok(calls[0][2] === 192, 'an image reporting only width/height still scales')
}

console.log('the constants say what they are for')
ok(SIZES.big === 192 && SIZES.small === 96, 'two sizes, and the small one is genuinely smaller')
ok(SIZES.small < SIZES.big, 'so the small file is not the big one under a second name')
ok(!ACCEPTED.includes('image/svg+xml'), 'SVG is not on the accepted list either')
ok(ACCEPTED.length === 3, 'and the list has not quietly grown')

console.log('and toPayload actually uses all of it')
{
  // Testing the parts and not the assembly is how a check gets built, passes,
  // and never runs: removing the sniff call from toPayload left every
  // assertion above green.
  const PNGSIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]
  const SVGSIG = [...'<svg xmlns="http'].map(ch => ch.charCodeAt(0))
  const fake = (bytes, type = 'image/png', name = 'logo.png') => ({
    type, name, size: 4096,
    slice: () => ({ arrayBuffer: async () => new Uint8Array(bytes).buffer })
  })

  let decoded = 0
  globalThis.URL.createObjectURL = () => 'blob:x'
  globalThis.URL.revokeObjectURL = () => {}
  globalThis.Image = class {
    set src(_v) { decoded++; setTimeout(() => this.onload?.(), 0) }
    get naturalWidth() { return 300 } get naturalHeight() { return 300 }
  }
  globalThis.document = { createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({ drawImage: () => {} }),
    toDataURL: () => 'data:image/png;base64,QQQQ'
  }) }

  const good = await toPayload(fake(PNGSIG))
  ok(good.contentType === 'image/png', 'a real PNG comes back as PNG')
  ok(good.data === 'QQQQ' && good.dataSmall === 'QQQQ', 'with both sizes, bare')

  let caught = ''
  try { await toPayload(fake(SVGSIG, 'image/png', 'logo.png')) } catch (e) { caught = e.message }
  ok(/not a PNG, JPEG or WebP inside/.test(caught),
     'an SVG renamed .png with a png type is stopped BY toPayload, not just by the helper')

  const before = decoded
  try { await toPayload(fake(SVGSIG)) } catch { /* expected */ }
  ok(decoded === before, 'and stopped before the browser is asked to decode it')

  let byName = ''
  try { await toPayload(fake(PNGSIG, 'image/png', 'x.svg')) } catch (e) { byName = e.message }
  ok(/SVG/.test(byName), 'the label checks still run first, so a .svg name never reaches the bytes')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
