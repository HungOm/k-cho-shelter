/*
 * The guard is CALLED, not merely correct.
 *
 * WHY THIS EXISTS, and it is a hole I put in my own work. sellBlock is the rule
 * that stops a helper keying thirty stubs into a book that is out with a seller
 * and losing the lot at save. It has nine assertions in whereis.test.mjs and
 * they all pass. Delete the CALL from Sell.vue and every one of them still
 * passes, because they test the function and nothing tested that a screen
 * reaches for it.
 *
 * Proven, not suspected: removing `const blocked = sellBlock(t)` from Sell.vue
 * and neutering SellTicket's `blocked` computed both left the entire suite
 * green. The warning would have silently stopped appearing and the first
 * evidence would have been a volunteer losing a batch.
 *
 * It is the same shape as everything else this week — a check that exists, is
 * correct, and never runs — and it is the version that is hardest to see,
 * because the thorough tests on the helper are exactly what makes it look
 * covered.
 *
 * WHAT THIS FILE DOES NOT DO: test the guard's LOGIC. The store is stubbed here,
 * so neutering sellBlock itself passes this file untouched — and should.
 * whereis.test.mjs owns whether the rule is right; this owns whether anybody
 * asks. Two files because they fail for different reasons and a single file
 * covering both would not distinguish them.
 *
 * SO THIS RUNS THE COMPONENT. The script setup block is compiled with Vue's own
 * compiler and executed against a store whose sellBlock is a spy. A source scan
 * for the call would be a pattern, and a pattern is satisfied by a comment
 * mentioning the name.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, compileScript } from '@vue/compiler-sfc'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const ESBUILD = join(ROOT, 'node_modules/.bin/esbuild')

/**
 * Compile one component's <script setup> and run it with a spied store.
 *
 * src/ is copied so the real tree is never touched, and lib/store.js is
 * REPLACED in the copy — the spy has to sit where the component already looks,
 * because rewriting the component's own import would be testing a different
 * file from the one that ships.
 */
function runSetup(componentPath, storeStub) {
  const dir = mkdtempSync(join(tmpdir(), 'screen-'))
  cpSync(join(ROOT, 'src'), join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src/lib/store.js'), storeStub)

  const sfc = readFileSync(join(ROOT, componentPath), 'utf8')
  const { descriptor } = parse(sfc, { filename: componentPath })
  const compiled = compileScript(descriptor, { id: 'probe', inlineTemplate: false })

  // Beside the real component, so every relative import resolves as it does in
  // the build. Child .vue imports are stubbed to a bare object — this exercises
  // the script block, not the rendering.
  const name = componentPath.split('/').pop().replace('.vue', '')
  const probe = join(dir, 'src/components', `__${name}.js`)
  writeFileSync(probe, compiled.content.replace(/from '(.*)\.vue'/g, "from './__stubvue.js'"))
  writeFileSync(join(dir, 'src/components/__stubvue.js'), 'export default {}\n')
  writeFileSync(join(dir, 'src/components/ui/__stubvue.js'), 'export default {}\n')

  const out = join(dir, 'bundle.mjs')
  execFileSync(ESBUILD, [probe, '--bundle', '--format=esm', '--platform=neutral',
    '--external:vue', '--log-level=error', '--outfile=' + out])
  // vue stays external and is resolved from the project's own copy, so the
  // component runs against the reactivity it actually ships with.
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'))
  return { url: 'file://' + out, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** A store whose sellBlock records every call and answers however we like. */
const storeWith = (answer) => `
import { reactive, computed } from 'vue'
export const calls = []
export const state = reactive({
  cfg: { ticketPrefix: 'KS-', ticketDigits: 5, ticketsPerBook: 10, ticketPrice: 10, currency: 'RM' },
  tickets: [], byNumber: {}, books: [], agents: [], user: { role: 'recorder', agentId: null },
})
export function sellBlock(t) {
  ;(globalThis.__sellBlockCalls ??= []).push(t?.number ?? null)
  return ${JSON.stringify(answer)}
}
export function whereIs() { return { status: 'Out', agentId: 'A001', agentName: 'Daw Hla', out: true } }
export const agentMap = computed(() => ({}))
export const canWrite = computed(() => true)
export const isAdmin = computed(() => false)
export async function api() { return {} }
export function toast() {}
export async function loadDelta() {}
export async function optimistic() {}
export function setSellMode() {}
`

console.log('Sell.vue asks sellBlock before it calls a ticket sellable')
const sell = runSetup('src/components/Sell.vue', storeWith('with Daw Hla'))
{
  globalThis.__sellBlockCalls = []
  const mod = await import(sell.url)
  ok(typeof mod.default?.setup === 'function', 'Sell.vue has a runnable setup()')

  const ctx = mod.default.setup({}, { emit: () => {}, expose: () => {}, attrs: {}, slots: {} })
  ok(typeof ctx.resolved === 'function', 'resolved() is exposed to the template')

  // A ticket that exists and looks sellable — so the only thing that can refuse
  // it is the guard. state lives in the bundle, reached through the component.
  ctx.state.byNumber['KS-00001'] = { number: 'KS-00001', status: 'Available', book: 'Book-001' }

  const verdict = ctx.resolved({ num: 'KS-00001', name: '', phone: '' })
  ok(globalThis.__sellBlockCalls.includes('KS-00001'),
     'the screen actually CALLS sellBlock for the ticket being keyed in')
  ok(verdict?.bad === true, 'and refuses the row when the guard refuses')
  ok(verdict?.text === 'with Daw Hla',
     `and shows the guard's own words, not its own (got ${JSON.stringify(verdict?.text)})`)
}

console.log('and calls it sellable when the guard allows it')
const allowed = runSetup('src/components/Sell.vue', storeWith(null))
{
  globalThis.__sellBlockCalls = []
  const mod = await import(allowed.url)
  const ctx = mod.default.setup({}, { emit: () => {}, expose: () => {}, attrs: {}, slots: {} })
  ctx.state.byNumber['KS-00011'] = { number: 'KS-00011', status: 'Available', book: 'Book-002' }

  const verdict = ctx.resolved({ num: 'KS-00011', name: '', phone: '' })
  ok(globalThis.__sellBlockCalls.includes('KS-00011'), 'the guard is consulted either way')
  ok(verdict?.bad === false, 'and an allowed ticket is not flagged')
}

console.log('SellTicket asks it too, and takes the button away when refused')
const modal = runSetup('src/components/SellTicket.vue', storeWith('with Daw Hla'))
{
  globalThis.__sellBlockCalls = []
  const mod = await import(modal.url)
  const ticket = { number: 'KS-00001', status: 'Available', book: 'Book-001', version: 1,
                   name: '', phone: '', zone: '', agent: '' }
  const ctx = mod.default.setup({ ticket }, { emit: () => {}, expose: () => {}, attrs: {}, slots: {} })

  // `blocked` is what the template disables the Sold button on. If it stops
  // consulting the guard, the button goes live over a book that is 200km away
  // and the refusal arrives only after the volunteer has taken the money.
  const blocked = ctx.blocked?.value
  ok(globalThis.__sellBlockCalls.includes('KS-00001'),
     'the modal CALLS sellBlock for the ticket it is about to sell')
  ok(blocked === 'with Daw Hla',
     `and carries the guard's answer to the button (got ${JSON.stringify(blocked)})`)
}

console.log('and every button that would sell honours it — counted, not matched')
{
  /*
   * A COUNTED PATTERN, and I would rather say so than dress it up. Running the
   * template would be better, but it needs a renderer and a DOM for one fact
   * the source states plainly. What makes it worth having anyway is the count:
   * `ok(/blocked/.test(src))` is satisfied by ONE of five bindings, which is
   * exactly how a half-applied change reports as fine — the trap this project
   * has now hit four times.
   *
   * Five, not seven. The two ungated buttons are "Save the fix" and "Let it
   * go": correcting a spelling and releasing a hold on a book that is out with
   * somebody are ordinary office work, deliberately still allowed. If that
   * number moves in either direction somebody has changed the rule, and this
   * should stop them either way.
   */
  const src = readFileSync(join(ROOT, 'src/components/SellTicket.vue'), 'utf8')
  const gated = (src.match(/:disabled="[^"]*blocked[^"]*"/g) ?? []).length
  const all = (src.match(/:disabled="[^"]*"/g) ?? []).length
  ok(gated === 5, `five action buttons refuse when the guard refuses (found ${gated})`)
  ok(all - gated === 2, `and exactly two stay open — correct and release (found ${all - gated})`)
}

console.log(`\n${pass} passed, ${fail} failed`)
sell.cleanup(); allowed.cleanup(); modal.cleanup()
process.exit(fail ? 1 : 0)
