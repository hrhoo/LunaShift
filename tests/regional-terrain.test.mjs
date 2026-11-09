import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {terrainScene,pointInFrame,tangentFrame} from '../web/visual-geometry.js';
import {fitTerrain,cameraBasis,chooseCamera} from '../web/camera-geometry.js';
const read=name=>JSON.parse(fs.readFileSync(new URL('../web/data/'+name,import.meta.url),'utf8'));
const legacy=read('lunar-data.json'),regional=read('regional-terrain.json'),bundle={...legacy,regionalTerrain:regional};
const rec=(site,role='current')=>({role,result:{site,settings:{heightM:2}}});
const byId=id=>bundle.sites.find(s=>s.id===id),low=byId('ridge-low'),crest=byId('ridge-crest');
const area=(a,b,c)=>Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;
test('regional surface covers the full rectangular crop without tile gaps or overlaps',()=>{
 const g=terrainScene(bundle,[rec(low),rec(crest,'alternative')]),m=regional.mesh;
 assert.equal(g.terrainKind,'regional');
 assert.equal(g.triangles.length,2*(m.width-1)*(m.height-1));
 const actual=g.triangles.reduce((s,t)=>s+area(...t.map(i=>g.vertices[i])),0);
 assert.ok(Math.abs(actual-(m.width-1)*(m.height-1)*m.spacing_m**2)<.01);
 // A connected rectangular mesh has boundary edges only on its four outer sides.
 const edges=new Map();for(const t of g.triangles)for(let k=0;k<3;k++){const key=[t[k],t[(k+1)%3]].sort((a,b)=>a-b).join(',');edges.set(key,(edges.get(key)||0)+1);}
 const outer=[...edges].filter(([,count])=>count===1);
 assert.equal(outer.length,2*(m.width+m.height-2));
 assert.ok([...edges.values()].every(n=>n===1||n===2));
});
test('all A/B combinations share the same regional frame and retain physical site positions',()=>{
 const original=JSON.stringify(regional),base=terrainScene(bundle,[rec(low),rec(crest,'alternative')]);
 for(const a of bundle.sites)for(const b of bundle.sites){
  const g=terrainScene(bundle,[rec(a),rec(b,'alternative')]);
  assert.deepEqual(g.min,base.min);assert.deepEqual(g.max,base.max);assert.deepEqual(g.frame,base.frame);
  for(const p of g.points){
   assert.deepEqual(p.p,pointInFrame(p.site,tangentFrame(regional.reference)));
   assert.ok(p.p[0]>g.min[0]+1500&&p.p[0]<g.max[0]-1500);
   assert.ok(p.p[1]>g.min[1]+1500&&p.p[1]<g.max[1]-1500);
  }
  assert.equal(g.sameSite,a.id===b.id);
 }
 assert.equal(JSON.stringify(regional),original);
});
test('unrelated or relocated imports use their supplied geometry instead of claiming regional coverage',()=>{
 for(const site of [{...crest,id:'import',mesh:undefined},{...crest,latitude_deg:-88,mesh:undefined}]){
  const g=terrainScene({...bundle,sites:[site]},[rec(site)]);
  assert.equal(g.terrainKind,'local');assert.equal(g.hasTerrain,false);
 }
 const imported={...low,id:'other-site'};
 const g=terrainScene({...bundle,sites:[...bundle.sites,imported]},[rec(crest),rec(imported,'alternative')]);
 assert.equal(g.terrainKind,'local');assert.ok(g.hasTerrain);
});
test('packaged regional provenance matches the recorded source and contains only finite elevations',()=>{
 const source=read('provenance.json').source_metadata.sources.find(s=>s.id==='lola-site01');
 assert.equal(regional.metadata.source_sha256,source.sha256);
 assert.equal(regional.metadata.source_resolution_m,5);assert.equal(regional.mesh.spacing_m,40);
 assert.equal(regional.mesh.elevations_m.length,regional.mesh.height);
 assert.ok(regional.mesh.elevations_m.every(row=>row.length===regional.mesh.width&&row.every(Number.isFinite)));
});
test('the full region and both markers fit the overview camera',()=>{
 const g=terrainScene(bundle,[rec(low),rec(crest,'alternative')]);
 for(const width of [380,850,1200])for(const map of [false,true]){
  const camera=chooseCamera(g,'wide','current'),b=map?cameraBasis(Math.PI,Math.PI/2):cameraBasis(camera.yaw,camera.pitch),f=fitTerrain(g,b,width,580,map);
  for(const p of [...g.vertices,...g.points.map(p=>p.p)]){
   const d=p.map((v,i)=>v-f.target[i]),dot=v=>v.reduce((s,x,i)=>s+x*d[i],0),x=f.centerX+dot(b.right)*f.scale,y=f.centerY-dot(b.up)*f.scale;
   assert.ok(x>=18&&x<=width-18&&y>=18&&y<=562);
  }
 }
});
const app=fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const loader=app.slice(app.indexOf('async function getBundle(){'),app.indexOf('async function route('));
test('app loader attaches regional display data and shares one load between views',async()=>{
 const calls=[],context=vm.createContext({bundlePromise:null,fetch:async path=>{calls.push(path);return {ok:true,json:async()=>path.includes('regional')?regional:legacy};}});
 vm.runInContext(loader,context);
 const [a,b]=await Promise.all([context.getBundle(),context.getBundle()]);
 assert.equal(a,b);assert.equal(a.regionalTerrain,regional);assert.equal(calls.length,2);
});
test('a failed regional asset can be retried without leaving a cached partial bundle',async()=>{
 let fail=true;const context=vm.createContext({bundlePromise:null,fetch:async path=>({ok:!(fail&&path.includes('regional')),json:async()=>path.includes('regional')?regional:legacy})});
 vm.runInContext(loader,context);
 await assert.rejects(context.getBundle());fail=false;
 assert.equal((await context.getBundle()).regionalTerrain,regional);
});

test('standalone embeds the exact regional asset and serves it without network access',async()=>{
 const html=fs.readFileSync(new URL('../LunaShift_Open.html',import.meta.url),'utf8');
 const embedded=id=>html.match(new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)</script>`))[1];
 assert.ok(JSON.stringify(JSON.parse(embedded('lunashift-embedded-regional')))===JSON.stringify(regional));
 const modules=JSON.parse(embedded('lunashift-embedded-assets')).modules;
 for(const name of ['app.js','visual-geometry.js','comparison-scene.js','camera-geometry.js']){
  assert.ok(modules.find(m=>m.name===name).source===fs.readFileSync(new URL('../web/'+name,import.meta.url),'utf8'),name+' must be rebuilt');
 }
 const fetchCode=html.slice(html.lastIndexOf(' window.fetch=async function'),html.lastIndexOf(' const urls={};'));
 const context=vm.createContext({window:{},Response,document:{getElementById:id=>({textContent:embedded(id)})},originalFetch:()=>{throw new Error('Offline data fetch reached the network');}});
 vm.runInContext(fetchCode,context);
 const response=await context.window.fetch('data/regional-terrain.json');
 assert.equal(response.status,200);assert.equal((await response.json()).id,regional.id);
});
