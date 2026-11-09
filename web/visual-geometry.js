/** Pure display geometry. Numerical horizon/energy/radio models are separate.
 * Meshes are transformed through Moon-centred Cartesian coordinates into one
 * local tangent frame. No terrain is generated outside supplied mesh coverage.
 */
const D=Math.PI/180,R=1737400;
export const A_COLOR='#6aa8ff',B_COLOR='#efbd61';
export const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
export const add=(a,b)=>a.map((v,i)=>v+b[i]);
export const sub=(a,b)=>a.map((v,i)=>v-b[i]);
export const mul=(a,k)=>a.map(v=>v*k);
export const unit=a=>mul(a,1/(Math.hypot(...a)||1));
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export function tangentFrame(s){const p=s.latitude_deg*D,l=s.longitude_deg*D,u=[Math.cos(p)*Math.cos(l),Math.cos(p)*Math.sin(l),Math.sin(p)];return{east:[-Math.sin(l),Math.cos(l),0],north:[-Math.sin(p)*Math.cos(l),-Math.sin(p)*Math.sin(l),Math.cos(p)],up:u,origin:mul(u,R+s.ground_elevation_m)};}
export function worldToLocal(v,f){const d=sub(v,f.origin);return[dot(d,f.east),dot(d,f.north),dot(d,f.up)];}
export function localToWorld(e,n,z,f){const up=Math.sqrt(Math.max(0,(R+z)**2-e*e-n*n))-(Math.hypot(...f.origin));return add(f.origin,add(mul(f.east,e),add(mul(f.north,n),mul(f.up,up))));}
export function pointInFrame(site,base){return worldToLocal(tangentFrame(site).origin,base);}
export function directionInFrame(site,base,az,el){const f=tangentFrame(site),a=az*D,h=el*D,v=add(mul(f.east,Math.sin(a)*Math.cos(h)),add(mul(f.north,Math.cos(a)*Math.cos(h)),mul(f.up,Math.sin(h))));return[dot(v,base.east),dot(v,base.north),dot(v,base.up)];}
function meshInfo(s){const m=s.mesh;if(!m)return null;return{...m,flat:Array.isArray(m.elevations_m[0])?m.elevations_m.flat():m.elevations_m,frame:tangentFrame(s),site:s};}
export function terrainScene(bundle,records){
 const valid=records.filter(Boolean),reference=valid[0]?.result.site||bundle.sites[0],frame=tangentFrame(reference);
 const selected=[...new Set(valid.map(r=>r.result.site.id))].map(id=>bundle.sites.find(s=>s.id===id)).filter(Boolean);
 if(!selected.length)selected.push(reference);
 const meshes=selected.map(meshInfo).filter(Boolean),vertices=[],triangles=[];
 // Build one resampled display grid over the union of the supplied patches.
 // Values outside all supplied DEM patches stay null (no invented terrain).
 if(meshes.length){
  let minE=Infinity,maxE=-Infinity,minN=Infinity,maxN=-Infinity;
  for(const m of meshes)for(const [col,row] of [[0,0],[m.width-1,0],[0,m.height-1],[m.width-1,m.height-1]]){
   const z=m.flat[row*m.width+col];if(!Number.isFinite(z))continue;
   const p=worldToLocal(localToWorld(m.origin_x_m+col*m.spacing_m,m.origin_y_m+row*m.spacing_m*(m.row_order==='north_to_south'?-1:1),z,m.frame),frame);
   minE=Math.min(minE,p[0]);maxE=Math.max(maxE,p[0]);minN=Math.min(minN,p[1]);maxN=Math.max(maxN,p[1]);
  }
  const step=40,e0=Math.ceil(minE/step)*step,n0=Math.ceil(minN/step)*step,nx=Math.floor((maxE-e0)/step)+1,ny=Math.floor((maxN-n0)/step)+1;
  const read=(e,n,zGuess)=>{
   const world=localToWorld(e,n,zGuess,frame);let best=Infinity,answer=null;
   for(const m of meshes){const p=worldToLocal(world,m.frame),col=(p[0]-m.origin_x_m)/m.spacing_m,row=(p[1]-m.origin_y_m)/m.spacing_m*(m.row_order==='north_to_south'?-1:1);
    if(col<0||row<0||col>m.width-1||row>m.height-1)continue;
    const c=Math.min(m.width-2,Math.floor(col)),r=Math.min(m.height-2,Math.floor(row)),u=col-c,v=row-r,a=m.flat[r*m.width+c],b=m.flat[r*m.width+c+1],d=m.flat[(r+1)*m.width+c],f=m.flat[(r+1)*m.width+c+1];
    if(![a,b,d,f].every(Number.isFinite))continue;const distance=p[0]*p[0]+p[1]*p[1];
    if(distance<best){best=distance;answer=(a*(1-u)+b*u)*(1-v)+(d*(1-u)+f*u)*v;}
   }return answer;
  };
  for(let r=0;r<ny;r++)for(let c=0;c<nx;c++){const e=e0+c*step,n=n0+r*step;let z=read(e,n,reference.ground_elevation_m);if(z!==null){const refined=read(e,n,z);if(refined!==null)z=refined;}
   vertices.push(z===null?null:[e,n,Math.sqrt(Math.max(0,(R+z)**2-e*e-n*n))-(R+reference.ground_elevation_m)]);
  }
  for(let r=0;r<ny-1;r++)for(let c=0;c<nx-1;c++){const a=r*nx+c,b=a+1,d=a+nx,f=d+1;if([a,b,d].every(i=>vertices[i]))triangles.push([a,b,d]);if([b,f,d].every(i=>vertices[i]))triangles.push([b,f,d]);}
 }
 const points=valid.map(r=>({role:r.role,site:r.result.site,p:pointInFrame(r.result.site,frame),result:r.result,color:r.role==='current'?A_COLOR:B_COLOR}));
 let min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const p of vertices){if(p)for(let j=0;j<3;j++){min[j]=Math.min(min[j],p[j]);max[j]=Math.max(max[j],p[j]);}}
 if(!vertices.length){min=[-1500,-1500,0];max=[1500,1500,0];}
 const span=Math.max(max[0]-min[0],max[1]-min[1],100),center=min.map((v,i)=>(v+max[i])/2);center[2]=0;
 return{frame,vertices,triangles,points,min,max,span,center,hasTerrain:vertices.length>0,sameSite:points.length>1&&points[0].site.id===points[1].site.id};
}
export function panelNormal(settings,sample){
 const az=(settings.panelMode==='fixed'?settings.azimuthDeg:sample?.sunAzDeg||0)*D;
 const tilt=settings.panelMode==='horizontal'?0:settings.panelMode==='fixed'?settings.tiltDeg*D:settings.panelMode==='tracking'?Math.PI/2-(sample?.sunElDeg||0)*D:Math.PI/2;
 return[Math.sin(tilt)*Math.sin(az),Math.sin(tilt)*Math.cos(az),Math.cos(tilt)];
}
export function sameScenarioSettings(a,b){return a&&b&&JSON.stringify(Object.keys(a).sort().map(k=>[k,a[k]]))===JSON.stringify(Object.keys(b).sort().map(k=>[k,b[k]]));}
export function sampleAtHour(result,h){if(!result)return null;const samples=result.samples;const k=Math.min(samples.length-1,Math.max(0,Math.round(h*60/result.settings.stepMinutes)));return samples[k];}
export function dataFlowVisible(p){return !!p&&p.actualTxMbps>1e-10&&p.linkAvailable===1;}
