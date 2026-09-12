/* Minimal in-memory stand-in for the Apps Script services the code touches. */
function makeSheet(name, headers, id){
  const data=[headers.slice()];
  const chain=new Proxy({},{get:()=>()=>chain});
  const sh={
    _data:data, getName:()=>name, setName:n=>{name=n;},
    getSheetId:()=>id, getMaxRows:()=>Math.max(data.length,1000),
    getMaxColumns:()=>headers.length, deleteColumns:()=>{}, deleteRows:(s,n)=>data.splice(s-1,n),
    setFrozenRows:()=>{}, autoResizeColumn:()=>{}, setColumnWidth:()=>{}, clear:()=>{data.length=1;},
    getConditionalFormatRules:()=>[], setConditionalFormatRules:()=>{},
    getLastRow:()=>{ let n=0; for(let i=0;i<data.length;i++) if(data[i] && data[i].some(c=>c!==''&&c!=null)) n=i+1; return n; },
    getLastColumn:()=>headers.length,
    appendRow:r=>{ const row=new Array(headers.length).fill(''); r.forEach((v,i)=>row[i]=v); data.push(row); },
    getRange:(r,c,nr=1,nc=1)=>({
      getValues:()=>{ const out=[]; for(let i=0;i<nr;i++){ const row=data[r-1+i]||new Array(headers.length).fill('');
                       out.push(row.slice(c-1,c-1+nc)); } return out; },
      setValues:v=>{ for(let i=0;i<v.length;i++){ if(!data[r-1+i]) data[r-1+i]=new Array(headers.length).fill('');
                       for(let j=0;j<v[i].length;j++) data[r-1+i][c-1+j]=v[i][j]; } return chain; },
      getValue:()=>{ const row=data[r-1]; return row?row[c-1]:''; },
      setValue:v=>{ if(!data[r-1]) data[r-1]=new Array(headers.length).fill(''); data[r-1][c-1]=v; return chain; },
      setFormula:()=>chain, setNumberFormat:()=>chain, setDataValidation:()=>chain,
      setFontWeight:()=>chain, setBackground:()=>chain, setFontColor:()=>chain, clearContent:()=>{
        for(let i=0;i<nr;i++) if(data[r-1+i]) for(let j=0;j<nc;j++) data[r-1+i][c-1+j]=''; }
    })
  };
  return sh;
}
const SHEETS={}; let nextId=1;
global.__mkSheet=(name,headers)=>{ SHEETS[name]=makeSheet(name,headers,nextId++); return SHEETS[name]; };
global.__sheets=SHEETS;
global.SpreadsheetApp={
  getActiveSpreadsheet:()=>({ getSheetByName:n=>SHEETS[n]||null, getSheets:()=>Object.values(SHEETS),
    insertSheet:n=>global.__mkSheet(n,[]), getId:()=>'mock', getSpreadsheetTimeZone:()=>'Asia/Kuala_Lumpur' }),
  newDataValidation:()=>({requireValueInList:()=>({build:()=>({})})}),
  newConditionalFormatRule:()=>{const b={whenNumberNotEqualTo:()=>b,setBackground:()=>b,setFontColor:()=>b,setRanges:()=>b,build:()=>({})};return b;},
  flush:()=>{}, getUi:()=>{throw new Error('no ui');}
};
const cache={};
global.CacheService={getScriptCache:()=>({
  get:k=>cache[k]||null,
  put:(k,v)=>{ if(String(v).length>100000) throw new Error('cache value too large'); cache[k]=v; },
  remove:k=>{delete cache[k];},
  getAll:ks=>{ const o={}; ks.forEach(k=>{ if(cache[k]!=null) o[k]=cache[k]; }); return o; },
  putAll:(obj)=>{ for(const k in obj){ if(String(obj[k]).length>100000) throw new Error('cache value too large'); cache[k]=obj[k]; } }
})};
global.__clearCache=()=>{ for(const k in cache) delete cache[k]; };
global.__cacheRaw=cache;
const props={};
global.PropertiesService={getScriptProperties:()=>({getProperty:k=>props[k]||null,setProperty:(k,v)=>{props[k]=v;}})};
global.__props=props;
global.LockService={getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})};
global.Utilities={ computeDigest:(a,t)=>Array.from(String(t)).map(c=>c.charCodeAt(0)),
  base64EncodeWebSafe:b=>Buffer.from(b).toString('base64url'),
  base64Encode:b=>Buffer.from(b).toString('base64'),
  getUuid:()=>'uuid', formatDate:(d,tz,f)=>d.toISOString(),
  DigestAlgorithm:{SHA_256:'sha256'} };
global.Logger={log:()=>{}};
global.ContentService={createTextOutput:t=>({setMimeType:()=>({getContent:()=>t}),getContent:()=>t}),MimeType:{JSON:'json'}};
global.UrlFetchApp={fetch:()=>{throw new Error('no network in tests');}};
global.ScriptApp={getProjectTriggers:()=>[],newTrigger:()=>({timeBased:()=>({atHour:()=>({everyDays:()=>({create:()=>{}})})})})};
global.DriveApp={};
global.MailApp={};
