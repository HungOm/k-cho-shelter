/*
 * Load an edge-function module into Node.
 *
 * The handlers are TypeScript written for Deno. Rather than stand up a Deno
 * toolchain for a test run, esbuild strips the types — it is already a
 * dependency, and this is exactly what it is for. The alternative, retyping the
 * handlers in JavaScript to test them, would be testing a copy rather than the
 * code that runs.
 *
 * Deno.env is shimmed, because the super admin's identity comes from a function
 * secret and nothing else. That is the invariant the whole permission model
 * rests on, so a test that wants to change who is super admin does it here —
 * the same way production does, and no other way.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const API = fileURLToPath(new URL('../supabase/functions/api/', import.meta.url))
const ESBUILD = fileURLToPath(new URL('../node_modules/esbuild/bin/esbuild', import.meta.url))
const STUB = fileURLToPath(new URL('./stubs/supabase-server.js', import.meta.url))

let dir = null
const loaded = new Map()

/** Set the function secrets these handlers read. Call before loading. */
export function setEnv(vars = {}) {
  const store = { ...vars }
  globalThis.Deno = {
    env: {
      get: (k) => store[k],
      set: (k, v) => { store[k] = v },
      toObject: () => ({ ...store }),
    },
  }
  return store
}

/**
 * Import one handler module, types stripped.
 *
 * Bundled rather than transpiled file-by-file so the module's own imports —
 * gate.ts, deadlines.ts — resolve without inventing a loader hook. External
 * npm: specifiers are left alone; nothing under test reaches for one.
 */
export async function loadModule(name) {
  if (loaded.has(name)) return loaded.get(name)
  if (!dir) dir = mkdtempSync(join(tmpdir(), 'api-'))

  const out = join(dir, basename(name, '.ts') + '.mjs')
  execFileSync(ESBUILD, [
    join(API, name),
    '--bundle',
    '--format=esm',
    '--platform=neutral',
    // index.ts imports npm:@supabase/server, which Node cannot resolve. Aliased
    // to a stub rather than left external, so the ROUTER and the REGISTRY can be
    // loaded and run — they are where several of today's bugs lived, and an
    // unloadable module is an untestable one.
    '--alias:npm:@supabase/server=' + STUB,
    '--external:npm:*',
    '--log-level=error',
    '--outfile=' + out,
  ])

  // Cache-busted, so a test that reloads after changing the environment gets a
  // module that reads the new one rather than a memoised old answer.
  const mod = await import('file://' + out + '?t=' + Date.now())
  loaded.set(name, mod)
  return mod
}

export function cleanup() {
  if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null }
  loaded.clear()
}
