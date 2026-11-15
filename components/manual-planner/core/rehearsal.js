/** SunToSignal mission rehearsal. All units: hours, W, Wh, Mbit/s, decimal MB.
 * Geometry is inherited unchanged from the supplied LOLA/DE421 model.
 * One non-preemptive activity creates its file only after successful completion.
 */
import {computeMission, MISSION_DEFAULTS, dispatchEnergy} from './legacy-mission.js';
export const DEFAULTS=Object.freeze({...MISSION_DEFAULTS,
 siteId:'ridge-crest', startUTC:'2026-11-18T00:00:00Z', durationHours:24, stepMinutes:5,
 areaM2:1.2, batteryKWh:2, initialSocPct:24, reservePct:20, loadW:60,
 scienceMinutes:30, scienceW:180, dataMB:100, deadlineHours:24,
 taskEnergyKWh:0, energyDeadlineHours:24, dataTargetGB:0, dataDeadlineHours:24,
 payloadW:0, payloadDurationHours:0, payloadStartHours:0,
});
export const MODEL_VERSION='SunToSignal 1.0 · single-activity rehearsal';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const addWindow=(a,t0,t1)=>{if(t1-t0<1e-10)return;const p=a.at(-1);if(p&&Math.abs(p[1]-t0)<1e-7)p[1]=t1;else a.push([t0,t1]);};
const total=a=>a.reduce((n,[x,y])=>n+y-x,0);
export function normalize(input={}){
 const s={...DEFAULTS,...input};
 const limits={durationHours:[1,168],stepMinutes:[1,30],scienceMinutes:[1,240],scienceW:[0,2000],dataMB:[.01,100000],deadlineHours:[.1,168],batteryKWh:[.1,100],areaM2:[.1,100],loadW:[0,3000],heightM:[.1,30]};
 for(const [k,[a,b]]of Object.entries(limits))if(typeof s[k]!=='number'||!Number.isFinite(s[k])||s[k]<a||s[k]>b)throw new RangeError(`${k} must be between ${a} and ${b}.`);
 if(s.deadlineHours>s.durationHours)throw new RangeError('The return deadline must fall inside the evaluated mission.');
 if(s.scienceMinutes/60>s.durationHours)throw new RangeError('The measurement must fit inside the evaluated mission.');
 return s;
}
export function environment(bundle,input={}){
 const s=normalize(input);
 // The inherited model is used only for geometry, disc shading and link budget.
 const e=computeMission(bundle,{...s,taskEnergyKWh:0,dataTargetGB:0,payloadW:0,
  energyDeadlineHours:s.durationHours,dataDeadlineHours:s.durationHours});
 return e;
}
function interpolate(arr,h){
 const n=arr.length,dt=arr[1].elapsedHours-arr[0].elapsedHours;
 const i=clamp(Math.floor(h/dt),0,n-2),a=arr[i],b=arr[i+1],f=clamp((h-a.elapsedHours)/(b.elapsedHours-a.elapsedHours),0,1);
 const p={...a,elapsedHours:h};
 for(const k of ['powerW','sunElDeg','earthElDeg','horizonDeg','earthHorizonDeg','stationHorizonDeg','stationElDeg','stationClearanceDeg','groundElevationDeg','rateBps','maxRateMarginDb','earthFraction','sunFraction','earthClearanceDeg','sunAngularRadiusDeg','irradianceWm2','incidence','earthDistanceKm'])p[k]=a[k]+(b[k]-a[k])*f;
 for(const k of ['sunAzDeg','earthAzDeg','stationAzDeg'])p[k]=(a[k]+(((b[k]-a[k]+540)%360)-180)*f+360)%360;
 return p;
}
export function simulate(env,input={},forcedStart=null,compact=false){
 const s=normalize({...env.settings,...input}),duration=s.durationHours;
 const cap=s.batteryKWh*1000, reserve=cap*s.reservePct/100;
 const initial=cap*s.initialSocPct/100,scienceH=s.scienceMinutes/60;
 // Conservative readiness: enough stored energy to finish the whole activity
 // including housekeeping, even if solar generation disappears at task start.
 const readyWh=reserve+(s.loadW+s.scienceW)*scienceH/s.dischargeEfficiency;
 const radioW=s.txPowerW/s.amplifierEfficiency+s.radioOverheadW;
 let store=initial,t=0,scienceStart=null,scienceEnd=null,complete=null,firstTx=null;
 let generated=0,delivered=0,harvest=0,loadWh=0,served=0,unserved=0,spill=0,chargeLoss=0,dischargeLoss=0;
 let minStore=store,minBeforeReturn=store,firstReserve=store<reserve-1e-7?0:null,firstOutage=null;
 let readyAt=null,failedTask=false,txHours=0,byDeadline=0;
 const samples=[], events=[{hour:0,type:'landing',title:'Landed',detail:'The mission clock starts. Initial battery charge is included.'}], txWindows=[],scienceWindows=[],contactWindows=[];
 const isReady=()=>store>=readyWh-1e-7;
 const phaseNow=()=>complete!==null?'complete':failedTask?'incomplete':scienceEnd!==null?'waiting_contact':scienceStart!==null?'science':'charging';
 const snapshot=(hour,p,tx=false)=>{
  if(compact)return;
  const available=p.stationClearanceDeg>0&&p.groundElevationDeg>s.earthMaskDeg;
  samples.push({...p,utc:new Date(Date.parse(s.startUTC)+hour*3600000).toISOString(),elapsedHours:hour,
   socPct:cap?store/cap*100:0,storedKWh:store/1000,powerW:p.powerW,
   loadW:s.loadW+((scienceStart!==null&&scienceEnd===null&&!failedTask)?s.scienceW:0)+(tx?radioW:0),
   actualTxMbps:tx?p.rateBps*s.protocolEfficiency/1e6:0,linkAvailable:available?1:0,
   generatedMB:generated/8e6,deliveredMB:delivered/8e6,pendingMB:Math.max(0,(generated-delivered)/8e6),
   cumulativeEnergyKWh:harvest/1000,scienceProgress:scienceEnd!==null?1:scienceStart===null?0:clamp((hour-scienceStart)/scienceH,0,1),
   phase:tx?'transmitting':phaseNow(),radioPowerW:tx?radioW:0});
 };
 snapshot(0,interpolate(env.samples,0));
 const event=(hour,type,title,detail)=>events.push({hour,type,title,detail});
 let iterations=0;
 while(t<duration-1e-9){
  if(++iterations>duration*2000+20000)throw new Error('Mission integration exceeded its safe iteration limit.');
  if(readyAt===null&&isReady()){readyAt=t;event(t,'ready','Energy ready', 'Stored energy can support the entire measurement plus housekeeping and preserve reserve, assuming no solar input.');}
  if(scienceStart===null&&!failedTask){
   if(forcedStart===null&&isReady()&&t+scienceH<=duration+1e-8){scienceStart=t;event(t,'science','Measurement starts','Science load is now included in the electrical budget.');}
   else if(forcedStart!==null&&t>=forcedStart-1e-8){
    if(isReady()&&t+scienceH<=duration+1e-8){scienceStart=t;event(t,'science','Measurement starts','A tested scheduled start; the same readiness policy applies.');}
    else {failedTask=true;event(t,'limited','Scheduled start unavailable','Insufficient stored energy at this tested start time.');}
   }
  }
  if(scienceStart!==null&&scienceEnd===null&&!failedTask&&t>=scienceStart+scienceH-1e-8){
   scienceEnd=t;generated=s.dataMB*8e6;event(t,'data','Science data created',`${s.dataMB} MB is now available for downlink.`);
  }
  let dt=Math.min(1/60,duration-t); // one-minute mission dispatch; geometry sampled separately
  if(scienceStart!==null&&scienceEnd===null&&!failedTask)dt=Math.min(dt,scienceStart+scienceH-t);
  if(forcedStart!==null&&scienceStart===null&&!failedTask&&forcedStart>t+1e-9)dt=Math.min(dt,forcedStart-t);
  if(t<s.deadlineHours&&t+dt>s.deadlineHours)dt=s.deadlineHours-t;
  // Split at linearly interpolated station/lunar-horizon contacts within the step.
  let a=interpolate(env.samples,t),b=interpolate(env.samples,t+dt);
  for(const [k,threshold]of [['stationClearanceDeg',0],['groundElevationDeg',s.earthMaskDeg]]){
   const x=a[k]-threshold,y=b[k]-threshold;if(x*y<0){const edge=-x/(y-x)*dt;if(edge>1e-7)dt=Math.min(dt,edge);}
  }
  let p=interpolate(env.samples,t+dt/2),pv=p.powerW;
  const scienceActive=scienceStart!==null&&scienceEnd===null&&!failedTask;
  const base=s.loadW+(scienceActive?s.scienceW:0);
  if(scienceStart===null&&!failedTask&&!isReady()&&pv>base){const h=(readyWh-store)/((pv-base)*s.chargeEfficiency);if(h>1e-7&&h<dt)dt=h;}
  // Recompute midpoint after an edge split. This is a documented approximation.
  p=interpolate(env.samples,t+dt/2);pv=p.powerW;
  const link=p.stationClearanceDeg>0&&p.groundElevationDeg>s.earthMaskDeg;
  let tx=link&&generated>delivered+1e-3&&store>=reserve-1e-7;
  const rate=p.rateBps*s.protocolEfficiency;
  if(tx&&pv<base+radioW){const usable=(store-reserve)*s.dischargeEfficiency/(base+radioW-pv);
   if(usable<1e-7)tx=false;else dt=Math.min(dt,usable);}
  if(tx)dt=Math.min(dt,(generated-delivered)/(rate*3600));
  if(dt<1e-10){t+=1e-8;continue;}
  const load=base+(tx?radioW:0),before=store;
  const e=dispatchEnergy(store,pv,load,dt,s);store=e.storeWh;
  harvest+=pv*dt;loadWh+=load*dt;served+=e.servedWh;unserved+=e.unservedWh;spill+=e.spillWh;chargeLoss+=e.chargeLossWh;dischargeLoss+=e.dischargeLossWh;
  if(link)addWindow(contactWindows,t,t+dt);
  if(scienceActive)addWindow(scienceWindows,t,t+dt);
  if(firstReserve===null&&store<reserve-1e-7){firstReserve=t+(before-reserve)*s.dischargeEfficiency/Math.max(1e-9,load-pv);event(firstReserve,'reserve','Battery reserve crossed','The selected reserve is no longer maintained.');}
  if(e.unservedWh>1e-7){if(firstOutage===null){firstOutage=t;event(t,'limited','Load cannot be supplied','Available power and battery energy no longer cover housekeeping.');}if(scienceActive)failedTask=true;}
  if(tx){
   if(firstTx===null){firstTx=t;event(t,'transmit','Transmission begins','Data exists, the station is accessible, and the radio has electrical power.');}
   delivered=Math.min(generated,delivered+rate*dt*3600);txHours+=dt;addWindow(txWindows,t,t+dt);
   if(delivered>=generated-1e-3&&complete===null){complete=t+dt;event(complete,'complete','Science result returned','All required data has been downlinked under the stated link assumptions.');}
  }
  minStore=Math.min(minStore,store);if(complete===null||t<complete)minBeforeReturn=Math.min(minBeforeReturn,store);
  t+=dt;if(t<=s.deadlineHours+1e-7)byDeadline=delivered;
  snapshot(t,interpolate(env.samples,t),tx);
 }
 // A measurement ending exactly at the boundary produces data but has no later contact time.
 if(scienceStart!==null&&scienceEnd===null&&!failedTask&&duration>=scienceStart+scienceH-1e-7){scienceEnd=duration;generated=s.dataMB*8e6;}
 const dataOK=complete!==null&&complete<=s.deadlineHours+1e-7;
 const reserveUntilReturn=(minBeforeReturn>=reserve-1e-5)&&(firstOutage===null||complete!==null&&firstOutage>complete);
 const feasible=dataOK&&reserveUntilReturn&&!failedTask;
 let reason='The measurement and its data return finish before the selected deadline.';
 let cause='complete';
 if(scienceEnd===null){cause='energy';reason=readyWh>cap?'The battery cannot hold the conservative activity-start energy plus reserve.':'The measurement cannot finish with the selected stored-energy requirement.';}
 else if(!dataOK){cause=total(contactWindows)<1e-8?'contact':txHours===0?'power':'deadline';reason=cause==='contact'?'No selected ground-station contact occurs in this evaluated period.':cause==='power'?'Contact exists, but the stored energy available above reserve cannot power the downlink.':'The complete file is not returned before the selected deadline.';}
 else if(!reserveUntilReturn){cause='reserve';reason='The result is returned, but battery reserve is violated before completion.';}
 const site={id:env.site.id,name:env.site.name,latitude_deg:env.site.latitude_deg,longitude_deg:env.site.longitude_deg,ground_elevation_m:env.site.ground_elevation_m,slope_deg:env.site.slope_deg};
 return {settings:s,site,horizon:env.horizon,antennaHorizon:env.antennaHorizon,samples,events,
  windows:{sun:env.windows.sun,link:contactWindows,transmitting:txWindows,science:scienceWindows},
  metrics:{feasible,cause,reason,energyKWh:harvest/1000,loadKWh:loadWh/1000,unservedKWh:unserved/1000,
   spillKWh:spill/1000,chargeLossKWh:chargeLoss/1000,dischargeLossKWh:dischargeLoss/1000,
   energyBalanceErrorWh:harvest+initial-served-store-spill-chargeLoss-dischargeLoss,
   finalSocPct:store/cap*100,minSocPct:minStore/cap*100,readyHour:readyAt,scienceStartHour:scienceStart,scienceEndHour:scienceEnd,
   firstTxHour:firstTx,completeHour:complete,deadlineMarginHours:complete===null?null:s.deadlineHours-complete,
   firstReserveHour:firstReserve,firstOutageHour:firstOutage,transmissionHours:txHours,contactHours:total(contactWindows),
   generatedMB:generated/8e6,deliveredMB:delivered/8e6,deliveredByDeadlineMB:byDeadline/8e6,
   sunlitHours:env.metrics.sunlitHours,requiredStartWh:readyWh,model:MODEL_VERSION},
  assumptions:['One fixed lander, one non-preemptive science activity, then a single resumable downlink.',
   'Conservative start policy: stored energy alone must support the activity plus housekeeping above reserve. This is not an optimal activity scheduler.',
   'Science data is created only when the measurement finishes. No downlink before data exists.',
   'Five-minute geometry and one-minute dispatch by default; interpolated horizon/contact edges. No operational time guarantee.',
   'Prepared LOLA terrain rays to 80 km; measured local display grid is 20 m. No small-scale hazard certification.',
   'Ground station availability is geometric, not a reservation. Ideal adaptive radio rate; no weather, scheduling or light-time.',
   'Battery reserve is protected for the radio, not for mandatory housekeeping. Thermal, dust, degradation and battery power limits are not modeled.'],
  provenance:env.provenance};
}
export function evaluate(bundle,s){const e=environment(bundle,s);return simulate(e,s);}
export function latestStart(bundle,s,stepMinutes=15){
 const env=environment(bundle,s),settings=normalize(s),last=Math.floor((settings.deadlineHours-settings.scienceMinutes/60)/(stepMinutes/60));
 for(let k=last;k>=0;k--){const h=k*stepMinutes/60,r=simulate(env,settings,h,true);if(r.metrics.feasible)return {hour:h,stepMinutes,completeHour:r.metrics.completeHour,tested:last-k+1};}
 return {hour:null,stepMinutes,tested:Math.max(0,last+1)};
}
export function sampleAt(result,h){
 const a=result.samples;if(!a.length)return null;let lo=0,hi=a.length-1;
 while(lo<hi){const m=Math.ceil((lo+hi)/2);if(a[m].elapsedHours<=h)lo=m;else hi=m-1;}
 const p={...a[lo]},next=a[Math.min(lo+1,a.length-1)],f=next.elapsedHours>p.elapsedHours?clamp((h-p.elapsedHours)/(next.elapsedHours-p.elapsedHours),0,1):0;
 for(const k of ['powerW','socPct','storedKWh','deliveredMB','pendingMB','cumulativeEnergyKWh','scienceProgress','sunElDeg','earthElDeg','sunFraction','earthFraction','stationClearanceDeg','groundElevationDeg','maxRateMarginDb','horizonDeg','earthHorizonDeg','stationElDeg','stationHorizonDeg','incidence','rateBps'])p[k]+=((next[k]??p[k])-p[k])*f;
 for(const k of ['sunAzDeg','earthAzDeg','stationAzDeg'])p[k]=(p[k]+(((next[k]-p[k]+540)%360)-180)*f+360)%360;
 p.elapsedHours=h;p.utc=new Date(Date.parse(result.settings.startUTC)+h*3600000).toISOString();
 const inWindow=ws=>ws.some(([a,b])=>h>=a-1e-8&&h<b-1e-8);
 p.transmitting=inWindow(result.windows.transmitting);p.scienceActive=inWindow(result.windows.science);
 p.linkAvailable=inWindow(result.windows.link)?1:0;p.actualTxMbps=p.transmitting?p.rateBps*result.settings.protocolEfficiency/1e6:0;
 const m=result.metrics;p.generatedMB=m.scienceEndHour!==null&&h>=m.scienceEndHour?result.settings.dataMB:0;
 p.pendingMB=Math.max(0,p.generatedMB-p.deliveredMB);
 p.phase=m.completeHour!==null&&h>=m.completeHour?'complete':p.transmitting?'transmitting':p.scienceActive?'science':m.scienceEndHour!==null&&h>=m.scienceEndHour?'waiting_contact':'charging';
 p.loadW=result.settings.loadW+(p.scienceActive?result.settings.scienceW:0)+(p.transmitting?result.settings.txPowerW/result.settings.amplifierEfficiency+result.settings.radioOverheadW:0);
 return p;
}
export function distanceKm(a,b){const d=Math.PI/180,p=a.latitude_deg*d,q=b.latitude_deg*d;return 1737.4*2*Math.asin(Math.min(1,Math.sqrt(Math.sin((q-p)/2)**2+Math.cos(p)*Math.cos(q)*Math.sin((b.longitude_deg-a.longitude_deg)*d/2)**2)));}
