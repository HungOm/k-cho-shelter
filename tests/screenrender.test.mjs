/*
 * The screens, rendered — not scanned, and not merely set up.
 *
 * WHY THIS EXISTS. 18 deleted a call to sellBlock from Sell.vue and its whole
 * suite stayed green; the guard was correct, thoroughly tested, and nothing
 * checked that a screen asked for it. I assumed my own work was clear of that
 * and it was not. Two mutants, both silent:
 *
 *   App.vue stops calling applyBrand      35 branding assertions still passed
 *   Money.vue hardcodes the pill to 'in'  every moneyowed assertion passed
 *
 * The second is the worse one by a distance. It does not break a screen — it
 * tells an organiser that a seller's money has come in when it has not, on the
 * report whose entire job is knowing the difference, and it looks right.
 *
 * screencalls.test.mjs runs a component's SETUP against a stubbed store. That
 * catches a script-block call. It cannot catch this one, because `isPaid` is
 * reached from the TEMPLATE — so here the template is compiled too and the
 * component is rendered to HTML. What the volunteer would read is the thing
 * asserted.
 *
 * DELIBERATELY NOT TESTING THE RULES. The store is a stub, so a neutered
 * isPaid would pass this file and should: moneyowed.test.mjs owns whether the
 * rule is right, this one owns whether the screen asks. 18's point, and it is
 * correct — they fail for different reasons, and one file covering both would
 * not tell you which.
 */
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { parse, compileScript, compileTemplate } from 'vue/compiler-sfc'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { setConfig, state } from '../src/lib/store.js'

const ROOT = new URL('..', import.meta.url).pathname
const ESBUILD = join(ROOT, 'node_modules/.bin/esbuild')
let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

/**
 * Compile a screen's script AND template, bundle it against a stubbed store,
 * and hand back something renderToString can mount.
 *
 * The script half follows screencalls.test.mjs. The template half is the
 * addition: without it, a binding the template alone reaches is invisible.
 */
async function screen(componentPath, storeStub, drive) {
  const dir = mkdtempSync(join(tmpdir(), 'render-'))
  cpSync(join(ROOT, 'src'), join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src/lib/store.js'), storeStub)

  const sfc = readFileSync(join(ROOT, componentPath), 'utf8')
  const { descriptor } = parse(sfc, { filename: componentPath })
  const script = compileScript(descriptor, { id: 'r', inlineTemplate: false })
  // bindingMetadata is what tells the template that `rows` and `Empty` come
  // from the script block. Without it the render function looks them up on the
  // instance, finds nothing, and every binding reads as undefined — which looks
  // like a broken component rather than a mis-wired test.
  const tpl = compileTemplate({
    source: descriptor.template.content, id: 'r', filename: componentPath,
    compilerOptions: { bindingMetadata: script.bindings }
  })

  const name = componentPath.split('/').pop().replace('.vue', '')
  const probe = join(dir, 'src/components', `__${name}.js`)
  writeFileSync(probe,
    script.content.replace(/from '(.*)\.vue'/g, "from './__stubvue.js'")
      .replace('export default', 'const __c =') + '\n' +
    tpl.code.replace(/from '(.*)\.vue'/g, "from './__stubvue.js'") + '\n' +
    'export default { ...__c, render }\n')
  // Children render as an empty span: this is about THIS screen's output.
  for (const p of ['src/components/__stubvue.js', 'src/components/ui/__stubvue.js']) {
    writeFileSync(join(dir, p), 'export default { render: () => null }\n')
  }

  const out = join(dir, 'bundle.mjs')
  execFileSync(ESBUILD, [probe, '--bundle', '--format=esm', '--platform=neutral',
    '--external:vue', '--log-level=error', '--outfile=' + out])
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'))
  const mod = await import('file://' + out)
  const real = mod.default

  /*
   * Driven, because server rendering never fires onMounted and this screen
   * fetches there — and because the row has to be OPENED before the per-ticket
   * breakdown exists at all. A rendered but unopened table would assert the
   * skeleton and call it proof.
   *
   * No jsdom: adding a DOM library to click one row is a dependency this
   * project would carry forever for one test. Calling the component's own
   * setup and then rendering with the bindings it returned reaches the same
   * state, and reaches it through the component's real code.
   */
  const driven = {
    render: real.render,
    async setup() {
      const b = real.setup({}, { attrs: {}, slots: {}, emit() {}, expose() {} })
      if (drive) await drive(b)
      return b
    }
  }
  const html = await renderToString(createSSRApp(driven))
  rmSync(dir, { recursive: true, force: true })
  return html
}

/* ---------- the Money screen actually asks, per ticket ---------- */

const tickets = [
  { number: 'KS-00001', book: 'B1', agent: 'A1', status: 'Sold', amount: 10, payment: 'Paid',
    name: 'Buyer One', phone: '0125550001', saleDate: '2026-09-10' },
  { number: 'KS-00002', book: 'B1', agent: 'A1', status: 'Sold', amount: 10, payment: '',
    name: 'Buyer Two', phone: '0125550002', saleDate: '2026-09-10' },
]
const row = { agentId: 'A1', name: 'JOHN', phone: '0125550011', booksOut: 1, booksSettled: 0,
              overdueBooks: 0, ticketsSold: 2, expected: 20, collected: 10, outstanding: 10 }

const moneyStore = `
import { reactive, ref, computed } from 'vue'
export const state = reactive({
  cfg: { currency: 'RM' }, totals: {}, user: { role: 'admin' },
  tickets: ${JSON.stringify(tickets)}
})
export const api = async () => ({ agents: ${JSON.stringify([row])}, currency: 'RM' })
export const toast = () => {}
export const agentMap = computed(() => ({}))
export const isSuper = computed(() => true)
export const go = () => {}
`

const html = await screen('src/components/Money.vue', moneyStore, async b => {
  await b.load()            // what onMounted would have done
  b.toggle('A1')            // what a finger would have done
})

console.log('one ticket paid, one not — and the screen says so')
ok(/not in/.test(html), 'a ticket with no payment recorded reads "not in"')
ok((html.match(/>\s*in\s*</g) || []).length >= 1, 'and the paid one reads "in"')
// The mutant that survived everything else: hardcoding the pill to 'in'. It
// does not break the screen, it just tells somebody the money arrived.
ok((html.match(/not in/g) || []).length === 1,
   'exactly one ticket of the two is unpaid — not all of them, and not none')
ok(/KS-00001/.test(html) && /KS-00002/.test(html), 'both tickets are listed')
ok(/Buyer One/.test(html) && /0125550002/.test(html), 'with who bought them and how to ring them')
ok(/JOHN/.test(html), 'under the seller who owes')
ok(/wa\.me/.test(html), 'and a way to chase them')

/* ---------- config is one door, and it applies the colour ---------- */

console.log('setConfig is the only way in, and it does both jobs')
{
  const set = {}
  globalThis.document = { documentElement: { style: {
    setProperty: (k, v) => { set[k] = v }, removeProperty: k => { delete set[k] }
  } } }
  setConfig({ orgName: 'Somebody', brandColor: '#ffff00' })
  ok(state.cfg?.orgName === 'Somebody', 'the config lands')
  ok(set['--brand'] === '#ffff00', 'and the raffle\'s colour is applied, not merely stored')
  ok(set['--brand-ink'] === '#11181c', 'with ink computed for it')
  setConfig({ orgName: 'Somebody' })
  ok(!('--brand' in set), 'a raffle with no colour set clears back to the shipped one')
  ok(setConfig(null) === null, 'and signing out clears it altogether')
}

// Exhaustive rather than a sample: the rule is worth nothing unless there is
// no other way in. This is the assertion that makes routing through setConfig
// mean something, and it is why the indirection is worth having at all.
const srcFiles = execFileSync('grep', ['-rl', 'state.cfg', join(ROOT, 'src')], { encoding: 'utf8' })
  .trim().split('\n')
const assigners = srcFiles.filter(f => !f.endsWith('lib/store.js'))
  .filter(f => /state\.cfg\s*=[^=]/.test(readFileSync(f, 'utf8')))
ok(assigners.length === 0, `nothing outside store.js assigns state.cfg (${assigners.join(', ')})`)
ok(/setConfig\(me\.config\)/.test(readFileSync(join(ROOT, 'src/App.vue'), 'utf8')),
   'and the one place config arrives goes through it')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
