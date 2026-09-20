# The levels, and what each one cannot prove

Pick the lowest level that can see the failure. Every level here is blind to
something; the blindness is the part worth knowing, because it is where a green
suite has lied before.

---

## Source text — `tests/source.mjs`

For rules about what the code *says*: a filename that must be referenced, a
`security_invoker` declaration, an address that must not travel with a file.

```js
import { cut, codeOf } from './source.mjs'
const body = cut(src, 'export function settle', '\n}', 'the settle handler')
```

- `cut` **throws** when a marker is missing. Never hand-roll `indexOf` +
  `slice`: `indexOf` returns -1, the slice quietly runs to end of file, and the
  test then reports confidently on the wrong region.
- **Anchor on code, never on a comment.** Rewording prose is something everyone
  does freely; a comment is the least stable text in the file and the one
  nothing else depends on. `sourceanchors.test.mjs` enforces this.
- Assert against `codeOf(src)`, not the raw text. A file that explains a rule at
  length contains every phrase the rule does — that has produced three false
  greens here (a logo filename, a `security_invoker`, an org name).

**Cannot prove:** that any of it runs. A helper can be present, correct, and
never called. That has happened four times in this repo in two days.

---

## Pure function — direct import, or `loadts.mjs` for a `.ts` module

Ticket codes, ranges, calendar days, money arithmetic. Cheapest and most
durable level; reach for it first.

```js
import { setEnv, loadModule, cleanup } from './loadts.mjs'
setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const tc = await loadModule('../_shared/ticketcode.ts')
```

`loadts.mjs` bundles the Deno TypeScript through esbuild and shims `Deno.env`,
so function secrets are set the way production sets them and no other way.
Modules are cached per name; `setEnv` before loading.

**Cannot prove:** that the caller passes what you passed.

---

## Handler — `loadts.mjs` + `tests/fakedb.mjs`

What a handler decides, in what order, and what it refuses. This is the level
most tier-1 to tier-4 tests belong at.

```js
import { fakeDb, baseConfig, users, codeOf, errOf } from './fakedb.mjs'
const db = fakeDb({ config: baseConfig(), books: [...], tickets: [...] })
const r = await books.settleBook({ book: 'Book-001', sold: [...] }, users.admin, db.ctx)
```

The signature is `(payload, user, ctx)`, and `db.ctx` carries both `supabase`
and `supabaseAdmin`. `users` has `boss`, `admin`, `recorder`, `agent`
ready-made; `codeOf(fn)` / `errOf(fn)` give the code a handler threw — or
`NO_THROW`, which is the assertion you usually want.

`fakedb` implements the subset of PostgREST these handlers actually use,
measured rather than guessed, with the column defaults the real schema applies
on insert — because handlers branch on those.

**Cannot prove**, and this one has cost a live outage:

- It is **not Postgres**. No CHECK constraints, no foreign keys; it will store a
  row the real database would refuse.
- Its `rpc` **reimplements** `issue_books_tx`, `settle_book`, `restock_books`
  and the rest in JavaScript. A green run says *nothing* about the plpgsql in
  `supabase/functions.sql`. `issue_books_tx` once selected an alias nothing
  bound — invalid since the day it was written, accepted by `create or replace`,
  clean migration, clean deploy, green suite, and giving out books failed for
  every volunteer. Nothing between the keyboard and the fundraiser looked at
  the body.

---

## Router — `loadts.mjs` on `index.ts`

A request in, a JSON body out: routing, the registry, the envelope, error
codes. Use when the failure lives in dispatch rather than in a handler.

When reading the `REGISTRY` out of the source, **assert the parse found
something** before looping over it (`gate.test.mjs` §"the registry was actually
read"). A regex that stops matching turns the whole file into a pass.

---

## Screen — `tests/screen.mjs`

The only level that catches "the helper is correct and nobody calls it". Two
entry points, and the choice between them matters:

```js
import { renderScreen, setupOf, visibleText } from './screen.mjs'

// what the screen SHOWS — script and template, server-rendered
const html = await renderScreen('src/components/modals/SellerMoney.vue', storeStub, {
  props: { agent: row },
  drive: async b => { await b.load() },   // what mounting would have done
  renderReal: ['Empty.vue'],
})

// the screen's own bindings — refs, computeds, functions, live
const { ctx, cleanup } = await setupOf('src/components/screens/Books.vue', storeStub, props, { emit })
```

- **`setupOf` cannot see the template.** A binding only the markup reaches is
  invisible to it, and it reports clean. If the assertion is about what a person
  sees, use `renderScreen`.
- **Assert on `visibleText(html)`, not the markup.** An assertion against raw
  HTML passes on text that only exists in a `title` attribute, and Vue escapes
  an apostrophe as `&#39;` — so a raw match on "somebody else's book" fails
  while reporting that the screen does not say it.
- **`drive` is not optional state-setting.** Server rendering never fires
  `onMounted`; an undriven screen asserts the skeleton and calls it proof.
- **Child stubs render their SLOTS, not their PROPS.** `<Empty>no books yet</Empty>`
  shows its sentence; `<Empty title="No books yet">` and `<Bi text="Cancel">`
  render nothing at all. An assertion aimed at a prop fails looking exactly like
  a broken screen — aim at slot content, or name that child in `renderReal`.
- `src/` is copied and only `lib/store.js` is replaced, so the component's own
  imports run exactly as they ship.

**Cannot prove:** anything about the server. The store is a stub.

---

## Real Postgres — `supabase/test-functions.sh`, `supabase/test-rls.sh`

The only evidence that the SQL functions execute and that row security holds.
Docker, or a local psql fallback; ~15s; deliberately **not** in `tests/run.sh`,
because a suite that slow stops being run before every change.

Run `test-functions.sh` after touching `schema.sql` or `functions.sql`, and
`test-rls.sh` after touching `rls.sql`. Both **exit 1** when they cannot get a
database — "skipped" was being read as "passed", and a machine without Docker
checked none of the row security and said nothing.

Both name their container and database per-process (`$$`), so two sessions can
run at once. Keep that if you extend them: a fixed name means a peer's
`docker rm -f` kills your run mid-flight, and what that looks like is a scatter
of failures in unrelated cases — confident nonsense, which is worse than red.

After any deploy that touches a SQL function, exercise it for real: issue a
book, return it, count it in, inside a transaction you roll back.
