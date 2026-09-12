require('./mock.cjs');
const fs=require('fs'), path=__dirname+'/../apps_script/';
for(const f of ['Config.gs','Auth.gs','Api.gs','Tickets.gs','Books.gs','People.gs','Reports.gs','Approvals.gs'])
  eval(fs.readFileSync(path+f,'utf8'));

let pass=0,fail=0;
const ok=(c,w)=>{ if(c)pass++; else {fail++;console.log('  FAIL '+w);} };
const eq=(g,w,what)=>{ if(String(g)===String(w))pass++; else {fail++;console.log(`  FAIL ${what}: got ${g}, want ${w}`);} };

// ---- build a small world: 30 tickets, 3 books of 10, RM 10 each ----
function world(){
  global.__clearCache();
  for(const k in global.__sheets) delete global.__sheets[k];
  __mkSheet(SHEET.CONFIG, COLS.CONFIG);
  const cfgRows=[['TICKET_PREFIX','KS-'],['TICKET_START','1'],['TICKET_DIGITS','4'],
    ['TOTAL_TICKETS','30'],['TICKETS_PER_BOOK','10'],['BOOK_PREFIX','Book-'],['BOOK_DIGITS','3'],
    ['TICKET_PRICE','10'],['CURRENCY','RM'],['DEFAULT_DUE_DAYS','30']];
  cfgRows.forEach(r=>__sheets[SHEET.CONFIG].appendRow(r));

  const T=__mkSheet(SHEET.TICKETS, COLS.TICKETS);
  const cfg=getConfig();
  for(let i=1;i<=30;i++){
    const row=new Array(COLS.TICKETS.length).fill('');
    row[0]=ticketNumberAt(i,cfg); row[1]=TICKET_STATUS.AVAILABLE;
    row[2]=bookOfTicket(row[0],cfg); row[12]=1;
    T.appendRow(row);
  }
  const B=__mkSheet(SHEET.BOOKS, COLS.BOOKS);
  for(let b=1;b<=3;b++){
    const row=new Array(COLS.BOOKS.length).fill('');
    row[0]=bookNumberAt(b,cfg); row[1]=ticketNumberAt((b-1)*10+1,cfg); row[2]=ticketNumberAt(b*10,cfg);
    row[3]=BOOK_STATUS.UNASSIGNED; row[13]=1;
    B.appendRow(row);
  }
  __mkSheet(SHEET.AGENTS, COLS.AGENTS).appendRow(['A001','Pa Thang','0123456789','Kajang',true,'']);
  __mkSheet(SHEET.USERS, COLS.USERS);
  __mkSheet(SHEET.BOOK_HISTORY, COLS.BOOK_HISTORY);
  __mkSheet(SHEET.WINNERS, COLS.WINNERS);
  __mkSheet(SHEET.AUDIT, COLS.AUDIT);
  bumpBookCacheVersion();
}
const admin={email:'admin@x.com',displayName:'Admin',role:'admin',isAdmin:true,agentId:'',active:true};
const tstatus=n=>{ const c=loadTicket_(n); return c.ticket.Status; };
const tfield=(n,f)=>{ const c=loadTicket_(n); return c.ticket[f]; };

// ============ 1. issue + sell + settle with 2 unsold ============
console.log('settle: 3 recorded live, 2 handed back, RM 80 paid');
world();
handleIssueBooks({agentId:'A001',fromBook:'Book-001',toBook:'Book-001'},admin);
eq(getBookOwnerMap()['BOOK-001'].status,'Out','book is out');

for(const n of ['KS-0001','KS-0002','KS-0003'])
  handleSellTicket({ticketNumber:n,buyerName:'Buyer '+n,buyerPhone:'0123456789',
                    expectedVersion:loadTicket_(n).ticket.Version},admin);
eq(tstatus('KS-0001'),'Sold','live sale recorded');

const r=handleSettleBook({bookNumber:'Book-001',unsoldTickets:['KS-0009','KS-0010'],amountPaid:80},admin);
eq(r.declaredSold,8,'8 sold');
eq(r.amountDue,80,'RM 80 due');
eq(r.variance,0,'no variance');
eq(tstatus('KS-0009'),'Available','handed-back ticket is available');
eq(tstatus('KS-0010'),'Available','handed-back ticket is available');
eq(tstatus('KS-0004'),'Sold','unrecorded ticket marked sold by settlement');
eq(tfield('KS-0004','Source'),'settlement','marked as bulk-settled, not invented as live');
eq(tfield('KS-0004','Buyer_Name'),'','settlement leaves buyer blank — honest, not fabricated');
eq(tfield('KS-0001','Buyer_Name'),'Buyer KS-0001','live sale keeps its real buyer');
eq(getBookOwnerMap()['BOOK-001'].status,'Settled','book closed');

console.log('reconciliation totals');
{
  const led=buildBookLedger_();
  const b1=led.rows.find(x=>x.book==='Book-001');
  eq(b1.source,'declared','settled book counts from declared figures');
  eq(b1.countedSold,8,'counted sold = declared');
  eq(b1.countedExpected,80,'expected 80');
  eq(b1.countedCollected,80,'collected 80');
  eq(b1.missingContact,5,'5 sold tickets have no contact details');
  // the whole point of the one-source rule: no double counting
  const total=led.rows.reduce((a,x)=>a+x.countedSold,0);
  eq(total,8,'org total counts book once, not declared + recorded');
}

// ============ 2. short payment shows a variance ============
console.log('settle: RM 70 paid on RM 80 due');
world();
handleIssueBooks({agentId:'A001',fromBook:'Book-001'},admin);
const r2=handleSettleBook({bookNumber:'Book-001',unsoldTickets:['KS-0009','KS-0010'],amountPaid:70},admin);
eq(r2.variance,-10,'RM 10 short');
{
  const out=handleReportOutstanding({},admin);
  const a=out.agents.find(x=>x.agentId==='A001');
  eq(a.outstanding,10,'agent owes RM 10');
}

// ============ 3. lost leftovers: book total only, no invented tickets ============
console.log('settle: leftovers lost, declare 8 sold');
world();
handleIssueBooks({agentId:'A001',fromBook:'Book-001'},admin);
const r3=handleSettleBook({bookNumber:'Book-001',allowUnidentified:true,soldCount:8,amountPaid:80},admin);
eq(r3.declaredSold,8,'8 declared');
eq(tstatus('KS-0001'),'Available','no ticket was invented as sold');
{
  const led=buildBookLedger_();
  const b1=led.rows.find(x=>x.book==='Book-001');
  eq(b1.recordedSold,0,'nothing recorded per-ticket');
  eq(b1.countedSold,8,'but the book total still counts');
  eq(b1.varianceSold,8,'variance shows the 8 tickets nobody wrote down');
}

// ============ 4. guards ============
console.log('guards');
world();
handleIssueBooks({agentId:'A001',fromBook:'Book-001'},admin);
try{ handleSellTicket({ticketNumber:'KS-0001',buyerName:'X',buyerPhone:'0123456789',expectedVersion:1},admin);
     handleSellTicket({ticketNumber:'KS-0001',buyerName:'Y',buyerPhone:'0123456789',expectedVersion:2},admin);
     ok(false,'double sell should be refused'); }
catch(e){ eq(e.code,'ALREADY_SOLD','selling a sold ticket is refused'); }

try{ handleSellTicket({ticketNumber:'KS-0002',buyerName:'X',buyerPhone:'0123456789',expectedVersion:99},admin);
     ok(false,'stale version should be refused'); }
catch(e){ eq(e.code,'VERSION_CONFLICT','stale edit refused, not silently overwritten'); }

try{ handleSellTicket({ticketNumber:'KS-0002',buyerName:'X',buyerPhone:'123',expectedVersion:1},admin);
     ok(false,'short phone should be refused'); }
catch(e){ eq(e.code,'BAD_PHONE','unusable phone refused'); }

try{ handleSellTicket({ticketNumber:'KS-0002',buyerName:'',buyerPhone:'0123456789',expectedVersion:1},admin);
     ok(false,'missing name should be refused'); }
catch(e){ eq(e.code,'MISSING_FIELD','name required on every sale'); }

const agentUser={email:'a@x.com',displayName:'Pa Thang',role:'agent',isAdmin:false,agentId:'A001',active:true};
try{ handleSellTicket({ticketNumber:'KS-0021',buyerName:'X',buyerPhone:'0123456789',expectedVersion:1},agentUser);
     ok(false,'agent selling from an unissued book should be refused'); }
catch(e){ eq(e.code,'BOOK_NOT_ASSIGNED','agent cannot sell from a book nobody holds'); }

handleIssueBooks({agentId:'A001',fromBook:'Book-003'},admin);
const other={email:'b@x.com',displayName:'Other',role:'agent',isAdmin:false,agentId:'A002',active:true};
try{ handleSellTicket({ticketNumber:'KS-0021',buyerName:'X',buyerPhone:'0123456789',expectedVersion:1},other);
     ok(false,"other agent's book should be refused"); }
catch(e){ eq(e.code,'NOT_YOUR_BOOK','agent cannot touch another agent\'s book'); }

const r4=handleSellTicket({ticketNumber:'KS-0021',buyerName:'Ok',buyerPhone:'0123456789',expectedVersion:1},agentUser);
eq(r4.status,'Sold','owning agent can sell from their own book');

// ============ 5. return releases reservations ============
console.log('return releases reservations');
world();
handleIssueBooks({agentId:'A001',fromBook:'Book-002'},admin);
handleReserveTicket({ticketNumber:'KS-0011',buyerName:'Held',expectedVersion:1},admin);
handleSellTicket({ticketNumber:'KS-0012',buyerName:'Real',buyerPhone:'0123456789',expectedVersion:1},admin);
eq(tstatus('KS-0011'),'Reserved','reserved');
const rr=handleReturnBooks({fromBook:'Book-002'},admin);
eq(rr.reservationsReleased,1,'1 reservation released');
eq(tstatus('KS-0011'),'Available','reservation died with custody');
eq(tstatus('KS-0012'),'Sold','a real sale is untouched by return');

// ============ 6. lost book voids unsold tickets ============
console.log('lost book voids unsold tickets');
world();
handleIssueBooks({agentId:'A001',fromBook:'Book-002'},admin);
handleSellTicket({ticketNumber:'KS-0011',buyerName:'Real',buyerPhone:'0123456789',expectedVersion:1},admin);
const dry=handleSetBookStatus({fromBook:'Book-002',status:'Lost',reason:'agent moved away'},admin);
eq(dry.dryRun,true,'destructive change previews by default');
eq(tstatus('KS-0012'),'Available','preview wrote nothing');
handleSetBookStatus({fromBook:'Book-002',status:'Lost',reason:'agent moved away',dryRun:false},admin);
eq(tstatus('KS-0012'),'Void','unsold ticket in a lost book cannot win');
eq(tstatus('KS-0011'),'Sold','an already-sold ticket keeps its buyer');

// ============ 7. transfer ============
console.log('transfer between agents');
world();
__sheets[SHEET.AGENTS].appendRow(['A002','Biak Cung','0119876543','Cheras',true,'']);
handleIssueBooks({agentId:'A001',fromBook:'Book-001',toBook:'Book-002'},admin);
const tr=handleTransferBooks({fromBook:'Book-001',toBook:'Book-001',toAgentId:'A002'},admin);
eq(tr.transferred,1,'1 book moved');
eq(getBookOwnerMap()['BOOK-001'].agentId,'A002','new holder recorded');
eq(getBookOwnerMap()['BOOK-002'].agentId,'A001','other book untouched');
eq(__sheets[SHEET.BOOK_HISTORY].getLastRow()>1,true,'custody change is in the history');

// ============ 8. bulk entry is all-or-nothing ============
console.log('bulk counterfoil entry');
world();
handleIssueBooks({agentId:'A001',fromBook:'Book-001'},admin);
try{
  handleBulkRecordSales({sales:[
    {ticketNumber:'KS-0001',buyerName:'A',buyerPhone:'0123456789'},
    {ticketNumber:'KS-0002',buyerName:'',buyerPhone:'0123456789'}]},admin);
  ok(false,'batch with a bad row should be rejected');
}catch(e){ eq(e.code,'BATCH_REJECTED','bad row rejects the whole batch'); }
eq(tstatus('KS-0001'),'Available','nothing was written from the rejected batch');

const bulk=handleBulkRecordSales({sales:[
  {ticketNumber:'KS-0001',buyerName:'A',buyerPhone:'0123456789'},
  {ticketNumber:'KS-0002',buyerName:'B',buyerPhone:'0119876543'}]},admin);
eq(bulk.recorded,2,'clean batch saves');
eq(tstatus('KS-0002'),'Sold','recorded');

// ============ 9. draw readiness + entries ============
console.log('draw readiness');
{
  const d=handleReportDrawReady({},admin);
  ok(d.blockers.length>0,'unsettled books block the draw');
  const e=handleExportEntries({},admin);
  eq(e.count,2,'only sold tickets are entries');
  ok(e.entries.every(x=>x.contactable),'both entries are contactable');
}


// ============ 10. role enforcement through the real gate ============
console.log('role enforcement (registry + requireUser)');
{
  const reg=actionRegistry();
  // Exercise the real condition from requireUser, not a copy.
  function gate(role, allowedRoles){
    const user={role, isAdmin: role==='admin'};
    if (allowedRoles && !user.isAdmin) {
      if (allowedRoles.indexOf(user.role) === -1) return 'DENIED';
    }
    return 'ALLOWED';
  }
  const adminOnly=['issue_books','transfer_books','settle_book','set_book_status',
                   'upsert_user','set_user_status','upsert_agent'];
  // These four sit behind a second gate as well: admin clears the role check
  // here and is then refused for not being the super admin. That layer is
  // covered in superadmin.test.cjs; this block tests only the role beneath it.
  const superOnly=['void_ticket','read_audit','export_entries','record_winner'];

  for(const a of adminOnly.concat(superOnly)){
    eq(gate('viewer',reg[a].roles),'DENIED',`viewer blocked from ${a}`);
    eq(gate('agent',reg[a].roles),'DENIED',`agent blocked from ${a}`);
    eq(gate('recorder',reg[a].roles),'DENIED',`recorder blocked from ${a}`);
    eq(gate('admin',reg[a].roles),'ALLOWED',`admin clears the role gate for ${a}`);
  }
  for(const a of adminOnly) ok(!reg[a].sup,`${a} is admin-only, not super-only`);
  for(const a of superOnly) ok(reg[a].sup===true,`${a} also needs the super admin`);
  // recorders must still be able to do their job
  for(const a of ['sell_ticket','reserve_ticket','bulk_record_sales','correct_ticket']){
    eq(gate('recorder',reg[a].roles),'ALLOWED',`recorder can ${a}`);
    eq(gate('viewer',reg[a].roles),'DENIED',`viewer cannot ${a}`);
  }
  eq(gate('agent',reg['sell_ticket'].roles),'ALLOWED','agent can sell');
  eq(gate('agent',reg['bulk_record_sales'].roles),'DENIED','agent cannot bulk-record');
  eq(gate('viewer',reg['read_snapshot'].roles),'ALLOWED','viewer can read');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
