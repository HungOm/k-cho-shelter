/*
 * A scoped rule whose ancestor class is not in its own template can never match.
 *
 * THE BUG THIS EXISTS FOR. Money.vue's two tertiary buttons carried
 * `class="linkish"` against a rule written `.statement .linkish` in Money's own
 * SCOPED block — and `class="statement"` appears nowhere in Money.vue. It is on
 * a table inside SellerMoney.vue, a different component. The selector had never
 * matched its own markup, so both controls rendered as default browser buttons:
 * bordered grey chips in a money column, which is word for word what the
 * comment above that rule said it existed to prevent — "a bordered chip in a
 * money column reads as an input somebody is meant to type in."
 *
 * NOTHING COULD SEE IT. The markup names a class, the stylesheet defines one,
 * and neither is malformed. No error, no warning, no failing assertion. It is
 * R7's shape from UI-STANDARD.md: the broken output is indistinguishable from a
 * legitimate one, so nothing prompts anybody to look. This repo has now been
 * bitten by a name that resolves to nothing three times in three languages — a
 * CSS custom property (`--line`, retired, so `var(--line, …)` resolved to its
 * fallback every time: see tokens), a CSS class, and an undefined Vue component
 * (see noundef).
 *
 * WHY THE ANCESTOR AND NOT THE CLASS. Vue scopes only the LAST compound
 * selector: `.a .b` compiles to `.a .b[data-v-xxx]`. So `.b` must be in this
 * component, and `.a` need only be somewhere in the DOM above it — including a
 * parent component. That makes "the class is unused" the wrong question and
 * "can this component's own markup satisfy the ancestor" the right one. A child
 * component's root does inherit its parent's scope id, but only the ROOT, so an
 * ancestor deep inside a child cannot serve a parent's scoped rule.
 *
 * `:deep(...)` is the sanctioned way to reach into a child and is skipped here.
 * That is the whole point of it: a rule that says it is crossing the boundary
 * is a decision, and this file is about the ones that cross it by accident.
 *
 * WHAT THIS CANNOT DO. It reads the FIRST compound of a selector only, and only
 * when that compound is a bare class. `.a > .b .c` is checked on `.a`; a
 * selector led by an element or an attribute is not checked at all. It also
 * cannot see a class added at runtime through `classList`, which is why the
 * exemptions below are NAMES rather than a category — a rule phrased as
 * "anything that looks dynamic" would wave the real cases through, which is the
 * mistake tokens.test.mjs's exemption list was deliberately shaped to avoid.
 *
 * IT READS THE WORKING TREE, WHICH IN THIS REPO IS SHARED. Several sessions
 * edit this tree at once, so a run here reports another session's in-flight
 * edit as a failure in a file you never opened — and the shrink-check makes
 * that worse rather than better, because somebody else REMOVING a dead rule is
 * exactly what turns your exemption stale. The only honest run is from a
 * frozen sha: `git archive <sha> | tar -x -C <scratch>` and run it there. A red
 * run in this tree is a question about who else is mid-edit, not an answer.
 *
 * AND A DEAD RULE IS NOT A MISSING STYLE. This file says a rule cannot match.
 * It does not say the property is unset — a global in style.css, a child's own
 * scoped block, or a browser default may be painting it. On the day this was
 * written I reported that Money.vue's dead `.statement td.num` meant a money
 * column had lost its lining figures. It had not: style.css:942 sets
 * `td.num, th.num` globally with tabular-nums and right alignment, and the
 * template carries class="num" on fourteen cells. The rule was redundant, not
 * load-bearing, and nothing had ever rendered differently. Find what is
 * actually painting before reporting a regression. This gate tells you a rule
 * is dead, and that is the whole of what it tells you.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

/*
 * KNOWN DEAD, EACH NAMED, EACH WITH AN OWNER.
 *
 * These were found by this file on the day it was written and are not fixed
 * here: both files were being edited by other sessions at the time, and
 * deleting somebody's stylesheet out from under them to make a new gate green
 * is how a gate earns a reputation. They are listed so the gate can go in
 * GREEN and stop NEW ones, which is the job a gate actually does.
 *
 * The list is the backlog and it may only shrink. Adding a name to it needs
 * the same thing removing a rule needs: somebody who knows why.
 *
 * THE KEY IS THE WHOLE SELECTOR, AND THAT IS NOT TIDINESS. It was first written
 * as file + ancestor class — six entries instead of sixteen, and much neater.
 * Proving the file red then failed: reintroducing the ORIGINAL BUG,
 * `.statement .linkish` in Money.vue, passed, because `Money.vue .statement`
 * was exempt and the new rule led with `.statement` too. An exemption keyed on
 * a class is a licence for every future rule under that class, in the one file
 * most likely to grow another. "Everything except X" again, in a file written
 * to catch a silent failure, caught only by running it against the bug.
 *
 *   Money.vue        `.statement` and `.recon` markup lives in SellerMoney.vue.
 *                    Eleven rules left behind when the statement moved into
 *                    that sheet. REDUNDANT, NOT LOAD-BEARING — corrected here
 *                    because the first version of this header said the
 *                    opposite and a wrong explanation outlives a wrong change.
 *                    It claimed the dead tabular-figure rule meant those
 *                    numerals were not tabular. They always were: style.css
 *                    defines `td.num, th.num` globally with right alignment
 *                    and tabular figures, Money.vue's template carries
 *                    class="num" on those cells, and SellerMoney rewrote every
 *                    other rule in its own scoped block. Nothing rendered
 *                    differently. The claim was an inference from "the rule is
 *                    dead" to "the thing it does is not happening", made
 *                    without opening style.css — which is the move
 *                    UI-STANDARD.md §8 exists to stop, made in the header of
 *                    the gate that enforces it.
 *   TicketDesign.vue `.panelhead`, `.report`, `.tlist`, `.sgrid` markup moved
 *                    into ticketdesign/ child components during the Studio
 *                    refactor and the rules stayed behind.
 */
/*
 * EMPTIED 2026-09-23, and the emptying is the point of the list.
 *
 * All ten Money.vue entries were one stale block, not ten defects: the
 * statement moved out of Money.vue into the SellerMoney sheet and its styles
 * stayed behind. SellerMoney rewrote every one of them in its own scoped
 * block, and Money's own money columns get tabular figures and right alignment
 * from `td.num, th.num` in style.css, which is global — so nothing rendered
 * differently, then or now. The block is deleted rather than exempted, because
 * a stale rule that reads as load-bearing is a trap for the next reader, and it
 * had already caught one: the dead tabular-figures rule was reported as the
 * reason this screen's money was not aligned. It was not the reason. It was
 * not anything.
 *
 * The list stays, with its shrink-check below, because the next refactor that
 * moves markup between components will leave the same debris and somebody will
 * want a green run before they can clean it.
 */
const KNOWN_DEAD = new Set([])

function vues(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) vues(join(dir, e.name), out)
    else if (e.name.endsWith('.vue')) out.push(join(dir, e.name))
  }
  return out
}

/** The contents of the LAST `</tag>`, so nested templates inside one do not truncate it. */
function blockOf(src, tag, needAttr = '') {
  const open = new RegExp(`<${tag}[^>]*${needAttr}[^>]*>`).exec(src)
  if (!open) return ''
  const a = open.index + open[0].length
  const b = src.lastIndexOf(`</${tag}>`)
  return b > a ? src.slice(a, b) : ''
}

/**
 * Every class this template can put on an element.
 *
 * Deliberately generous: a class collected that is never really applied makes
 * this file MISS a dead rule, and a class missed makes it INVENT one. Between
 * a false negative and a false positive in a lint, the false positive is the
 * one that gets the lint switched off — see UI-STANDARD.md §8.
 */
function classesOf(tpl) {
  const out = new Set()
  for (const m of tpl.matchAll(/\bclass="([^"]*)"/gs)) {
    for (const c of m[1].split(/\s+/)) if (c && !c.includes('{')) out.add(c)
  }
  for (const m of tpl.matchAll(/:class="([^"]*)"/gs)) {
    /* String literals may hold several names: :class="['row', on && 'ready']" */
    for (const q of m[1].matchAll(/['"]([\w\s-]+)['"]/g)) {
      for (const c of q[1].split(/\s+/)) if (c) out.add(c)
    }
    /* Object keys: :class="{ ready: isReady, 'has-gap': gap }" */
    for (const k of m[1].matchAll(/(?:^|[{,\s'"])([\w-]+)['"]?\s*:/g)) out.add(k[1])
  }
  return out
}

console.log('every scoped descendant rule can be satisfied by its own template')
let rulesRead = 0, filesRead = 0
const seenDead = new Set()
{
  for (const file of vues(SRC)) {
    const src = readFileSync(file, 'utf8')
    const style = blockOf(src, 'style', 'scoped')
    if (!style) continue
    filesRead++
    const where = file.slice(SRC.length)
    const mine = classesOf(blockOf(src, 'template'))
    const css = style.replace(/\/\*[\s\S]*?\*\//g, ' ')

    for (const rule of css.matchAll(/(?:^|[};])\s*([^{};@]+?)\s*\{/g)) {
      for (const sel of rule[1].split(',')) {
        const s = sel.trim()
        if (!s || s.includes(':deep(')) continue
        const parts = s.split(/\s+|(?=>)/).filter((p) => p && p !== '>')
        if (parts.length < 2) continue
        const anc = /^\.([\w-]+)$/.exec(parts[0])
        if (!anc) continue
        rulesRead++
        if (mine.has(anc[1])) continue
        const key = `${where} ${s}`
        if (KNOWN_DEAD.has(key)) { seenDead.add(key); continue }
        ok(false, `${where}: the rule "${s}" leads with .${anc[1]}, which this `
          + `component's own template never puts on an element — so it cannot `
          + `match anything it draws. Use :deep() if reaching a child is meant.`)
      }
    }
  }
}

/*
 * The parse has to prove it read something. This one matches a selector shape,
 * and a stylesheet reformatted onto different lines would quietly stop being
 * read at all — a loop over nothing passes, having checked nothing.
 */
console.log('the scan actually read the components and rules it claims to cover')
{
  ok(filesRead >= 40, `read ${filesRead} components with a scoped style block, expected at least 40`)
  ok(rulesRead >= 200, `read ${rulesRead} scoped descendant rules, expected at least 200`)
  /*
   * DISTINCT NAMES, NOT RULES. Written first as a rule count, which fired
   * immediately: six names cover seventeen rules, because .recon alone has six.
   * The question this asks is "is every name on the list still describing
   * something real", and that is a question about names.
   */
  const stale = [...KNOWN_DEAD].filter((k) => !seenDead.has(k))
  ok(stale.length === 0,
    `these names are on the known-dead list and no longer match anything, so they `
    + `were fixed and the list must shrink: ${stale.join('; ')}`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
