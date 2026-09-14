/*
 * Supabase sign-in, and the wiring that makes it reachable.
 *
 * The second half of that sentence is the reason this file exists. backend.js
 * was written, tested and correct, and nothing imported it: App.vue and
 * store.js both called api.js straight, so ?backend=supabase chose a transport
 * that was never asked to carry anything. A switch that is not wired in fails
 * silently and looks exactly like a switch that works, so the wiring gets its
 * own assertions rather than being assumed.
 *
 * The rest is the sign-in itself. The Edge Function verifies a Supabase session
 * JWT, so a Google ID token from GIS is not a credential it can accept, and the
 * two paths must not be crossed: no GIS on the Supabase side, no Supabase
 * client built at import time on the Apps Script side.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
let pass = 0, fail = 0
const ok = (c, w) => { if (c) pass++; else { fail++; console.log('  FAIL ' + w) } }

const read = p => readFileSync(join(ROOT, p), 'utf8')
const app = read('src/App.vue')
const store = read('src/lib/store.js')
const signin = read('src/components/SignIn.vue')

// ---- the wiring ----

ok(/import\s*{[^}]*\bapi\b[^}]*}\s*from\s*'\.\/backend\.js'/.test(store),
   'store.js gets api() from the backend switch')
ok(!/import\s*{[^}]*\bapi\s+as\s+rawApi[^}]*}\s*from\s*'\.\/api\.js'/.test(store),
   'and no longer reaches past it to Apps Script')
ok(/from\s*'\.\/lib\/backend\.js'/.test(app),
   'App.vue gets api() and configure() from the switch too')
ok(!/import\s*{[^}]*\bapi\b[^}]*,[^}]*configure[^}]*}\s*from\s*'\.\/lib\/api\.js'/.test(app),
   'and not straight from api.js')

// ---- the module ----

const auth = await import(join(ROOT, 'src/lib/supabaseAuth.js'))
for (const fn of ['signIn', 'signOut', 'currentSession', 'onSession',
                  'refreshSession', 'getClient', 'isConfigured']) {
  ok(typeof auth[fn] === 'function', `supabaseAuth exports ${fn}`)
}
ok(auth.LS_SB?.url && auth.LS_SB?.key, 'and names the two storage keys')

// Importing must not build a client. backend.js pulls this in on every load,
// including the Apps Script path where no project is configured, and
// createClient with an empty URL throws — an import that throws takes the app
// blank before it renders, which is how this app went down once already.
ok(auth.isConfigured() === false, 'unconfigured is reported, not thrown')
ok(await auth.getClient() === null, 'and no client is built without a project')
ok(await auth.currentSession() === null, 'no session without a client')
ok(await auth.refreshSession() === false, 'and refreshing one says so honestly')
ok(typeof (await auth.onSession(() => {})) === 'function',
   'subscribing still hands back an unsubscribe')

const src = read('src/lib/supabaseAuth.js')
ok(src.includes("provider: 'google'"), 'sign-in goes through the Google provider')
ok(src.includes('signInWithOAuth'), 'via Supabase Auth, not GIS')
ok(src.includes('autoRefreshToken: true'), 'the session refreshes itself')
ok(src.includes('onAuthStateChange'), 'and the new token is handed back')
ok(!/window\.google|accounts\.id/.test(src), 'the Supabase path never touches GIS')

// ---- the two doors stay apart ----

ok(/if\s*\(\s*isSupabase\s*\)\s*return\s+bootSupabase\(\)/.test(app),
   'boot forks before any Google client id is needed')
ok(/if\s*\(isSupabase\)\s*await\s+sbAuth\.signOut\(\)/.test(app),
   'signing out drops the Supabase refresh token as well as the cache')
ok(app.includes("p.has('access_token')"),
   'the OAuth reply in the fragment is left for the client to read')
ok(/if\s*\(props\.supabase\)\s*return/.test(signin),
   'SignIn does not ask Google to draw a button on the Supabase path')
ok(signin.includes("emit('signin')"), 'it offers its own button instead')

// The expiry machinery is Apps Script's problem and must stay on that side:
// Supabase refreshes its own session, so a ReAuth overlay there would interrupt
// somebody for a token that had already been replaced.
ok(!/reauth\.value\s*=\s*true/.test(src), 'no ReAuth overlay on the Supabase path')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
