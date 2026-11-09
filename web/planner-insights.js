/** Auditable decision explanations. This module never changes the mission physics.
 * Solar motivation: Pappa et al., Solar Power for Lunar Pole Missions (2019),
 * pp. 6–11,17,31. Radio reference: Divsalar et al. (2019), Eqs. 7,9–11.
 * The reference BER below is NOT a flight-modem, coded-link or PLL simulation.
 */
import {missionChecks,lunarDistanceKm} from './decision-model.js';
export function classifyChoice(choice){
 if(!choice?.metrics)return {key:'unknown',label:'Outside supported data',symbol:'—',count:0};
 const checks=missionChecks(choice.metrics,choice.settings),energy=checks.slice(0,3).every(c=>c.pass),data=checks[3].pass;
 return {key:energy?(data?'pass':'data'):(data?'energy':'both'),label:energy?(data?'All checks pass':'Data requirement not met'):(data?'Energy requirement not met':'Energy and data requirements not met'),symbol:energy?(data?'✓':'D'):(data?'E':'E+D'),count:checks.filter(c=>c.pass).length};
}
export function counterfactualRows(a,b,choices){
 if(!a||!b)return [];
 const tA=Date.parse(a.settings.startUTC),tB=Date.parse(b.settings.startUTC);
 const find=(site,t)=>choices.find(c=>c.settings.siteId===site&&Date.parse(c.settings.startUTC)===t);
 const sameSite=a.site.id===b.site.id,sameTime=tA===tB;
 const rows=[{id:'original',label:'Original plan',result:a,siteId:a.site.id,time:tA}];
 if(!sameSite)rows.push({id:'location',label:'Change location only',result:sameTime?b:find(b.site.id,tA),siteId:b.site.id,time:tA});
 if(!sameTime)rows.push({id:'date',label:'Change date only',result:sameSite?b:find(a.site.id,tB),siteId:a.site.id,time:tB});
 if(!sameSite&&!sameTime)rows.push({id:'both',label:'Change location + date',result:b,siteId:b.site.id,time:tB});
 return rows;
}
export function passingDateRun(choices,selected){
 if(!selected)return null;
 const rows=choices.filter(c=>c.settings.siteId===selected.settings.siteId).sort((a,b)=>Date.parse(a.settings.startUTC)-Date.parse(b.settings.startUTC));
 const i=rows.findIndex(c=>Date.parse(c.settings.startUTC)===Date.parse(selected.settings.startUTC));
 if(i<0||classifyChoice(rows[i]).key!=='pass')return null;
 let lo=i,hi=i;while(lo>0&&classifyChoice(rows[lo-1]).key==='pass')lo--;while(hi+1<rows.length&&classifyChoice(rows[hi+1]).key==='pass')hi++;
 const times=rows.slice(lo,hi+1).map(c=>Date.parse(c.settings.startUTC));
 return {count:hi-lo+1,start:times[0],end:times.at(-1),stepsDays:times.slice(1).map((t,j)=>(t-times[j])/86400000)};
}
export function comparePlans(a,b){
 if(!a||!b)return null;const am=a.metrics,bm=b.metrics;
 const checksA=missionChecks(am,a.settings),checksB=missionChecks(bm,b.settings);
 return {distanceKm:lunarDistanceKm(a.site,b.site),delayDays:(Date.parse(b.settings.startUTC)-Date.parse(a.settings.startUTC))/86400000,
  locationChanged:a.site.id!==b.site.id,timeChanged:Date.parse(a.settings.startUTC)!==Date.parse(b.settings.startUTC),
  recovered:checksA.filter((c,i)=>!c.pass&&checksB[i].pass).map(c=>c.label),regressed:checksA.filter((c,i)=>c.pass&&!checksB[i].pass).map(c=>c.label),
  deltas:[{label:'Solar generation',unit:'kWh',a:am.energyKWh,b:bm.energyKWh,delta:bm.energyKWh-am.energyKWh,higher:true},
   {label:'Lowest battery',unit:'pp',a:am.minSocPct,b:bm.minSocPct,delta:bm.minSocPct-am.minSocPct,higher:true},
   {label:'Longest no sun',unit:'h',a:am.longestNoSunHours,b:bm.longestNoSunHours,delta:bm.longestNoSunHours-am.longestNoSunHours,higher:false},
   {label:'Station access',unit:'h',a:am.linkHours,b:bm.linkHours,delta:bm.linkHours-am.linkHours,higher:true},
   {label:'Data by deadline',unit:'GB',a:am.dataAtDeadlineGB,b:bm.dataAtDeadlineGB,delta:bm.dataAtDeadlineGB-am.dataAtDeadlineGB,higher:true}],
 };
}
export function energyLedger(result){
 const m=result.metrics,input=m.energyKWh+m.initialBatteryKWh;
 const outputs=[{id:'load',label:'Delivered to loads',value:m.servedLoadKWh},{id:'stored',label:'Stored at mission end',value:m.finalBatteryKWh},{id:'spilled',label:'Excess not stored',value:m.spilledKWh},{id:'loss',label:'Storage losses',value:m.chargeLossKWh+m.dischargeLossKWh}];
 return {input,generated:m.energyKWh,initial:m.initialBatteryKWh,outputs,error:input-outputs.reduce((s,v)=>s+v.value,0)};
}
/** Average uncoded coherent-BPSK BER with perfect synchronization, normalized
 * Rician fading. Craig integral + the Rician SNR Laplace transform evaluates
 * the paper's Eqs. 9–11 without random sampling. K is linear, input in dB.
 */
export function ricianBpskBer(ebN0Db,kDb=10,steps=512){
 if(!Number.isFinite(ebN0Db)||!Number.isFinite(kDb))return null;
 const gamma=10**(Math.max(-100,Math.min(100,ebN0Db))/10),K=10**(Math.max(-100,Math.min(50,kDb))/10);
 const n=Math.max(64,Math.ceil(steps/2)*2),h=Math.PI/2/n;
 const f=t=>{const q=(1+K)*Math.sin(t)**2;return q===0?0:q/(q+gamma)*Math.exp(-K*gamma/(q+gamma));};
 let sum=f(0)+f(Math.PI/2);for(let i=1;i<n;i++)sum+=(i%2?4:2)*f(i*h);
 return Math.max(0,Math.min(.5,sum*h/(3*Math.PI)));
}
export function radioState(p,s){
 if(!p)return {key:'unknown',label:'Not calculated',available:false};
 if(p.stationClearanceDeg<=0)return {key:'blocked',label:'Lunar terrain blocks the station',available:false};
 if(p.groundElevationDeg<=s.earthMaskDeg)return {key:'station',label:'Station below its elevation limit',available:false};
 if(p.telemetryAvailable&&p.actualTxMbps>1e-9)return {key:'transmitting',label:'Powered transmission',available:true};
 if(p.telemetryAvailable&&p.deliveredGB>=s.dataTargetGB-1e-8)return {key:'complete',label:'Data target delivered',available:true};
 if(p.telemetryAvailable)return {key:'reserve',label:'Access open · radio not transmitting',available:true};
 return {key:'geometry',label:'Geometric access open',available:true};
}
export function missionRadioSummary(result){
 const access=result.samples.filter(p=>p.linkAvailable&&Number.isFinite(p.maxRateMarginDb));
 return {accessSamples:access.length,minCapMarginDb:access.length?Math.min(...access.map(p=>p.maxRateMarginDb)):null,
  maxCapMarginDb:access.length?Math.max(...access.map(p=>p.maxRateMarginDb)):null,
  maxModelRateMbps:access.length?Math.max(...access.map(p=>p.linkRateMbps)):0};
}
