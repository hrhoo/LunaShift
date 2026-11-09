/** Interactive software 3D Moon and site-level sky panorama.
 * Same renderer on WebGL and non-WebGL machines. The Moon surface is a sphere;
 * numerical visibility ALWAYS uses the separately computed terrain skyline.
 * Distances, bodies and site markers are magnified for presentation.
 */
import {drawCelestial,onSkyImagesReady} from './sky-visuals.js';
import {dot,cross,unit,add,mul,sub,A_COLOR,B_COLOR,tangentFrame} from './visual-geometry.js';
import {interpolateHorizon} from './solar-model.js';
import {geoUnit,polarBasis,projectSpherePoint,bodyDisplayPoint,isBehindGlobe,angleToPixel,DEG} from './polar-geometry.js';
import {angleDelta,wrapDeg} from './sky-model.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const short=s=>s?.name?.replace('Connecting Ridge · ','')||'';
const color=(role)=>role==='alternative'?B_COLOR:A_COLOR;
const labelTime=ms=>new Date(ms).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC',hour12:false});
export class PolarScene{
 constructor(canvas,{onPick}={}){
  this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:false});this.onPick=onPick;this.mode='polar';this.role='current';this.records=[];this.samples={};this.paths=[];this.yaw=-130;this.latitude=-55;this.zoom=1;this.heading=0;this.fov=360;this.preset='south';this.skyPreset='panorama';this.showPaths=true;this.autoFrame=true;this.phase=0;this.hitPoints=[];this.active=true;this.frameQueued=false;
  this.moonImage=new Image();this.moonImage.onload=()=>{const c=document.createElement('canvas');c.width=2048;c.height=1024;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(this.moonImage,0,0,c.width,c.height);this.texture=x.getImageData(0,0,c.width,c.height).data;this.textureWidth=c.width;this.textureHeight=c.height;this.sphereKey='';this.render();};this.moonImage.src='./assets/moon-color.jpg';
  this.unlisten=onSkyImagesReady(()=>this.render());this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas.parentElement);canvas.style.touchAction='none';canvas.style.cursor='grab';canvas.tabIndex=0;
  canvas.addEventListener('pointerdown',e=>{this.drag={x:e.clientX,y:e.clientY,ox:e.clientX,oy:e.clientY};canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{if(!this.drag)return;const dx=e.clientX-this.drag.x,dy=e.clientY-this.drag.y;if(this.mode==='polar'){this.yaw-=dx*.35;this.latitude=clamp(this.latitude+dy*.22,-89,-12);this.preset='custom';}else{this.heading=wrapDeg(this.heading-dx*this.fov/Math.max(this.width,1));this.skyPreset='custom';}this.drag.x=e.clientX;this.drag.y=e.clientY;this.render();});
  canvas.addEventListener('pointerup',e=>{if(this.drag&&Math.hypot(e.clientX-this.drag.ox,e.clientY-this.drag.oy)<5){const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;const hit=this.hitPoints.find(p=>Math.hypot(x-p.x,y-p.y)<p.r);if(hit?.role)this.onPick?.(hit.role);if(hit?.kind)this.setCamera(hit.kind);}this.drag=null;});
  canvas.addEventListener('wheel',e=>{e.preventDefault();if(this.mode==='polar')this.zoom=clamp(this.zoom*Math.exp(-e.deltaY*.0007),.65,1.5);else this.fov=clamp(this.fov*Math.exp(e.deltaY*.001),70,360);this.render();},{passive:false});
  canvas.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(e.key))return;e.preventDefault();if(e.key==='Home')this.reset();else if(this.mode==='polar'){this.yaw+=(e.key==='ArrowLeft'?-6:e.key==='ArrowRight'?6:0);this.latitude=clamp(this.latitude+(e.key==='ArrowUp'?-4:e.key==='ArrowDown'?4:0),-89,-12);}else this.heading=wrapDeg(this.heading+(e.key==='ArrowLeft'?-8:e.key==='ArrowRight'?8:0));this.render();});
  this.resize();
 }
 resize(){const r=this.canvas.parentElement.getBoundingClientRect();this.width=r.width;this.height=r.height;this.dpr=Math.min(devicePixelRatio||1,1.8);if(this.width<2||this.height<2)return;const w=Math.round(this.width*this.dpr),h=Math.round(this.height*this.dpr);if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;this.sphereKey='';}this.render();}
 setRecords(records,role){this.records=records;this.role=role;this.localMeshKey=null;this.framingKey=null;this.render();}
 setFrame(samples,role,phase=0){this.samples=samples;this.role=role;this.phase=phase;if(this.autoFrame&&samples[role]){const p=samples[role],v=unit(add(unit(p.sunPositionKm),unit(p.earthPositionKm)));this.yaw=Math.atan2(v[1],v[0])/DEG;this.autoFrame=false;}this.render();}
 setPaths(paths,key){if(this.pathKey===key)return;this.paths=paths;this.pathKey=key;this.render();}
 setMode(mode){this.mode=mode;this.resize();this.render();}
 setActive(active){this.active=active;if(active){this.resize();this.render();}}
 reset(){if(this.mode==='polar'){this.latitude=-55;this.yaw=-72;this.zoom=1;this.preset='south';}else{this.heading=0;this.fov=360;this.skyPreset='panorama';}this.render();}
 setCamera(preset){const s=this.samples[this.role],r=this.records.find(r=>r.role===this.role)||this.records[0];if(!s||!r)return;
  if(preset==='paths'){this.showPaths=!this.showPaths;this.render();return;}
  if(this.mode==='polar'){
   this.preset=preset;this.zoom=1;
   if(preset==='south'){this.latitude=-55;const v=unit(add(unit(s.sunPositionKm),unit(s.earthPositionKm)));this.yaw=Math.atan2(v[1],v[0])/DEG;}
   if(preset==='top'){this.latitude=-89;this.yaw=-130;}
   if(preset==='sun'||preset==='earth'){const v=unit(preset==='sun'?s.sunPositionKm:s.earthPositionKm);this.yaw=Math.atan2(v[1],v[0])/DEG+90;this.latitude=-48;}
   if(preset==='both'){const a=unit(s.sunPositionKm),b=unit(s.earthPositionKm),v=unit(add(a,b));this.yaw=Math.atan2(v[1],v[0])/DEG;this.latitude=-55;}
  }else{
   this.skyPreset=preset;if(preset==='panorama'){this.heading=0;this.fov=360;}
   if(preset==='sun'){this.heading=s.sunAzDeg;this.fov=120;}
   if(preset==='earth'){this.heading=s.earthAzDeg;this.fov=120;}
   if(preset==='both'){this.heading=wrapDeg(s.sunAzDeg+angleDelta(s.earthAzDeg,s.sunAzDeg)/2);this.fov=Math.min(360,Math.max(150,Math.abs(angleDelta(s.earthAzDeg,s.sunAzDeg))+55));}
  }
  this.render();
 }
 render(){if(!this.active||!this.width||this.canvas.hidden||!this.canvas.getClientRects().length)return;const c=this.ctx,w=this.width,h=this.height;c.setTransform(this.dpr,0,0,this.dpr,0,0);c.fillStyle='#070d16';c.fillRect(0,0,w,h);this.hitPoints=[];const record=this.records.find(r=>r.role===this.role)||this.records[0],sample=this.samples[this.role];if(!record||!sample){c.fillStyle='#b5c5d7';c.font='14px system-ui';c.fillText('Choose a mission to view its sky.',25,h/2);return;}
  if(this.mode==='polar')this.drawPolar(c,record,sample);else this.drawSky(c,record,sample);
 }
 stars(c){const w=this.width,h=this.height;for(let i=0;i<115;i++){const x=((i*97.1357)%1)*w,y=((i*41.1729)%1)*h;c.fillStyle=`rgba(185,203,223,${.12+(i%5)*.065})`;c.fillRect(x,y,i%13===0?1.5:.8,i%13===0?1.5:.8);}}
 pill(c,text,x,y,fg='#b8c7d8',bg='#101e30',size=11){c.save();c.font=`500 ${size}px system-ui`;const width=c.measureText(text).width+19;c.fillStyle=bg;c.beginPath();c.roundRect(x,y,width,25,5);c.fill();c.fillStyle=fg;c.fillText(text,x+9,y+17);c.restore();return width;}
 text(c,text,x,y,size=12,color='#c9d4df',align='left',weight='400'){c.font=`${weight} ${size}px system-ui`;c.textAlign=align;c.fillStyle=color;c.fillText(text,x,y);c.textAlign='left';}
 drawMoon(c,basis,cx,cy,r,sun){
  const size=Math.max(120,Math.min(700,Math.round(r*2*this.dpr))),key=[size,basis.front.map(v=>v.toFixed(5)).join(),!!this.texture].join(':');
  if(key!==this.sphereKey){this.sphereKey=key;this.sphereCanvas=document.createElement('canvas');this.sphereCanvas.width=size;this.sphereCanvas.height=size;this.sphereContext=this.sphereCanvas.getContext('2d');this.sphereImage=this.sphereContext.createImageData(size,size);this.surface=[];
   for(let yy=0;yy<size;yy++)for(let xx=0;xx<size;xx++){const x=(xx+.5-size/2)/(size/2),y=-(yy+.5-size/2)/(size/2),rho=x*x+y*y;if(rho>1)continue;const z=Math.sqrt(1-rho),n=add(mul(basis.right,x),add(mul(basis.up,y),mul(basis.front,z)));let rgb=[160,162,164];
    if(this.texture){const lon=Math.atan2(n[1],n[0]),lat=Math.asin(clamp(n[2],-1,1)),tx=Math.floor((lon/(2*Math.PI)+.5)*this.textureWidth)%this.textureWidth,ty=clamp(Math.floor((.5-lat/Math.PI)*this.textureHeight),0,this.textureHeight-1),k=(ty*this.textureWidth+tx)*4;rgb=[this.texture[k],this.texture[k+1],this.texture[k+2]];}
    this.surface.push({k:(yy*size+xx)*4,n,rgb,z});
   }this.lastLight=null;
  }
  if(!this.lastLight||dot(this.lastLight,sun)<.99999995){const a=this.sphereImage.data;for(const p of this.surface){const d=dot(p.n,sun),illum=.075+.925*Math.pow(Math.max(0,d),.48),limb=.8+.2*Math.sqrt(p.z);for(let j=0;j<3;j++)a[p.k+j]=clamp(p.rgb[j]*illum*limb*1.1,0,255);a[p.k+3]=255;}this.sphereContext.putImageData(this.sphereImage,0,0);this.lastLight=sun.slice();}
  c.drawImage(this.sphereCanvas,cx-r,cy-r,r*2,r*2);c.strokeStyle='#68839939';c.lineWidth=.8;c.beginPath();c.arc(cx,cy,r,0,Math.PI*2);c.stroke();
 }
 drawPolar(c,rec,s){
  const w=this.width,h=this.height;this.stars(c);const b=polarBasis(this.latitude,this.yaw),site=rec.result.site;
  const framingKey=[this.pathKey,this.yaw,this.latitude,site.id].join('|');
  if(this.framingKey!==framingKey){this.framingKey=framingKey;const positions=this.paths.length?this.paths.flatMap(t=>[t.sun,t.earth]):[s.sunPositionKm,s.earthPositionKm];this.framingPoints=positions.map(p=>projectSpherePoint(bodyDisplayPoint(site,p),b,0,0,1));}
  const ends=this.framingPoints;
  const xmin=Math.min(-1,...ends.map(p=>p.x-.36)),xmax=Math.max(1,...ends.map(p=>p.x+.36)),ymin=Math.min(-1,...ends.map(p=>p.y-.36)),ymax=Math.max(1,...ends.map(p=>p.y+.64));
  const r=Math.min(w*.29,h*.345,(w-50)/(xmax-xmin),(h-148)/(ymax-ymin))*this.zoom,cx=w*.5-(xmin+xmax)*r/2,cy=(94+h-54)/2-(ymin+ymax)*r/2,project=p=>projectSpherePoint(p,b,cx,cy,r);
  const light=unit(s.sunPositionKm);this.drawMoon(c,b,cx,cy,r,light);this.lastProjection={basis:b,cx,cy,r};
  // Latitude rings show the curved polar cap, not an invented planar terrain patch.
  for(const lat of [-80,-60]){c.beginPath();let started=false;for(let lon=-180;lon<=180;lon+=2){const v=geoUnit(lat,lon),p=project(mul(v,1.003));if(dot(v,b.front)<.005){started=false;continue;}if(!started){c.moveTo(p.x,p.y);started=true;}else c.lineTo(p.x,p.y);}c.strokeStyle=lat===-80?'#a3bdcf50':'#8da4ba26';c.lineWidth=.8;c.setLineDash([3,5]);c.stroke();c.setLineDash([]);}
  const sp=project([0,0,-1.009]);if(dot([0,0,-1],b.front)>0){c.strokeStyle='#c8d9e7';c.lineWidth=1;c.beginPath();c.moveTo(sp.x-4,sp.y);c.lineTo(sp.x+4,sp.y);c.moveTo(sp.x,sp.y-4);c.lineTo(sp.x,sp.y+4);c.stroke();this.text(c,'90° S',sp.x+8,sp.y-6,10,'#b7c9d8');}
  if(this.showPaths&&this.paths.length){for(const kind of ['sun','earth']){c.strokeStyle=kind==='sun'?'#d9ad526e':'#73b9e880';c.lineWidth=kind==='sun'?1.2:1.8;c.setLineDash(kind==='sun'?[3,4]:[]);c.beginPath();let prev=null;for(const p of this.paths){const v=bodyDisplayPoint(site,p[kind]),q=project(v);if(isBehindGlobe(v,b)||Math.abs(q.x)>w*3||Math.abs(q.y)>h*3){prev=null;continue;}if(!prev)c.moveTo(q.x,q.y);else c.lineTo(q.x,q.y);prev=q;}c.stroke();c.setLineDash([]);}}
  const pts=this.records.map(a=>({record:a,p:project(mul(geoUnit(a.result.site.latitude_deg,a.result.site.longitude_deg),1.009))}));
  const active=pts.find(p=>p.record.role===this.role)||pts[0];
  for(const a of pts){const selected=a.record.role===this.role;c.strokeStyle=color(a.record.role);c.lineWidth=selected?2:1.4;c.beginPath();c.arc(a.p.x,a.p.y,selected?7:11,0,Math.PI*2);c.stroke();}
  if(active){c.save();c.translate(active.p.x,active.p.y);c.strokeStyle='#d5e1ed';c.lineWidth=1;c.fillStyle='#bca574';c.beginPath();c.moveTo(-5,-7);c.lineTo(5,-7);c.lineTo(7,0);c.lineTo(-7,0);c.closePath();c.fill();c.fillStyle='#cbd7e2';c.fillRect(-4,-11,8,5);c.fillStyle='#355f87';c.fillRect(-15,-8,8,5);c.fillRect(7,-8,8,5);c.beginPath();c.moveTo(-5,0);c.lineTo(-10,4);c.lineTo(-13,4);c.moveTo(5,0);c.lineTo(10,4);c.lineTo(13,4);c.moveTo(0,-11);c.lineTo(0,-16);c.stroke();c.restore();const label=`${this.role==='current'?'A':'B'} · ${short(site)}`,tx=clamp(active.p.x+28,20,w-155),ty=clamp(active.p.y+39,100,h-68);c.strokeStyle=color(this.role);c.lineWidth=.85;c.beginPath();c.moveTo(active.p.x,active.p.y);c.lineTo(tx-5,ty-8);c.stroke();this.pill(c,label,tx,ty-25,color(this.role),'#0b1626ed',11);if(pts.length>1)this.text(c,'A/B sites overlap at this scale',tx,ty+14,9,'#92a5b8');}
  this.projectedBodies={};
  for(const kind of ['sun','earth']){
   const body=bodyDisplayPoint(site,kind==='sun'?s.sunPositionKm:s.earthPositionKm),p=project(body),behind=isBehindGlobe(body,b),radius=w<550?25:34,x=clamp(p.x,radius+14,w-radius-14),y=clamp(p.y,radius+94,h-radius-75),clipped=Math.hypot(x-p.x,y-p.y)>3;
   const visible=kind==='sun'?s.sunVisible:s.earthVisible,tone=kind==='sun'?'#edc377':'#86c9ef';
   const begin=active?.p||sp;c.save();c.strokeStyle=tone;c.globalAlpha=visible?.67:.38;c.lineWidth=1.15;c.setLineDash(visible?[]:[4,5]);c.beginPath();c.moveTo(begin.x,begin.y);c.lineTo(x,y);c.stroke();c.setLineDash([]);c.restore();
   drawCelestial(c,kind,x,y,radius,{dim:false});if(behind||!visible){c.strokeStyle=visible?'#c3d1df':'#d1a392';c.setLineDash([3,4]);c.lineWidth=1;c.beginPath();c.arc(x,y,radius+4,0,Math.PI*2);c.stroke();c.setLineDash([]);}
   const ay=y+radius+19,lx=clamp(x,72,w-72),el=kind==='sun'?s.sunElDeg:s.earthElDeg;
   this.text(c,`${kind==='sun'?'SUN':'EARTH'}  ${el.toFixed(1)}°`,lx,ay,w<550?10:12,tone,'center','600');
   this.text(c,kind==='sun'?(s.eclipsed?'Eclipse':visible?'Sunlight reaches site':'Sun hidden at site'):(visible?'Centre visible at site':'Centre hidden at site'),lx,ay+17,10,visible?'#b9dfcc':'#ddb3a4','center');
   if(clipped)this.text(c,'direction beyond frame',x,y-radius-10,8,'#9eb3c7','center');
   this.projectedBodies[kind]={x,y,radius,position:p,behind,az:kind==='sun'?s.sunAzDeg:s.earthAzDeg,el};this.hitPoints.push({x,y,r:radius+8,kind});
   if(kind==='earth'&&s.telemetryAvailable&&s.actualTxMbps>1e-10&&s.linkAvailable){c.font='600 11px ui-monospace,monospace';c.textAlign='center';c.fillStyle='#9aecd1';for(let j=0;j<6;j++){const u=(this.phase*.17+j/6)%1;c.fillText(j%2?'1':'0',begin.x+(x-begin.x)*u,begin.y+(y-begin.y)*u-7);}c.textAlign='left';}
  }
  const header=c.createLinearGradient(0,0,0,98);header.addColorStop(0,'#07101df7');header.addColorStop(1,'#07101d00');c.fillStyle=header;c.fillRect(0,0,w,98);
  this.text(c,'THE SOUTH POLE',22,28,11,'#7e9bb6','left','600');this.text(c,'A curved Moon. One changing sky.',22,54,w<550?17:22,'#eff4f9','left','500');
  this.text(c,'Sunlight and Earth access are evaluated at the selected site.',22,75,w<550?9:11,'#9caec2');
  const status=s.bothVisible?'Sun + Earth visible':s.sunVisible?'Sunlight only':s.earthVisible?'Earth only':'Both hidden';this.pill(c,status,20,h-38,s.bothVisible?'#b2ead6':'#cfdae4',s.bothVisible?'#153a32':'#142337',10);
  this.text(c,w<550?'Sizes / distances compressed':'Directions calculated · sizes / distances compressed',w-18,h-20,w<550?8:10,'#869bb0','right');
 }
 drawMeasuredForeground(c,rs,s,map,skyline){
  const m=rs.site.mesh;if(!m)return;const key=rs.site.id+'|'+rs.settings.heightM;
  if(this.localMeshKey!==key){this.localMeshKey=key;const z=m.elevations_m.flat(),rows=[],cols=[],pts=[];for(let i=0;i<m.height;i+=3)rows.push(i);if(rows.at(-1)!==m.height-1)rows.push(m.height-1);for(let i=0;i<m.width;i+=3)cols.push(i);if(cols.at(-1)!==m.width-1)cols.push(m.width-1);
   const R=1737400+rs.site.ground_elevation_m+rs.settings.heightM;
   for(const row of rows)for(const col of cols){const e=m.origin_x_m+col*m.spacing_m,n=m.origin_y_m+row*m.spacing_m*(m.row_order==='north_to_south'?-1:1),alt=z[row*m.width+col];if(!Number.isFinite(alt)){pts.push(null);continue;}const u=Math.sqrt(Math.max(0,(1737400+alt)**2-e*e-n*n))-R,dist=Math.hypot(e,n);pts.push({p:[e,n,u],az:wrapDeg(Math.atan2(e,n)/DEG),el:Math.atan2(u,dist)/DEG,dist});}
   const tris=[],nx=cols.length;for(let row=0;row<rows.length-1;row++)for(let col=0;col<nx-1;col++){const a=row*nx+col;for(const ids of [[a,a+1,a+nx],[a+1,a+nx+1,a+nx]]){const v=ids.map(i=>pts[i]);if(v.some(x=>!x||x.dist<25))continue;let n=unit(cross(sub(v[1].p,v[0].p),sub(v[2].p,v[0].p)));if(n[2]<0)n=mul(n,-1);tris.push({v,n,d:v.reduce((z,x)=>z+x.dist,0)/3});}}this.localTriangles=tris.sort((a,b)=>b.d-a.d);
  }
  const light=[Math.sin(s.sunAzDeg*DEG)*Math.cos(s.sunElDeg*DEG),Math.cos(s.sunAzDeg*DEG)*Math.cos(s.sunElDeg*DEG),Math.sin(s.sunElDeg*DEG)];c.save();c.beginPath();c.moveTo(0,this.height);for(const p of skyline)c.lineTo(p.x,p.y);c.lineTo(this.width,this.height);c.closePath();c.clip();
  for(const t of this.localTriangles){const p=t.v.map(q=>map(q.az,q.el));if(p.every(q=>!q.inView)||p.some(q=>!Number.isFinite(q.x)||!Number.isFinite(q.y))||Math.max(...p.map(q=>q.x))-Math.min(...p.map(q=>q.x))>this.width*.5||Math.min(...p.map(q=>q.y))>this.height)continue;const lum=clamp(38+Math.max(0,dot(t.n,light))*120,30,150);c.fillStyle=`rgb(${lum|0},${lum*1.05|0},${lum*1.12|0})`;c.strokeStyle=c.fillStyle;c.lineWidth=.6;c.beginPath();p.forEach((q,i)=>i?c.lineTo(q.x,q.y):c.moveTo(q.x,q.y));c.closePath();c.fill();c.stroke();}c.restore();
 }
 horizon(result,kind,az){const h=kind==='earth'?result.antennaHorizon:result.horizon;return interpolateHorizon(h.azimuthDeg,h.elevationDeg,az);}
 drawSky(c,rec,s){
  const w=this.width,h=this.height,rs=rec.result;
  if(this.skyPreset==='sun')this.heading=s.sunAzDeg;if(this.skyPreset==='earth')this.heading=s.earthAzDeg;
  const g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,'#050a12');g.addColorStop(.63,'#0d1927');g.addColorStop(1,'#1c2833');c.fillStyle=g;c.fillRect(0,0,w,h);this.stars(c);
  const vScale=4,map=(az,el)=>angleToPixel(az,el,this.heading,this.fov,w,h,vScale),baseY=h*.58;
  // Measured skyline in angular space. Fourfold vertical display magnification
  // is declared in the viewport; it has no effect on the numerical model.
  const skyline=[];for(let x=0;x<=w+2;x+=2){const az=wrapDeg(this.heading+(x/w-.5)*this.fov),el=this.horizon(rs,'sun',az);skyline.push({x,y:map(az,el).y,az,el});}
  c.strokeStyle='#9bb2c230';c.setLineDash([4,6]);c.beginPath();c.moveTo(0,baseY);c.lineTo(w,baseY);c.stroke();c.setLineDash([]);
  if(this.showPaths){for(const kind of ['sun','earth']){c.strokeStyle=kind==='sun'?'#f2c26970':'#92c8ef90';c.lineWidth=1.25;c.setLineDash([3,4]);c.beginPath();let prev=null;for(const p of this.paths){const q=map(p[kind+'Az'],p[kind+'El']);if(!q.inView||q.y<90||q.y>h-40){prev=null;continue;}if(!prev||Math.abs(q.x-prev.x)>w*.5)c.moveTo(q.x,q.y);else c.lineTo(q.x,q.y);prev=q;}c.stroke();c.setLineDash([]);}}
  const ground=c.createLinearGradient(0,baseY-50,0,h);ground.addColorStop(0,s.sunVisible?'#727778':'#333e49');ground.addColorStop(.2,s.sunVisible?'#4b525a':'#242f3a');ground.addColorStop(1,'#111c28');c.fillStyle=ground;c.beginPath();c.moveTo(0,h);for(const p of skyline)c.lineTo(p.x,p.y);c.lineTo(w,h);c.closePath();c.fill();c.strokeStyle=s.sunVisible?'#c2c5c1':'#718291';c.lineWidth=1.2;c.beginPath();skyline.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.stroke();
  this.drawMeasuredForeground(c,rs,s,map,skyline);
  if(Math.abs(rs.settings.heightM-rs.settings.antennaHeightM)>1e-6){c.strokeStyle='#89bbdf88';c.lineWidth=.8;c.setLineDash([4,5]);c.beginPath();for(let x=0;x<=w;x+=2){const az=wrapDeg(this.heading+(x/w-.5)*this.fov),q=map(az,this.horizon(rs,'earth',az));x?c.lineTo(x,q.y):c.moveTo(x,q.y);}c.stroke();c.setLineDash([]);}
  // Reticle and compass use true azimuth, not equal decorative orbits.
  for(let az=0;az<360;az+=30){const q=map(az,0);if(!q.inView)continue;c.strokeStyle='#a6bdce4a';c.beginPath();c.moveTo(q.x,h-69);c.lineTo(q.x,h-62);c.stroke();const cardinal={0:'N',90:'E',180:'S',270:'W'};this.text(c,cardinal[az]||`${az}°`,q.x,h-47,11,'#a8bdcf','center',cardinal[az]?'600':'400');}
  this.projectedBodies={};
  for(const kind of ['sun','earth']){const az=kind==='sun'?s.sunAzDeg:s.earthAzDeg,el=kind==='sun'?s.sunElDeg:s.earthElDeg,q=map(az,el),visible=kind==='sun'?s.sunVisible:s.earthVisible,tone=kind==='sun'?'#edc377':'#8dcdf3',angular=kind==='sun'?s.sunAngularRadiusDeg:s.earthAngularRadiusDeg;
   if(!q.inView){const x=q.x<0?20:w-20;this.text(c,(q.x<0?'‹ ':'')+(kind==='sun'?'Sun':'Earth')+(q.x>=0?' ›':''),x,130,12,tone,q.x<0?'left':'right');continue;}
   const radius=kind==='sun'?(w<550?19:26):(w<550?25:35);this.projectedBodies[kind]={x:q.x,y:q.y,az,el,radius};
   c.save();c.globalAlpha=.16;drawCelestial(c,kind,q.x,q.y,radius,{glow:false});c.restore();
   // Clip magnified body to the actual terrain cut across its physical disc.
   c.save();c.beginPath();c.moveTo(q.x-radius,q.y-radius-1);c.lineTo(q.x+radius,q.y-radius-1);
   for(let xx=radius;xx>=-radius;xx-=1){const dx=xx/radius*angular,phi=az+dx/Math.max(.01,Math.cos(el*DEG)),cut=this.horizon(rs,kind,phi),yy=q.y-(cut-el)/angular*radius;c.lineTo(q.x+xx,clamp(yy,q.y-radius-1,q.y+radius+1));}c.closePath();c.clip();if(kind==='sun'&&s.eclipsed){const ex=q.x+angleDelta(s.earthAzDeg,s.sunAzDeg)*Math.cos(s.sunElDeg*DEG)/angular*radius,ey=q.y-(s.earthElDeg-s.sunElDeg)/angular*radius,er=s.earthAngularRadiusDeg/angular*radius;c.beginPath();c.rect(-10000,-10000,20000,20000);c.arc(ex,ey,er,0,Math.PI*2);c.clip('evenodd');}if(!(kind==='sun'&&s.eclipsed&&s.sunFraction<1e-8))drawCelestial(c,kind,q.x,q.y,radius,{glow:false});c.restore();
   const labelY=clamp(q.y-radius-32,120,h-154),labelX=clamp(q.x,70,w-70);if(labelX!==q.x||labelY!==q.y-radius-32){c.strokeStyle=tone;c.lineWidth=.6;c.beginPath();c.moveTo(q.x,q.y-radius-4);c.lineTo(labelX,labelY+14);c.stroke();}
   this.text(c,`${kind==='sun'?'SUN':'EARTH'} · ${el.toFixed(2)}°`,labelX,labelY,11,tone,'center','600');this.text(c,kind==='sun'?(s.eclipsed?'Solar eclipse':s.sunFraction<1e-8?'Hidden by terrain':s.sunFraction<.999?`${(100*s.sunFraction).toFixed(0)}% of disc visible`:'Sun above skyline'):(visible?'Centre above skyline':'Centre below skyline'),labelX,labelY+17,10,visible?'#c3e5d7':'#d3b9ac','center');
   this.hitPoints.push({x:q.x,y:q.y,r:radius+8,kind});
  }
  const st=map(s.stationAzDeg,s.stationElDeg);if(st.inView&&s.telemetryAvailable&&s.actualTxMbps>1e-10&&s.linkAvailable){const start={x:w*.5,y:h-98},end={x:st.x,y:st.y};c.strokeStyle='#84d8bc';c.lineWidth=1;c.setLineDash([3,5]);c.beginPath();c.moveTo(start.x,start.y);c.lineTo(end.x,end.y);c.stroke();c.setLineDash([]);c.font='600 11px ui-monospace';c.textAlign='center';c.fillStyle='#bcf5de';for(let j=0;j<5;j++){const u=(this.phase*.21+j/5)%1;c.fillText(j%2?'1':'0',start.x+(end.x-start.x)*u+9,start.y+(end.y-start.y)*u);}c.textAlign='left';}
  const header=c.createLinearGradient(0,0,0,100);header.addColorStop(0,'#07101dfa');header.addColorStop(1,'#07101d00');c.fillStyle=header;c.fillRect(0,0,w,100);
  this.text(c,'AT THE LANDER',22,27,11,'#86a3bd','left','600');this.text(c,`${short(rs.site)} · ${Math.round(this.fov)}° sky`,22,53,w<550?18:22,'#eff4f9','left','500');this.text(c,`Collector ${rs.settings.heightM} m · antenna ${rs.settings.antennaHeightM} m · measured skyline`,22,75,w<550?9:11,'#a9bccd');
  const badge=s.bothVisible?'Sun + Earth visible':s.sunVisible?'Sunlight only':s.earthVisible?'Earth only':'Both hidden';this.pill(c,badge,18,h-33,s.bothVisible?'#b8e9d5':'#d0dae4',s.bothVisible?'#17392f':'#162535',10);this.text(c,w<550?'Elevation ×4 · discs enlarged':'Elevation ×4 · discs enlarged · azimuths calculated',w-15,h-17,w<550?8:10,'#9caebc','right');
 }
}
