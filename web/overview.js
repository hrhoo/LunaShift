/** Overview only. No Planner state, mission settings, radio or battery calculations are changed.
 * The Moon is the origin of a lunar body-fixed scene. Sun and Earth direction
 * vectors come from the packaged ephemeris, translated to the labelled site.
 * Their display distances and physical sizes are deliberately compressed.
 */
import {PolarScene} from './polar-scene.js';
import {skyAt,ephemerisBounds} from './sky-model.js';
import {MISSION_DEFAULTS} from './mission-model.js';
import {horizonForSite} from './solar-model.js';
import {unit,add,mul,dot} from './visual-geometry.js';
import {geoUnit,polarBasis,projectSpherePoint,bodyDisplayPoint,DEG} from './polar-geometry.js';
import {drawCelestial} from './sky-visuals.js';
const $=id=>document.getElementById(id);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const fmt=n=>(n>=0?'+':'−')+Math.abs(n).toFixed(2)+'°';
const utcLabel=ms=>new Date(ms).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'UTC',hour12:false})+' UTC';

export class OverviewScene extends PolarScene {
 constructor(canvas){
  super(canvas,{});this.autoFrame=false;this.latitude=-63;this.yaw=-88;this.zoom=1;
  this.showPaths=false;this.mode='polar';
  this.canvas.addEventListener('dblclick',()=>this.reset());
 }
 reset(){
  const s=this.samples.current;if(s){const sum=add(unit(s.sunPositionKm),unit(s.earthPositionKm));const v=unit(sum);this.yaw=Math.atan2(v[1],v[0])/DEG;}
  this.latitude=-63;this.zoom=1;this.render();
 }
 setCamera(){/* Body images on Overview are labels, not extra navigation. */}
 drawPolar(c,rec,s){
  const w=this.width,h=this.height,mobile=w<600;
  const bg=c.createRadialGradient(w*.48,h*.5,0,w*.48,h*.5,w*.75);
  bg.addColorStop(0,'#111c2a');bg.addColorStop(.6,'#080f1b');bg.addColorStop(1,'#060b13');c.fillStyle=bg;c.fillRect(0,0,w,h);
  // A very quiet star field is a backdrop only, never used as an astrometric chart.
  for(let i=0;i<90;i++){const x=((i*97.1357)%1)*w,y=((i*41.1729)%1)*h;c.fillStyle=`rgba(189,207,228,${.1+(i%4)*.035})`;c.fillRect(x,y,i%19===0?1.25:.65,i%19===0?1.25:.65);}
  let basis=polarBasis(this.latitude,this.yaw);
  if(mobile)basis={front:basis.front,right:basis.up,up:mul(basis.right,-1)};
  const r=(mobile?Math.min(w*.25,(h-180)/4.5):Math.min(w*.166,h*.37))*this.zoom;
  const cx=w*.5,cy=h*(mobile?.49:.55);
  const project=p=>projectSpherePoint(p,basis,cx,cy,r);
  const site=rec.result.site;
  this.drawMoon(c,basis,cx,cy,r,unit(s.sunPositionKm));
  // Latitude markings follow the curved sphere and are only drawn on its near side.
  for(const lat of [-80,-60]){
   c.beginPath();let connected=false;
   for(let lon=-180;lon<=180;lon+=2){const v=geoUnit(lat,lon),p=project(mul(v,1.003));if(dot(v,basis.front)<.015){connected=false;continue;}if(connected)c.lineTo(p.x,p.y);else{c.moveTo(p.x,p.y);connected=true;}}
   c.strokeStyle=lat===-80?'#cfdded3f':'#b2c5d51c';c.lineWidth=.7;c.setLineDash([3,6]);c.stroke();c.setLineDash([]);
  }
  const sitePoint=project(mul(geoUnit(site.latitude_deg,site.longitude_deg),1.009));
  const pole=project([0,0,-1.008]);
  const siteOnFront=dot(geoUnit(site.latitude_deg,site.longitude_deg),basis.front)>0;
  if(siteOnFront){
   c.strokeStyle='#d3ad69';c.fillStyle='#e7c589';c.lineWidth=1.2;c.beginPath();c.arc(sitePoint.x,sitePoint.y,4.5,0,Math.PI*2);c.fill();c.beginPath();c.arc(sitePoint.x,sitePoint.y,10,0,Math.PI*2);c.stroke();
   const tx=mobile?clamp(sitePoint.x-15,20,w-160):clamp(sitePoint.x+43,20,w-185);
   const ty=mobile?clamp(sitePoint.y+46,32,h-45):clamp(sitePoint.y+35,32,h-44);
   c.strokeStyle='#d3ad697a';c.lineWidth=.7;c.beginPath();c.moveTo(sitePoint.x+7,sitePoint.y+7);c.lineTo(tx-7,ty-7);c.stroke();
   c.fillStyle='#08121ee8';c.beginPath();c.roundRect(tx-8,ty-14,mobile?120:133,23,4);c.fill();
   this.text(c,'CONNECTING RIDGE',tx,ty,mobile?9:10,'#e0d1b7','left','600');
  }
  const bodies=[];
  for(const kind of ['sun','earth']){
   const positionKm=s[kind+'PositionKm'];
   const p=project(bodyDisplayPoint(site,positionKm,2.15));
   const depthKm=dot(positionKm,basis.front);
   const radius=mobile?(kind==='sun'?26:31):(kind==='sun'?40:47);
   const margin=radius+18;
   const x=clamp(p.x,margin,w-margin),y=clamp(p.y,margin+25,h-radius-62);
   const offFrame=Math.abs(x-p.x)+Math.abs(y-p.y)>3;
   const tone=kind==='sun'?'#e8bf75':'#8fbddb';
   bodies.push({kind,x,y,radius,tone,depthKm,trueProjection:p,offFrame});
   const visible=kind==='sun'?s.sunVisible===1:s.earthVisible===1;
   // A segmented direction line is always explanatory, not a claim that a radio link exists.
   const length=Math.hypot(x-sitePoint.x,y-sitePoint.y),u=length>0?Math.max(0,1-(radius+9)/length):0;
   c.save();c.globalAlpha=visible?.55:.28;c.lineWidth=.9;c.strokeStyle=tone;c.setLineDash(visible?[2,5]:[2,7]);c.beginPath();c.moveTo(sitePoint.x,sitePoint.y);c.lineTo(sitePoint.x+(x-sitePoint.x)*u,sitePoint.y+(y-sitePoint.y)*u);c.stroke();c.restore();
  }
  bodies.sort((a,b)=>a.depthKm-b.depthKm);
  const [far,near]=bodies;
  const separation=Math.hypot(near.x-far.x,near.y-far.y);
  const overlap=separation<near.radius+far.radius;
  const coincident=separation+Math.abs(near.radius-far.radius)<=1;
  const moon={x:cx,y:cy,radius:r};
  for(const [i,body] of bodies.entries()){
   const {kind,x,y,radius}=body;
   const blockers=bodies.slice(i+1);
   if(body.depthKm<0)blockers.push(moon);
   body.hiddenRegion=new Path2D();
   c.save();
   for(const blocker of blockers){
    const disc=new Path2D();
    disc.arc(blocker.x,blocker.y,blocker.radius,0,Math.PI*2);
    body.hiddenRegion.addPath(disc);
    const outside=new Path2D(disc);
    outside.rect(0,0,w,h);
    c.clip(outside,'evenodd');
   }
   drawCelestial(c,kind,x,y,radius,{glow:true});
   c.restore();
  }
  // Overlay hidden arcs after all foreground bodies have been painted.
  for(const body of bodies){
   const {kind,x,y,radius,tone,hiddenRegion,offFrame}=body;
   if(coincident && body===far)continue;
   c.save();
   c.clip(hiddenRegion);
   c.strokeStyle=tone;c.lineWidth=1.5;c.setLineDash([4,3]);
   c.beginPath();c.arc(x,y,radius,0,Math.PI*2);c.stroke();
   c.restore();
   if(overlap)continue;
   const ly=y+radius+23;
   this.text(c,kind==='sun'?'SUN':'EARTH',x,ly,mobile?10:12,tone,'center','600');
   const dist=Math.hypot(...s[kind+'PositionKm']);
   const d=kind==='sun'?(dist/1e6).toFixed(1)+' million km':Math.round(dist).toLocaleString('en-US')+' km';
   this.text(c,offFrame?'Direction extends beyond view':d+' from Moon',x,ly+18,mobile?9:11,'#8b9bad','center');
  }
  if(overlap){
   const label=near.kind==='earth'?'Earth in front of Sun':'Sun in front of Earth';
   const x=clamp((near.x+far.x)/2,72,w-72);
   const y=Math.max(near.y+near.radius,far.y+far.radius)+23;
   this.text(c,label,x,y,mobile?10:12,near.tone,'center','600');
  }
  // Thin compass indicators describe the camera instead of decorative orbit rings.
  this.text(c,'90° S',pole.x+(mobile?-25:0),pole.y+(mobile?-18:-22),10,'#8f9eae','center');
  this.lastProjection={basis,cx,cy,r};this.projectedBodies=Object.fromEntries(bodies.map(b=>[b.kind,b]));
 }
}

export class OverviewController {
 constructor(canvas,bundle){
  this.bundle=bundle;this.bounds=ephemerisBounds(bundle);this.active=false;this.timer=null;
  this.mode='now';this.speed=1;this.playing=true;this.timeMs=Date.now();this.lastTick=performance.now();
  const site=bundle.sites.find(s=>s.id==='ridge-shoulder')||bundle.sites[0];
  const h=horizonForSite(site,2);
  this.reference={site,settings:{...MISSION_DEFAULTS,siteId:site.id,heightM:2,antennaHeightM:2},horizon:h,antennaHorizon:h};
  this.scene=new OverviewScene(canvas);
  this.scene.setRecords([{role:'current',result:this.reference}],'current');
  this.scene.autoFrame=false;
  $('homePlay').addEventListener('click',()=>this.toggle());
  $('homeSpeed').addEventListener('change',()=>this.changeSpeed(Number($('homeSpeed').value)));
  $('homeNow').addEventListener('click',()=>this.now());
  $('homeReset').addEventListener('click',()=>this.scene.reset());
  document.addEventListener('visibilitychange',()=>{
   if(document.hidden){clearTimeout(this.timer);this.timer=null;}
   else if(this.active){this.lastTick=performance.now();this.tick();}
  });
  for(const id of ['homePlay','homeSpeed','homeReset'])$(id).disabled=false;
  $('homeCoordinates').textContent=`${Math.abs(site.latitude_deg).toFixed(5)}° S · ${Math.abs(site.longitude_deg).toFixed(5)}° ${site.longitude_deg<0?'W':'E'}`;
  this.renderAt(this.timeMs);this.scene.reset();$('homeLoading').hidden=true;this.syncControls();
 }
 renderAt(ms){
  this.timeMs=ms;
  if(!Number.isFinite(ms)||ms<this.bounds.start||ms>this.bounds.end){
   this.sample=null;this.playing=false;this.mode='unavailable';this.scene.samples={};this.scene.render();
   $('homeError').hidden=false;$('homeError').textContent='The current time is outside the included 2026–2027 ephemeris. Current-time positions cannot be shown with this package.';
   $('homeMode').textContent='Outside data coverage';$('homeUTC').textContent=Number.isFinite(ms)?utcLabel(ms):'Invalid time';
   $('homeSunAngle').textContent='Unavailable';$('homeEarthAngle').textContent='Unavailable';
   $('homeSunStatus').textContent='No extrapolated position shown';$('homeEarthStatus').textContent='No extrapolated position shown';
   return false;
  }
  $('homeError').hidden=true;
  try{
   const s=skyAt(this.bundle,this.reference,ms,{telemetry:false});this.sample=s;
   this.scene.setFrame({current:s},'current');
   $('homeUTC').textContent=utcLabel(ms);
   $('homeSunAngle').textContent=`${fmt(s.sunElDeg)} elevation`;
   $('homeEarthAngle').textContent=`${fmt(s.earthElDeg)} elevation`;
   $('homeSunStatus').textContent=`Azimuth ${s.sunAzDeg.toFixed(1)}° · ${s.eclipsed?'Eclipse in model':s.sunFraction<1e-8?'Hidden by terrain':s.sunFraction<.999?'Partly visible':'Above terrain skyline'}`;
   $('homeEarthStatus').textContent=`Azimuth ${s.earthAzDeg.toFixed(1)}° · ${s.earthVisible?'Centre above skyline':'Centre below skyline'}`;
   return true;
  }catch(e){this.playing=false;this.sample=null;$('homeError').hidden=false;$('homeError').textContent='Sky geometry unavailable: '+e.message;return false;}
 }
 syncControls(){
  $('homeMode').textContent=this.mode==='unavailable'?'Outside data coverage':this.playing?(this.mode==='now'?'Current UTC':'Time playback'):'Paused';
  $('homeLiveDot').className='home-live-dot'+(this.mode==='now'&&this.playing?'':' is-paused');
  const label=this.playing?'Pause sky clock':'Resume sky clock';
  $('homePlay').setAttribute('aria-label',label);$('homePlay').title=label;
  $('homePlayIcon').innerHTML=this.playing?'<path d="M6 4v12M14 4v12" stroke="currentColor" stroke-width="3"/>':'<path d="M6 3l11 7-11 7z" fill="currentColor"/>';
  $('homeNow').disabled=this.playing&&this.mode==='now';$('homeNow').hidden=this.playing&&this.mode==='now';
  $('homePlay').disabled=this.mode==='unavailable';$('homeSpeed').disabled=this.mode==='unavailable';
 }
 toggle(){
  if(this.mode==='unavailable')return;
  if(this.playing){this.playing=false;if(this.mode==='now')this.timeMs=Date.now();this.mode='playback';}
  else this.playing=true;
  this.lastTick=performance.now();this.syncControls();this.tick();
 }
 changeSpeed(speed){
  if(![1,24,3600,86400].includes(speed))return;
  if(this.mode==='now')this.timeMs=Date.now();
  this.speed=speed;this.mode='playback';this.playing=true;this.lastTick=performance.now();this.syncControls();this.tick();
 }
 now(){
  this.mode='now';this.speed=1;this.playing=true;this.timeMs=Date.now();this.lastTick=performance.now();$('homeSpeed').value='1';
  this.renderAt(this.timeMs);this.syncControls();this.tick();
 }
 tick(){
  clearTimeout(this.timer);this.timer=null;
  if(!this.active||document.hidden)return;
  const stamp=performance.now(),dt=Math.min(1,Math.max(0,(stamp-this.lastTick)/1000));this.lastTick=stamp;
  if(this.playing){
   const t=this.mode==='now'?Date.now():this.timeMs+dt*1000*this.speed;
   if(t>this.bounds.end){this.renderAt(this.bounds.end);this.playing=false;this.mode='playback';$('homeMode').textContent='End of data coverage';this.syncControls();}
   else this.renderAt(t);
  }
  if(this.playing)this.timer=setTimeout(()=>this.tick(),this.speed>24?100:this.mode==='now'?1000:250);
 }
 setActive(active){
  this.active=active;this.scene.setActive(active);clearTimeout(this.timer);this.timer=null;
  if(active){this.lastTick=performance.now();this.tick();}
 }
 resize(){this.scene.resize();}
}
