import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tangentFrame,pointInFrame,worldToLocal,localToWorld,directionInFrame,terrainScene,panelNormal,sampleAtHour,dataFlowVisible,dot,sameScenarioSettings} from '../web/visual-geometry.js';
const bundle=JSON.parse(fs.readFileSync(new URL('../web/data/lunar-data.json',import.meta.url),'utf8'));
const crest=bundle.sites.find(s=>s.id==='ridge-crest'),shoulder=bundle.sites.find(s=>s.id==='ridge-shoulder');
const rec=(site,role)=>({role,result:{site,settings:{heightM:2}}});
const close=(a,b,t=1e-8)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
test('display local frames are orthonormal at south-pole sites',()=>{for(const s of bundle.sites){const f=tangentFrame(s);for(const v of [f.east,f.north,f.up])close(Math.hypot(...v),1);close(dot(f.east,f.north),0);close(dot(f.east,f.up),0);close(dot(f.up,f.north),0);}});
test('display origin uses the physical site and terrain elevation',()=>{const f=tangentFrame(shoulder);pointInFrame(shoulder,f).forEach(x=>close(x,0));});
test('display projection round-trips a supplied radial terrain height',()=>{const f=tangentFrame(shoulder),world=localToWorld(700,-400,1825,f),p=worldToLocal(world,f);close(p[0],700,1e-6);close(p[1],-400,1e-6);close(Math.hypot(...world)-1737400,1825,1e-6);});
test('two different site glyphs occupy different geographic locations',()=>{const p=pointInFrame(crest,tangentFrame(shoulder));assert.ok(Math.hypot(p[0],p[1])>1500&&Math.hypot(p[0],p[1])<1700);});
test('changing only the date preserves one physical location',()=>{const g=terrainScene(bundle,[rec(crest,'current'),rec(crest,'alternative')]);assert.ok(g.sameSite);assert.deepEqual(g.points[0].p,g.points[1].p);assert.ok(g.hasTerrain);});
test('combined display terrain uses finite supplied mesh geometry',()=>{const g=terrainScene(bundle,[rec(shoulder,'current'),rec(crest,'alternative')]);assert.ok(!g.sameSite);assert.ok(g.triangles.length>5000);for(const t of g.triangles)assert.ok(t.every(i=>g.vertices[i]?.every(Number.isFinite)));assert.ok(g.span>3000&&g.span<6500);});
test('an imported horizon without a display mesh does not invent terrain',()=>{const s={...crest,id:'test-import',mesh:undefined};const g=terrainScene({sites:[s]},[rec(s,'current')]);assert.equal(g.hasTerrain,false);assert.equal(g.triangles.length,0);});
test('local direction stays normalized in the shared comparison frame',()=>{const f=tangentFrame(shoulder);for(const az of [0,90,180,270])close(Math.hypot(...directionInFrame(crest,f,az,-2)),1);});
test('tracking panel normal points toward the selected local Sun',()=>{const p={sunAzDeg:75,sunElDeg:2},n=panelNormal({panelMode:'tracking'},p),d=directionInFrame(crest,tangentFrame(crest),75,2);close(dot(n,d),1);});
test('horizontal array normal remains vertical',()=>{const n=panelNormal({panelMode:'horizontal'},{sunAzDeg:234,sunElDeg:1});n.forEach((v,i)=>close(v,[0,0,1][i]));});
test('data symbols require modeled transmission as well as link availability',()=>{assert.equal(dataFlowVisible({linkAvailable:1,actualTxMbps:0}),false);assert.equal(dataFlowVisible({linkAvailable:0,actualTxMbps:.8}),false);assert.equal(dataFlowVisible({linkAvailable:1,actualTxMbps:.8}),true);assert.equal(dataFlowVisible(null),false);});
test('comparison sample lookup uses elapsed time, not a false common UTC',()=>{const make=d=>({settings:{stepMinutes:5},samples:Array.from({length:4},(_,i)=>({utc:new Date(Date.UTC(2026,10,d,0,i*5)).toISOString(),elapsedHours:i/12}))});const a=sampleAtHour(make(7),1/6),b=sampleAtHour(make(10),1/6);assert.equal(a.elapsedHours,b.elapsedHours);assert.equal(Date.parse(b.utc)-Date.parse(a.utc),3*86400000);assert.equal(sampleAtHour(make(7),999).elapsedHours,.25);});
test('scenario equality is independent of key insertion order',()=>{assert.ok(sameScenarioSettings({area:1,date:'A'},{date:'A',area:1}));assert.ok(!sameScenarioSettings({area:1},{area:2}));});

const triangleArea=(a,b,c)=>Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;
const sceneArea=g=>g.triangles.reduce((sum,t)=>sum+triangleArea(...t.map(i=>g.vertices[i])),0);
test('rotated terrain retains its full supplied boundary instead of grid stair steps',()=>{
 const low={...bundle.sites.find(s=>s.id==='ridge-low'),mesh:undefined};
 const g=terrainScene({sites:[low,crest]},[rec(low,'current'),rec(crest,'alternative')]);
 const m=crest.mesh,frame=tangentFrame(crest),base=tangentFrame(low);
 const at=(c,r)=>worldToLocal(localToWorld(m.origin_x_m+c*m.spacing_m,m.origin_y_m+r*m.spacing_m,m.elevations_m[r][c],frame),base);
 let expected=0;
 for(let r=0;r<m.height-1;r+=2)for(let c=0;c<m.width-1;c+=2){
  const a=at(c,r),b=at(c+2,r),d=at(c,r+2),f=at(c+2,r+2);
  expected+=triangleArea(a,b,d)+triangleArea(b,f,d);
 }
 close(sceneArea(g),expected,1e-4);
 for(const [c,r] of [[0,0],[150,0],[0,150],[150,150]]){
  const corner=at(c,r);assert.ok(g.vertices.some(p=>Math.hypot(...p.map((v,i)=>v-corner[i]))<1e-6),'The native patch corner must be retained');
 }
});
const patch=(id,originX,width=4,rowOrder='south_to_north')=>({id,name:id,latitude_deg:-89,longitude_deg:0,ground_elevation_m:0,mesh:{width,height:4,spacing_m:20,origin_x_m:originX,origin_y_m:rowOrder==='north_to_south'?60:0,row_order:rowOrder,elevations_m:Array.from({length:4},()=>Array(width).fill(0))}});
test('overlapping display patches cover their union exactly once',()=>{
 const a=patch('a',0),b=patch('b',30,4,'north_to_south');
 const g=terrainScene({sites:[a,b]},[rec(a,'current'),rec(b,'alternative')]);
 close(sceneArea(g),90*60,1e-5);
 // Each original flat-grid corner survives despite the non-divisible stride.
 close(g.max[0],90,1e-6);close(g.max[1],60,1e-6);
});
test('a gap between supplied patches remains empty',()=>{
 const a=patch('a',0),b=patch('b',90);
 const g=terrainScene({sites:[a,b]},[rec(a,'current'),rec(b,'alternative')]);
 close(sceneArea(g),2*60*60,1e-5);
 for(const t of g.triangles){const xs=t.map(i=>g.vertices[i][0]);assert.ok(Math.max(...xs)<=60+1e-6||Math.min(...xs)>=90-1e-6);}
});
test('missing source samples stay holes and can be covered by a second valid patch',()=>{
 const a=patch('a',0),b=patch('b',0);a.mesh.elevations_m[1][1]=null;
 const missing=terrainScene({sites:[a]},[rec(a,'current')]);
 assert.ok(sceneArea(missing)<3600);
 const filled=terrainScene({sites:[a,b]},[rec(a,'current'),rec(b,'alternative')]);
 close(sceneArea(filled),3600,1e-5);
});
test('an entirely missing display mesh reports no terrain and finite fallback bounds',()=>{
 const a=patch('a',0);a.mesh.elevations_m.forEach(row=>row.fill(null));
 const g=terrainScene({sites:[a]},[rec(a,'current')]);
 assert.equal(g.hasTerrain,false);assert.ok([...g.min,...g.max,...g.center,g.span].every(Number.isFinite));
});
