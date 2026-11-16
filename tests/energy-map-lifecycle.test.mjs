import test from 'node:test';
import assert from 'node:assert/strict';
import {EnergyMapView} from '../components/manual-planner/solar-energy/energy-map-view.js';

function setup(t) {
  const elements=new Map();
  const globals={
    document:{getElementById(id){
      if(!elements.has(id))elements.set(id,Object.assign(new EventTarget(),{value:'3',setAttribute(){}}));
      return elements.get(id);
    }},
    ResizeObserver:class {
      observe(){}
      disconnect(){this.disconnected=true;}
    },
    Worker:class {
      postMessage(){}
      terminate(){this.terminated=true;}
    },
  };
  for(const [name,value]of Object.entries(globals)){
    const descriptor=Object.getOwnPropertyDescriptor(globalThis,name);
    Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
    t.after(()=>{if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];});
  }
  const view=new EnergyMapView(()=>({}));
  view.plan={settings:{}};
  return {view,elements,detach(){globalThis.document.getElementById=()=>null;}};
}

for(const running of [false,true])test(`destroy after DOM removal is safe with calculation ${running?'running':'idle'}`,async t=>{
  const {view,elements,detach}=setup(t);
  const pending=running?view.generate():null,worker=view.worker,sequence=view.sequence;
  const status=elements.get('energyMapStatus')?.textContent;
  detach();
  assert.doesNotThrow(()=>view.destroy());
  await pending;
  assert.equal(view.running,false);
  assert.equal(view.sequence,sequence+1);
  assert.equal(view.worker,null);
  assert.equal(view.reject,null);
  if(worker)assert.equal(worker.terminated,true);
  assert.equal(view.controller.signal.aborted,true);
  assert.equal(view.resize.disconnected,true);
  assert.equal(elements.get('energyMapStatus')?.textContent,status);
  assert.doesNotThrow(()=>view.destroy());
});

test('cancel while mounted resets the controls and allows another calculation',async t=>{
  const {view,elements}=setup(t);
  const pending=view.generate(),worker=view.worker;
  view.cancel();
  await pending;
  assert.equal(worker.terminated,true);
  assert.equal(view.running,false);
  assert.equal(elements.get('generateEnergyMap').disabled,false);
  assert.equal(elements.get('cancelEnergyMap').hidden,true);
  assert.equal(elements.get('energyMapProgress').hidden,true);
  assert.match(elements.get('energyMapStatus').textContent,/Calculation cancelled/);
  view.destroy();
});
