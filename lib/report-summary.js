'use strict';
const {localDay}=require('./history');
const hour=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Warsaw',hour:'2-digit',hourCycle:'h23'});
const validTime=n=>Number.isFinite(n)&&n>=0;
const validTarget=n=>Number.isFinite(n)&&n>0;
const average=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
function median(sorted){const n=sorted.length;return n?n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2:null;}
// P90: nearest-rank; mała próba jest pokazana jawnie wraz z liczbą pomiarów.
const p90=sorted=>sorted.length?sorted[Math.ceil(sorted.length*.9)-1]:null;
function summarize(events,q,range){
 const stations=new Map(['y0','y1','y2','y3','y4'].map(station=>[station,{station,recordCount:0,times:[],targets:[],ratios:[],late:0,onTime:0}]));
 const buckets=new Map(),reasons=new Map();let measurements=0,cycles=0,support=0,onTime=0,timed=0,netSum=0,netCount=0,downSeconds=0,cycleTimed=0,cycleOnTime=0,cycleLate=0,unknownCycleTarget=0,invalidMeasurements=0;
 const makeBucket=(key,label)=>({key,label,cycles:0,cycleOnTime:0,cycleLate:0,cycleUnknown:0,support:0,downSeconds:0,measurements:0});
 if(q.period==='day')for(let h=0;h<24;h++){const key=String(h).padStart(2,'0');buckets.set(key,makeBucket(key,key+':00'));}
 else if(range.start){const date=new Date(range.start+'T12:00:00Z');while(date.toISOString().slice(0,10)<=range.end){const key=date.toISOString().slice(0,10);buckets.set(key,makeBucket(key,key.slice(8)+'.'+key.slice(5,7)));date.setUTCDate(date.getUTCDate()+1);}}
 for(const e of events){
  const bucket=e.at===null?null:buckets.get(q.period==='day'?hour.format(new Date(e.at)):localDay(e.at));
  if(e.type==='measurement'){
   measurements++;if(bucket)bucket.measurements++;const station=stations.get(e.station);if(station)station.recordCount++;
   if(validTime(e.netSeconds)){netSum+=e.netSeconds;netCount++;if(station)station.times.push(e.netSeconds);
    if(validTarget(e.targetSeconds)){const late=e.netSeconds>e.targetSeconds;timed++;if(!late)onTime++;if(station){station.targets.push(e.targetSeconds);station.ratios.push(e.netSeconds/e.targetSeconds*100);station[late?'late':'onTime']++;}}
   }else invalidMeasurements++;
  }
  if(e.type==='cycle'){
   cycles++;if(bucket)bucket.cycles++;
   if(validTime(e.netSeconds)&&validTarget(e.targetSeconds)){cycleTimed++;if(e.netSeconds<=e.targetSeconds){cycleOnTime++;if(bucket)bucket.cycleOnTime++;}else{cycleLate++;if(bucket)bucket.cycleLate++;}}
   else{unknownCycleTarget++;if(bucket)bucket.cycleUnknown++;}
  }
  if((e.type==='cycle'||e.type==='shiftStop')&&validTime(e.downSeconds)){downSeconds+=e.downSeconds;if(bucket)bucket.downSeconds+=e.downSeconds;}
  if(e.type==='callSupport'){support++;if(bucket)bucket.support++;const reason=String(e.details||'').split(' · ')[0]||'Nieokreślony powód';reasons.set(reason,(reasons.get(reason)||0)+1);}
 }
 const stationRows=[...stations.values()].map(s=>{s.times.sort((a,b)=>a-b);s.ratios.sort((a,b)=>a-b);const known=s.onTime+s.late;return {station:s.station,recordCount:s.recordCount,count:s.times.length,timed:known,unknown:s.recordCount-known,late:s.late,onTime:s.onTime,latePercent:known?100*s.late/known:null,onTimePercent:known?100*s.onTime/known:null,averageSeconds:average(s.times),medianSeconds:median(s.times),p90Seconds:p90(s.times),targetSeconds:average(s.targets),medianTaktPercent:median(s.ratios),p90TaktPercent:p90(s.ratios)};});
 let cumulative=0;const reasonRows=[...reasons].map(([label,count])=>({label,count})).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label,'pl')).map(r=>{const before=cumulative;cumulative+=r.count;return {...r,sharePercent:100*r.count/support,cumulativePercent:100*cumulative/support,priority:before<support*.8};});
 const ranking=stationRows.filter(s=>s.timed).sort((a,b)=>b.latePercent-a.latePercent||b.timed-a.timed||a.station.localeCompare(b.station));
 return {measurements,cycles,support,downSeconds,averageSeconds:netCount?netSum/netCount:null,onTimePercent:timed?100*onTime/timed:null,timedMeasurements:timed,unknownMeasurements:measurements-timed,invalidMeasurements,lateMeasurements:timed-onTime,cycleTimed,cycleOnTime,cycleLate,unknownCycleTarget,cycleOnTimePercent:cycleTimed?100*cycleOnTime/cycleTimed:null,buckets:[...buckets.values()],stations:stationRows,reasons:reasonRows,attentionStation:ranking.find(s=>s.late>0)?.station||null,scope:'period-all-stations'};
}
module.exports={summarize};
