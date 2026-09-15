'use strict';
const { randomUUID, createHash } = require('node:crypto');
const { STATIONS, ALL_STATIONS } = require('./accounts');
const stationConfig=require('../public/stations');
const {label:stationLabel}=stationConfig;
const MAX_SHIFT_MS=24*60*60*1000;
const { PublicError, denied } = require('./errors');
const { parseDate } = require('./validation');
const BREAKS = [
    [360,365,'ODPRAWA (ZMIANA 1)','groups'], [480,485,'PRZERWA ŚNIADANIOWA','coffee'],
    [600,630,'GŁÓWNA PRZERWA (Z1)','restaurant'], [750,755,'PRZERWA (Z1)','coffee'],
    [840,845,'ODPRAWA (ZMIANA 2)','groups'], [960,965,'PRZERWA (Z2)','coffee'],
    [1080,1110,'GŁÓWNA PRZERWA (Z2)','restaurant'], [1230,1235,'PRZERWA (Z2)','coffee']
];
function intervals(start, end) {
    const date = new Date(start); date.setHours(0,0,0,0); const out = [];
    for (let days = 0; date.getTime() <= end && days < 4000; days++, date.setDate(date.getDate()+1)) {
        for (const [a,b,name,icon] of BREAKS) {
            const from = new Date(date), to = new Date(date); from.setHours(0,a,0,0); to.setHours(0,b,0,0);
            if (to.getTime() > start && from.getTime() < end) out.push({ start:from.getTime(), end:to.getTime(), name, icon });
        }
    }
    return out;
}
function pausedMs(start, end) { return intervals(start,end).reduce((sum,b) => sum + Math.max(0,Math.min(end,b.end)-Math.max(start,b.start)),0); }
function deadline(start, duration) {
    let end = start + duration;
    for (let i=0;i<50;i++) { const next = start+duration+pausedMs(start,end); if(next===end)return end; end=next; }
    return end;
}
const log = (s,m,d='',type='info') => { s.logs.unshift({t:new Date().toLocaleTimeString('pl-PL'),at:new Date().toISOString(),m,d,type});s.logs=s.logs.slice(0,50); };
function initial() {
    const now=Date.now();
    return { schema:2, goal:15,netShiftMins:420,taktMins:28,count:0,assemblyGoal:15,assemblyNetShiftMins:420,assemblyTaktMins:28,assemblyCount:0,assemblyCycleStart:now,assemblyCycleId:randomUUID(),assemblyShiftActive:false,accDown:0,breakOverlayDisabled:false,isDown:false,isBreak:false,shiftActive:false,shiftStart:null,shiftStopTime:now,cycleStart:now,cycleId:randomUUID(),shiftId:randomUUID(),st:Object.fromEntries(ALL_STATIONS.map(id=>[id,{r:false,s:false,reason:null,supportUserId:null}])),logs:[],cycleTimes:[],planner:[],outbox:[],requests:[] };
}
class Line {
    constructor(file,vault,clock=Date.now,history=null) {
        this.file=file;this.vault=vault;this.clock=clock;this.history=history;
        const archived=history&&history.readState();
        const saved=archived||vault.read(file,'line',true);
        if(saved&&saved.historyDatabase)throw new Error('Brak bazy historii. Przywróć bazę z kopii.');
        this.state=saved ? {...initial(),...saved,schema:2}:initial();
        const s=this.state;
        if(saved&&!Number.isFinite(saved.assemblyCycleStart))s.assemblyCycleStart=s.cycleStart;
        if(saved&&typeof saved.assemblyCycleId!=='string')s.assemblyCycleId=randomUUID();
        if(saved&&typeof saved.assemblyShiftActive!=='boolean')s.assemblyShiftActive=s.shiftActive;
        s.st={...initial().st,...s.st};
        if (!Number.isInteger(s.goal)||s.goal<1||s.goal>10000||!Number.isFinite(s.netShiftMins)||s.netShiftMins<1||s.netShiftMins>1440||!Number.isFinite(s.cycleStart)||typeof s.shiftActive!=='boolean'||!s.st) throw new Error('Invalid production state.');
        if (s.cycleStart < this.clock()-3650*86400000 || s.cycleStart > this.clock()+60000) throw new Error('Invalid cycle timestamp.');
        for(const id of ALL_STATIONS)if(!s.st[id]||typeof s.st[id].r!=='boolean'||typeof s.st[id].s!=='boolean')throw new Error('Invalid station state.');
        for(const key of ['logs','cycleTimes','planner','outbox','requests'])if(!Array.isArray(s[key]))throw new Error('Invalid state collections.');
        if(typeof s.breakOverlayDisabled!=='boolean')throw new Error('Invalid overlay setting.');
        if(s.shiftActive&&(!Number.isFinite(s.shiftStart)||s.shiftStart>this.clock()+60000))throw new Error('Invalid shift start.');
        s.taktMins=s.netShiftMins/s.goal;s.assemblyGoal=Number.isInteger(s.assemblyGoal)?s.assemblyGoal:s.goal;s.assemblyNetShiftMins=Number.isFinite(s.assemblyNetShiftMins)?s.assemblyNetShiftMins:s.netShiftMins;s.assemblyTaktMins=s.assemblyNetShiftMins/s.assemblyGoal;s.assemblyCount=Number.isInteger(s.assemblyCount)?s.assemblyCount:0;s.assemblyCycleStart=Number.isFinite(s.assemblyCycleStart)?s.assemblyCycleStart:s.cycleStart;s.assemblyCycleId=typeof s.assemblyCycleId==='string'?s.assemblyCycleId:randomUUID();s.assemblyShiftActive=typeof s.assemblyShiftActive==='boolean'?s.assemblyShiftActive:s.shiftActive;
        if(history){history.bootstrap(s);const marker=vault.read(file,'line',true);if(!marker?.historyDatabase)vault.write(file,{schema:3,historyDatabase:true},'line');}else this.persist(s);
        this.expireShift();
    }
    expireShift() {
        const previous=this.state, at=previous.shiftStart+MAX_SHIFT_MS;
        if(!previous.shiftActive||this.clock()<at)return false;
        const s=structuredClone(previous),timing=this.timing(s,at);
        s.shiftActive=false;s.shiftStopTime=at;s.isDown=false;s.isBreak=false;s.breakStart=null;s.downStart=null;
        const details='Automatyczne zatrzymanie po 24 godzinach od rozpoczęcia zmiany.';
        log(s,'Zmiana zamknięta automatycznie',details);
        this.commit(s,[{id:randomUUID(),at,type:'shiftStop',operator:'System',downSeconds:timing.currentDown,details}]);
        return true;
    }
    persist(next,events=[]){if(this.history)this.history.commit(next,events);else this.vault.write(this.file,next,'line');}
    commit(next,events=[]){this.persist(next,events);this.state=next;}
    timing(s=this.state,now=this.clock()) {
        const at=s.shiftActive?now:(s.shiftStopTime||now), begin=s.cycleStart;
        const net=Math.max(0,at-begin-pausedMs(begin,at));
        const takt=s.taktMins*60000;
        const br=s.shiftActive?intervals(at,at+1).find(b=>b.start<=at&&b.end>at):null;
        const currentDown=Math.max(0,Math.floor((net-takt)/1000));
        return { serverTime:now,remainingSec:Math.max(0,Math.ceil((takt-net)/1000)),downSec:s.accDown+currentDown,currentDown,
            isDown:s.shiftActive&&currentDown>0,isBreak:Boolean(br),breakStart:br?Math.max(br.start,s.shiftStart||br.start):null,
            breakInfo:br?{active:true,name:br.name,icon:br.icon,left:Math.ceil((br.end-at)/1000)}:{active:false},target:deadline(begin,takt),cycleNetMs:net,cycleGrossMs:Math.max(0,at-begin) };
    }
    snapshot(view,user) {
        const s=this.state,isAssembly=view==='tv-assembly'||stationConfig.department(view)==='assembly',lane=isAssembly?{goal:s.assemblyGoal,netShiftMins:s.assemblyNetShiftMins,taktMins:s.assemblyTaktMins,count:s.assemblyCount,cycleStart:s.assemblyCycleStart,cycleId:s.assemblyCycleId,shiftActive:s.assemblyShiftActive}:{goal:s.goal,netShiftMins:s.netShiftMins,taktMins:s.taktMins,count:s.count,cycleStart:s.cycleStart,cycleId:s.cycleId,shiftActive:s.shiftActive},timingState={...s,...lane},t=this.timing(timingState),base={breakOverlayDisabled:s.breakOverlayDisabled,...lane,assemblyGoal:s.assemblyGoal,assemblyNetShiftMins:s.assemblyNetShiftMins,assemblyTaktMins:s.assemblyTaktMins,assemblyCount:s.assemblyCount,assemblyShiftActive:s.assemblyShiftActive,accDown:s.accDown,shiftStart:s.shiftStart,shiftStopTime:s.shiftStopTime,shiftId:s.shiftId,...t};
        const ids=ALL_STATIONS.includes(view)?[view]:view==='tv-electro'?stationConfig.departments.electro:view==='tv-assembly'?stationConfig.departments.assembly:STATIONS;
        base.st=Object.fromEntries(ids.map(id=>[id,{r:s.st[id].r,s:s.st[id].s,reason:s.st[id].reason||null,canCancel:!s.st[id].s||s.st[id].supportUserId===user.id||user.role!=='employee'}]));
        base.logs=view==='panel'||String(view).startsWith('tv')?s.logs.map(({t,m,d,type})=>({t,m,d,type})):[];
        base.cycleTimes=view==='panel'||String(view).startsWith('tv')?s.cycleTimes.map(({s,t,m,ts,netSeconds,grossSeconds})=>({s,t,m,ts,netSeconds,grossSeconds})):[];
        base.planner=view==='panel'?s.planner.map(({id,date,time,status})=>({id,date,time,status})):[];
        return base;
    }
    begin(s,reason) {
        const now=this.clock();s.count=0;s.assemblyCount=0;s.accDown=0;s.shiftActive=true;s.assemblyShiftActive=true;s.shiftStart=now;s.shiftStopTime=null;s.cycleStart=now;s.cycleId=randomUUID();s.assemblyCycleStart=now;s.assemblyCycleId=randomUUID();s.shiftId=randomUUID();s.cycleTimes=[];s.isDown=false;s.isBreak=false;s.breakStart=null;s.downStart=null;
        for(const id of ALL_STATIONS)s.st[id]={r:false,s:false,reason:null,supportUserId:null};
        log(s,reason,'Cel: '+s.goal+' szt.');
    }
    change(event,data,user,view) {
        this.expireShift();
        const s=structuredClone(this.state);
        const key=user.id+':'+event+':'+data.requestId;
        const fingerprint=createHash('sha256').update(JSON.stringify(data)).digest('hex');
        const seen=s.requests.find(r=>r.key===key);
        if(seen){if(seen.fingerprint!==fingerprint)throw new PublicError('CONFLICT','Identyfikator operacji został już użyty z innymi danymi.',409);return seen.result;}
        let result={ok:true};const now=this.clock();const timing=this.timing(s,now);
        if(event==='actionOK') {
            const isAssembly=stationConfig.department(view)==='assembly';
            const cycleStations=isAssembly?stationConfig.departments.assembly:stationConfig.departments.electro;
            const goalKey=isAssembly?'assemblyGoal':'goal',countKey=isAssembly?'assemblyCount':'count',cycleKey=isAssembly?'assemblyCycleId':'cycleId',startKey=isAssembly?'assemblyCycleStart':'cycleStart';
            const laneState=isAssembly?{...s,goal:s.assemblyGoal,count:s.assemblyCount,taktMins:s.assemblyTaktMins,netShiftMins:s.assemblyNetShiftMins,cycleStart:s.assemblyCycleStart,cycleId:s.assemblyCycleId}:s;
            const laneTiming=this.timing(laneState,now);
            if(s[countKey]>=s[goalKey])throw new PublicError('GOAL_REACHED','Plan działu został wykonany.',409);
            if(!(isAssembly?s.assemblyShiftActive:s.shiftActive)||laneTiming.isBreak)throw new PublicError('LINE_PAUSED','Nie można potwierdzić operacji podczas przerwy lub zatrzymanej zmiany.',409);
            if(data.cycleId!==s[cycleKey])throw new PublicError('STALE_CYCLE','Ten cykl został już zakończony. Odśwież dane.',409);
            if(s.st[view].r)throw new PublicError('ALREADY_CONFIRMED','Stanowisko potwierdziło już ten cykl.',409);
            s.st[view].r=true;const seconds=Math.floor(laneTiming.cycleNetMs/1000);
            s.cycleTimes.unshift({at:now,employeeId:user.id,s:stationLabel(view),t:s[countKey]+1,m:Math.floor(seconds/60)+'m '+seconds%60+'s',netSeconds:seconds,grossSeconds:Math.floor(laneTiming.cycleGrossMs/1000),ts:new Date(now).toLocaleTimeString('pl-PL')});s.cycleTimes=s.cycleTimes.slice(0,200);
            if(cycleStations.every(id=>s.st[id].r)){s[countKey]++;s.accDown+=laneTiming.currentDown;s[startKey]=now;s[cycleKey]=randomUUID();s.isDown=false;for(const id of cycleStations)s.st[id].r=false;log(s,'Cykl zamknięty '+(isAssembly?'Montaż':'Elektromontaż'),'Wykonano: '+s[countKey]+'/'+s[goalKey]);}
            if(s[countKey]>=s[goalKey]){if(isAssembly)s.assemblyShiftActive=false;else{s.shiftActive=false;s.shiftStopTime=now;}log(s,'Plan działu wykonany',isAssembly?'Montaż':'Elektromontaż');}if(!s.shiftActive&&!s.assemblyShiftActive){s.shiftStopTime=now;s.isBreak=false;s.breakStart=null;s.downStart=null;log(s,'Plany wykonane - zmiana zakończona','Elektromontaż: '+s.count+'/'+s.goal+' · Montaż: '+s.assemblyCount+'/'+s.assemblyGoal);}
        } else if(event==='callSupport') {
            if(s.st[view].s)throw new PublicError('ALREADY_OPEN','To stanowisko ma już otwarte wezwanie.',409);
            if(s.outbox.length>=1000)throw new PublicError('QUEUE_FULL','Kolejka powiadomień jest pełna. Zawiadom brygadzistę osobiście.',503);
            Object.assign(s.st[view],{s:true,reason:data.reason,supportUserId:user.id});
            s.outbox.push({id:randomUUID(),station:view,employeeId:user.id,reason:data.reason,comment:data.comment,attempts:0,nextTry:now,createdAt:now});
            log(s,'Wezwanie: '+stationLabel(view),data.reason+(data.comment?' | '+data.comment:''),'alert');result.notification='queued';
        } else if(event==='cancelSupport') {
            const station=s.st[view];
            if(station.s&&station.supportUserId!==user.id&&user.role==='employee')throw denied();
            Object.assign(station,{s:false,reason:null,supportUserId:null});log(s,'Anulowano wezwanie: '+stationLabel(view));
        } else if(event==='adminSettings') {
            if(s.shiftActive||s.assemblyShiftActive)throw new PublicError('ACTIVE_SHIFT','Zatrzymaj zmianę przed zmianą celu i taktu.',409);
            if(data.department==='assembly'){s.assemblyGoal=data.goal;s.assemblyNetShiftMins=data.time;s.assemblyTaktMins=data.time/data.goal;log(s,'Zmieniono parametry Montażu','Cel: '+s.assemblyGoal+' szt.');}else{s.goal=data.goal;s.netShiftMins=data.time;s.taktMins=data.time/data.goal;log(s,'Zmieniono parametry Elektromontażu','Cel: '+s.goal+' szt.');}
        } else if(event==='setBreakOverlayDisabled') {
            s.breakOverlayDisabled=data.disabled;
            log(s,data.disabled?'Wyłączono nakładkę przerwy':'Włączono nakładkę przerwy');
        } else if(event==='shiftStart') {
            if(s.shiftActive)throw new PublicError('ACTIVE_SHIFT','Zmiana Elektromontażu już trwa. Zatrzymaj ją przed rozpoczęciem nowej.',409);
            this.begin(s,'Zmiana rozpoczęta ręcznie');
        } else if(event==='shiftStop') {
            if(!s.shiftActive&&!s.assemblyShiftActive)throw new PublicError('STOPPED_SHIFT','Zmiana jest już zatrzymana.',409);
            s.shiftActive=false;s.assemblyShiftActive=false;s.shiftStopTime=now;log(s,'Zmiana zatrzymana','Wykonano: '+s.count+'/'+s.goal);
        } else if(event==='plannerAdd') {
            const at=parseDate(data.date,data.time);
            if(at===null||at<now||at>now+366*86400000)throw new PublicError('INVALID_DATE','Wybierz przyszły termin w ciągu najbliższego roku.');
            if(s.planner.length>=100)throw new PublicError('LIMIT','Usuń stare wpisy harmonogramu przed dodaniem następnych.');
            if(s.planner.some(e=>e.date===data.date&&e.time===data.time&&e.status==='pending'))throw new PublicError('DUPLICATE','Ten termin już istnieje.',409);
            s.planner.push({id:randomUUID(),date:data.date,time:data.time,status:'pending'});s.planner.sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));log(s,'Dodano termin rozpoczęcia',data.date+' '+data.time);
        } else if(event==='plannerRemove') {
            if(!s.planner.some(e=>e.id===data.id))throw new PublicError('NOT_FOUND','Nie znaleziono terminu.',404);
            s.planner=s.planner.filter(e=>e.id!==data.id);
        } else throw new PublicError('UNKNOWN_EVENT','Nieznana operacja.');
        s.requests.push({key,fingerprint,result});s.requests=s.requests.slice(-1000);const details=event==='setBreakOverlayDisabled'?(data.disabled?'Nakładka wyłączona; naliczanie przerw bez zmian.':'Nakładka włączona.'):event==='callSupport'?[data.reason,data.comment].filter(Boolean).join(' · '):event==='adminSettings'?'Cel: '+s.goal+' · Czas netto: '+s.netShiftMins+' min':event==='plannerAdd'?data.date+' '+data.time:event==='plannerRemove'?(this.state.planner.find(e=>e.id===data.id)?.date||'')+' '+(this.state.planner.find(e=>e.id===data.id)?.time||''):'';
        const records=[{id:randomUUID(),at:now,type:event==='actionOK'?'measurement':event,station:ALL_STATIONS.includes(view)?view:null,operator:user.name||'System',details,...(event==='actionOK'?{netSeconds:timing.cycleNetMs/1000,grossSeconds:timing.cycleGrossMs/1000,targetSeconds:this.state.taktMins*60,cycleNumber:this.state.count+1}:{}),...(event==='shiftStop'?{downSeconds:timing.currentDown}:{})}];
        if(event==='actionOK'&&s.count>this.state.count)records.push({id:randomUUID(),at:now,type:'cycle',operator:'System',cycleNumber:s.count,netSeconds:timing.cycleNetMs/1000,grossSeconds:timing.cycleGrossMs/1000,targetSeconds:this.state.taktMins*60,downSeconds:timing.currentDown,details:'Ukończono cykl na wszystkich stanowiskach.'});
        if(event==='actionOK'&&this.state.shiftActive&&!s.shiftActive)records.push({id:randomUUID(),at:now,type:'shiftStop',operator:'System',downSeconds:0,details:'Plan wykonany: '+s.count+'/'+s.goal+'. Zmiana zakończona automatycznie.'});
        this.commit(s,records);return result;
    }
    tick() {
        this.expireShift();
        const s=structuredClone(this.state),now=this.clock();let changed=false;
        for(const e of s.planner){if(e.status!=='pending')continue;const at=parseDate(e.date,e.time);if(at===null){e.status='invalid';changed=true;continue;}if(now>=at){if(now-at>3600000)e.status='missed';else if(s.shiftActive){e.status='conflict';log(s,'Pominięto start: zmiana już trwa',e.date+' '+e.time,'alert');}else{this.begin(s,'Automatyczny start zmiany');e.status='started';}changed=true;}}
        const t=this.timing(s,now);
        if(s.isDown!==t.isDown||s.isBreak!==t.isBreak){if(t.isDown&&!s.isDown)log(s,'Czas taktu przekroczony','','alert');s.isDown=t.isDown;s.isBreak=t.isBreak;changed=true;}
        if(changed){const records=[];const record=(type,details='')=>records.push({id:randomUUID(),at:now,type,operator:'System',details});
         if(s.shiftId!==this.state.shiftId)record('shiftStart','Automatyczny start z harmonogramu.');
         if(s.isBreak!==this.state.isBreak)record(s.isBreak?'breakStart':'breakEnd',t.breakInfo.name||'');
         if(s.isDown!==this.state.isDown)record(s.isDown?'downStart':'downEnd');
         for(const e of s.planner){const before=this.state.planner.find(x=>x.id===e.id);if(before&&before.status!==e.status)record('plannerStatus',e.date+' '+e.time+' · '+({started:'uruchomiono',conflict:'pominięto: zmiana trwa',missed:'termin minął',invalid:'nieprawidłowy termin'}[e.status]||e.status));}
         this.commit(s,records);
        }
    }
    finishNotification(id,success) {
        const s=structuredClone(this.state),entry=s.outbox.find(e=>e.id===id);if(!entry)return;
        if(success)s.outbox=s.outbox.filter(e=>e.id!==id);
        else{entry.attempts++;entry.nextTry=this.clock()+Math.min(3600000,30000*2**Math.min(entry.attempts,7));}
        this.commit(s,[{id:randomUUID(),at:this.clock(),type:success?'notificationSent':'notificationRetry',station:entry.station,operator:'System',details:success?'Dostarczono do skonfigurowanego odbiorcy.':'Nie dostarczono. Zaplanowano ponowienie.'}]);
    }
}
module.exports={Line,pausedMs,deadline};
