import {computeEnergyMap,energyMapCSV} from './core/energy-map.js';
import {prepareTerrainRelief,sampleTerrainRelief,reliefColor} from './terrain-relief.js';

const $=id=>document.getElementById(id);
const fields={total:'totalKWhM2',direct:'directKWhM2',reflected:'reflectedKWhM2'};
const names={total:'Direct + reflected',direct:'Direct sunlight',reflected:'Terrain-reflected sunlight'};
const stops=[[53,42,135],[15,92,221],[8,145,211],[0,176,191],[67,183,147],[148,190,113],[239,202,83],[249,251,14]];
const number=(v,d=3)=>(Number(v)===0?0:Number(v)).toLocaleString('en-GB',{maximumFractionDigits:d});
const utc=t=>t.slice(0,16).replace('T',' ')+' UTC';
const key=s=>JSON.stringify(s);

export function energyColor(value,max) {
  return `rgb(${energyRGB(value,max).join(',')})`;
}
function energyRGB(value,max) {
  const t=max>0?Math.max(0,Math.min(1,value/max)):0,p=t*(stops.length-1),i=Math.min(stops.length-2,Math.floor(p)),f=p-i;
  return stops[i].map((v,j)=>Math.round(v+(stops[i+1][j]-v)*f));
}

/** Display interpolation only. Never changes exported or inspected node values.
 * Missing corners with nonzero weight leave a gap, rather than invent coverage.
 */
export function mapDisplayValue(map,field,col,row,smooth=true) {
  const n=map.grid.size,x=Math.max(0,Math.min(n-1,col)),y=Math.max(0,Math.min(n-1,row));
  if(!smooth){const c=map.cells[Math.round(y)*n+Math.round(x)];return c.valid?c[field]:null;}
  const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(x0+1,n-1),y1=Math.min(y0+1,n-1),fx=x-x0,fy=y-y0;
  const corners=[[x0,y0,(1-fx)*(1-fy)],[x1,y0,fx*(1-fy)],[x0,y1,(1-fx)*fy],[x1,y1,fx*fy]];
  let value=0;
  for(const [cx,cy,w]of corners){if(w===0)continue;const c=map.cells[cy*n+cx];if(!c.valid)return null;value+=w*c[field];}
  return value;
}

const rasters=new WeakMap();
function mapRaster(map,field,max,smooth,pixels,relief,surface) {
  let cached=rasters.get(map);if(!cached||cached.relief!==relief){cached={relief,images:new Map()};rasters.set(map,cached);}
  const cache=cached.images,key=`${field}:${smooth}:${pixels}:${surface}`;if(cache.has(key))return cache.get(key);
  const raster=document.createElement('canvas');raster.width=raster.height=pixels;
  const ctx=raster.getContext('2d'),data=ctx.createImageData(pixels,pixels),n=map.grid.size;
  for(let y=0;y<pixels;y++)for(let x=0;x<pixels;x++){
    const value=mapDisplayValue(map,field,x/(pixels-1)*(n-1),y/(pixels-1)*(n-1),smooth);
    let rgb=value===null?[224,226,229]:energyRGB(value,max);
    if(surface!=='energy'){
      const shade=sampleTerrainRelief(relief,(x/(pixels-1)-.5)*map.grid.extentM,(.5-y/(pixels-1))*map.grid.extentM);
      if(surface==='terrain'||value!==null)rgb=reliefColor(rgb,shade,surface==='terrain');
    }
    const offset=(y*pixels+x)*4;
    data.data[offset]=rgb[0];data.data[offset+1]=rgb[1];data.data[offset+2]=rgb[2];data.data[offset+3]=255;
  }
  ctx.putImageData(data,0,0);cache.set(key,raster);return raster;
}

/** Shared scientific-figure renderer for the interactive map and PNG. */
export function drawEnergyMap(canvas,map,layer='total',selected=null,exporting=false,display='smooth',relief=null,surface='relief') {
  if(!relief)surface='energy';
  const terrainOnly=surface==='terrain',withRelief=surface==='relief';
  const width=exporting?1200:Math.max(280,canvas.getBoundingClientRect().width),scale=exporting?1:Math.min(devicePixelRatio||1,2);
  const compact=width<480,pad=exporting?90:compact?40:60,right=exporting?150:compact?70:102;
  const top=exporting?130:compact?62:78,plot=width-pad-right,bottom=exporting?174:80,height=top+plot+bottom,smooth=display==='smooth';
  canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);if(!exporting)canvas.style.height=height+'px';
  const ink=exporting?'#222':'#f1f5ff';
  const surfaceBg=typeof getComputedStyle==='function'?(getComputedStyle(canvas).getPropertyValue('--surface').trim()||'#162132'):'#162132';
  const ctx=canvas.getContext('2d');ctx.scale(scale,scale);ctx.fillStyle=exporting?'#fff':surfaceBg;ctx.fillRect(0,0,width,height);
  const field=fields[layer],values=map.cells.filter(c=>c.valid).map(c=>c[field]),max=Math.max(0,...values),n=map.grid.size,step=plot/(n-1);
  ctx.textAlign='center';ctx.fillStyle=ink;ctx.font=`700 ${exporting?36:compact?19:26}px Arial, sans-serif`;
  ctx.fillText(terrainOnly?'Terrain relief':'Solar energy',pad+plot/2,exporting?42:28);
  ctx.font=`${exporting?19:compact?11:14}px Arial, sans-serif`;
  ctx.fillText(terrainOnly?`${relief.spacing} m LOLA elevation grid`:names[layer],pad+plot/2,exporting?70:compact?46:49);
  if(exporting){ctx.font='17px Arial, sans-serif';ctx.fillText(terrainOnly?`${map.site.name} · local prepared LOLA terrain`:
    `${map.site.name} · ${utc(map.startUTC)} — ${utc(map.endUTC)}`,width/2,101);}
  ctx.save();ctx.beginPath();ctx.rect(pad,top,plot,plot);ctx.clip();
  ctx.imageSmoothingEnabled=false;
  ctx.drawImage(mapRaster(map,field,max,smooth,exporting?1024:512,relief,surface),pad,top,plot,plot);
  // Topographic contours communicate terrain shape without altering the colour scale.
  const heights=map.cells.filter(c=>c.valid).map(c=>c.groundElevationM),hmin=Math.min(...heights),hmax=Math.max(...heights);
  const contourStep=Math.max(25,Math.ceil((hmax-hmin)/8/25)*25);
  ctx.strokeStyle='rgba(255,255,255,.18)';ctx.lineWidth=.7;
  for(let h=Math.ceil(hmin/contourStep)*contourStep;surface==='energy'&&h<hmax;h+=contourStep)for(let row=0;row<n-1;row++)for(let col=0;col<n-1;col++) {
    const corners=[map.cells[row*n+col],map.cells[row*n+col+1],map.cells[(row+1)*n+col+1],map.cells[(row+1)*n+col]];
    if(corners.some(c=>!c.valid))continue;const intersections=[];
    for(let j=0;j<4;j++){const a=corners[j],b=corners[(j+1)%4];if((a.groundElevationM<h)===(b.groundElevationM<h))continue;
      const f=(h-a.groundElevationM)/(b.groundElevationM-a.groundElevationM);intersections.push([pad+(a.col+(b.col-a.col)*f)*step,top+(a.row+(b.row-a.row)*f)*step]);}
    for(let j=0;j+1<intersections.length;j+=2){ctx.beginPath();ctx.moveTo(...intersections[j]);ctx.lineTo(...intersections[j+1]);ctx.stroke();}
  }
  const centre=pad+plot/2,cy=top+plot/2;
  ctx.strokeStyle='rgba(255,255,255,.9)';ctx.lineWidth=exporting?2:1.2;ctx.setLineDash(exporting?[7,6]:[4,4]);
  ctx.beginPath();ctx.moveTo(centre,top);ctx.lineTo(centre,top+plot);ctx.moveTo(pad,cy);ctx.lineTo(pad+plot,cy);ctx.stroke();ctx.setLineDash([]);
  const marker=exporting?34:compact?14:22;
  ctx.lineWidth=exporting?5:3;ctx.strokeStyle='#4b3300';ctx.strokeRect(centre-marker/2,cy-marker/2,marker,marker);
  ctx.lineWidth=exporting?3:2;ctx.strokeStyle='#ffae00';ctx.strokeRect(centre-marker/2,cy-marker/2,marker,marker);
  ctx.textAlign='left';ctx.font=`600 ${exporting?27:compact?12:16}px Arial, sans-serif`;
  const label=map.site.name.split('·').at(-1).trim();
  ctx.lineWidth=exporting?3:2;ctx.strokeStyle='#383131';ctx.strokeText(label,centre+marker/2+5,cy-marker/2-5);
  ctx.fillStyle='#ffae00';ctx.fillText(label,centre+marker/2+5,cy-marker/2-5);
  if(selected!==null&&selected!==Math.floor(n*n/2)){const c=map.cells[selected],x=pad+c.col*step-step*.4,y=top+c.row*step-step*.4;
    ctx.strokeStyle='#122c29';ctx.lineWidth=4;ctx.strokeRect(x,y,step*.8,step*.8);
    ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.strokeRect(x,y,step*.8,step*.8);}
  ctx.restore();ctx.strokeStyle=ink;ctx.lineWidth=1;ctx.strokeRect(pad,top,plot,plot);
  ctx.font=`${exporting?22:compact?11:14}px Arial, sans-serif`;ctx.fillStyle=ink;ctx.textAlign='center';
  const tickCount=compact?2:6;
  for(let i=0;i<=tickCount;i++) {
    const fraction=i/tickCount,label=(fraction-.5)*map.grid.extentM/1000;
    ctx.fillText(number(label,2),pad+fraction*plot,top+plot+(exporting?30:19));
    ctx.textAlign='right';ctx.fillText(number(-label,2),pad-7,top+fraction*plot+(exporting?7:4));ctx.textAlign='center';
  }
  ctx.font=`${exporting?24:compact?12:16}px Arial, sans-serif`;ctx.fillText('East (km)',pad+plot/2,top+plot+(exporting?60:39));
  ctx.save();ctx.translate(exporting?24:compact?11:16,top+plot/2);ctx.rotate(-Math.PI/2);ctx.fillText('North (km)',0,0);ctx.restore();
  const legendX=pad+plot+(exporting?37:compact?13:24),legendW=exporting?36:compact?13:20;
  for(let i=0;i<Math.ceil(plot);i++){
    const shade=1-i/(Math.ceil(plot)-1);
    ctx.fillStyle=terrainOnly?`rgb(${reliefColor([0,0,0],shade,true).join(',')})`:energyColor(shade*max,max);
    ctx.fillRect(legendX,top+i,legendW,1.1);
  }
  ctx.strokeStyle=ink;ctx.strokeRect(legendX,top,legendW,plot);ctx.fillStyle=ink;ctx.textAlign='center';
  ctx.font=`${exporting?18:10}px Arial, sans-serif`;ctx.fillText(terrainOnly?'Relief':'kWh/m²',legendX+legendW/2,top-10);
  ctx.font=`${exporting?20:compact?10:12}px Arial, sans-serif`;ctx.textAlign='left';
  const divisions=compact?4:8;
  for(let i=0;i<=divisions;i++){
    const y=top+plot*(1-i/divisions);ctx.beginPath();ctx.moveTo(legendX+legendW-4,y);ctx.lineTo(legendX+legendW,y);ctx.stroke();
    ctx.fillText(number((terrainOnly?1:max)*i/divisions,3),legendX+legendW+5,y+(exporting?6:3));
  }
  ctx.textAlign='center';ctx.font=`${exporting?17:compact?10:12}px Arial, sans-serif`;
  ctx.fillText(terrainOnly?'Illustrative northwest lighting':`${smooth?'Interpolated':'Sample cells'} · ${map.grid.spacingM} m energy${withRelief?` · ${relief.spacing} m DEM`:''}`,pad+plot/2,top+plot+(exporting?93:63));
  if(exporting){ctx.textAlign='left';ctx.font='15px Arial, sans-serif';
    ctx.fillText(terrainOnly?`${map.grid.extentM/1000} × ${map.grid.extentM/1000} km · ${relief.spacing} m DEM samples · local east/north · grayscale = illustrative shading`:
      `Electrical energy · ${map.sampling.stepMinutes} min time step · ${map.settings.heightM} m panel height · reflectance ${map.settings.terrainReflectance}`,pad,top+plot+126);
    ctx.fillText(surface==='energy'?'Local prepared terrain · display smoothing adds no terrain detail · gray = no coverage':
      `${relief.spacing} m DEM relief · fixed northwest lighting for terrain shape, not physical Sun illumination${withRelief?' · hue = energy; brightness = relief':''}`,pad,top+plot+152);}
  canvas._mapPlot={left:pad,top,size:plot,width,height};
}

export class EnergyMapView {
  constructor(getBundle) {
    this.controller=new AbortController();this.getBundle=getBundle;this.result=null;this.plan=null;this.sequence=0;this.worker=null;this.selected=null;
    $('generateEnergyMap').onclick=()=>this.generate();$('cancelEnergyMap').onclick=()=>this.cancel();
    $('energyMapLayer').onchange=()=>this.render();
    $('energyMapDisplay').onchange=()=>this.render();
    $('energyMapSurface').onchange=()=>this.render();
    $('energyMapPNG').onclick=()=>{const c=document.createElement('canvas');drawEnergyMap(c,this.result,$('energyMapLayer').value,this.selected,true,$('energyMapDisplay').value,this.relief,$('energyMapSurface').value);
      c.toBlob(blob=>this.download(blob,'png'));};
    $('energyMapCSV').onclick=()=>this.download(new Blob([energyMapCSV(this.result)],{type:'text/csv;charset=utf-8'}),'csv');
    $('viewEnergyMap').onclick=()=>{$('energyMapSection').open=true;$('energyMapSection').scrollIntoView({behavior:'smooth',block:'start'});};
    $('energyMapSection').addEventListener('toggle',()=>{if($('energyMapSection').open)this.render();},{signal:this.controller.signal});
    $('energyMapCanvas').onclick=e=>{if(!this.result)return;const c=e.currentTarget,r=c.getBoundingClientRect(),p=c._mapPlot;
      const x=(e.clientX-r.left)*p.width/r.width,y=(e.clientY-r.top)*p.height/r.height;
      if(x<p.left||y<p.top||x>p.left+p.size||y>p.top+p.size)return;
      const n=this.result.grid.size;this.selected=Math.round((y-p.top)/p.size*(n-1))*n+Math.round((x-p.left)/p.size*(n-1));this.render();};
    $('energyMapCanvas').onkeydown=e=>{if(!this.result)return;const n=this.result.grid.size,index=this.selected??Math.floor(n*n/2);
      let row=Math.floor(index/n),col=index%n;if(e.key==='ArrowUp')row--;else if(e.key==='ArrowDown')row++;else if(e.key==='ArrowLeft')col--;else if(e.key==='ArrowRight')col++;else return;
      e.preventDefault();this.selected=Math.max(0,Math.min(n-1,row))*n+Math.max(0,Math.min(n-1,col));this.render();};
    this.resize=new ResizeObserver(()=>{if($('energyMapSection').open)this.render();});this.resize.observe($('energyMapBody'));
  }
  setPlan(plan,role='Current plan') {
    if(this.plan&&key(this.plan.settings)!==key(plan.settings)) {
      this.cancel();this.result=null;$('energyMapBody').hidden=true;$('energyMapEmpty').hidden=false;
      $('energyMapPNG').disabled=true;$('energyMapCSV').disabled=true;
      $('energyMapStatus').textContent='Plan changed. Generate a map for the inspected plan.';
    }
    this.plan=plan;
    $('generateEnergyMap').disabled=this.running||false;
    $('energyMapStatus').classList.remove('map-error');
    const mesh=this.getBundle()?.sites.find(s=>s.id===plan.site.id)?.mesh;
    if(mesh!==this.mesh){this.mesh=mesh;this.relief=prepareTerrainRelief(mesh);}
    $('energyMapSurface').disabled=!this.relief;
    if(!this.relief)$('energyMapSurface').value='energy';
    $('energyMapContext').textContent=`${role} · ${plan.site.name} · ${utc(plan.settings.startUTC)} · ${plan.settings.durationHours} h · ${plan.settings.heightM} m panel height`;
  }
  setBusy(busy) {
    this.running=busy;$('generateEnergyMap').disabled=busy||!this.plan;$('cancelEnergyMap').hidden=!busy;
    $('energyMapProgress').hidden=!busy;$('energyMapSection').setAttribute('aria-busy',String(busy));
  }
  cancel() {
    this.sequence++;this.worker?.terminate();this.worker=null;this.reject?.(new Error('Cancelled'));this.reject=null;
    if(this.running)$('energyMapStatus').textContent='Calculation cancelled. You can generate a new map.';
    this.setBusy(false);
  }
  async generate() {
    if(!this.plan||this.running)return;
    const sequence=++this.sequence,settings={...this.plan.settings,terrainReflectance:this.plan.settings.terrainReflectance??0.12};
    const options={gridSize:+$('energyMapGrid').value,stepMinutes:+$('energyMapStep').value};
    this.setBusy(true);$('energyMapStatus').textContent='Preparing terrain…';$('energyMapProgress').value=0;
    const progress=p=>{if(sequence!==this.sequence)return;$('energyMapProgress').value=p.fraction;
      $('energyMapStatus').textContent=`${p.phase} · ${p.completed} / ${p.total} points`;$('energyMapStatus').classList.remove('map-error');};
    try {
      let result;
      if(typeof Worker==='undefined')result=await computeEnergyMap(this.getBundle(),settings,options,progress,()=>sequence!==this.sequence);
      else result=await new Promise((resolve,reject)=>{
        this.reject=reject;const worker=new Worker(new URL('./energy-map-worker.js',import.meta.url),{type:'module'});this.worker=worker;
        worker.onerror=()=>reject(new Error('Background calculation failed. Regenerate the map or reload the app.'));
        worker.onmessage=({data:m})=>{if(m.progress!==undefined){progress(m.detail);return;}if(!m.ok){reject(new Error(m.error));return;}
          if(m.id===0)worker.postMessage({id:1,type:'energyMap',settings,options});else resolve(m.result);};
        worker.postMessage({id:0,type:'init',bundle:this.getBundle()});
      });
      if(sequence!==this.sequence)return;
      this.result=result;this.selected=Math.floor(result.cells.length/2);
      $('energyMapEmpty').hidden=true;$('energyMapBody').hidden=false;$('energyMapPNG').disabled=false;$('energyMapCSV').disabled=false;
      $('energyMapStatus').textContent=result.statistics.max===0?'No solar energy in this sampled window.':`${result.statistics.validCount} points calculated · ${result.grid.spacingM} m spacing · ${result.sampling.stepMinutes} min time step`;
      this.render();
    } catch(error) {
      if(sequence===this.sequence){$('energyMapStatus').textContent=error.message;$('energyMapStatus').classList.add('map-error');}
    } finally {
      if(sequence===this.sequence){this.worker?.terminate();this.worker=null;this.reject=null;this.setBusy(false);}
    }
  }
  render() {
    if(!this.result||$('energyMapBody').hidden)return;
    const map=this.result,c=map.cells[this.selected],layer=$('energyMapLayer').value,field=fields[layer];
    const surface=$('energyMapSurface').value;
    drawEnergyMap($('energyMapCanvas'),map,layer,this.selected,false,$('energyMapDisplay').value,this.relief,surface);
    $('energyMapTerrainNote').textContent=!this.relief?'Terrain relief is unavailable for this site.':surface==='energy'?
      'Energy-only colors match the color bar directly. Switch to Energy + relief or Terrain only to inspect the 20 m elevation grid.':
      `${this.relief.spacing} m LOLA terrain relief uses fixed northwest lighting for map reading, not simulated sunlight.${surface==='relief'?' Hue shows energy; brightness shows terrain. Use Energy only for exact color-bar comparison.':' The grayscale scale shows illustrative shading, not elevation or energy.'}`;
    $('energyMapRange').textContent=surface==='terrain'?`Terrain relief · ${this.relief.spacing} m elevation grid`:
      `${names[layer]} · 0–${number(Math.max(...map.cells.filter(c=>c.valid).map(c=>c[field])))} kWh/m²`;
    $('energyMapSelected').textContent=c?.valid?`${number(c.eastM,0)} m east · ${number(c.northM,0)} m north`:'No terrain coverage at this point';
    $('energyMapTotal').textContent=c?.valid?number(c.totalKWhM2,4):'—';
    $('energyMapDirect').textContent=c?.valid?`${number(c.directKWhM2,4)} kWh/m²`:'—';
    $('energyMapReflected').textContent=c?.valid?`${number(c.reflectedKWhM2,5)} kWh/m²`:'—';
    $('energyMapPanel').textContent=c?.valid?`${number(c.totalKWhM2*map.settings.areaM2,3)} kWh for ${map.settings.areaM2} m²`:'—';
    $('energyMapCoordinates').textContent=c?.valid?`${c.latitudeDeg.toFixed(5)}° lat, ${c.longitudeDeg.toFixed(5)}° lon · ${number(c.groundElevationM,1)} m elevation`:'Missing terrain is not treated as an unobstructed view.';
    $('energyMapAssumptions').textContent=`${map.settings.panelMode.replaceAll('_',' ')} · ${Math.round(map.settings.efficiency*100)}% efficiency · ${map.settings.terrainReflectance} reflectance. ${map.sampling.scatterResolution**2*2} reflected-light directions per point; ${map.sampling.sunSamples} solar-disc samples.`;
  }
  destroy() {
    this.cancel();this.controller.abort();this.resize.disconnect();
  }
  download(blob,extension) {
    if(!blob)return;
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`LunaShift_energy_${this.result.site.id}_${this.result.startUTC.slice(0,10)}.${extension}`;
    a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
}
