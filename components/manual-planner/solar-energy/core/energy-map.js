/** Spatial energy survey over one prepared terrain surface; never adopts a site.
 * Every grid node is ray-traced. No interpolation between the three study sites.
 */
import {DEFAULT_SETTINGS,solarGeometry,panelIncidence} from './solar-model.js';
import {prepareScattering,scatteringForObserver,scatteredIrradiance,tracedDirectIrradiance} from './scattered-light.js';

const DEG=Math.PI/180;
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
function bounded(v,name,min,max) {
  if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new RangeError(`${name} must be between ${min} and ${max}.`);
  return v;
}
function axesFor(latDeg,lonDeg) {
  const lat=latDeg*DEG,lon=lonDeg*DEG;
  return [[-Math.sin(lon),Math.cos(lon),0],[-Math.sin(lat)*Math.cos(lon),-Math.sin(lat)*Math.sin(lon),Math.cos(lat)],
    [Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)]];
}

export async function computeEnergyMap(bundle,requested={},options={},onProgress=()=>{},cancelled=()=>false) {
  const settings={...DEFAULT_SETTINGS,...requested};
  const site=bundle.sites?.find(s=>s.id===settings.siteId);
  if(!site)throw new RangeError('Choose a prepared site for the energy map.');
  const size=bounded(options.gridSize??21,'Map grid size',3,41);
  if(!Number.isInteger(size)||size%2!==1)throw new RangeError('Map grid size must be an odd integer.');
  const extentM=bounded(options.extentM??3000,'Map width (m)',100,3000);
  const stepMinutes=bounded(options.stepMinutes??30,'Map time step (minutes)',1,120);
  bounded(settings.durationHours,'Duration (hours)',1/60,168);
  bounded(settings.heightM,'Panel height (m)',.01,1000);
  bounded(settings.areaM2,'Panel area (m²)',0,1e6);
  bounded(settings.efficiency,'Conversion efficiency',0,1);bounded(settings.lossFactor,'Retained output',0,1);
  bounded(settings.tiltDeg,'Panel tilt',0,180);bounded(settings.azimuthDeg,'Panel azimuth',0,360);
  panelIncidence(0,0,settings);
  const mapSettings={...settings,scatterResolution:options.scatterResolution??8,
    scatterSunSamples:options.sunSamples??7,scatterTerrainStride:options.terrainStride??4};
  const intervals=Math.ceil(settings.durationHours*60/stepMinutes);
  if(size*size*(intervals+1)>350000)throw new RangeError('This map is too large. Choose a coarser grid or a longer map time step.');
  const start=Date.parse(settings.startUTC),end=start+settings.durationHours*3600000;
  // Validate the complete time window before allocating a surface or returning cells.
  solarGeometry(bundle,site,settings.startUTC,settings.heightM);
  solarGeometry(bundle,site,new Date(end).toISOString(),settings.heightM);
  if(Math.SQRT2*extentM/2>site.terrain.distances_m?.at(-1))throw new RangeError('The map extends outside prepared terrain coverage.');
  onProgress({fraction:0,completed:0,total:size*size,phase:'Preparing terrain'});
  // The same surface is needed for direct shadows even if reflectance is zero.
  const surface=prepareScattering(site,{...mapSettings,terrainReflectance:Math.max(mapSettings.terrainReflectance,1e-12)});
  const times=Array.from({length:intervals+1},(_,i)=>i===intervals?end:start+i*stepMinutes*60000);
  const cells=[],spacingM=extentM/(size-1);
  let bestIndex=null;
  for(let row=0;row<size;row++)for(let col=0;col<size;col++) {
    if(cancelled())throw new Error('Energy map cancelled.');
    const x=-extentM/2+col*spacingM,y=extentM/2-row*spacingM;
    const hit=surface.tracer.trace([x,y,200000],[0,0,-1],400000);
    let cell={row,col,eastM:x,northM:y,valid:false,totalKWhM2:null,directKWhM2:null,reflectedKWhM2:null};
    if(hit) {
      const radial=[...hit.position];radial[2]+=surface.groundRadius;
      const r=Math.hypot(...radial),up=radial.map(v=>v/r);
      const global=[0,1,2].map(k=>radial.reduce((v,p,j)=>v+p*surface.axes[j][k],0));
      const latitudeDeg=Math.atan2(global[2],Math.hypot(global[0],global[1]))/DEG,longitudeDeg=Math.atan2(global[1],global[0])/DEG;
      const groundElevationM=r-surface.radius,observer=hit.position.map((v,k)=>v+settings.heightM*up[k]);
      const panelBasis=axesFor(latitudeDeg,longitudeDeg).map(axis=>surface.axes.map(reference=>dot(axis,reference)));
      const model=scatteringForObserver(surface,observer,panelBasis,mapSettings);
      const observerSite={latitude_deg:latitudeDeg,longitude_deg:longitudeDeg,ground_elevation_m:groundElevationM,terrain:{radius_m:surface.radius}};
      let directWhM2=0,reflectedWhM2=0,previous=null;
      for(const time of times) {
        const geometry=solarGeometry(bundle,observerSite,new Date(time).toISOString(),settings.heightM);
        const direct=tracedDirectIrradiance(model,geometry,mapSettings),reflected=scatteredIrradiance(model,geometry,mapSettings);
        if(!Number.isFinite(direct)||!Number.isFinite(reflected))throw new Error('Non-finite energy-map irradiance.');
        if(previous) {
          const hours=(time-previous.time)/3600000;
          directWhM2+=(direct+previous.direct)*hours/2;
          reflectedWhM2+=(reflected+previous.reflected)*hours/2;
        }
        previous={time,direct,reflected};
      }
      const conversion=settings.efficiency*settings.lossFactor/1000;
      const directKWhM2=directWhM2*conversion,reflectedKWhM2=reflectedWhM2*conversion;
      cell={...cell,valid:true,latitudeDeg,longitudeDeg,groundElevationM,directKWhM2,reflectedKWhM2,
        totalKWhM2:directKWhM2+reflectedKWhM2};
      if(bestIndex===null||cell.totalKWhM2>cells[bestIndex].totalKWhM2)bestIndex=cells.length;
    }
    cells.push(cell);
    onProgress({fraction:cells.length/(size*size),completed:cells.length,total:size*size,phase:'Tracing direct and reflected sunlight'});
    // Yield between nodes for progress and cancellation, including direct fallback.
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  const valid=cells.filter(c=>c.valid);
  if(!valid.length)throw new Error('No mapped terrain samples are available in this footprint.');
  return {schema:'lunashift-energy-map-1',site:{id:site.id,name:site.name,latitudeDeg:site.latitude_deg,longitudeDeg:site.longitude_deg},
    settings,grid:{size,extentM,spacingM,rowOrder:'north_to_south',coordinates:'local east/north metres at the prepared site'},
    sampling:{stepMinutes,timeSamples:times.length,scatterResolution:mapSettings.scatterResolution,
      sunSamples:mapSettings.scatterSunSamples,terrainStride:mapSettings.scatterTerrainStride},
    startUTC:new Date(start).toISOString(),endUTC:new Date(end).toISOString(),unit:'kWh/m² electrical',cells,bestIndex,
    statistics:{min:Math.min(...valid.map(c=>c.totalKWhM2)),max:Math.max(...valid.map(c=>c.totalKWhM2)),validCount:valid.length},
    provenance:{frame:'MOON_ME_DE421',sources:site.terrain.source_urls??[],sourceSite:site.id,
      model:'Ray-traced direct sunlight + single-bounce Lambertian reflection',terrainRangeM:surface.rangeM,
      note:'Spatial survey of the prepared ray-derived surface; map sampling differs from the single-site mission. No landing safety or whole-Moon coverage claim.'}};
}

export function energyMapCSV(map) {
  const header='east_m,north_m,latitude_deg,longitude_deg,ground_elevation_m,total_kWh_m2,direct_kWh_m2,reflected_kWh_m2,panel_energy_kWh,valid,start_utc,end_utc,spacing_m,step_minutes,panel_height_m,reflectance';
  return [header,...map.cells.map(c=>[c.eastM,c.northM,c.latitudeDeg??'',c.longitudeDeg??'',c.groundElevationM??'',
    c.totalKWhM2??'',c.directKWhM2??'',c.reflectedKWhM2??'',c.valid?c.totalKWhM2*map.settings.areaM2:'',c.valid,
    map.startUTC,map.endUTC,map.grid.spacingM,map.sampling.stepMinutes,map.settings.heightM,map.settings.terrainReflectance].join(','))].join('\n');
}
