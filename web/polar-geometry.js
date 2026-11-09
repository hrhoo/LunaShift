/** Pure Moon-centred projection helpers. Coordinates: x=0E, y=90E, z=north. */
import {dot,cross,unit,add,mul,sub} from './visual-geometry.js';
export const DEG=Math.PI/180;
export function geoUnit(lat,lon){return [Math.cos(lat*DEG)*Math.cos(lon*DEG),Math.cos(lat*DEG)*Math.sin(lon*DEG),Math.sin(lat*DEG)];}
export function polarBasis(latitude=-56,longitude=-130){const front=geoUnit(latitude,longitude),right=unit(cross([0,0,-1],front)),up=unit(cross(front,right));return {front,right,up};}
export function projectSpherePoint(p,basis,cx,cy,scale){return {x:cx+dot(p,basis.right)*scale,y:cy-dot(p,basis.up)*scale,depth:dot(p,basis.front)};}
export function bodyDisplayPoint(site,bodyPositionKm,distance=1.85){const siteRadius=1+(site.ground_elevation_m||0)/1737400,origin=mul(geoUnit(site.latitude_deg,site.longitude_deg),siteRadius);const dir=unit(sub(bodyPositionKm,mul(origin,1737.4)));return add(origin,mul(dir,distance));}
export function isBehindGlobe(point,basis){const x=dot(point,basis.right),y=dot(point,basis.up),z=dot(point,basis.front),r2=x*x+y*y;return r2<1&&z<Math.sqrt(1-r2);}
export function rayHitsSphere(origin,direction,radius=1){const d=unit(direction),b=dot(origin,d),c=dot(origin,origin)-radius*radius,disc=b*b-c;if(disc<0)return false;return -b+Math.sqrt(disc)>1e-9 && -b-Math.sqrt(disc)>1e-9;}
export function angleToPixel(azimuth,elevation,heading,fov,width,height,verticalScale=1){let delta=((azimuth-heading+540)%360)-180;return{x:width/2+delta/fov*width,y:height*.58-elevation*width/fov*verticalScale,inView:Math.abs(delta)<=fov/2};}
