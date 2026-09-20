/*
 * A `v-if` chain may end once.
 *
 * WHY THIS EXISTS. fa6c542 added an empty-state box to the print modal and
 * pasted it one closing tag too far out, so it landed as a SECOND `v-else` on
 * the same chain:
 *
 *     <p v-if="!hasArtwork">…</p>
 *     <template v-else> …the entire printing UI… </template>
 *     <div v-else class="nodraw">Nothing drawn yet</div>
 *
 * Vue accepts that. transformIf only errors for `v-else-if` AFTER `v-else`, so
 * a second `v-else` is pushed as a third branch; codegen then walks to the
 * first alternate that is not itself a conditional and overwrites it. Branch 2
 * is compiled and thrown away. The compiled render function became
 *
 *     !hasArtwork ? <no-artwork message> : <nodraw placeholder>
 *
 * and the printing screen — mode picker, book inputs, generate, print — stopped
 * rendering for every organiser. No compile error, no console error, nothing in
 * the network tab: every signal a developer checks said fine. It shipped, and
 * the modal was dead from fa6c542 until it was rendered and looked at.
 *
 * INDENTATION IS NOT A CHECK. The block sat at the same ten spaces as its
 * intended siblings and before both closing tags, so reading it says correct.
 * Two of us read it that way. Only the branch list settles it.
 *
 * WHAT THIS ASSERTS is the rule and not the one instance: across every .vue in
 * src/, no chain has two condition-less branches. printmodal's rendered counts
 * in screenrender.test.mjs catch this shape too, and more besides — a chain
 * that renders nothing for a reason nobody has thought of yet. Both are cheap.
 * This one names the mechanism, which is what makes the failure readable when
 * it fires.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseSFC } from '@vue/compiler-sfc'
import { parse as parseTemplate } from '@vue/compiler-dom'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

/** Every .vue under src/, so a new screen is covered the day it is written. */
function vueFiles(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...vueFiles(p))
    else if (e.name.endsWith('.vue')) out.push(p)
  }
  return out
}

const ELEMENT = 1, TEXT = 2, COMMENT = 3, DIRECTIVE = 7

const branchDir = (node) =>
  node.type === ELEMENT
    ? node.props.find(p => p.type === DIRECTIVE && ['if', 'else-if', 'else'].includes(p.name))?.name
    : undefined

/*
 * Walk one list of siblings the way transformIf does — stepping over comments
 * and whitespace, which is exactly why the misplaced block still attached to a
 * chain that looked several lines away from it.
 */
function chainFaults(children, file, faults, offset = 0) {
  let open = false, ended = false, startedAt = 0
  for (const node of children) {
    if (node.type === COMMENT) continue
    if (node.type === TEXT && !node.content.trim()) continue

    const dir = branchDir(node)
    if (dir === 'if') { open = true; ended = false; startedAt = offset + node.loc.start.line }
    else if (open && dir === 'else-if') { /* still the same chain */ }
    else if (open && dir === 'else') {
      if (ended) {
        faults.push(`${file.replace(ROOT, '')}:${offset + node.loc.start.line} — second v-else on the `
          + `chain opened at line ${startedAt}; the branch before it is compiled and discarded`)
      }
      ended = true
    } else { open = false; ended = false }

    if (node.type === ELEMENT) chainFaults(node.children, file, faults, offset)
  }
}

const faults = []
const files = vueFiles(join(ROOT, 'src'))
for (const file of files) {
  const { descriptor } = parseSFC(readFileSync(file, 'utf8'), { filename: file })
  if (!descriptor.template) continue
  const ast = parseTemplate(descriptor.template.content)
  /* Template-relative lines are useless in a failure message — offset them back
   * onto the file, so the line printed is the line you open. */
  chainFaults(ast.children, file, faults, descriptor.template.loc.start.line - 1)
}

ok(files.length > 30, `walked every .vue in src/ (${files.length} files)`)
ok(faults.length === 0, 'no v-if chain ends twice\n    ' + faults.join('\n    '))

/*
 * THE CHECK IS CHECKED. A structural rule that silently matches nothing is the
 * same as no rule, and this one walks an AST whose shape is a dependency's to
 * change. So the bug is reconstructed and the walker is made to find it.
 */
const broken = `
<template>
  <p v-if="a">one</p>
  <template v-else><span>the real screen</span></template>
  <!-- a comment, stepped over exactly as transformIf steps over it -->
  <div v-else>the placeholder that displaces it</div>
</template>`
const caught = []
chainFaults(parseTemplate(parseSFC(broken).descriptor.template.content).children, 'probe.vue', caught)
ok(caught.length === 1, `the walker finds the fa6c542 shape (found ${caught.length})`)

const fine = `
<template>
  <p v-if="a">one</p>
  <p v-else-if="b">two</p>
  <p v-else>three</p>
  <div><p v-if="c">nested</p><p v-else>chain of its own</p></div>
</template>`
const quiet = []
chainFaults(parseTemplate(parseSFC(fine).descriptor.template.content).children, 'probe.vue', quiet)
ok(quiet.length === 0, `an ordinary if/else-if/else is left alone (flagged ${quiet.length})`)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
