/** Time-driven scene geometry. Shares the unchanged solar and radio geometry.
 * No extrapolation, fabricated orbital paths, or battery integration in sky-only mode.
 */
import {solarGeometry,solarDiscFraction,interpolateHorizon,panelIncidence} from './solar-model.js';
import {earthGeometry,visibleSunWithEclipse} from './mission-model.js';
import {sampleAtHour} from './visual-geometry.js';
export const HOUR_MS=3600000;
export const wrapDeg=x=>((x%360)+360)%360;
export const angleDelta=(a,b)=>((a-b+540)%360)-180;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function ephemerisBounds(bundle){const e=bundle.ephemeris;return {start:Date.parse(e.start_utc),end:Date.parse(e.start_utc)+(e.sun_positions_km.length-1)*e.step_seconds*1000};}
export function skyRange(bundle,result,mode='mission',now=Date.now()){
 const bounds=ephemerisBounds(bundle),start=mode==='now'?now:Date.parse(result.settings.startUTC),wantedEnd=start+(mode==='mission'?result.settings.durationHours:720)*HOUR_MS;
 if(start<bounds.start||start>bounds.end)throw new RangeError('This time is outside the packaged 2026–2027 ephemeris. Choose a supported mission date.');
 return {start,end:Math.min(wantedEnd,bounds.end),durationHours:Math.max(0,(Math.min(wantedEnd,bounds.end)-start)/HOUR_MS),clipped:wantedEnd>bounds.end};
}
export function skyAt(bundle,result,utcMs,{telemetry=true}={}){
 const s=result.settings,site=result.site,h=result.horizon,ah=result.antennaHorizon||h;
 const sun=solarGeometry(bundle,site,new Date(utcMs).toISOString(),s.heightM);
 const earth=earthGeometry(bundle,site,utcMs,s.antennaHeightM,s);
 const sf=solarDiscFraction(sun.sunAzDeg,sun.sunElDeg,sun.angularRadiusDeg,h);
 const ec=visibleSunWithEclipse({...sun,sunAngularRadiusDeg:sun.angularRadiusDeg,sunFraction:sf},earth,h);
 const earthHorizonDeg=interpolateHorizon(ah.azimuthDeg,ah.elevationDeg,earth.azDeg);
 const stationHorizonDeg=interpolateHorizon(ah.azimuthDeg,ah.elevationDeg,earth.station.azDeg);
 const stationClearanceDeg=earth.station.elDeg-stationHorizonDeg-s.lunarClearanceDeg;
 const linkAvailable=stationClearanceDeg>0&&earth.groundElevationDeg>s.earthMaskDeg;
 const elapsedHours=(utcMs-Date.parse(s.startUTC))/HOUR_MS;
 const inMission=elapsedHours>=0&&elapsedHours<=s.durationHours;
 const original=telemetry&&inMission?sampleAtHour(result,elapsedHours):null;
 // Battery and transmission are the existing sampled mission values, not
 // invented continuous telemetry. Geometric availability gates the visual link.
 return {...(original||{}),utc:new Date(utcMs).toISOString(),elapsedHours,
  sunAzDeg:sun.sunAzDeg,sunElDeg:sun.sunElDeg,sunPositionKm:sun.sunPositionKm,
  sunAngularRadiusDeg:sun.angularRadiusDeg,sunFraction:ec.fraction,sunVisible:ec.fraction>1e-8?1:0,eclipsed:ec.eclipsed,
  sunHorizonDeg:interpolateHorizon(h.azimuthDeg,h.elevationDeg,sun.sunAzDeg),
  powerW:sun.irradianceWm2*s.areaM2*s.efficiency*s.lossFactor*panelIncidence(sun.sunAzDeg,sun.sunElDeg,s)*ec.fraction,
  earthAzDeg:earth.azDeg,earthElDeg:earth.elDeg,earthPositionKm:earth.earthPositionKm,earthAngularRadiusDeg:earth.earthAngularRadiusDeg,
  earthHorizonDeg,earthClearanceDeg:earth.elDeg-earthHorizonDeg,earthVisible:earth.elDeg>earthHorizonDeg?1:0,
  stationAzDeg:earth.station.azDeg,stationElDeg:earth.station.elDeg,stationHorizonDeg,stationClearanceDeg,
  groundElevationDeg:earth.groundElevationDeg,linkAvailable:linkAvailable?1:0,
  bothVisible:ec.fraction>1e-8&&earth.elDeg>earthHorizonDeg,
  actualTxMbps:original&&linkAvailable?original.actualTxMbps:0,
  telemetryAvailable:!!original,telemetrySampleUTC:original?.utc||null,
  observationHeightM:s.heightM,antennaHeightM:s.antennaHeightM,
 };
}
export function intersectWindows(a=[],b=[]){const out=[];let i=0,j=0;while(i<a.length&&j<b.length){const lo=Math.max(a[i][0],b[j][0]),hi=Math.min(a[i][1],b[j][1]);if(hi>lo+1e-9)out.push([lo,hi]);if(a[i][1]<b[j][1])i++;else j++;}return out;}
export function unionDuration(w=[]){return w.reduce((n,[a,b])=>n+Math.max(0,b-a),0);}
export function findWindow(w,h,{next=false}={}){for(const [a,b]of w){if(b<=h+1e-7)continue;if(next&&a<=h+1e-7)continue;return {start:a,end:b,remaining:b-Math.max(a,h),active:a<=h};}return null;}
export function missionVisibility(result){const w=result.windows;return {sun:w.sun,earth:w.earth,link:w.link,both:intersectWindows(w.sun,w.earth),durationHours:result.settings.durationHours,stepMinutes:result.settings.stepMinutes,source:'mission'};}
/** Sample sky-only visibility and refine detected transitions by bisection.
 * Sampling may miss an event shorter than the scan step. It is not an accuracy claim.
 */
export function scanSkyWindows(bundle,result,start,end,stepMinutes=15){
 const duration=(end-start)/HOUR_MS,keys=['sun','earth','link','both'],out=Object.fromEntries(keys.map(k=>[k,[]])),opens={};
 const flags=p=>({sun:p.sunVisible===1,earth:p.earthVisible===1,link:p.linkAvailable===1,both:p.bothVisible});
 let prev=flags(skyAt(bundle,result,start,{telemetry:false})),t0=start;
 for(const k of keys)opens[k]=prev[k]?0:null;
 const steps=Math.max(1,Math.ceil((end-start)/(stepMinutes*60000)));
 for(let i=1;i<=steps;i++){
  const t=Math.min(end,start+i*stepMinutes*60000),f=flags(skyAt(bundle,result,t,{telemetry:false}));
  for(const k of keys)if(f[k]!==prev[k]){let lo=t0,hi=t;for(let z=0;z<12;z++){const m=(lo+hi)/2;if(flags(skyAt(bundle,result,m,{telemetry:false}))[k]===prev[k])lo=m;else hi=m;}const h=((lo+hi)/2-start)/HOUR_MS;if(f[k])opens[k]=h;else if(opens[k]!==null){out[k].push([opens[k],h]);opens[k]=null;}}
  prev=f;t0=t;
 }
 for(const k of keys)if(opens[k]!==null&&duration>opens[k])out[k].push([opens[k],duration]);
 return {...out,durationHours:duration,stepMinutes,source:'sky scan'};
}
export function makeSkyPaths(bundle,result,start,end,count=121){const points=[];for(let i=0;i<count;i++){const ms=start+(end-start)*i/(count-1),s=solarGeometry(bundle,result.site,new Date(ms).toISOString(),result.settings.heightM),e=earthGeometry(bundle,result.site,ms,result.settings.antennaHeightM,result.settings);points.push({ms,sun:s.sunPositionKm,earth:e.earthPositionKm,sunAz:s.sunAzDeg,sunEl:s.sunElDeg,earthAz:e.azDeg,earthEl:e.elDeg});}return points;}
export function advanceClock(hour,realSeconds,multiplier,endHour,{loop=false,stopAt=null}={}){
 if(![hour,realSeconds,multiplier,endHour].every(Number.isFinite)||realSeconds<0||multiplier<=0||endHour<0)throw new RangeError('Invalid playback clock.');
 const end=stopAt===null?endHour:Math.min(endHour,stopAt),h=hour+realSeconds*multiplier/3600;
 if(h<end)return {hour:h,ended:false};
 if(loop&&stopAt===null&&end>0)return {hour:h%end,ended:false};
 return {hour:end,ended:true};
}
