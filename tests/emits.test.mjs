/**
 * Every event a component emits must have somebody listening.
 *
 * This exists because three buttons — Transfer, Mark brought back, Report lost
 * — shipped doing absolutely nothing. They emitted events App.vue never
 * listened for, so the click was swallowed in silence.
 *
 * That class of bug is invisible to every other test we have: the server never
 * hears from a button that does nothing, so all the backend assertions pass
 * while the feature is dead. Vue does not warn either, because an unhandled
 * emit is legal.
 *
 * So: read what each component declares it emits, read what its parents
 * actually listen for, and fail when the two disagree.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

/** Events that are deliberately declared but not always wired. */
const ALLOWED_UNHANDLED = {
  // Sheet is a generic wrapper; some uses have no footer actions to close from.
  'Sheet.vue': ['close'],
  // Empty's button is optional — it only renders when an `action` label is given.
  'Empty.vue': ['action']
}

function vueFiles(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...vueFiles(p))
    else if (e.name.endsWith('.vue')) out.push(p)
  }
  return out
}

const files = vueFiles(path.join(SRC, 'components'))
files.push(path.join(SRC, 'App.vue'))

const source = Object.fromEntries(files.map(f => [f, fs.readFileSync(f, 'utf8')]))

/** Events declared by defineEmits([...]) — the array form we use throughout. */
function declaredEmits(code) {
  const m = code.match(/defineEmits\(\s*\[([^\]]*)\]/s)
  if (!m) return []
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1])
}

/** Events actually raised in the body, in case one is emitted but undeclared. */
function raisedEmits(code) {
  const names = new Set()
  for (const m of code.matchAll(/\bemit\(\s*['"]([a-zA-Z][\w-]*)['"]/g)) names.add(m[1])
  for (const m of code.matchAll(/\$emit\(\s*['"]([a-zA-Z][\w-]*)['"]/g)) names.add(m[1])
  return [...names]
}

/**
 * Finds every opening tag of a name and returns its attribute text.
 *
 * Written as a scanner rather than a regex because attribute values contain
 * ">" — every arrow function in a Vue listener does — and a regex that stops
 * at the first ">" truncates the tag and reports listeners as missing.
 */
function openingTags(code, tagName) {
  const out = []
  const needle = '<' + tagName
  let i = 0
  while ((i = code.indexOf(needle, i)) !== -1) {
    const after = code[i + needle.length]
    // "<Book" must not match "<BookDetail"
    if (after && /[\w-]/.test(after)) { i += needle.length; continue }
    let j = i + needle.length
    let quote = null
    while (j < code.length) {
      const c = code[j]
      if (quote) { if (c === quote) quote = null }
      else if (c === '"' || c === "'") quote = c
      else if (c === '>') break
      j++
    }
    out.push(code.slice(i + needle.length, j))
    i = j
  }
  return out
}

/** Every listener on any tag of this name, anywhere. */
function listenersFor(tagName) {
  const found = new Set()
  for (const code of Object.values(source)) {
    for (const attrs of openingTags(code, tagName)) {
      for (const a of attrs.matchAll(/@([a-zA-Z][\w-]*)\s*=/g)) found.add(a[1])
    }
  }
  return found
}

/** Screens are mounted through <component :is>, so its listeners cover them all. */
function dynamicListeners() {
  const app = source[path.join(SRC, 'App.vue')]
  const found = new Set()
  for (const attrs of openingTags(app, 'component')) {
    for (const a of attrs.matchAll(/@([a-zA-Z][\w-]*)\s*=/g)) found.add(a[1])
  }
  return found
}

/** Components rendered via <component :is> — read from the screen map. */
function screenComponents() {
  const app = source[path.join(SRC, 'App.vue')]
  const m = app.match(/const SCREENS = \{([\s\S]*?)\}/)
  if (!m) return new Set()
  return new Set([...m[1].matchAll(/:\s*([A-Z]\w+)/g)].map(x => x[1]))
}

const camelToKebab = s => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

const dynamic = dynamicListeners()
const screens = screenComponents()

console.log('every declared emit has a listener')
for (const file of files) {
  const name = path.basename(file)
  const component = name.replace('.vue', '')
  const code = source[file]

  const declared = declaredEmits(code)
  const raised = raisedEmits(code)
  if (!declared.length && !raised.length) continue

  // Anything raised but never declared is its own bug — Vue will not pass it
  // through as a component event once attrs fall through differently.
  for (const r of raised) {
    if (declared.length && !declared.includes(r)) {
      ok(false, `${name} raises "${r}" without declaring it in defineEmits`)
    }
  }

  const allowed = ALLOWED_UNHANDLED[name] || []
  const isScreen = screens.has(component)
  const heard = isScreen
    ? new Set([...dynamic, ...listenersFor(component)])
    : listenersFor(component)

  for (const e of declared) {
    if (allowed.includes(e)) { pass++; continue }
    const kebab = camelToKebab(e)
    ok(heard.has(e) || heard.has(kebab),
      `${name} emits "${e}" but nothing listens for it` +
      (isScreen ? ' (screens are heard on <component :is> in App.vue)' : ''))
  }
}

console.log('listeners point at events that exist')
for (const [file, code] of Object.entries(source)) {
  // Catch the reverse slip: a handler wired to an event no child ever sends.
  for (const target of files) {
    const tag = path.basename(target).replace('.vue', '')
    const childEmits = new Set(declaredEmits(source[target]).flatMap(e => [e, camelToKebab(e)]))
    for (const attrs of openingTags(code, tag)) {
      for (const a of attrs.matchAll(/@([a-zA-Z][\w-]*)\s*=/g)) {
        const ev = a[1]
        // Native DOM events pass through to the root element legitimately.
        if (['click', 'submit', 'input', 'change', 'keydown', 'focus', 'blur'].includes(ev)) continue
        ok(childEmits.has(ev),
          `${path.basename(file)} listens for "${ev}" on <${tag}>, which never emits it`)
      }
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
