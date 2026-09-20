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
import { readFileSync, readdirSync } from 'node:fs'
import { renderScreen, setupOf, visibleText } from './screen.mjs'
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const { ROLE_WORDS, ROLE_BLURB } = await import('../src/lib/format.js')

/*
 * The roles a row may actually SAY, read from the server that validates them.
 *
 * Not the gate's ROLES: those are the four permission TIERS the registry
 * compares against, and 'superadmin' is deliberately not one — it resolves to
 * admin plus a flag. The list that matters for vocabulary is the one
 * upsertUser accepts, because that is exactly the set that can come back in a
 * row and need a word. Reading it rather than retyping it means a sixth role
 * added there fails here instead of rendering as a raw slug in a picker.
 */
const people = read('../supabase/functions/api/people.ts')
const assignable = people.match(/const ASSIGNABLE_ROLES = \[([^\]]*)\]/)[1]
  .match(/'([a-z]+)'/g).map(s => s.replace(/'/g, ''))

console.log('every role has a word a volunteer would recognise')
ok(assignable.length >= 5, `read the assignable roles (${assignable.join(', ')})`)
for (const r of assignable) {
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
  ok(/t: 'System Admin'/.test(computed),
     'the top option is called System Admin, not the wire word superadmin')
}

console.log('a selling account names its seller, and the seller can be made here')
{
  /*
   * WHAT THIS SCREEN USED TO DO WITH A SELLER WHO WAS NOT ON THE LIST: nothing.
   *
   * upsertUser has refused a selling account with no seller since it was
   * written — their sales would have nobody to credit — and this form asked the
   * question as though it were optional, offered only people already on the
   * sellers list, and let the server explain after the press. On the first day
   * of a raffle that list is empty, so the answer to "which seller are they?"
   * was "none of these", and the way through was to cancel, go to the Sellers
   * screen, add them, come back and start again.
   *
   * Two things are pinned. The requirement is asked BEFORE the press, and the
   * seller can be written from here — one press, both records, tied together at
   * the moment they are made rather than by somebody remembering to come back.
   */
  const store = `
import { reactive, computed } from 'vue'
export const state = reactive({ agents: [{ id: 'A001', name: 'Amos Hung', active: true }] })
export const api = async (action, payload) => {
  (globalThis.__calls ??= []).push([action, payload])
  if (action === 'upsert_agent') return { agentId: 'A007', created: true }
  if (globalThis.__refuse) { const e = new Error(globalThis.__refuse); e.code = globalThis.__refuse; throw e }
  return {}
}
export const toast = (m) => { globalThis.__toast = m }
export const refresh = async () => {}
export const isSuper = computed(() => false)
`

  // 1. The question is asked here rather than by the server.
  {
    globalThis.__calls = []; globalThis.__toast = ''
    const { ctx, cleanup } = await setupOf('src/components/modals/UserForm.vue', store)
    ctx.email.value = 'amos@example.com'
    ctx.role.value = 'agent'
    await ctx.save()
    ok(globalThis.__calls.length === 0, 'nothing is sent with no seller chosen')
    ok(/which seller/i.test(globalThis.__toast || ''),
       `and the screen says so itself (${globalThis.__toast})`)
    cleanup()
  }

  // 2. The seller is written first, and the account is tied to the id it got
  //    back — not to the sentinel the picker holds.
  {
    globalThis.__calls = []; globalThis.__refuse = ''
    const { ctx, cleanup } = await setupOf('src/components/modals/UserForm.vue', store)
    ctx.email.value = 'amos@example.com'
    ctx.name.value = 'Amos Hung'
    ctx.role.value = 'agent'
    ctx.agentId.value = '__new'
    ctx.phone.value = '012-345 6789'
    ctx.zone.value = 'Klang'
    ok(ctx.makingNew.value, 'the screen knows a seller is being made')
    await ctx.save()

    const [first, second] = globalThis.__calls
    ok(first?.[0] === 'upsert_agent', `the seller is written first (${first?.[0]})`)
    ok(first?.[1]?.name === 'Amos Hung' && first?.[1]?.phone === '012-345 6789' &&
       first?.[1]?.zone === 'Klang', 'with everything a seller record holds')
    ok(second?.[0] === 'upsert_user', `then the account (${second?.[0]})`)
    ok(second?.[1]?.agentId === 'A007',
       `tied to the seller that was just made (${second?.[1]?.agentId})`)
    ok(second?.[1]?.email === 'amos@example.com',
       'and to the email typed on this screen, which is the whole point of doing it here')
    cleanup()
  }

  // 3. A seller without a name is what the server refuses next, so it is asked
  //    for here — the account may fall back to the email address; a seller may not.
  {
    globalThis.__calls = []; globalThis.__toast = ''
    const { ctx, cleanup } = await setupOf('src/components/modals/UserForm.vue', store)
    ctx.email.value = 'amos@example.com'
    ctx.role.value = 'agent'
    ctx.agentId.value = '__new'
    await ctx.save()
    ok(globalThis.__calls.length === 0, 'a nameless seller is not written')
    ok(/called/i.test(globalThis.__toast || ''), `and the screen asks for one (${globalThis.__toast})`)
    cleanup()
  }

  // 4. THE SECOND PRESS. Adding the account can fail after the seller is
  //    written — a mistyped email, an approval the owner has to give — and the
  //    obvious thing to do is fix it and press again. Every press must not
  //    leave another copy of the same person on the sellers list.
  {
    globalThis.__calls = []; globalThis.__refuse = 'BAD_REQUEST'
    const { ctx, cleanup } = await setupOf('src/components/modals/UserForm.vue', store)
    ctx.email.value = 'not-an-email'
    ctx.name.value = 'Amos Hung'
    ctx.role.value = 'agent'
    ctx.agentId.value = '__new'
    await ctx.save()
    ok(ctx.madeAgent.value === 'A007', 'the seller was created on the first press')

    globalThis.__refuse = ''
    await ctx.save()
    const made = globalThis.__calls.filter((c) => c[0] === 'upsert_agent')
    ok(made.length === 1, `one seller, however many presses it took (${made.length})`)
    const last = globalThis.__calls[globalThis.__calls.length - 1]
    ok(last?.[0] === 'upsert_user' && last?.[1]?.agentId === 'A007',
       'and the account still points at that same seller')
    cleanup()
  }

  // 5. What a person actually sees on the sheet.
  {
    const said = visibleText(await renderScreen('src/components/modals/UserForm.vue', store, {
      drive: (b) => { b.role.value = 'agent'; b.agentId.value = '__new'; b.name.value = 'Amos Hung' },
    }))
    ok(/Which seller are they\?/.test(said), 'the question is on the sheet')
    ok(/Phone number/.test(said) && /Church or area/.test(said),
       'and choosing somebody new asks for the rest of a seller record, here')
    ok(/sellers list/i.test(said), 'saying plainly that a seller is being added too')
  }
}

console.log('an account that is linked to the wrong seller can be put right')
{
  /*
   * THE REPAIR THAT DID NOT EXIST, reported by somebody who could not sell from
   * their own book. The link between an account and a seller decides everything
   * a selling account can do, and the People screen showed email, role and
   * status — never the link — with Pause and Stop as the only per-row actions.
   * An account pointed at the wrong seller could not be corrected from anywhere
   * in the app. upsert_user is keyed on the address and has always updated an
   * existing row; nothing could reach it.
   */
  const admin = read('../src/components/Admin.vue')
  ok(/<th>As seller<\/th>/.test(admin), 'the People table shows the link')
  ok(/no seller/.test(admin), 'and says when there is not one, which is the reason nothing saves')
  ok(/emit\('edit-user', u\)/.test(admin), 'each row can be changed')
  ok(/defineEmits\(\[[^\]]*'edit-user'/.test(admin), 'and the event is declared, or Vue drops it')

  const app = read('../src/App.vue')
  ok(/@edit-user="u => openModal\('user', u\)"/.test(app), 'the app opens the sheet on it')
  ok(/<UserForm[^>]*:user="modal\.payload"/.test(app), 'handing it the account to change')

  const form = read('../src/components/modals/UserForm.vue')
  ok(/defineProps\(\{ user: Object \}\)/.test(form), 'the sheet takes an account')
  ok(/const editing = computed\(\(\) => !!props\.user\?\.email\)/.test(form), 'and knows which job it is doing')
  // The address is the key. Typing over it would create a SECOND account and
  // leave the wrong one exactly as it was.
  ok(/:readonly="editing"/.test(form), 'the address cannot be typed over while editing')
  ok(/props\.user\?\.agentId \|\| ''/.test(form), 'and the seller picker opens on the current link')
}

console.log('no screen can take away every way of leaving it')
{
  /*
   * A LIVE FAULT, NOT A PREFERENCE. The studio asks for focus mode, which
   * used to be `.shell.focus .sidebar, .shell.focus .tabs { display: none }`
   * — both navigations, at every width. The sidebar does not exist below
   * 900px, and the studio runs from 720px up, so between 720 and 899 focus
   * hid the phone tabs while there was no sidebar to replace them: no
   * navigation of any kind, on a screen that had just decided it was big
   * enough to work on. The guard added for screens BELOW 720 did not reach
   * this band.
   *
   * Pinned as the rule rather than as the selector, so it survives the rail
   * being restyled: focus may narrow a navigation, and may hide one of the
   * two, but may never hide both.
   */
  const shell = readFileSync(new URL('../src/components/AppShell.vue', import.meta.url), 'utf8')
  const css = shell.slice(shell.indexOf('<style'))

  const hidden = []
  for (const m of css.matchAll(/(\.shell\.focus[^{]*)\{([^}]*)\}/g)) {
    if (!/display:\s*none/.test(m[2])) continue
    for (const sel of m[1].split(',')) {
      if (/\.sidebar\b/.test(sel)) hidden.push('sidebar')
      if (/\.tabs\b/.test(sel)) hidden.push('tabs')
    }
  }
  ok(/\.shell\.focus/.test(css), 'focus mode still has rules to check')
  ok(!(hidden.includes('sidebar') && hidden.includes('tabs')),
     `focus never hides both navigations at once (hides: ${hidden.join(', ') || 'neither'})`)

  /*
   * And an icon whose label is hidden still has to be identifiable. The
   * sidebar's label is display:none in focus, so the button's accessible
   * name comes from its title — which also still carries the refusal when
   * the item is disabled, which is what permissionui requires.
   */
  ok(/:title="noRoom\(s\) \? roomWhy : s\.label"/.test(shell),
     'a rail icon is named by its title, and a disabled one still says why')
}

console.log('a screen that takes something global gives it back on the way out')
{
  /*
   * Screens live inside <KeepAlive>, so onMounted runs once a session and
   * onUnmounted never. Focus taken in onMounted worked on the first visit
   * only; a window listener removed on unmount stayed bound for the session.
   * The rule binds the NEXT screen: reach outside yourself, release on
   * deactivate.
   */
  const shell = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
  ok(/<KeepAlive>/.test(shell),
     'screens are still kept alive, which is what makes this rule necessary')

  const dir = new URL('../src/components/', import.meta.url)
  const screens = readdirSync(dir).filter((f) => f.endsWith('.vue'))
  ok(screens.length > 10, `there are screens to check (${screens.length})`)

  const reaching = screens.filter((f) => {
    const src = readFileSync(new URL(f, dir), 'utf8')
    return /window\.addEventListener/.test(src) || /setFocus\(/.test(src)
  })
  ok(reaching.length > 0,
     `at least one screen reaches outside itself, or this check is testing nothing (${reaching.join(', ')})`)

  for (const f of reaching) {
    const src = readFileSync(new URL(f, dir), 'utf8')
    ok(/onDeactivated\(/.test(src),
       `${f} gives back what it took when you navigate away, not only when it unmounts`)
    if (/setFocus\(true\)/.test(src)) {
      ok(/onActivated\(/.test(src),
         `${f} takes focus on activation, so the second visit works like the first`)
      ok(!/onMounted\([\s\S]{0,300}?setFocus\(true\)/.test(src),
         `${f} does not take focus in onMounted, which runs once for the whole session`)
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
