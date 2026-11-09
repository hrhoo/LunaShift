/** Pure camera math: only presentation, independent of all mission calculations. */
import {add,sub,mul,dot,directionInFrame} from './visual-geometry.js';
export const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
export function cameraBasis(yaw,pitch){return {right:[-Math.cos(yaw),Math.sin(yaw),0],up:[-Math.sin(yaw)*Math.sin(pitch),-Math.cos(yaw)*Math.sin(pitch),Math.cos(pitch)],front:[Math.sin(yaw)*Math.cos(pitch),Math.cos(yaw)*Math.cos(pitch),Math.sin(pitch)]};}
export function chooseCamera(geo,preset,role,sample){
 let yaw=2.2,pitch=preset==='low'?.12:preset==='close'?.22:geo.terrainKind==='regional'?.55:.34;
 const a=geo.points[0],b=geo.points[1];
 if(a&&b&&!geo.sameSite){const d=sub(b.p,a.p);yaw=Math.atan2(d[1],-d[0]);}
 const selected=geo.points.find(p=>p.role===role)||a;
 if((preset==='sun'||preset==='earth')&&selected&&sample){const d=directionInFrame(selected.site,geo.frame,preset==='sun'?sample.sunAzDeg:sample.earthAzDeg,preset==='sun'?sample.sunElDeg:sample.earthElDeg);yaw=Math.atan2(-d[0],-d[1]);pitch=.24;}
 return {yaw,pitch};
}
export function fitTerrain(geo,basis,width,height,map=false,topPad=null){
 const top=topPad??(map?44:50),bottom=height-42;
 let lx=Infinity,hx=-Infinity,ly=Infinity,hy=-Infinity;
 const vertices=geo.vertices.filter(Boolean);
 // Include enlarged landers in the camera fit, not just the terrain surface.
 for(const p of [...vertices,...geo.points.map(p=>add(p.p,[0,0,geo.span*.085]))]){
  const d=sub(p,geo.center),x=dot(d,basis.right),y=dot(d,basis.up);
  lx=Math.min(lx,x);hx=Math.max(hx,x);ly=Math.min(ly,y);hy=Math.max(hy,y);
 }
 if(!Number.isFinite(lx)){lx=ly=-geo.span*.5;hx=hy=geo.span*.5;}
 const scale=Math.min((width-48)/Math.max(1,hx-lx),(bottom-top)/Math.max(1,hy-ly))*.94;
 const target=add(geo.center,add(mul(basis.right,(lx+hx)/2),mul(basis.up,(ly+hy)/2)));
 return {target,scale,centerX:width/2,centerY:(top+bottom)/2};
}
export function boundedRay(a,b,width,height,pad=22,top=155,bottom=height-45){
 const dx=b.x-a.x,dy=b.y-a.y;
 let k=1;
 if(dx>0)k=Math.min(k,(width-pad-a.x)/dx);if(dx<0)k=Math.min(k,(pad-a.x)/dx);
 if(dy>0)k=Math.min(k,(bottom-a.y)/dy);if(dy<0)k=Math.min(k,(top-a.y)/dy);
 k=clamp(k,0,1);
 return {x:a.x+dx*k,y:a.y+dy*k,clipped:k<1};
}
