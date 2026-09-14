/*
 * Every role the gate can hand back has a word for it, and only an owner can
 * hand out the two that matter.
 *
 * TWO THINGS ARE BEING PROTECTED.
 *
 * The first is a security property, and it is one line of a computed away from
 * being wrong: the role picker offers Organiser and Owner only when the person
 * filling it in is already an owner. The server enforces this too — upsertUser
 * calls requireSuperAdmin — so a client-side slip would not actually let anyone
 * escalate. It would offer them a control that fails, which is its own kind of
 * broken: an organiser choosing "Owner", saving, and being refused learns only
 * that the app is unreliable.
 *
 * The second is drift. ROLE_WORDS lived in two screens and had to agree. A
 * fifth role arriving is precisely when two copies stop matching, and an app
 * where the Access screen and the People screen call the same person different
 * things cannot be talked through over the phone — which is how this raffle is
 * actually supported.
 */
import { readFileSync } from 'node:fs'
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const { ROLE_WORDS, ROLE_BLURB } = await import('../src/lib/format.js')

// The gate's four permission tiers, read from the gate rather than retyped, so
// a fifth tier added there fails here instead of rendering as a raw slug.
const gate = read('../supabase/functions/api/gate.ts')
const tiers = gate.match(/export const ROLES: Role\[\] = \[([^\]]*)\]/)[1]
  .match(/'([a-z]+)'/g).map(s => s.replace(/'/g, ''))

console.log('every role has a word a volunteer would recognise')
for (const r of [...tiers, 'superadmin']) {
  ok(typeof ROLE_WORDS[r] === 'string' && ROLE_WORDS[r].length > 0,
     `${r} has a label, got ${ROLE_WORDS[r]}`)
  ok(typeof ROLE_BLURB[r] === 'string' && ROLE_BLURB[r].length > 0,
     `${r} has a description`)
  ok(!/admin|superadmin|recorder|viewer/.test(ROLE_WORDS[r]),
     `${r}'s label is words, not the slug: "${ROLE_WORDS[r]}"`)
}

console.log('and the words live in one place')
// AppShell.vue was the third copy and the one I missed: it spelled the mapping
// inline inside a computed rather than as a `const ROLE_WORDS`, so a search for
// the name did not find it. It is the copy every volunteer sees on every
// screen, under their own name in the sidebar.
for (const f of ['../src/components/Permissions.vue', '../src/components/Admin.vue',
                 '../src/components/AppShell.vue']) {
  const src = read(f)
  ok(!/const ROLE_WORDS\s*=\s*\{/.test(src), `${f} no longer defines its own copy`)
  // Catches the inline spelling too, which is how the third copy hid.
  ok(!/admin:\s*'Organiser'/.test(src), `${f} does not spell the words out inline`)
  ok(/ROLE_WORDS/.test(src) && /from '\.\.\/lib\/format\.js'/.test(src),
     `${f} imports the shared one`)
}

console.log('only an owner is offered the two roles that hand out access')
{
  const form = read('../src/components/modals/UserForm.vue')
  const computed = form.slice(form.indexOf('const ROLES = computed'),
                              form.indexOf('async function save'))

  // Both privileged options must sit inside the isSuper branch. Checked by
  // position rather than by presence: both appear in the file either way, and
  // the whole question is which side of the `if` they are on.
  const guard = computed.indexOf('if (isSuper.value)')
  ok(guard > 0, 'the picker guards on isSuper')
  for (const priv of ["'admin'", "'superadmin'"]) {
    const at = computed.indexOf(`v: ${priv}`)
    ok(at > guard, `${priv} is offered only inside the isSuper branch`)
  }
  for (const open of ["'recorder'", "'agent'", "'viewer'"]) {
    const at = computed.indexOf(`v: ${open}`)
    ok(at > 0 && at < guard, `${open} stays available to any organiser`)
  }
  ok(/t: 'Owner'/.test(computed), 'the owner option is called Owner, not superadmin')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
