'use strict';
/* One shared mission clock. Geometry illustration, not a photo or ray-traced scene. */
const SKY={focus:'all',diagnostics:null};
function horizonAt(profile,az){
  az=((az%360)+360)%360;const a=profile.azimuth_deg,h=profile.horizon_deg;
  let j=0;while(j<a.length-1&&a[j+1]<=az)j++;
  let x0=a[j],x1=j+1<a.length?a[j+1]:a[0]+360,y0=h[j],y1=h[(j+1)%h.length];
  if(az<a[0]){x0=a.at(-1)-360;x1=a[0];y0=h.at(-1);y1=h[0];}
  return y0+(y1-y0)*(az-x0)/(x1-x0);
}
function bodyGeometry(body,d){
  const az=d.track[body+'_azimuth_deg'],elevation=d.track[body+'_elevation_deg'];
  const supplied=d.track[body+'_angular_diameter_arcsec'];
  const diameter=Number.isFinite(supplied)&&supplied>0?supplied/3600:(body==='sun'?0.533:1.9);
  const radius=diameter/2,cos=Math.max(.01,Math.cos(elevation*Math.PI/180));
  let visible=0,total=0;const n=160;
  // Integrate the exposed circle against the interpolated skyline, without the
  // engineering safety margin. Equal radiance is assumed; not a radio model.
  for(let j=0;j<n;j++){const x=-1+(j+.5)*2/n,half=Math.sqrt(Math.max(0,1-x*x)),threshold=(horizonAt(d.r.profile,az+x*radius/cos)-elevation)/radius;total+=2*half;visible+=Math.max(0,half-Math.max(-half,Math.min(half,threshold)));}
  const fraction=visible/total;
  return{body,az,elevation,radius,diameter,fraction,horizon:horizonAt(d.r.profile,az),marginClearance:d.r.curves[body].clearance_deg[d.i],assumedSize:!(Number.isFinite(supplied)&&supplied>0),state:fraction<.001?'Hidden':fraction>.999?'Fully visible':'Partly visible'};
}
function syncSkySettings(){
  if(!S.project)return;const options=S.project.sites.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  if($('skySite').innerHTML!==options)$('skySite').innerHTML=options;
  if(document.activeElement!==$('skySite'))$('skySite').value=S.selected;
  if(document.activeElement!==$('skyStart'))$('skyStart').value=$('start').value;
  if(document.activeElement!==$('skyDuration'))$('skyDuration').value=$('duration').value;
}
function renderSkyView(){
  if(!$('skyReady'))return;syncSkySettings();syncPlaybackControls();
  const site=currentSite(),d=sampleInfo();
  $('skyContext').textContent=site?`${site.name} · ${fmt(site.latitude_deg,5)}° N, ${fmt(site.longitude_deg,5)}° E · viewpoint ${$('height').value} m · same date and duration as Mission Setup.`:'Choose a site first.';
  $('skyReady').classList.toggle('hidden',!d);$('skyGate').classList.toggle('hidden',!!d);
  if(!d){
    const missing=[];if(!site?.terrain_kind)missing.push('terrain skyline');if(!(site?.track_mode==='synthetic'||site?.track_start))missing.push('Sun/Earth tracks');
    $('skyGateMessage').textContent=missing.length?`This location needs: ${missing.join(' and ')}. A marker on a map does not include these calculation inputs. Nothing has been substituted.`:S.dirty?'Your settings changed. Recalculate before viewing or playing the new mission.':(current()?.reasons||['Calculate the plan to show the selected time.']).join(' ');
    $('skyPrepare').textContent=missing.length?'Open data preparation':'Calculate & show the view';$('skyPrepare').dataset.missing=String(!!missing.length);return;
  }
  const sun=bodyGeometry('sun',d),earth=bodyGeometry('earth',d);
  $('surfaceLocation').textContent=shortName(site)+' · surface viewpoint';
  $('skyDataKind').textContent=d.r.synthetic_terrain||d.r.synthetic_track?'SYNTHETIC TEACHING EXAMPLE — NOT A LUNAR FORECAST':'CALCULATED FROM ATTACHED TERRAIN & EPHEMERIDES';
  $('skyTime').textContent=prettyDate(d.track.time_utc);$('skyProgress').textContent=`${fmt(d.r.hours[d.i],1)} / ${fmt(d.r.parameters.duration_h,0)} hours · sample ${d.i+1} of ${d.r.tracks.length}`;
  for(const g of [sun,earth]){
    $(g.body+'State').textContent=g.state;
    $(g.body+'Details').innerHTML=`<div class="big-value">${fmt(g.fraction*100,1)}% <span style="font-size:12px;letter-spacing:0">of disc clears terrain</span></div><div>Elevation <b>${fmt(g.elevation,2)}°</b> · direction <b>${fmt(g.az,1)}°</b></div><div>Terrain skyline <b>${fmt(g.horizon,2)}°</b></div><div>Centre after your margin <b>${fmt(g.marginClearance,2)}°</b></div><small>${g.assumedSize?'Illustrative apparent diameter: '+fmt(g.diameter,3)+'°. Import apparent-size data for a time-dependent disc.':'Apparent diameter from the attached ephemeris: '+fmt(g.diameter,3)+'°.'} The geometric disc estimate is separate from the centre-based timeline.</small>`;
    $(g.body+'Next').textContent=nextEvent(d.r.intervals[g.body],d.r.hours[d.i],d.r.parameters.duration_h,g.body)+' Centre-clearance criterion, including the selected safety margin.';
  }
  if(S.page==='sky'){drawSurface(d,sun,earth);drawDisc('sunDisc',sun,d);drawDisc('earthDisc',earth,d);drawSkyWindows(d);}
}
function drawSurface(d,sun,earth){
  const q=canvas('surfaceCanvas');if(!q)return;const{ctx,w,h}=q;ctx.fillStyle='#07131e';ctx.fillRect(0,0,w,h);
  const focus=SKY.focus,centre=focus==='all'?180:(focus==='sun'?sun.az:earth.az),span=focus==='all'?360:70;
  const left=centre-span/2,right=centre+span/2,unwrap=a=>{while(a<centre-180)a+=360;while(a>centre+180)a-=360;return a;};
  let lo=-3,hi=7;for(const v of d.r.profile.horizon_deg){lo=Math.min(lo,v-1);hi=Math.max(hi,v+1);}for(const g of [sun,earth]){lo=Math.min(lo,g.elevation-2);hi=Math.max(hi,g.elevation+2);}
  const pad={l:44,r:22,t:36,b:33},X=a=>pad.l+(a-left)/span*(w-pad.l-pad.r),Y=e=>h-pad.b-(e-lo)/(hi-lo)*(h-pad.t-pad.b);
  for(let j=0;j<=4;j++){const e=lo+(hi-lo)*j/4;line(ctx,[[pad.l,Y(e)],[w-pad.r,Y(e)]],'#1d3442',.8);label(ctx,fmt(e,1)+'°',pad.l-7,Y(e)+3,'#8aabb6','right');}
  line(ctx,[[pad.l,Y(0)],[w-pad.r,Y(0)]],'#5d7480',1,[4,5]);
  ctx.font='10px sans-serif';label(ctx,w<500?'ELEVATION · VERTICAL EXAGGERATION':'ELEVATION · VERTICAL SCALE EXAGGERATED',pad.l,20,'#a1b9c2');
  const hp=[];for(let j=0;j<=500;j++){const a=left+span*j/500;hp.push([X(a),Y(horizonAt(d.r.profile,a))]);}
  // Draw true-sized centre positions with deliberately enlarged markers; the
  // separate disc close-ups use equal angular scales and geometric clipping.
  for(const[g,color]of [[sun,'#ecc96f'],[earth,'#7bc5db']]){
    let a=focus==='all'?g.az:unwrap(g.az);if(a<left||a>right)continue;const x=X(a),y=Y(g.elevation),r=g.body==='sun'?9:12;
    ctx.save();ctx.beginPath();ctx.arc(x,y,r,0,2*Math.PI);ctx.fillStyle=color;ctx.globalAlpha=g.fraction>.001?1:.25;ctx.fill();ctx.restore();
    if(g.fraction<.999){ctx.beginPath();ctx.arc(x,y,r+3,0,2*Math.PI);ctx.strokeStyle=color;ctx.setLineDash([3,3]);ctx.stroke();ctx.setLineDash([]);}
  }
  const tone=Math.round(27+sun.fraction*60),grad=ctx.createLinearGradient(0,h*.35,0,h);grad.addColorStop(0,`rgb(${tone+10},${tone+14},${tone+16})`);grad.addColorStop(1,'#17232c');
  ctx.beginPath();ctx.moveTo(X(left),h-pad.b);hp.forEach(pt=>ctx.lineTo(...pt));ctx.lineTo(X(right),h-pad.b);ctx.closePath();ctx.fillStyle=grad;ctx.fill();line(ctx,hp,'#a2afac',1.4);
  for(const[g,color]of [[sun,'#ecc96f'],[earth,'#8cd2e5']]){let a=focus==='all'?g.az:unwrap(g.az);if(a<left||a>right)continue;const x=X(a),y=Y(g.elevation),target=Y(Math.max(g.elevation,horizonAt(d.r.profile,a)));line(ctx,[[x,y],[x,Math.max(pad.t+7,target-20)]],color,1,[3,3]);ctx.font='600 11px sans-serif';label(ctx,(g.body==='sun'?'Sun':'Earth')+' · '+g.state.toLowerCase(),Math.max(100,Math.min(w-100,x)),Math.max(pad.t+8,target-29),color,'center');}
  const n=focus==='all'?8:6;ctx.font='10px sans-serif';for(let j=0;j<=n;j++){const a=left+span*j/n,az=(a%360+360)%360,t=focus==='all'?['N','NE','E','SE','S','SW','W','NW','N'][j]:fmt(az,0)+'°';label(ctx,t,X(a),h-11,'#a0b8c0','center');}
  ctx.font='11px sans-serif';label(ctx,w<500?'Local lighting only · not a shadow map':'Ground fill indicates local solar access only; no terrain-wide shadow rendering.',pad.l,h-52,'#d5dfdf');
}
function drawDisc(id,g,d){
  const q=canvas(id);if(!q)return;const{ctx,w,h}=q;ctx.fillStyle='#081822';ctx.fillRect(0,0,w,h);
  const R=Math.min(w*.28,h*.29),cx=w/2,cy=h*.43,scale=R/g.radius,X=dx=>cx+dx*scale,Y=e=>cy-(e-g.elevation)*scale;
  const grad=ctx.createRadialGradient(cx-R*.3,cy-R*.4,R*.1,cx,cy,R);grad.addColorStop(0,g.body==='sun'?'#ffedb8':'#afd9e4');grad.addColorStop(1,g.body==='sun'?'#d6a24c':'#2d7089');ctx.beginPath();ctx.arc(cx,cy,R,0,2*Math.PI);ctx.fillStyle=grad;ctx.fill();
  const pts=[],cos=Math.max(.01,Math.cos(g.elevation*Math.PI/180));for(let j=0;j<=120;j++){const dx=(j/120*w-w/2)/scale;pts.push([X(dx),Y(horizonAt(d.r.profile,g.az+dx/cos))]);}
  ctx.beginPath();ctx.moveTo(0,h);pts.forEach(pt=>ctx.lineTo(...pt));ctx.lineTo(w,h);ctx.closePath();ctx.fillStyle='#35454b';ctx.fill();line(ctx,pts,'#c5d0c9',1.5);
  ctx.beginPath();ctx.arc(cx,cy,R,0,2*Math.PI);ctx.strokeStyle=g.body==='sun'?'#ddbb72':'#79bbcf';ctx.setLineDash([3,3]);ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle='#10222bec';ctx.fillRect(0,h-31,w,31);ctx.font='10px sans-serif';label(ctx,w<170?'Enlarged disc':'Enlarged disc · skyline clip',w/2,h-12,'#c5d6d8','center');
}
function drawSkyWindows(d){
  const q=canvas('skyWindows');if(!q)return;const{ctx,w,h}=q,L=55,R=15,W=w-L-R,T=d.r.parameters.duration_h,X=t=>L+t/T*W;
  for(const[body,color,y,title]of [['sun','#ba9546',18,'Sun'],['earth','#4b9db0',52,'Earth']]){ctx.fillStyle='#e9eeeb';ctx.fillRect(L,y,W,17);ctx.fillStyle=color;for(const[a,b]of d.r.intervals[body])ctx.fillRect(X(a),y,Math.max(1,X(b)-X(a)),17);label(ctx,title,8,y+12,C.text);}
  const x=X(d.r.hours[d.i]);line(ctx,[[x,9],[x,76]],'#263f4a',2);for(let j=0;j<=4;j++)label(ctx,fmt(T*j/4,0)+'h',X(T*j/4),98,C.muted,'center');
}
function setTimeSample(value){const r=current();if(!r?.tracks?.length)return;S.sample=Math.max(0,Math.min(r.tracks.length-1,Math.round(value)));updateTime();drawAll();syncPlaybackControls();}
document.addEventListener('lunashift:time',()=>{
  const d=sampleInfo();syncPlaybackControls();if(d){E.sample=d.i;if($('engSlider'))$('engSlider').value=d.i;$('mapTime').textContent=prettyDate(d.track.time_utc,true);if(S.page==='engineering')drawEngineering();if(S.page==='explore'){E.map?.schedule();drawLocalSky();}}
  if(S.page==='sky')renderSkyView();
});
for(const id of ['skyPlay','mapPlay','engPlay'])if($(id))$(id).addEventListener('click',togglePlayback);
for(const id of ['skySlider','mapSlider'])$(id).addEventListener('input',e=>{const value=+e.target.value;stopPlayback();setTimeSample(value);});
$('skyPrevious').addEventListener('click',()=>{stopPlayback();setTimeSample(S.sample-1);});$('skyNext').addEventListener('click',()=>{stopPlayback();setTimeSample(S.sample+1);});
$('skyWindows').addEventListener('click',e=>{const r=current();if(!r?.tracks?.length)return;const b=e.target.getBoundingClientRect(),f=Math.max(0,Math.min(1,(e.clientX-b.left-55)/(b.width-70)));stopPlayback();setTimeSample(f*(r.tracks.length-1));});
$('playSpeed').addEventListener('change',()=>{if(S.play){stopPlayback();togglePlayback();}});
$('skySite').addEventListener('change',e=>{choose(e.target.value);renderSkyView();});
for(const[from,to]of [['skyStart','start'],['skyDuration','duration']])$(from).addEventListener('input',()=>{$(to).value=$(from).value;markDirty();renderSkyView();});
$('skyCalculate').addEventListener('click',async()=>{await runAnalysis();renderSkyView();});
$('skyPrepare').addEventListener('click',async()=>{if($('skyPrepare').dataset.missing==='true'){setPage('data');return;}await runAnalysis();renderSkyView();});
document.querySelectorAll('[data-sky-focus]').forEach(b=>b.addEventListener('click',()=>{SKY.focus=b.dataset.skyFocus;document.querySelectorAll('[data-sky-focus]').forEach(x=>x.classList.toggle('active',x===b));renderSkyView();}));
$('retryMap').addEventListener('click',()=>E.map.connect());
$('mapDiagnostics').addEventListener('click',async()=>{
  const b=$('mapDiagnostics');b.disabled=true;b.textContent='Checking services…';
  try{const report=await api('/api/diagnostics',undefined,{timeoutMs:30000});SKY.diagnostics={...report,browser_events:E.map.logs};download('LunaShift_connection_report.json',JSON.stringify(SKY.diagnostics,null,2));note('Connection report downloaded. Each source lists whether metadata and a sample tile could actually be retrieved.','success');}
  catch(error){download('LunaShift_browser_connection_report.json',JSON.stringify({server_error:error.message,browser_events:E.map.logs},null,2));note('The server diagnostic was unavailable. The downloaded report contains the browser errors.','warn');}
  finally{b.disabled=false;b.textContent='Connection report';}
});
const referenceUrl='https://svs.gsfc.nasa.gov/vis/a000000/a005200/a005228/southpole_earth_sun_360p30.mp4';
$('loadReference').addEventListener('click',()=>{
  const v=$('referenceVideo');v.classList.remove('hidden');if(!v.src)v.src=referenceUrl;
  $('referenceStatus').textContent='Loading NASA’s precomputed reference, not your selected mission. If playback fails, use the original NASA page.';
  v.play().then(()=>{$('referenceStatus').textContent='NASA reference playing. This video has its own place, date range and clock.';}).catch(()=>{$('referenceStatus').textContent='Press the video’s play control. If no video loads, open the original NASA page; the calculated mission view above remains independent.';});
});
$('referenceVideo').addEventListener('error',()=>{$('referenceStatus').textContent='NASA’s video could not be loaded on this network. Open the original NASA page. The mission calculation above is unaffected.';});
// Refresh after selecting or importing data, without starting a hidden calculation.
const skyProjectUpdated=projectUpdated;projectUpdated=function(...args){skyProjectUpdated(...args);syncSkySettings();renderSkyView();};
const skyChoose=choose;choose=function(...args){skyChoose(...args);syncSkySettings();renderSkyView();};
const skyMarkDirty=markDirty;markDirty=function(...args){skyMarkDirty(...args);renderSkyView();};
SETTINGS.forEach(id=>$(id).addEventListener('input',()=>{if(S.page==='sky')renderSkyView();}));
