/*
 * A MIGRATION THAT NAMES A COLUMN THE TABLE HAS NOT GOT.
 *
 * `20260921120000` wrote `insert into config (key, value, description)`. The
 * column is called `notes`, every other migration in the directory says
 * `notes`, and the table has said `notes` since the schema was written. It was
 * a column name written from memory.
 *
 * WHAT IT COST IS THE POINT. `supabase db push` applies a batch and stops at
 * the first statement Postgres refuses, so it applied the migration before
 * this one and then stopped — leaving production half-way through a set of
 * four, with the person running it holding an error about a column rather
 * than a picture of which half landed. A mistake caught here costs a rerun; a
 * mistake caught there costs somebody working out what state a live raffle's
 * schema is in, with tickets being sold against it.
 *
 * NOTHING RUNS POSTGRES IN THIS SUITE, which is why this is a text check and
 * why it is deliberately narrow. It reads the columns each table is declared
 * with — from `create table` in schema.sql, plus every `alter table … add
 * column` in the migrations — and checks the insert lists against them.
 *
 * IT CHECKS WHAT IT CAN NAME AND SKIPS THE REST, rather than trying to be a
 * parser. An insert with no column list, a table it never saw declared, a
 * statement it cannot read: all passed over. That is the opposite of the
 * "everything except X" shape AUDIT.md §X names — the set that gets CHECKED is
 * the one this can be sure about, and `checked` below fails if that set is
 * suspiciously small, because a regex that quietly stops matching is how a
 * guard like this comes to prove nothing at all.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => {
  String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`))
}

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const schema = readFileSync(join(ROOT, 'supabase/schema.sql'), 'utf8')
const migDir = join(ROOT, 'supabase/migrations')
const migrations = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()

/* Comments hold SQL in this repository — whole statements, quoted in the
   essays above them — so they come out before anything is matched. */
const bare = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*--.*$/gm, ' ')

/*
 * THE COLUMNS EACH TABLE IS DECLARED WITH.
 *
 * Taken from the body of `create table`, one name per line that starts with an
 * identifier — constraints, checks and the closing paren are left out because
 * they do not start that way. Then every `add column` in the migrations, so a
 * column a migration introduces counts for the migrations after it.
 */
function columnsOf(body) {
  const out = new Set()
  for (const line of body.split('\n')) {
    const m = /^\s{2,}([a-z_][a-z0-9_]*)\s+[a-z]/i.exec(line)
    if (!m) continue
    const name = m[1].toLowerCase()
    if (['constraint', 'primary', 'unique', 'foreign', 'check', 'exclude'].includes(name)) continue
    out.add(name)
  }
  return out
}

const tables = new Map()
for (const m of bare(schema).matchAll(/create table if not exists ([a-z_]+)\s*\(([\s\S]*?)\n\);/g)) {
  tables.set(m[1], columnsOf(m[2]))
}
for (const f of migrations) {
  const sql = bare(readFileSync(join(migDir, f), 'utf8'))
  for (const m of sql.matchAll(/alter table ([a-z_]+)[\s\S]*?add column (?:if not exists )?([a-z_]+)/gi)) {
    const t = tables.get(m[1].toLowerCase())
    if (t) t.add(m[2].toLowerCase())
  }
}

console.log('the schema declares the tables this checks against')
{
  ok(tables.size >= 10, `${tables.size} tables read out of schema.sql`)
  ok(tables.get('config')?.has('notes'), 'config has notes')
  ok(!tables.get('config')?.has('description'),
    'and has no description — the column this whole file exists because of')
  ok(tables.get('tickets')?.has('buyer_phone'), 'tickets has buyer_phone')
  ok(tables.get('ticket_receipts')?.has('buyer_phone'),
    'and ticket_receipts gained one from a migration, not from schema.sql alone')
}

console.log('every insert names columns the table has')
{
  let checked = 0
  const files = [['supabase/schema.sql', schema],
    ...migrations.map((f) => [`supabase/migrations/${f}`, readFileSync(join(migDir, f), 'utf8')])]

  for (const [name, raw] of files) {
    const sql = bare(raw)
    for (const m of sql.matchAll(/insert into ([a-z_]+)\s*\(([^)]*)\)\s*(?:values|select)/gi)) {
      const table = m[1].toLowerCase()
      const known = tables.get(table)
      /* A table this file never saw declared — one created inside a migration,
         or a name it could not read. Skipped rather than guessed at. */
      if (!known) continue
      const cols = m[2].split(',').map((c) => c.trim().toLowerCase()).filter(Boolean)
      /* A column list that is not plainly a list of identifiers is not one
         this can judge. */
      if (!cols.length || !cols.every((c) => /^[a-z_][a-z0-9_]*$/.test(c))) continue
      checked += 1
      for (const col of cols) {
        ok(known.has(col),
          `${name}: insert into ${table} names "${col}", which that table has not got `
          + `(it has ${[...known].join(', ')})`)
      }
    }
  }
  /*
   * THE ENUMERATION HAS TO ASSERT IT FOUND SOMETHING. A regex that stops
   * matching reports every file as clean, which is indistinguishable from
   * every file being clean — the failure `guard-the-parse` is named after.
   */
  ok(checked >= 12, `enough inserts were actually read (${checked})`)
}

console.log('and the one that got through is the one it would now catch')
{
  /*
   * Run against the mistake itself rather than trusting the rule in the
   * abstract: the fixed migration passes, and the text it replaced does not.
   */
  const fixed = readFileSync(join(migDir, '20260921120000_the_card_a_buyer_is_sent_can_be_designed.sql'), 'utf8')
  ok(/insert into config \(key, value, notes\)/.test(bare(fixed)),
    'the migration says notes')
  const broken = bare(fixed).replace('(key, value, notes)', '(key, value, description)')
  const cols = (/insert into config\s*\(([^)]*)\)/.exec(broken) || [])[1].split(',').map((c) => c.trim())
  eq(cols.filter((c) => !tables.get('config').has(c)).join(), 'description',
    'and the broken form is refused by the same rule, naming the column')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
