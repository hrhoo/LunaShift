import {computeMission} from './mission-model.js';
import {buildSearchPlan} from './decision-model.js';
let bundle;
const light=r=>({...r,site:{...r.site,terrain:undefined},provenance:r.provenance});
self.onmessage=({data})=>{
 try{
  if(data.type==='init'){bundle=data.bundle;self.postMessage({type:'ready'});return;}
  if(data.type==='addSite'){const i=bundle.sites.findIndex(s=>s.id===data.site.id);if(i>=0)bundle.sites[i]=data.site;else bundle.sites.push(data.site);self.postMessage({type:'siteAdded',id:data.id});return;}
  if(data.type==='calculate'){const result=computeMission(bundle,data.settings);self.postMessage({type:'result',id:data.id,result:light(result)});return;}
  if(data.type==='search'){
   const plan=buildSearchPlan(bundle,data.settings,data.options),choices=[];
   self.postMessage({type:'searchProgress',id:data.id,done:0,total:plan.length});
   for(const entry of plan){
    try{const r=computeMission(bundle,entry.settings);choices.push({...entry,settings:r.settings,metrics:r.metrics});}
    catch(e){choices.push({...entry,error:e.message});}
    self.postMessage({type:'searchProgress',id:data.id,done:choices.length,total:plan.length,name:entry.name,delay:entry.delay});
   }
   self.postMessage({type:'searchResult',id:data.id,choices});
  }
 }catch(e){self.postMessage({type:'error',id:data.id,message:e.message});}
};
