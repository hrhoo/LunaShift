import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const src=app.slice(app.indexOf('async function detectServer()'),app.indexOf('async function runOnlineCheck'));
async function run(protocol,fetch){
 const elements=new Map(), state={serverOnline:null};
 const context=vm.createContext({location:{protocol},state,AbortSignal,fetch,$:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);}});
 await vm.runInContext(src+';detectServer()',context);
 return {state,elements};
}
test('Standalone HTML does not try to call a missing API and explains the launcher',async()=>{
 let calls=0;const r=await run('file:',async()=>{calls++;throw new Error('must not fetch');});
 assert.equal(calls,0);assert.equal(r.state.serverOnline,false);assert.equal(r.elements.get('onlineCheck').disabled,true);
 assert.match(r.elements.get('onlineCheckResult').textContent,/python3 run.py/);
});
test('Compatible local API enables the check without claiming JPL is reachable',async()=>{
 const r=await run('http:',async(url)=>{assert.equal(url,'/api/health');return {ok:true,json:async()=>({ok:true,online_horizons:true})};});
 assert.equal(r.state.serverOnline,true);assert.equal(r.elements.get('onlineCheck').disabled,false);
 assert.match(r.elements.get('dataWorkspaceDetail').textContent,/not yet been tested/);
});
test('A generic HTTP server is not reported as an online Horizons adapter',async()=>{
 const r=await run('http:',async()=>({ok:true,json:async()=>({ok:true})}));
 assert.equal(r.state.serverOnline,false);assert.equal(r.elements.get('onlineCheck').disabled,true);
 assert.match(r.elements.get('onlineCheckResult').textContent,/generic web server/);
});
test('A failed local health request does not disable offline calculations',async()=>{
 const r=await run('https:',async()=>{throw new Error('unreachable');});
 assert.equal(r.state.serverOnline,false);
 assert.match(r.elements.get('dataWorkspaceDetail').textContent,/Mission calculations remain available/);
});
const onlineSrc=app.slice(app.indexOf('async function runOnlineCheck'),app.indexOf('function download('));
async function onlineRun(fetch,overrides={}){
 const elements=new Map(), state={serverOnline:true,dirty:false,current:{site:{id:'test',name:'test',latitude_deg:-89,longitude_deg:0,ground_elevation_m:0},settings:{startUTC:'2026-11-08T00:00:00Z',heightM:2,antennaHeightM:3}},bundle:{},...overrides};
 const context=vm.createContext({state,fetch,inspected:()=>state.role==='alternative'&&state.alternative?state.alternative:state.current,esc:String,date:x=>x,skyAt:()=>({sunAzDeg:1,sunElDeg:2,earthAzDeg:3,earthElDeg:4}),angularDifference:(a,b)=>Math.abs(a-b),nf:(n,d)=>n.toFixed(d),Date,JSON,$:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);}});
 await vm.runInContext(onlineSrc+';runOnlineCheck()',context);return {state,elements};
}
test('Failed online check updates the connection message and retains packaged-data status',async()=>{
 const r=await onlineRun(async()=>({ok:false,json:async()=>({error:'Network unavailable'})}));
 assert.match(r.elements.get('dataWorkspaceDetail').textContent,/latest online check failed/);
 assert.match(r.elements.get('onlineCheckResult').textContent,/included data/);
 assert.equal(r.elements.get('onlineCheckResult').className,'online-result error');
 assert.equal(r.elements.get('onlineCheck').disabled,false);
});
test('Successful response updates the connection message without replacing mission data',async()=>{
 const r=await onlineRun(async()=>({ok:true,json:async()=>({rows:[{sun_azimuth_deg:1,sun_elevation_deg:2,earth_azimuth_deg:3,earth_elevation_deg:4}]})}));
 assert.match(r.elements.get('dataWorkspaceDetail').textContent,/latest JPL request succeeded/);
 assert.equal(r.elements.get('onlineCheckResult').className,'online-result success');
 assert.deepEqual(r.state.bundle,{});
});

test('Online comparison sends separate collector and antenna heights',async()=>{
 let sent;await onlineRun(async(_,opt)=>{sent=JSON.parse(opt.body);return {ok:true,json:async()=>({rows:[{sun_azimuth_deg:1,sun_elevation_deg:2,earth_azimuth_deg:3,earth_elevation_deg:4}]})};});
 assert.equal(sent.collector_height_m,2);assert.equal(sent.antenna_height_m,3);
});
test('Large returned discrepancy is not styled as a matching validation',async()=>{
 const r=await onlineRun(async()=>({ok:true,json:async()=>({rows:[{sun_azimuth_deg:20,sun_elevation_deg:2,earth_azimuth_deg:3,earth_elevation_deg:4}]})}));
 assert.equal(r.elements.get('onlineCheckResult').className,'online-result warning');assert.match(r.elements.get('onlineCheckResult').innerHTML,/Differences exceed/);
});
test('The inspected alternative is independently checked at its own date',async()=>{
 let sent;const alternative={site:{id:'B',name:'B',latitude_deg:-89.5,longitude_deg:20,ground_elevation_m:100},settings:{startUTC:'2026-11-10T00:00:00Z',heightM:10,antennaHeightM:5}};
 await onlineRun(async(_,opt)=>{sent=JSON.parse(opt.body);return {ok:false,json:async()=>({error:'test'})};},{role:'alternative',alternative});
 assert.equal(sent.site.id,'B');assert.equal(sent.start_utc,alternative.settings.startUTC);assert.equal(sent.collector_height_m,10);assert.equal(sent.antenna_height_m,5);
});
