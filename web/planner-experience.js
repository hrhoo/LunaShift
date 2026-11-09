import {classifyChoice,counterfactualRows,passingDateRun,comparePlans,energyLedger,ricianBpskBer,radioState,missionRadioSummary} from './planner-insights.js';
import {missionChecks} from './decision-model.js';
import {linkBudget,earthGeometry} from './mission-model.js';
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const f=(n,d=1)=>Number.isFinite(n)?n.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const h=n=>Number.isFinite(n)?f(n,2)+' h':'Not reached';
const short=n=>String(n||'').replace('Connecting Ridge · ','');
const date=t=>new Date(t).toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'});
const same=(a,b)=>a?.siteId===b?.siteId&&Date.parse(a?.startUTC)===Date.parse(b?.startUTC);
const positive=n=>(n>0?'+':'')+f(n);
export function initPlannerExperience(api){
 const state=api.state;let lastKey='',lastCurrent=null,lastAlternative=null,lastChoices=null,energyResult=null;
 function expand(id){
  const stage=$('sceneStage');api.setView('mission');
  if(stage.dataset.expanded===id)delete stage.dataset.expanded;else stage.dataset.expanded=id;
  document.querySelectorAll('[data-expand-pane]').forEach(b=>{const active=stage.dataset.expanded===b.dataset.expandPane;b.textContent=active?'⤡':'⤢';b.setAttribute('aria-expanded',String(active));b.title=active?'Restore linked views':'Expand this view';});
  requestAnimationFrame(()=>{state.scene?.resize();state.mapScene?.resize();api.drawAll();});
 }
 document.querySelectorAll('[data-expand-pane]').forEach(b=>b.addEventListener('click',()=>expand(b.dataset.expandPane)));
 document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.view!=='mission')delete $('sceneStage').dataset.expanded;}));
 $('inspectPhysics').addEventListener('click',()=>{if(state.current&&!state.dirty)expand('horizonPane');});
 $('energyExplanation').addEventListener('click',()=>api.drawer('From sunlight to usable energy',`<h3>Terrain comes first</h3><p>The model compares the finite Sun disc with the collector's numerical terrain skyline at each time. It includes the geometric Earth-disc eclipse mask, then projects sunlight onto the selected panel orientation.</p><p><b>Electrical output = irradiance × area × efficiency × retained output × visible solar fraction × incidence factor.</b> Time integration gives generated kWh. The separate battery model includes initial charge, loads, radio electricity, storage efficiency, reserve and curtailment.</p><h3>Two different clocks</h3><p><b>Harvest target:</b> when cumulative generated electricity reaches the task-energy amount. <b>Task stored above reserve:</b> when the battery holds the task amount above its reserve. Initial battery energy counts toward the latter. The task is not automatically executed or deducted; schedule a payload load to consume energy.</p><h3>What the NASA presentation supports</h3><p><i>Solar Power for Lunar Pole Missions</i> (Pappa et al., 2019), pp. 6–11, explains low solar angles, terrain-dependent illumination and array options. Pages 17 and 31 identify shadowing and environmental challenges. It does not supply this app's complete battery or arbitrary-array model. Those equations and loss assumptions are declared engineering extensions. The collector is a reference point; string-level partial shading and temperature dynamics are not simulated.</p>`));
 $('radioExplanation').addEventListener('click',()=>api.drawer('Visibility is only the first link condition',`<h3>Three separate gates</h3><p>The station direction must clear lunar terrain. The Earth station must see the lander above its elevation mask. Finally, the radio needs a usable rate and electrical power above the battery reserve.</p><p><b>C/N₀ = transmit power (dBW) + transmit gain + ground G/T − free-space loss − other losses + 228.599.</b> The supported model rate is capped at the user maximum and reduced when the selected Eb/N₀ and fade-margin allowance require it. A negative margin at the rate cap does not mean no adaptive link exists.</p><h3>What the communication paper supports</h3><p>Divsalar, Sanchez Net and Cheung (2019) describe low-elevation lunar-surface multipath and assume direct line of sight before analysing a Rician channel. Equations 7 and 9–11 give an uncoded BPSK error-probability reference with perfect synchronization. The optional readout here evaluates that ideal reference at K = 10 dB; it is not a reproduction of the paper's PLL, LDPC or coded-frame simulation.</p><p>Data-delivery calculations continue to use the declared link-budget and fade-margin model, not the reference BER. Access does not reserve a real station. Weather, operational scheduling, detailed antenna-pattern multipath and measured site-specific K are not supplied.</p>`));
 function clear(){
  $('decisionAtlas').hidden=true;$('scienceReadout').hidden=!state.current;
 }
 function render(){
  if(!state.current)return;
  const s=state.current.settings;
  $('settingsSummary').textContent=`${f(s.areaM2,1)} m² array · ${f(s.batteryKWh,1)} kWh battery · ${f(s.loadW,0)} W load · ${f(s.dataTargetGB,1)} GB target`;
  if(state.dirty){clear();return;}
  const changed=lastCurrent!==state.current||lastAlternative!==state.alternative||lastChoices!==state.choices||lastKey!==$('priority').value;
  if(!changed){if(state.alternative)renderBenefits();return;}
  lastCurrent=state.current;lastAlternative=state.alternative;lastChoices=state.choices;lastKey=$('priority').value;
  $('scienceReadout').hidden=false;
  if(state.alternative)renderBenefits();
  renderAtlas();energyResult=null;
 }
 function renderBenefits(){
  const a=state.current,b=state.alternative,c=comparePlans(a,b),isRec=same(state.recommendation?.settings,b.settings);
  const title=!b.metrics.feasible?'This comparison still misses requirements':isRec?'What the preferred option changes':'What this comparison changes';
  const sub=c.recovered.length?'Restores: '+c.recovered.join(' + '):b.metrics.feasible?'Passes the selected checks. Review the trade-offs.':'Do not treat this as a feasible recommendation.';
  const lines=c.deltas.map(row=>{const small=Math.abs(row.delta)<.05,better=!small&&(row.higher?row.delta>0:row.delta<0),bad=!small&&!better;return `<div class="gain-row"><span>${row.label}</span><div><strong class="${better?'better':bad?'worse':''}">${small?'No change':positive(row.delta)+' '+row.unit}</strong><small>${f(row.a,row.unit==='GB'?2:1)} → ${f(row.b,row.unit==='GB'?2:1)} ${row.unit==='pp'?'%':row.unit}</small></div></div>`;}).join('');
  const run=passingDateRun(state.choices,b),runText=run&&run.count>1?`${run.count} successive sampled landing dates pass at this site (${date(run.start)}–${date(run.end)}). Untested dates between samples are not certified.`:'';
  $('comparisonSummary').innerHTML=`<div class="benefit-title"><strong>${esc(title)}</strong><small>${esc(sub)}</small></div><div class="gain-list">${lines}</div><div class="gain-foot">${c.locationChanged?'Location changes':'Same location'} · ${c.timeChanged?positive(c.delayDays)+' days':'same landing date'}. Hardware and mission requirements unchanged.${c.regressed.length?'<br><b>New failures: '+esc(c.regressed.join(', '))+'</b>':''}${runText?'<br>'+esc(runText):''}</div>${state.choices.length?'<button class="atlas-open" id="showAtlas" type="button">Explore all tested sites & dates ↓</button>':''}`;
  $('showAtlas')?.addEventListener('click',()=>$('decisionAtlas').scrollIntoView({behavior:'smooth',block:'start'}));
 }
 function renderAtlas(){
  const choices=state.choices;
  $('decisionAtlas').hidden=!choices.length;
  if(!choices.length)return;
  const dates=[...new Set(choices.map(c=>Date.parse(c.settings.startUTC)))].sort((a,b)=>a-b);
  const siteIds=[...new Set(choices.map(c=>c.settings.siteId))];
  const lookup=new Map(choices.map((c,i)=>[c.settings.siteId+'|'+Date.parse(c.settings.startUTC),{c,i}]));
  const ok=choices.filter(c=>classifyChoice(c).key==='pass').length;
  $('atlasScope').textContent=`${ok} of ${choices.length} tested combinations pass · ${siteIds.length} loaded locations · fixed hardware and requirements`;
  $('atlasGrid').innerHTML=`<table class="atlas-table" aria-label="Mission feasibility by site and landing date"><thead><tr><th scope="col">Landing site</th>${dates.map(t=>`<th scope="col">${date(t)}<span>+${f((t-Date.parse(state.current.settings.startUTC))/86400000,0)} days</span></th>`).join('')}</tr></thead><tbody>${siteIds.map(id=>{const row=choices.find(c=>c.settings.siteId===id);return `<tr><th scope="row">${esc(short(row.name))}</th>${dates.map(t=>{const item=lookup.get(id+'|'+t);if(!item)return '<td></td>';const {c,i}=item,k=classifyChoice(c),a=same(c.settings,state.current.settings),b=same(c.settings,state.alternative?.settings);const tip=`${short(c.name)} · ${date(t)}: ${k.label}${c.metrics?`. Solar ${f(c.metrics.energyKWh)} kWh. Lowest battery ${f(c.metrics.minSocPct)}%. Data ${f(c.metrics.dataAtDeadlineGB,2)} GB. Station access ${f(c.metrics.linkHours)} h.`:'. '+c.error}`;return `<td><button type="button" class="atlas-cell ${k.key} ${a?'is-current':''} ${b?'is-alternative':''}" data-atlas-choice="${i}" title="${esc(tip)}" aria-label="${esc(tip)}" ${!c.metrics?'disabled':''}>${k.symbol}${a||b?'<em>'+(a?'A':'B')+'</em>':''}</button></td>`;}).join('')}</tr>`;}).join('')}</tbody></table>`;
  $('atlasFoot').textContent='Click a tested combination to inspect it as B. Blue outline = current A; gold outline = selected B. E = any energy/storage/load check fails; D = data deadline fails. No interpolation between tested dates.';
  $('atlasGrid').querySelectorAll('[data-atlas-choice]').forEach(btn=>btn.addEventListener('click',async()=>{
   if(state.busy||state.searching||state.dirty)return;const c=choices[Number(btn.dataset.atlasChoice)];
   if(same(c.settings,state.current.settings)){api.focus('current');return;}
   await api.selectChoice(c);api.focus('alternative');
  }));
  renderIsolation();
 }
 function renderIsolation(){
  const a=state.current,b=state.alternative,rows=counterfactualRows(a,b,state.choices);$('isolationPanel').hidden=rows.length<2;
  if(rows.length<2)return;
  $('isolationRows').innerHTML=rows.map((row,i)=>{const r=row.result,k=classifyChoice(r),s=state.bundle.sites.find(x=>x.id===row.siteId);return `<button type="button" class="isolation-case ${r&&same(r.settings,b.settings)?'selected':''}" data-isolation="${i}" ${!r?.metrics?'disabled':''}><small>${i+1} · ${esc(row.label)}</small><strong>${esc(short(s?.name))} · ${date(row.time)}</strong><span class="isolation-status ${k.key==='pass'?'pass':''}">${r?.metrics?k.count+' / 4 checks pass':'Not tested in this search'}</span><div class="isolation-values">${r?.metrics?`${f(r.metrics.energyKWh)} kWh generated<br>${f(r.metrics.minSocPct)}% minimum battery · ${f(r.metrics.dataAtDeadlineGB,2)} GB sent`:'Run Location + date to test this combination.'}</div></button>`;}).join('');
  $('isolationRows').querySelectorAll('[data-isolation]').forEach(btn=>btn.addEventListener('click',async()=>{
   if(state.busy||state.searching||state.dirty)return;const row=rows[+btn.dataset.isolation];
   if(row.id==='original'){api.focus('current');return;}const c=state.choices.find(c=>c.settings.siteId===row.siteId&&Date.parse(c.settings.startUTC)===row.time);
   if(c){await api.selectChoice(c);api.focus('alternative');}
  }));
  const loc=rows.find(r=>r.id==='location'),time=rows.find(r=>r.id==='date');
  let text='Each card changes only the named variables. Results include the same loads, hardware and deadlines relative to landing.';
  if(rows.length===4&&loc?.result?.metrics&&time?.result?.metrics){
   const lp=classifyChoice(loc.result).key==='pass',tp=classifyChoice(time.result).key==='pass';
   if(b.metrics.feasible&&!lp&&!tp)text='For this pair, neither relocation alone nor the date change alone passes. The combined site-and-date change restores all four selected checks.';
   else if(b.metrics.feasible&&tp&&!lp)text='A date change alone already restores the four checks. Relocation is optional: compare its extra energy, reserve and access before choosing it.';
   else if(b.metrics.feasible&&lp&&!tp)text='Relocation alone already restores the four checks. The later landing is optional: compare the extra gains against the schedule change.';
   else if(b.metrics.feasible&&lp&&tp)text='Either single change already passes the checks. The combined change is not necessary for feasibility; compare the trade-offs before relocating and delaying.';
   else text='The selected combined change still fails. The cards show whether changing only the location or date gives a better operational trade-off.';
  }
  $('isolationReason').textContent=text;
 }
 function updateMoment(r,p){
  if(!r||!p||state.dirty)return;
  const role=state.role==='current'?'A · Current':'B · Alternative';$('scienceRole').textContent=role;$('scienceRole').className='role-chip '+(state.role==='current'?'role-a':'role-b');
  if(energyResult!==r){
   energyResult=r;const ledger=energyLedger(r),colors=['#5f89b0','#d0ac67','#c5cdd5','#9392a9'];
   $('harvestTotal').textContent=f(ledger.generated,2)+' kWh';
   $('energyLedger').innerHTML=`<div class="ledger-bar">${ledger.outputs.map((x,i)=>`<span style="width:${ledger.input>0?Math.max(0,x.value/ledger.input*100):0}%;background:${colors[i]}" title="${esc(x.label)}"></span>`).join('')}</div><div class="ledger-item"><span>Initial stored energy</span><b>+ ${f(ledger.initial,2)} kWh</b></div>${ledger.outputs.map((x,i)=>`<div class="ledger-item"><span><i style="background:${colors[i]}"></i>${x.label}</span><b>${f(x.value,2)} kWh</b></div>`).join('')}`;
   $('energyReady').innerHTML=`Harvest ${f(r.settings.taskEnergyKWh,1)} kWh: <b>${h(r.metrics.harvestTargetHour)}</b><br>Task stored above reserve: <b>${h(r.metrics.taskReadyHour)}</b><br><small>Storage readiness includes initial charge; it does not execute the task.</small>`;
  }
  const budget=Number.isFinite(p.cn0DbHz)?p:linkBudget(earthGeometry(state.bundle,r.site,p.utc,r.settings.antennaHeightM,r.settings).station.distanceKm,r.settings),rs=radioState(p,r.settings),rate=p.telemetryAvailable?p.actualTxMbps:0;
  $('liveLinkQuality').textContent=rs.label;$('liveLinkRate').textContent=p.telemetryAvailable?`${f(rate,3)} Mbps actual · ${f(budget.rateBps/1e6,3)} Mbps model ceiling`:'Sky-only view · no battery or transmission forecast';
  const terrain=p.stationClearanceDeg>0,ground=p.groundElevationDeg>r.settings.earthMaskDeg,tx=p.telemetryAvailable&&rate>1e-9;
  $('linkGates').innerHTML=[['Lunar clearance',terrain],['Station view',ground],['Powered radio',tx]].map(([text,good])=>`<div class="link-gate ${good?'good':''}"><b>${good?'✓':'—'}</b>${text}</div>`).join('');
  $('linkFigures').innerHTML=`<div><strong>${f(budget.maxRateMarginDb,1)} dB</strong><small>margin at the ${f(r.settings.maxRateMbps,2)} Mbps cap</small></div><div><strong>${f(budget.cn0DbHz,1)} dB·Hz</strong><small>calculated C/N₀</small></div><div><strong>${f(p.stationClearanceDeg,2)}°</strong><small>lunar clearance after margin</small></div><div><strong>${f(r.metrics.linkHours,1)} h</strong><small>station access in this mission</small></div>`;
  $('linkNote').textContent=(terrain&&ground?'Budget is usable only while both geometry gates remain open.':'Budget values are hypothetical while either geometry gate is closed.')+' A negative cap margin reduces the ideal adaptive rate; it is not a coded modem prediction.';
  const sunClear=p.sunElDeg-p.sunHorizonDeg;
  let text=`${short(r.site.name)} · Sun centre ${f(Math.abs(sunClear),2)}° ${sunClear>=0?'above':'below'} its terrain skyline. `;
  text+=p.eclipsed?'Earth masks the solar disc. ':p.sunFraction>0?`${f(p.sunFraction*100,0)}% of the disc visible → ${f(p.powerW,0)} W electrical output. `:'No direct solar collection at this instant. ';
  text+=terrain?'Station ray clears lunar terrain.':'Station ray is blocked by lunar terrain.';
  $('physicalCaption').querySelector('p').textContent=text;
  if(!$('referenceDetails').innerHTML||$('referenceDetails').parentElement.open){
   const eb=budget.cn0DbHz+10*Math.log10(.75)-10*Math.log10(Math.max(1,r.settings.maxRateMbps*1e6)),ber=ricianBpskBer(eb,10);
   $('referenceDetails').innerHTML=`<article><h4>Solar: terrain → incidence → electricity</h4><p>NASA's <i>Solar Power for Lunar Pole Missions</i> (2019), pp. 6–11, motivates terrain-aware illumination and array orientation; pp. 17,31 discuss environmental limits. This planner adds an explicit point-collector and battery model. Array-string shading, thermal dynamics and deployment mechanics are not predicted.</p><p>Generated energy is not all usable: ${f(r.metrics.spilledKWh,2)} kWh is surplus not stored in this scenario. The energy ledger includes initial charge and storage losses.</p></article><article><h4>Radio: source-based reference, not a modem claim</h4><p>Divsalar et al. (2019), Eqs. 7,9–11: normalized Rician fading, uncoded coherent BPSK and perfect synchronization. Using the paper’s 60° modulation-index reference (75% data power) at the configured rate cap, mean Eᵦ/N₀ is ${f(eb,2)} dB; the ideal K = 10 dB reference gives BER ≈ <b>${ber?.toExponential(2)||'—'}</b>.</p><p>This conditional link reference is ${terrain&&ground?'currently geometrically accessible':'not a connection while geometry is blocked'}. It does not model the paper's PLL, Doppler tracking or LDPC. It does not change the declared fade-margin model or delivered-data calculation.</p></article>`;
  }
 }
 return {render,updateMoment,expand,clear,renderAtlas};
}
