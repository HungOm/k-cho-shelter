/*
 * THE TICKET ARTWORK CANNOT BE HANDED TO ANYBODY ELSE.
 *
 * The owner's instruction, 2026-09-19: generation and configuration of tickets
 * are strictly for organisers and the System Admin. Not "by default" — at all.
 *
 * WHY THAT NEEDS A TEST AND NOT JUST A ROLES LIST. gate.ts lets a row in the
 * permissions table hand any action whose `kind` is 'read' or 'report' to
 * another role; that is exactly what the Access screen is for, and it is a
 * feature. It refuses to widen a 'write'. So `roles: ADMIN_ONLY` on its own
 * does NOT mean what it looks like it means: an organiser could switch the
 * ticket artwork on for sellers from a screen, in one tap, with no code change.
 *
 * Registering these as writes is the only way to say "this one is not
 * grantable". Two of them — list_templates, and later the rendering actions —
 * only read, and are still writes for that reason.
 *
 * THE FAILURE THIS GUARDS AGAINST is a tidy-up. `kind: 'write'` on an action
 * that plainly does not write looks like a mistake, and the obvious correction
 * silently opens the ticket artwork, the ticket codes and eventually the
 * printing to every desk volunteer. Nothing would break; nothing would look
 * wrong. So the rule is written down here, with its reason, rather than left to
 * a comment somebody may not read before deleting.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

const ROOT = fileURLToPath(new URL('../', import.meta.url))

/* Parsed the way tests/gate.test.mjs parses it, so the two agree about shape. */
const REGISTRY = (() => {
  const ts = readFileSync(join(ROOT, 'supabase/functions/api/index.ts'), 'utf8')
  const start = ts.indexOf('const REGISTRY')
  const body = ts.slice(start, ts.indexOf('\n}', start))
  const specs = {}
  for (const m of body.matchAll(/^ {2}([a-z_]+):\s*\{([^}]*)\}/gm)) {
    const b = m[2]
    const raw = (b.match(/roles:\s*(ADMIN_ONLY|null|\[[^\]]*\])/) || [])[1]
    let roles
    if (raw === 'ADMIN_ONLY') roles = []
    else if (raw === 'null') roles = null
    else if (raw) roles = [...raw.matchAll(/'([a-z]+)'/g)].map((x) => x[1])
    specs[m[1]] = { roles, sup: /sup:\s*true/.test(b), kind: (b.match(/kind:\s*'([a-z]+)'/) || [])[1] }
  }
  return specs
})()

/*
 * Every action that touches the ticket artwork, its design, or — from the later
 * phases — the codes printed on tickets and the pictures sent to buyers.
 *
 * Add to this list, never remove from it. An action that belongs here and is
 * missing is the failure this file exists for, so the count is pinned too.
 */
const STRICT = [
  'upload_template',
  'list_templates',
  'set_template_design',
  'set_active_template',
  'remove_template',
  'set_ticket_sizes',
  // Phase 2: minting the codes that make a ticket provable. Whoever can
  // generate a code can make a forgery verify, so it sits at the same bar.
  'generate_tickets',
  // Drawing them: it hands out the codes themselves and stamps printed_at.
  'render_tickets',
]

console.log('the instrument read the registry')
{
  const n = Object.keys(REGISTRY).length
  ok(n > 60, `parsed ${n} actions out of index.ts`)
  // A parser that matches nothing would pass every check below by finding
  // nothing to fail on, and an empty registry reads identically to a correct
  // one. This is the line that tells the two apart.
  ok(!!REGISTRY.whoami, 'and it is really the registry — whoami is in it')
}

console.log('every ticket-artwork action is organisers-only and ungrantable')
for (const action of STRICT) {
  const spec = REGISTRY[action]
  ok(!!spec, `${action} is registered`)
  if (!spec) continue

  /*
   * `roles: ADMIN_ONLY` is the file's own name for `[]` — admins and nobody
   * else, rather than nobody.
   */
  ok(Array.isArray(spec.roles) && spec.roles.length === 0,
    `${action} is ADMIN_ONLY${Array.isArray(spec.roles) ? '' : ` (got roles: ${JSON.stringify(spec.roles)})`}`)

  /*
   * The load-bearing one. A 'read' or a 'report' can be handed to a seller by a
   * permissions row; a 'write' cannot. If this fails because somebody corrected
   * a read that was "wrongly" marked as a write, the correction is the bug —
   * read the header of this file.
   */
  eq(spec.kind, 'write',
    `${action} is kind 'write', so no permissions row can hand it to a seller`)
}

console.log('and the list has not quietly shrunk')
eq(STRICT.length, 8, 'eight actions are pinned')

console.log('the screen behind them is organisers-only too')
/*
 * Belt and braces, and they protect different things. The server refusing is
 * what makes it safe; the tab being hidden is what stops a volunteer finding a
 * screen that refuses everything they touch.
 */
{
  const shell = readFileSync(join(ROOT, 'src/components/AppShell.vue'), 'utf8')
  const tab = shell.match(/\{\s*id:\s*'ticketdesign'[^}]*\}/)
  ok(!!tab, 'the Ticket design tab exists')
  ok(/roles:\s*\['admin'\]/.test(tab?.[0] ?? ''), 'and is offered to organisers only')
}

console.log('the client sends them as writes as well')
/*
 * Not about permission — about timeouts. A write that the client treats as a
 * read gets the short timeout and is reported as failed after it has already
 * succeeded, and the volunteer presses the button again. tests/clientcoverage
 * checks this set matches the server's; it is asserted here too because these
 * particular actions are in that set for an unusual reason and somebody
 * pruning it would otherwise see six reads sitting in a list of writes.
 */
{
  const api = readFileSync(join(ROOT, 'src/lib/supabaseApi.js'), 'utf8')
  const start = api.indexOf('const WRITES')
  const body = api.slice(start, api.indexOf('])', start))
  for (const action of STRICT) {
    ok(body.includes(`'${action}'`), `${action} is in the client's WRITES set`)
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
