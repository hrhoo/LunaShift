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
// Clip in the shared east/north plane; interpolate height on the original
// triangle. This retains measured patch edges without extending their coverage.
const turn=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
const bounds=ps=>[Math.min(...ps.map(p=>p[0])),Math.min(...ps.map(p=>p[1])),Math.max(...ps.map(p=>p[0])),Math.max(...ps.map(p=>p[1]))];
const overlaps=(a,b)=>a[0]<b[2]-1e-8&&a[2]>b[0]+1e-8&&a[1]<b[3]-1e-8&&a[3]>b[1]+1e-8;
function splitPolygon(poly,a,b){
 const inside=[],outside=[];
 for(let i=0;i<poly.length;i++){
  const p=poly[i],q=poly[(i+1)%poly.length],dp=turn(a,b,p),dq=turn(a,b,q);
  (dp>=0?inside:outside).push(p);
  if((dp>=0)!==(dq>=0)){
   const hit=add(p,mul(sub(q,p),dp/(dp-dq)));inside.push(hit);outside.push(hit);
  }
 }
 return {inside,outside};
}
function subtractTriangle(poly,clip){
 if(!overlaps(bounds(poly),clip.bounds))return [poly];
 let remaining=poly;const pieces=[];
 for(let i=0;i<3&&remaining.length>=3;i++){
  const {inside,outside}=splitPolygon(remaining,clip.points[i],clip.points[(i+1)%3]);
  if(outside.length>=3)pieces.push(outside);remaining=inside;
 }
 return pieces;
}
function suppliedTriangles(m,frame){
 const stride=Math.max(1,Math.round(40/m.spacing_m));
 const indices=size=>{const out=[];for(let i=0;i<size-1;i+=stride)out.push(i);out.push(size-1);return out;};
 const cols=indices(m.width),rows=indices(m.height),cache=new Map(),out=[];
 const at=(c,r)=>{
  const key=r*m.width+c;if(!cache.has(key))cache.set(key,worldToLocal(localToWorld(m.origin_x_m+c*m.spacing_m,m.origin_y_m+r*m.spacing_m*(m.row_order==='north_to_south'?-1:1),m.flat[key],m.frame),frame));
  return cache.get(key);
 };
 for(let y=0;y<rows.length-1;y++)for(let x=0;x<cols.length-1;x++){
  const c=cols[x],r=rows[y],cc=cols[x+1],rr=rows[y+1];let valid=true;
  // Do not decimate across missing source samples.
  for(let j=r;j<=rr&&valid;j++)for(let i=c;i<=cc;i++)if(!Number.isFinite(m.flat[j*m.width+i])){valid=false;break;}
  if(!valid)continue;
  const a=at(c,r),b=at(cc,r),d=at(c,rr),f=at(cc,rr);
  for(const points of [[a,b,d],[b,f,d]]){
   if(turn(...points)<0)points.reverse();out.push({points,bounds:bounds(points)});
  }
 }
 return out;
}
export function terrainScene(bundle,records){
 const valid=records.filter(Boolean),reference=valid[0]?.result.site||bundle.sites[0];
 const selected=[...new Set(valid.map(r=>r.result.site.id))].map(id=>bundle.sites.find(s=>s.id===id)).filter(Boolean);
 if(!selected.length)selected.push(reference);
 const region=bundle.regionalTerrain;
 // A prepared regional mesh only represents the exact sites it was built for.
 // Imports and legacy bundles retain their own measured display patches.
 const useRegion=region?.schema_version==='lunashift-regional-terrain-1'&&region.coordinate_frame==='MOON_ME_DE421'&&region.mesh&&selected.every(s=>region.sites.some(p=>['id','latitude_deg','longitude_deg','ground_elevation_m'].every(k=>p[k]===s[k])));
 const frame=tangentFrame(useRegion?region.reference:reference);
 const meshes=useRegion?[meshInfo({...region.reference,mesh:region.mesh})]:selected.map(meshInfo).filter(Boolean),vertices=[],triangles=[],vertexIds=new Map();
 // Keep each patch's native grid (including its final row and column). Trim
 // later patches against earlier coverage to avoid overlapping, flickering faces.
 // The spatial index also preserves holes: only valid source triangles cover land.
 const bins=new Map(),binSize=80;
 const keys=box=>{const out=[];for(let y=Math.floor(box[1]/binSize);y<=Math.floor(box[3]/binSize);y++)for(let x=Math.floor(box[0]/binSize);x<=Math.floor(box[2]/binSize);x++)out.push(x+':'+y);return out;};
 const vertex=p=>{const key=p.map(v=>Math.round(v*1e6)).join(':');if(!vertexIds.has(key)){vertexIds.set(key,vertices.length);vertices.push(p);}return vertexIds.get(key);};
 for(const m of meshes){
  const source=suppliedTriangles(m,frame);
  for(const t of source){
   const candidates=new Set(keys(t.bounds).flatMap(key=>bins.get(key)||[]));let pieces=[t.points];
   for(const clip of candidates){
    if(!overlaps(t.bounds,clip.bounds))continue;
    pieces=pieces.flatMap(poly=>subtractTriangle(poly,clip));if(!pieces.length)break;
   }
   for(const poly of pieces)for(let i=1;i<poly.length-1;i++){
    if(Math.abs(turn(poly[0],poly[i],poly[i+1]))<1e-7)continue;
    triangles.push([poly[0],poly[i],poly[i+1]].map(vertex));
   }
  }
  if(m!==meshes[meshes.length-1])for(const t of source)for(const key of keys(t.bounds)){if(!bins.has(key))bins.set(key,[]);bins.get(key).push(t);}
 }
 const points=valid.map(r=>({role:r.role,site:r.result.site,p:pointInFrame(r.result.site,frame),result:r.result,color:r.role==='current'?A_COLOR:B_COLOR}));
 let min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const p of vertices){if(p)for(let j=0;j<3;j++){min[j]=Math.min(min[j],p[j]);max[j]=Math.max(max[j],p[j]);}}
 if(!vertices.length){min=[-1500,-1500,0];max=[1500,1500,0];}
 const span=Math.max(max[0]-min[0],max[1]-min[1],100),center=min.map((v,i)=>(v+max[i])/2);center[2]=0;
 return{frame,vertices,triangles,points,min,max,span,center,terrainKind:useRegion?'regional':'local',hasTerrain:vertices.length>0,sameSite:points.length>1&&points[0].site.id===points[1].site.id};
}
export function panelNormal(settings,sample){
 const az=(settings.panelMode==='fixed'?settings.azimuthDeg:sample?.sunAzDeg||0)*D;
 const tilt=settings.panelMode==='horizontal'?0:settings.panelMode==='fixed'?settings.tiltDeg*D:settings.panelMode==='tracking'?Math.PI/2-(sample?.sunElDeg||0)*D:Math.PI/2;
 return[Math.sin(tilt)*Math.sin(az),Math.sin(tilt)*Math.cos(az),Math.cos(tilt)];
}
export function sameScenarioSettings(a,b){return a&&b&&JSON.stringify(Object.keys(a).sort().map(k=>[k,a[k]]))===JSON.stringify(Object.keys(b).sort().map(k=>[k,b[k]]));}
export function sampleAtHour(result,h){if(!result)return null;const samples=result.samples;const k=Math.min(samples.length-1,Math.max(0,Math.round(h*60/result.settings.stepMinutes)));return samples[k];}
export function dataFlowVisible(p){return !!p&&p.actualTxMbps>1e-10&&p.linkAvailable===1;}
