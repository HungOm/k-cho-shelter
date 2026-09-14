/*
 * The backend switch.
 *
 * This is the piece that decides whether the migration is reversible. If the
 * switch is wrong, "flip back to Apps Script" — the entire safety net — does
 * not work at the moment it is needed, which is the moment something has
 * already gone wrong in front of volunteers.
 *
 * So: the default must be Apps Script (a broken or half-deployed Supabase must
 * never become the default by accident), storage being unavailable must not
 * take the module down, and a chosen backend must actually be the one that gets
 * called.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
let pass = 0, fail = 0
const ok = (c, w) => { if (c) pass++; else { fail++; console.log('  FAIL ' + w) } }
const eq = (g, w, what) => { if (String(g) === String(w)) pass++; else { fail++; console.log(`  FAIL ${what}: got ${g}, want ${w}`) } }

/**
 * Loads backend.js with the two transports stubbed, so the test observes which
 * one was called rather than trusting the import graph to be wired correctly —
 * the exact failure the interface session hit when a rename left every api()
 * call pointing at a name that no longer existed, and the suite passed anyway.
 */
async function load({ url = '', stored = null, buildDefault = undefined, storageThrows = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'backend-'))
  mkdirSync(join(dir, 'lib'), { recursive: true })
  // Without this the .js stubs load as CommonJS and the named imports fail —
  // nothing to do with the code under test.
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}')

  const calls = []
  writeFileSync(join(dir, 'lib', 'api.js'), `
    export class ApiError extends Error {
      constructor(code, message, details) { super(message); this.code = code; this.details = details }
    }
    export const LS = {}
    export function api(action) { globalThis.__calls.push(['appsscript', action]); return Promise.resolve('AS') }
    export function configure() { globalThis.__calls.push(['appsscript', 'configure']) }
  `)
  writeFileSync(join(dir, 'lib', 'supabaseApi.js'), `
    export function api(action) { globalThis.__calls.push(['supabase', action]); return Promise.resolve('SB') }
    export function configure() { globalThis.__calls.push(['supabase', 'configure']) }
    export function isSignedIn() { return globalThis.__signedIn ?? false }
  `)

  // Reads that bypass the function entirely. Stubbed like the two transports,
  // so this file keeps testing the CHOICE rather than the query: which of the
  // three answered is the whole question here.
  writeFileSync(join(dir, 'lib', 'supabaseReads.js'), `
    export const DIRECT_READS = new Set(['read_snapshot', 'read_delta', 'list_books', 'list_agents'])
    export function directRead(action) { globalThis.__calls.push(['direct', action]); return Promise.resolve('PG') }
  `)

  // The real file, transpiled so import.meta.env can be replaced the way Vite
  // does it at build time.
  execFileSync(join(ROOT, 'node_modules/esbuild/bin/esbuild'),
    [join(ROOT, 'src/lib/backend.js'), '--format=esm', '--outfile=' + join(dir, 'lib', 'backend.mjs'),
     '--define:import.meta.env=' +
       JSON.stringify(buildDefault === undefined ? {} : { VITE_BACKEND: buildDefault })],
    { stdio: 'pipe' })

  globalThis.__calls = calls
  const store = new Map()
  if (stored) store.set('kcho_backend', stored)
  globalThis.localStorage = storageThrows
    ? { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
    : { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
  globalThis.location = { search: url, pathname: '/', hash: '' }
  globalThis.history = { replaceState: () => {} }

  const mod = await import(join(dir, 'lib', 'backend.mjs') + '?t=' + Math.random())
  return { mod, calls, store }
}

console.log('the default is the backend that already works')
{
  const { mod } = await load()
  eq(mod.backend, 'appsscript', 'with nothing set at all')
  ok(!mod.isSupabase, 'and isSupabase is false')

  const b = await load({ buildDefault: 'nonsense' })
  eq(b.mod.backend, 'appsscript', 'an unrecognised build value falls back rather than breaking')

  const c = await load({ stored: 'nonsense' })
  eq(c.mod.backend, 'appsscript', 'and so does an unrecognised stored value')
}

console.log('choosing, and remembering')
{
  const a = await load({ buildDefault: 'supabase' })
  eq(a.mod.backend, 'supabase', 'the build default is honoured')

  const b = await load({ url: '?backend=supabase' })
  eq(b.mod.backend, 'supabase', 'the URL switches it')
  eq(b.store.get('kcho_backend'), 'supabase', 'and the device remembers')

  const c = await load({ stored: 'supabase' })
  eq(c.mod.backend, 'supabase', 'a remembered choice survives a reload with no URL')

  // The URL must beat the stored value, or you cannot get back.
  const d = await load({ url: '?backend=appsscript', stored: 'supabase' })
  eq(d.mod.backend, 'appsscript', 'the URL beats the remembered choice')
  eq(d.store.get('kcho_backend'), 'appsscript', 'and replaces it')

  // The stored value must beat the build default, or one device cannot be
  // canaried onto the new backend while everybody else stays put.
  const e = await load({ stored: 'appsscript', buildDefault: 'supabase' })
  eq(e.mod.backend, 'appsscript', 'the device beats the build default')
}

console.log('blocked storage does not take the app down')
{
  const { mod } = await load({ storageThrows: true })
  eq(mod.backend, 'appsscript', 'a private window still gets a working backend')
  ok(typeof mod.api === 'function', 'and the module still loaded')
}

console.log('the chosen backend is the one actually called')
{
  const a = await load({ stored: 'appsscript' })
  await a.mod.api('whoami')
  a.mod.configure({ apiUrl: 'x' })
  eq(JSON.stringify(a.calls), JSON.stringify([['appsscript', 'whoami'], ['appsscript', 'configure']]),
    'Apps Script selected -> Apps Script called')

  const b = await load({ stored: 'supabase' })
  await b.mod.api('whoami')
  b.mod.configure({ apiUrl: 'x' })
  eq(JSON.stringify(b.calls), JSON.stringify([['supabase', 'whoami'], ['supabase', 'configure']]),
    'Supabase selected -> Supabase called')

  eq(b.mod.backendLabel(), 'Supabase', 'and it says which one is answering')
  eq(a.mod.backendLabel(), 'Apps Script', 'both ways')
}

console.log('readiness is asked of the backend, not assumed')
{
  const a = await load({ stored: 'appsscript' })
  ok(a.mod.backendReady(), 'Apps Script is ready once configured')

  const b = await load({ stored: 'supabase' })
  globalThis.__signedIn = false
  ok(!b.mod.backendReady(), 'Supabase is not ready without a session')
  globalThis.__signedIn = true
  ok(b.mod.backendReady(), 'and is once there is one')
}

console.log('both transports expose the same surface')
{
  const real = await import(join(ROOT, 'src/lib/supabaseApi.js'))
  for (const fn of ['api', 'configure', 'hasConnection', 'isSignedIn']) {
    ok(typeof real[fn] === 'function', `supabaseApi exports ${fn}`)
  }
  ok(typeof real.ApiError === 'function', 'and the same ApiError type')

  // The write list decides which calls get the long timeout and the
  // "may have succeeded" wording. A write missing from it would be reported as
  // failed after succeeding, which is the mistake that doubles an entry.
  const src = (await import('node:fs')).readFileSync(join(ROOT, 'src/lib/supabaseApi.js'), 'utf8')
  for (const w of ['sell_ticket', 'bulk_record_sales', 'sell_book', 'settle_book',
                   'issue_books', 'set_active_tickets', 'expand_tickets']) {
    ok(src.includes(`'${w}'`), `${w} is treated as a write`)
  }
  ok(src.includes('WRITE_UNCONFIRMED'), 'and a timed-out write is not reported as failed')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
