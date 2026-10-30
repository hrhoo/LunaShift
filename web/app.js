'use strict';

/* LunaShift Mission Planner 0.5.0. No external JavaScript, CDN, telemetry, or build step. */
const $ = id => document.getElementById(id);
const S = {token:'', project:null, analysis:null, repair:null, selected:'A', sample:0,
  page:'plan', busy:false, dirty:false, prior:null, play:null, mapHits:[],
  repairBase:null, tourIndex:0, saveTimer:null, restoring:false, storage:null};
const C = {grid:'#e6ebe6', muted:'#75858d', text:'#243c48', teal:'#247458', sun:'#c08a2c',
  earth:'#3f8fa7', red:'#b67356', terrain:'#8a9e8c', terrainFill:'#dce5d9', bg:'#ffffff'};
const PAGE_NAMES = {plan:'Mission Setup', compare:'Compare Options', repair:'Optimize Mission', data:'Data & Sources', learn:'Help & Guide'};
const SETTINGS = ['start','duration','step','height','minSun','maxDark','maxGap','maxSlope','margin','slopeCheck'];
const SEARCH_SETTINGS = ['allowMove','allowDelay','allowHeight','maxDelay','maxHeight','delayStep','heightStep','wMove','wDelay','wHeight','preference'];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (value,n=1) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(n);
const tag = status => `<span class="pill ${esc(status)}">${status === 'pass' ? '✓ Within limits' : status === 'fail' ? '↗ Needs a change' : '? Missing data'}</span>`;
const prettyDate = (value, compact=false) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date not set';
  return date.toLocaleString('en-GB', {timeZone:'UTC',day:'2-digit',month:'short',...(compact?{}:{year:'numeric'}),hour:'2-digit',minute:'2-digit'})+' UTC';
};
const shortName = site => String(site?.name || '').replace(/^[A-Za-z0-9]+\s*[·•]\s*/, '');
const duration = h => h >= 48 ? `${fmt(h / 24, h%24===0?0:1)} days` : `${fmt(h, h%1===0?0:1)} hours`;
function note(text, kind='neutral') {
  const box = $('message'); box.textContent = text; box.className = 'message '+kind;
  if(kind==='error') box.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function busy(on, label='Checking your plan…') {
  if(on) S.focusBeforeBusy=document.activeElement;
  S.busy=on; $('busy').classList.toggle('hidden',!on); $('busyLabel').textContent=label;
  document.querySelector('.app-shell').inert=on; document.querySelector('.rail').inert=on;
  if(!on && S.focusBeforeBusy?.isConnected && S.focusBeforeBusy.tagName!=='BODY') {
    try {S.focusBeforeBusy.focus({preventScroll:true});} catch(_) {}
  }
}
async function api(path, body, {timeoutMs=180000}={}) {
  const options = body===undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json','X-LunaShift-Token':S.token},body:JSON.stringify(body)};
  let response;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try { response=await fetch('./'+path.replace(/^\//,''), {...options,signal:controller.signal}); }
  catch (error) {clearTimeout(timer);throw new Error(error.name==='AbortError'?'The request timed out. The server may still be finishing the operation; check its status before retrying.':'The platform cannot reach its Python server. Keep Terminal or your Colab runtime running, then reload this page.'); }

  let data;
  try { data=await response.json(); } catch (_) {throw new Error('The server returned an unreadable response. Check the terminal log.');} finally{clearTimeout(timer);}
  if(!response.ok) throw new Error(data.error || `The request failed (${response.status}).`);
  return data;
}
function params() {
  if(!$('start').value) throw new Error('Choose a landing date and time first.');
  return {start_utc:$('start').value.length===16?$('start').value+':00Z':$('start').value+'Z',
    duration_h:+$('duration').value, step_min:+$('step').value, height_m:+$('height').value,
    min_sun_pct:+$('minSun').value, max_dark_h:+$('maxDark').value, max_earth_gap_h:+$('maxGap').value,
    max_slope_deg:+$('maxSlope').value, check_slope:$('slopeCheck').checked, margin_deg:+$('margin').value};
}
function validateInputs() {
  for(const id of SETTINGS) {
    if(!$(id).checkValidity()) {if($(id).closest('details')) $(id).closest('details').open=true;
      setPage('plan'); $(id).reportValidity(); throw new Error('Please correct the highlighted mission setting.');}
  }
  return params();
}
function current() {return !S.dirty && S.analysis?.results.find(row=>row.site_id===S.selected);}
function currentSite() {return S.project?.sites.find(site=>site.id===S.selected);}
function sampleInfo() {const r=current(); if(!r?.tracks?.length) return null; const i=Math.max(0,Math.min(S.sample,r.tracks.length-1));return {r,i,track:r.tracks[i]};}
function stopPlayback() {if(S.play) clearInterval(S.play);S.play=null;syncPlaybackControls();}
function syncPlaybackControls(){
  const r=current(),site=currentSite(),canPrepare=site&&site.terrain_kind&&(site.track_mode==='synthetic'||site.track_start);
  const text=S.play?'Ⅱ Pause':r?.tracks?.length?'▶ Play':canPrepare?'↻ Calculate & play':'Add data to play';
  for(const id of ['playButton','skyPlay','mapPlay','engPlay'])if($(id)){$(id).textContent=text;$(id).setAttribute('aria-pressed',String(!!S.play));}
  for(const id of ['timeSlider','skySlider','mapSlider'])if($(id)){$(id).disabled=!r?.tracks?.length;$(id).max=Math.max(0,(r?.tracks?.length||1)-1);$(id).value=r?.tracks?.length?S.sample:0;}
}
async function togglePlayback(){
  if(S.play){stopPlayback();return;}
  if(S.busy)return;
  if(!current()?.tracks?.length){
    const site=currentSite();
    if(!site?.terrain_kind||!(site.track_mode==='synthetic'||site.track_start)){
      setPage('data');note('This location needs its own terrain skyline and Sun/Earth tracks before it can play. Attach the missing data below, or explicitly open the teaching example.','warn');return;
    }
    await runAnalysis();
  }
  if(!current()?.tracks?.length){note('This plan could not be animated. Check the data coverage and calculation message; no example was substituted.','warn');return;}
  if(S.sample>=current().tracks.length-1)S.sample=0;
  const speed=()=>Math.max(100,900/Number($('playSpeed')?.value||2));
  S.play=setInterval(()=>{const r=current();if(!r?.tracks?.length)return stopPlayback();S.sample=(S.sample+1)%r.tracks.length;updateTime();drawAll();syncPlaybackControls();},speed());
  syncPlaybackControls();updateTime();drawAll();
}
function setPage(name, scroll=true) {
  if(!PAGE_NAMES[name]) name='plan';
  S.page=name; $('pageName').textContent=PAGE_NAMES[name];
  document.querySelectorAll('.nav-item').forEach(button=>{const active=button.dataset.page===name;button.classList.toggle('active',active);if(active) button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  document.querySelectorAll('.page').forEach(page=>page.classList.toggle('active',page.id==='page-'+name));
  if(!['plan','explore','sky','engineering'].includes(name)) stopPlayback();
  if(name==='repair') renderBaseline();
  if(scroll) window.scrollTo({top:0,behavior:'instant'});
  requestAnimationFrame(drawAll);
}
function choose(id, navigate=false) {
  if(!S.project.sites.some(site=>site.id===id)) return;
  if(S.selected!==id) clearRepair();
  S.selected=id; $('siteSelect').value=id; S.sample=0;stopPlayback();
  renderSiteDetails();renderSelected();renderBaseline();queueSettings();
  if(navigate) setPage('plan');
}
function uiState() {
  const fields={};for(const id of [...SETTINGS,...SEARCH_SETTINGS]) fields[id]=$(id).type==='checkbox'?$(id).checked:$(id).value;
  return {selected_site_id:S.selected,fields};
}
function restoreSettings(state) {
  if(!state||typeof state!=='object') return;
  S.restoring=true;
  for(const [id,value] of Object.entries(state.fields||{})) if([...SETTINGS,...SEARCH_SETTINGS].includes(id)) {
    if($(id).type==='checkbox') $(id).checked=value===true;else $(id).value=String(value);
  }
  if(S.project.sites.some(site=>site.id===state.selected_site_id)) S.selected=state.selected_site_id;
  $('siteSelect').value=S.selected;S.restoring=false;renderSiteDetails();syncSearchInputs();
}
function queueSettings() {if(S.restoring || !S.project) return;clearTimeout(S.saveTimer);$('saveState').textContent='Saving settings…';S.saveTimer=setTimeout(()=>saveSettings().catch(e=>note('Settings could not be saved: '+e.message,'warn')),500);}
async function saveSettings() {
  clearTimeout(S.saveTimer);
  const saved=await api('/api/settings',{ui_state:uiState()});
  S.storage=saved.storage; $('saveState').textContent=S.storage?.persistent?'Saved on this computer':'Saved in this runtime';
}
function renderSiteDetails() {
  const site=currentSite();if(site) $('siteDetails').innerHTML=`${fmt(Math.abs(site.latitude_deg),4)}° ${site.latitude_deg<0?'S':'N'} · ${fmt(site.longitude_deg,4)}° E<br>${site.synthetic_terrain?'Synthetic example terrain':site.terrain_kind?'User-supplied terrain':'Terrain not added yet'}`;
  $('durationNote').textContent=`${fmt(+$('duration').value,0)} hours = ${fmt(+$('duration').value/24,2)} Earth days.`;
  $('fetchStart').textContent=`Starts ${prettyDate(($('start').value||'')+'Z')}. Include the full mission plus every delay you plan to test.`;
}
function projectUpdated(project, restore=false) {
  S.project=project;if(!project.sites.some(site=>site.id===S.selected)) S.selected=project.sites[0].id;
  for(const id of ['siteSelect','fetchSite','csvSite']) {$(id).innerHTML=project.sites.map(site=>`<option value="${esc(site.id)}">${esc(site.name)}</option>`).join('');$(id).value=S.selected;}
  if(restore) restoreSettings(project.ui_state);
  const synthetic=project.sites.filter(site=>site.track_mode==='synthetic'||site.track_synthetic||site.synthetic_terrain||site.slope_synthetic).length;
  const missing=project.sites.filter(site=>!site.terrain_kind||site.track_mode==='none'||(site.track_mode==='imported'&&!site.track_start)).length;
  $('dataBanner').classList.toggle('real',!synthetic);
  $('dataBadge').textContent=synthetic ? 'Learning data · not a lunar forecast' : 'User-supplied data · validation still required';
  $('dataText').textContent=synthetic ? `${synthetic} of ${project.sites.length} locations contain invented inputs. Use them to learn the workflow, not to plan a real mission.` : `Verify each source, coordinate frame, and time range.${missing?' '+missing+' location(s) need more data.':''}`;
  $('candidateCount').textContent=`${project.sites.length} candidate locations`;
  renderSources();renderSiteDetails();renderBaseline();
}
function clearRepair() {
  S.repair=null;$('repairOptions').innerHTML='';$('repairSummary').className='info-note';$('repairSummary').innerHTML='Choose what can change, then select <b>Find better options</b>. Nothing is applied until you choose an option.';
  $('envelope').innerHTML='<div class="empty-state">Your site × date comparison will appear here after the search.</div>';
  $('repairTable').innerHTML='<p class="field-note">Run the search first.</p>';
}
function markDirty() {
  S.dirty=true;stopPlayback();clearRepair();$('impactBox').classList.add('hidden');$('settingsNote').textContent='Settings changed. Check your plan again to update the results.';$('settingsDot').classList.add('dirty');
  renderSiteDetails();renderSelected();renderCompare();renderBaseline();queueSettings();
}
async function runAnalysis({scroll=false}={}) {
  if(S.busy) return;
  let p;try {p=validateInputs();} catch(e) {note(e.message,'error');return;}
  busy(true,'Checking visibility at every candidate site…');
  try {
    if(typeof ensureGeometryForMission==='function')await ensureGeometryForMission(p);
    const result=await api('/api/analyze',p);S.analysis=result;S.dirty=false;S.sample=0;stopPlayback();
    $('message').classList.add('hidden');$('settingsNote').textContent='Up to date · all candidates use these mission settings.';$('settingsDot').classList.remove('dirty');
    renderSelected();renderCompare();renderImpact();renderBaseline();
    try {await saveSettings();} catch(e) {note('Results are ready, but autosave failed. Use Save a copy. '+e.message,'warn');}
    if(scroll) $('decisionCard').scrollIntoView({behavior:'smooth',block:'start'});
  } catch(e) {note(e.message,'error');} finally {busy(false);}
}
function renderDecision(result) {
  const box=$('decisionCard');
  if(S.dirty||!result) {
    box.className='decision-card stale';box.innerHTML=`<div><div class="eyebrow">RESULTS NEED A REFRESH</div><h2>${S.dirty?'Your inputs changed. Let’s recheck them.':'Ready when you are.'}</h2><p>Select <b>Check my plan</b> to calculate the visibility using your current inputs. Old results are hidden so they cannot be mistaken for a new prediction.</p></div><button class="button primary" data-action="analyze">Check my plan →</button>`;return;
  }
  const status=result.status;box.className='decision-card '+status;
  const titles={pass:'This plan is within your selected limits.',fail:'This plan needs a change.',unknown:'We need more data to answer this.'};
  const reasons=result.reasons?.join(' ')||'All enabled visibility and slope checks pass for this modeled mission.';
  box.innerHTML=`<div><div class="eyebrow">${esc(result.site_name)} · ${duration(result.parameters?.duration_h||S.analysis.parameters.duration_h).toUpperCase()}</div><h2>${titles[status]}</h2><p>${esc(reasons)}</p></div><button class="button ${status==='unknown'?'secondary':'primary'}" data-go="${status==='unknown'?'data':status==='pass'?'compare':'repair'}">${status==='unknown'?'Add missing data':status==='pass'?'Compare the other sites':'Find a better option'} →</button>`;
}
function renderSelected() {
  syncPlaybackControls();const r=current();renderDecision(r);
  $('reportButton').disabled=!r?.metrics;$('exportResults').disabled=!S.analysis||S.dirty;
  if(!r?.metrics) {
    $('metrics').innerHTML='';$('constraintList').innerHTML='<div class="loading-note">No current calculation for this site. Check your settings and data, then run the plan.</div>';
    $('nowCards').innerHTML='';$('obstruction').textContent='No current terrain and track calculation.';$('timeLabel').textContent='';$('timeSlider').max=0;$('runtime').textContent='Not calculated';
    drawAll();renderCompare();return;
  }
  const m=r.metrics,p=S.analysis.parameters;
  const cards=[
    {name:'Time in sunlight',value:m.sunlight_pct,unit:'%',sub:`${fmt(m.sunlight_h)} of ${fmt(p.duration_h,0)} hours`,class:'sun',pass:m.sunlight_pct+1e-8>=p.min_sun_pct,limit:`Target: at least ${fmt(p.min_sun_pct,0)}%`},
    {name:'Longest darkness',value:m.longest_dark_h,unit:'h',sub:'One uninterrupted dark period',class:'sun',pass:m.longest_dark_h<=p.max_dark_h+1e-8,limit:`Your limit: ${fmt(p.max_dark_h,0)} hours`},
    {name:'Time Earth is visible',value:m.earth_visible_pct,unit:'%',sub:`${fmt(m.earth_visible_h)} hours with Earth in view`,class:'earth',pass:null,limit:'A view of Earth, not a verified link'},
    {name:'Longest Earth-hidden gap',value:m.longest_earth_gap_h,unit:'h',sub:'One uninterrupted gap in visibility',class:'earth',pass:m.longest_earth_gap_h<=p.max_earth_gap_h+1e-8,limit:`Your limit: ${fmt(p.max_earth_gap_h,0)} hours`}];
  $('metrics').innerHTML=cards.map(c=>`<div class="metric ${c.class} ${c.pass===false?'issue':''}"><div class="metric-title">${c.name}</div><div class="metric-value">${fmt(c.value)}<span>${c.unit}</span></div><div class="metric-sub">${c.sub}</div><div class="metric-check ${c.pass===false?'fail':''}">${c.pass===null?'○':c.pass?'✓':'↗'} ${c.limit}</div></div>`).join('');
  $('timeSlider').max=r.tracks.length-1;S.sample=Math.min(S.sample,r.tracks.length-1);$('timeSlider').value=S.sample;
  $('runtime').textContent=`${fmt(S.analysis.runtime_s,3)} s · CPU calculation`;
  const checks=[['Sunlight target',`At least ${fmt(p.min_sun_pct,0)}%`,fmt(m.sunlight_pct)+'%',m.sunlight_pct+1e-8>=p.min_sun_pct],
    ['Longest darkness',`No more than ${fmt(p.max_dark_h,0)} hours`,fmt(m.longest_dark_h)+' h',m.longest_dark_h<=p.max_dark_h+1e-8],
    ['Earth-hidden gap',`No more than ${fmt(p.max_earth_gap_h,0)} hours`,fmt(m.longest_earth_gap_h)+' h',m.longest_earth_gap_h<=p.max_earth_gap_h+1e-8]];
  if(p.check_slope) checks.push(['Terrain slope',`No more than ${fmt(p.max_slope_deg,0)}°`,m.slope_deg==null?'Not supplied':fmt(m.slope_deg)+'°',m.slope_deg==null?null:m.slope_deg<=p.max_slope_deg]);
  else checks.push(['Terrain slope','This check is turned off','Not checked',null]);
  $('constraintList').innerHTML=checks.map(([name,requirement,actual,ok])=>`<div class="constraint-row"><span class="check-icon ${ok===null?'unknown':ok?'pass':'fail'}">${ok===null?'−':ok?'✓':'!'}</span><div><b>${name}</b><small>${requirement}</small></div><span>${actual}</span></div>`).join('');
  updateTime();drawAll();renderCompare();
}
function nextEvent(intervals,hours,total,body) {
  const edges=intervals.flatMap(([a,b])=>[{t:a,visible:true},{t:b,visible:false}]).filter(e=>e.t>hours+1e-6&&e.t<total-1e-6).sort((a,b)=>a.t-b.t);
  if(!edges.length) return 'No further change found before mission end.';
  const e=edges[0];return `${e.visible?(body==='sun'?'Sun returns':'Earth returns'):(body==='sun'?'Sun is lost':'Earth is hidden')} in ${fmt(e.t-hours)} h.`;
}
function updateTime() {
  document.dispatchEvent(new CustomEvent('lunashift:time'));
  const d=sampleInfo();if(!d) return;
  const {r,i,track}=d;const hour=r.hours[i];
  $('timeLabel').textContent=prettyDate(track.time_utc,true);
  $('nowCards').innerHTML=['sun','earth'].map(body=>{const clear=r.curves[body].clearance_deg[i];return `<div class="now-card"><span class="now-icon ${body==='earth'?'earth':''}" aria-hidden="true">${body==='sun'?'☀':'◉'}</span><div><strong>${body==='sun'?'Sun':'Earth'} ${clear>0?'is visible':'is hidden / below the margin'}</strong><small>${nextEvent(r.intervals[body],hour,r.parameters.duration_h,body)}</small></div></div>`;}).join('');
  let text=['sun','earth'].map(body=>`<b>${body==='sun'?'Sun':'Earth'}:</b> ${fmt(r.curves[body].clearance_deg[i],2)}° clearance after your margin.`);
  const body=r.curves.sun.clearance_deg[i]<=0?'sun':r.curves.earth.clearance_deg[i]<=0?'earth':null;
  if(body) {
    const az=track[body+'_azimuth_deg'];let index=0,best=Infinity;
    r.profile.azimuth_deg.forEach((a,j)=>{const difference=Math.abs((a-az+540)%360-180);if(difference<best){best=difference;index=j;}});
    const blocker=r.profile.blockers[index];
    if(blocker) text.push(`For the ${body==='sun'?'Sun':'Earth'}, the nearest sampled limiting ray points ${fmt(blocker.azimuth_deg,1)}° around the horizon to terrain ${fmt(blocker.distance_m/1000,2)} km away. This is a sampled ray, not a precisely identified ridge.`);
    else text.push('This fixed skyline or smooth-sphere continuation has no stored terrain-point attribution.');
  }
  text.push(`Terrain sampled to: ${r.profile.range_limit_m?fmt(r.profile.range_limit_m/1000,2)+' km':'unknown distance'}. Terrain outside that range is not verified.`);
  $('obstruction').innerHTML=text.join(' ');
}
function renderCompare() {
  if(!S.analysis||S.dirty) {
    $('compareSummary').innerHTML='';$('compareCards').innerHTML='';$('comparisonContext').textContent='';
    $('comparisonTable').innerHTML='<div class="empty-state">Check your current plan first. Then every site will be compared using the same settings. <button class="text-button" data-go="plan">Open the planner →</button></div>';return;
  }
  const rows=S.analysis.results,p=S.analysis.parameters;
  const pass=rows.filter(r=>r.status==='pass').length,fail=rows.filter(r=>r.status==='fail').length,unknown=rows.filter(r=>r.status==='unknown').length;
  $('compareSummary').innerHTML=[[pass,'Within your limits'],[fail,'Need a change'],[unknown,'Need more data']].map(([v,label])=>`<div class="summary-stat"><strong>${v}</strong><small>${label}</small></div>`).join('');
  $('comparisonContext').textContent=`Landing ${prettyDate(p.start_utc)} · ${duration(p.duration_h)} · viewpoint ${fmt(p.height_m)} m. These are candidate comparisons, not a universal best-site ranking.`;
  $('comparisonTable').innerHTML=`<table><thead><tr><th>LOCATION</th><th>SUNLIGHT</th><th>LONGEST DARKNESS</th><th>EARTH VISIBLE</th><th>LONGEST EARTH GAP</th><th>RESULT</th></tr></thead><tbody>${rows.map(r=>`<tr class="${r.site_id===S.selected?'selected':''}"><td><button class="table-button" data-inspect="${esc(r.site_id)}">${esc(r.site_name)} →</button></td><td>${r.metrics?fmt(r.metrics.sunlight_pct)+'%':'—'}</td><td>${r.metrics?fmt(r.metrics.longest_dark_h)+' h':'—'}</td><td>${r.metrics?fmt(r.metrics.earth_visible_pct)+'%':'—'}</td><td>${r.metrics?fmt(r.metrics.longest_earth_gap_h)+' h':'—'}</td><td>${tag(r.status)}</td></tr>`).join('')}</tbody></table>`;
  $('compareCards').innerHTML=rows.map(r=>`<article class="card compare-card"><div class="card-heading"><h3>${esc(shortName({name:r.site_name}))}</h3>${tag(r.status)}</div>${r.metrics?`<div class="bar-label"><span>Sunlight</span><b>${fmt(r.metrics.sunlight_pct)}%</b></div><div class="mini-bar"><span style="width:${r.metrics.sunlight_pct}%"></span></div><div class="bar-label"><span>Earth visible</span><b>${fmt(r.metrics.earth_visible_pct)}%</b></div><div class="mini-bar earth"><span style="width:${r.metrics.earth_visible_pct}%"></span></div>`:''}<p class="field-note">${esc(r.reasons?.join(' ')||'All selected limits pass for this mission.')}</p><button class="text-button" data-inspect="${esc(r.site_id)}">Inspect this location →</button></article>`).join('');
}

// Canvas charts are rendered locally. The map is a local layout, never a fabricated NASA basemap.
function canvas(id) {
  const el=$(id),rect=el.getBoundingClientRect();if(!rect.width||!rect.height) return null;
  const scale=Math.min(window.devicePixelRatio||1,2);el.width=Math.round(rect.width*scale);el.height=Math.round(rect.height*scale);
  const ctx=el.getContext('2d');ctx.scale(scale,scale);ctx.font='11px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
  return {ctx,w:rect.width,h:rect.height};
}
function line(ctx,points,color,width=1,dash=[]) {if(!points.length)return;ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.stroke();ctx.setLineDash([]);}
function label(ctx,text,x,y,color=C.muted,align='left') {ctx.fillStyle=color;ctx.textAlign=align;ctx.fillText(text,x,y);ctx.textAlign='left';}
function roundRect(ctx,x,y,w,h,r=6) {ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
function noPlot(id,text) {const q=canvas(id);if(q){q.ctx.font='11px sans-serif';label(q.ctx,text,16,q.h/2);}}
function drawSky() {
  const d=sampleInfo();if(!d) return noPlot('skyCanvas','Check your plan to view the skyline.');
  const q=canvas('skyCanvas');if(!q)return;const {ctx,w,h}=q,{r,i}=d;
  const pad={l:38,r:18,t:24,b:35};
  let min=-1,max=4;for(const v of r.profile.horizon_deg){min=Math.min(min,v-.5);max=Math.max(max,v+.7);}
  for(const t of r.tracks) {min=Math.min(min,t.sun_elevation_deg-.5,t.earth_elevation_deg-.5);max=Math.max(max,t.sun_elevation_deg+.7,t.earth_elevation_deg+.7);}
  const lo=Math.floor(min),hi=Math.ceil(max),X=a=>pad.l+a/360*(w-pad.l-pad.r),Y=e=>h-pad.b-(e-lo)/(hi-lo)*(h-pad.t-pad.b);
  for(let k=0;k<=4;k++){const e=lo+(hi-lo)*k/4;line(ctx,[[pad.l,Y(e)],[w-pad.r,Y(e)]],C.grid,.8);label(ctx,fmt(e,1)+'°',pad.l-7,Y(e)+4,C.muted,'right');}
  for(const [a,direction] of [[0,'N'],[90,'E'],[180,'S'],[270,'W'],[360,'N']]) {label(ctx,direction,X(a),h-15,C.text,'center');ctx.font='9px sans-serif';label(ctx,a+'°',X(a),h-2,C.muted,'center');ctx.font='11px sans-serif';}
  const hp=r.profile.azimuth_deg.map((a,j)=>[X(a),Y(r.profile.horizon_deg[j])]);hp.push([X(360),Y(r.profile.horizon_deg[0])]);
  ctx.beginPath();ctx.moveTo(X(0),Y(lo));hp.forEach(p=>ctx.lineTo(...p));ctx.lineTo(X(360),Y(lo));ctx.closePath();
  const grad=ctx.createLinearGradient(0,Y(hi),0,Y(lo));grad.addColorStop(0,'#b5c8af');grad.addColorStop(1,'#edf2e9');ctx.fillStyle=grad;ctx.fill();line(ctx,hp,C.terrain,1.5);
  line(ctx,[[X(0),Y(0)],[X(360),Y(0)]],'#aebbb1',1,[4,4]);
  ctx.font='9px sans-serif';label(ctx,'HEIGHT ABOVE LOCAL HORIZONTAL',pad.l,12,C.muted);
  for(const [body,color]of[['sun',C.sun],['earth',C.earth]]){
    let segment=[],previous=null;
    for(const t of r.tracks){const az=t[body+'_azimuth_deg'];if(previous!=null&&Math.abs(az-previous)>180){line(ctx,segment,color,1.5,[3,3]);segment=[];}segment.push([X(az),Y(t[body+'_elevation_deg'])]);previous=az;}
    line(ctx,segment,color,1.5,[3,3]);
    const t=r.tracks[i],px=X(t[body+'_azimuth_deg']),py=Y(t[body+'_elevation_deg']),visible=r.curves[body].clearance_deg[i]>0;
    ctx.beginPath();ctx.arc(px,py,6,0,Math.PI*2);ctx.fillStyle=visible?color:'#fff';ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();
    if(!visible)line(ctx,[[px-3,py-3],[px+3,py+3]],color,1.3);
    ctx.font='bold 10px sans-serif';label(ctx,body==='sun'?'Sun':'Earth',Math.min(w-44,px+10),Math.max(26,py-8),color);ctx.font='11px sans-serif';
  }
}
function drawTimeline() {
  const d=sampleInfo();if(!d)return noPlot('timelineCanvas','Your visibility windows will appear after the calculation.');
  const q=canvas('timelineCanvas');if(!q)return;const {ctx,w,h}=q,{r,i}=d,l=54,rr=14,total=r.parameters.duration_h,X=a=>l+(w-l-rr)*a/total;
  const bands=[['Sun','sun',C.sun],['Earth','earth',C.earth],['Both','both',C.teal]];
  bands.forEach(([name,key,color],index)=>{const y=10+index*32;ctx.fillStyle='#edf0ec';roundRect(ctx,l,y,w-l-rr,19,4);ctx.fill();for(const [a,b]of r.intervals[key]){ctx.fillStyle=color;roundRect(ctx,X(a),y,Math.max(1,X(b)-X(a)),19,Math.min(4,(X(b)-X(a))/2));ctx.fill();}label(ctx,name,l-10,y+13,C.muted,'right');});
  const px=X(r.hours[i]);line(ctx,[[px,5],[px,106]],C.text,1.3);ctx.beginPath();ctx.moveTo(px-4,1);ctx.lineTo(px+4,1);ctx.lineTo(px,6);ctx.fillStyle=C.text;ctx.fill();
  const tickCount=w<400?4:6;for(let j=0;j<=tickCount;j++){const t=total*j/tickCount;label(ctx,`${fmt(t,0)} h`,X(t),124,C.muted,'center');}
}
function drawMap() {
  const q=canvas('mapCanvas');if(!q||!S.project)return;const {ctx,w,h}=q;
  const sites=S.project.sites;let xmin=Math.min(...sites.map(s=>s.x_km)),xmax=Math.max(...sites.map(s=>s.x_km)),ymin=Math.min(...sites.map(s=>s.y_km)),ymax=Math.max(...sites.map(s=>s.y_km));
  const preview=S.project.preview;const usePreview=preview?.kind==='synthetic'&&sites.every(s=>s.synthetic_terrain);
  if(usePreview){xmin=Math.min(xmin,preview.x_km[0]);xmax=Math.max(xmax,preview.x_km.at(-1));ymin=Math.min(ymin,preview.y_km[0]);ymax=Math.max(ymax,preview.y_km.at(-1));}
  let span=Math.max(xmax-xmin,ymax-ymin,2)*1.2,cx=(xmin+xmax)/2,cy=(ymin+ymax)/2;
  const scale=Math.min((w-54)/span,(h-42)/span),X=x=>w/2+(x-cx)*scale,Y=y=>h/2-(y-cy)*scale;
  ctx.fillStyle='#eef2e9';ctx.fillRect(0,0,w,h);
  if(usePreview){
    const xs=preview.x_km,ys=preview.y_km,z=preview.elevations_m;let low=Infinity,high=-Infinity;
    for(const row of z)for(const v of row){low=Math.min(low,v);high=Math.max(high,v);}
    for(let j=0;j<ys.length-1;j++)for(let k=0;k<xs.length-1;k++){
      const fraction=(z[j][k]-low)/(high-low||1);const v=Math.round(239-fraction*62);
      ctx.fillStyle=`rgb(${v-6},${v+1},${v-12})`;ctx.fillRect(X(xs[k]),Y(ys[j+1]),Math.max(1,X(xs[k+1])-X(xs[k])+.5),Math.max(1,Y(ys[j])-Y(ys[j+1])+.5));
    }
    // Marching-squares contour segments make the invented landscape easier to read.
    for(let level=low+10;level<high;level+=10){const segments=[];
      for(let j=0;j<ys.length-1;j++)for(let k=0;k<xs.length-1;k++){
        const corners=[[xs[k],ys[j],z[j][k]],[xs[k+1],ys[j],z[j][k+1]],[xs[k+1],ys[j+1],z[j+1][k+1]],[xs[k],ys[j+1],z[j+1][k]]];const pts=[];
        for(let e=0;e<4;e++){const a=corners[e],b=corners[(e+1)%4];if((a[2]<level)!==(b[2]<level)){const t=(level-a[2])/(b[2]-a[2]);pts.push([X(a[0]+t*(b[0]-a[0])),Y(a[1]+t*(b[1]-a[1]))]);}}
        if(pts.length>=2) segments.push(pts.slice(0,2));if(pts.length===4)segments.push(pts.slice(2));
      }
      for(const segment of segments)line(ctx,segment,'#8fa18c66',.65);
    }
  }
  for(let k=1;k<5;k++){line(ctx,[[w*k/5,0],[w*k/5,h]],'#aab8aa30',.6);line(ctx,[[0,h*k/5],[w,h*k/5]],'#aab8aa30',.6);}
  ctx.font='9px sans-serif';ctx.fillStyle='#f9fcf8dd';roundRect(ctx,12,12,usePreview?138:136,22,4);ctx.fill();label(ctx,usePreview?'SYNTHETIC TERRAIN · LOCAL':'LOCAL COORDINATE VIEW',20,27,'#52685a');
  line(ctx,[[w-22,44],[w-22,20]],'#657e6d',1.4);line(ctx,[[w-27,26],[w-22,20],[w-17,26]],'#657e6d',1.4);label(ctx,'N',w-22,14,'#52685a','center');
  S.mapHits=[];
  for(const site of sites){const x=X(site.x_km),y=Y(site.y_km),r=!S.dirty?S.analysis?.results.find(r=>r.site_id===site.id):null;
    const color=r?.status==='pass'?C.teal:r?.status==='fail'?C.red:'#8a99a0';
    if(site.id===S.selected){ctx.beginPath();ctx.arc(x,y,17,0,Math.PI*2);ctx.fillStyle='#ffffffb8';ctx.fill();ctx.strokeStyle='#476e5d';ctx.lineWidth=1;ctx.stroke();}
    ctx.beginPath();ctx.arc(x,y,10,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
    ctx.font='bold 9px sans-serif';label(ctx,site.id.length<=2?site.id:site.id.slice(0,2),x,y+3,'#fff','center');
    if(site.id===S.selected){const name=shortName(site);ctx.font='10px sans-serif';const width=Math.min(ctx.measureText(name).width+18,w-25),lx=Math.max(8,Math.min(w-width-8,x-width/2)),ly=Math.max(42,Math.min(h-28,y+22));ctx.fillStyle='#ffffffed';roundRect(ctx,lx,ly,width,23,5);ctx.fill();ctx.save();ctx.beginPath();ctx.rect(lx,ly,width,23);ctx.clip();label(ctx,name,lx+9,ly+15,C.text);ctx.restore();}
    S.mapHits.push({id:site.id,x,y});
  }
  let km=1;while(km*scale>w/4)km/=2;while(km*scale<w/9)km*=2;
  line(ctx,[[16,h-19],[16+km*scale,h-19]],'#536b5b',2);label(ctx,fmt(km,km<1?2:0)+' km',16,h-26,'#536b5b');
  $('mapCaption').textContent=usePreview?'Invented terrain for learning. This is not a NASA lunar image.':'Local site layout; no real terrain basemap is loaded. Distances use the spherical model.';
}
function drawAll() {if(S.page==='plan'){drawMap();drawSky();drawTimeline();}}

function renderBaseline() {
  const site=currentSite();if(!site)return;const p=(()=>{try{return params();}catch(_){return null;}})();
  $('repairBaseline').innerHTML=`<div><small>YOUR STARTING LOCATION</small><b>${esc(site.name)}</b></div><div><small>LANDING</small><b>${p?prettyDate(p.start_utc,true):'Choose a date'}</b></div><div><small>MISSION / VIEWPOINT</small><b>${p?duration(p.duration_h)+' / '+fmt(p.height_m)+' m':'Not set'}</b></div><span>${current()?tag(current().status):'<span class="pill unknown">Not checked yet</span>'}</span>`;
}
async function runRepair() {
  if(S.busy)return;let p;try {p=validateInputs();}catch(e){note(e.message,'error');return;}
  for(const id of ['maxDelay','maxHeight','delayStep','heightStep','wMove','wDelay','wHeight']) if(!$(id).checkValidity()){note('Check the search settings. '+$(id).validationMessage,'error');return;}
  const config={...p,preferred_site_id:S.selected,allow_relocation:$('allowMove').checked,
    max_delay_h:$('allowDelay').checked?+$('maxDelay').value:0,delay_step_h:+$('delayStep').value,
    max_height_m:$('allowHeight').checked?+$('maxHeight').value:p.height_m,height_step_m:+$('heightStep').value,
    weight_move:+$('wMove').value,weight_delay:+$('wDelay').value,weight_height:+$('wHeight').value};
  if(config.max_height_m<p.height_m)return note('The highest test viewpoint must be at least your starting height ('+p.height_m+' m).','error');
  busy(true,'Testing the changes you allowed…');
  try {
    if(typeof ensureGeometryForMission==='function')await ensureGeometryForMission({...p,duration_h:p.duration_h+config.max_delay_h});
    const result=await api('/api/repair',config);S.repair=result;S.repairBase={...config};
    renderRepair(result);$('message').classList.add('hidden');await saveSettings();
  } catch(e){note(e.message,'error');}finally{busy(false);}
}
function renderRepair(result) {
  const best=result.best,p=S.repairBase;
  $('repairSummary').className='repair-banner '+(best?'':'warn');
  $('repairSummary').innerHTML=best?`<b>${result.passing_combinations} of ${result.tested_combinations} tested combinations pass.</b> The smallest tested change is <b>${esc(best.site_name)}</b>. ${result.missing_combinations?`${result.missing_combinations} combinations could not be evaluated because of missing or incompatible data.`:''} Calculated in ${fmt(result.runtime_s,2)} s.`:`<b>No passing option was found in this search.</b> ${result.evaluated} combinations were evaluated; ${result.missing_combinations} could not be checked. This does not prove no feasible plan exists. Try other candidate sites, a different search range, or complete the missing data.`;
  // Offer varied candidates, not three nearly identical height increments.
  const displayed=[],seen=new Set();
  for(const option of [...(result.pareto||[]),...result.alternatives].sort((a,b)=>a.cost-b.cost)){
    if(!displayed.length||!seen.has(option.site_id)) {displayed.push(option);seen.add(option.site_id);}if(displayed.length===3)break;
  }
  if(displayed.length<3)for(const option of result.alternatives){if(!displayed.some(a=>a.site_id===option.site_id&&a.delay_h===option.delay_h&&a.height_m===option.height_m)) displayed.push(option);if(displayed.length===3)break;}
  S.displayedOptions=displayed;
  $('repairOptions').innerHTML=displayed.map((o,index)=>`<article class="option-card ${index===0?'best':''}"><div class="eyebrow">${index===0?'LOWEST TESTED CHANGE COST':'ANOTHER TESTED OPTION'}</div><h3>${esc(shortName({name:o.site_name}))}</h3><div class="option-change"><span>Move from your site</span><b>${o.move_km<.00001?'Stay here':fmt(o.move_km,2)+' km'}</b></div><div class="option-change"><span>Delay the landing</span><b>${o.delay_h?fmt(o.delay_h,0)+' hours':'Keep the date'}</b></div><div class="option-change"><span>Viewpoint height</span><b>${fmt(o.height_m)} m ${o.height_increase_m?'(+'+fmt(o.height_increase_m)+')':'(unchanged)'}</b></div><div class="option-change"><span>Longest darkness</span><b>${fmt(o.metrics.longest_dark_h)} h</b></div><div class="option-change"><span>Longest Earth gap</span><b>${fmt(o.metrics.longest_earth_gap_h)} h</b></div><p>Passes the enabled limits in this model. Preference cost: ${fmt(o.cost,3)}.</p><button class="button ${index===0?'primary':'ghost'}" data-option="${index}">Inspect this option →</button></article>`).join('');
  const siteIDs=result.envelope.map(cell=>cell.site_id);const sites=S.project.sites.filter(site=>siteIDs.includes(site.id));
  $('envelope').innerHTML=`<table><thead><tr><th>LOCATION / LANDING DELAY</th>${result.delays_h.map(h=>`<th>+${fmt(h,0)} h</th>`).join('')}</tr></thead><tbody>${sites.map(site=>`<tr><td>${esc(site.name)}</td>${result.delays_h.map(delay=>{const c=result.envelope.find(c=>c.site_id===site.id&&c.delay_h===delay)||{status:'unknown',reason:'Not evaluated'};return `<td><button class="envelope-cell ${c.status}" data-envelope-site="${esc(site.id)}" data-delay="${delay}" title="${esc(c.reason||'All selected checks pass')}" aria-label="${esc(site.name)}, ${delay} hours later, ${c.status}">${c.status==='pass'?'✓ Pass':c.status==='fail'?'↗ Change':'? Data'}</button></td>`;}).join('')}</tr>`).join('')}</tbody></table>`;
  $('repairTable').innerHTML=result.alternatives.length?`<table><thead><tr><th>LOCATION</th><th>MOVE</th><th>DELAY</th><th>HEIGHT</th><th>PREFERENCE COST</th><th></th></tr></thead><tbody>${result.alternatives.map((o,i)=>`<tr><td>${esc(o.site_name)}</td><td>${fmt(o.move_km,2)} km</td><td>${fmt(o.delay_h,0)} h</td><td>${fmt(o.height_m)} m</td><td>${fmt(o.cost,3)}</td><td><button class="table-button" data-all-option="${i}">Inspect →</button></td></tr>`).join('')}</tbody></table>`:'<p class="field-note">No passing option in the tested set.</p>';
  $('searchScope').textContent=`${result.tested_combinations} tested combinations · ${result.heights_m.length} heights · ${result.delays_h.length} landing times. No global optimum is claimed.`;
}
async function applyOption(option) {
  if(S.busy||!option)return;S.originalPlan={site:S.selected,fields:uiState().fields};
  clearRepair();
  S.selected=option.site_id;$('siteSelect').value=option.site_id;$('start').value=option.start_utc.slice(0,16);$('height').value=option.height_m;
  S.dirty=true;renderSiteDetails();setPage('plan');await runAnalysis({scroll:true});
  note('You are inspecting an alternative. Your original inputs can be restored with the button below.','success');
  const button=document.createElement('button');button.className='text-button';button.textContent='Return to my original plan';button.style.marginLeft='12px';button.addEventListener('click',restoreOriginal);$('message').appendChild(button);
}
async function restoreOriginal(){if(!S.originalPlan)return;const before=S.originalPlan;S.originalPlan=null;clearRepair();restoreSettings({selected_site_id:before.site,fields:before.fields});await runAnalysis();}
function renderSources() {
  $('sourceTable').innerHTML=`<table><thead><tr><th>LOCATION</th><th>TERRAIN</th><th>SUN & EARTH</th><th>READINESS</th></tr></thead><tbody>${S.project.sites.map(site=>{
    const terrain=!!site.terrain_kind,track=site.track_mode==='synthetic'||(site.track_mode==='imported'&&!!site.track_start);
    return `<tr><td>${esc(site.name)}<div class="field-note">${fmt(site.latitude_deg,4)}°, ${fmt(site.longitude_deg,4)}° E</div></td><td class="source-cell"><span class="pill ${!terrain?'unknown':site.synthetic_terrain?'fail':'pass'}">${!terrain?'Not added':site.synthetic_terrain?'Synthetic':'User supplied'}</span><br>${esc(site.terrain_source||'Add a skyline CSV or converted terrain bundle.')}${site.fixed_height_m!=null?`<br>Fixed viewpoint: ${fmt(site.fixed_height_m)} m`:''}</td><td class="source-cell"><span class="pill ${!track?'unknown':site.track_mode==='synthetic'||site.track_synthetic?'fail':'pass'}">${!track?'Not added':site.track_mode==='synthetic'||site.track_synthetic?'Synthetic':(site.geometry_engine==='spice'?'NASA SPICE':site.geometry_engine==='horizons'?'JPL Horizons':'Imported')}</span><br>${esc(site.track_source||'Add a time series or prepare Sun/Earth data.')}${site.track_start?`<br>${esc(site.track_start)} to ${esc(site.track_end)}`:''}</td><td>${terrain&&track?'<span class="pill pass">✓ Inputs present</span>':'<span class="pill unknown">? Needs input</span>'}<div class="field-note">Slope: ${site.slope_deg==null?'not supplied':site.slope_synthetic?'synthetic':'user supplied'}</div></td></tr>`;
  }).join('')}</tbody></table>`;
}
function renderImpact() {
  const box=$('impactBox');if(!S.prior||!S.analysis||S.dirty){box.classList.add('hidden');return;}
  const rows=[];
  for(const now of S.analysis.results){const before=S.prior.results.find(r=>r.site_id===now.site_id);if(!before?.metrics||!now.metrics)continue;
    rows.push(`<tr><td>${esc(now.site_name)}</td><td>${tag(before.status)} → ${tag(now.status)}</td><td>${fmt(now.metrics.sunlight_pct-before.metrics.sunlight_pct,2)} points</td><td>${fmt(now.metrics.longest_dark_h-before.metrics.longest_dark_h,2)} h</td></tr>`);}
  if(!rows.length)return box.classList.add('hidden');
  const same=JSON.stringify(S.prior.parameters)===JSON.stringify(S.analysis.parameters);box.classList.remove('hidden');
  box.innerHTML=`<div class="eyebrow">WHAT CHANGED?</div><h3>Before and after your data update</h3><p class="field-note">${same?'Mission settings are unchanged, so this comparison shows the effect of the data update.':'Mission settings also changed. These differences cannot be attributed to the new data alone.'}</p><div class="table-wrap"><table><thead><tr><th>LOCATION</th><th>RESULT</th><th>SUNLIGHT CHANGE</th><th>LONGEST DARKNESS CHANGE</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}
function csvHelp() {
  const kind=$('csvKind').value;
  const help={
    horizon:['One row for each direction around the site. Use a complete 360° skyline. This profile only works at its declared viewpoint height.','azimuth_deg,horizon_deg','example_horizon_SYNTHETIC.csv'],
    ephemeris:['One row per UTC time, with directions for both Sun and Earth. Times must be increasing and cover the entire requested mission.','time_utc,sun_azimuth_deg,sun_elevation_deg,earth_azimuth_deg,earth_elevation_deg','example_ephemeris_SYNTHETIC.csv'],
    attributes:['Each row updates the slope of an existing site ID. Unknown IDs are rejected. This adds a slope value, not a hazard or safety certification.','site_id,slope_deg','example_site_slopes.csv']};
  const [text,columns,file]=help[kind];
  $('csvHelp').innerHTML=`${text}<code>${columns}</code><a href="./samples/${file}" download>Download a matching synthetic example ↓</a>`;
  $('csvHeightField').classList.toggle('hidden',kind!=='horizon');$('csvRangeField').classList.toggle('hidden',kind!=='horizon');$('csvGapField').classList.toggle('hidden',kind!=='ephemeris');
}
async function dataAction(label,fn,{restore=false}={}) {
  if(S.busy)return;busy(true,label);
  try {
    const response=await fn();S.prior=S.analysis||S.prior;S.analysis=null;S.dirty=false;stopPlayback();clearRepair();
    projectUpdated(response.project,restore);renderSelected();renderCompare();$('impactBox').classList.add('hidden');
    $('settingsNote').textContent='Data changed. Check your plan again to calculate the new result.';$('settingsDot').classList.add('dirty');
    note(response.message||'Data added. Check your plan again to update the results.','success');await saveSettings();
  } catch(e){note(e.message,'error');}finally{busy(false);}
}
function download(name,text,type='application/json') {
  const anchor=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type}));anchor.href=url;anchor.download=name;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function csvSafe(value) {let str=String(value??'');if(/^[=+@\-]/.test(str))str="'"+str;return '"'+str.replace(/"/g,'""')+'"';}
function exportResults() {
  if(!S.analysis||S.dirty)return note('Check your current plan before exporting results.','warn');
  const fields=['site_id','site_name','status','sunlight_pct','longest_dark_h','earth_visible_pct','longest_earth_gap_h','terrain_source','track_source','synthetic_terrain','synthetic_track','synthetic_slope','slope_source','start_utc','duration_h','height_m'];
  const lines=S.analysis.results.map(result=>{const flat={...result,...result.metrics,...S.analysis.parameters};return fields.map(k=>csvSafe(flat[k])).join(',');});
  download('LunaShift_results.csv',fields.join(',')+'\n'+lines.join('\n'),'text/csv');
}
async function exportProject() {
  try {await saveSettings();const p=await api('/api/export');const stamp=new Date().toISOString().slice(0,19).replace(/:/g,'-');download('LunaShift_workspace_'+stamp+'.json',JSON.stringify(p,null,2));note('A project JSON was downloaded. It includes the data and mission settings. Share it with your team or open it again in Data & Sources.','success');}
  catch(e){note(e.message,'error');}
}
const HELP={
  skyline:['Reading the skyline','Imagine standing at the selected site and turning in a full circle. The green shape is the terrain that fills your view. The Sun and Earth must appear above that skyline, plus any clearance margin you chose. A hollow marker means the visibility test does not pass.','North 0° → East 90° → South 180° → West 270°'],
  dates:['Reading the date explorer','Each cell asks: “If we start the complete mission this many hours later, do all enabled checks pass?” The grid uses your original viewpoint height. Green Pass is not a safety certificate; it is a result under the data and limits you selected.','Pick a cell → inspect that site and landing time'],
  sources:['Real data and synthetic data','The first project uses invented terrain and invented Sun/Earth curves. It is a teaching example. Real Horizons tracks only replace the tracks, not the terrain. Both sources, time coverage, and coordinate frames must be checked before a result can be used beyond learning.','Location + terrain + tracks → visibility estimate']
};
function openHelp(key){const [title,text,diagram]=HELP[key]||HELP.skyline;$('dialogEyebrow').textContent='PLAIN-ENGLISH EXPLANATION';$('dialogContent').innerHTML=`<h2>${title}</h2><p>${text}</p><div class="tour-diagram">${diagram}</div>`;$('dialogActions').innerHTML='<button class="button primary" data-dialog-close>Got it</button>';if(!$('helpDialog').open)$('helpDialog').showModal();}
const TOUR=[
  ['Welcome to a clearer workspace.','Start with the included example. You do not need NASA files to learn the controls. The amber banner always tells you when inputs are synthetic.','plan','Start with an example → replace the data when ready'],
  ['Choose a place, a time, and your limits.','The three numbered blocks are all you need for a first run. Technical settings are tucked under “More settings.” Select Calculate mission results after making a change.','plan','1 Place → 2 Time → 3 Limits'],
  ['Read the answer before the charts.','The result tells you whether the enabled checks pass. The four numbers explain sunlight, darkness, Earth visibility, and the longest Earth-hidden gap. Use the timeline to see why.','plan','Result → numbers → visual explanation'],
  ['Explore a better option.','You decide which changes are allowed. The app tests candidate locations, delays, and heights. Inspecting an option changes the inputs; you can then return to your original plan.','repair','Choose allowed changes → test → inspect'],
  ['Bring your team and your data.','Use Data & Sources to open a project or add a layer. Save a copy downloads your data and settings. Local autosave helps on your Mac; Colab storage is temporary, so download your work.','data','Save a project JSON → share → reopen']
];
function startTour(){S.tourIndex=0;showTour();}
function showTour(){const [title,text,page,diagram]=TOUR[S.tourIndex];setPage(page);$('dialogEyebrow').textContent='GUIDED TOUR';$('dialogContent').innerHTML=`<div class="tour-step-count">${S.tourIndex+1} of ${TOUR.length}</div><h2>${title}</h2><p>${text}</p><div class="tour-diagram">${diagram}</div>`;$('dialogActions').innerHTML=`<button class="button ghost" ${S.tourIndex?'data-tour-back':'data-dialog-close'}>${S.tourIndex?'Back':'Skip tour'}</button><button class="button primary" ${S.tourIndex===TOUR.length-1?'data-tour-done':'data-tour-next'}>${S.tourIndex===TOUR.length-1?'Start exploring':'Next →'}</button>`;if(!$('helpDialog').open)$('helpDialog').showModal();}
function openReport() {
  const r=current();if(!r?.metrics)return note('Check a complete plan before making a report.','warn');
  const m=r.metrics;$('dialogEyebrow').textContent='SHARE YOUR RESULT';
  $('dialogContent').innerHTML=`<h2>Mission report</h2><p>${esc(r.site_name)} · ${prettyDate(r.parameters.start_utc)} · ${duration(r.parameters.duration_h)}</p>${tag(r.status)}<div class="report-metrics"><div>Sunlight<b>${fmt(m.sunlight_pct)}%</b></div><div>Longest darkness<b>${fmt(m.longest_dark_h)} h</b></div><div>Earth visible<b>${fmt(m.earth_visible_pct)}%</b></div><div>Longest Earth gap<b>${fmt(m.longest_earth_gap_h)} h</b></div></div><p>The report includes sources, mission settings, comparison results, chart snapshots, and model limitations. It is a standalone HTML file; open it in a browser and use Print to save a PDF.</p>`;
  $('dialogActions').innerHTML='<button class="button ghost" data-dialog-close>Close</button><button class="button primary" data-download-report>Download report ↓</button>';
  if(!$('helpDialog').open)$('helpDialog').showModal();
}
function reportHTML(){
  const r=current(),p=r.parameters,m=r.metrics;const images={};
  if(S.page==='plan'){drawAll();for(const id of ['mapCanvas','skyCanvas','timelineCanvas']) images[id]=$(id).toDataURL('image/png');}
  const rows=S.analysis.results.map(x=>`<tr><td>${esc(x.site_name)}</td><td>${esc(x.status)}</td><td>${fmt(x.metrics?.sunlight_pct)}%</td><td>${fmt(x.metrics?.longest_dark_h)} h</td><td>${fmt(x.metrics?.earth_visible_pct)}%</td><td>${fmt(x.metrics?.longest_earth_gap_h)} h</td></tr>`).join('');
  const paramsRows=Object.entries(p).map(([key,value])=>`<tr><td>${esc(key)}</td><td>${esc(value)}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LunaShift mission report</title><style>body{font:14px/1.65 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#193640;max-width:1000px;padding:40px;margin:auto}h1{font-size:34px;letter-spacing:-1px}h2{font-size:20px;margin-top:30px}.notice{background:#fff3de;border:1px solid #ead7b2;padding:15px;border-radius:8px}.metrics{display:flex;gap:15px;flex-wrap:wrap}.metrics>div{background:#f0f5f1;padding:18px;min-width:180px;border-radius:10px}.metrics b{font-size:27px;display:block}table{border-collapse:collapse;width:100%;font-size:12px}th,td{padding:10px;border-bottom:1px solid #ddd;text-align:left}th{background:#f4f6f4}img{width:100%;object-fit:contain}figure{margin:20px 0;break-inside:avoid}figcaption{font-size:11px;color:#687b80}footer{font-size:11px;color:#657b80;border-top:1px solid #ddd;margin-top:30px}@media print{body{padding:0;font-size:11px}h2{break-after:avoid}.metrics,table{break-inside:avoid}}</style></head><body><small>LUNASHIFT / MISSION PLANNER / v0.5.0</small><h1>${esc(r.site_name)}</h1><p>Landing: ${prettyDate(p.start_utc)} · Duration: ${duration(p.duration_h)} · Viewpoint: ${fmt(p.height_m)} m</p><div class="notice"><b>${r.synthetic_terrain||r.synthetic_track||r.synthetic_slope?'SYNTHETIC OR MIXED INPUTS — NOT A LUNAR FORECAST':'USER-SUPPLIED INPUTS — SCIENTIFIC VALIDATION REQUIRED'}</b><br>Independent learning prototype. Status “pass” means enabled modeled limits pass, not mission certification.</div><h2>${r.status==='pass'?'Within your selected limits':r.status==='fail'?'This plan needs a change':'Missing information'}</h2><p>${esc(r.reasons.join(' ')||'All enabled checks pass for this dataset.')}</p><div class="metrics"><div>Sunlight<b>${fmt(m.sunlight_pct)}%</b></div><div>Longest darkness<b>${fmt(m.longest_dark_h)} h</b></div><div>Earth visible<b>${fmt(m.earth_visible_pct)}%</b></div><div>Longest Earth gap<b>${fmt(m.longest_earth_gap_h)} h</b></div></div>${Object.entries(images).map(([id,src])=>`<figure><img src="${src}" alt="${id}"><figcaption>${id==='mapCanvas'?'Local site layout. Synthetic terrain is labeled.':id==='skyCanvas'?'Terrain skyline and body-centre directions at the selected time.':'Visibility timeline inside the selected mission.'}</figcaption></figure>`).join('')}<h2>Candidate comparison</h2><table><thead><tr><th>Site</th><th>Modeled status</th><th>Sunlight</th><th>Max darkness</th><th>Earth visible</th><th>Max Earth gap</th></tr></thead><tbody>${rows}</tbody></table><h2>Data provenance</h2><p><b>Terrain:</b> ${esc(r.terrain_source)}<br><b>Tracks:</b> ${esc(r.track_source)}<br><b>Slope:</b> ${esc(r.slope_source)}<br><b>Terrain range:</b> ${fmt(r.profile.range_limit_m/1000,2)} km; beyond this range is not verified.</p><h2>Calculation settings</h2><table>${paramsRows}</table><h2>Model limitations</h2><p>Spherical lunar geometry, sampled finite-range terrain, body-centre visibility, one shared Sun/Earth viewpoint height, and piecewise-linear time crossings. Short events may be missed. This visibility section is not an energy or radio-link calculation. Power & Communications adds separate, assumption-dependent engineering estimates when calculated. There is no flight certification, live station schedule, validated thermal model or global-optimality guarantee.</p><footer>Generated ${prettyDate(new Date().toISOString())}. Sharing this report does not share the running application. Save the workspace JSON to reproduce the data and settings.</footer></body></html>`;
}

// Event delegation also covers results rendered after a calculation.
document.addEventListener('click',async event=>{
  const button=event.target.closest('button,a');if(!button)return;
  if(button.dataset.page){setPage(button.dataset.page);return;}
  if(button.dataset.go){setPage(button.dataset.go);return;}
  if(button.dataset.help){openHelp(button.dataset.help);return;}
  if(button.dataset.inspect){choose(button.dataset.inspect,true);return;}
  if(button.dataset.action==='analyze'){await runAnalysis({scroll:true});return;}
  if(button.dataset.option!=null){await applyOption(S.displayedOptions[+button.dataset.option]);return;}
  if(button.dataset.allOption!=null){await applyOption(S.repair.alternatives[+button.dataset.allOption]);return;}
  if(button.dataset.envelopeSite){await applyOption({site_id:button.dataset.envelopeSite,start_utc:new Date(new Date(S.repairBase.start_utc).getTime()+(+button.dataset.delay)*3600000).toISOString(),height_m:S.repairBase.height_m});return;}
  if(button.hasAttribute('data-dialog-close'))$('helpDialog').close();
  if(button.hasAttribute('data-tour-back')){S.tourIndex--;showTour();}
  if(button.hasAttribute('data-tour-next')){S.tourIndex++;showTour();}
  if(button.hasAttribute('data-tour-done')){$('helpDialog').close();setPage('plan');}
  if(button.hasAttribute('data-download-report')){download('LunaShift_mission_report.html',reportHTML(),'text/html');$('helpDialog').close();note('Report downloaded. Open the HTML file in a browser; use Print to save a PDF.','success');}
});
$('planForm').addEventListener('submit',event=>{event.preventDefault();runAnalysis({scroll:true});});
$('siteSelect').addEventListener('change',event=>choose(event.target.value));
for(const id of SETTINGS)$(id).addEventListener('input',markDirty);
function syncSearchInputs(){ $('maxDelay').disabled=!$('allowDelay').checked; $('delayStep').disabled=!$('allowDelay').checked; $('maxHeight').disabled=!$('allowHeight').checked; $('heightStep').disabled=!$('allowHeight').checked; }
for(const id of SEARCH_SETTINGS)$(id).addEventListener('change',()=>{clearRepair();syncSearchInputs();queueSettings();});
$('preference').addEventListener('change',()=>{const weights={balanced:[1,1,1],location:[8,1,1],date:[1,8,1],height:[1,1,8]}[$('preference').value];if(weights){['wMove','wDelay','wHeight'].forEach((id,index)=>$(id).value=weights[index]);queueSettings();}});
for(const id of ['wMove','wDelay','wHeight'])$(id).addEventListener('input',()=>{$('preference').value='custom';clearRepair();queueSettings();});
$('timeSlider').addEventListener('input',event=>{const value=+event.target.value;stopPlayback();S.sample=value;updateTime();drawAll();});
$('mapCanvas').addEventListener('click',event=>{const rect=event.target.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;const hit=S.mapHits.find(point=>Math.hypot(x-point.x,y-point.y)<19);if(hit)choose(hit.id);});
$('mapCanvas').addEventListener('mousemove',event=>{const rect=event.target.getBoundingClientRect();event.target.style.cursor=S.mapHits.some(point=>Math.hypot(event.clientX-rect.left-point.x,event.clientY-rect.top-point.y)<19)?'pointer':'default';});
$('timelineCanvas').addEventListener('click',event=>{const r=current();if(!r?.tracks)return;const rect=event.target.getBoundingClientRect(),fraction=Math.max(0,Math.min(1,(event.clientX-rect.left-54)/(rect.width-68)));S.sample=Math.round(fraction*(r.tracks.length-1));$('timeSlider').value=S.sample;updateTime();drawAll();});
$('playButton').addEventListener('click',togglePlayback);
$('repairButton').addEventListener('click',runRepair);
$('exportProject').addEventListener('click',exportProject);
$('exportResults').addEventListener('click',exportResults);
$('reportButton').addEventListener('click',openReport);
$('tourButton').addEventListener('click',startTour);$('learnStart').addEventListener('click',startTour);$('closeDialog').addEventListener('click',()=>$('helpDialog').close());
$('csvKind').addEventListener('change',csvHelp);
$('importProject').addEventListener('click',async()=>{const file=$('projectFile').files[0];if(!file)return note('Choose a LunaShift project JSON file first.','error');if(file.size>32000000)return note('This project is larger than the 32 MB limit.','error');await dataAction('Checking and opening your project…',async()=>api('/api/import',{kind:'project',project:JSON.parse(await file.text())}),{restore:true});});
$('importCsv').addEventListener('click',async()=>{const file=$('csvFile').files[0];if(!file)return note('Choose the CSV file you want to add.','error');if(file.size>31000000)return note('This CSV is too large for the learning platform.','error');if(!$('csvSource').value.trim())return note('Write a source or description so your team knows where these values came from.','error');await dataAction('Checking the CSV columns and attaching your layer…',async()=>api('/api/import',{kind:$('csvKind').value,site_id:$('csvSite').value,text:await file.text(),source:$('csvSource').value,metadata:{observer_height_m:+$('csvHeight').value,range_limit_m:+$('csvRange').value,max_gap_min:+$('csvGap').value,synthetic:$('csvSynthetic').checked}}));});
$('fetchButton').addEventListener('click',()=>prepareGeometryFromData());
$('addSite').addEventListener('click',()=>dataAction('Adding your location…',()=>api('/api/add_site',{id:$('newId').value,name:$('newName').value,latitude_deg:+$('newLat').value,longitude_deg:+$('newLon').value,ground_elevation_m:+$('newElevation').value,slope_deg:$('newSlope').value===''?null:+$('newSlope').value})));
async function resetDemo(){if(!confirm('Replace this workspace with the synthetic learning example? Save a copy first to keep your current data.'))return;await dataAction('Restoring the learning example…',()=>api('/api/reset',{}),{restore:true});restoreSettings({selected_site_id:'A',fields:{start:'2026-11-01T00:00',duration:'120',step:'60',height:'2',minSun:'35',maxDark:'30',maxGap:'36',maxSlope:'12',margin:'0.05',slopeCheck:true,allowMove:true,allowDelay:true,allowHeight:true,maxDelay:'72',maxHeight:'10',delayStep:'12',heightStep:'4',wMove:'1',wDelay:'1',wHeight:'1',preference:'balanced'}});setPage('plan');await runAnalysis();}
$('resetButton').addEventListener('click',resetDemo);$('exampleButton').addEventListener('click',resetDemo);
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(drawAll,100);});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopPlayback();});
async function init(){
  csvHelp();syncSearchInputs();
  try {const data=await api('/api/state');S.token=data.token;S.storage=data.storage;projectUpdated(data.project,true);$('saveState').textContent=data.storage?.persistent?'Autosave on this computer':'Temporary runtime storage';
    if(data.storage?.warning)note(data.storage.warning,'warn');
    await runAnalysis();
    setPage('plan',false);
  }catch(e){note(e.message,'error');$('dataBadge').textContent='Server not connected';$('dataText').textContent='Start run.py on your Mac, or run the launcher cell in the Colab notebook, then reload this page.';}
}
// init() is called by studio.js after extensions are registered.
