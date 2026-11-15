/** Presentation-only decision helpers. The existing science engine is authoritative. */
export function samePlan(a,b){
 if(!a||!b)return false;const x=a.settings||a,y=b.settings||b,keys=Object.keys(x);
 if(keys.length!==Object.keys(y).length)return false;
 return keys.every(k=>Object.hasOwn(y,k)&&(k==='startUTC'?Number.isFinite(Date.parse(x[k]))&&Date.parse(x[k])===Date.parse(y[k]):x[k]===y[k]));
}
export function shiftedSettings(settings,amount,unit='days'){
 const value=Number(amount);if(!Number.isFinite(value)||value<0||value>336)throw new RangeError('Enter a delay between 0 and 336 '+unit+'.');
 if(!['days','hours'].includes(unit))throw new RangeError('Choose hours or days.');
 const ms=Date.parse(settings.startUTC);if(!Number.isFinite(ms))throw new Error('The landing date is invalid.');
 return {...settings,startUTC:new Date(ms+value*(unit==='days'?86400000:3600000)).toISOString()};
}
export function checkedUTC(value){
 if(!/^202[67]-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw new Error('Choose a complete UTC date and time in 2026 or 2027.');
 const date=new Date(value+':00Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,16)!==value)throw new Error('Choose a valid calendar date.');
 return date.toISOString();
}
export function outcomeTitle(r,trial=false){
 if(r.metrics.feasible)return trial?'The revised plan still works.':'Your current plan works.';
 return trial?'This change needs an alternative.':'Your plan needs attention.';
}
export function checkRows(r){
 const m=r.metrics,s=r.settings,until=m.completeHour===null?s.durationHours:m.completeHour;
 const batteryOK=m.firstReserveHour===null||m.firstReserveHour>until+1e-7;
 const outageOK=m.firstOutageHour===null||m.firstOutageHour>until+1e-7;
 return [
  {key:'science',icon:'flask',label:'Measurement completed',pass:m.scienceEndHour!==null,event:'science'},
  {key:'data',icon:'data',label:'Data returned by deadline',pass:m.completeHour!==null&&m.completeHour<=s.deadlineHours+1e-7,event:'complete'},
  {key:'reserve',icon:'battery',label:'Energy reserve maintained until completion',pass:batteryOK&&outageOK,event:'ready'}
 ];
}
export function orderedAlternatives(choices,reference){
 return choices.filter(c=>c.metrics&&!samePlan(c.settings,reference)).sort((a,b)=>Number(b.metrics.feasible)-Number(a.metrics.feasible)||a.delay-b.delay||a.distanceKm-b.distanceKm||(a.metrics.completeHour??Infinity)-(b.metrics.completeHour??Infinity));
}
export function changeSummary(a,b){
 const hours=(Date.parse(b.startUTC)-Date.parse(a.startUTC))/3600000;
 const hardwareKeys=['areaM2','panelMode','batteryKWh','initialSocPct','reservePct','loadW','stationId','txPowerW','txGainDbi','maxRateMbps','heightM','tiltDeg','azimuthDeg','efficiency'];
 const taskKeys=['scienceMinutes','scienceW','dataMB','deadlineHours','durationHours'];
 return {hours,siteChanged:a.siteId!==b.siteId,hardwareFixed:hardwareKeys.every(k=>a[k]===b[k]),taskFixed:taskKeys.every(k=>a[k]===b[k])};
}
