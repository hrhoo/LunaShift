/** Decision support over the existing v7 scientific model.
 * This module changes neither terrain, ephemeris nor the energy/radio physics.
 * Rankings are explicit lexicographic comparisons, never a hidden weighted score.
 */
const finite=(n,fallback=Infinity)=>Number.isFinite(n)?n:fallback;
export const SEARCH_DEFAULTS=Object.freeze({mode:'sites',maxDelayDays:14,stepDays:1,priority:'reserve'});
export const PRIORITY_LABELS=Object.freeze({reserve:'Highest minimum battery',ready:'Earliest joint readiness',link:'Longest ground-station access',distance:'Smallest relocation'});
export function missionChecks(m,s){
 return [
  {id:'task',label:'Task energy',pass:m.taskReadyHour!==null && Number.isFinite(m.taskReadyHour) && m.taskReadyHour<=s.energyDeadlineHours+1e-8},
  {id:'reserve',label:'Battery reserve',pass:s.batteryKWh===0 || s.batteryKWh*1000*m.minSocPct/100>=s.batteryKWh*1000*s.reservePct/100-.001},
  {id:'load',label:'Load supplied',pass:m.unservedKWh<1e-6},
  {id:'data',label:'Data deadline',pass:m.dataAtDeadlineGB>=s.dataTargetGB-1e-8},
 ];
}
export function invariantWarnings(s){
 const warnings=[];const usable=s.batteryKWh*(1-s.reservePct/100);
 if(s.taskEnergyKWh>usable+1e-8)warnings.push({id:'capacity',title:'No location can fix the storage limit.',text:`Your task needs ${s.taskEnergyKWh.toFixed(2)} kWh above reserve, but this battery can hold only ${usable.toFixed(2)} kWh above reserve. Increase battery capacity or reduce the task-energy requirement first.`,field:'batteryKWh'});
 if(s.batteryKWh>0 && s.initialSocPct<s.reservePct-1e-8)warnings.push({id:'initial',title:'The battery already starts below reserve.',text:`Initial charge is ${s.initialSocPct}%, below the ${s.reservePct}% minimum. Every site fails the whole-mission reserve check at landing. Review initial charge or reserve first.`,field:'initialSocPct'});
 return warnings;
}
export function lunarDistanceKm(a,b){
 const d=Math.PI/180,p=a.latitude_deg*d,q=b.latitude_deg*d,dp=q-p,dl=(b.longitude_deg-a.longitude_deg)*d;
 const h=Math.sin(dp/2)**2+Math.cos(p)*Math.cos(q)*Math.sin(dl/2)**2;
 return 2*1737.4*Math.asin(Math.sqrt(Math.min(1,Math.max(0,h))));
}
export function buildSearchPlan(bundle,settings,input={}){
 const options={...SEARCH_DEFAULTS,...input};
 if(!['sites','dates','both'].includes(options.mode))throw new Error('Choose locations, dates, or both.');
 if(!Object.hasOwn(PRIORITY_LABELS,options.priority))throw new Error('Choose a supported ranking priority.');
 const baseSite=bundle.sites.find(s=>s.id===settings.siteId);
 if(!baseSite)throw new Error('The selected location is not in the loaded terrain dataset.');
 const start=Date.parse(settings.startUTC);if(!Number.isFinite(start))throw new Error('Choose a valid landing time.');
 const sites=options.mode==='dates'?[baseSite]:bundle.sites;
 let delays=[0];
 if(options.mode!=='sites'){
  if(!Number.isInteger(options.maxDelayDays)||options.maxDelayDays<0||options.maxDelayDays>60)throw new Error('Maximum delay must be a whole number from 0 to 60 days.');
  if(![1,2,7].includes(options.stepDays))throw new Error('Date spacing must be 1, 2, or 7 days.');
  for(let day=options.stepDays;day<=options.maxDelayDays;day+=options.stepDays)delays.push(day);
  if(delays.at(-1)!==options.maxDelayDays)delays.push(options.maxDelayDays);
 }
 if(sites.length*delays.length>300)throw new Error('This search exceeds 300 combinations. Reduce the date range or increase date spacing.');
 return sites.flatMap(site=>delays.map(delay=>({siteId:site.id,name:site.name,latitude_deg:site.latitude_deg,longitude_deg:site.longitude_deg,delay,distanceKm:lunarDistanceKm(baseSite,site),isBaseline:site.id===settings.siteId&&delay===0,settings:{...settings,siteId:site.id,startUTC:new Date(start+delay*86400000).toISOString()}})));
}
export function failureCount(choice){return choice.metrics?missionChecks(choice.metrics,choice.settings).filter(c=>!c.pass).length:Infinity;}
export function priorityValue(c,priority){
 if(!c.metrics)return Infinity;
 if(priority==='ready')return finite(c.metrics.jointReadyHour);
 if(priority==='link')return -finite(c.metrics.linkHours,-Infinity);
 if(priority==='distance')return finite(c.distanceKm);
 return -finite(c.metrics.minSocPct,-Infinity);
}
export function rankChoices(choices,priority='reserve'){
 const compareNumber=(x,y)=>x===y?0:x<y?-1:1;
 return [...choices].sort((a,b)=>compareNumber(failureCount(a),failureCount(b))||compareNumber(priorityValue(a,priority),priorityValue(b,priority))||compareNumber(a.delay,b.delay)||compareNumber(a.distanceKm,b.distanceKm)||Number(!!b.isBaseline)-Number(!!a.isBaseline)||a.name.localeCompare(b.name));
}
export function recommendChoice(choices,baseline,priority='reserve'){
 const ordered=rankChoices(choices,priority);
 const options=ordered.filter(c=>!c.isBaseline&&c.metrics&&failureCount(c)===0);
 if(!options.length)return null;
 if(!baseline?.metrics||failureCount(baseline)>0)return options[0];
 // Avoid presenting sampling-level ties as meaningful improvements.
 const tolerance=priority==='reserve'?.1:priority==='distance'?.001:.05;
 return options.find(c=>priorityValue(c,priority)<priorityValue(baseline,priority)-tolerance)||null;
}
