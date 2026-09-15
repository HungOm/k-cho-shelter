/*
 * The system must not claim somebody else's identity.
 *
 * Raffled is a product; the raffle belongs to whoever is running it. Until
 * today one organisation's name and logo were compiled into the code: Logo.vue
 * rendered <img src="/ceam-logo-192.png" alt="K'Cho Ethnic Association
 * Malaysia"> unconditionally, so a second organisation running this would have
 * shown CEAM's mark on every screen and on every printed receipt, with CEAM's
 * name read aloud by a screen reader.
 *
 * The failure mode is what makes it worth a test rather than a fix: it is
 * INVISIBLE IN THE DEPLOYMENT THAT HAS THE BUG. On CEAM's own install the logo
 * is correct, so nothing looks wrong and nothing ever will. Only somebody else's
 * install shows it, and they are the least able to report it.
 *
 * Same shape as the sign-in org name and the Money screen's phone fallback:
 * a default that resolves to this deployment's value is correct here, wrong
 * everywhere else, and silent in both places.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f)
  return statSync(p).isDirectory() ? walk(p) : [p]
})

/**
 * Lines of real code — comments dropped.
 *
 * Comments are where the history lives: Logo.vue explains what it used to do
 * and names the organisation to do it. Scanning them would force that
 * explanation to be deleted, and the explanation is the most useful part of the
 * file. It is the RENDERED values that must be clean.
 */
function codeLines(src) {
  return src.split('\n')
    .filter((l) => !/^\s*(\/\/|\/\*|\*|--|#)/.test(l))
    .filter((l) => l.trim())
}

const OWNER = /k['’]?cho|ceam/i

console.log('no organisation is named or pictured in the code itself')
{
  const offenders = []
  for (const f of walk(join(ROOT, 'src'))) {
    if (!/\.(vue|js)$/.test(f)) continue
    for (const [i, line] of codeLines(readFileSync(f, 'utf8')).entries()) {
      // Storage keys are deliberately exempt and named here rather than
      // pattern-matched: renaming kcho_* signs every device out, and renaming
      // the IndexedDB database re-downloads twenty thousand tickets over
      // somebody's mobile data. An invisible internal name is not identity.
      if (/kcho_|'kcho-shelter'/.test(line)) continue
      if (OWNER.test(line)) offenders.push(`${f.replace(ROOT, '')}: ${line.trim().slice(0, 90)}`)
    }
  }
  ok(offenders.length === 0,
    offenders.length ? `an organisation is hardcoded:\n    ${offenders.join('\n    ')}`
                     : 'nothing in src/ names or pictures one')
}

console.log('the logo comes from config, and never falls back to a bundled one')
{
  const logo = readFileSync(join(ROOT, 'src/components/ui/Logo.vue'), 'utf8')
  const code = codeLines(logo).join('\n')

  ok(/state\.cfg\?\.orgLogo\b/.test(code), 'it reads orgLogo from config')
  ok(!/\.png|\.jpg|\.svg|\.webp/.test(code),
     'and names no image file — a bundled default is the same bug one layer down')
  ok(/v-if="src"/.test(logo), 'an unset logo renders nothing at all')
  ok(/state\.cfg\?\.orgName\b/.test(code),
     'the alt text is the organiser\'s name, not a compiled-in one')

  // The size fallback IS allowed: small -> large is one organisation's own two
  // files, so it cannot show the wrong mark. Pinned so the distinction between
  // a size fallback and an identity fallback stays deliberate.
  ok(/small \|\| big/.test(code), 'a missing small file falls back to the large one')
}

console.log('both backends carry the logo to the client')
{
  // Six field-shape divergences in this repository have been a key one end
  // builds and the other does not. A new config key is exactly that shape.
  const ts = readFileSync(join(ROOT, 'supabase/functions/api/index.ts'), 'utf8')
  const gs = readFileSync(join(ROOT, 'apps_script/Api.gs'), 'utf8')
  for (const [name, src] of [['Supabase', ts], ['Apps Script', gs]]) {
    ok(/orgLogo:/.test(src), `${name} sends orgLogo`)
    ok(/orgLogoSmall:/.test(src), `${name} sends orgLogoSmall`)
  }

  const cfg = readFileSync(join(ROOT, 'apps_script/Config.gs'), 'utf8')
  ok(/\['ORG_LOGO',\s*''/.test(cfg), 'and the Sheet seeds it BLANK, not with a logo')

  /*
   * The brand colour travels the same road, and a new config key is EXACTLY the
   * shape of the six field-shape divergences this repository has had: a key one
   * end builds and the other does not. Counted, not matched — a pattern is
   * satisfied by the first hit, which is how a half-applied change reports as
   * fine. That trap has now been hit three times in two days by two people.
   */
  for (const [name, src] of [['Supabase', ts], ['Apps Script', gs]]) {
    ok((src.match(/brandColor:/g) ?? []).length === 1, `${name} sends brandColor exactly once`)
  }
  ok(/\['BRAND_COLOR',\s*''/.test(cfg), 'and the Sheet seeds the colour blank too')

  // Blank must be a real no-op. A key that arrives as undefined instead of ''
  // would make applyBrand strip the tokens anyway, but only by luck; the
  // contract is a string.
  for (const [name, src] of [['Supabase', ts], ['Apps Script', gs]]) {
    ok(/brandColor: cfg\.BRAND_COLOR (\?\?|\|\|) ''/.test(src),
       `${name} sends '' rather than undefined when it is unset`)
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
