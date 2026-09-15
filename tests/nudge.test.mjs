/*
 * The nudge carries no row.
 *
 * WHAT THIS PREVENTS. Realtime's postgres_changes publishes from BASE TABLES;
 * you cannot subscribe to a view. Every column mask in this app lives in
 * tickets_readable, and rls.sql revokes tickets, books, agents and config from
 * authenticated so a browser cannot reach the raw rows at all. The natural way
 * to make a subscription work is one line — grant select on tickets to
 * authenticated — and the policy behind that grant ALREADY EXISTS and already
 * permits any signed-in person to read raw buyer_name, buyer_phone, buyer_zone
 * and notes. The viewer mask, the helper narrowing and the notes blanking would
 * all come off, through the ordinary API as well as the socket, with nothing
 * going red.
 *
 * So the server broadcasts "something changed" and nothing else. The client
 * re-reads through the masked view it already uses, and every masking rule holds
 * without being restated — which is the property that makes this safe rather
 * than merely careful. A rule restated in a second place is the thing rls.sql's
 * own header warns about.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const MIG = join(ROOT, 'supabase/migrations')
const sql = readdirSync(MIG).filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(join(MIG, f), 'utf8')).join('\n')
const rls = readFileSync(join(ROOT, 'supabase/rls.sql'), 'utf8')
/**
 * SQL with its comments removed — BOTH kinds.
 *
 * The first version stripped only `--` lines, and "no number in the payload"
 * failed against a /* *\/ docstring that says "not the ticket number". The
 * comment explaining an exclusion contains the excluded word, so the assertion
 * was answered by the explanation rather than by the code.
 *
 * Third time today between the sessions here: a comment that describes a rule
 * reads exactly like the rule to anything matching on text.
 */
const code = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').filter((l) => !/^\s*--/.test(l)).join('\n')

console.log('the broadcast carries nothing from the row')
{
  const fn = sql.slice(sql.indexOf('function notify_raffle_change'))
  const body = code(fn.slice(0, fn.indexOf('language plpgsql')))
  ok(/realtime\.send\(/.test(body), 'it broadcasts')
  // Anything from NEW or OLD is row data, however harmless it looks. A ticket
  // number plus a timestamp is a record of when that ticket sold, readable by
  // everyone on the channel.
  ok(!/\bnew\.|\bold\./i.test(body),
     'and reads nothing off NEW or OLD')
  for (const col of ['buyer_name', 'buyer_phone', 'buyer_zone', 'notes', 'number', 'idx']) {
    ok(!new RegExp(`\\b${col}\\b`).test(body), `no ${col} in the payload`)
  }
}

console.log('it fires once per statement, not once per row')
{
  // A row-level trigger on a 500-row bulk_record_sales sends five hundred
  // messages telling every connected phone to re-read the same delta. The nudge
  // does not say WHAT changed, so once per statement carries the same
  // information as once per row.
  const triggers = [...sql.matchAll(/create trigger (\w+_changed)[\s\S]*?execute function notify_raffle_change/g)]
  ok(triggers.length >= 2, `both tables nudge (${triggers.length})`)
  for (const t of triggers) {
    ok(/for each statement/i.test(t[0]), `${t[1]} is statement level`)
    ok(!/for each row/i.test(t[0]), `${t[1]} is not row level`)
  }
}

console.log('a broadcast failure cannot fail a sale')
{
  const fn = sql.slice(sql.indexOf('function notify_raffle_change'))
  const body = code(fn.slice(0, fn.indexOf('language plpgsql')))
  // This trigger hangs off selling a ticket. If Realtime is down, the right
  // outcome is a recorded sale and an app that falls back to its poll — not a
  // volunteer who cannot take money because a socket is unavailable.
  ok(/exception when others then/.test(body), 'it swallows every error at write time')
}

console.log('but a missing Realtime fails at INSTALL, loudly')
{
  /*
   * The handler above is right at write time and wrong at install time: if
   * realtime.send does not exist, every nudge is silently a no-op and the only
   * symptom is an app that quietly keeps polling. Nobody investigates a feature
   * nobody noticed was missing. So it is called once unguarded in the migration.
   */
  const install = sql.slice(sql.indexOf('PROVE REALTIME IS THERE'))
  const check = install.slice(0, install.indexOf('THE BROADCAST'))
  ok(/perform realtime\.send/.test(check), 'the migration calls it once')
  ok(!/exception/.test(check), 'with no handler, so a missing Realtime stops the migration')
}

console.log('and the grant that would undo the masking is still absent')
{
  // The one line that turns this from a nudge into a leak.
  const all = code(rls) + code(sql)
  ok(!/grant\s+select\s+on\s+(table\s+)?tickets\s+to/i.test(all),
     'nothing grants select on tickets to a browser role')
  ok(/revoke all on tickets, books, agents, config from authenticated/.test(rls),
     'and the revoke that makes the view the only way in is still there')
}

console.log('the channel is private and gated on the allowlist')
{
  const pol = sql.slice(sql.indexOf('policy raffle_nudge_read'))
  ok(/private/.test(sql.slice(sql.indexOf('notify_raffle_change'), sql.indexOf('notify_raffle_change') + 1200)) ||
     /true\s*$/m.test(pol), 'the broadcast is private')
  ok(/app_role\(\)\s+is\s+not\s+null/.test(pol),
     'and only an allowlisted account hears it — timing is information even with an empty payload')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
