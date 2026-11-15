/** LunaShift v7. Deterministic preliminary energy + DTE assessment.
 * Units: W, Wh, seconds, km, degrees. No network or DOM dependencies.
 * Explicit assumptions and references are in docs/MODEL.md.
 */
import {computeScenario, horizonForSite, interpolateHorizon, discFraction} from './solar-model.js';
export const DEG=Math.PI/180, RMOON=1737.4;
export const STATIONS=Object.freeze([
 {id:'canberra',name:'Canberra · DSS 43',ecefKm:[-4460.894917,2682.361507,-3674.748152]},
 {id:'goldstone',name:'Goldstone · DSS 14',ecefKm:[-2353.621420,-4641.341472,3677.052318]},
 {id:'madrid',name:'Madrid · DSS 63',ecefKm:[4849.092518,-360.180348,4115.109251]},
]);
export const MISSION_DEFAULTS=Object.freeze({
 startUTC:'2026-11-07T00:00:00Z',durationHours:168,stepMinutes:5,siteId:'ridge-shoulder',
 heightM:2,areaM2:1.2,panelMode:'vertical_tracking',tiltDeg:90,azimuthDeg:0,
 efficiency:.28,lossFactor:.90,loadW:120,batteryKWh:5,initialSocPct:30,reservePct:20,
 chargeEfficiency:.95,dischargeEfficiency:.95,
 taskEnergyKWh:2,energyDeadlineHours:72,dataTargetGB:1,dataDeadlineHours:168,
 antennaHeightM:2,stationId:'canberra',stationLatDeg:0,stationLonDeg:0,stationAltitudeM:0,
 earthMaskDeg:10,lunarClearanceDeg:.2,frequencyGHz:8.4,txPowerW:5,txGainDbi:12,
 groundGT:50,lossDb:3,fadeMarginDb:3,requiredEbN0Db:6,maxRateMbps:1,
 protocolEfficiency:.85,amplifierEfficiency:.35,radioOverheadW:10,
 payloadW:0,payloadStartHours:24,payloadDurationHours:2,
});
const clamp=(v,l,h)=>Math.max(l,Math.min(h,v));
const wrap=x=>(x%360+360)%360;
const norm=v=>Math.hypot(...v);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const unit=v=>{const n=norm(v);return v.map(x=>x/n);};
const minus=(a,b)=>a.map((x,i)=>x-b[i]);
const add=(a,b)=>a.map((x,i)=>x+b[i]);
export function slerp(a,b,t){
 let d=dot(a,b),q=b;if(d<0){q=b.map(x=>-x);d=-d;}
 if(d>.9995)return unit(a.map((v,i)=>v+t*(q[i]-v)));
 const th=Math.acos(clamp(d,-1,1)),sn=Math.sin(th);
 return a.map((v,i)=>(v*Math.sin((1-t)*th)+q[i]*Math.sin(t*th))/sn);
}
export function rotateQuaternion(q,v){
 const [x,y,z,w]=q, [a,b,c]=v;
 const tx=2*(y*c-z*b),ty=2*(z*a-x*c),tz=2*(x*b-y*a);
 return [a+w*tx+y*tz-z*ty,b+w*ty+z*tx-x*tz,c+w*tz+x*ty-y*tx];
}
export function observerPosition(site,heightM=0){
 const lat=site.latitude_deg*DEG,lon=site.longitude_deg*DEG,r=RMOON+(site.ground_elevation_m+heightM)/1000;
 return [r*Math.cos(lat)*Math.cos(lon),r*Math.cos(lat)*Math.sin(lon),r*Math.sin(lat)];
}
export function localDirection(vector,site){
 const lat=site.latitude_deg*DEG,lon=site.longitude_deg*DEG;
 const [x,y,z]=vector, east=-Math.sin(lon)*x+Math.cos(lon)*y;
 const north=-Math.sin(lat)*Math.cos(lon)*x-Math.sin(lat)*Math.sin(lon)*y+Math.cos(lat)*z;
 const up=Math.cos(lat)*Math.cos(lon)*x+Math.cos(lat)*Math.sin(lon)*y+Math.sin(lat)*z;
 return {azDeg:wrap(Math.atan2(east,north)/DEG),elDeg:Math.atan2(up,Math.hypot(east,north))/DEG,distanceKm:norm(vector),directionENU:unit([east,north,up])};
}
export function interpolateEarth(bundle,utc){
 const e=bundle.ephemeris, ms=typeof utc==='number'?utc:Date.parse(utc);
 const f=(ms-Date.parse(e.start_utc))/(1000*e.step_seconds),arr=e.earth_positions_km;
 if(!arr || f<0 || f>arr.length-1)throw new RangeError('Earth ephemeris unavailable for these dates.');
 const i=Math.min(arr.length-2,Math.floor(f)),u=f-i;
 const p=arr[i].map((v,k)=>v+u*(arr[i+1][k]-v));
 const qs=e.earth_fixed_to_moon_quaternions;
 if(!qs)throw new RangeError('Earth orientation samples are missing.');
 return {positionKm:p,quaternion:slerp(qs[i],qs[i+1],u)};
}
export function customECEF(lat,lon,altM){
 const phi=lat*DEG,lam=lon*DEG,a=6378.137,e2=6.69437999014e-3;
 const N=a/Math.sqrt(1-e2*Math.sin(phi)**2),h=altM/1000;
 return [(N+h)*Math.cos(phi)*Math.cos(lam),(N+h)*Math.cos(phi)*Math.sin(lam),(N*(1-e2)+h)*Math.sin(phi)];
}
export function earthGeometry(bundle,site,utc,heightM,settings){
 const earth=interpolateEarth(bundle,utc),obs=observerPosition(site,heightM);
 const centre=localDirection(minus(earth.positionKm,obs),site);
 const ecef=settings.stationId==='custom'?customECEF(settings.stationLatDeg,settings.stationLonDeg,settings.stationAltitudeM):STATIONS.find(s=>s.id===settings.stationId)?.ecefKm;
 if(!ecef)throw new RangeError('Choose a supported Earth reference station.');
 const stationPos=add(earth.positionKm,rotateQuaternion(earth.quaternion,ecef));
 const normalECEF=unit([ecef[0]/6378.137**2,ecef[1]/6378.137**2,ecef[2]/6356.752314245**2]);
 const zenith=rotateQuaternion(earth.quaternion,normalECEF),direction=minus(stationPos,obs);
 const station=localDirection(direction,site);
 const groundElevationDeg=Math.asin(clamp(dot(unit(minus(obs,stationPos)),zenith),-1,1))/DEG;
 return {...centre,earthAngularRadiusDeg:Math.asin(6378.137/centre.distanceKm)/DEG,station,groundElevationDeg,earthPositionKm:earth.positionKm};
}
export function linkBudget(distanceKm,s){
 const fsplDb=20*Math.log10(4*Math.PI*distanceKm*1000*s.frequencyGHz*1e9/299792458);
 const cn0DbHz=10*Math.log10(s.txPowerW)+s.txGainDbi+s.groundGT-fsplDb-s.lossDb+228.599167;
 const maxBitrate=10**((cn0DbHz-s.requiredEbN0Db-s.fadeMarginDb)/10);
 const rateBps=Math.max(0,Math.min(s.maxRateMbps*1e6,maxBitrate));
 const maxRateMarginDb=cn0DbHz-10*Math.log10(s.maxRateMbps*1e6)-s.requiredEbN0Db-s.fadeMarginDb;
 return {fsplDb,cn0DbHz,rateBps,maxRateMarginDb};
}
function validate(s){
 const limits={taskEnergyKWh:[0,1e6],energyDeadlineHours:[0,s.durationHours],dataTargetGB:[0,1e6],dataDeadlineHours:[0,s.durationHours],antennaHeightM:[0,1000],earthMaskDeg:[0,90],lunarClearanceDeg:[0,20],frequencyGHz:[.01,100],txPowerW:[.001,1e6],txGainDbi:[-20,100],groundGT:[-50,100],lossDb:[0,100],fadeMarginDb:[0,100],requiredEbN0Db:[-10,60],maxRateMbps:[.000001,10000],protocolEfficiency:[.0001,1],amplifierEfficiency:[.001,1],radioOverheadW:[0,1e6],payloadW:[0,1e6],payloadStartHours:[0,1e6],payloadDurationHours:[0,1e6],stationLatDeg:[-90,90],stationLonDeg:[-180,180],stationAltitudeM:[-500,10000]};
 for(const [k,[lo,hi]]of Object.entries(limits))if(!Number.isFinite(s[k])||s[k]<lo||s[k]>hi)throw new RangeError(`${k} must be between ${lo} and ${hi}.`);
 if(s.payloadW>0 && s.payloadStartHours+s.payloadDurationHours>s.durationHours+1e-9)throw new RangeError('The payload schedule must fit inside the mission.');
}
/** Eclipse + terrain disc intersection. A uniform disc, small-angle quadrature. */
export function visibleSunWithEclipse(sample,earth,horizon){
 const radius=sample.sunAngularRadiusDeg;
 const dx=((earth.azDeg-sample.sunAzDeg+540)%360-180)*Math.cos(sample.sunElDeg*DEG);
 const dy=earth.elDeg-sample.sunElDeg,re=earth.earthAngularRadiusDeg;
 if(Math.hypot(dx,dy)>=radius+re)return {fraction:sample.sunFraction,eclipsed:false};
 let visible=0,total=0;
 for(let i=0;i<101;i++){
  const x=radius*(-1+2*(i+.5)/101),half=Math.sqrt(Math.max(0,radius*radius-x*x));
  const az=sample.sunAzDeg+x/Math.max(.00001,Math.cos(sample.sunElDeg*DEG));
  const terrain=interpolateHorizon(horizon.azimuthDeg,horizon.elevationDeg,az)-sample.sunElDeg;
  const lower=Math.max(-half,terrain),upper=half;
  let len=Math.max(0,upper-lower);
  const rr=re*re-(x-dx)**2;
  if(rr>0 && len>0){const eh=Math.sqrt(rr);len-=Math.max(0,Math.min(upper,dy+eh)-Math.max(lower,dy-eh));}
  visible+=Math.max(0,len);total+=2*half;
 }
 return {fraction:clamp(visible/total,0,1),eclipsed:true};
}
export function dispatchEnergy(storeWh,pvW,loadW,hours,s){
 const cap=s.batteryKWh*1000,net=pvW-loadW;
 if(net>=0){const input=Math.min(net*hours,Math.max(0,cap-storeWh)/s.chargeEfficiency);
  return {storeWh:storeWh+input*s.chargeEfficiency,unservedWh:0,spillWh:net*hours-input,chargeLossWh:input*(1-s.chargeEfficiency),dischargeLossWh:0,servedWh:loadW*hours};}
 const need=-net*hours,provided=Math.min(need,storeWh*s.dischargeEfficiency);
 return {storeWh:Math.max(0,storeWh-provided/s.dischargeEfficiency),unservedWh:need-provided,spillWh:0,chargeLossWh:0,dischargeLossWh:provided*(1/s.dischargeEfficiency-1),servedWh:loadW*hours-(need-provided)};
}
export function windowsFromSamples(samples,field,threshold=0){
 const out=[];if(samples.length<2)return out;
 let open=samples[0][field]>threshold?samples[0].elapsedHours:null;
 for(let i=1;i<samples.length;i++){
  const a=samples[i-1],b=samples[i],va=a[field]-threshold,vb=b[field]-threshold;
  if(va<=0 && vb>0){const crossing=a.elapsedHours+(-va)/(vb-va)*(b.elapsedHours-a.elapsedHours);open=crossing;}
  if(va>0 && vb<=0 && open!==null){const crossing=a.elapsedHours+va/(va-vb)*(b.elapsedHours-a.elapsedHours);if(crossing>open)out.push([open,crossing]);open=null;}
 }
 if(open!==null&&samples.at(-1).elapsedHours>open)out.push([open,samples.at(-1).elapsedHours]);return out;
}
const hours=ws=>ws.reduce((a,[s,e])=>a+e-s,0),longest=ws=>Math.max(0,...ws.map(([s,e])=>e-s));
const capMetric=(values)=>values.every(Number.isFinite);

export function computeMission(bundle,requested={}){
 const s={...MISSION_DEFAULTS,...requested};validate(s);
 // Reuse the point-collector geometry, finite-disc quadrature and array projection.
 const solar=computeScenario(bundle,s),site=solar.site;
 const antennaHorizon=Math.abs(s.antennaHeightM-s.heightM)<1e-10?solar.horizon:horizonForSite(site,s.antennaHeightM);
 const samples=solar.samples.map(p=>{
  const earth=earthGeometry(bundle,site,p.utc,s.antennaHeightM,s),link=linkBudget(earth.station.distanceKm,s);
  const skyline=interpolateHorizon(antennaHorizon.azimuthDeg,antennaHorizon.elevationDeg,earth.azDeg);
  const stationSky=interpolateHorizon(antennaHorizon.azimuthDeg,antennaHorizon.elevationDeg,earth.station.azDeg);
  const clearance=earth.station.elDeg-stationSky-s.lunarClearanceDeg;
  const available=clearance>0 && earth.groundElevationDeg>s.earthMaskDeg;
  const ec=visibleSunWithEclipse(p,earth,solar.horizon);
  const powerW=p.sunFraction>0?p.powerW*ec.fraction/p.sunFraction:0;
  return {...p,powerW,sunFraction:ec.fraction,eclipsed:ec.eclipsed,
   earthAzDeg:earth.azDeg,earthElDeg:earth.elDeg,earthHorizonDeg:skyline,
   earthFraction:discFraction(earth.elDeg-skyline,earth.earthAngularRadiusDeg),earthClearanceDeg:earth.elDeg-skyline,
   stationAzDeg:earth.station.azDeg,stationElDeg:earth.station.elDeg,stationClearanceDeg:clearance,
   stationHorizonDeg:stationSky,groundElevationDeg:earth.groundElevationDeg,earthDistanceKm:earth.distanceKm,
   geometryClearanceDeg:Math.min(clearance,earth.groundElevationDeg-s.earthMaskDeg),linkAvailable:available?1:0,linkRateMbps:available?link.rateBps/1e6:0,...link,
   sunVisible:ec.fraction>1e-8?1:0,earthVisible:earth.elDeg>skyline?1:0,
  };
 });
 const cap=s.batteryKWh*1000,reserve=cap*s.reservePct/100,initial=cap*s.initialSocPct/100;
 const taskThreshold=reserve+s.taskEnergyKWh*1000,radioW=s.txPowerW/s.amplifierEfficiency+s.radioOverheadW;
 let store=initial,minStore=store,remainingBits=s.dataTargetGB*8e9,deliveredBits=0;
 let pvWh=0,loadWh=0,servedWh=0,unservedWh=0,spillWh=0,chargeLossWh=0,dischargeLossWh=0,radioWh=0;
 let harvestTime=s.taskEnergyKWh===0?0:null,taskReady=store>=taskThreshold-1e-8?0:null;
 let dataReady=remainingBits===0?0:null,jointReady=taskReady===0&&dataReady===0?0:null;
 const txSegments=[];
 let firstReserve=store<reserve-1e-8?0:null,firstUnserved=null,firstRadio=null,txHours=0;
 let taskMetByDeadline=taskReady===0,dataAtDeadline=0;
 const writeState=(p)=>Object.assign(p,{storedKWh:store/1000,socPct:cap?store/cap*100:0,
   availableTaskKWh:Math.max(0,(store-reserve)/1000),cumulativeEnergyKWh:pvWh/1000,
   deliveredGB:deliveredBits/8e9,cumulativeUnservedKWh:unservedWh/1000});
 writeState(samples[0]);samples[0].actualTxMbps=0;samples[0].loadW=s.loadW;samples[0].radioPowerW=0;
 for(let i=1;i<samples.length;i++){
  const a=samples[i-1],b=samples[i],start=a.elapsedHours,end=b.elapsedHours;
  // Align all scheduled edges and deadlines to sub-intervals; geometry/power
  // remains a declared midpoint approximation within the sampled interval.
  const edges=[start,end,s.payloadStartHours,s.payloadStartHours+s.payloadDurationHours,s.energyDeadlineHours,s.dataDeadlineHours]
   .filter(t=>t>=start && t<=end).sort((x,y)=>x-y).filter((v,j,arr)=>!j||v>arr[j-1]);
  let intervalTxBits=0,intervalLoadWh=0,intervalRadioWh=0;
  for(let j=1;j<edges.length;j++){
   const t0=edges[j-1],t1=edges[j],dt=t1-t0,mid=(t0+t1)/2,u=(mid-start)/(end-start);
   const pv=a.powerW+(b.powerW-a.powerW)*u;
   const base=s.loadW+((mid>=s.payloadStartHours && mid<s.payloadStartHours+s.payloadDurationHours)?s.payloadW:0);
   const clear=a.stationClearanceDeg+(b.stationClearanceDeg-a.stationClearanceDeg)*u;
   const ge=a.groundElevationDeg+(b.groundElevationDeg-a.groundElevationDeg)*u;
   const rawRate=a.rateBps+(b.rateBps-a.rateBps)*u;
   const dataRate=rawRate*s.protocolEfficiency;
   const allowed=clear>0 && ge>s.earthMaskDeg && remainingBits>1e-4;
   let transmitH=allowed?Math.min(dt,remainingBits/(dataRate*3600)):0;
   const netTx=pv-base-radioW;
   if(netTx<0)transmitH=Math.min(transmitH,Math.max(0,store-reserve)*s.dischargeEfficiency/(-netTx));
   // If storage is below reserve, don't transmit until a later sample has recovered it.
   if(store<reserve-1e-8)transmitH=0;
   transmitH=clamp(transmitH,0,dt);
   const parts=transmitH>1e-12?[[transmitH,base+radioW,true],[dt-transmitH,base,false]]:[[dt,base,false]];
   let cursor=t0;
   for(const [h,load,tx]of parts){
    if(h<=1e-12)continue;
    const before=store,beforePV=pvWh,seg=dispatchEnergy(store,pv,load,h,s);
    store=seg.storeWh;pvWh+=pv*h;loadWh+=load*h;servedWh+=seg.servedWh;
    unservedWh+=seg.unservedWh;spillWh+=seg.spillWh;chargeLossWh+=seg.chargeLossWh;dischargeLossWh+=seg.dischargeLossWh;
    intervalLoadWh+=load*h;
    if(tx){
     const previousTx=txSegments.at(-1);if(previousTx&&Math.abs(previousTx[1]-cursor)<1e-9)previousTx[1]=cursor+h;else txSegments.push([cursor,cursor+h]);
     const bits=Math.min(remainingBits,dataRate*h*3600);remainingBits-=bits;deliveredBits+=bits;intervalTxBits+=bits;
     radioWh+=radioW*h;intervalRadioWh+=radioW*h;txHours+=h;if(firstRadio===null)firstRadio=cursor;
     if(remainingBits<.001 && dataReady===null)dataReady=cursor+h;
    }
    if(taskReady===null && before<taskThreshold && store>=taskThreshold-1e-8){
     taskReady=cursor+(taskThreshold-before)/Math.max(1e-20,(pv-load)*s.chargeEfficiency);
    }
    if(harvestTime===null && pvWh>=s.taskEnergyKWh*1000)harvestTime=cursor+(s.taskEnergyKWh*1000-beforePV)/Math.max(1e-20,pv);
    if(firstReserve===null && store<reserve-1e-8){firstReserve=cursor+(before-reserve)*s.dischargeEfficiency/Math.max(1e-20,load-pv);}
    if(firstUnserved===null && seg.unservedWh>1e-8)firstUnserved=cursor+before*s.dischargeEfficiency/Math.max(1e-20,load-pv);
    minStore=Math.min(minStore,store);
    if(jointReady===null && store>=taskThreshold-1e-8 && remainingBits<.001){
     const localTaskReady=before>=taskThreshold-1e-8?cursor:cursor+(taskThreshold-before)/Math.max(1e-20,(pv-load)*s.chargeEfficiency);
     jointReady=Math.max(dataReady??0,localTaskReady);
    }
    cursor+=h;
   }
   if(t1<=s.dataDeadlineHours+1e-9)dataAtDeadline=deliveredBits/8e9;
  }
  b.actualTxMbps=intervalTxBits/((end-start)*3600*1e6);
  b.loadW=intervalLoadWh/(end-start);b.radioPowerW=intervalRadioWh/(end-start);writeState(b);
 }
 if(taskReady!==null && taskReady<=s.energyDeadlineHours+1e-8)taskMetByDeadline=true;
 const energyOK=taskMetByDeadline && unservedWh<.001 && (cap===0 || minStore>=reserve-.001);
 const commOK=dataAtDeadline>=s.dataTargetGB-1e-8;
 const readiness=energyOK&&commOK?'Meets selected checks':!energyOK&&!commOK?'Energy & communication limited':!energyOK?'Energy limited':'Communication limited';
 const reasons=[];
 if(taskThreshold>cap+.001)reasons.push('The battery cannot hold the task energy plus the selected reserve.');
 else if(!taskMetByDeadline)reasons.push('The required energy is not stored above reserve before its deadline.');
 if(firstReserve!==null)reasons.push(`The battery crosses its reserve at mission hour ${firstReserve.toFixed(1)}.`);
 if(unservedWh>.001)reasons.push(`${(unservedWh/1000).toFixed(3)} kWh of electrical demand cannot be supplied.`);
 if(!commOK)reasons.push(`Only ${dataAtDeadline.toFixed(3)} of ${s.dataTargetGB.toFixed(3)} GB is delivered by the data deadline.`);
 if(energyOK&&commOK)reasons.push('Task energy, battery reserve, load supply and data deadline pass the selected preliminary checks.');
 const sunWindows=windowsFromSamples(samples,'sunVisible',.5),earthWindows=windowsFromSamples(samples,'earthClearanceDeg',0),linkWindows=windowsFromSamples(samples,'geometryClearanceDeg',0),txWindows=txSegments;
 const noSun=[];let c=0;for(const [a,b]of sunWindows){if(a>c)noSun.push([c,a]);c=b;}if(c<s.durationHours)noSun.push([c,s.durationHours]);
 const metrics={energyKWh:pvWh/1000,loadKWh:loadWh/1000,servedLoadKWh:servedWh/1000,
  unservedKWh:unservedWh/1000,spilledKWh:spillWh/1000,chargeLossKWh:chargeLossWh/1000,dischargeLossKWh:dischargeLossWh/1000,
  radioKWh:radioWh/1000,finalBatteryKWh:store/1000,initialBatteryKWh:initial/1000,
  minSocPct:cap?minStore/cap*100:0,finalSocPct:cap?store/cap*100:0,
  energyBalanceErrorKWh:(pvWh+initial-servedWh-store-spillWh-chargeLossWh-dischargeLossWh)/1000,
  taskReadyHour:taskReady,harvestTargetHour:harvestTime,dataReadyHour:dataReady,jointReadyHour:jointReady,
  firstReserveBreachHour:firstReserve,firstUnservedHour:firstUnserved,firstRadioHour:firstRadio,
  deliveredGB:deliveredBits/8e9,dataAtDeadlineGB:dataAtDeadline,transmittingHours:txHours,
  sunlitHours:hours(sunWindows),longestNoSunHours:longest(noSun),earthVisibleHours:hours(earthWindows),linkHours:hours(linkWindows),longestLinkHours:longest(linkWindows),
  averagePowerW:pvWh/s.durationHours,peakPowerW:Math.max(...samples.map(p=>p.powerW)),
  energyOK,commOK,feasible:energyOK&&commOK,readiness,reasons,sampleCount:samples.length};
 if(!capMetric([metrics.energyKWh,metrics.deliveredGB,metrics.minSocPct,metrics.energyBalanceErrorKWh]))throw new Error('Non-finite model output.');
 return {...solar,site,settings:s,samples,metrics,antennaHorizon,
  windows:{sun:sunWindows,noSun,earth:earthWindows,link:linkWindows,transmitting:txWindows},
  assumptions:[...solar.assumptions,
   'Earth station geometry uses DE421 plus approximate IAU_EARTH orientation. No station reservation, weather, maintenance or high-accuracy ITRF/EOP.',
   'Link rate is an ideal continuous adaptive-rate budget capped by the user maximum, with a user-selected Eb/N0 and fade margin; not a flight modem or paper PLL simulation.',
   'Data is available at landing. Radio sends whenever geometry, link and reserve permit, until the target is delivered. Base load has priority; transmitter electrical power is included.',
   'Task-ready time is the first time battery energy above reserve reaches the task target. Initial battery energy counts. The task is not executed or subtracted by this readiness check.',
   'Joint energy bookkeeping uses interval-midpoint power and split scheduled load edges. Solar eclipses are geometric opaque-Earth disc masks; no refracted light.',
  ],provenance:{...solar.provenance,model:'LunaShift mission model 7.0',earth:bundle.ephemeris.earth_model}};
}

export function eventCountdown(windows,hour,duration){
 const eps=1e-8;
 for(const [a,b]of windows){if(hour>=a-eps && hour<b-eps)return {visible:true,next:'sets',hours:b>=duration-eps?null:b-hour};if(a>hour)return {visible:false,next:'rises',hours:a-hour};}
 return {visible:false,next:'rises',hours:null};
}
