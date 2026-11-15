import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareTerrainRelief,sampleTerrainRelief,reliefColor} from '../components/manual-planner/solar-energy/terrain-relief.js';
function mesh(fn=()=>0){return {width:3,height:3,spacing_m:20,origin_x_m:-20,origin_y_m:-20,row_order:'south_to_north',elevations_m:Array.from({length:3},(_,r)=>Array.from({length:3},(_,c)=>fn((c-1)*20,(r-1)*20)))};}
test('flat DEM has neutral uniform relief without invented texture',()=>{
 const m=mesh(),before=structuredClone(m),relief=prepareTerrainRelief(m);
 assert.ok([...relief.values].every(v=>Math.abs(v-.5)<1e-6));assert.deepEqual(m,before);
 assert.equal(sampleTerrainRelief(relief,0,0),.5);
});
test('northwest-facing slopes are lit more than southeast-facing slopes',()=>{
 const nw=prepareTerrainRelief(mesh((x,y)=>(x-y)*.2)),se=prepareTerrainRelief(mesh((x,y)=>(y-x)*.2));
 assert.ok(sampleTerrainRelief(nw,0,0)>.5);assert.ok(sampleTerrainRelief(se,0,0)<.5);
});
test('row order preserves geographic alignment and does not mirror north',()=>{
 const m=mesh((x,y)=>x*x*.005+y*y*.008),northFirst={...m,origin_y_m:20,row_order:'north_to_south',elevations_m:[...m.elevations_m].reverse()};
 const a=prepareTerrainRelief(m),b=prepareTerrainRelief(northFirst);
 for(const y of [-20,-10,0,10,20])for(const x of [-20,0,20])assert.ok(Math.abs(sampleTerrainRelief(a,x,y)-sampleTerrainRelief(b,x,y))<1e-6);
});
test('missing and out-of-bounds DEM coverage are never filled',()=>{
 const m=mesh();m.elevations_m[1][1]=null;const relief=prepareTerrainRelief(m);
 assert.equal(sampleTerrainRelief(relief,0,0),null);assert.equal(sampleTerrainRelief(relief,21,0),null);
 assert.equal(prepareTerrainRelief({...m,row_order:'unknown'}),null);assert.equal(prepareTerrainRelief(null),null);
});
test('relief changes display colors without mutating energy colors',()=>{
 const rgb=[53,42,135],before=[...rgb];assert.notDeepEqual(reliefColor(rgb,.2),reliefColor(rgb,.8));
 assert.deepEqual(rgb,before);assert.deepEqual(reliefColor(rgb,null),rgb);
 const gray=reliefColor(rgb,.5,true);assert.equal(gray[0],gray[1]);assert.equal(gray[1],gray[2]);
});
