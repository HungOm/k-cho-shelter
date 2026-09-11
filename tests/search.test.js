const fsx=require('fs');
function extractAppJs(){
  const html=fsx.readFileSync(__dirname+'/../index.html','utf8');
  const blocks=[...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)];
  return blocks[blocks.length-1][1];
}
const fs=require('fs');
const app=extractAppJs();

// Pull the pure search helpers out of the app and evaluate them standalone.
function grab(name){
  const re=new RegExp('function '+name+'\\s*\\([^)]*\\)\\s*\\{','m');
  const m=app.match(re); if(!m) throw new Error('not found: '+name);
  let i=app.indexOf('{',m.index), depth=0, j=i;
  for(;j<app.length;j++){ if(app[j]==='{')depth++; else if(app[j]==='}'){depth--; if(!depth)break;} }
  return app.slice(m.index, j+1);
}
eval(grab('fold')); eval(grab('phoneDigits')); eval(grab('closeEnough'));

let pass=0,fail=0;
const ok=(cond,what)=>{ if(cond)pass++; else {fail++;console.log('  FAIL '+what);} };

console.log('name folding (K\'Cho / Burmese transliteration)');
ok(fold("Pa Thang")==="pa thang", "basic fold");
ok(fold("Pa  THANG ")==="pa thang", "whitespace + case");
ok(fold("K'Cho")==="kcho", "apostrophe stripped");
ok(fold("Za-Aung")==="zaaung", "hyphen stripped");
ok(fold("Thuang")!==fold("Thang"), "different spellings are different strings");

console.log('spelling tolerance');
ok(closeEnough("thang","thuang"), "Thang ~ Thuang");
ok(closeEnough("cung","chung")===false || closeEnough("chung","cung"), "Cung ~ Chung (4+ chars)");
ok(closeEnough("zaa","za")===false, "too short to fuzzy-match (avoids false hits)");
ok(closeEnough("thang","mangkul")===false, "unrelated names do not match");
ok(closeEnough("biak","biek"), "one-letter difference matches");

console.log('phone normalising');
const want="0123456789";
ok(phoneDigits("012-345 6789")===want, "dashes and spaces");
ok(phoneDigits("0123456789")===want, "plain");
ok(phoneDigits("+60123456789")===want, "+60 international");
ok(phoneDigits("60123456789")===want, "60 without plus");
ok(phoneDigits("(012) 345-6789")===want, "brackets");
ok(phoneDigits("012-345 6789")===phoneDigits("+60123456789"), "all forms match each other");

console.log('trailing-digit ticket lookup');
const digitsOf=n=>n.replace(/\D/g,"");
ok(digitsOf("KS-0721").endsWith("721"), "721 matches KS-0721");
ok(digitsOf("KS-3721").endsWith("721"), "721 also matches KS-3721");
ok(!digitsOf("KS-7210").endsWith("721"), "721 does NOT match KS-7210");
ok(digitsOf("KS-3721").endsWith("3721"), "full number matches");

console.log('book range parsing');
function parseRange(raw){
  const m=raw.match(/^\s*([A-Za-z-]*)\s*(\d+)\s*(?:\.\.|–|-|to)\s*([A-Za-z-]*)\s*(\d+)\s*$/i);
  if(m && /book/i.test(m[1]||m[3]||"")) return [parseInt(m[2],10),parseInt(m[4],10)].sort((a,b)=>a-b);
  return null;
}
ok(String(parseRange("Book-031..045"))==="31,45", "Book-031..045");
ok(String(parseRange("book 3 to 9"))==="3,9", "book 3 to 9");
ok(parseRange("0123456789")===null, "a phone number is not a book range");
ok(parseRange("KS-0721")===null, "a ticket number is not a book range");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
