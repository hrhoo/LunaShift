import test from 'node:test';
import assert from 'node:assert/strict';
import {energyColor,mapDisplayValue} from '../components/manual-planner/solar-energy/energy-map-view.js';

const map=()=>({grid:{size:2},cells:[0,2,4,6].map(totalKWhM2=>({valid:true,totalKWhM2}))});
test('smooth display interpolates scalar energy and preserves calculated nodes',()=>{
  const m=map(),before=structuredClone(m);
  assert.equal(mapDisplayValue(m,'totalKWhM2',.5,.5),3);
  assert.equal(mapDisplayValue(m,'totalKWhM2',.25,.75),3.5);
  for(let y=0;y<2;y++)for(let x=0;x<2;x++)assert.equal(mapDisplayValue(m,'totalKWhM2',x,y),m.cells[y*2+x].totalKWhM2);
  assert.deepEqual(m,before);
});
test('display smoothing does not bridge missing coverage or turn it into zero',()=>{
  const m=map();m.cells[3]={valid:false,totalKWhM2:null};
  assert.equal(mapDisplayValue(m,'totalKWhM2',.5,.5),null);
  assert.equal(mapDisplayValue(m,'totalKWhM2',0,0),0);
  assert.equal(mapDisplayValue(m,'totalKWhM2',.5,0),1);
});
test('sample cell display uses the nearest actual result',()=>{
  assert.equal(mapDisplayValue(map(),'totalKWhM2',.49,.49,false),0);
  assert.equal(mapDisplayValue(map(),'totalKWhM2',.51,.51,false),6);
});
test('reference-style palette has purple and yellow endpoints and valid zero scale',()=>{
  assert.equal(energyColor(0,1),'rgb(53,42,135)');
  assert.equal(energyColor(1,1),'rgb(249,251,14)');
  assert.equal(energyColor(0,0),energyColor(0,1));
});
