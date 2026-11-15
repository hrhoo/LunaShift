import {evaluate, latestStart, distanceKm} from './core/rehearsal.js';
let bundle;
self.onmessage=async({data:m})=>{
 try{
  if(m.type==='init'){bundle=m.bundle;postMessage({id:m.id,ok:true,result:true});return;}
  if(!bundle)throw new Error('Scientific data is not loaded.');
  if(m.type==='evaluate')postMessage({id:m.id,ok:true,result:evaluate(bundle,m.settings)});
  else if(m.type==='latest')postMessage({id:m.id,ok:true,result:latestStart(bundle,m.settings,15)});
  else if(m.type==='search'){
   const sites=m.mode==='date'?[bundle.sites.find(x=>x.id===m.settings.siteId)]:bundle.sites;
   const shifts=m.mode==='site'?[0]:[0,1,2,3,4,5,6];const original=bundle.sites.find(x=>x.id===m.settings.siteId),choices=[];
   for(const site of sites)for(const delay of shifts){
    const settings={...m.settings,siteId:site.id,startUTC:new Date(Date.parse(m.settings.startUTC)+delay*86400000).toISOString()};
    try{const r=evaluate(bundle,settings);choices.push({settings,site:r.site,metrics:r.metrics,delay,distanceKm:distanceKm(site,original)});}
    catch(error){choices.push({settings,site:{id:site.id,name:site.name},delay,error:error.message});}
    postMessage({id:m.id,progress:choices.length/(sites.length*shifts.length)});
   }
   postMessage({id:m.id,ok:true,result:choices});
  }
 }catch(error){postMessage({id:m.id,ok:false,error:error.message});}
};
