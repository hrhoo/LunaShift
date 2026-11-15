import test from 'node:test';
import assert from 'node:assert/strict';
import {computeEnergyMap,energyMapCSV} from '../components/manual-planner/solar-energy/core/energy-map.js';
import {prepareScattering,scatteringForObserver,scatteredIrradiance,tracedDirectIrradiance} from '../components/manual-planner/solar-energy/core/scattered-light.js';
import {DEFAULT_SETTINGS,solarGeometry} from '../components/manual-planner/solar-energy/core/solar-model.js';

const R=1737400,AU=149597870.7;
const near=(a,b,tol=1e-6)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
function fixture() {
  const distances=[5,100,1000,10000],az=Array.from({length:32},(_,i)=>i*360/32);
  const site={id:'flat',name:'Controlled plane',latitude_deg:0,longitude_deg:0,ground_elevation_m:0,
    terrain:{kind:'rays',frame:'MOON_ME_DE421',radius_m:R,azimuth_deg:az,distances_m:distances,
      elevations_m:az.map(()=>distances.map(d=>R/Math.cos(d/R)-R))}};
  const sun=[R/1000+AU,0,0],earth=[0,384400,0];
  return {sites:[site],ephemeris:{start_utc:'2026-01-01T00:00:00Z',step_seconds:7200,frame:'MOON_ME_DE421',
    sun_positions_km:[sun,sun],earth_positions_km:[earth,earth]}};
}
const settings={...DEFAULT_SETTINGS,siteId:'flat',startUTC:'2026-01-01T00:00:00Z',durationHours:1,
  terrainReflectance:.12,scatterResolution:8,scatterTerrainStride:1,scatterSunSamples:7,panelMode:'fixed',tiltDeg:180,azimuthDeg:0,
  areaM2:2,efficiency:.3,lossFactor:.8};
const options={gridSize:3,extentM:100,stepMinutes:30,terrainStride:1};

test('each map node receives independently computed direct and reflected energy',async()=>{
  const b=fixture(),before=structuredClone(b),events=[];
  const map=await computeEnergyMap(b,settings,options,p=>events.push(p));
  assert.equal(map.cells.length,9);assert.equal(map.statistics.validCount,9);
  for(const c of map.cells){near(c.totalKWhM2,c.directKWhM2+c.reflectedKWhM2);assert.ok(c.reflectedKWhM2>0);assert.ok(c.directKWhM2<1e-10);}
  near(map.cells[4].reflectedKWhM2,1361*.12*.3*.8/1000);
  assert.equal(map.grid.spacingM,50);assert.equal(map.sampling.timeSamples,3);
  assert.equal(events.at(-1).fraction,1);assert.deepEqual(b,before);
});

test('map coordinates run north to south and rotate the observer basis',async()=>{
  const map=await computeEnergyMap(fixture(),settings,options),nw=map.cells[0],ne=map.cells[2],sw=map.cells[6];
  assert.ok(nw.latitudeDeg>sw.latitudeDeg);assert.ok(ne.longitudeDeg>nw.longitudeDeg);
  near(map.cells[4].latitudeDeg,0);near(map.cells[4].longitudeDeg,0);
});

test('energy density is independent of panel area, and doubles with time',async()=>{
  const b=fixture();
  const a=await computeEnergyMap(b,settings,options),bigger=await computeEnergyMap(b,{...settings,areaM2:4},options);
  near(a.cells[4].totalKWhM2,bigger.cells[4].totalKWhM2);
  const longer=await computeEnergyMap(b,{...settings,durationHours:2},options);
  near(longer.cells[4].totalKWhM2,2*a.cells[4].totalKWhM2);
});

test('zero reflectance disables only the reflected component',async()=>{
  const a=await computeEnergyMap(fixture(),{...settings,panelMode:'horizontal',terrainReflectance:0},options);
  near(a.cells[4].directKWhM2,1361*.3*.8/1000);near(a.cells[4].reflectedKWhM2,0);
});

test('fully dark maps are valid zero values, not missing coverage',async()=>{
  const b=fixture();b.ephemeris.sun_positions_km=[[R/1000-AU,0,0],[R/1000-AU,0,0]];
  const map=await computeEnergyMap(b,settings,options);
  assert.equal(map.statistics.max,0);assert.equal(map.statistics.validCount,9);assert.notEqual(map.bestIndex,null);
});

test('fractional final time intervals are retained',async()=>{
  const map=await computeEnergyMap(fixture(),{...settings,durationHours:1.25},options);
  assert.equal(map.endUTC,'2026-01-01T01:15:00.000Z');assert.equal(map.sampling.timeSamples,4);
  near(map.cells[4].reflectedKWhM2,1361*.12*.3*.8*1.25/1000);
});

test('invalid bounds and unsupported dates fail before producing a map',async()=>{
  for(const o of [{gridSize:4},{gridSize:51},{stepMinutes:0},{extentM:1},{scatterResolution:1}])
    await assert.rejects(computeEnergyMap(fixture(),settings,{...options,...o}));
  await assert.rejects(computeEnergyMap(fixture(),{...settings,durationHours:3},options),/outside/);
  await assert.rejects(computeEnergyMap(fixture(),{...settings,siteId:'unknown'},options),/prepared site/);
  await assert.rejects(computeEnergyMap(fixture(),{...settings,efficiency:NaN},options),/efficiency/);
});

test('cancellation stops without returning a partial map',async()=>{
  let stop=false;
  await assert.rejects(computeEnergyMap(fixture(),settings,options,p=>{if(p.completed===1)stop=true;},()=>stop),/cancelled/);
});

test('moving an observer reuses the surface but not its radiative cache',()=>{
  const b=fixture(),s={...settings,panelMode:'horizontal'},m=prepareScattering(b.sites[0],s);
  const other=scatteringForObserver(m,[0,0,2],[[1,0,0],[0,1,0],[0,0,1]],s);
  assert.equal(other.tracer,m.tracer);assert.notEqual(other.values,m.values);
  const g=solarGeometry(b,b.sites[0],settings.startUTC,2);
  near(scatteredIrradiance(m,g,s),scatteredIrradiance(other,g,s));
  near(tracedDirectIrradiance(other,g,s),1361,1e-4);
});

test('CSV exports physical coordinates, component values and sampling context',async()=>{
  const map=await computeEnergyMap(fixture(),settings,options),rows=energyMapCSV(map).split('\n');
  assert.equal(rows.length,10);assert.match(rows[0],/total_kWh_m2,direct_kWh_m2,reflected_kWh_m2/);
  const centre=rows[5].split(',');near(Number(centre[8]),map.cells[4].totalKWhM2*settings.areaM2);
  assert.equal(centre[10],map.startUTC);assert.equal(centre[12],'50');
});

test('module worker returns progress and a complete survey', async () => {
  const messages=[];
  globalThis.self={postMessage: message => messages.push(message)};
  try {
    await import('../components/manual-planner/solar-energy/energy-map-worker.js');
    await self.onmessage({data:{id:0,type:'init',bundle:fixture()}});
    await self.onmessage({data:{id:1,type:'energyMap',settings,options}});
    const result=messages.at(-1);
    assert.equal(result.ok,true,result.error);
    assert.equal(result.result.cells.length,9);
    assert.ok(messages.some(message=>message.progress===1));
    near(result.result.cells[4].reflectedKWhM2,1361*.12*.3*.8/1000);
  } finally { delete globalThis.self; }
});
