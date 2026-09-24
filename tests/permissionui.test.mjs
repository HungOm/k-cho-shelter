/*
 * A control you cannot use is shown disabled, with the reason — not enabled,
 * and not silently missing.
 *
 * THE REPORT. A Helper opened Book-406, which was out with JOHN, and "Sell it
 * whole" was offered as an ordinary button. The database refuses that — sell
 * books and sell_book_whole both reject a book that is out with somebody else —
 * so pressing it produced a refusal after the person had committed to the
 * action in front of whoever was paying.
 *
 * THREE CHOICES AND ONLY ONE IS HONEST. Enabled-then-refused blames the user
 * for something the app knew in advance. Hidden makes the screen look different
 * to different people for no stated reason, so a helper comparing notes with an
 * organiser concludes the app is broken or that they have been demoted.
 * Disabled with the reason on it is the only one that tells them anything: the
 * control exists, it is not for you right now, and here is why.
 *
 * ONE RULE, NOT TWO. bookBlock is the single answer and sellBlock is now that
 * function with a ticket's book looked up first. A ticket's answer and its
 * book's answer disagreeing is the failure this repo produced five times in a
 * day — two halves of one fact drifting apart — and this is the same fact asked
 * from two places.
 *
 * It stays a COURTESY. The backend refuses regardless, and must, because this
 * screen has been wrong about its own data before: a stale book list must never
 * be the thing that decides a sale.
 */
import { readFileSync } from 'node:fs'
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const store = read('../src/lib/store.js')
const detail = read('../src/components/modals/BookDetail.vue')
const sellBook = read('../src/components/modals/SellBook.vue')

console.log('the rule exists once and is asked from both places')
{
  const body = store.slice(store.indexOf('export function bookBlock'),
                           store.indexOf('export const searchResults'))
  // `export` is illegal inside new Function; the rule itself is unchanged.
  const bookBlock = new Function('state', `${body.replace(/^export /gm, '')}; return bookBlock`)
  const asHelper = { user: { role: 'recorder', email: 'h@x.com' } }
  const asOwner = { user: { role: 'agent', agentId: 'A1' } }
  const asOther = { user: { role: 'agent', agentId: 'A2' } }
  const asOrganiser = { user: { role: 'admin' } }
  const out = { status: 'Out', agentId: 'A1', agentName: 'JOHN' }

  ok(/with JOHN/.test(bookBlock(asHelper)(out) || ''),
     `a helper is blocked and told who has it (${bookBlock(asHelper)(out)})`)
  ok(bookBlock(asOwner)(out) === null, 'the seller holding it is not blocked')
  // The assertion this line always claimed to make. "not your book" told a
  // seller nothing they could act on; both ids do.
  ok(/A1/.test(bookBlock(asOther)(out) || '') && /A2/.test(bookBlock(asOther)(out) || ''),
     `a different seller is told whose it is and who they are (${bookBlock(asOther)(out)})`)
  /*
   * AN ORGANISER IS BLOCKED TOO NOW, and that is the change rather than a
   * regression. This asserted the exemption: the desk could write a sale into a
   * book sitting in a seller's bag, called transcribing what they reported.
   * The raffle's owner ruled that the stubs decide — whoever holds the paper is
   * the only one who can sell from it, and a book that is out comes back first.
   */
  ok(/brought back/.test(bookBlock(asOrganiser)(out) || ''),
     `an organiser is blocked too, and told the way round it (${bookBlock(asOrganiser)(out)})`)
  ok(bookBlock(asHelper)({ status: 'Unassigned' }) === null, 'a book in the office is free')
  ok(/settled/.test(bookBlock(asHelper)({ status: 'Settled' }) || ''), 'a closed book says so')
  ok(bookBlock(asHelper)(null) === null, 'an unknown book blocks nothing')
}

console.log('sellBlock is that same function, not a copy of it')
ok(/export function sellBlock\(ticket\) \{\s*return bookBlock\(whereIs\(ticket\)\)\s*\}/.test(store),
   'sellBlock delegates rather than restating the rule')

console.log('the book sheet shows the control, disabled, with the reason')
/*
 * TWO REASONS NOW, THROUGH ONE BINDING. The control is disabled when this
 * person may not sell from the book (bookBlock, unchanged) OR when the book is
 * not whole — 8 of its 10 already gone, so there is no book to sell. Asserted
 * as "the binding carries both" rather than by pinning the old name, which
 * would fail for the second reason existing.
 */
ok(/:disabled="!!cannotSellWhole"/.test(detail), '"Sell it whole" is disabled when it cannot be sold whole')
ok(/:title="cannotSellWhole \?/.test(detail), 'and carries the reason')
ok(/cannotSellWhole = computed\(\(\) => blocked\.value \|\| notWhole\.value\)/.test(detail),
   'and it is the permission rule OR the not-whole rule, not one replacing the other')
ok(/Number\(props\.book\?\.sold \|\| 0\) > 0/.test(detail),
   'not whole means any ticket already sold, read from the book rather than guessed')
ok(/v-if="book\.available"/.test(detail),
   'still shown whenever the book has tickets — not hidden from a helper')
ok(/bookBlock\(props\.book\)/.test(detail), 'asked of the real rule, not re-derived')

/*
 * ============ THE ACCESS SCREEN ============
 *
 * WHY THIS HALF WAS ADDED, 2026-09-20. The rule above was written about a book
 * sheet, and the screen whose entire subject is the rule did not follow it.
 * Permissions.vue draws thirty-odd switches across four kinds of user and
 * disabled them for four different reasons — the action is System Admin only,
 * the action is locked on for that role, you are not the System Admin, or a
 * save is in flight — and said none of them. A viewer opening "Who can do what"
 * got a grid of dead controls and no statement anywhere that they were dead on
 * purpose, which is the precise failure the header above describes: the screen
 * looks different for you than for a colleague, for no stated reason.
 *
 * WHAT THIS CANNOT DO. It cannot prove a tooltip is reachable — `title` is not
 * on a phone and not on a keyboard. The visible half of the same fact is the
 * sentence under the label in the phone view and the row tags in the matrix,
 * and those are asserted separately below rather than being assumed to follow.
 */
console.log('the access screen says why a switch is dead, for each of the four reasons')
{
  const perms = read('../src/components/Permissions.vue')
  const body = perms.slice(perms.indexOf('function why(a, r) {'),
                           perms.indexOf('function switchTitle'))
  const found = body.length > 100
  ok(found, `the reason function was actually found (${body.length} chars)`)

  /*
   * AND IF IT WAS NOT, STOP HERE RATHER THAN THROWING. `new Function` on an
   * empty slice raises a ReferenceError out of the module, which kills the
   * process before the summary line — and run.sh reads `tail -1` for that line.
   * So the one failure this guard exists to report would have reached the
   * runner as a stack trace with no count in it, next to suites that print one.
   * A test that cannot report its own most likely failure legibly is half a
   * test.
   */
  if (!found) {
    console.log('  (skipping the rest of this group — nothing to build it from)')
  } else {

  // Built with its three outside references injected, so this exercises the
  // real branch order rather than a paraphrase of it. The order is the part
  // worth pinning: a locked action is locked for the System Admin too, so
  // "only the System Admin can change this" must not win over it.
  const make = (isSuper, saving = '') => new Function('ROLE_WORDS', 'isSuper', 'saving',
    `${body}; return why`)({ recorder: 'Helper', viewer: 'Can only look' },
                            { value: isSuper }, { value: saving })

  const asOwner = make(true)
  const asOther = make(false)
  const sup = { action: 'a', label: 'Reset a raffle', sup: true, current: {}, defaults: {} }
  const lock = { action: 'b', label: 'Sign in', lockedFor: ['recorder'], current: {}, defaults: {} }
  const open = { action: 'c', label: 'Approve or refuse a request', current: {}, defaults: {} }

  ok(/System Admin/.test(asOwner(sup, 'recorder')),
     `an action nobody can be given says so (${asOwner(sup, 'recorder')})`)
  ok(/Always allowed/.test(asOwner(lock, 'recorder')) && /Helper/.test(asOwner(lock, 'recorder')),
     `one locked on names the role it is locked on for (${asOwner(lock, 'recorder')})`)
  ok(asOwner(open, 'recorder') === '',
     'and an ordinary switch the owner can press carries no reason at all')

  ok(/Only the System Admin/.test(asOther(open, 'recorder')),
     `somebody who may not change these is told that, rather than shown a dead switch (${asOther(open, 'recorder')})`)
  /*
   * THE ORDER, AND IT IS THE ASSERTION MOST LIKELY TO CATCH A FUTURE EDIT. A
   * helper looking at a locked-on action must be told it is locked on — not
   * "only the System Admin can change this", which is false: the System Admin
   * cannot change it either. Both branches match this input, so only their
   * order decides, and nothing else in the file records that.
   */
  ok(/Always allowed/.test(asOther(lock, 'recorder')),
     `a locked action reads as locked even to somebody who could not change it anyway (${asOther(lock, 'recorder')})`)

  ok(/Saving/.test(make(true, 'c:recorder')(open, 'recorder')),
     'and a switch mid-save says it is saving rather than reading as forbidden')
  }
}

console.log('and every switch on that screen actually carries it')
{
  const perms = read('../src/components/Permissions.vue')
  // Both views. The matrix was the copy that drifted last time — the phone view
  // has had the "changed" pill since it was written and the desktop one had the
  // fact in a coloured outline only.
  const titled = (perms.match(/:title="switchTitle\(a, r(ole)?\)"/g) || []).length
  const switches = (perms.match(/class="\['sw',/g) || []).length
  ok(switches === 2, `both views draw a switch (${switches})`)
  ok(titled === switches, `and both bind the reason to it (${titled} of ${switches})`)

  /*
   * NEVER HIDDEN. The screen may filter rows by whether they differ from the
   * normal setting — that is a control the reader operates — but it must not
   * drop a row, a column or a switch because of who is looking. This catches
   * the tidy-up that "cleans up" the grid for a viewer, which is the change a
   * designer makes by instinct.
   */
  ok(!/v-if="isSuper"[^>]*class="\['sw'/.test(perms), 'a switch is never hidden from a role')
  ok(!/v-if="isSuper".*?<(table|thead|td)/s.test(perms), 'and neither is the grid itself')
  ok(/v-if="!isSuper"/.test(perms) && /You are seeing them as they stand/.test(perms),
     'somebody who cannot change them is told so once, at the top, in words')
}

console.log('and the difference from the normal setting is never colour alone')
{
  const perms = read('../src/components/Permissions.vue')
  /*
   * `.sw.moved` is a 2px outline in --info. That is how the matrix said
   * "changed" and it was the whole of what it said, so the fact did not survive
   * a colour-blind reader, a greyscale print, or a photograph of the screen
   * sent to whoever is being asked about it. The word has to be there too.
   */
  ok(/rowChanged\(a\)/.test(perms), 'the matrix asks whether the row differs at all')
  ok(/rowChanged\(a\)"[^>]*class="pill info">changed/.test(perms.replace(/\s+/g, ' ')),
     'and prints the word beside the feature, not only a coloured ring')
  ok(/changed\(a, role\)"[^>]*class="pill info">changed/.test(perms.replace(/\s+/g, ' ')),
     'as the phone view already did')
}

console.log('and the whole-book form refuses before the work, naming the books')
ok(/!blocked\.value\.length/.test(sellBook), 'a blocked book stops the save')
ok(/Not here to sell/.test(sellBook), 'and says so before the button')
ok(/\$\{num\} — \$\{why\}/.test(sellBook),
   'naming each book and its reason, so it is an instruction rather than a refusal')

/*
 * ============ THE RULE, ASKED OF THE WHOLE APP ============
 *
 * Everything above reads four files. The rule is not about four files.
 *
 * `Draw.vue:382` was a prize row rendered `:disabled="!isAdmin"` with nothing
 * saying why — the same shape as the incident in this file's header, on a
 * screen no assertion here had ever opened. It was not caught by anything,
 * because nothing was looking: this suite names its files, and the studio and
 * the draw page are not among them. A defect gets fixed once; a gate keeps
 * finding them, and only over ground it actually covers.
 *
 * WHY THIS NAMES THE CAPABILITY WORDS INSTEAD OF MATCHING THEM. The first
 * version of this check classified by keyword — anything matching /can[A-Z]/,
 * /role/, /permission/ — and reported 29 capability-gated controls with 9
 * missing reasons. All but one were wrong. `canSave` in PrizeForm is
 * `tier && name && quantity >= 1 && !busy`; `canIssue` in IssueBooks is
 * `!!range && !range.noneFree`; `eligible` in WinnerForm is
 * `!!ticket && isSold(ticket)`. Those are VALIDITY — the form is incomplete,
 * the data is not ready — and a form that is not filled in yet does not owe
 * anybody an explanation of who they are. Only a gate on WHO IS ASKING does.
 *
 * So the vocabulary is a short list somebody has to add to deliberately. A new
 * way of saying "this user may not" that is not on it will not be checked —
 * which is a real limit, and the reason the list is small enough to read.
 *
 * AND IT READS THE WHOLE OPENING TAG. The second version looked for a title on
 * the same LINE as the `:disabled` and reported eight gaps. Seven were false:
 * these are multi-line tags and the `:title` sits two lines below. A per-line
 * check on a multi-line tag looks exactly like a check and answers a different
 * question.
 */
console.log('\nevery control gated on WHO IS ASKING says so')
{
  const { readdirSync, statSync } = await import('node:fs')
  const { join } = await import('node:path')

  /** Ways this app says "this user may not". Extend deliberately. */
  const CAPABILITY = /\b(isAdmin|isSuper|isOrganiser|canWrite)\b/

  const root = new URL('../src/components/', import.meta.url).pathname
  const vue = []
  ;(function walk(d) {
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      if (statSync(p).isDirectory()) walk(p)
      else if (e.endsWith('.vue')) vue.push(p)
    }
  })(root)

  ok(vue.length > 30, `the walk found the components (${vue.length})`)

  /** The opening tag a `:disabled` sits in, quote-aware because handlers contain '>'. */
  const tagAround = (src, at) => {
    const start = src.lastIndexOf('<', at)
    let j = start, q = null
    while (j < src.length) {
      const c = src[j]
      if (q) { if (c === q) q = null }
      else if (c === '"' || c === "'") q = c
      else if (c === '>' && j > start) break
      j++
    }
    return src.slice(start, j + 1)
  }

  let gated = 0
  for (const file of vue) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/:disabled="([^"]*)"/g)) {
      if (!CAPABILITY.test(m.group ? m.group(1) : m[1])) continue
      gated++
      const tag = tagAround(src, m.index)
      const where = file.slice(file.indexOf('src/')) + ':' + (src.slice(0, m.index).split('\n').length)
      ok(/\s:?title=/.test(tag),
        `${where} is disabled on ${m[1]} and gives no reason — a control that is there, is not for you, and says nothing`)
    }
  }

  // Guard the parse: if the walk or the pattern stops matching, every
  // assertion above becomes vacuous and this suite would still print a pass.
  ok(gated >= 8,
    `found the capability-gated controls to check (${gated}) — a drop here means this stopped reading, not that the app stopped gating`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
