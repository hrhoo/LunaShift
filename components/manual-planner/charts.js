import {icon} from './icons.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const D=Math.PI/180;
export function fmtHours(h){if(h===null||h===undefined||!Number.isFinite(h))return 'Not reached';if(Math.abs(h)<1e-9)return '0 min';if(h<1/60)return '< 1 min';let m=Math.round(h*60);return m<60?`${m} min`:`${Math.floor(m/60)}h ${String(m%60).padStart(2,'0')}m`;}
export function fmtDate(utc,short=false){return new Date(utc).toLocaleDateString('en-GB',{day:'2-digit',month:'short',...(!short?{year:'numeric'}:{}),timeZone:'UTC'});}
export function timeUTC(utc){return new Date(utc).toISOString().slice(11,16);}
export function escapeHTML(t){return String(t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function setup(canvas){const rect=canvas.getBoundingClientRect(),d=Math.min(devicePixelRatio,2);if(!rect.width||!rect.height)return null;const w=rect.width,h=rect.height;if(canvas.width!==Math.round(w*d)||canvas.height!==Math.round(h*d)){canvas.width=Math.round(w*d);canvas.height=Math.round(h*d);}const c=canvas.getContext('2d');c.setTransform(d,0,0,d,0,0);c.clearRect(0,0,w,h);return {c,w,h};}
export function drawHorizon(canvas,result,p){const ctx=setup(canvas);if(!ctx||!result||!p)return;const {c,w,h}=ctx,hor=result.horizon;let min=Math.min(-7,...hor.elevationDeg,p.earthElDeg-1.5),max=Math.max(8,...hor.elevationDeg,p.sunElDeg+1.2);
 const left=31,right=w-15,top=10,bottom=h-23,X=a=>left+(a/360)*(right-left),Y=e=>bottom-(e-min)/(max-min)*(bottom-top);
 c.font='8px monospace';c.lineWidth=.6;c.strokeStyle='#ffffff0b';c.fillStyle='#536f7e';
 for(let i=0;i<4;i++){let v=min+i*(max-min)/3,y=Y(v);c.beginPath();c.moveTo(left,y);c.lineTo(right,y);c.stroke();c.textAlign='right';c.fillText(v.toFixed(0)+'°',left-6,y+3);}
 c.beginPath();c.moveTo(left,bottom);hor.azimuthDeg.forEach((az,i)=>c.lineTo(X(az),Y(hor.elevationDeg[i])));c.lineTo(right,Y(hor.elevationDeg[0]));c.lineTo(right,bottom);c.closePath();c.fillStyle='#6f849b1f';c.fill();c.beginPath();hor.azimuthDeg.forEach((az,i)=>{if(!i)c.moveTo(X(az),Y(hor.elevationDeg[i]));else c.lineTo(X(az),Y(hor.elevationDeg[i]));});c.lineTo(right,Y(hor.elevationDeg[0]));c.strokeStyle='#788f9c';c.lineWidth=1.15;c.stroke();
 c.strokeStyle='#ffffff1d';c.setLineDash([3,5]);c.beginPath();c.moveTo(left,Y(0));c.lineTo(right,Y(0));c.stroke();c.setLineDash([]);
 ['N','NE','E','SE','S','SW','W','NW','N'].forEach((v,i)=>{c.fillStyle='#77909c';c.textAlign='center';c.font='7px system-ui';c.fillText(v,X(i*45),h-8);});
 const body=(az,el,color,label,fraction)=>{const x=X(az),y=Y(el);c.beginPath();c.arc(x,y,5,0,Math.PI*2);if(fraction>.99){c.fillStyle=color;c.fill();}else{c.strokeStyle=color;c.setLineDash(fraction<.001?[2,2]:[]);c.stroke();c.setLineDash([]);if(fraction>.001){c.save();c.beginPath();c.arc(x,y,5,0,Math.PI*2);c.clip();c.fillStyle=color;c.fillRect(x-5,y-5,10,10*fraction);c.restore();}}c.font='8px system-ui';c.fillStyle=color;c.textAlign=x>w-120?'right':'left';c.fillText(`${label} ${el.toFixed(1)}°`,x+(x>w-120?-9:9),clamp(y-7,11,bottom-3));};
 body(p.sunAzDeg,p.sunElDeg,'#e2c783','Sun',p.sunFraction);body(p.earthAzDeg,p.earthElDeg,'#89b7d5','Earth',p.earthFraction);
 const sx=X(p.stationAzDeg),sy=Y(p.stationElDeg);c.strokeStyle='#8bc8b5';c.lineWidth=1;c.beginPath();c.moveTo(sx-3,sy);c.lineTo(sx+3,sy);c.moveTo(sx,sy-3);c.lineTo(sx,sy+3);c.stroke();
}
export function drawTimeline(canvas,result,hour){const ctx=setup(canvas);if(!ctx||!result)return;const {c,w,h}=ctx,small=w<600,left=small?70:103,right=w-18,top=13,bottom=h-25,duration=result.settings.durationHours,X=t=>left+(t/duration)*(right-left),lane=27;
 c.font='9px system-ui';c.textAlign='right';c.fillStyle='#9ca3af';
 const labels=['Sunlight','Battery','Measurement','Ground contact','Transmitting'];labels.forEach((s,i)=>{let y=top+i*lane;c.fillText(s,left-13,y+10);c.fillStyle='rgba(255,255,255,0.06)';c.beginPath();c.roundRect(left,y,right-left,15,3);c.fill();c.fillStyle='#9ca3af';});
 const windows=(ws,i,color)=>{c.fillStyle=color;for(const [a,b]of ws){const x=X(a),r=Math.max(1,X(b)-x);c.beginPath();c.roundRect(x,top+i*lane,r,15,2);c.fill();}};
 windows(result.windows.sun,0,'#fbbf24');windows(result.windows.science,2,'#a855f7');windows(result.windows.link,3,'#38bdf8');windows(result.windows.transmitting,4,'#34d399');
 const yb=top+lane;c.beginPath();result.samples.forEach((p,i)=>{const y=yb+15-p.socPct/100*15;if(i)c.lineTo(X(p.elapsedHours),y);else c.moveTo(X(p.elapsedHours),y);});c.strokeStyle='#34d399';c.lineWidth=1.5;c.stroke();
 c.strokeStyle='#f87171';c.setLineDash([2,4]);c.beginPath();c.moveTo(left,yb+15-result.settings.reservePct/100*15);c.lineTo(right,yb+15-result.settings.reservePct/100*15);c.stroke();c.setLineDash([]);
 const tickCount=w<600?4:8;c.fillStyle='#9ca3af';c.font='8px monospace';c.textAlign='center';for(let i=0;i<=tickCount;i++){const t=duration*i/tickCount,x=X(t);c.fillText(`${t%1===0?t:t.toFixed(1)}h`,x,h-7);c.strokeStyle='rgba(255,255,255,0.08)';c.beginPath();c.moveTo(x,top-3);c.lineTo(x,top+4*lane+18);c.stroke();}
 const x=X(hour);c.strokeStyle='#22d3ee';c.lineWidth=1.3;c.beginPath();c.moveTo(x,top-5);c.lineTo(x,top+4*lane+20);c.stroke();c.fillStyle='#22d3ee';c.beginPath();c.moveTo(x-4,top-6);c.lineTo(x+4,top-6);c.lineTo(x,top-1);c.closePath();c.fill();
 const complete=result.metrics.completeHour;if(complete!==null){c.fillStyle='#34d399';c.beginPath();c.arc(X(complete),top+4*lane+7,3.5,0,Math.PI*2);c.fill();}
 canvas._timeline={left,right,duration};
}
export function drawMap(canvas,site,bundle,onSelect){
 const c=canvas.getContext('2d'),w=canvas.width,h=canvas.height,m=site.mesh;const min=Math.min(...m.elevations_m.flat()),max=Math.max(...m.elevations_m.flat());
 const img=c.createImageData(m.width,m.height);for(let y=0;y<m.height;y++)for(let x=0;x<m.width;x++){const k=((m.height-1-y)*m.width+x)*4,v=(m.elevations_m[y][x]-min)/(max-min),dx=m.elevations_m[y][Math.min(x+1,m.width-1)]-m.elevations_m[y][Math.max(0,x-1)],dy=m.elevations_m[Math.min(y+1,m.height-1)][x]-m.elevations_m[Math.max(0,y-1)][x],shade=clamp(.6+(dx-dy)*.008,.2,1),q=(85+v*95)*shade;img.data[k]=q*.92;img.data[k+1]=q;img.data[k+2]=q*1.04;img.data[k+3]=255;}
 const tmp=document.createElement('canvas');tmp.width=m.width;tmp.height=m.height;tmp.getContext('2d').putImageData(img,0,0);c.drawImage(tmp,0,0,w,h);
 c.lineWidth=.5;c.strokeStyle='#cad5bd33';for(let y=1;y<m.height;y++)for(let x=1;x<m.width;x++){if(Math.floor(m.elevations_m[y][x]/100)!==Math.floor(m.elevations_m[y][x-1]/100)){c.beginPath();c.moveTo(x/m.width*w,(1-y/m.height)*h);c.lineTo(x/m.width*w,(1-(y-1)/m.height)*h);c.stroke();}}
 c.strokeStyle='#cbb878';c.fillStyle='#e1cd8b';c.lineWidth=1.5;c.beginPath();c.arc(w/2,h/2,7,0,Math.PI*2);c.stroke();c.beginPath();c.arc(w/2,h/2,2,0,Math.PI*2);c.fill();c.fillStyle='#e0e5da';c.font='10px system-ui';c.fillText(site.name.split('·')[1].trim(),w/2+13,h/2+3);c.font='8px monospace';c.fillText('N ↑',w-30,15);c.fillText('← 3 km →',8,h-10);
}
