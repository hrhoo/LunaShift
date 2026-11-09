import {lunarDistanceKm} from './decision-model.js';
import * as THREE from './assets/vendor/three.module.js';
import {drawCelestial, bodyStatus, onSkyImagesReady} from './sky-visuals.js';
import {cameraBasis, chooseCamera, fitTerrain, boundedRay} from './camera-geometry.js';
import {OrbitControls} from './assets/vendor/OrbitControls.js';
import {terrainScene,tangentFrame,directionInFrame,panelNormal,unit,dot,cross,add,mul,sub,dataFlowVisible,A_COLOR,B_COLOR} from './visual-geometry.js';
const v3=p=>new THREE.Vector3(p[0]/1000,p[2]/1000,-p[1]/1000);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const hex=(n)=>parseInt(n.slice(1),16);
const shorten=n=>n.replace('Connecting Ridge · ','');
function lander(color,scale){
 const g=new THREE.Group(),silver=new THREE.MeshStandardMaterial({color:0xd6dee4,roughness:.65,metalness:.25}),gold=new THREE.MeshStandardMaterial({color:0xb59a60,metalness:.45,roughness:.6}),black=new THREE.MeshStandardMaterial({color:0x253448,roughness:.8}),accent=new THREE.MeshBasicMaterial({color:hex(color)});
 const body=new THREE.Mesh(new THREE.CylinderGeometry(.55,.85,.85,8),gold);body.position.y=1.25;g.add(body);
 const top=new THREE.Mesh(new THREE.CylinderGeometry(.55,.55,.55,8),silver);top.position.y=1.93;g.add(top);
 const deck=new THREE.Mesh(new THREE.BoxGeometry(1.25,.12,1.25),silver);deck.position.y=1.75;g.add(deck);
 const band=new THREE.Mesh(new THREE.CylinderGeometry(.858,.858,.15,8),accent);band.position.y=1.12;g.add(band);
 function rod(a,b,r=.035){const d=b.clone().sub(a),mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,d.length(),6),silver);mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());g.add(mesh);}
 for(let i=0;i<4;i++){const angle=Math.PI/4+i*Math.PI/2,a=new THREE.Vector3(Math.cos(angle)*.65,1.35,Math.sin(angle)*.65),b=new THREE.Vector3(Math.cos(angle)*1.55,.1,Math.sin(angle)*1.55);rod(a,b,.05);const foot=new THREE.Mesh(new THREE.CylinderGeometry(.24,.29,.08,8),silver);foot.position.copy(b);g.add(foot);}
 rod(new THREE.Vector3(0,2.15,0),new THREE.Vector3(0,2.95,0));
 const dish=new THREE.Mesh(new THREE.SphereGeometry(.28,12,8,0,Math.PI*2,0,.4*Math.PI),silver);dish.rotation.x=Math.PI*.4;dish.position.set(0,2.98,0);g.add(dish);
 const panels=[];
 for(const sign of [-1,1]){
  rod(new THREE.Vector3(sign*.5,1.9,0),new THREE.Vector3(sign*1.25,2.05,0),.05);
  const pivot=new THREE.Group();pivot.position.set(sign*1.67,2.05,0);
  const face=new THREE.Mesh(new THREE.BoxGeometry(1.65,1.05,.045),black);pivot.add(face);
  const grid=new THREE.Group(),mat=new THREE.LineBasicMaterial({color:0x5d8fb6,transparent:true,opacity:.8});
  for(let i=0;i<6;i++){const x=-.82+i*1.64/5,ge=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x,-.52,.026),new THREE.Vector3(x,.52,.026)]);grid.add(new THREE.Line(ge,mat));}
  for(let i=0;i<4;i++){const y=-.52+i*1.04/3,ge=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-.82,y,.026),new THREE.Vector3(.82,y,.026)]);grid.add(new THREE.Line(ge,mat));}
  pivot.add(grid);g.add(pivot);panels.push({pivot,face});
 }
 g.scale.setScalar(scale);return{group:g,panels,accent};
}
export class ComparisonScene{
 constructor(canvas,overlay,bundle,onPick,options={}){this.canvas=canvas;this.overlay=overlay;this.bundle=bundle;this.onPick=onPick;this.options=options;this.showSky=options.showSky!==false;this.showDirections=options.showDirections!==false;this.defaultCamera=options.defaultCamera||'wide';this.mode='3d';this.role='current';this.samples={};this.phase=0;this.zoom=1;this.yaw=2.2;this.pitch=.30;this.cameraPreset=this.defaultCamera;this.pan=[0,0];this.ctxO=overlay.getContext('2d');this.destroyed=false;this.records=[];this.unlistenSky=onSkyImagesReady(()=>this.render());
  let gl=null;try{gl=canvas.getContext('webgl2',{antialias:true,alpha:false,powerPreference:'low-power'});}catch{}
  if(gl){try{this.initGL(gl);this.rendererName='WebGL 3D';}catch(e){const copy=canvas.cloneNode();canvas.replaceWith(copy);this.canvas=copy;this.initCanvas();this.rendererName='Canvas 3D';}}
  else{this.initCanvas();this.rendererName='Canvas 3D';}
  this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(this.canvas.parentElement);this.resize();
 }
 initGL(gl){this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#091321');this.renderer=new THREE.WebGLRenderer({canvas:this.canvas,context:gl,antialias:true,powerPreference:'low-power'});this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.7));this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.25;this.camera=new THREE.OrthographicCamera(-3,3,3,-3,.001,500);this.camera.up.set(0,1,0);this.controls=new OrbitControls(this.camera,this.canvas);this.controls.enableDamping=false;this.controls.maxPolarAngle=Math.PI*.49;this.controls.addEventListener('change',()=>this.render());this.controls.addEventListener('start',()=>{this.manualCamera=true;});this.scene.add(new THREE.AmbientLight(0xcbd7e8,1.1));const sun=new THREE.DirectionalLight(0xfff0d5,2.2);sun.position.set(-4,8,4);this.scene.add(sun);this.root=new THREE.Group();this.scene.add(this.root);this.hit=new THREE.Raycaster();this.canvas.addEventListener('pointerdown',e=>this.pointer=[e.clientX,e.clientY]);this.canvas.addEventListener('pointerup',e=>{if(this.pointer&&Math.hypot(e.clientX-this.pointer[0],e.clientY-this.pointer[1])<5)this.pick(e);});}
 initCanvas(){this.ctx=this.canvas.getContext('2d',{alpha:false});this.canvas.style.touchAction='none';this.canvas.style.cursor='grab';this.canvas.tabIndex=0;this.canvas.addEventListener('pointerdown',e=>{this.manualCamera=true;this.drag={x:e.clientX,y:e.clientY,ox:e.clientX,oy:e.clientY};this.canvas.setPointerCapture(e.pointerId);});this.canvas.addEventListener('pointermove',e=>{if(!this.drag)return;const dx=e.clientX-this.drag.x,dy=e.clientY-this.drag.y;if(this.mode==='3d'){this.yaw-=dx*.007;this.pitch=clamp(this.pitch+dy*.005,.12,1.4);}else{this.pan[0]+=dx;this.pan[1]+=dy;}this.drag.x=e.clientX;this.drag.y=e.clientY;this.render();});this.canvas.addEventListener('pointerup',e=>{if(this.drag&&Math.hypot(e.clientX-this.drag.ox,e.clientY-this.drag.oy)<5)this.pick(e);this.drag=null;});this.canvas.addEventListener('wheel',e=>{e.preventDefault();this.zoom=clamp(this.zoom*Math.exp(-e.deltaY*.001),.6,4);this.render();},{passive:false});this.canvas.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','='].includes(e.key))return;e.preventDefault();if(e.key==='ArrowLeft')this.yaw-=.12;if(e.key==='ArrowRight')this.yaw+=.12;if(e.key==='ArrowUp')this.pitch=clamp(this.pitch+.1,.1,1.4);if(e.key==='ArrowDown')this.pitch=clamp(this.pitch-.1,.1,1.4);if(['+','='].includes(e.key))this.zoom=Math.min(6,this.zoom*1.12);if(e.key==='-')this.zoom=Math.max(.45,this.zoom/1.12);this.render();});}
 setScenarios(records,role='current'){this.records=records.filter(Boolean);this.role=role;const key=this.records.map(r=>r.role+':'+r.result.site.id).join('|');const rebuild=key!==this.geometryKey;this.geometryKey=key;this.geo=terrainScene(this.bundle,this.records);if(rebuild){if(this.renderer)this.buildGL();this.reset();}else{this.updateGLPanels();this.render();}}
 setMode(mode){this.mode=mode;if(this.controls){this.controls.enableRotate=mode==='3d';}this.reset();}
 setSamples(samples,role,phase=0){this.samples=samples;this.role=role;this.phase=phase;this.updateGLPanels();this.render();}
 buildGL(){this.root.traverse(o=>{o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose();});this.root.clear();this.landers=[];const g=this.geo;const positions=[],colors=[],index=[];
  for(const p of g.vertices){const v=p?v3(p):new THREE.Vector3();positions.push(v.x,v.y,v.z);const t=p?clamp((p[2]-g.min[2])/(g.max[2]-g.min[2]||1),0,1):0;const c=new THREE.Color().setRGB(.22+t*.27,.25+t*.27,.29+t*.27);colors.push(c.r,c.g,c.b);}
  for(const ids of g.triangles){const a=g.vertices[ids[0]],b=g.vertices[ids[1]],c=g.vertices[ids[2]],n=cross(sub(b,a),sub(c,a));if(n[2]>=0)index.push(...ids);else index.push(ids[0],ids[2],ids[1]);}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(index);geometry.computeVertexNormals();const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,side:THREE.DoubleSide}));this.root.add(mesh);
  const wire=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0x8298b1,wireframe:true,transparent:true,opacity:.035}));this.root.add(wire);
  const pts=g.sameSite?[g.points[0]]:g.points;for(const pt of pts){const sc=g.span*.025/1000,craft=lander(pt.color,sc);craft.group.position.copy(v3(pt.p));craft.group.userData.role=pt.role;this.root.add(craft.group);this.landers.push({...craft,role:pt.role,scale:sc});}
  for(const pt of g.points){const sc=g.span*.036/1000*(g.sameSite&&pt.role==='alternative'?1.4:1),ring=new THREE.Mesh(new THREE.RingGeometry(sc*.87,sc,64),new THREE.MeshBasicMaterial({color:hex(pt.color),side:THREE.DoubleSide,depthTest:false,transparent:true,opacity:.78}));ring.rotation.x=-Math.PI/2;ring.position.copy(v3(pt.p));ring.position.y+=.006;ring.userData.role=pt.role;this.root.add(ring);}
  this.updateGLPanels();
 }
 updateGLPanels(){if(!this.renderer||!this.geo)return;for(const lander of this.landers||[]){const role=this.geo.sameSite?this.role:lander.role;const record=this.records.find(r=>r.role===role)||this.records[0],p=this.samples[role];if(!p)continue;lander.accent.color.setHex(hex(role==='current'?A_COLOR:B_COLOR));const n=panelNormal(record.result.settings,p),frame=tangentFrame(record.result.site),world=add(mul(frame.east,n[0]),add(mul(frame.north,n[1]),mul(frame.up,n[2]))),d=[dot(world,this.geo.frame.east),dot(world,this.geo.frame.north),dot(world,this.geo.frame.up)],normal=v3(mul(d,1000)).normalize();for(const item of lander.panels){item.pivot.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);item.face.material.color.set(p.sunFraction>.001?0x184d83:0x263746);}}}
 setCameraPreset(preset='wide') {
  if(!['close','wide','low','sun','earth'].includes(preset))preset=this.defaultCamera;
  this.cameraPreset=preset;this.manualCamera=false;this.zoom=preset==='close'?1.92:preset==='low'?1.35:1;this.pan=[0,0];
  if(this.geo){const a=chooseCamera(this.geo,preset,this.role,this.samples[this.role]);this.yaw=a.yaw;this.pitch=a.pitch;this.fit=null;this.applyCamera();}
  document.querySelectorAll('[data-camera]').forEach(b=>{b.classList.toggle('active',b.dataset.camera===preset);b.setAttribute('aria-pressed',String(b.dataset.camera===preset));});
  this.render();
 }
 reset(){this.focusSequence=(this.focusSequence||0)+1;this.setCameraPreset(this.defaultCamera);}
 focus(role){this.role=role;if(['sun','earth'].includes(this.cameraPreset))this.setCameraPreset(this.cameraPreset);else this.render();}
 applyCamera(resetOrientation=true){
  if(!this.geo||!this.width)return;
  const basis=this.mode==='map'?{right:[1,0,0],up:[0,1,0],front:[0,0,1]}:cameraBasis(this.yaw,this.pitch);
  const topPad=this.mode==='map'?42:48;let f=fitTerrain(this.geo,basis,this.width,this.height,this.mode==='map',topPad);
  const selected=this.geo.points.find(p=>p.role===this.role)||this.geo.points[0];
  if(this.mode!=='map'&&selected&&this.cameraPreset!=='wide')f={...f,target:add(selected.p,[0,0,this.geo.span*.025]),centerY:this.height*.56};
  this.fit=f;this.focusPoint=f.target;
  if(this.renderer){
   const metersPerPixel=1/f.scale,worldW=this.width*metersPerPixel/1000;
   this.camera.left=-worldW/2;this.camera.right=worldW/2;
   this.camera.top=f.centerY*metersPerPixel/1000;this.camera.bottom=-(this.height-f.centerY)*metersPerPixel/1000;
   this.camera.zoom=this.zoom;this.camera.updateProjectionMatrix();
   if(resetOrientation||!this.manualCamera){const target=v3(f.target),distance=this.cameraPreset==='close'?this.geo.span*.72:this.cameraPreset==='low'?this.geo.span*.95:this.geo.span*2,d=v3(mul(basis.front,distance));this.controls.target.copy(target);this.camera.position.copy(target).add(d);this.camera.up.copy(this.mode==='map'?new THREE.Vector3(0,0,-1):new THREE.Vector3(0,1,0));this.controls.update();}
   this.controls.minZoom=.65;this.controls.maxZoom=5;
  }
 }
 resize(){const r=this.canvas.parentElement.getBoundingClientRect();if(r.width<5||r.height<5)return;this.width=r.width;this.height=r.height;const d=Math.min(devicePixelRatio||1,1.7);this.dpr=d;for(const c of [this.overlay,...(!this.renderer?[this.canvas]:[])]){c.width=Math.round(r.width*d);c.height=Math.round(r.height*d);}this.ctxO.setTransform(d,0,0,d,0,0);if(this.renderer){this.renderer.setSize(r.width,r.height,false);if(this.geo)this.applyCamera(false);}else{this.ctx.setTransform(d,0,0,d,0,0);if(this.geo)this.applyCamera(false);}this.render();}
 basis(){if(this.renderer){this.camera.updateMatrixWorld();const m=this.camera.matrixWorld.elements;return{right:[m[0],-m[2],m[1]],up:[m[4],-m[6],m[5]],front:[m[8],-m[10],m[9]]};}return this.mode==='map'?{right:[1,0,0],up:[0,1,0],front:[0,0,1]}:cameraBasis(this.yaw,this.pitch);}
 project(p){
  if(this.renderer){const v=v3(p).project(this.camera);return{x:(v.x+1)*this.width/2,y:(1-v.y)*this.height/2,depth:-v.z};}
  if(!this.fit)this.applyCamera();
  const b=this.basis(),d=sub(p,this.focusPoint||this.geo.center),s=this.fit.scale*this.zoom;
  return{x:this.fit.centerX+dot(d,b.right)*s+this.pan[0],y:this.fit.centerY-dot(d,b.up)*s+this.pan[1],depth:dot(d,b.front),scale:s};
 }
 render(){if(this.destroyed||!this.geo||!this.width||!this.canvas.getClientRects().length)return;if(this.renderer)this.renderer.render(this.scene,this.camera);else this.drawCanvas();this.drawOverlay();}
 drawCanvas(){const ctx=this.ctx,w=this.width,h=this.height;ctx.setTransform(this.dpr,0,0,this.dpr,0,0);const cacheKey=[this.geometryKey,this.mode,this.yaw,this.pitch,this.zoom,...this.pan,...(this.focusPoint||this.geo.center),w,h,this.dpr].join(':');if(this.terrainCacheKey===cacheKey&&this.terrainCache){ctx.drawImage(this.terrainCache,0,0,w,h);const pts=this.geo.sameSite?[this.geo.points.find(x=>x.role===this.role)||this.geo.points[0]]:this.geo.points;for(const pt of pts)this.drawCraft(ctx,pt);return;}const background=ctx.createLinearGradient(0,0,0,h);background.addColorStop(0,'#080f1d');background.addColorStop(.55,'#101d2b');background.addColorStop(1,'#0a1420');ctx.fillStyle=background;ctx.fillRect(0,0,w,h);const proj=this.geo.vertices.map(p=>p?this.project(p):null),light=unit([-.38,.3,.8]);const tris=this.geo.triangles.map(ids=>({ids,depth:ids.reduce((s,i)=>s+proj[i].depth,0)/3})).sort((a,b)=>a.depth-b.depth);
  for(const {ids}of tris){const [a,b,c]=ids.map(i=>proj[i]);if(Math.max(a.x,b.x,c.x)<0||Math.min(a.x,b.x,c.x)>w||Math.max(a.y,b.y,c.y)<0||Math.min(a.y,b.y,c.y)>h)continue;const ps=ids.map(i=>this.geo.vertices[i]);let n=unit(cross(sub(ps[1],ps[0]),sub(ps[2],ps[0])));if(n[2]<0)n=mul(n,-1);const z=ps.reduce((s,p)=>s+p[2],0)/3,t=clamp((z-this.geo.min[2])/(this.geo.max[2]-this.geo.min[2]||1),0,1),shade=.27+.73*Math.max(0,dot(n,light)),v=(122+t*92)*shade;ctx.fillStyle=`rgb(${v|0},${v*1.02|0},${v*1.05|0})`;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.lineTo(c.x,c.y);ctx.closePath();ctx.fill();ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=.65;ctx.stroke();}
  // Contour segments from the real sampled triangles, in metres above reference.
  if(this.mode==='map'){const step=100;ctx.strokeStyle='#b3c3d02e';ctx.lineWidth=.6;ctx.beginPath();for(const ids of this.geo.triangles){const ps=ids.map(i=>this.geo.vertices[i]),lo=Math.min(...ps.map(p=>p[2])),hi=Math.max(...ps.map(p=>p[2]));for(let z=Math.ceil(lo/step)*step;z<hi;z+=step){const hits=[];for(let i=0;i<3;i++){const a=ps[i],b=ps[(i+1)%3];if((a[2]<z)===(b[2]<z))continue;hits.push(this.project(add(a,mul(sub(b,a),(z-a[2])/(b[2]-a[2])))));}if(hits.length>=2){ctx.moveTo(hits[0].x,hits[0].y);ctx.lineTo(hits[1].x,hits[1].y);}}}ctx.stroke();}
  if(!this.terrainCache)this.terrainCache=document.createElement('canvas');this.terrainCache.width=this.canvas.width;this.terrainCache.height=this.canvas.height;this.terrainCache.getContext('2d').drawImage(this.canvas,0,0);this.terrainCacheKey=cacheKey;
  const pts=this.geo.sameSite?[this.geo.points.find(x=>x.role===this.role)||this.geo.points[0]]:this.geo.points;for(const pt of pts)this.drawCraft(ctx,pt);
 }
 drawCraft(ctx,pt){const sample=this.samples[pt.role],scale=this.geo.span*.025,at=pt.p;const P=p=>this.project(add(at,mul(p,scale)));const polys=[];const poly=(points,color)=>polys.push({p:points.map(P),color,depth:points.map(P).reduce((s,p)=>s+p.depth,0)/points.length});
  const box=(x,y,z,sx,sy,sz,color)=>{const v=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(a=>[x+a[0]*sx/2,y+a[1]*sy/2,z+a[2]*sz/2]);for(const f of [[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7],[4,5,6,7]])poly(f.map(i=>v[i]),color);};
  box(0,0,1.25,1.35,1.35,.85,'#a89063');box(0,0,1.95,1,1,.55,'#d2dbe4');box(0,0,1.74,1.5,1.5,.12,'#c7d1d9');box(0,0,1.13,1.37,1.37,.15,pt.color);
  const raw=panelNormal(pt.result.settings,sample),sf=tangentFrame(pt.site),worldN=add(mul(sf.east,raw[0]),add(mul(sf.north,raw[1]),mul(sf.up,raw[2]))),n=[dot(worldN,this.geo.frame.east),dot(worldN,this.geo.frame.north),dot(worldN,this.geo.frame.up)],side=unit(cross([0,0,1],n)),a=Math.hypot(side[0],side[1])<.1?[1,0,0]:side,b=unit(cross(n,a));
  for(const sign of [-1,1]){const center=[sign*1.65,0,2.05],corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>add(center,add(mul(a,x*.85),mul(b,y*.53))));poly(corners,sample?.sunFraction>.001?'#1b5078':'#253849');}
  polys.sort((a,b)=>a.depth-b.depth);for(const {p,color}of polys){ctx.fillStyle=color;ctx.strokeStyle='#96abbc75';ctx.lineWidth=.5;ctx.beginPath();p.forEach((v,i)=>i?ctx.lineTo(v.x,v.y):ctx.moveTo(v.x,v.y));ctx.closePath();ctx.fill();ctx.stroke();}
  ctx.strokeStyle='#d4dfe8';ctx.lineWidth=1.5;ctx.beginPath();for(let i=0;i<4;i++){const t=Math.PI/4+i*Math.PI/2,a=P([Math.cos(t)*.65,Math.sin(t)*.65,1.35]),b=P([Math.cos(t)*1.55,Math.sin(t)*1.55,.05]);ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.moveTo(b.x-3,b.y);ctx.lineTo(b.x+3,b.y);}const mast=P([0,0,2.2]),dish=P([0,0,2.95]);ctx.moveTo(mast.x,mast.y);ctx.lineTo(dish.x,dish.y);ctx.stroke();ctx.fillStyle='#d9e2eb';ctx.beginPath();ctx.ellipse(dish.x,dish.y,3,2.1,-.6,0,Math.PI*2);ctx.fill();
 }
 label(ctx,text,x,y,color='#d6e1ed',align='left'){ctx.font='500 10px system-ui,sans-serif';const width=ctx.measureText(text).width+14;const xx=align==='center'?x-width/2:x;ctx.fillStyle='#0c192be6';ctx.beginPath();ctx.roundRect(xx,y-14,width,21,4);ctx.fill();ctx.fillStyle=color;ctx.textAlign='left';ctx.fillText(text,xx+7,y);}
 drawOverlay(){
  const c=this.ctxO,w=this.width,h=this.height;c.setTransform(this.dpr,0,0,this.dpr,0,0);c.clearRect(0,0,w,h);
  const g=this.geo;if(!g)return;this.hitPoints=[];this.skyHitPoints=[];
  if(!g.hasTerrain){this.label(c,'No local display mesh supplied',w/2,h/2,'#b9c9d9','center');return;}
  const active=g.points.find(x=>x.role===this.role)||g.points[0],s=this.samples[this.role];
  // Geographic separation is an annotation, not a traverse route or line of sight.
  if(!g.sameSite&&g.points.length>1){
   const a=this.project(g.points[0].p),b=this.project(g.points[1].p),distance=lunarDistanceKm(g.points[0].site,g.points[1].site);
   c.save();c.strokeStyle='#dce5ef99';c.lineWidth=1.1;c.setLineDash([5,5]);c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();c.restore();
   this.label(c,`${distance.toFixed(2)} km`,clamp((a.x+b.x)/2,58,w-58),clamp((a.y+b.y)/2-12,52,h-44),'#dfe8f1','center');
  }
  // Depth-independent rings and readable A/B labels identify enlarged craft.
  for(const pt of g.points){
   const p=this.project(pt.p),rad=g.span*.036;this.hitPoints.push({x:p.x,y:p.y,role:pt.role});
   c.strokeStyle=pt.color;c.lineWidth=pt.role===this.role?1.9:1.2;c.beginPath();
   for(let k=0;k<=64;k++){const t=k*Math.PI*2/64,m=g.sameSite&&pt.role==='alternative'?1.35:1,q=this.project(add(pt.p,[Math.cos(t)*rad*m,Math.sin(t)*rad*m,4]));if(k===0)c.moveTo(q.x,q.y);else c.lineTo(q.x,q.y);}c.stroke();
   if(!g.sameSite||pt.role===this.role){
    const q=this.project(add(pt.p,[0,0,g.span*.09]));
    let labelY=q.y-6;
    if(this.mode==='map'){
     const other=g.points.find(x=>x!==pt),otherY=other?this.project(other.p).y:Infinity;
     labelY=p.y+(g.sameSite||p.y<otherY||(p.y===otherY&&pt.role==='current')?-30:35);
    }
    this.label(c,g.sameSite?'A / B · Same location':`${pt.role==='current'?'A':'B'} · ${shorten(pt.site.name)}`,clamp(q.x,70,w-70),clamp(labelY,this.showSky?182:45,h-49),pt.color,'center');
   }
   const sp=this.samples[pt.role];
   if(this.mode!=='map'&&sp?.telemetryAvailable&&p.x>60&&p.x<w-60){
    const xx=clamp(p.x-37,12,w-95),yy=clamp(p.y+23,55,h-49),soc=clamp(sp.socPct,0,100);
    c.save();c.fillStyle='#091724df';c.beginPath();c.roundRect(xx-6,yy-10,90,30,4);c.fill();
    c.strokeStyle='#8197ab';c.lineWidth=.8;c.strokeRect(xx,yy-4,23,10);c.fillStyle=soc<pt.result.settings.reservePct?'#e39b8b':pt.color;c.fillRect(xx+2,yy-2,19*soc/100,6);
    c.font='500 10px system-ui';c.textAlign='left';c.fillStyle='#c9d9e9';c.fillText(soc.toFixed(0)+'%',xx+30,yy+4);
    c.font='8px system-ui';c.fillStyle='#899fb7';c.fillText(Math.round(sp.powerW)+' W solar',xx,yy+15);c.restore();
   }
  }
  if(this.mode==='map'){
   const base=this.project(g.center),side=this.project(add(g.center,[500,0,0])),px=Math.hypot(side.x-base.x,side.y-base.y);
   if(px>12&&px<w*.55){c.strokeStyle='#9aacbe';c.lineWidth=1.2;c.beginPath();c.moveTo(18,h-32);c.lineTo(18+px,h-32);c.stroke();c.beginPath();c.moveTo(18,h-36);c.lineTo(18,h-28);c.moveTo(18+px,h-36);c.lineTo(18+px,h-28);c.stroke();c.fillStyle='#aab9c8';c.font='9px system-ui';c.textAlign='left';c.fillText('500 m',18,h-40);}
   return;
  }
  if(!active||!s||!this.showDirections)return;
  const start=add(active.p,[0,0,g.span*.061]),a=this.project(start);
  const large=w>700,rad=large?49:36,cy=large?68:60;
  const sun={x:w*.23,y:cy,r:rad},earth={x:w*.77,y:cy,r:rad+4};
  const ray=(az,el,color,len,dashed=false)=>{
   const dir=directionInFrame(active.site,g.frame,az,el);
   let b;for(let attempt=0;attempt<5;attempt++){const raw=this.project(add(start,mul(dir,g.span*len*(1+attempt*.45))));b=boundedRay(a,raw,w,h,38,this.showSky?171:65,h-66);const crowded=g.points.some(pt=>{const q=this.project(pt.p);return Math.abs(q.x-b.x)<80&&Math.abs(q.y-b.y)<75;});if(!crowded)break;}

   c.strokeStyle=color;c.lineWidth=1.5;c.setLineDash(dashed?[6,5]:[]);c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();c.setLineDash([]);
   const t=Math.atan2(b.y-a.y,b.x-a.x);c.fillStyle=color;c.beginPath();c.moveTo(b.x,b.y);c.lineTo(b.x-9*Math.cos(t-.4),b.y-9*Math.sin(t-.4));c.lineTo(b.x-9*Math.cos(t+.4),b.y-9*Math.sin(t+.4));c.closePath();c.fill();return {a,b};
  };
  const sr=ray(s.sunAzDeg,s.sunElDeg,s.sunFraction>.001?'#e5bd70':'#b09b83',.32,s.sunFraction<.001);
  const er=ray(s.earthAzDeg,s.earthElDeg,s.earthVisible?'#85bdeb':'#939dae',.35,true);
  if(s.sunFraction>1e-8){
   const dx=sr.a.x-sr.b.x,dy=sr.a.y-sr.b.y;
   c.save();c.shadowColor='#f2ca77';c.shadowBlur=6;
   for(let i=0;i<4;i++){const u=(this.phase*.19+i/4)%1;c.globalAlpha=.2+.65*Math.sin(Math.PI*u);c.fillStyle='#ffe0a2';c.beginPath();c.arc(sr.b.x+dx*u,sr.b.y+dy*u,2,0,Math.PI*2);c.fill();}c.restore();
  }

  const leader=(b,body,color)=>{const yy=body.y+body.r+58;c.save();c.strokeStyle=color;c.globalAlpha=.44;c.lineWidth=1;c.setLineDash([3,5]);c.beginPath();c.moveTo(b.x,b.y);c.bezierCurveTo(b.x,b.y-32,body.x,yy+42,body.x,yy);c.stroke();c.restore();};
  if(this.showSky){leader(sr.b,sun,'#e5bd70');leader(er.b,earth,'#85bdeb');}
  if(dataFlowVisible(s)){
   const tr=ray(s.stationAzDeg,s.stationElDeg,'#8cdec7',.34,false),dx=tr.b.x-tr.a.x,dy=tr.b.y-tr.a.y,L=Math.hypot(dx,dy),nx=-dy/(L||1),ny=dx/(L||1);
   c.font='600 12px ui-monospace,monospace';c.textAlign='center';
   for(let j=0;j<5;j++){const u=(this.phase*.25+j/5)%1;c.fillStyle='#c6f5e8';c.fillText(j%2?'1':'0',tr.a.x+dx*u+nx*11,tr.a.y+dy*u+ny*11);}
   const labelX=clamp(tr.b.x,65,w-65),labelY=clamp(tr.b.y+27,192,h-47);this.label(c,'TRANSMITTING',labelX,labelY,'#8cdec7','center');
  }
  if(this.showSky){
   const back=c.createLinearGradient(0,0,0,178);back.addColorStop(0,'rgba(8,15,29,.97)');back.addColorStop(.8,'rgba(8,15,29,.92)');back.addColorStop(1,'rgba(8,15,29,0)');c.fillStyle=back;c.fillRect(0,0,w,178);
   for(const [kind,body]of [['sun',sun],['earth',earth]]){
    const stat=bodyStatus(s,kind),el=kind==='sun'?s.sunElDeg:s.earthElDeg,az=kind==='sun'?s.sunAzDeg:s.earthAzDeg;
    drawCelestial(c,kind,body.x,body.y,body.r,{dim:false});c.textAlign='center';c.font='600 11px system-ui';c.fillStyle=kind==='sun'?'#f2cf8a':'#b6d9f5';c.fillText(kind==='sun'?'SUN':'EARTH',body.x,body.y+body.r+16);c.font='500 11px system-ui';c.fillStyle='#e2e8ef';c.fillText(`${el.toFixed(1)}° elevation · ${az.toFixed(0)}° azimuth`,body.x,body.y+body.r+33);c.font='10px system-ui';c.fillStyle=stat.tone;c.fillText(stat.title,body.x,body.y+body.r+49);this.skyHitPoints.push({...body,kind});
   }
  }else{
   const small=(ray,text,color,dy)=>{const x=clamp(ray.b.x,65,w-65),y=clamp(ray.b.y+dy,55,h-48);this.label(c,text,x,y,color,'center');};
   drawCelestial(c,'sun',sr.b.x,sr.b.y,17,{glow:true});drawCelestial(c,'earth',er.b.x,er.b.y,20,{glow:true});small(sr,`SUN · ${s.sunElDeg.toFixed(1)}°`,'#efc775',-27);small(er,`EARTH · ${s.earthElDeg.toFixed(1)}°`,'#9ccbf0',34);
  }
  // A fixed metric ruler remains in the actual display coordinate scale.
  const base=this.project(g.center),side=this.project(add(g.center,mul(this.basis().right,500))),px=Math.hypot(side.x-base.x,side.y-base.y);
  if(px>12&&px<w*.4){c.strokeStyle='#8b9db1';c.lineWidth=1;c.beginPath();c.moveTo(18,h-33);c.lineTo(18+px,h-33);c.stroke();c.fillStyle='#96a8bb';c.font='9px system-ui';c.textAlign='left';c.fillText('500 m',18,h-40);}
  c.textAlign='right';c.fillStyle='#7e92a8';c.font='9px system-ui';c.fillText(this.cameraPreset==='close'?'Lander perspective':this.cameraPreset==='wide'?'Comparison overview':this.cameraPreset==='low'?'Low-horizon perspective':this.cameraPreset==='sun'?'Looking toward the Sun':'Looking toward Earth',w-17,h-38);
 }
 pick(e){const r=this.canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;for(const p of (this.mode==='3d'?this.skyHitPoints:[])||[]){if(Math.hypot(p.x-x,p.y-y)<p.r+10){this.setCameraPreset(p.kind);return;}}for(const p of this.hitPoints||[]){if(Math.hypot(p.x-x,p.y-y)<35){this.onPick?.(p.role);return;}}}
 destroy(){this.destroyed=true;this.unlistenSky?.();this.resizeObserver.disconnect();this.controls?.dispose();this.renderer?.dispose();}
}
