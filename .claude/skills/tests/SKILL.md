---
name: tests
description: >-
  How this raffle repository tests. Load BEFORE writing, changing, deleting or
  reviewing any file in tests/ or supabase/test-*.sh, before adding a suite to
  tests/run.sh, and whenever a test is failing, a bug has just been found, or
  somebody asks for "more tests", "coverage", or "tests for this". Tests here
  are a verification system ranked by the money and the tickets they protect —
  not a deliverable measured by quantity. Covers the risk ladder, the questions
  a proposed test must answer before it is written, the house form of a test
  file, the levels available and what each one cannot prove, the registration
  step without which a committed test never runs, and the protocol for turning
  a bug into the lowest test that catches it.
---

# Tests

**Tests are a verification system, not a deliverable measured by quantity.**

This repository has ~120 suites and tens of thousands of assertions. That is
not the achievement. The achievement is that the ones which exist were each
written because a specific failure was possible and expensive — money reported
wrong, a ticket that cannot be told from a forgery, a volunteer seeing a
buyer's phone number. Read the header of any file in `tests/`: every one names
the failure it pins, and several name the live outage that produced it.

Adding a test that names no failure dilutes that. It makes the suite slower,
makes every refactor more expensive, and — worst — makes a green run mean
slightly less than it did yesterday.

---

## 1. The risk ladder

Prioritise by business risk, in this order. The repo's own suites, so you can
find the neighbour to write beside:

1. **Financial correctness** — `money`, `moneyowed`, `moneyjournal`,
   `helpermoney`, `ledger`, `reportbalance`, `statement`, `writeoff`,
   `settlecount`, `integrity`, `pricefloor`.
   Money follows **custody**, not whoever typed it in. A seller's balance is a
   book figure plus hand payments; never re-derive what a seller owes from one
   door alone.
2. **Ticket / serial integrity** — `ticketcode`, `generate`, `verify`,
   `verifypage`, `qr`, `ticketrange`, `bookcanonical`, `seedagree`, `soldlock`,
   `canonical-client`.
   Unpredictability and constant-time comparison are asserted directly, not
   through something that uses them.
3. **Authorization and RLS** — `gate`, `roles`, `rolewords`, `permissionui`,
   `helperscope`, `buyerreach`, `session`, `refused`, plus
   `supabase/test-rls.sh` against real Postgres.
   Every case asks as somebody who should **not** see the rows. A policy that
   is too loose does not throw; it answers.
4. **State transitions and invariants** — `custodyledger`, `checkin`,
   `returncheck`, `backontheshelf`, `settleguards`, `softdelete`, `history`,
   `whoholds`, `whereis`, `resetcovers`, `resetplan`.
5. **Important business calculations** — `deltabooks`, `deltapaging`,
   `reportback`, `roundsnapshot`, `dates`, `days`, `clientdates`, `returndue`.
6. **Integration boundaries** — `wireshape`, `payloads`, `payloadshape`,
   `readshape`, `receiptshape`, `edgehandlers`, `router`, `clientcoverage`,
   `everyaction`, `directreads`, `storeload`, `supabaseload`, `emptypayloads`.
7. **Critical user journeys** — `screenrender`, `screencalls`, `ticketscreen`,
   `printsheet`, `modalwiring`, `freshinstall`, `receipt`.
8. **Ordinary UI behaviour** — `wording`, `footerfit`, `branding`, `i18n`.
   Lowest tier, and the tests here exist only because a *rule* is being
   enforced (one word for the owner; buttons stay inside the modal). "The
   component renders" is not a rule.

Work down the ladder. A gap at tier 1 outranks any amount of tier 8.

---

## 2. Before writing any test, answer these

- **What failure does this detect?** Say it as a sentence about the raffle, not
  about the code: "a seller who handed in half the money shows as having handed
  in nothing."
- **Is that failure realistically possible?** Can it reach the code as written,
  by a route a person or a handler actually takes?
- **Is this behaviour already covered elsewhere?** Search `tests/` first — the
  one-line purpose sits on line 2 of every file.
- **Can the test be moved to a lower level?** A pure function beats a handler
  beats a rendered screen beats real Postgres. See `references/levels.md`.
- **Will this test survive a refactor?** A test anchored to a comment, a class
  name, or the shape of a template dies on the next tidy-up and teaches
  nothing when it does.

If the answers are thin, do not write the test. Say so, and say which tier of
the ladder has a real gap instead.

---

## 3. The prohibitions

- **Do NOT write tests to raise a coverage number.** No coverage target is
  tracked here, deliberately.
- **Do NOT test framework behaviour.** Vue rendering a prop, `Array.map`,
  supabase-js returning `{ data, error }` — not ours to verify.
- **Do NOT assert the same thing at unit, handler and screen level.** Pick the
  level where the failure actually lives. Duplicates all fail together and all
  have to be edited together.
- **Do NOT change production code to make a test pass.** If a test is wrong,
  fix the test and say why in its header. If the code is wrong, that is the
  bug — see §7.
- **Do NOT weaken or delete an existing test because the implementation
  changed.** Read its header first: it says what failure it pins. If the
  invariant still holds, re-aim the test at the new code. If the invariant
  genuinely changed, say so in the header of whatever replaces it — the way
  `gate.test.mjs` records what `gateparity.test.mjs` was and why its grid
  outlived its oracle.

Prefer a few tests that would each have caught a real outage over many that
restate the code.

---

## 4. The house form of a test file

Plain Node, no framework, no dependency beyond what is already installed:

```js
/*
 * One line saying what this file is about.
 *
 * WHY THIS IS NEEDED. The failure, concretely — what went wrong or could go
 * wrong, what it looked like on a screen, and why nothing else catches it.
 *
 * WHAT THIS CANNOT DO. The half it does not cover, named so the next reader
 * knows the gap is known rather than missed.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

console.log('a sentence describing this group of assertions')
{
  ok(cond, 'what is true when this passes, in words a reader can check')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
```

Rules that come with the form:

- **The header is the point.** A test whose header cannot name a failure should
  not be written.
- **Assertion messages are sentences**, in the raffle's vocabulary. The message
  is what somebody reads at 11pm during a fundraiser.
- **The last line of output must be the `N passed, M failed` summary** —
  `run.sh` prints `tail -1` for each suite.
- **Exit code is what counts.** `run.sh` runs each file twice: once through a
  pipe for the summary line, once discarding output to read the status. So
  tests must be fast, deterministic, and side-effect free — no network, no
  wall-clock dependence, no shared temp path, no writing into the worktree.
- **A parse must prove it found something before it loops.** The dead test this
  repo has been bitten by is a regex over a source file that stops matching: the
  loop runs zero times and the suite passes having tested nothing. Assert the
  count first — `ok(ACTIONS.length > 60, ...)` in `gate.test.mjs` is the
  pattern.
### Never assert on the ABSENCE of a bad signal

This is one rule, and it is the one that has caught the most real defects here.
Assert a **positive count of the good signal**, and prove the assertion red
against the actually-broken version before trusting it green.

The failure it prevents always has the same shape: *the signal you checked is
produced by the failure itself, or is absent in exactly the way success is
absent.* Four from a single day, all of which die to this rule:

| What was checked | Why it could not fail | What to check instead |
|---|---|---|
| `grep -c "^  FAIL"` returns 0 | A crashed run prints no FAIL lines. Neither does a clean one. | `250 passed` — a positive count, or the exit code |
| No compile error from the template | A duplicate `v-else` discards the branch silently; discarding it *is* the compile succeeding | five radios actually rendered |
| `includes('See what is there')` | The empty state the bug leaves behind *contains* that string | match the control, not the prose around it |
| The suite is gone from `run.sh` | A suite deleted alongside its runner line leaves a directory and a runner that agree | `everytestruns` sees N names |

So: "no FAIL lines" becomes "N passed". "No compile error" becomes "five radios
rendered". "It is not in run.sh" becomes "the runner lists N suites". The
checker and the thing being checked must not be able to fail together.

Two specifics worth carrying: a scratch copy missing `package.json` makes Node
read every ESM module as CommonJS and the run dies before printing anything;
and `run.sh` pipes the first invocation through `tail -1`, so a stack trace
arrives as *no summary line at all* rather than as a failure.

*(The general rule is kcho-shelter-15's formulation, from four instances two of
us had each written up separately as war stories.)*
- **Test the value that is not in the set.** `/paid|received|in/i` matched
  `Unpaid`, and every unpaid ticket in the raffle showed as paid. "Everything
  except X" conditions are only caught by an assertion on a value nobody
  thought of; name the set that gets the thing.

---

## 5. Registration — without this, the test does not run

`tests/run.sh` keeps a hand-written list of every suite **on one line**. A test
file that is not named there is silently skipped (`[ -f "$t" ] || continue`
covers the other direction: a renamed file vanishes from the suite with no
output at all).

So, for every new suite:

1. Append the filename to the list in `tests/run.sh`.
2. Run `node tests/everytestruns.test.mjs` — it compares the directory and the
   runner as **sets**, both directions, because the loss hides inside a
   one-line edit that is otherwise legitimate.
3. Run `./tests/run.sh` whole before committing. `.github/workflows/deploy.yml`
   gates every deploy of the client and the functions on it.
4. If you add a **shell** test, make it executable and make git agree:
   `chmod +x` plus `git update-index --chmod=+x`. A `100644` mode passes
   locally and kills every deploy with exit 126.

---

## 6. The levels

| Level | Harness | Use for |
|---|---|---|
| Source text | `source.mjs` (`cut`, `codeOf`) | a rule about what the code says or must never say |
| Pure function | direct import / `loadts.mjs` | codes, ranges, dates, money arithmetic |
| Handler | `loadts.mjs` + `fakedb.mjs` | what a handler decides, in what order, what it refuses |
| Router | `loadts.mjs` on `index.ts` | a request in, a JSON body out |
| Screen | `screen.mjs` | a guard that must be *called*; a binding only the template reaches |
| Real Postgres | `supabase/test-functions.sh`, `test-rls.sh` | plpgsql and row security — the only evidence either works |

Pick the lowest level that can see the failure. `references/levels.md` has the
mechanics of each and, more importantly, **what each one cannot prove**.

---

## 7. When a bug is found

1. **Reproduce it** — on the real path, before touching anything.
2. **Add the lowest-level test that reliably catches it**, with a header naming
   the failure as it appeared.
3. **Fix the implementation** — and watch the new test go from red to green. A
   regression test never seen red is not known to catch anything.
4. **Run the relevant regression suite**: `./tests/run.sh` always; plus
   `supabase/test-functions.sh` if `schema.sql` or `functions.sql` moved, and
   `supabase/test-rls.sh` if `rls.sql` did. Those two are deliberately outside
   `run.sh` (Docker, ~15s) and exit 1 rather than 0 when they cannot run,
   because "skipped" was being read as "passed".
