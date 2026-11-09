import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {MISSION_DEFAULTS as D,computeMission,dispatchEnergy,linkBudget,rotateQuaternion,slerp,localDirection,customECEF,earthGeometry,interpolateEarth,visibleSunWithEclipse,eventCountdown,windowsFromSamples} from '../web/mission-model.js';
const near=(a,b,t=1e-8)=>assert.ok(Number.isFinite(a)&&Math.abs(a-b)<=t,`${a} != ${b} ± ${t}`);
const balance=m=>{near(m.energyBalanceErrorKWh,0,1e-9);near(m.loadKWh,m.servedLoadKWh+m.unservedKWh,1e-9);};
function fixture(horizon=0){
 const obs=1737.402,dist=149597870.7;
 return {sites:[{id:'test',name:'Controlled test fixture only',latitude_deg:0,longitude_deg:0,ground_elevation_m:0,terrain:{kind:'horizon',frame:'MOON_ME_DE421',source:'Analytic unit-test fixture',observer_height_m:2,azimuth_deg:[0,90,180,270],horizon_deg:[horizon,horizon,horizon,horizon]}}],ephemeris:{start_utc:'2026-11-07T00:00:00Z',step_seconds:86400,frame:'MOON_ME_DE421',sun_positions_km:[[obs+dist*.5,dist*Math.sqrt(3)/2,0],[obs+dist*.5,dist*Math.sqrt(3)/2,0]],earth_positions_km:[[384400,0,0],[384400,0,0]],earth_fixed_to_moon_quaternions:[[0,0,0,1],[0,0,0,1]]}};
}
const conf=x=>({...D,siteId:'test',durationHours:24,energyDeadlineHours:24,dataDeadlineHours:24,stationId:'custom',stationLatDeg:0,stationLonDeg:180,panelMode:'tracking',payloadW:0,...x});
const calc=(x={},h=0)=>computeMission(fixture(h),conf(x));

test('quaternion rotation and antipodal interpolation agree',()=>{
 const q=[0,0,Math.sqrt(.5),Math.sqrt(.5)],r=rotateQuaternion(q,[1,0,0]);near(r[0],0);near(r[1],1);near(r[2],0);
 const a=slerp([0,0,0,1],[0,0,0,-1],.42);near(Math.abs(a[3]),1);
 const b=slerp([0,0,0,1],[0,0,1,0],.5);near(b[2],Math.sqrt(.5));
});
test('local ENU at equator has known north, east and zenith',()=>{
 const site={latitude_deg:0,longitude_deg:0};near(localDirection([0,1,0],site).azDeg,90);near(localDirection([0,0,1],site).azDeg,0);near(localDirection([1,0,0],site).elDeg,90);
});
test('custom station geodetic transform matches equatorial WGS84 radius',()=>{const v=customECEF(0,0,1000);near(v[0],6379.137);near(v[1],0);near(v[2],0);});
test('Earth-centre visibility does not imply a particular station sees the Moon',()=>{
 const b=fixture();const nearSide=earthGeometry(b,b.sites[0],D.startUTC,2,conf({}));near(nearSide.elDeg,90);near(nearSide.groundElevationDeg,90);
 const farSide=earthGeometry(b,b.sites[0],D.startUTC,2,conf({stationLonDeg:0}));near(farSide.elDeg,90);near(farSide.groundElevationDeg,-90);
});
test('Earth interpolation supports endpoints and rejects missing/out-of-range samples',()=>{
 const b=fixture();near(interpolateEarth(b,D.startUTC).positionKm[0],384400);
 near(interpolateEarth(b,'2026-11-08T00:00:00Z').positionKm[0],384400);
 assert.throws(()=>interpolateEarth(b,'2026-11-06T00:00:00Z'),/unavailable/);delete b.ephemeris.earth_positions_km;assert.throws(()=>interpolateEarth(b,D.startUTC),/unavailable/);
});
test('free-space link scales correctly with range, frequency and transmitter power',()=>{
 const a=linkBudget(384400,D),r=linkBudget(768800,D),f=linkBudget(384400,{...D,frequencyGHz:16.8}),p=linkBudget(384400,{...D,txPowerW:10});
 near(r.fsplDb-a.fsplDb,20*Math.log10(2));near(f.fsplDb-a.fsplDb,20*Math.log10(2));near(p.cn0DbHz-a.cn0DbHz,10*Math.log10(2));
 assert.ok(a.fsplDb>222&&a.fsplDb<223);assert.ok(a.rateBps<=D.maxRateMbps*1e6);
});
test('dispatch energy accounts separately for charge loss, clipping and curtailment',()=>{
 const r=dispatchEnergy(900,500,100,1,{batteryKWh:1,chargeEfficiency:.8,dischargeEfficiency:.9});near(r.storeWh,1000);near(r.chargeLossWh,25);near(r.spillWh,275);near(r.servedWh,100);
 near(900+500,r.storeWh+r.servedWh+r.spillWh+r.chargeLossWh);
});
test('dispatch energy accounts for discharge loss and unserved demand',()=>{
 const r=dispatchEnergy(100,0,200,1,{batteryKWh:1,chargeEfficiency:.8,dischargeEfficiency:.9});near(r.storeWh,0);near(r.servedWh,90);near(r.unservedWh,110);near(r.dischargeLossWh,10);
});
test('opaque Earth masks a coincident Sun, but does not attenuate a disjoint disc',()=>{
 const p={sunAngularRadiusDeg:.27,sunAzDeg:0,sunElDeg:5,sunFraction:1},h={azimuthDeg:[0,90,180,270],elevationDeg:[0,0,0,0]};
 near(visibleSunWithEclipse(p,{azDeg:0,elDeg:5,earthAngularRadiusDeg:1},h).fraction,0);
 const clear=visibleSunWithEclipse(p,{azDeg:10,elDeg:5,earthAngularRadiusDeg:1},h);near(clear.fraction,1);assert.equal(clear.eclipsed,false);
});
test('visible Earth, link budget and supplied battery jointly permit data transfer',()=>{
 const r=calc({dataTargetGB:.1,initialSocPct:90});near(r.metrics.deliveredGB,.1);assert.ok(r.metrics.radioKWh>0);assert.ok(r.metrics.dataReadyHour>0);assert.equal(r.metrics.commOK,true);balance(r.metrics);
});
test('Earth-visible but far-side station delivers no data and consumes no radio energy',()=>{
 const r=calc({stationLonDeg:0});near(r.metrics.earthVisibleHours,24);near(r.metrics.linkHours,0);near(r.metrics.deliveredGB,0);near(r.metrics.radioKWh,0);balance(r.metrics);
});
test('zero data target draws no transmitter energy',()=>{
 const r=calc({dataTargetGB:0});near(r.metrics.radioKWh,0);near(r.metrics.deliveredGB,0);near(r.metrics.dataReadyHour,0);balance(r.metrics);
});
test('transmitter power is included in electrical demand and target is never exceeded',()=>{
 const x={dataTargetGB:.01,initialSocPct:90},r=calc(x),off=calc({...x,dataTargetGB:0});
 near(r.metrics.loadKWh-off.metrics.loadKWh,r.metrics.radioKWh,1e-9);near(r.metrics.deliveredGB,.01,1e-10);
 near(r.metrics.radioKWh,r.metrics.transmittingHours*(D.txPowerW/D.amplifierEfficiency+D.radioOverheadW)/1000,1e-9);balance(r.metrics);
});
test('radio respects reserve under shadow when baseline load is zero',()=>{
 const r=calc({areaM2:0,loadW:0,batteryKWh:1,initialSocPct:50,reservePct:20,taskEnergyKWh:0,dataTargetGB:1000});
 assert.ok(r.metrics.minSocPct>=20-1e-8);assert.ok(r.metrics.deliveredGB>0);assert.ok(r.metrics.deliveredGB<1000);balance(r.metrics);
});
test('base load has priority and can reveal reserve violation or power failure',()=>{
 const r=calc({areaM2:0,batteryKWh:1,initialSocPct:50,reservePct:20,loadW:200,dataTargetGB:1000});assert.ok(r.metrics.unservedKWh>0);near(r.metrics.minSocPct,0);assert.equal(r.metrics.energyOK,false);balance(r.metrics);
});
test('task-ready energy includes initial charge and is separate from gross generation',()=>{
 const r=calc({initialSocPct:90,taskEnergyKWh:2,dataTargetGB:0});near(r.metrics.taskReadyHour,0);assert.ok(r.metrics.harvestTargetHour>0);assert.equal(r.metrics.energyOK,true);
});
test('task larger than storage capacity is explicitly infeasible',()=>{
 const r=calc({taskEnergyKWh:9,dataTargetGB:0});assert.equal(r.metrics.taskReadyHour,null);assert.equal(r.metrics.energyOK,false);assert.match(r.metrics.reasons.join(' '),/cannot hold/);
});
test('threshold timing uses the physical charge rate even when capacity clips early',()=>{
 const r=calc({durationHours:1,energyDeadlineHours:1,dataDeadlineHours:1,stepMinutes:60,areaM2:100,batteryKWh:1,initialSocPct:0,reservePct:0,taskEnergyKWh:.5,dataTargetGB:0,loadW:0});
 const expected=500/(r.samples[0].powerW*D.chargeEfficiency);near(r.metrics.taskReadyHour,expected,1e-8);near(r.metrics.jointReadyHour,expected,1e-8);balance(r.metrics);
});
test('reserve crossing uses physical discharge rate even when battery empties during the interval',()=>{
 const r=calc({durationHours:1,energyDeadlineHours:1,dataDeadlineHours:1,stepMinutes:60,areaM2:0,batteryKWh:1,initialSocPct:50,reservePct:20,loadW:1000,taskEnergyKWh:0,dataTargetGB:0});near(r.metrics.firstReserveBreachHour,.3*D.dischargeEfficiency);balance(r.metrics);
});
test('scheduled payload edges are integrated exactly for a constant solar fixture',()=>{
 const common={durationHours:3,energyDeadlineHours:3,dataDeadlineHours:3,stepMinutes:60,dataTargetGB:0,loadW:0,payloadStartHours:.25,payloadDurationHours:.5};
 const a=calc({...common,payloadW:200}),b=calc({...common,payloadW:0});near(a.metrics.loadKWh-b.metrics.loadKWh,.1);balance(a.metrics);
});
test('data delivered after its deadline does not pass the deadline check',()=>{
 const r=calc({dataDeadlineHours:.01,dataTargetGB:.1,maxRateMbps:.02,initialSocPct:90});near(r.metrics.deliveredGB,.1);assert.ok(r.metrics.dataAtDeadlineGB<.1);assert.equal(r.metrics.commOK,false);
});
test('next-event result does not claim permanent illumination outside the selected interval',()=>{
 const a=eventCountdown([[0,10]],1,10);assert.equal(a.visible,true);assert.equal(a.hours,null);const b=eventCountdown([[5,8]],1,10);near(b.hours,4);assert.equal(b.next,'rises');
});
test('invalid mission values and unsupported station identifiers are rejected',()=>{
 assert.throws(()=>calc({taskEnergyKWh:-1}),/taskEnergy/);assert.throws(()=>calc({dataDeadlineHours:25}),/dataDeadline/);assert.throws(()=>calc({stationId:'invented'}),/station/);assert.throws(()=>calc({payloadW:10,payloadStartHours:23,payloadDurationHours:2}),/schedule/);
});
const real=JSON.parse(readFileSync(new URL('../web/data/lunar-data.json',import.meta.url)));
test('all three packaged real sites conserve energy and produce finite geometry',()=>{
 for(const site of real.sites){const r=computeMission(real,{siteId:site.id});balance(r.metrics);assert.ok(r.samples.every(p=>Number.isFinite(p.earthElDeg)&&Number.isFinite(p.groundElevationDeg)&&p.sunFraction>=0&&p.sunFraction<=1));}
});
test('prepared Crest date change gives a computed powered DTE example',()=>{
 const before=computeMission(real,{siteId:'ridge-crest'}),after=computeMission(real,{siteId:'ridge-crest',startUTC:'2026-11-14T00:00:00Z'});
 assert.equal(before.metrics.commOK,false);assert.equal(after.metrics.feasible,true);near(after.metrics.deliveredGB,1);assert.ok(after.metrics.radioKWh>0);balance(after.metrics);
});
test('classic Worker bundle matches the tested source modules',()=>{
 const messages=[];const context={self:{postMessage:m=>messages.push(m)}};vm.runInNewContext(readFileSync(new URL('../web/worker.bundle.js',import.meta.url),'utf8'),context);
 context.self.onmessage({data:{type:'init',bundle:fixture()}});context.self.onmessage({data:{type:'calculate',id:7,settings:conf({})}});
 const actual=messages.find(m=>m.type==='result');assert.ok(actual);near(actual.result.metrics.energyKWh,calc().metrics.energyKWh);near(actual.result.metrics.deliveredGB,calc().metrics.deliveredGB);
});

test('visibility windows interpolate signed crossing times instead of discarding boundary intervals',()=>{
 const p=[{elapsedHours:0,c:-2},{elapsedHours:3,c:1},{elapsedHours:6,c:-2}];
 const w=windowsFromSamples(p,'c',0);assert.equal(w.length,1);near(w[0][0],2);near(w[0][1],4);
});

test('WebGL scene module resolves only its locally bundled dependencies',async()=>{
 const scene=await import('../web/scene.js');assert.equal(typeof scene.MoonScene,'function');
});
