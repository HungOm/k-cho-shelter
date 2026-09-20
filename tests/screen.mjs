/*
 * Run a screen — its script, its template, or both.
 *
 * ONE HARNESS, because there were two. screencalls.test.mjs compiled the script
 * block to prove a guard is CALLED; screenrender.test.mjs compiled the template
 * as well, to reach bindings only the template touches. Nearly the same forty
 * lines twice, which is the shape this repository has spent two days removing
 * from its own source and had just reintroduced in its tests.
 *
 * The template half and the driving idea are shelter-ticket-inventory-tracker's;
 * this file is its work with the script-only path folded back in.
 *
 * WHAT THE CHILD STUBS DROP, because it is a property of this harness and not
 * of any test using it: child components render their SLOTS and not their
 * PROPS. `<Empty>no books yet</Empty>` shows its sentence; `<Empty title="No
 * books yet">` and `<Bi text="Cancel">` render nothing at all. An assertion
 * aimed at a prop therefore fails looking exactly like a broken screen. Aim at
 * slot content, or stub that child specifically.
 *
 * WHY EITHER EXISTS: a helper can be correct, thoroughly tested, and never
 * called. That has happened four times here in two days — a byte-sniff never
 * invoked, a sell guard no screen consulted, applyBrand never applied, and a
 * paid/unpaid pill hardcoded to "in" on the one report that exists to tell the
 * difference. Every one passed its own tests. Only running the screen finds it.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, cpSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const ESBUILD = join(ROOT, 'node_modules/.bin/esbuild')

/**
 * Compile a component against a stubbed store and bundle it.
 *
 * src/ is COPIED and lib/store.js replaced in the copy, so the component's own
 * import is left exactly as it ships — rewriting that import would test a
 * different file from the one that runs.
 *
 * @param withTemplate  compile the render function too. Needed for anything a
 *                      template reaches on its own; a script-only build cannot
 *                      see it and reports clean.
 * @param real          child .vue files to compile FOR REAL rather than stub,
 *                      matched on the end of the import path. See below.
 */
function build(componentPath, storeStub, withTemplate, real = []) {
  const dir = mkdtempSync(join(tmpdir(), 'screen-'))
  cpSync(join(ROOT, 'src'), join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src/lib/store.js'), storeStub)

  const sfc = readFileSync(join(ROOT, componentPath), 'utf8')
  const { descriptor } = parse(sfc, { filename: componentPath })
  const script = compileScript(descriptor, { id: 'r', inlineTemplate: false })

  /*
   * The probe sits BESIDE the component, not at a fixed path.
   *
   * It used to be written to src/components/ whatever the component's actual
   * home, so a modal — whose imports read ../../lib/ — resolved one directory
   * too high and esbuild could not find the store at all. The failure arrives
   * as four "could not resolve" lines about files that plainly exist, which
   * reads as a broken project rather than a misplaced probe.
   */
  const name = componentPath.split('/').pop().replace('.vue', '')
  const home = componentPath.slice(0, componentPath.lastIndexOf('/'))
  const probe = join(dir, home, `__${name}.js`)
  /*
   * EVERY CHILD IS STUBBED UNLESS IT IS ASKED FOR BY NAME.
   *
   * That default is right and stays: a screen test is about the screen, and a
   * child rendering its own body would let an assertion pass on markup the
   * parent does not own. But it stops being right the moment a screen is
   * SPLIT INTO children — a designer broken into three tab components renders
   * as an empty shell, and seventy-four assertions about its contents fail
   * while the screen is perfectly correct. That is the harness failing the
   * refactor, not the refactor failing the tests.
   *
   * So a caller may name the children it wants drawn. Matched on the end of
   * the import path, so `place.vue` catches './tabs/place.vue' without the
   * test having to know where the parent keeps them.
   */
  const wanted = (real ?? []).map((r) => String(r).replace(/^\.\//, ''))
  const keep = (spec) => wanted.some((w) => `${spec}.vue`.endsWith(w))

  /*
   * A CHILD THAT IS KEPT HAS TO BE COMPILED, not merely left alone. esbuild
   * has no idea what a .vue file is — leaving the import pointing at one fails
   * the bundle with a parse error rather than rendering anything. So a kept
   * child is compiled to a probe beside itself, exactly the way the parent is,
   * and the import is pointed at that. IT RECURSES, because one level turned
   * out not to be enough the first time it was used: the print sheet tab is a
   * child of the designer and mounts the page as a child of its own, so the
   * page came back stubbed and the assertion failed on a screen that was
   * correct. A `compiled` set stops a cycle repeating.
   */
  const compiled = new Set()
  const compileChild = (fromDir, spec) => {
    const rel = `${spec}.vue`
    const abs = join(dir, fromDir, rel)
    const outRel = rel.replace(/([^/]+)\.vue$/, '__$1.child.js')
    if (compiled.has(abs)) return outRel.replace(/\.vue$/, '')
    compiled.add(abs)
    const childSrc = readFileSync(abs, 'utf8')
    const { descriptor: cd } = parse(childSrc, { filename: rel })
    const cs = compileScript(cd, { id: 'c', inlineTemplate: false })
    const ct = compileTemplate({
      source: cd.template.content, id: 'c', filename: rel,
      compilerOptions: { bindingMetadata: cs.bindings },
    })
    const childDir = join(fromDir, rel.slice(0, rel.lastIndexOf('/') + 1))
    writeFileSync(join(dir, fromDir, outRel),
      stub(cs.content, childDir).replace('export default', 'const __c =') + '\n' +
      stub(ct.code, childDir) + '\nexport default { ...__c, render }\n')
    return `./${outRel}`
  }

  const stub = (code, fromDir) => code.replace(
    /from '(.*)\.vue'/g,
    (whole, spec) => (keep(spec)
      ? `from '${compileChild(fromDir, spec)}'`
      : "from './__stubvue.js'"))

  if (withTemplate) {
    // bindingMetadata is what tells the template that these names come from the
    // script block. Without it every binding is looked up on the instance,
    // finds nothing, and the component renders blank — which reads as a broken
    // component rather than a mis-wired test.
    const tpl = compileTemplate({
      source: descriptor.template.content, id: 'r', filename: componentPath,
      compilerOptions: { bindingMetadata: script.bindings },
    })
    writeFileSync(probe,
      stub(script.content, home).replace('export default', 'const __c =') + '\n' +
      stub(tpl.code, home) + '\nexport default { ...__c, render }\n')
  } else {
    writeFileSync(probe, stub(script.content, home))
  }

  /*
   * Children render their SLOTS and nothing of their own.
   *
   * Rendering them as null looked right and swallowed everything: SellTicket's
   * whole body lives inside <Sheet>, so a null-rendering Sheet produced empty
   * HTML and every assertion about the screen's own output failed with no hint
   * that the screen had never been drawn. A stub that erases the thing under
   * test is worse than no stub.
   *
   * Slots pass through; the child's own chrome does not. So this screen's
   * markup is what is measured, without a stub deciding what survives.
   */
  const SLOT_STUB = 'export default { setup(_, { slots }) {\n' +
    '  return () => Object.keys(slots).map((k) => slots[k]?.())\n} }\n'
  // Every directory under src/, because the rewrite above points a child import
  // at './__stubvue.js' relative to whichever file is doing the importing — and
  // that is now any depth, not just the two that happened to be needed first.
  const everyDir = (d) => readdirSync(d, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .flatMap((e) => [join(d, e.name), ...everyDir(join(d, e.name))])
  for (const d of [join(dir, 'src'), ...everyDir(join(dir, 'src'))]) {
    writeFileSync(join(d, '__stubvue.js'), SLOT_STUB)
  }

  /*
   * `import.meta.env` HAS TO EXIST, even now that nothing chooses a backend
   * with it.
   *
   * It used to carry VITE_BACKEND, and defaulting it to 'appsscript' meant
   * every screen compiled here rendered as the spreadsheet build — invisible
   * until a screen existed whose whole body sat behind `if (isSupabase)`, which
   * then rendered as its one-line refusal and read like a broken component.
   *
   * The flag is gone; the object is not. VITE_GOOGLE_CLIENT_ID is still read at
   * module load, and an undefined `import.meta.env` throws there rather than
   * returning undefined — taking the whole bundle down at import time.
   */
  const out = join(dir, 'bundle.mjs')
  const env = JSON.stringify({})
  execFileSync(ESBUILD, [probe, '--bundle', '--format=esm', '--platform=neutral',
    '--external:vue',
    /*
     * The Supabase client is external for a different reason from vue's.
     *
     * supabaseAuth.js reaches it through a dynamic `await import()` inside a
     * function nothing here ever calls — but esbuild resolves a dynamic import
     * at build time all the same, and it runs in a temp directory whose
     * node_modules link is not made until afterwards. So the first screen to
     * import backend.js, however indirectly, failed to BUILD, with a resolver
     * error that says nothing about the screen.
     */
    '--external:@supabase/supabase-js',
    '--log-level=error', '--define:import.meta.env=' + env,
    '--outfile=' + out])
  // vue stays external and resolves from the project's own copy, so the screen
  // runs against the reactivity it actually ships with.
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'))
  return { out, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** The setup context of a screen: its refs, computeds and functions, live. */
export async function setupOf(componentPath, storeStub, props = {}, { emit } = {}) {
  const { out, cleanup } = build(componentPath, storeStub, false)
  const mod = await import('file://' + out)
  // The emit is swallowed unless a caller asks for it. What a modal tells its
  // parent is sometimes the whole behaviour — a handover that went out half
  // and emitted 'issued' anyway prints a receipt for books nobody received —
  // and a no-op emit makes that indistinguishable from the correct version.
  const ctx = mod.default.setup(props, {
    attrs: {}, slots: {}, emit: emit ?? (() => {}), expose() {},
  })
  return { ctx, cleanup }
}

/**
 * The HTML a screen produces.
 *
 * `drive` runs against the setup bindings before rendering, because server
 * rendering never fires onMounted and some state does not exist until somebody
 * has acted — a rendered but untouched screen asserts the skeleton and calls it
 * proof. No jsdom: a DOM library carried forever to click one row is a worse
 * trade than driving the component's own bindings.
 */
export async function renderScreen(
  componentPath, storeStub, { props = {}, drive, renderReal = [] } = {},
) {
  const { createSSRApp } = await import('vue')
  const { renderToString } = await import('vue/server-renderer')
  const { out, cleanup } = build(componentPath, storeStub, true, renderReal)
  const real = (await import('file://' + out)).default
  /*
   * THE PROPS DECLARATION IS CARRIED THROUGH, and it has to be.
   *
   * setup() reads its first argument, so passing props there was enough for the
   * script half — but a TEMPLATE reads `$props`, which comes from the instance,
   * and an instance with no declared props has none. The symptom is
   * "Cannot read properties of undefined", which reads as a broken component
   * rather than a mis-wired harness. Same trap as the slot/prop asymmetry above,
   * one layer along: the script saw the props and the template did not.
   */
  const driven = {
    // DECLARED FROM WHAT IS PASSED. compileScript turns defineProps into
    // __props and does not leave a `props` field on the default export, so
    // relying on real.props left them undeclared — and an undeclared prop falls
    // through to ATTRS, which SSR renders into the markup. The symptom is the
    // prop object stringified into the HTML, which looks like a broken
    // component rather than an undeclared prop.
    props: Object.keys(props),
    render: real.render,
    async setup(p) {
      const b = real.setup(p ?? props, { attrs: {}, slots: {}, emit() {}, expose() {} })
      if (drive) await drive(b)
      return b
    },
  }
  const html = await renderToString(createSSRApp(driven, props))
  cleanup()
  return html
}

/**
 * What a PERSON reads — tags and attributes removed.
 *
 * shelter-ticket-inventory-tracker's, and it closes a real hole in both our
 * files. Asserting /JOHN/ on raw HTML was satisfied by a WhatsApp href; deleting
 * the seller's name from the visible table left the test green. The same was
 * true here: removing the seller from the refusal sentence passed, because the
 * name also sits in the sheet's subtitle attribute.
 *
 * Rendering gets you what the browser builds. Stripping gets you what somebody
 * actually sees, and that is what an assertion about a screen is nearly always
 * about.
 *
 * ENTITIES ARE DECODED, and that is not fussiness. Vue escapes an apostrophe as
 * &#39; in plenty of contexts, so a stripper that leaves entities alone turns
 * "somebody else's book" into "somebody else&#39;s book" — and an assertion on
 * that sentence fails while reporting that the screen does not say it. A
 * silently wrong NEGATIVE is the worst direction for this helper to fail in,
 * because it looks like the feature is missing rather than the test is broken.
 */
export function visibleText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(lt|gt|quot|apos);/g,
      (_, e) => ({ lt: '<', gt: '>', quot: '"', apos: "'" })[e])
    // &amp; LAST, or "&amp;lt;" decodes to "<" — an escaped entity becoming a
    // real one, which is the bug this ordering exists to avoid.
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}
