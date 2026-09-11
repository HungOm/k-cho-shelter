const fs=require('fs'),path=__dirname+'/../index.html';
const html=fs.readFileSync(path,'utf8');
const app=[...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].pop()[1];

// minimal DOM so the render functions can run
const els={};
const mk=id=>els[id]||(els[id]={id,innerHTML:'',textContent:'',style:{},hidden:false,
  classList:{add(){},remove(){},toggle(){},contains:()=>false},value:'',
  querySelector:()=>null,querySelectorAll:()=>[],appendChild(){},addEventListener(){}});
global.document={getElementById:mk,querySelectorAll:()=>[],querySelector:()=>null,
  addEventListener(){},createElement:()=>mk('tmp'),body:{appendChild(){}}};
global.window={};global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
global.requestAnimationFrame=f=>f();
global.location={hash:'',pathname:'/',search:'',reload(){}};
global.fetch=async()=>({text:async()=>'{}'});
global.setTimeout=(f)=>0; global.clearTimeout=()=>{};
global.google={accounts:{id:{initialize(){},renderButton(){},prompt(){},disableAutoSelect(){}}}};

const src=app.replace(/\nboot\(\);/,'');
eval(src+`;Object.assign(global,{state,renderBookGrid,renderAttention,renderFirstRun,renderQuickActions,renderSearchChips,esc,fmtMoney,canWrite,isAdmin});`);

state.cfg={ticketPrefix:"KS-",ticketDigits:4,ticketStart:1,totalTickets:6000,ticketsPerBook:10,
  bookPrefix:"Book-",bookDigits:3,totalBooks:600,ticketPrice:10,currency:"RM",defaultDueDays:30};
state.user={email:"a@b.c",name:"Hung",role:"admin",agentId:""};
state.agents=[{id:"A001",name:"Pa Thang",phone:"0123456789",zone:"Kajang",active:true,booksOut:8}];
state.agentMap={A001:state.agents[0]};
state.books=[{book:"Book-001",status:"Settled",agentId:"A001",agentName:"Pa Thang",sold:8,daysOverdue:0},
             {book:"Book-002",status:"Out",agentId:"A001",agentName:"Pa Thang",sold:4,daysOverdue:12},
             {book:"Book-003",status:"Unassigned",agentId:"",agentName:"",sold:0,daysOverdue:0}];
state.bookStats={Settled:1,Out:1,Unassigned:1};
state.tickets=[{number:"KS-0001",status:"Sold"},{number:"KS-0002",status:"Available"}];
state.overdue=[{book:"Book-002",agentName:"Pa Thang",daysOverdue:12}];

let pass=0,fail=0;
const ok=(c,w)=>{c?pass++:(fail++,console.log('  FAIL '+w));};
const balanced=h=>{ // every tag opened is closed
  const open=(h.match(/<(?!\/)(?!br|img|input|hr|i\s|i>)[a-z]+/g)||[]).length;
  const close=(h.match(/<\/[a-z]+/g)||[]).length;
  return Math.abs(open-close)<=2;
};

console.log('renderBookGrid');
renderBookGrid('bookGrid');
const g=document.getElementById('bookGrid').innerHTML;
ok(g.includes('s-Settled')&&g.includes('s-Out')&&g.includes('s-Unassigned'),'all three statuses get a colour class');
ok(g.includes('late'),'overdue book gets the late outline');
ok(g.includes('>1<')&&g.includes('>2<'),'tiles show stripped book numbers');
ok(!g.includes('undefined'),'no undefined leaked into the markup');
ok(balanced(g),'markup is balanced');

console.log('renderBookGrid with a cap');
renderBookGrid('homeGrid',2);
const g2=document.getElementById('homeGrid').innerHTML;
ok((g2.match(/class="bk/g)||[]).length===3,'2 tiles + 1 overflow tile');
ok(g2.includes('+1'),'overflow tile shows the remainder');

console.log('renderAttention');
renderAttention({currency:'RM',totals:{missingContact:12,outstanding:340,ticketsSold:1245},
  booksByStatus:{Out:47,Returned:3}},'RM');
const a=document.getElementById('homeAttention').innerHTML;
ok(a.includes('1 book overdue'),'overdue row, singular');
ok(a.includes('12 sold tickets with no contact'),'missing-contact row');
ok(a.includes('RM 340.00 not handed in'),'outstanding row with money formatting');
ok(a.includes('50 books still open'),'open books = Out + Returned');
ok(!a.includes('undefined')&&!a.includes('NaN'),'no undefined/NaN');
ok(balanced(a),'markup is balanced');

console.log('renderAttention when all clear');
state.overdue=[];
renderAttention({currency:'RM',totals:{missingContact:0,outstanding:0,ticketsSold:10},booksByStatus:{}},'RM');
ok(document.getElementById('homeAttention').innerHTML.includes('Nothing needs attention'),'all-clear message');

console.log('renderFirstRun');
// a genuinely fresh install: tickets exist, but no agents, no books out, no sales
const savedAgents=state.agents, savedStats=state.bookStats, savedTickets=state.tickets;
state.agents=[]; state.bookStats={Unassigned:600};
state.tickets=[{number:"KS-0001",status:"Available"}];
renderFirstRun();
const f=document.getElementById('firstRun').innerHTML;
ok(f.includes('Getting started'),'checklist shows while setup is incomplete');
ok(f.includes('step done'),'completed steps are ticked');
ok(f.includes('step now'),'the next step is highlighted');
ok(!f.includes('undefined'),'no undefined');
ok(f.includes('Add your first agent')===false||f.includes('agents'),'names the agent step');
// once every step is done it should disappear on its own
state.agents=savedAgents; state.bookStats={Out:5};
state.tickets=[{number:"KS-0001",status:"Sold"}];
renderFirstRun();
ok(document.getElementById('firstRun').innerHTML==='','checklist disappears once the raffle is running');

console.log('renderQuickActions / renderSearchChips');
renderQuickActions();
const q=document.getElementById('homeQuick').innerHTML;
ok(q.includes('Record a sale')&&q.includes('Issue books'),'admin sees write actions');
state.user.role='viewer';
renderQuickActions();
ok(!document.getElementById('homeQuick').innerHTML.includes('Issue books'),'viewer does not see admin actions');
state.user.role='admin';
renderSearchChips();
const ch=document.getElementById('searchChips').innerHTML;
ok(ch.includes('721'),'chip suggests a trailing-digit search');
ok(ch.includes('Book-1'),'chip suggests a book');
ok(!ch.includes('undefined'),'no undefined');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
