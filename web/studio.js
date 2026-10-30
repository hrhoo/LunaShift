'use strict';
Object.assign(PAGE_NAMES,{explore:'Lunar Map',sky:'Sunlight & Earth',engineering:'Power & Communications'});
const E={defaults:null,result:null,dirty:true,sample:0,repairs:null,map:null,original:null,loading:false};
const hwFields=()=>[...document.querySelectorAll('[data-hw]')];
function readHardware(){const h={};for(const el of hwFields()){if(!el.checkValidity()){el.closest('details')?.setAttribute('open','');el.reportValidity();throw new Error('Correct the highlighted hardware setting.');}h[el.dataset.hw]=el.tagName==='SELECT'?el.value:Number(el.value);}return h;}
function writeHardware(h){for(const el of hwFields())if(h[el.dataset.hw]!==undefined)el.value=h[el.dataset.hw];}
function engineeringRow(){return !E.dirty&&E.result?.results.find(r=>r.site_id===S.selected);}
function invalidateEngineering(){E.dirty=true;E.repairs=null;$('engineeringDirty').textContent='Inputs changed. Calculate again before interpreting or exporting results.';$('hardwareRepairCards').innerHTML='';$('hardwareRepairStatus').textContent='';renderEngineering();}
const originalUiState=uiState;uiState=function(){const state=originalUiState();if(E.defaults)try{state.hardware=readHardware();}catch(_){}return state;};
const originalRestore=restoreSettings;restoreSettings=function(state){originalRestore(state);if(state?.hardware){writeHardware(state.hardware);$('hardwarePreset').value='custom';}invalidateEngineering();};
const originalProjectUpdated=projectUpdated;projectUpdated=function(project,restore=false){originalProjectUpdated(project,restore);$('terrainSite').innerHTML=project.sites.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');$('terrainSite').value=S.selected;invalidateEngineering();updateReadiness();refreshSources().catch(()=>{});E.map?.draw();};
const originalChoose=choose;choose=function(id,navigate=false){originalChoose(id,navigate);E.sample=0;updateReadiness();renderEngineering();E.map?.draw();};
const originalMarkDirty=markDirty;markDirty=function(){originalMarkDirty();invalidateEngineering();};
// The v2 input listeners captured the original function, so bind explicit invalidation too.
SETTINGS.forEach(id=>$(id).addEventListener('input',invalidateEngineering));
const originalPage=setPage;setPage=function(name,scroll=true){originalPage(name,scroll);if(name==='explore'){requestAnimationFrame(()=>{E.map?.draw();drawLocalSky();});updateReadiness();}if(name==='engineering'){renderEngineering();}if(name==='sky'){requestAnimationFrame(()=>window.renderSkyView?.());}};
const originalDrawAll=drawAll;drawAll=function(){originalDrawAll();if(S.page==='explore'){E.map?.draw();drawLocalSky();}if(S.page==='engineering')drawEngineering();if(S.page==='sky')window.renderSkyView?.();};
function updateReadiness(){
 const s=currentSite();if(!s)return;
 $('readinessTitle').textContent=shortName(s);$('engineeringContext').textContent=`${s.name} · ${prettyDate(($('start').value||'')+'Z')} · ${$('duration').value} hours. Same mission settings as the visibility page.`;
 const checks=[['Terrain skyline',!!s.terrain_kind,s.synthetic_terrain?'Synthetic learning terrain':s.terrain_kind?`Attached · ${s.terrain_radius_km?fmt(s.terrain_radius_km)+' km radius':'range not declared'}`:'Not attached'],['Sun / Earth tracks',s.track_mode==='synthetic'||!!s.track_start,s.track_mode==='synthetic'||s.track_synthetic?'Synthetic learning curves':s.track_start?`From ${prettyDate(s.track_start,true)}`:'Not attached'],['Hardware assumptions',true,'Editable on Power & Communications']];
 $('readiness').innerHTML=checks.map(([label,ok,text])=>`<div class="readiness-row"><span class="ready-icon ${ok?'':'unknown'}">${ok?'✓':'?'}</span><div><b>${label}</b><small>${esc(text)}</small></div></div>`).join('');
}
async function refreshSources(){
 if(!S.token)return;
 const d=await api('/api/sources');
 const card=(x,cls='reference')=>`<div class="source-item ${cls}"><h4>${esc(x.name)}</h4><span class="pill subtle">${esc(x.status)}</span><p>${esc(x.role)}</p><small>${esc(x.note)}</small><a href="${esc(x.url)}" target="_blank" rel="noopener">Open original source ↗</a></div>`;
 const advanced=[];
 const core=d.sources.filter(x=>['horizons','spice','lola','trek','illumination'].includes(x.id));
 const context=d.sources.filter(x=>['diviner','power','dsn','propagation'].includes(x.id));
 const references=d.sources.filter(x=>!advanced.includes(x)&&!core.includes(x)&&!context.includes(x));
 const group=(title,subtitle,items,cls)=>items.length?`<section class="source-group"><div class="source-group-title"><h4>${title}</h4><small>${subtitle}</small></div><div class="source-catalog">${items.map(x=>card(x,cls)).join('')}</div></section>`:'';
 $('fullSourceTable').innerHTML=group('Normal workflow','The sources a typical user sees first.',core,'core')+group('Engineering and context','Used as context, assumptions, or model references.',context,'context')+group('Supporting references','Useful links that are not silently treated as imported measurements.',references,'reference');
 const entries=d.sites.flatMap(s=>s.layers.map(l=>({...l,name:s.name})));
 $('contextSamples').innerHTML=entries.length?`<div class="context-table"><h4>Imported context at your locations</h4><div class="table-wrap"><table><thead><tr><th>Location</th><th>Variable</th><th>Value</th><th>How used</th></tr></thead><tbody>${entries.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.kind)}</td><td>${x.value==null?'No coverage':fmt(x.value,3)+' '+esc(x.unit)}</td><td>${esc(x.used_for)}</td></tr>`).join('')}</tbody></table></div></div>`:'';
}
async function runEngineering(){
 if(S.busy)return;let p,h;try{p=validateInputs();h=readHardware();}catch(e){return note(e.message,'error');}
 busy(true,'Calculating solar power, battery reserve and the radio budget…');
 try{
  if(typeof ensureGeometryForMission==='function')await ensureGeometryForMission(p);
 S.analysis=await api('/api/analyze',p);S.dirty=false;S.sample=0;renderSelected();renderCompare();
  E.result=await api('/api/engineering',{...p,hardware:h});E.dirty=false;E.sample=0;E.repairs=null;$('hardwareRepairCards').innerHTML='';$('hardwareRepairStatus').textContent='';
  $('engineeringDirty').textContent='Up to date · sampled engineering model with explicit hardware assumptions.';renderEngineering();await saveSettings();
 }catch(e){note(e.message,'error');}finally{busy(false);}
}
function renderEngineering(){
 if(!$('engineeringResult'))return;updateReadiness();const r=engineeringRow();
 $('engineeringResult').classList.toggle('hidden',!r?.metrics);$('engineeringEmpty').classList.toggle('hidden',!!r?.metrics);
 if(!r?.metrics){$('engineeringEmpty').textContent=r?.reasons?.join(' ')||'Choose your hardware and click Calculate power & communications. Real locations need terrain and ephemerides; the labelled teaching example works offline.';return;}
 const m=r.metrics,geom=current();const combined=r.status==='fail'||geom?.status==='fail'?'fail':geom?.status==='unknown'?'unknown':'pass';
 const reasons=[...r.reasons,...(geom?.reasons||[])];$('engineeringVerdict').className='mission-verdict '+combined;
 $('engineeringVerdict').innerHTML=`<div class="eyebrow">${r.provenance.synthetic_environment?'SYNTHETIC LEARNING SCENARIO':'DATA-DRIVEN ENVIRONMENT / ENGINEERING ASSUMPTIONS'}</div><h3>${combined==='pass'?'The selected checks pass in this model.':combined==='fail'?'This plan needs a change.':'A required check is missing.'}</h3><p>${esc(reasons.join(' ')||'Battery reserve, data-return target and enabled visibility checks pass. This is not a safety certificate or scheduled radio contact.')}</p>`;
 const cards=[['Energy harvested',m.harvested_kwh,'kWh','At the electrical output of the assumed array.'],['Lowest battery',m.min_soc_pct,'%','Your reserve: '+fmt(r.hardware.reserve_soc_pct,0)+'%.'],['Modelled data return',m.returned_gb,'GB','Ideal receiver access; not a DSN commitment.'],['Best LOS budget margin',m.best_margin_db,'dB','Includes your additional design margin.'],['Shadow energy loss',m.terrain_loss_kwh,'kWh','Compared with smooth terrain at the same viewpoint.']];
 $('engineeringMetrics').innerHTML=cards.map(([name,v,unit,note])=>`<article class="metric"><label>${name}</label><span class="metric-value">${fmt(v,v!=null&&Math.abs(v)<1?3:1)} <small>${unit}</small></span><span class="metric-note">${note}</span></article>`).join('');
 $('engSlider').max=r.curves.hours.length-1;$('engSlider').value=Math.min(E.sample,r.curves.hours.length-1);
 $('engineeringTable').innerHTML=`<table><thead><tr><th>Location</th><th>Harvested</th><th>Lowest battery</th><th>Modelled return</th><th>Energy/data check</th></tr></thead><tbody>${E.result.results.map(x=>`<tr><td><button class="table-button" data-eng-site="${esc(x.site_id)}">${esc(x.site_name)} →</button></td><td>${x.metrics?fmt(x.metrics.harvested_kwh)+' kWh':'—'}</td><td>${x.metrics?fmt(x.metrics.min_soc_pct)+'%':'—'}</td><td>${x.metrics?fmt(x.metrics.returned_gb,3)+' GB':'—'}</td><td>${tag(x.status)}</td></tr>`).join('')}</tbody></table>`;
 $('engineeringProvenance').innerHTML=`<dl class="provenance-list">${Object.entries(r.provenance).map(([k,v])=>`<dt>${esc(k.replaceAll('_',' '))}</dt><dd>${esc(v)}</dd>`).join('')}</dl><div class="model-note">${r.limitations.map(x=>'<p>'+esc(x)+'</p>').join('')}</div>`;
 drawEngineering();
}
function chart(id,series,{unit='',threshold=null,blocked=null,minZero=false}={}){
 const r=engineeringRow(),q=canvas(id);if(!r?.metrics||!q)return;const {ctx,w,h}=q,pad={l:45,r:12,t:12,b:28};const xs=r.curves.hours;
 let all=series.flatMap(s=>s.data.filter(Number.isFinite));if(threshold!==null)all.push(threshold);if(minZero)all.push(0);let lo=Math.min(...all),hi=Math.max(...all);if(hi-lo<1e-8)hi=lo+1;const extra=(hi-lo)*.12;lo=minZero?Math.min(lo,0):lo-extra;hi+=extra;const X=x=>pad.l+x/xs.at(-1)*(w-pad.l-pad.r),Y=y=>h-pad.b-(y-lo)/(hi-lo)*(h-pad.t-pad.b);
 if(blocked){ctx.fillStyle='#edf0ed';for(let i=0;i<xs.length-1;i++)if(!blocked[i])ctx.fillRect(X(xs[i]),pad.t,Math.max(1,X(xs[i+1])-X(xs[i])),h-pad.b-pad.t);}
 for(let k=0;k<5;k++){const v=lo+(hi-lo)*k/4;line(ctx,[[pad.l,Y(v)],[w-pad.r,Y(v)]],C.grid,.7);ctx.font='10px sans-serif';label(ctx,fmt(v,Math.abs(hi)<2?2:0),pad.l-7,Y(v)+4,C.muted,'right');}
 for(let k=0;k<=4;k++){label(ctx,fmt(xs.at(-1)*k/4,0)+' h',X(xs.at(-1)*k/4),h-5,C.muted,'center');}
 if(threshold!==null)line(ctx,[[pad.l,Y(threshold)],[w-pad.r,Y(threshold)]],'#b57959',1,[5,4]);
 for(const s of series)line(ctx,s.data.map((v,i)=>[X(xs[i]),Y(v)]),s.color,2);
 const i=Math.min(E.sample,xs.length-1),x=X(xs[i]);line(ctx,[[x,pad.t],[x,h-pad.b]],'#78908e',1,[3,3]);
 for(const s of series){ctx.fillStyle=s.color;ctx.beginPath();ctx.arc(x,Y(s.data[i]),3,0,Math.PI*2);ctx.fill();}
}
function drawEngineering(){
 const r=engineeringRow();if(!r?.metrics||S.page!=='engineering')return;const c=r.curves;
 chart('powerCanvas',[{data:c.solar_w,color:C.sun},{data:c.load_w,color:C.text}],{minZero:true});
 chart('socCanvas',[{data:c.soc_pct,color:C.teal}],{threshold:r.hardware.reserve_soc_pct,minZero:true});
 chart('radioCanvas',[{data:c.link_margin_db,color:C.earth}],{threshold:0,blocked:c.link_visible});
 chart('bufferCanvas',[{data:c.buffer_gb,color:C.teal}],{minZero:true});
 const i=Math.min(E.sample,c.hours.length-1),dt=new Date(Date.parse(E.result.parameters.start_utc)+c.hours[i]*3600000);
 $('engTime').textContent=prettyDate(dt.toISOString(),true);
 $('engineeringNow').innerHTML=`At this sample: <b>${fmt(c.solar_w[i],0)} W solar</b> · <b>${fmt(c.soc_pct[i])}% battery</b> · ${c.link_visible[i]?'Earth-centre LOS clears the selected margin':'Earth-centre LOS is blocked'} · <b>${fmt(c.transmitted_rate_mbps[i],3)} Mbps modelled downlink</b>. ${c.link_visible[i]?'The budget still assumes a generic receiver is available.':'A positive unoccluded RF budget does not overcome terrain blockage.'}`;
}
function drawLocalSky(){
 const q=canvas('localSky');if(!q)return;const d=sampleInfo();if(!d){label(q.ctx,'Attach terrain and ephemerides, then check your plan.',15,q.h/2);return;}
 const {ctx,w,h}=q,{r,i,track}=d;let lo=-2,hi=5;for(const a of r.profile.horizon_deg){lo=Math.min(lo,a-1);hi=Math.max(hi,a+1);}for(const body of ['sun','earth']){lo=Math.min(lo,track[body+'_elevation_deg']-1);hi=Math.max(hi,track[body+'_elevation_deg']+1);}
 const X=a=>35+a/360*(w-55),Y=e=>h-30-(e-lo)/(hi-lo)*(h-55);
 for(let k=0;k<5;k++){const e=lo+(hi-lo)*k/4;line(ctx,[[35,Y(e)],[w-20,Y(e)]],C.grid,.7);label(ctx,fmt(e,0)+'°',28,Y(e)+3,C.muted,'right');}
 const pts=r.profile.azimuth_deg.map((a,j)=>[X(a),Y(r.profile.horizon_deg[j])]);pts.push([X(360),Y(r.profile.horizon_deg[0])]);ctx.beginPath();ctx.moveTo(X(0),Y(lo));pts.forEach(p=>ctx.lineTo(...p));ctx.lineTo(X(360),Y(lo));ctx.closePath();ctx.fillStyle='#dce7d8';ctx.fill();line(ctx,pts,'#8da58e',1.4);
 for(const [body,color] of [['sun',C.sun],['earth',C.earth]]){const x=X(track[body+'_azimuth_deg']),y=Y(track[body+'_elevation_deg']);ctx.beginPath();ctx.arc(x,y,body==='sun'?6:8,0,Math.PI*2);ctx.fillStyle=r.curves[body].clearance_deg[i]>0?color:'#fff';ctx.fill();ctx.strokeStyle=color;ctx.stroke();label(ctx,body==='sun'?'Sun':'Earth',Math.min(w-40,x+10),Math.max(15,y-8),color);}
 for(const [a,t] of [[0,'N'],[90,'E'],[180,'S'],[270,'W'],[360,'N']])label(ctx,t,X(a),h-9,C.muted,'center');
 $('skyCaption').textContent=prettyDate(track.time_utc)+'. Markers are schematic; the skyline is sampled terrain. '+(r.synthetic_terrain||r.synthetic_track?'Synthetic teaching environment.':'Calculated from the attached terrain and ephemerides.');
}
async function findHardwareRepair(){
 if(S.busy||E.dirty)return note('Calculate the current energy and radio model first.','warn');busy(true,'Testing site, panel, battery and optional date changes…');
 try{
 if(typeof ensureGeometryForMission==='function')await ensureGeometryForMission({...params(),duration_h:params().duration_h+($('engAllowDelay').checked?24:0)});
 const r=await api('/api/mission_repair',{...params(),hardware:readHardware(),site_id:S.selected,allow_move:$('engAllowMove').checked,allow_panel:$('engAllowPanel').checked,allow_battery:$('engAllowBattery').checked,allow_delay:$('engAllowDelay').checked});E.repairs=r;
 $('hardwareRepairStatus').textContent=`${r.tested} tested · ${r.passing} passing · ${r.unknown} unavailable. ${r.search_note}`;
 $('hardwareRepairCards').innerHTML=r.options.slice(0,3).map((o,i)=>`<article class="option-card ${i===0?'best':''}"><div class="eyebrow">${i===0?'LOWEST TESTED CHANGE':'ALTERNATIVE'}</div><h3>${esc(o.site_name)}</h3><div class="option-change"><span>Relocation</span><b>${fmt(o.move_km,2)} km</b></div><div class="option-change"><span>Panel area</span><b>${fmt(o.panel_area_m2)} m²</b></div><div class="option-change"><span>Battery</span><b>${fmt(o.battery_kwh)} kWh</b></div><div class="option-change"><span>Landing delay</span><b>${fmt(o.delay_h,0)} h</b></div><p>Minimum reserve ${fmt(o.metrics.min_soc_pct)}%. Modelled data return ${fmt(o.metrics.returned_gb,3)} GB. Normalized change cost ${fmt(o.cost,2)}.</p><button class="button primary" data-hw-repair="${i}">Inspect this repair →</button></article>`).join('')||'<p>No passing option in this tested set. Inspect the failing checks; increase the search range or supply missing data. No success was invented.</p>';
 }catch(e){note(e.message,'error');}finally{busy(false);}
}
async function applyHardwareRepair(i){
 const o=E.repairs?.options[i];if(!o)return;E.original={selected:S.selected,fields:uiState().fields,hardware:readHardware()};
 writeHardware(o.hardware);$('start').value=o.parameters.start_utc.slice(0,16);S.selected=o.site_id;$('siteSelect').value=S.selected;invalidateEngineering();await runEngineering();
 note('Inspecting a tested repair. Your previous plan is available to restore.','success');const b=document.createElement('button');b.className='text-button';b.textContent='Restore previous plan';b.addEventListener('click',async()=>{const old=E.original;if(!old)return;restoreSettings({selected_site_id:old.selected,fields:old.fields,hardware:old.hardware});await runEngineering();E.original=null;note('Previous plan restored.','success');});$('message').appendChild(b);
}
async function uploadRaster(file){
 if(!file)throw new Error('Choose a GeoTIFF file first.');if(file.size>512*1024*1024)throw new Error('This file exceeds 512 MiB. Use tools/convert_geotiff.py for a larger source.');
 const r=await fetch('./api/upload/terrain',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-LunaShift-Token':S.token},body:file});const d=await r.json();if(!r.ok)throw new Error(d.error);return d;
}
async function rasterAction(context=false){
 if(S.busy)return;if(!$('terrainFrame').checked)return note('Read and confirm the coordinate-frame statement first.','warn');if(!$('terrainSource').value.trim())return note('Enter the dataset source and version first.','warn');
 busy(true,context?'Uploading and sampling the context layer…':'Uploading and building a sampled terrain skyline…');
 try{const f=$(context?'contextFile':'terrainFile').files[0],u=await uploadRaster(f);const args={upload_key:u.upload_key,source:$('terrainSource').value,frame_confirmed:true};
 const r=await api(context?'/api/context':'/api/terrain',context?{...args,kind:$('contextKind').value,unit:$('contextUnit').value}:{...args,site_id:$('terrainSite').value,radius_km:+$('terrainRadius').value});
 S.analysis=null;S.dirty=true;projectUpdated(r.project);renderSelected();renderCompare();$('terrainStatus').textContent=r.message;note(r.message,'success');await refreshSources();
 }catch(e){$('terrainStatus').textContent=e.message;note(e.message,'error');}finally{busy(false);}
}
const originalReport=reportHTML;reportHTML=function(){let text=originalReport(),r=engineeringRow();if(r?.metrics){const html=`<section><h2>Energy and radio screening</h2><p>Hardware assumptions, not a flight or DSN access guarantee.</p><table>${Object.entries(r.metrics).map(([k,v])=>`<tr><th>${esc(k)}</th><td>${fmt(v,4)}</td></tr>`).join('')}</table><h3>Inputs and provenance</h3><pre>${esc(JSON.stringify({hardware:r.hardware,provenance:r.provenance},null,2))}</pre><p>${r.limitations.map(esc).join(' ')}</p></section>`;text=text.replace('</body>',html+'</body>');}return text;};
$('mapConnect').addEventListener('click',()=>E.map.connect());$('lunarLayer').addEventListener('change',()=>E.map.connect());$('mapPlus').addEventListener('click',()=>E.map.changeZoom(1));$('mapMinus').addEventListener('click',()=>E.map.changeZoom(-1));$('mapHome').addEventListener('click',()=>{const s=currentSite();if(s)E.map.centerOn(s.latitude_deg,s.longitude_deg);});
$('mapFind').addEventListener('click',()=>{if(!$('pickLat').checkValidity()||!$('pickLon').checkValidity())return note('Enter a latitude between −90 and 90, and a valid east longitude.','error');E.map.centerOn(+$('pickLat').value,((+$('pickLon').value%360)+360)%360);});
$('saveMapSite').addEventListener('click',async()=>{if(!$('pickLat').checkValidity()||!$('pickLon').checkValidity()||!$('pickName').value.trim())return note('Enter a location name and valid lunar coordinates first.','warn');const id='MAP_'+Date.now().toString(36).toUpperCase();await dataAction('Saving your selected location…',()=>api('/api/add_site',{id,name:$('pickName').value,latitude_deg:+$('pickLat').value,longitude_deg:+$('pickLon').value,ground_elevation_m:0,slope_deg:null}));if(S.project.sites.some(s=>s.id===id)){choose(id);$('terrainSite').value=id;$('fetchSite').value=id;setPage('data');}});
$('realWorkspace').addEventListener('click',async()=>{if(!confirm('Replace the current workspace with a real-data location? Save a copy first to keep existing work. The new workspace will contain no synthetic terrain or tracks.'))return;await dataAction('Creating a real-data workspace…',()=>api('/api/real_workspace',{name:$('pickName').value,latitude_deg:+$('pickLat').value,longitude_deg:+$('pickLon').value}));setPage('data');});
$('loadEyes').addEventListener('click',()=>{const f=document.createElement('iframe');f.className='eyes-frame';f.title='NASA Eyes external solar-system simulation, independent of the mission time';f.src='https://eyes.nasa.gov/apps/solar-system/#/moon';f.allowFullscreen=true;f.referrerPolicy='no-referrer';$('eyesHost').replaceChildren(f);$('loadEyes').textContent='Reload external viewer';$('eyesStatus').textContent='Opening the independent NASA viewer. If it stays blank, use Open in a new tab; external frame access may be restricted.';f.addEventListener('load',()=>{$('eyesStatus').textContent='The external frame finished loading. Its time and location are controlled separately from your mission.';});});
$('loadRealExample').addEventListener('click',async()=>{
 if(S.busy||!confirm('Replace the current project with the real NASA Site04 example after a successful download? Save a copy first.'))return;
 let p;try{p=params();}catch(e){return note(e.message,'error');}
 busy(true,'Checking access to the real NASA example…');
 try{
  const start=await api('/api/nasa_example',{...p,geometry_source:geometryPreference()});let job;
  do{await new Promise(resolve=>setTimeout(resolve,1200));job=await api('/api/job?id='+start.job_id);$('busyLabel').textContent=job.message;}while(job.status==='running');
  if(job.status==='failed')throw new Error(job.message);
  S.analysis=null;S.dirty=true;projectUpdated(job.project,true);note(job.message,'success');
  const site=currentSite();if(site){$('pickLat').value=site.latitude_deg;$('pickLon').value=site.longitude_deg;$('pickName').value=site.name;E.map.centerOn(site.latitude_deg,site.longitude_deg);}
 }catch(e){note(e.message,'error');}finally{busy(false);}
});
$('nightOverlay').addEventListener('change',()=>E.map.draw());
$('runEngineering').addEventListener('click',runEngineering);$('engineeringRepair').addEventListener('click',findHardwareRepair);
$('engSlider').addEventListener('input',e=>{E.sample=+e.target.value;S.sample=E.sample;$('timeSlider').value=S.sample;updateTime();drawEngineering();});
for(const id of ['powerCanvas','socCanvas','radioCanvas','bufferCanvas'])$(id).addEventListener('click',e=>{const r=engineeringRow();if(!r?.metrics)return;const rect=e.target.getBoundingClientRect(),f=Math.max(0,Math.min(1,(e.clientX-rect.left-45)/(rect.width-57)));E.sample=Math.round(f*(r.curves.hours.length-1));$('engSlider').value=E.sample;S.sample=E.sample;updateTime();drawEngineering();});
hwFields().forEach(el=>el.addEventListener('input',()=>{$('hardwarePreset').value='custom';invalidateEngineering();queueSettings();}));
$('hardwarePreset').addEventListener('change',()=>{if(!E.defaults)return;const h={...E.defaults};if($('hardwarePreset').value==='small')Object.assign(h,{panel_area_m2:1,battery_kwh:2,base_load_w:20,heater_load_w:5,science_load_w:5,transmit_power_w:3,tx_diameter_m:.15,requested_rate_mbps:.1,science_rate_kbps:2,required_data_gb:.01});writeHardware(h);invalidateEngineering();queueSettings();});
$('uploadTerrain').addEventListener('click',()=>rasterAction(false));$('uploadContext').addEventListener('click',()=>rasterAction(true));$('refreshSources').addEventListener('click',()=>refreshSources().catch(e=>note(e.message,'error')));
$('engineeringExport').addEventListener('click',()=>{if(E.dirty||!E.result)return note('Calculate engineering results before exporting.','warn');download('LunaShift_engineering_results.json',JSON.stringify({...E.result,selected_site_id:S.selected,scope:'Sampled engineering screening. See per-result provenance and limitations.'},null,2));});
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.engSite)choose(b.dataset.engSite);if(b.dataset.hwRepair!==undefined)applyHardwareRepair(+b.dataset.hwRepair);});
async function startStudio(){
 E.map=new LunarMap();
 try{E.defaults=await api('/api/hardware_defaults');writeHardware(E.defaults);}catch(e){note(e.message,'error');}
 await init();if(S.project){setPage('plan',false);updateReadiness();await refreshSources().catch(()=>{});}
}
// Started after the Sun & Earth extension has registered its controls.
window.addEventListener('DOMContentLoaded',startStudio);
