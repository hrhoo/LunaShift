'use strict';
/* Version 0.5: one honest geometry choice, two real providers, no invented fallback. */
const G={source:'automatic',status:null,last:null,comparison:null,checking:false};
function geometryPreference(){return G.source;}
const GEOMETRY_NAMES={automatic:'Automatic — recommended',horizons:'JPL Horizons — online',spice:'NASA SPICE — local/offline'};
function geometrySourceSet(value,{save=true}={}){
 if(!Object.hasOwn(GEOMETRY_NAMES,value))value='automatic';
 G.source=value;
 document.querySelectorAll('[data-geometry-choice]').forEach(el=>{el.checked=el.value===value;el.closest('.geometry-choice').classList.toggle('selected',el.checked);});
 renderGeometry();
 if(save){markDirty();queueSettings();}
}
const v5UiState=uiState;uiState=function(){return {...v5UiState(),geometry_source:G.source};};
const v5Restore=restoreSettings;restoreSettings=function(state){v5Restore(state);geometrySourceSet(state?.geometry_source||'automatic',{save:false});};
const v5Project=projectUpdated;projectUpdated=function(p,restore=false){v5Project(p,restore);renderGeometry();};
const v5Details=renderSiteDetails;renderSiteDetails=function(){v5Details();renderGeometry();};

function renderGeometry(){
 if(!$('geometrySummary'))return;
 const s=currentSite(),actual=s?.geometry_engine;
 const requested=GEOMETRY_NAMES[G.source];
 const synthetic=s?.track_mode==='synthetic'||s?.track_synthetic;
 const attached=synthetic?'Teaching example — invented sky':actual==='spice'?'NASA SPICE — local calculation':actual==='horizons'?'NASA JPL Horizons':s?.track_start?'Imported time series':'No Sun/Earth data yet';
 $('geometrySummary').innerHTML=`<span class="geometry-key">Selected source</span><b>${esc(requested)}</b><span>${G.source==='automatic'?'Uses ready local SPICE first; otherwise Horizons. The result always names the source.':G.source==='spice'?'Local calculation after one-time setup. This choice never silently switches to Horizons.':'Uses the online JPL service, or an exact cached response for this request.'}</span>`;
 $('geometryAttached').innerHTML=`<span class="pill ${synthetic?'unknown':s?.track_start?'pass':'unknown'}">${esc(attached)}</span>${s?.track_start?`<span>${esc(prettyDate(s.track_start,true))} → ${esc(prettyDate(s.track_end,true))}</span>`:''}`;
 $('geometryTeaching').classList.toggle('hidden',!synthetic&&!s?.synthetic_terrain);
 $('geometryTeaching').textContent=synthetic?'You are using the teaching example. Choosing a source does not replace it. Select “Prepare Sun & Earth data” to attach real sky data; real terrain must be added separately.':s?.synthetic_terrain?'Real sky data and invented terrain are mixed here. Add real terrain before interpreting this as a real-location estimate.':'';
 $('geometryDataChoice').textContent=requested;
 $('geometryCurrentSource').textContent=attached;
 $('geometrySourceReason').textContent=s?.geometry_reason||'The actual source and date coverage appear here after preparation.';
 const status=G.status;
 $('spiceShortStatus').textContent=status?(status.ready?'✓ SPICE ready for these dates':status.library_available?(status.files_ready?'Check date coverage':'NASA files needed'):'One-time SPICE setup needed'):'Check SPICE setup';
 if(!status)return;
 $('spiceStatusTitle').textContent=status.ready?'Ready to calculate locally':!status.library_available?'One setup step before SPICE can run':!status.files_ready?'Python is ready. Download the NASA files.':'Check the selected dates or local files';
 $('spiceStatusMessage').textContent=status.message;
 $('spiceStatusBadge').textContent=status.ready?'Ready':!status.library_available?'Not installed':!status.files_ready?'Files missing':'Needs attention';
 $('spiceStatusBadge').className='pill '+(status.ready?'pass':'unknown');
 $('spiceChecks').innerHTML=[['Python support',status.library_available,status.library_version?'SpiceyPy '+status.library_version:'Use the setup script below.'],['NASA files',status.files_ready,'A compatible set, downloaded once.'],['Your date interval',status.coverage_ok,status.coverage_ok?'Checked against the local kernels.':'Checked after the first two steps.']].map(([t,ok,n])=>`<div class="spice-check"><span class="ready-icon ${ok?'':'unknown'}">${ok?'✓':'○'}</span><div><b>${t}</b><small>${esc(n)}</small></div></div>`).join('');
 $('downloadSpiceFiles').disabled=!status.library_available;
 $('spiceDownloadHint').textContent=status.library_available?'Downloads about 19 MB from NASA. Nothing is installed silently; your mission data stay unchanged.':'First run the setup script below, then restart and select Check setup. This button does not install Python packages inside your browser.';
 $('spiceCoverage').textContent=status.coverage?.length?'Local supported interval: '+status.coverage.map(x=>prettyDate(x.start_utc,true)+' to '+prettyDate(x.stop_utc,true)).join('; '):'Coverage will be shown after successful setup. Future dates also use the installed leap-second table.';
 $('spiceFiles').innerHTML=`<table><thead><tr><th>NASA file</th><th>What it does</th></tr></thead><tbody>${status.files.map(f=>`<tr><td><a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a></td><td>${esc(f.role)}</td></tr>`).join('')}</tbody></table>`;
}

async function checkSpiceStatus({notify=false}={}){
 if(G.checking)return;G.checking=true;
 try{
  let query='';try{const p=params(),end=new Date(new Date(p.start_utc).getTime()+p.duration_h*3600000);query='?'+new URLSearchParams({start_utc:p.start_utc,stop_utc:end.toISOString()});}catch(_){}
  G.status=await api('/api/geometry/status'+query);renderGeometry();
  if(notify)note(G.status.message,G.status.ready?'success':'warn');
 }catch(e){$('spiceStatusMessage').textContent=e.message;if(notify)note(e.message,'error');}
 finally{G.checking=false;}
}
async function geometryJob(endpoint,payload){
 const job=await api(endpoint,payload);let result;
 do{
  await new Promise(resolve=>setTimeout(resolve,600));
  result=await api('/api/job?id='+encodeURIComponent(job.job_id));
  if(result.message)$('busyLabel').textContent=result.message;
 }while(result.status==='running');
 if(result.status!=='complete')throw new Error(result.message||'The operation did not finish. Your previous workspace remains available.');
 return result;
}
function geometryApplied(job){
 S.analysis=null;S.dirty=true;stopPlayback();clearRepair();
 projectUpdated(job.project);renderSelected();renderCompare();
 G.last=job.details;renderGeometry();
 $('geometryOutcome').classList.remove('hidden');
 $('geometryOutcome').innerHTML=`<b>${esc(job.message)}</b>${(job.details||[]).map(x=>`<p>${esc(x.site_id)} · ${x.engine==='spice'?'NASA SPICE':'JPL Horizons'} · ${x.samples} samples<br><small>${esc(x.reason)}</small></p>`).join('')}`;
}
async function prepareGeometry({siteIds,durationH,stepMin}={}){
 if(S.busy)return;
 let p;try{p=validateInputs();}catch(e){return note(e.message,'error');}
 const ids=siteIds||($('geometryAllSites').checked?S.project.sites.map(s=>s.id):[S.selected]);
 if(!confirm(`Prepare real Sun/Earth data for ${ids.length} location(s) using ${GEOMETRY_NAMES[G.source]}? Existing sky tracks at these locations will be replaced only after the complete request succeeds. Terrain will not change.`))return;
 busy(true,'Preparing Sun & Earth data…');
 try{
  const job=await geometryJob('/api/geometry',{site_ids:ids,start_utc:p.start_utc,duration_h:durationH||p.duration_h,step_min:stepMin||p.step_min,geometry_source:G.source});
  geometryApplied(job);await saveSettings();note(job.message,'success');await checkSpiceStatus();
 }catch(e){note(e.message,'error');}finally{busy(false);}
}
async function prepareGeometryFromData(){
 let p;try{p=params();}catch(e){return note(e.message,'error');}
 if(!$('fetchHours').checkValidity())return $('fetchHours').reportValidity();
 if(+$('fetchHours').value<p.duration_h)return note('The geometry coverage must include your whole mission. Increase Coverage hours first.','warn');
 return prepareGeometry({siteIds:[$('fetchSite').value],durationH:+$('fetchHours').value,stepMin:+$('fetchStep').value});
}
function sourceFits(site){
 const source=site.geometry_engine;
 return G.source==='automatic'||source===G.source;
}
async function ensureGeometryForMission(p){
 // Keep teaching examples and explicitly imported external CSVs usable offline.
 // For real locations, missing dates are prepared with the selected provider.
 const candidates=S.project.sites.filter(s=>s.terrain_kind&&!(s.track_mode==='synthetic'||s.track_synthetic));
 const t0=new Date(p.start_utc).getTime(),t1=t0+p.duration_h*3600000;
 const needed=candidates.filter(s=>{
  const covered=s.track_start&&new Date(s.track_start).getTime()<=t0&&new Date(s.track_end).getTime()>=t1;
  const resolution=s.track_max_gap_min==null||s.track_max_gap_min<=p.step_min;
  return !covered||!resolution||!sourceFits(s);
 });
 if(!needed.length)return;
 const job=await geometryJob('/api/geometry',{site_ids:needed.map(s=>s.id),start_utc:p.start_utc,duration_h:p.duration_h,step_min:p.step_min,geometry_source:G.source});
 geometryApplied(job);
}
async function downloadSpiceFiles(){
 if(S.busy||!confirm('Download the compatible NASA SPICE files (about 19 MB) to this computer? Existing mission data will not be changed. Internet access is needed for this one-time download.'))return;
 busy(true,'Preparing local NASA SPICE files…');
 try{const r=await geometryJob('/api/spice/install',{consent:true});G.status=r.spice_status;renderGeometry();note(r.message,'success');}
 catch(e){note(e.message,'error');$('spiceStatusMessage').textContent=e.message;}
 finally{busy(false);}
}
async function compareGeometrySources(){
 if(S.busy)return;
 let p;try{p=validateInputs();}catch(e){return note(e.message,'error');}
 busy(true,'Comparing the two real geometry sources…');
 try{
  const r=await geometryJob('/api/geometry/compare',{site_id:S.selected,start_utc:p.start_utc,duration_h:Math.min(p.duration_h,24),step_min:60});
  G.comparison=r.comparison;
  $('geometryComparison').innerHTML=`<h4>Comparison for ${esc(r.comparison.site_id)}</h4><p>${r.comparison.samples} times checked. Your attached mission data were not changed.</p><div class="table-wrap"><table><thead><tr><th>Body</th><th>Largest direction difference</th><th>Largest elevation difference</th></tr></thead><tbody>${Object.entries(r.comparison.differences).map(([b,v])=>`<tr><td>${b==='sun'?'Sun':'Earth'}</td><td>${fmt(v.max_direction_difference_deg,6)}°</td><td>${fmt(v.max_elevation_difference_deg,6)}°</td></tr>`).join('')}</tbody></table></div><p>${esc(r.comparison.note)}</p>`;
  $('downloadGeometryComparison').disabled=false;note(r.message,'success');
 }catch(e){$('geometryComparison').textContent=e.message;note(e.message,'error');}
 finally{busy(false);}
}
function showGeometrySetup(){setPage('data');$('spiceManager').scrollIntoView({behavior:'smooth',block:'start'});checkSpiceStatus();}
function initGeometryControls(){
 document.querySelectorAll('[data-geometry-choice]').forEach(el=>el.addEventListener('change',()=>{if(el.checked){geometrySourceSet(el.value);checkSpiceStatus();}}));
 $('prepareGeometry').addEventListener('click',()=>prepareGeometry());
 $('geometrySetupButton').addEventListener('click',showGeometrySetup);
 $('checkSpice').addEventListener('click',()=>checkSpiceStatus({notify:true}));
 $('downloadSpiceFiles').addEventListener('click',downloadSpiceFiles);
 $('compareGeometry').addEventListener('click',compareGeometrySources);
 $('downloadGeometryComparison').addEventListener('click',()=>{if(G.comparison)download('LunaShift_geometry_comparison.json',JSON.stringify(G.comparison,null,2));});
 $('geometryChangeSource').addEventListener('click',()=>{setPage('plan');$('geometryCard').scrollIntoView({behavior:'smooth',block:'center'});});
 $('geometryManagerLink').addEventListener('click',showGeometrySetup);
 geometrySourceSet(G.source,{save:false});checkSpiceStatus();
 document.querySelectorAll('[data-spice-platform]').forEach(b=>b.addEventListener('click',()=>{
  const value=b.dataset.spicePlatform;
  document.querySelectorAll('[data-spice-platform]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));
  document.querySelectorAll('[data-spice-instructions]').forEach(x=>x.classList.toggle('hidden',x.dataset.spiceInstructions!==value));
 }));
 let timer;for(const id of ['start','duration'])$(id).addEventListener('change',()=>{clearTimeout(timer);timer=setTimeout(()=>checkSpiceStatus(),400);});
}
if(document.readyState==='loading')window.addEventListener('DOMContentLoaded',initGeometryControls);else initGeometryControls();
