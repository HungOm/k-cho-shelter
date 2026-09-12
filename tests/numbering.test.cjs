// Stub the Apps Script globals Config.gs touches at load time.
global.CacheService = { getScriptCache: () => ({ get:()=>null, put:()=>{}, remove:()=>{} }) };
global.SpreadsheetApp = { getActiveSpreadsheet: () => null };
global.Utilities = {};
global.PropertiesService = { getScriptProperties: () => ({ getProperty:()=>null, setProperty:()=>{} }) };

const fs = require('fs');
const src = fs.readFileSync(__dirname+'/../apps_script/Config.gs','utf8');
eval(src);

let pass=0, fail=0;
const eq=(got,want,what)=>{ if(String(got)===String(want)){pass++;} else {fail++;console.log(`  FAIL ${what}: got ${got}, want ${want}`);} };

function run(name, cfg, checks){
  console.log('\n'+name+'  ('+JSON.stringify(cfg)+')');
  checks(cfg);
}

// --- default shape: 6000 tickets, KS-0001.., 10/book ---
run('default', {TICKET_PREFIX:'KS-',TICKET_START:'1',TICKET_DIGITS:'4',TOTAL_TICKETS:'6000',
                TICKETS_PER_BOOK:'10',BOOK_PREFIX:'Book-',BOOK_DIGITS:'3'}, cfg=>{
  eq(ticketNumberAt(1,cfg),'KS-0001','first ticket');
  eq(ticketNumberAt(6000,cfg),'KS-6000','last ticket');
  eq(totalBooks(cfg),600,'total books');
  eq(bookNumberAt(1,cfg),'Book-001','first book');
  eq(bookNumberAt(600,cfg),'Book-600','last book');
  eq(bookOfTicket('KS-0001',cfg),'Book-001','ticket 1 -> book 1');
  eq(bookOfTicket('KS-0010',cfg),'Book-001','ticket 10 -> book 1 (boundary)');
  eq(bookOfTicket('KS-0011',cfg),'Book-002','ticket 11 -> book 2 (boundary)');
  eq(bookOfTicket('KS-0311',cfg),'Book-032','ticket 311 -> book 32');
  eq(bookOfTicket('KS-6000',cfg),'Book-600','last ticket -> last book');
  eq(ticketIndex('KS-3721',cfg),3721,'index roundtrip');
  eq(ticketIndex('KS-6001',cfg),0,'out of range rejected');
  eq(ticketIndex('XX-0001',cfg),0,'wrong prefix rejected');
  eq(ticketIndex('rubbish',cfg),0,'garbage rejected');
  const r=ticketRangeOfBook('Book-032',cfg);
  eq(r.first,311,'book 32 first'); eq(r.last,320,'book 32 last');
});

// --- the plan's verification case: TEST-, 3 digits, 50 tickets, 5 per book ---
run('reconfigured', {TICKET_PREFIX:'TEST-',TICKET_START:'1',TICKET_DIGITS:'3',TOTAL_TICKETS:'50',
                     TICKETS_PER_BOOK:'5',BOOK_PREFIX:'B',BOOK_DIGITS:'2'}, cfg=>{
  eq(ticketNumberAt(1,cfg),'TEST-001','first');
  eq(ticketNumberAt(50,cfg),'TEST-050','last');
  eq(totalBooks(cfg),10,'10 books');
  eq(bookOfTicket('TEST-001',cfg),'B01','first');
  eq(bookOfTicket('TEST-005',cfg),'B01','boundary lower');
  eq(bookOfTicket('TEST-006',cfg),'B02','boundary upper');
  eq(bookOfTicket('TEST-050',cfg),'B10','last');
  eq(ticketIndex('TEST-051',cfg),0,'beyond total rejected');
});

// --- no prefix, non-1 start, uneven last book ---
run('no prefix, starts at 5000, uneven', {TICKET_PREFIX:'',TICKET_START:'5000',TICKET_DIGITS:'5',
     TOTAL_TICKETS:'23',TICKETS_PER_BOOK:'10',BOOK_PREFIX:'Book-',BOOK_DIGITS:'3'}, cfg=>{
  eq(ticketNumberAt(1,cfg),'05000','first');
  eq(ticketNumberAt(23,cfg),'05022','last');
  eq(totalBooks(cfg),3,'3 books (uneven)');
  eq(bookOfTicket('05000',cfg),'Book-001','first');
  eq(bookOfTicket('05022',cfg),'Book-003','last, partial book');
  const r=ticketRangeOfBook('Book-003',cfg);
  eq(r.first,21,'partial book first'); eq(r.last,23,'partial book clamped to total');
});

// --- the shape actually in use at CEAM Shelter ---
run('live shape: KS- 5 digits, 20,000 tickets, Book- 4 digits',
    {TICKET_PREFIX:'KS-',TICKET_START:'1',TICKET_DIGITS:'5',TOTAL_TICKETS:'20000',
     TICKETS_PER_BOOK:'10',BOOK_PREFIX:'Book-',BOOK_DIGITS:'4'}, cfg=>{
  // Every ticket number is five digits, always. Never KS-1, never KS-3721.
  eq(ticketNumberAt(1,cfg),'KS-00001','first ticket is padded to five');
  eq(ticketNumberAt(2,cfg),'KS-00002','and the second');
  eq(ticketNumberAt(3721,cfg),'KS-03721','a four-digit number still gets five places');
  eq(ticketNumberAt(20000,cfg),'KS-20000','the last one fills all five');
  eq(totalBooks(cfg),2000,'2000 books');
  eq(bookNumberAt(1,cfg),'Book-0001','books are padded to four');
  eq(bookNumberAt(2000,cfg),'Book-2000','and the last one fills them');
  eq(bookOfTicket('KS-03721',cfg),'Book-0373','ticket 3721 is in book 373');
  eq(ticketIndex('KS-03721',cfg),3721,'and reads back');

  // Reading is deliberately tolerant — somebody typing KS-3721 means KS-03721,
  // and refusing them would be unhelpful. What matters is that the CANONICAL
  // form is always padded, so a tolerant read still lands on the stored number.
  eq(ticketIndex('KS-3721',cfg),3721,'an unpadded number still reads');
  eq(ticketNumberAt(ticketIndex('KS-3721',cfg),cfg),'KS-03721',
     'and canonicalises back to the padded form');
  eq(ticketNumberAt(ticketIndex('KS-00001',cfg),cfg),'KS-00001','padded input is unchanged');

  // Nothing anywhere may emit a short form.
  var short = 0;
  for (var i=1;i<=20000;i++) if (ticketNumberAt(i,cfg).length !== 8) short++;
  eq(short,0,'all 20,000 numbers are exactly KS- plus five digits');
});

// --- every ticket maps to a book that contains it (exhaustive) ---
console.log('\nexhaustive round-trip over 6000 tickets');
{
  const cfg={TICKET_PREFIX:'KS-',TICKET_START:'1',TICKET_DIGITS:'4',TOTAL_TICKETS:'6000',
             TICKETS_PER_BOOK:'10',BOOK_PREFIX:'Book-',BOOK_DIGITS:'3'};
  let bad=0;
  for(let i=1;i<=6000;i++){
    const num=ticketNumberAt(i,cfg);
    if(ticketIndex(num,cfg)!==i){bad++;continue;}
    const rng=ticketRangeOfBook(bookOfTicket(num,cfg),cfg);
    if(i<rng.first||i>rng.last) bad++;
  }
  eq(bad,0,'all 6000 tickets land inside their own book');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
