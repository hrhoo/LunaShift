/** Single-bounce, uniform-disc Lambertian terrain reflection. Metres and radians.
 * Rigidly translated/rotated Moon-fixed positions use a site ENU basis for tracing.
 * Integrate radiance over solid angle at the panel, avoiding the singular A/d²
 * approximation for nearby facets. No multiple scattering, Earthshine or heat.
 */
const PI = Math.PI, DEG = PI / 180, RADIUS = 1737400;
const SUN_RADIUS = 695700000, AU = 149597870700, EARTH_RADIUS = 6378137;
const dot = (a, b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub = (a, b) => a.map((v, i) => v-b[i]);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const unit = a => { const n = Math.hypot(...a); return a.map(v => v/n); };
const finite = (v, name, lo, hi) => {
  if (!Number.isFinite(v) || v < lo || v > hi) throw new RangeError(`${name} must be between ${lo} and ${hi}.`);
  return v;
};

export function validateScattering(settings) {
  finite(settings.terrainReflectance, 'Terrain reflectance', 0, 1);
  for (const [key, lo, hi] of [['scatterResolution', 8, 64], ['scatterTerrainStride', 1, 8], ['scatterSunSamples', 1, 61]]) {
    finite(settings[key], key, lo, hi);
    if (!Number.isInteger(settings[key])) throw new RangeError(`${key} must be an integer.`);
  }
}

/** Triangle BVH. Two-sided intersections; outward normals determine reflection. */
export function createTerrainTracer(vertices, faces) {
  if (vertices.length % 3 || faces.length % 3 || !vertices.length || !faces.length ||
      !vertices.every(Number.isFinite) || !faces.every(i => Number.isInteger(i) && i >= 0 && i < vertices.length/3)) {
    throw new TypeError('A finite triangle surface with valid vertex indices is required.');
  }
  const point = i => [vertices[3*i], vertices[3*i+1], vertices[3*i+2]];
  const ids = Array.from({length: faces.length/3}, (_, i) => i);
  const centres = new Float64Array(ids.length*3);
  for (const id of ids) for (let k=0;k<3;k++) centres[id*3+k]=(vertices[faces[id*3]*3+k]+vertices[faces[id*3+1]*3+k]+vertices[faces[id*3+2]*3+k])/3;
  function build(start, end) {
    const lo=[Infinity,Infinity,Infinity], hi=[-Infinity,-Infinity,-Infinity];
    for (let i=start;i<end;i++) for (let j=0;j<3;j++) for (let k=0;k<3;k++) {
      const v=vertices[faces[ids[i]*3+j]*3+k];lo[k]=Math.min(lo[k],v);hi[k]=Math.max(hi[k],v);
    }
    const node={lo,hi,start,end};
    if (end-start>8) {
      const span=hi.map((v,k)=>v-lo[k]), axis=span.indexOf(Math.max(...span));
      const sorted=ids.slice(start,end).sort((a,b)=>centres[a*3+axis]-centres[b*3+axis]);
      for(let i=0;i<sorted.length;i++)ids[start+i]=sorted[i];
      const mid=(start+end)>>1;node.left=build(start,mid);node.right=build(mid,end);
    }
    return node;
  }
  const root=build(0,ids.length);
  function hitBox(node,o,d,max) {
    let low=1e-5, high=max;
    for(let k=0;k<3;k++) {
      if(Math.abs(d[k])<1e-15){if(o[k]<node.lo[k]||o[k]>node.hi[k])return false;continue;}
      let a=(node.lo[k]-o[k])/d[k], b=(node.hi[k]-o[k])/d[k];
      if(a>b)[a,b]=[b,a];low=Math.max(low,a);high=Math.min(high,b);
      if(high<low)return false;
    }
    return true;
  }
  function trace(origin,direction,maxDistance=Infinity,any=false) {
    let distance=maxDistance, hit=-1;const stack=[root];
    while(stack.length) {
      const node=stack.pop();if(!hitBox(node,origin,direction,distance))continue;
      if(node.left){stack.push(node.left,node.right);continue;}
      for(let i=node.start;i<node.end;i++) {
        const id=ids[i],a=faces[id*3]*3,b=faces[id*3+1]*3,c=faces[id*3+2]*3;
        const e1x=vertices[b]-vertices[a],e1y=vertices[b+1]-vertices[a+1],e1z=vertices[b+2]-vertices[a+2];
        const e2x=vertices[c]-vertices[a],e2y=vertices[c+1]-vertices[a+1],e2z=vertices[c+2]-vertices[a+2];
        const px=direction[1]*e2z-direction[2]*e2y,py=direction[2]*e2x-direction[0]*e2z,pz=direction[0]*e2y-direction[1]*e2x;
        const det=e1x*px+e1y*py+e1z*pz;if(Math.abs(det)<1e-12)continue;
        const tx=origin[0]-vertices[a],ty=origin[1]-vertices[a+1],tz=origin[2]-vertices[a+2];
        const u=(tx*px+ty*py+tz*pz)/det;if(u<0||u>1)continue;
        const qx=ty*e1z-tz*e1y,qy=tz*e1x-tx*e1z,qz=tx*e1y-ty*e1x;
        const v=(direction[0]*qx+direction[1]*qy+direction[2]*qz)/det;if(v<0||u+v>1)continue;
        const t=(e2x*qx+e2y*qy+e2z*qz)/det;
        if(t>1e-5&&t<distance){if(any)return true;distance=t;hit=id;}
      }
    }
    if(any)return false;if(hit<0)return null;
    const a=point(faces[hit*3]),b=point(faces[hit*3+1]),c=point(faces[hit*3+2]);
    return {distance,position:origin.map((v,k)=>v+distance*direction[k]),normal:unit(cross(sub(b,a),sub(c,a)))};
  }
  return {trace, triangleCount:ids.length};
}

const cache=new WeakMap();
function basis(site) {
  const lat=site.latitude_deg*DEG,lon=site.longitude_deg*DEG;
  return [[-Math.sin(lon),Math.cos(lon),0],[-Math.sin(lat)*Math.cos(lon),-Math.sin(lat)*Math.sin(lon),Math.cos(lat)],
    [Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)]];
}

/** Build a continuous polar triangle surface from the supplied geodesic rays.
 * Angular stride controls explicit tessellation error; every radial sample is kept.
 * The innermost fan uses the measured site elevation, not invented missing data.
 */
export function prepareScattering(site, settings) {
  validateScattering(settings);
  if(settings.terrainReflectance===0)return null;
  const t=site.terrain,az=t?.azimuth_deg,dist=t?.distances_m;
  if(t?.kind!=='rays'||!Array.isArray(az)||az.length<3||!Array.isArray(dist)||!dist.length) {
    throw new TypeError('Scattered sunlight requires complete terrain rays; set terrain reflectance to zero for a fixed skyline.');
  }
  if(t.frame&&t.frame!=='MOON_ME_DE421')throw new RangeError('Scattering terrain must use MOON_ME_DE421.');
  const radius=t.radius_m??RADIUS,axes=basis(site);
  finite(radius,'Lunar radius',1000000,2000000);
  finite(site.ground_elevation_m,'Ground elevation',-100000,100000);
  finite(site.latitude_deg,'Latitude',-90,90);finite(site.longitude_deg,'Longitude',-360,360);
  finite(settings.heightM,'Panel height',0,1000);
  if(!Array.isArray(t.elevations_m)||t.elevations_m.length!==az.length)throw new TypeError('Incomplete scattering terrain.');
  az.forEach((a,i)=>{finite(a,'Azimuth',0,360-1e-10);if(i&&a<=az[i-1])throw new RangeError('Azimuths must increase.');});
  dist.forEach((d,i)=>{finite(d,'Terrain distance',Number.MIN_VALUE,radius*PI/2);if(i&&d<=dist[i-1])throw new RangeError('Distances must increase.');});
  const signature=[site.latitude_deg,site.longitude_deg,site.ground_elevation_m,radius,settings.scatterTerrainStride,
    settings.scatterResolution,settings.heightM,az.length,dist.length].join(':');
  let entry=cache.get(t),unchanged=entry?.signature===signature;
  // Compare source values as well as identity so in-place dataset edits are safe.
  const source=[...az,...dist];
  for(const row of t.elevations_m){if(!Array.isArray(row)||row.length!==dist.length)throw new TypeError('Incomplete scattering terrain row.');
    for(const z of row){finite(z,'Terrain elevation',-100000,100000);source.push(z);}}
  unchanged&&=source.length===entry.source.length&&source.every((v,i)=>v===entry.source[i]);
  if(unchanged)return entry.model;
  const selected=az.map((_,i)=>i).filter(i=>i%settings.scatterTerrainStride===0);
  if(selected.length<3)throw new RangeError('Scattering terrain stride leaves fewer than three bearings.');
  selected.forEach((i,k)=>{const next=az[selected[(k+1)%selected.length]]+(k===selected.length-1?360:0);
    if(next-az[i]>120)throw new RangeError('Scattering terrain has an uncovered azimuth sector.');});
  const groundRadius=radius+site.ground_elevation_m;
  const vertices=[0,0,0],faces=[];
  for(const i of selected)for(let j=0;j<dist.length;j++) {
    const r=radius+t.elevations_m[i][j],arc=dist[j]/radius,a=az[i]*DEG;
    vertices.push(r*Math.sin(arc)*Math.sin(a),r*Math.sin(arc)*Math.cos(a),r*Math.cos(arc)-groundRadius);
  }
  const at=(i,j)=>1+(i%selected.length)*dist.length+j;
  for(let i=0;i<selected.length;i++) {
    faces.push(0,at(i+1,0),at(i,0));
    for(let j=0;j<dist.length-1;j++)faces.push(at(i,j),at(i+1,j),at(i+1,j+1),at(i,j),at(i+1,j+1),at(i,j+1));
  }
  const tracer=createTerrainTracer(new Float64Array(vertices),new Uint32Array(faces));
  const view=reflectionView(tracer,[0,0,settings.heightM],settings.scatterResolution);
  const model={tracer,axes,groundRadius,radius,rangeM:dist.at(-1),...view,values:new Map(),
    triangleCount:tracer.triangleCount,receiverCount:view.receivers.length};
  cache.set(t,{signature,source,model});return model;
}

function inBasis(vector,axes) {
  return axes ? [0,1,2].map(k=>vector[0]*axes[0][k]+vector[1]*axes[1][k]+vector[2]*axes[2][k]) : vector;
}

function reflectionView(tracer,observer,n,panelBasis=null) {
  const directions=[],weights=[],receivers=[];
  for(let i=0;i<n;i++)for(let j=0;j<2*n;j++) {
    // Concentrate angular samples near the polar horizon. Integrate the actual
    // solid angle of each nonuniform z-band, rather than treating rays equally.
    const squash=u=>Math.sign(u)*u*u;
    const z=squash(-1+2*(i+.5)/n),weight=(squash(-1+2*(i+1)/n)-squash(-1+2*i/n))*PI/n;
    const a=2*PI*(j+.5)/(2*n),r=Math.sqrt(1-z*z);
    const direction=inBasis([r*Math.cos(a),r*Math.sin(a),z],panelBasis);directions.push(direction);
    weights.push(weight);
    const hit=tracer.trace(observer,direction);
    if(hit&&dot(hit.normal,direction)<0)receivers.push({...hit,direction,weight});
  }
  return {directions,weights,receivers,observerPositionM:observer,panelBasis};
}

/** Reuse one measured surface for another observer; all arguments use the
 * surface's reference ENU axes. The observer's radial basis rotates the panel.
 */
export function scatteringForObserver(surface,positionM,panelBasis,settings) {
  validateScattering(settings);
  if(!positionM.every(Number.isFinite)||positionM.length!==3)throw new TypeError('A finite observer position is required.');
  const view=reflectionView(surface.tracer,positionM,settings.scatterResolution,panelBasis);
  return {...surface,...view,receiverCount:view.receivers.length,values:new Map()};
}

function panelNormal(geometry,s) {
  const a=geometry.sunAzDeg*DEG,e=geometry.sunElDeg*DEG;
  if(s.panelMode==='tracking')return [Math.cos(e)*Math.sin(a),Math.cos(e)*Math.cos(a),Math.sin(e)];
  if(s.panelMode==='vertical_tracking')return [Math.sin(a),Math.cos(a),0];
  if(s.panelMode==='horizontal')return [0,0,1];
  if(s.panelMode!=='fixed')throw new RangeError('Unsupported panel mode.');
  const tilt=s.tiltDeg*DEG,az=s.azimuthDeg*DEG;
  return [Math.sin(tilt)*Math.sin(az),Math.sin(tilt)*Math.cos(az),Math.cos(tilt)];
}

function sphereBlocks(origin,direction,centre,radius,maxDistance=Infinity) {
  const v=sub(origin,centre),b=dot(v,direction),c=dot(v,v)-radius*radius,d=b*b-c;
  if(d<0)return false;const root=Math.sqrt(d),near=-b-root,far=-b+root;
  return far>1e-4&&near<maxDistance;
}

function localBody(model,positionKm) {
  if(!positionKm)return null;
  const p=model.axes.map(axis=>dot(axis,positionKm)*1000);p[2]-=model.groundRadius;return p;
}

function blockedSolarRay(model,origin,ray,distance,earthLocal) {
  if(earthLocal&&sphereBlocks(origin,ray,earthLocal,EARTH_RADIUS,distance))return true;
  if(model.tracer.trace(origin,ray,distance,true))return true;
  const centre=[0,0,-model.groundRadius],v=sub(origin,centre),b=dot(v,ray);
  const disc=b*b-dot(v,v)+model.radius*model.radius;
  if(disc>=0) {
    const far=-b+Math.sqrt(disc),near=-b-Math.sqrt(disc);
    for(const t of [near,far])if(t>1e-4) {
      const p=origin.map((x,j)=>x+t*ray[j]);
      const arc=Math.atan2(Math.hypot(p[0],p[1]),p[2]+model.groundRadius)*model.radius;
      if(arc>=model.rangeM)return true;
    }
  }
  return false;
}

function visibleSolarFraction(model,origin,s,distance,count,earthLocal) {
  const tangent=unit(cross(s,Math.abs(s[2])<.9?[0,0,1]:[1,0,0])),bitangent=cross(s,tangent);
  const solarRadius=Math.asin(SUN_RADIUS/distance);let visible=0;
  for(let k=0;k<count;k++) {
    const r=count===1?0:Math.sqrt((k+.5)/count)*Math.tan(solarRadius),a=k*PI*(3-Math.sqrt(5));
    const ray=unit(s.map((v,j)=>v+r*(Math.cos(a)*tangent[j]+Math.sin(a)*bitangent[j])));
    if(!blockedSolarRay(model,origin,ray,distance,earthLocal))visible++;
  }
  return visible/count;
}

/** Direct irradiance at a mapped observer using the same triangle surface and
 * sampled solar disc as the reflected-light calculation. Already panel-projected.
 */
export function tracedDirectIrradiance(model,geometry,settings) {
  const sun=localBody(model,geometry.sunPositionKm),earth=localBody(model,geometry.earthPositionKm);
  const origin=model.observerPositionM,toSun=sub(sun,origin),distance=Math.hypot(...toSun),s=unit(toSun);
  const incidence=Math.max(0,dot(inBasis(panelNormal(geometry,settings),model.panelBasis),s));
  if(!incidence)return 0;
  return 1361*(AU/distance)**2*incidence*visibleSolarFraction(model,origin,s,distance,settings.scatterSunSamples,earth);
}

/** Radiance integrated over the panel's visible solid angle. Returned W/m² is
 * already projected onto the active panel face. Apply area/efficiency/loss once.
 * Each receiver tests its own solar rays and optional Earth occultation.
 */
export function scatteredIrradiance(model,geometry,settings) {
  if(!model||settings.terrainReflectance===0)return 0;
  const normal=inBasis(panelNormal(geometry,settings),model.panelBasis),sunGlobal=geometry.sunPositionKm.map(v=>v*1000);
  const sun=model.axes.map(axis=>dot(axis,sunGlobal));sun[2]-=model.groundRadius;
  const earth=geometry.earthPositionKm?.map(v=>v*1000);
  const earthLocal=earth?model.axes.map(axis=>dot(axis,earth)):null;
  if(earthLocal)earthLocal[2]-=model.groundRadius;
  const key=[...sun,...(earthLocal??[]),...normal,settings.scatterSunSamples].join(':');
  if(model.values.has(key))return settings.terrainReflectance*model.values.get(key);
  // Normalize the directional quadrature so constant radiance integrates to pi,
  // and the one-bounce reflected irradiance cannot exceed rho * incident flux.
  const normalization=model.directions.reduce((sum,d,i)=>sum+model.weights[i]*Math.max(0,dot(normal,d)),0);
  let sum=0;
  for(const patch of model.receivers) {
    const facing=Math.max(0,dot(normal,patch.direction));if(!facing)continue;
    const toSun=sub(sun,patch.position),distance=Math.hypot(...toSun),s=toSun.map(v=>v/distance);
    const incidence=Math.max(0,dot(patch.normal,s));if(!incidence)continue;
    const origin=patch.position.map((v,k)=>v+patch.normal[k]*.001);
    const visible=visibleSolarFraction(model,origin,s,distance,settings.scatterSunSamples,earthLocal);
    sum+=patch.weight*facing*1361*(AU/distance)**2*incidence*visible;
  }
  const result=sum/normalization;
  if(model.values.size>=4096)model.values.delete(model.values.keys().next().value);
  model.values.set(key,result);return settings.terrainReflectance*result;
}
