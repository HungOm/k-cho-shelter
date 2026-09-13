/**
 * Is Postgres actually faster for THIS app, or does it just sound faster?
 *
 * Measures the queries the app really makes, against a raffle the size of the
 * real one — 20,000 tickets in 2,000 books — and prints them next to the
 * Apps Script numbers measured on the live deployment.
 *
 * It goes through Supabase's REST API rather than raw SQL on purpose. That is
 * what a serverless function would use, so it includes the network hop and the
 * API layer. Measuring raw SQL would flatter the result and answer a question
 * nobody asked.
 *
 *   export SUPABASE_URL=https://xxxx.supabase.co
 *   export SUPABASE_SERVICE_KEY=eyJ...          # Settings -> API -> service_role
 *   node supabase/bench.mjs --seed               # first run only, ~1 minute
 *   node supabase/bench.mjs
 *
 * The service key bypasses row security and must never reach a browser. It is
 * read from the environment here and never written to a file.
 */

const URL_BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;

if (!URL_BASE || !KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY first.\n' +
    'Both are in your Supabase project under Settings -> API.');
  process.exit(1);
}

const H = {
  apikey: KEY,
  Authorization: 'Bearer ' + KEY,
  'Content-Type': 'application/json'
};

// Supabase serves PostgREST under /rest/v1/; a bare PostgREST serves at the
// root. Set SUPABASE_REST_PREFIX='/' to measure against a local container.
const PREFIX = process.env.SUPABASE_REST_PREFIX || '/rest/v1/';

async function rest(path, opts = {}) {
  const res = await fetch(URL_BASE + PREFIX + path, { ...opts, headers: { ...H, ...opts.headers } });
  const text = await res.text();
  if (!res.ok) throw new Error(res.status + ' ' + text.slice(0, 300));
  return text ? JSON.parse(text) : null;
}

/** Median of n runs — a single timing is mostly noise at these scales. */
async function timeIt(label, fn, runs = 5) {
  const ms = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    const out = await fn();
    ms.push(performance.now() - t0);
    if (i === 0) var first = out;
  }
  ms.sort((a, b) => a - b);
  const median = ms[Math.floor(ms.length / 2)];
  const worst = ms[ms.length - 1];
  return { label, median, worst, rows: Array.isArray(first) ? first.length : undefined };
}

// ============ SEED ============

const TOTAL = 20000, PER = 10, BOOKS = TOTAL / PER;
const pad = (n, w) => String(n).padStart(w, '0');
const ticketNo = (i) => 'KS-' + pad(i, 5);
const bookNo = (b) => 'Book-' + pad(b, 4);

// Names deliberately drawn from the transliteration patterns this raffle
// actually contains, so the trigram search is measured against the spelling
// variation it exists to handle rather than against uniform test data.
const NAMES = ['Pa Thang', 'Pa Thuang', 'Ma Nu', 'Ma Hlaing', 'Saw Htoo', 'Naw Paw',
  'U Kyaw', 'Daw Khin', 'Ko Aung', 'Ma Ei', 'Pa Cin', 'Ma Par', 'Saw Reh', 'Naw Mu'];

async function seed() {
  console.log('Seeding ' + TOTAL + ' tickets in ' + BOOKS + ' books...');

  await rest('agents', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(
      Array.from({ length: 40 }, (_, i) => ({
        agent_id: 'A' + pad(i + 1, 3), name: NAMES[i % NAMES.length] + ' ' + (i + 1),
        phone: '01255' + pad(10000 + i, 5), active: true
      })))
  });

  for (let start = 1; start <= BOOKS; start += 500) {
    const batch = [];
    for (let b = start; b < Math.min(start + 500, BOOKS + 1); b++) {
      batch.push({
        idx: b, number: bookNo(b),
        first_ticket: ticketNo((b - 1) * PER + 1), last_ticket: ticketNo(b * PER),
        status: b <= 200 ? 'Out' : 'Unassigned',
        held_by_agent: b <= 200 ? 'A' + pad((b % 40) + 1, 3) : null,
        due_at: b <= 200 ? new Date(Date.now() + 20 * 864e5).toISOString() : null
      });
    }
    await rest('books', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(batch) });
    process.stdout.write('.');
  }
  console.log(' books done');

  for (let start = 1; start <= TOTAL; start += 2000) {
    const batch = [];
    for (let i = start; i < Math.min(start + 2000, TOTAL + 1); i++) {
      // The first 1,500 are sold, which is roughly where a raffle sits mid-run.
      const sold = i <= 1500;
      batch.push({
        idx: i, number: ticketNo(i), book_idx: Math.ceil(i / PER),
        status: sold ? 'Sold' : 'Available',
        buyer_name: sold ? NAMES[i % NAMES.length] : '',
        buyer_phone: sold ? '01255' + pad(100000 + (i % 90000), 6) : '',
        sold_by_agent: sold ? 'A' + pad((i % 40) + 1, 3) : null,
        amount: sold ? 10 : null,
        payment_status: sold ? 'Paid' : '',
        sold_at: sold ? new Date(Date.now() - (i % 30) * 864e5).toISOString() : null
      });
    }
    await rest('tickets', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(batch) });
    process.stdout.write('.');
  }
  console.log(' tickets done\n');
}

// ============ THE QUERIES THE APP ACTUALLY MAKES ============

const CASES = [
  // The one that matters most. Today the browser downloads every ticket on
  // boot, because a spreadsheet cannot be searched — roughly 2.2 MB at this
  // size. Here the boot needs counts, not rows.
  ['boot: totals only (no rows)', () =>
    rest('tickets?select=status&limit=1', { headers: { Prefer: 'count=exact', Range: '0-0' } })],

  ['find one ticket by number', () =>
    rest('tickets?number=eq.KS-07213&select=*')],

  ['find by buyer name, misspelled', () =>
    rest('tickets?buyer_name=ilike.*thuang*&select=number,buyer_name,buyer_phone,status&limit=50')],

  ['find by phone', () =>
    rest('tickets?buyer_phone=like.*5501*&select=number,buyer_name&limit=50')],

  ['one book, every ticket in it', () =>
    rest('tickets?book_idx=eq.137&select=*&order=idx')],

  ['what changed in the last hour', () =>
    rest('tickets?modified_at=gt.' + new Date(Date.now() - 3600e3).toISOString() + '&select=*&limit=500')],

  ['book ledger, all 2,000 books', () =>
    rest('book_ledger?select=*')],

  ['money owed, by seller', () =>
    rest('book_ledger?status=eq.Out&select=held_by_agent,agent_name,counted_expected,counted_collected')],

  ['draw readiness: sold with no phone', () =>
    rest('tickets?status=in.(Sold,Donated)&buyer_phone=eq.&select=number&limit=500')],

  ['record one sale (write)', async () => {
    const n = 1500 + Math.floor(Math.random() * 18000);
    return rest('tickets?idx=eq.' + n, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'Sold', buyer_name: 'Bench Buyer', buyer_phone: '0125550100',
        amount: 10, payment_status: 'Paid', sold_at: new Date().toISOString(),
        source: 'bench', recorded_by: 'bench@x.com'
      })
    });
  }]
];

// Measured on the live Apps Script deployment, for the comparison that matters.
const BASELINE = [
  ['ping — no spreadsheet touched', 1200, 2100],
  ['read_version — two properties, no sheet', 1100, 9100],
  ['cold boot — every ticket to the browser', null, null]
];

async function main() {
  if (process.argv.includes('--seed')) await seed();

  const counts = await rest('tickets?select=idx&limit=1', { headers: { Prefer: 'count=exact', Range: '0-0' } });
  console.log('Measuring against the live Apps Script numbers.\n');
  console.log('Apps Script, as deployed today:');
  for (const [label, warm, cold] of BASELINE) {
    if (warm === null) { console.log('  ' + label.padEnd(44) + '  ~2.2 MB downloaded'); continue; }
    console.log('  ' + label.padEnd(44) + '  ' + (warm / 1000).toFixed(1) + 's warm, ' +
      (cold / 1000).toFixed(1) + 's cold');
  }

  console.log('\nPostgres, same work:');
  const results = [];
  for (const [label, fn] of CASES) {
    try {
      const r = await timeIt(label, fn);
      results.push(r);
      console.log('  ' + label.padEnd(44) + '  ' + r.median.toFixed(0) + 'ms median, ' +
        r.worst.toFixed(0) + 'ms worst' + (r.rows !== undefined ? '   (' + r.rows + ' rows)' : ''));
    } catch (e) {
      console.log('  ' + label.padEnd(44) + '  FAILED: ' + e.message.slice(0, 120));
    }
  }

  const median = results.length
    ? results.map(r => r.median).sort((a, b) => a - b)[Math.floor(results.length / 2)] : 0;
  console.log('\nMedian across every query: ' + median.toFixed(0) + 'ms');
  console.log('Apps Script floor, doing nothing at all: 1100ms');
  if (median > 0) {
    console.log('Ratio on the cheapest possible comparison: ' + (1100 / median).toFixed(0) + 'x');
  }
  console.log('\nThe honest caveat: this measures the database, not the whole app. A\n' +
    'serverless function in front of it adds its own cold start — usually\n' +
    '100-300ms, against Apps Script\'s 9s. Re-measure end to end before\n' +
    'committing to the rest of the migration.');
}

main().catch(e => { console.error(e); process.exit(1); });
