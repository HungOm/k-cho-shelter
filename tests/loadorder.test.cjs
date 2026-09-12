/*
 * What is safe to do at the top level of a .gs file.
 *
 * Apps Script concatenates every .gs file in the project and evaluates the
 * result top to bottom, in whatever order the project happens to hold the
 * files. Nothing in this repository controls that order — not the filenames,
 * not clasp, not the folder listing.
 *
 * So a top-level constant in one file that reads a constant from another is a
 * coin flip. The failure is silent: the name is `undefined` rather than an
 * error, so a list becomes [undefined, undefined] and a lookup simply stops
 * matching. That is how Reports.gs came to compute the money total from
 * recorded figures instead of declared ones with nothing to show for it.
 *
 * Two rules, enforced here rather than remembered:
 *   1. a top-level initialiser may only use names from its own file, declared
 *      above it
 *   2. no top-level code may call an Apps Script service
 */
const fs = require('fs'), pathDir = __dirname + '/../apps_script/';
const FILES = fs.readdirSync(pathDir).filter(f => f.endsWith('.gs')).sort();

let pass = 0, fail = 0;
const ok = (c, w) => { if (c) pass++; else { fail++; console.log('  FAIL ' + w); } };

const SERVICES = /\b(SpreadsheetApp|PropertiesService|CacheService|LockService|UrlFetchApp|DriveApp|Session|ScriptApp|MailApp|GmailApp|Logger|Utilities)\b/;

/** Top-level `var NAME = <initialiser>;`, with the initialiser text. */
function topLevelVars(src) {
  const out = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^var\s+([A-Za-z_$][\w$]*)\s*=\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    let text = m[2], depth = 0, j = i;
    const count = s => { for (const c of s) { if ('{[('.includes(c)) depth++; else if ('}])'.includes(c)) depth--; } };
    count(text);
    while (depth > 0 && j + 1 < lines.length) { j++; text += '\n' + lines[j]; count(lines[j]); }
    out.push({ name: m[1], line: i + 1, text });
  }
  return out;
}

console.log('top-level constants only use their own file');
{
  // Every top-level name, and which file declared it.
  const declaredIn = {};
  const perFile = {};
  for (const f of FILES) {
    const src = fs.readFileSync(pathDir + f, 'utf8');
    perFile[f] = { src, vars: topLevelVars(src) };
    for (const v of perFile[f].vars) declaredIn[v.name] = f;
    // functions are hoisted across the whole concatenation, so they are fine
    for (const m of src.matchAll(/^function\s+([A-Za-z_$][\w$]*)/gm)) declaredIn[m[1]] = f;
  }

  ok(FILES.length >= 8, 'found the server files (' + FILES.length + ')');
  ok(!!declaredIn.BOOK_STATUS, 'the scan sees BOOK_STATUS');

  let checked = 0;
  for (const f of FILES) {
    const { vars } = perFile[f];
    const seenHere = new Set();
    for (const v of vars) {
      // Names this initialiser mentions that are declared somewhere top-level.
      for (const m of v.text.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)) {
        const used = m[1];
        if (used === v.name) continue;
        const home = declaredIn[used];
        if (!home) continue;                       // not one of ours
        checked++;
        if (home !== f) {
          ok(false, `${f}:${v.line} ${v.name} uses ${used} from ${home} at load time — ` +
                    `file order is not guaranteed, so make it a function`);
        } else {
          ok(seenHere.has(used),
             `${f}:${v.line} ${v.name} uses ${used}, declared above it in the same file`);
        }
      }
      seenHere.add(v.name);
    }
  }
  ok(checked > 0, 'the rule was actually exercised (' + checked + ' references)');
}

console.log('no service is called at the top level');
{
  for (const f of FILES) {
    const src = fs.readFileSync(pathDir + f, 'utf8');
    for (const v of topLevelVars(src)) {
      ok(!SERVICES.test(v.text),
        `${f}:${v.line} ${v.name} must not call an Apps Script service at load time`);
    }

    // And no bare statement outside a function.
    //
    // Prototype wiring is the one exception: `ApiError.prototype =
    // Object.create(Error.prototype)` has to run at load time, and it is safe
    // because Object and Error are built in — it reads nothing from another
    // file. It still has to obey the no-services rule, checked below.
    const stray = src.split('\n')
      .map((l, i) => ({ l, n: i + 1 }))
      .filter(x => /^[A-Za-z_$]/.test(x.l))
      .filter(x => !/^(var|function)\s/.test(x.l))
      .filter(x => {
        const proto = /^[A-Za-z_$][\w$]*\.prototype\s*=/.test(x.l);
        if (proto) ok(!SERVICES.test(x.l), f + ':' + x.n + ' prototype wiring calls no service');
        return !proto;
      });
    ok(stray.length === 0,
      f + ' has no loose top-level statements' +
      (stray.length ? ' (line ' + stray[0].n + ': ' + stray[0].l.slice(0, 50) + ')' : ''));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
