/*
 * Somebody who is not on the list sees a sentence and a way out — and nothing
 * else at all.
 *
 * Supabase Auth will happily sign in ANY Google account: it authenticates, it
 * does not authorise. The allowlist is this app's own app_users table, checked
 * by the gate on every request. So "signed in" and "allowed in" are different
 * states, and the gap between them is a real person sitting in front of a
 * screen, wondering whether they typed something wrong.
 *
 * TWO THINGS ARE BEING PROTECTED.
 *
 * That nothing renders. The raffle's contents — ticket numbers, buyers' names,
 * money — must not appear for somebody the organisation has not admitted, not
 * even briefly behind an error banner. RLS enforces this at the database and
 * the gate enforces it at the function; this is the third layer, and the only
 * one that decides what a person actually sees.
 *
 * That there is a door. A refusal and a breakage need opposite things: another
 * go at the same account is exactly wrong for somebody whose account is not on
 * the list, and reloading returns them to the same wall. Worse, the session
 * survives a reload — so without an explicit sign-out the only escape from that
 * screen is clearing site data, which no volunteer will do. This is the bug
 * that produced three identical error toasts on one dialog: a wall with no door
 * reads as a fault worth retrying.
 */
import { cut } from './source.mjs'
import { readFileSync } from 'node:fs'
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const app = read('../src/App.vue')
const signin = read('../src/components/SignIn.vue')

console.log('nothing of the raffle renders until the server has said yes')
ok(/<AppShell v-else/.test(app),
   'the app shell is v-else on ready — never rendered alongside an error')
ok(/<SignIn v-if="phase !== 'ready'"/.test(app),
   'and the gate screen holds the whole viewport until then')
// start() sets ready only after whoami has answered, so a refusal cannot slip
// through on the strength of a cached session.
// Boundary on the CALL, not the import of the same name at the top of the file.
const start = app.slice(app.indexOf('async function start'), app.indexOf('onUnmounted(() =>'))
ok(start.indexOf("phase.value = 'ready'") > start.indexOf("api('whoami'"),
   'ready is set after whoami answers, not before')

console.log('the local copy is dropped when access is refused or withdrawn')
ok(/NOT_AUTHORIZED[\s\S]{0,120}forgetCache\(\)|forgetCache\(\)[\s\S]{0,200}NOT_AUTHORIZED/.test(start),
   'forgetCache runs for a refused account')
ok(/startsWith\('ACCOUNT_'\)/.test(start), 'a disabled, pending, suspended or banned account is handled too')

console.log('a refusal is told apart from a breakage')
ok(/startsWith\('ACCOUNT_'\)/.test(start),
   'the whole ACCOUNT_ family is treated as a refusal, not a listed few')
ok(/NOT_AUTHORIZED/.test(start), 'and so is being off the list entirely')
ok(/:refused="refused"/.test(app), 'and it reaches the screen')
ok(/refused: Boolean/.test(signin), 'which declares it')

console.log('and a refusal gets a door rather than a retry')
// Ends at the next branch in the markup rather than at the comment above it:
// a comment is the least stable text in a file and the one nothing depends on.
const refusedBlock = cut(signin, 'v-else-if="refused"', '<div v-else class="pad left">',
                         'the refusal branch')
ok(refusedBlock.length > 0, 'the refusal branch exists')
ok(/emit\('reset'\)/.test(refusedBlock), 'it offers a way to a different account')
ok(!/emit\('retry'\)/.test(refusedBlock),
   'and does NOT offer Try again, which reloads into the same wall')

console.log('the way out actually ends the session')
const reset = app.slice(app.indexOf('async function reset'), app.indexOf('async function signOut'))
ok(/sbAuth\.signOut\(\)/.test(reset),
   'reset ends the session — otherwise the reload lands back on the refusal')
ok(/forgetCache\(\)/.test(reset), 'and drops the cached tickets on the way')

console.log('the person is told WHICH account was refused')
ok(/signedInAs/.test(start) || /signedInAs/.test(app),
   'the signed-in email is available to the message')
ok(/is not on the list yet/.test(app), 'in plain words, not a code')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
