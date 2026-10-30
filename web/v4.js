'use strict';
/* Small usability layer for v0.5.0. Scientific calculations remain in the existing modules. */
(function(){
  const pad=n=>String(n).padStart(2,'0');
  const utcInputValue=date=>`${date.getUTCFullYear()}-${pad(date.getUTCMonth()+1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  const byId=id=>document.getElementById(id);
  function setTimeMode(mode){
    const now=byId('useCurrentTime'),custom=byId('chooseMissionDate'),note=byId('timeModeNote');
    if(!now||!custom||!note)return;
    now.classList.toggle('active',mode==='now');custom.classList.toggle('active',mode!=='now');
    if(mode==='now'){
      note.innerHTML='<b>Current UTC</b><span>The platform uses the current clock time. Real results still require terrain and ephemerides covering this moment. This is not spacecraft telemetry.</span>';
    }else{
      const value=byId('start')?.value;
      const date=value?new Date(value+'Z'):null;
      const relation=date&&Number.isFinite(date.getTime())?(date.getTime()>Date.now()+60000?'Future mission date':date.getTime()<Date.now()-60000?'Past mission date':'Current-time selection'):'Planned date';
      note.innerHTML=`<b>${relation}</b><span>Choose any supported UTC date, including a future date in December. The result is calculated from the data attached to that interval.</span>`;
    }
  }
  function applyMissionTime(value,mode='custom'){
    const start=byId('start'),skyStart=byId('skyStart');
    if(start)start.value=value;if(skyStart)skyStart.value=value;
    setTimeMode(mode);
    if(typeof markDirty==='function')markDirty();
    if(typeof renderSiteDetails==='function')renderSiteDetails();
    if(typeof syncSkySettings==='function')syncSkySettings();
    if(typeof queueSettings==='function')queueSettings();
  }
  function useNow(){
    const now=new Date();now.setUTCSeconds(0,0);applyMissionTime(utcInputValue(now),'now');
    if(typeof note==='function')note('Current UTC selected. Fetch real Sun/Earth tracks for this time if the attached data do not cover it.','success');
  }
  function useCustom(){
    setTimeMode('custom');byId('start')?.focus();
  }
  function refreshModeFromInput(){setTimeMode('custom');}
  function renameActionText(){
    const b=byId('runEngineering');if(b)b.innerHTML='Calculate power & communications <span>→</span>';
    const r=byId('engineeringRepair');if(r)r.textContent='Find tested hardware fixes →';
    const learn=document.querySelector('#page-learn .lesson:first-child p');if(learn)learn.innerHTML='Go to <b>Mission Setup</b>. Keep Site A and the example settings. Select <b>Calculate mission results</b>, then read the result before the charts.';
  }
  const initV4=()=>{
    Object.assign(PAGE_NAMES,{explore:'Lunar Map',plan:'Mission Setup',sky:'Sunlight & Earth',engineering:'Power & Communications',compare:'Compare Options',repair:'Optimize Mission',data:'Data & Sources',learn:'Help & Guide'});
    byId('useCurrentTime')?.addEventListener('click',useNow);
    byId('chooseMissionDate')?.addEventListener('click',useCustom);
    byId('start')?.addEventListener('input',refreshModeFromInput);
    renameActionText();
    setTimeMode('custom');
    // Keep the first experience reliable even when remote map services are unavailable.
    if(typeof setPage==='function')setPage('plan',false);
  };
  if(document.readyState==='loading')window.addEventListener('DOMContentLoaded',initV4);else initV4();
})();
