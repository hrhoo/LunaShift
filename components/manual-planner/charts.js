import {icon} from './icons.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const D=Math.PI/180;
export function fmtHours(h){if(h===null||h===undefined||!Number.isFinite(h))return 'Not reached';if(Math.abs(h)<1e-9)return '0 min';if(h<1/60)return '< 1 min';let m=Math.round(h*60);return m<60?`${m} min`:`${Math.floor(m/60)}h ${String(m%60).padStart(2,'0')}m`;}
export function fmtDate(utc,short=false){return new Date(utc).toLocaleDateString('en-GB',{day:'2-digit',month:'short',...(!short?{year:'numeric'}:{}),timeZone:'UTC'});}
export function timeUTC(utc){return new Date(utc).toISOString().slice(11,16);}
export function escapeHTML(t){return String(t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function setup(canvas){const w=canvas.clientWidth,h=canvas.clientHeight,d=Math.min(devicePixelRatio,2);if(!w||!h)return null;if(canvas.width!==Math.round(w*d)||canvas.height!==Math.round(h*d)){canvas.width=Math.round(w*d);canvas.height=Math.round(h*d);}const c=canvas.getContext('2d');c.setTransform(d,0,0,d,0,0);c.clearRect(0,0,w,h);return {c,w,h};}
export function drawHorizon(canvas,result,p){const ctx=setup(canvas);if(!ctx||!result||!p)return;const {c,w,h}=ctx,hor=result.horizon;let min=Math.min(-7,...hor.elevationDeg,p.earthElDeg-1.5),max=Math.max(8,...hor.elevationDeg,p.sunElDeg+1.2);
 const planner=!!canvas.closest('#plannerPage'),colors=planner?{grid:'#334155',text:'#b7c6de',fill:'#263448',terrain:'#94a3b8',zero:'#64748b',sun:'#facc15',earth:'#5eead4',station:'#a78bfa'}:{grid:'#ffffff0b',text:'#77909c',fill:'#6f849b1f',terrain:'#788f9c',zero:'#ffffff1d',sun:'#e2c783',earth:'#89b7d5',station:'#8bc8b5'};
 const left=31,right=w-15,top=10,bottom=h-23,X=a=>left+(a/360)*(right-left),Y=e=>bottom-(e-min)/(max-min)*(bottom-top);
 c.font='8px monospace';c.lineWidth=.6;c.strokeStyle=colors.grid;c.fillStyle=colors.text;
 for(let i=0;i<4;i++){let v=min+i*(max-min)/3,y=Y(v);c.beginPath();c.moveTo(left,y);c.lineTo(right,y);c.stroke();c.textAlign='right';c.fillText(v.toFixed(0)+'°',left-6,y+3);}
 c.beginPath();c.moveTo(left,bottom);hor.azimuthDeg.forEach((az,i)=>c.lineTo(X(az),Y(hor.elevationDeg[i])));c.lineTo(right,Y(hor.elevationDeg[0]));c.lineTo(right,bottom);c.closePath();c.fillStyle=colors.fill;c.fill();c.beginPath();hor.azimuthDeg.forEach((az,i)=>{if(!i)c.moveTo(X(az),Y(hor.elevationDeg[i]));else c.lineTo(X(az),Y(hor.elevationDeg[i]));});c.lineTo(right,Y(hor.elevationDeg[0]));c.strokeStyle=colors.terrain;c.lineWidth=1.15;c.stroke();
 c.strokeStyle=colors.zero;c.setLineDash([3,5]);c.beginPath();c.moveTo(left,Y(0));c.lineTo(right,Y(0));c.stroke();c.setLineDash([]);
 ['N','NE','E','SE','S','SW','W','NW','N'].forEach((v,i)=>{c.fillStyle=colors.text;c.textAlign='center';c.font='7px system-ui';c.fillText(v,X(i*45),h-8);});
 const body=(az,el,color,label,fraction)=>{const x=X(az),y=Y(el);c.beginPath();c.arc(x,y,5,0,Math.PI*2);if(fraction>.99){c.fillStyle=color;c.fill();}else{c.strokeStyle=color;c.setLineDash(fraction<.001?[2,2]:[]);c.stroke();c.setLineDash([]);if(fraction>.001){c.save();c.beginPath();c.arc(x,y,5,0,Math.PI*2);c.clip();c.fillStyle=color;c.fillRect(x-5,y-5,10,10*fraction);c.restore();}}c.font='8px system-ui';c.fillStyle=color;c.textAlign=x>w-120?'right':'left';c.fillText(`${label} ${el.toFixed(1)}°`,x+(x>w-120?-9:9),clamp(y-7,11,bottom-3));};
 body(p.sunAzDeg,p.sunElDeg,colors.sun,'Sun',p.sunFraction);body(p.earthAzDeg,p.earthElDeg,colors.earth,'Earth',p.earthFraction);
 const sx=X(p.stationAzDeg),sy=Y(p.stationElDeg);c.strokeStyle=colors.station;c.lineWidth=1;c.beginPath();c.moveTo(sx-3,sy);c.lineTo(sx+3,sy);c.moveTo(sx,sy-3);c.lineTo(sx,sy+3);c.stroke();
}
const timelineIcons=new Map();
function timelineIcon(c,canvas,name,color,x,y){
 const key=name+color;let entry=timelineIcons.get(key);
 if(!entry){
  entry={image:new Image(),waiting:new Set()};timelineIcons.set(key,entry);
  entry.image.onload=()=>{for(const target of entry.waiting)target._redrawTimeline?.();entry.waiting.clear();};
  entry.image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(icon(name,'',18).replace('<svg ','<svg xmlns="http://www.w3.org/2000/svg" ').replace('currentColor',color));
 }
 if(entry.image.complete&&entry.image.naturalWidth)c.drawImage(entry.image,x-9,y-9,18,18);
 else entry.waiting.add(canvas);
}
export const timelinePlotBounds=width=>({left:width<600?85:114,right:width-48});
export function drawTimeline(canvas,result,hour,displayDuration=result?.settings.durationHours){
 const ctx=setup(canvas);if(!ctx||!result)return;
 canvas._redrawTimeline=()=>drawTimeline(canvas,result,hour,displayDuration);
 const {c,w,h}=ctx,{left,right}=timelinePlotBounds(w),top=12,duration=Math.min(result.settings.durationHours,displayDuration);
 const style=getComputedStyle(canvas),color=(name,fallback)=>style.getPropertyValue('--planner-'+name).trim()||fallback;
 const palette={ink:color('ink','#17233b'),muted:color('muted','#4b5c76'),track:color('track','#eef2f9'),grid:color('line','#d7e0ef'),sun:color('sun','#facc15'),sunIcon:color('sun-icon','#713f12'),science:color('measurement','#bfdbfe'),scienceIcon:color('measurement-icon','#1e40af'),earth:color('earth','#99f6e4'),earthIcon:color('earth-icon','#115e59'),tx:color('transmission','#7c3aed'),txIcon:color('transmission-icon','#ffffff')};
 const X=t=>left+clamp(t/duration,0,1)*(right-left),energyHeight=58,scienceHeight=19,earthHeight=32;
 const scienceY=top+energyHeight+12,earthY=scienceY+scienceHeight+12;
 const batteryY=pct=>top+energyHeight-6-clamp(pct,0,100)/100*(energyHeight-12);
 c.font='11px system-ui';c.textAlign='right';c.fillStyle=palette.muted;
 c.fillText('Sunlight',left-12,top+energyHeight/2-4);c.fillText('+ battery',left-12,top+energyHeight/2+12);
 c.fillText('Measurement',left-12,scienceY+scienceHeight/2+4);
 c.fillText('Earth visible',left-12,earthY+earthHeight/2-4);c.fillText('+ transmitting',left-12,earthY+earthHeight/2+12);
 for(const [y,height]of [[top,energyHeight],[scienceY,scienceHeight],[earthY,earthHeight]]){c.fillStyle=palette.track;c.fillRect(left,y,right-left,height);}
 const windows=(ws,y,height,fill,symbol,symbolColor,symbolY=y+height/2)=>{
  for(const [a,b]of ws||[]){const x=X(a),width=X(b)-x;if(width<=0)continue;
   c.fillStyle=fill;c.fillRect(x,y,width,height);
   if(symbol&&width>=18)timelineIcon(c,canvas,symbol,symbolColor,x+width/2,symbolY);
  }
 };
 c.save();c.globalAlpha=.6;windows(result.windows.sun,top,energyHeight,palette.sun);c.restore();
 const ticks=4;c.font='10px monospace';c.textAlign='center';
 for(let i=0;i<=ticks;i++){const t=duration*i/ticks,x=X(t);c.fillStyle=palette.muted;c.fillText(fmtHours(t),x,h-7);c.strokeStyle=palette.grid;c.lineWidth=1;c.beginPath();c.moveTo(x,top);c.lineTo(x,earthY+earthHeight);c.stroke();}
 // Fixed charge axis: the line always uses the entire 0–100% range.
 c.font='10px monospace';c.textAlign='left';c.fillStyle=palette.muted;c.strokeStyle=palette.grid;c.lineWidth=1;
 for(const pct of [0,50,100]){
  const y=batteryY(pct);c.fillText(`${pct}%`,right+10,y+3);
  c.beginPath();c.moveTo(right+2,y);c.lineTo(right+6,y);c.stroke();
 }
 const gradient=c.createLinearGradient(0,batteryY(100),0,batteryY(0));gradient.addColorStop(0,'#4ade80');gradient.addColorStop(.5,'#facc15');gradient.addColorStop(1,'#fb7185');
 c.beginPath();for(let i=0;i<result.samples.length;i++){
  const p=result.samples[i];
  if(p.elapsedHours>duration){const previous=result.samples[i-1];if(previous){const f=(duration-previous.elapsedHours)/(p.elapsedHours-previous.elapsedHours);c.lineTo(X(duration),batteryY(previous.socPct+(p.socPct-previous.socPct)*f));}break;}
  if(i)c.lineTo(X(p.elapsedHours),batteryY(p.socPct));else c.moveTo(X(p.elapsedHours),batteryY(p.socPct));
 }c.strokeStyle=gradient;c.lineWidth=2.5;c.stroke();
 c.strokeStyle='#fb923c';c.lineWidth=1;c.setLineDash([2,4]);c.beginPath();c.moveTo(left,batteryY(result.settings.reservePct));c.lineTo(right,batteryY(result.settings.reservePct));c.stroke();c.setLineDash([]);
 for(const [a,b]of result.windows.sun||[])if(X(b)-X(a)>=18)timelineIcon(c,canvas,'sun',palette.sunIcon,(X(a)+X(b))/2,top+energyHeight-17);
 windows(result.windows.science,scienceY,scienceHeight,palette.science,'flask',palette.scienceIcon);
 windows(result.windows.link,earthY,earthHeight,palette.earth);
 for(const [a,b]of result.windows.link||[])if(X(b)-X(a)>=18)timelineIcon(c,canvas,'earth',palette.earthIcon,(X(a)+X(b))/2,earthY+earthHeight/2);
 for(const [a,b]of result.windows.transmitting||[]){
  const x=X(a),width=X(b)-x;if(width<=0)continue;
  c.fillStyle=palette.tx;c.fillRect(x,earthY,width,earthHeight);
  if(width>=18)timelineIcon(c,canvas,'antenna',palette.txIcon,x+width/2,earthY+earthHeight/2);
 }
 const x=X(hour);c.strokeStyle=palette.ink;c.lineWidth=1;c.beginPath();c.moveTo(x,top-5);c.lineTo(x,earthY+earthHeight);c.stroke();c.fillStyle=palette.ink;c.beginPath();c.moveTo(x-4,top-7);c.lineTo(x+4,top-7);c.lineTo(x,top-2);c.closePath();c.fill();
 canvas._timeline={left,right,duration,currentX:x};
}
export function drawMap(canvas,site,bundle,onSelect){
 const c=canvas.getContext('2d'),w=canvas.width,h=canvas.height,m=site.mesh;const min=Math.min(...m.elevations_m.flat()),max=Math.max(...m.elevations_m.flat());
 const img=c.createImageData(m.width,m.height);for(let y=0;y<m.height;y++)for(let x=0;x<m.width;x++){const k=((m.height-1-y)*m.width+x)*4,v=(m.elevations_m[y][x]-min)/(max-min),dx=m.elevations_m[y][Math.min(x+1,m.width-1)]-m.elevations_m[y][Math.max(0,x-1)],dy=m.elevations_m[Math.min(y+1,m.height-1)][x]-m.elevations_m[Math.max(0,y-1)][x],shade=clamp(.6+(dx-dy)*.008,.2,1),q=(85+v*95)*shade;img.data[k]=q*.92;img.data[k+1]=q;img.data[k+2]=q*1.04;img.data[k+3]=255;}
 const tmp=document.createElement('canvas');tmp.width=m.width;tmp.height=m.height;tmp.getContext('2d').putImageData(img,0,0);c.drawImage(tmp,0,0,w,h);
 c.lineWidth=.5;c.strokeStyle='#cad5bd33';for(let y=1;y<m.height;y++)for(let x=1;x<m.width;x++){if(Math.floor(m.elevations_m[y][x]/100)!==Math.floor(m.elevations_m[y][x-1]/100)){c.beginPath();c.moveTo(x/m.width*w,(1-y/m.height)*h);c.lineTo(x/m.width*w,(1-(y-1)/m.height)*h);c.stroke();}}
 c.strokeStyle='#cbb878';c.fillStyle='#e1cd8b';c.lineWidth=1.5;c.beginPath();c.arc(w/2,h/2,7,0,Math.PI*2);c.stroke();c.beginPath();c.arc(w/2,h/2,2,0,Math.PI*2);c.fill();c.fillStyle='#e0e5da';c.font='10px system-ui';c.fillText(site.name.split('·')[1].trim(),w/2+13,h/2+3);c.font='8px monospace';c.fillText('N ↑',w-30,15);c.fillText('← 3 km →',8,h-10);
}
