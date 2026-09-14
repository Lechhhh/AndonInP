'use strict';
process.env.TZ='Europe/Warsaw';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),vm=require('node:vm');
const {Line}=require('../lib/line'),{Vault}=require('../lib/vault'),{HistoryDatabase,localDay}=require('../lib/history'),{validate}=require('../lib/validation');
const {label}=require('../public/stations');
const user={id:crypto.randomUUID(),name:'Test',role:'owner'},request=()=>({requestId:crypto.randomUUID()});
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'andon-merge-')),vault=new Vault(crypto.randomBytes(32)),history=new HistoryDatabase(path.join(dir,'history.sqlite'),vault),file=path.join(dir,'state.json');t.after(()=>history.close());let now=Date.now();const line=new Line(file,vault,()=>now,history);return {line,history,vault,file,setNow(value){now=value;},restart(){return new Line(file,vault,()=>now,history);}};}
test('Zmiana nocna: restart po północy zachowuje pracę, 24 h zatrzymuje dokładnie raz',t=>{
 const f=fixture(t),start=Date.parse('2026-09-13T23:00:00+02:00');f.setNow(start);f.line.change('shiftStart',request(),user,'panel');const shiftId=f.line.state.shiftId;
 f.setNow(start+2*3600000);const line=f.restart();assert.equal(line.state.shiftActive,true);assert.equal(line.state.shiftId,shiftId);
 f.setNow(start+24*3600000-1);line.tick();assert.equal(line.state.shiftActive,true);
 f.setNow(start+28*3600000);line.tick();assert.equal(line.state.shiftActive,false);assert.equal(line.state.shiftStopTime,start+24*3600000);assert.equal(line.state.shiftStart,start);assert.equal(line.state.shiftId,shiftId);
 line.tick();f.restart();const records=f.history.query(validate('historyQuery',{period:'day',date:localDay(start+24*3600000),category:'shift'})).rows.filter(r=>r.type==='shiftStop');assert.equal(records.length,1);assert.equal(records[0].at,start+24*3600000);assert(records[0].downSeconds>0);
});
test('Restart starej zmiany: zatrzymanie po 24 h jest trwałe i nie kasuje liczników',t=>{
 const f=fixture(t),start=Date.now();f.line.change('shiftStart',request(),user,'panel');const s=structuredClone(f.line.state);s.count=7;f.line.commit(s);
 f.setNow(start+3*86400000);const line=f.restart();assert.equal(line.state.count,7);assert.equal(line.state.shiftStopTime,f.line.state.shiftStart+86400000);assert.equal(line.state.shiftActive,false);assert.equal(f.restart().state.shiftActive,false);
});
test('Automatyczne zatrzymanie: błąd zapisu nie zmienia stanu w pamięci',t=>{
 const f=fixture(t);f.line.change('shiftStart',request(),user,'panel');f.setNow(f.line.state.shiftStart+86400000);const commit=f.history.commit;f.history.commit=()=>{throw Error('disk');};assert.throws(()=>f.line.tick(),/disk/);assert.equal(f.line.state.shiftActive,true);f.history.commit=commit;f.line.tick();assert.equal(f.line.state.shiftActive,false);
});
test('Nakładka: trwałe ustawienie, walidacja i historia bez zmiany naliczania przerw',t=>{
 const f=fixture(t);f.setNow(Date.parse('2026-09-13T07:59:00+02:00'));f.line.change('shiftStart',request(),user,'panel');f.setNow(Date.parse('2026-09-13T08:02:00+02:00'));const before=f.line.timing();const change=validate('setBreakOverlayDisabled',{disabled:true,...request()});f.line.change('setBreakOverlayDisabled',change,user,'panel');f.line.change('setBreakOverlayDisabled',change,user,'panel');
 assert.deepEqual(f.line.timing(),before);assert.equal(f.line.snapshot('tv',user).breakOverlayDisabled,true);assert.equal(f.restart().state.breakOverlayDisabled,true);assert.throws(()=>f.line.change('actionOK',{cycleId:f.line.state.cycleId,...request()},user,'y0'),/przerwy/);
 const rows=f.history.query(validate('historyQuery',{period:'day',date:'2026-09-13',category:'settings'})).rows;assert.equal(rows.length,1);assert.equal(rows[0].type,'setBreakOverlayDisabled');assert.throws(()=>validate('setBreakOverlayDisabled',{disabled:'false',...request()}));assert.throws(()=>validate('setBreakOverlayDisabled',{disabled:true,role:'owner',...request()}));
});
test('Oznaczenia X zachowują identyfikatory kont i archiwum',()=>{for(let i=0;i<5;i++)assert.equal(label('y'+i),'X'+i);assert.equal(label('Y2'),'X2');assert.equal(validate('view','y2'),'y2');assert.throws(()=>validate('view','x2'));});

test('Plan 8 sztuk: zatrzymanie przy 8/8, trwałość i brak podwójnego przestoju', t => {
 const f=fixture(t);f.setNow(Date.parse('2026-09-14T07:00:00+02:00'));
 f.line.change('adminSettings',{goal:8,time:8,...request()},user,'panel');f.line.change('shiftStart',request(),user,'panel');
 let last;
 for(let cycle=0;cycle<8;cycle++){
  f.setNow(f.line.state.cycleStart+65000);const cycleId=f.line.state.cycleId;
  for(const station of ['y0','y1','y2','y3','y4']){last={cycleId,...request()};f.line.change('actionOK',last,user,station);}
 }
 assert.equal(f.line.state.count,8);assert.equal(f.line.state.shiftActive,false);assert.equal(f.line.state.accDown,40);
 const stop=f.line.state.shiftStopTime;
 assert.equal(f.line.change('actionOK',last,user,'y4').ok,true);
 assert.throws(()=>f.line.change('actionOK',{cycleId:f.line.state.cycleId,...request()},user,'y0'),error=>error.code==='GOAL_REACHED');
 f.setNow(stop+3600000);const restored=f.restart();assert.equal(restored.state.count,8);assert.equal(restored.state.shiftStopTime,stop);assert.equal(restored.timing().downSec,40);
 const rows=f.history.query(validate('historyQuery',{period:'day',date:'2026-09-14',limit:100})).rows;
 assert.equal(rows.filter(row=>row.type==='cycle').length,8);assert.equal(rows.filter(row=>row.type==='shiftStop').length,1);
 assert.equal(rows.filter(row=>row.type==='cycle'||row.type==='shiftStop').reduce((sum,row)=>sum+(row.downSeconds||0),0),40);
 restored.change('shiftStart',request(),user,'panel');assert.equal(restored.state.count,0);assert.equal(restored.state.shiftActive,true);
});

test('Osiągnięcie planu: błąd zapisu nie zatwierdza ostatniej sztuki ani zatrzymania', t => {
 const f=fixture(t);f.setNow(Date.parse('2026-09-14T07:00:00+02:00'));
 f.line.change('adminSettings',{goal:1,time:60,...request()},user,'panel');f.line.change('shiftStart',request(),user,'panel');
 const cycleId=f.line.state.cycleId;
 for(const station of ['y0','y1','y2','y3'])f.line.change('actionOK',{cycleId,...request()},user,station);
 const commit=f.history.commit;f.history.commit=()=>{throw new Error('disk');};
 assert.throws(()=>f.line.change('actionOK',{cycleId,...request()},user,'y4'),/disk/);
 assert.equal(f.line.state.count,0);assert.equal(f.line.state.shiftActive,true);assert.equal(f.line.state.st.y4.r,false);
 f.history.commit=commit;f.line.change('actionOK',{cycleId,...request()},user,'y4');assert.equal(f.line.state.count,1);assert.equal(f.line.state.shiftActive,false);
});

test('Odprawa drugiej zmiany: blokada 14:00–14:05 i wznowienie o 14:05', t => {
 const f=fixture(t),at=time=>Date.parse('2026-09-14T'+time+':00+02:00');
 f.setNow(at('13:59'));f.line.change('shiftStart',request(),user,'panel');
 f.setNow(at('14:00'));assert.equal(f.line.timing().isBreak,true);
 assert.throws(()=>f.line.change('actionOK',{cycleId:f.line.state.cycleId,...request()},user,'y0'),/przerwy/);
 f.setNow(at('14:04'));assert.equal(f.line.timing().isBreak,true);assert.equal(f.line.timing().cycleNetMs,60000);
 f.setNow(at('14:05'));assert.equal(f.line.timing().isBreak,false);assert.equal(f.line.timing().cycleNetMs,60000);
 f.line.change('actionOK',{cycleId:f.line.state.cycleId,...request()},user,'y0');
 f.setNow(at('14:06'));assert.equal(f.line.timing().isBreak,false);assert.equal(f.line.timing().cycleNetMs,120000);
});

test('Audio awaryjne: trzy tony po błędzie MP3, głośność, brak powtórek i wyciszenie', async t => {
 const {JSDOM}=require('jsdom'),dom=new JSDOM('<button data-sound-test></button><button data-sound-mute></button><span data-sound-status></span><input data-sound-volume type="range" min="0" max="100">',{runScripts:'outside-only'}),w=dom.window;t.after(()=>w.close());
 let unavailable=true,master,created=0,stops=0;
 w.Audio=class {addEventListener(){}pause(){}play(){return unavailable?Promise.reject({name:'NotSupportedError'}):Promise.resolve();}};
 w.AudioContext=class {
  constructor(){this.state='running';this.currentTime=0;this.destination={};}
  resume(){return Promise.resolve();}
  createGain(){const node={gain:{value:0,setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};if(!master)master=node;return node;}
  createOscillator(){created++;return {frequency:{value:0},connect(){},disconnect(){},start(){},stop(){stops++;}};}
 };
 new vm.Script(fs.readFileSync(path.join(__dirname,'../public/support-sound.js'),'utf8')+';window.sound=SupportSound;').runInContext(dom.getInternalVMContext());
 const flush=()=>new Promise(r=>setImmediate(r)),state=s=>({st:{y0:{s}}}),button=w.document.querySelector('[data-sound-test]'),status=()=>w.document.querySelector('[data-sound-status]').textContent;
 w.sound.sync(state(false));button.click();await flush();assert.equal(created,3);assert.match(status(),/awaryjny aktywny/);
 const volume=w.document.querySelector('[data-sound-volume]');volume.value='40';volume.dispatchEvent(new w.Event('input'));assert.equal(master.gain.value,.4);
 w.sound.sync(state(true));await flush();assert.equal(created,6);w.sound.sync(state(true));assert.equal(created,6);
 w.document.querySelector('[data-sound-mute]').click();assert.equal(master.gain.value,0);assert(stops>=9);
 w.sound.sync(state(false));w.sound.sync(state(true));assert.equal(created,6);
 unavailable=false;button.click();await flush();assert.match(status(),/Dźwięk aktywny/);
 w.sound.reset();assert.equal(master.gain.value,0);assert.match(status(),/wyłączony/);
});
test('Audio: gest użytkownika, brak powtórek, blokada autoplay, wyciszenie i wylogowanie',async t=>{
 const {JSDOM}=require('jsdom'),dom=new JSDOM('<button data-sound-test></button><button data-sound-mute></button><span data-sound-status></span>',{runScripts:'outside-only'}),w=dom.window;t.after(()=>w.close());let instance,blocked=false,pending=null;
 w.Audio=class {constructor(src){this.src=src;this.calls=0;this.pauses=0;instance=this;}addEventListener(){}pause(){this.pauses++;}play(){this.calls++;if(blocked)return Promise.reject({name:'NotAllowedError'});if(pending)return pending;return Promise.resolve();}};
 new vm.Script(fs.readFileSync(path.join(__dirname,'../public/support-sound.js'),'utf8')+';window.sound=SupportSound;').runInContext(dom.getInternalVMContext());const button=w.document.querySelector('[data-sound-test]'),status=()=>w.document.querySelector('[data-sound-status]').textContent,flush=()=>new Promise(r=>setImmediate(r));
 const state=value=>({st:{y0:{s:value}}});w.sound.sync(state(true));assert.equal(instance,undefined);button.click();assert.equal(instance.calls,1);await flush();assert(status().includes('aktywny'));assert.equal(instance.muted,false);assert(instance.src.startsWith('/wssong.mp3?v='));
 w.sound.sync(state(true));assert.equal(instance.calls,1);w.sound.sync(state(false));w.sound.sync(state(true));await flush();assert.equal(instance.calls,2);
 blocked=true;w.sound.sync(state(false));w.sound.sync(state(true));await flush();assert(status().includes('zablokowała'));blocked=false;button.click();await flush();assert(status().includes('aktywny'));
 w.document.querySelector('[data-sound-mute]').click();const mutedCalls=instance.calls;w.sound.sync(state(false));w.sound.sync(state(true));await flush();assert.equal(instance.calls,mutedCalls);
 let resolve;pending=new Promise(r=>{resolve=r;});button.click();w.sound.reset();resolve();await flush();assert(status().includes('wyłączony'));assert.equal(button.textContent,'Włącz i sprawdź dźwięk');assert(instance.pauses>=2);
});
