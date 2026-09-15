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
 * JWT, so a Google ID token is not a credential it can accept — but it is the
 * thing you TRADE for one, and that is the difference between the two routes
 * here. The redirect hands off to <ref>.supabase.co, which is why Google's
 * consent screen named a forty-character project reference; the token exchange
 * happens on our own origin, so Google names the site the volunteer typed in.
 *
 * Same Google account, same allowlist row, same session at the end. What must
 * not cross is the other direction: no Supabase client built at import time on
 * the Apps Script path, and no Google token handed to the transport as though
 * it were a session.
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
for (const fn of ['signIn', 'signInWithGoogleToken', 'makeNonce', 'signOut',
                  'currentSession', 'onSession',
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
ok(src.includes('signInWithOAuth'), 'the redirect route is still there')
ok(src.includes('signInWithIdToken'), 'and so is the token exchange that replaced it')
ok(src.includes('autoRefreshToken: true'), 'the session refreshes itself')
ok(src.includes('onAuthStateChange'), 'and the new token is handed back')
ok(!/window\.google|accounts\.id/.test(src),
   'this module never reaches into GIS itself — the button is App.vue\'s business')

// ---- the nonce, run rather than read ----

// Google is given the hash and signs it into the token; Supabase is given the
// original and checks it hashes to what the token carries. Getting these the
// wrong way round fails every sign-in in production and looks like a rejected
// credential, so which half goes where is asserted explicitly below.
{
  const { raw, hashed } = await auth.makeNonce()
  ok(/^[0-9a-f]{64}$/.test(hashed), 'the nonce Google gets is a SHA-256 in hex')
  ok(raw !== hashed, 'and is not the one Supabase gets')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  const expect = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
  ok(hashed === expect, 'one really is the hash of the other')
  const again = await auth.makeNonce()
  ok(again.raw !== raw, 'a fresh one per sign-in, so a token cannot be replayed into another load')
}

// A refusal here is a project setting, not a wrong password. Run the real
// function with a stubbed client rather than trusting the message by sight.
{
  const body = src.slice(src.indexOf('export async function signInWithGoogleToken'),
                         src.indexOf('/**\n * The old route'))
  const make = err => new Function('getClient', `${body.replace('export ', '')}; return signInWithGoogleToken`)(
    async () => ({ auth: { signInWithIdToken: async () => ({ data: null, error: err }) } }))

  let msg = ''
  try { await make({ message: 'Unacceptable audience in id_token' })('t', 'n') } catch (e) { msg = e.message }
  ok(/Authorized Client IDs/.test(msg),
     'a rejected audience names the setting somebody has to change')
  ok(!/audience/i.test(msg), 'and does not repeat a phrase nobody at the phone can act on')

  let other = ''
  try { await make({ message: 'network is unreachable' })('t', 'n') } catch (e) { other = e.message }
  ok(other === 'network is unreachable',
     'while an ordinary failure is passed through, not dressed up as a settings problem')
}

// ---- which door, and how the token travels ----

ok(/if\s*\(\s*isSupabase\s*\)\s*return\s+bootSupabase\(\)/.test(app),
   'boot forks before any Google client id is needed')
ok(/if\s*\(isSupabase\)\s*await\s+sbAuth\.signOut\(\)/.test(app),
   'signing out drops the Supabase refresh token as well as the cache')
ok(app.includes("p.has('access_token')"),
   'the OAuth reply in the fragment is left for the client to read')

ok(/if\s*\(isSupabase\)\s*return\s+exchangeForSupabaseSession\(res\)/.test(app),
   'a Google credential on the Supabase path is traded, not used')
ok(app.indexOf('if (isSupabase) return exchangeForSupabaseSession(res)')
   < app.indexOf('lastToken = res.credential'),
   'and traded BEFORE the Apps Script expiry machinery touches it')
ok(/nonce:\s*gsiNonce\.hashed/.test(app), 'Google is initialised with the hashed nonce')
ok(/signInWithGoogleToken\(res\.credential,\s*gsiNonce\?\.raw\)/.test(app),
   'and Supabase is handed the raw one — the halves are not swapped')
ok(!/nonce:\s*gsiNonce\.raw/.test(app), 'the raw nonce never goes to Google')

// The redirect is a configuration branch, not a rescue. Falling back to it when
// the exchange is refused would hide a project setting behind the very consent
// screen the exchange exists to avoid, and nobody would ever fix it.
{
  const fn = app.slice(app.indexOf('async function exchangeForSupabaseSession'),
                       app.indexOf('async function supabaseSignIn'))
  ok(!/sbAuth\.signIn\(\)/.test(fn), 'a refused exchange does not quietly redirect instead')
  ok(/phase\.value = 'error'/.test(fn), 'it says so')
}
ok(/signin'\)\s*===\s*'redirect'/.test(app), 'the redirect stays reachable on purpose')
ok(/useGsi\.value = !!clientId\.value && !forceRedirect/.test(app),
   'and is what a build with no Google client id gets')

// ---- the button ----

// BOTH guards, counted rather than matched: the button is drawn from a watch
// AND from onMounted, and fixing one leaves a path where it never appears —
// which a regex that stops at the first hit reports as fixed.
ok((signin.match(/if\s*\(props\.supabase\s*&&\s*!props\.gsi\)\s*return/g) || []).length === 2,
   'Google draws the button on the Supabase path too, from both entry points')
ok(!/if\s*\(props\.supabase\)\s*return/.test(signin),
   'and neither guard still turns it away for being Supabase alone')
ok(/v-if="supabase && !gsi"/.test(signin), 'the handoff button appears only then')
ok(signin.includes("emit('signin')"), 'and still works when it does')

// The expiry machinery is Apps Script's problem and must stay on that side:
// Supabase refreshes its own session, so a ReAuth overlay there would interrupt
// somebody for a token that had already been replaced.
ok(!/reauth\.value\s*=\s*true/.test(src), 'no ReAuth overlay on the Supabase path')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
