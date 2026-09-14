'use strict';
const {DatabaseSync}=require('node:sqlite');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const {PublicError}=require('./errors');
const TZ='Europe/Warsaw';
const dateFmt=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'});
const hourFmt=new Intl.DateTimeFormat('en-GB',{timeZone:TZ,hour:'2-digit',hourCycle:'h23'});
const localDay=at=>dateFmt.format(new Date(at));
const iso=d=>d.toISOString().slice(0,10);
function periodKeys(date){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return {day:date,week:iso(d),month:date.slice(0,7)};}
function rangeFor(q){if(q.period==='undated')return {start:null,end:null,key:'undated',label:'Import bez pełnej daty'};const keys=periodKeys(q.date),d=new Date(q.date+'T12:00:00Z');let start=q.date,end=q.date;if(q.period==='week'){start=keys.week;const e=new Date(start+'T12:00:00Z');e.setUTCDate(e.getUTCDate()+6);end=iso(e);}if(q.period==='month'){start=keys.month+'-01';end=iso(new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0,12)));}return {start,end,key:keys[q.period],label:start===end?start:start+' — '+end};}
const TYPES={setBreakOverlayDisabled:['settings','Widoczność nakładki przerwy'],measurement:['measurement','Potwierdzenie stanowiska'],cycle:['cycle','Zamknięcie cyklu'],shiftStart:['shift','Start zmiany'],shiftStop:['shift','Zatrzymanie zmiany'],callSupport:['support','Wezwanie wsparcia'],cancelSupport:['support','Anulowanie wsparcia'],adminSettings:['settings','Zmiana parametrów'],plannerAdd:['planner','Dodanie terminu'],plannerRemove:['planner','Usunięcie terminu'],plannerStatus:['planner','Wynik harmonogramu'],breakStart:['break','Początek przerwy'],breakEnd:['break','Koniec przerwy'],downStart:['downtime','Przekroczenie taktu'],downEnd:['downtime','Koniec przekroczenia taktu'],notificationSent:['notification','Wysłano powiadomienie'],notificationRetry:['notification','Ponowienie powiadomienia'],legacy:['legacy','Zaimportowane zdarzenie']};
const safeRow=r=>{const {id,at,type,station,operator,details,netSeconds,grossSeconds,targetSeconds,cycleNumber,downSeconds,legacyTime}=r;return {id,at:Number.isFinite(at)?at:null,type,category:(TYPES[type]||TYPES.legacy)[0],label:(TYPES[type]||TYPES.legacy)[1],station:station||null,operator:operator||'System',details:details||'',netSeconds:netSeconds??null,grossSeconds:grossSeconds??null,targetSeconds:targetSeconds??null,cycleNumber:cycleNumber??null,downSeconds:downSeconds??null,legacyTime:legacyTime||null};};
class HistoryDatabase{
 constructor(file,vault,{readOnly=false}={}){this.file=file;this.vault=vault;this.cache=new Map();fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});this.db=new DatabaseSync(file,{readOnly,timeout:5000,enableForeignKeyConstraints:true,allowExtension:false});try{
  if(!readOnly)this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');this.db.exec('PRAGMA trusted_schema=OFF;');
  const version=this.db.prepare('PRAGMA user_version').get().user_version;if((readOnly&&version!==1)||(version!==0&&version!==1))throw new Error('Unsupported history database version.');
  if(!readOnly)this.db.exec(`CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL) STRICT;
   CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,day_key TEXT NOT NULL,week_key TEXT NOT NULL,month_key TEXT NOT NULL,category_key TEXT NOT NULL,station_key TEXT NOT NULL,payload TEXT NOT NULL) STRICT;
   CREATE INDEX IF NOT EXISTS events_day ON events(day_key,seq);CREATE INDEX IF NOT EXISTS events_week ON events(week_key,seq);CREATE INDEX IF NOT EXISTS events_month ON events(month_key,seq);PRAGMA user_version=1;`);
  this.putState=this.db.prepare('INSERT INTO state(id,payload) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload');
  this.putEvent=this.db.prepare('INSERT INTO events(id,day_key,week_key,month_key,category_key,station_key,payload) VALUES(?,?,?,?,?,?,?)');
  this.readState();
 }catch(e){this.db.close();throw e;}}
 index(kind,value){return this.vault.lookup('history:'+kind+':'+value);}
 readState(){const row=this.db.prepare('SELECT payload FROM state WHERE id=1').get();return row?this.vault.open(row.payload,'history-state'):null;}
 writeEvent(event){const row=safeRow({...event,id:event.id||randomUUID()});const keys=row.at===null?{day:'undated',week:'undated',month:'undated'}:periodKeys(localDay(row.at));this.putEvent.run(row.id,this.index('day',keys.day),this.index('week',keys.week),this.index('month',keys.month),this.index('category',row.category),this.index('station',row.station||''),this.vault.seal(row,'history-event:'+row.id));}
 commit(state,events=[]){this.db.exec('BEGIN IMMEDIATE');try{for(const event of events)this.writeEvent(event);this.putState.run(this.vault.seal(state,'history-state'));this.db.exec('COMMIT');this.cache.clear();}catch(e){this.db.exec('ROLLBACK');throw e;}}
 bootstrap(state){if(this.readState())return;const events=[];for(const c of [...state.cycleTimes].reverse()){
  const parsed=typeof c.at==='number'?c.at:Date.parse(c.at||'');const m=/(\d+)m\s*(\d+)s/.exec(c.m||'');events.push({id:randomUUID(),at:Number.isFinite(parsed)?parsed:null,type:'measurement',station:String(c.s||'').toLowerCase(),operator:'Import — wykonawca nieznany',netSeconds:Number.isFinite(c.netSeconds)?c.netSeconds:m?Number(m[1])*60+Number(m[2]):null,grossSeconds:c.grossSeconds??null,targetSeconds:null,cycleNumber:c.t??null,legacyTime:c.ts||null,details:'Import pomiaru z wcześniejszej wersji.'});
 }for(const l of [...state.logs].reverse()){const at=Date.parse(l.at||'');events.push({id:randomUUID(),at:Number.isFinite(at)?at:null,type:'legacy',operator:'Import',legacyTime:l.t||null,details:[l.m,l.d].filter(Boolean).join(' · ')});}events.sort((a,b)=>(a.at??0)-(b.at??0));this.commit(state,events);}
 where(q,watermark){const range=rangeFor(q),period=q.period==='undated'?'day':q.period;const fields={day:'day_key',week:'week_key',month:'month_key'};const clauses=[fields[period]+' = ?','seq <= ?'],args=[this.index(period,range.key),watermark];if(q.station!=='all'){clauses.push('station_key = ?');args.push(this.index('station',q.station));}if(q.category!=='all'){clauses.push('category_key = ?');args.push(this.index('category',q.category));}return {sql:clauses.join(' AND '),args,range};}
 maxSeq(){return this.db.prepare('SELECT COALESCE(MAX(seq),0) AS n FROM events').get().n;}
 query(q,includeSummary=true){const watermark=q.watermark??this.maxSeq(),{sql,args,range}=this.where(q,watermark);const total=this.db.prepare('SELECT COUNT(*) AS n FROM events WHERE '+sql).get(...args).n;const order=q.order==='asc'?'ASC':'DESC';const rows=this.db.prepare('SELECT id,payload FROM events WHERE '+sql+' ORDER BY seq '+order+' LIMIT ? OFFSET ?').all(...args,q.limit,(q.page-1)*q.limit).map(row=>safeRow(this.vault.open(row.payload,'history-event:'+row.id)));
  const result={ok:true,rows,total,page:q.page,limit:q.limit,watermark,range,undated:this.db.prepare('SELECT COUNT(*) AS n FROM events WHERE day_key=?').get(this.index('day','undated')).n};
  if(includeSummary){const analysis=this.where({...q,station:'all',category:'all'},watermark);const key=JSON.stringify([analysis.sql,analysis.args,q.period]);if(!this.cache.has(key)){const count=this.db.prepare('SELECT COUNT(*) AS n FROM events WHERE '+analysis.sql).get(...analysis.args).n;if(count>100000)throw new PublicError('REPORT_TOO_LARGE','Analiza okresu obejmuje ponad 100 000 zdarzeń. Wybierz krótszy okres.',400);if(this.cache.size>=16)this.cache.delete(this.cache.keys().next().value);this.cache.set(key,this.summarize(q,analysis.sql,analysis.args,range));}result.summary=this.cache.get(key);}return result;
 }
 summarize(q,sql,args,range){const vault=this.vault,rows=this.db.prepare('SELECT id,payload FROM events WHERE '+sql+' ORDER BY seq').iterate(...args);function* decrypted(){for(const row of rows)yield vault.open(row.payload,'history-event:'+row.id);}return require('./report-summary').summarize(decrypted(),q,range);}

 verify(){if(this.db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Database integrity check failed.');if(!this.readState())throw new Error('Missing history state.');for(const r of this.db.prepare('SELECT id,payload FROM events').iterate())this.vault.open(r.payload,'history-event:'+r.id);}
 close(){this.db.close();}
 checkpoint(){this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');}
}
module.exports={HistoryDatabase,periodKeys,rangeFor,localDay,TYPES};
