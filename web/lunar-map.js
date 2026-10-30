'use strict';
/* NASA WMTS client. No terrestrial Mercator and no fabricated image fallback.
   v0.5.0: decimal dimensions; serialized connection state; bounded reads;
   direct-browser fallback; correct empty-state handling and out-of-map clicks. */
const MOON_MAP_SOURCES = {
  imagery:{name:'LROC surface imagery',projection:'eq',url:'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/WMTSCapabilities.xml',description:'Historical LROC image mosaic. This is not a photograph of the selected date. Equirectangular shapes stretch near the poles.'},
  illumination:{name:'South-pole observed mean sunlight',projection:'sp',url:'https://trek.nasa.gov/tiles/Moon/SP/WAC_POLE_ILL_PCT_SOUTH_100M/1.0.0/WMTSCapabilities.xml',description:'WAC observation-based illumination percentage, 88–90°S. A historical average, not the sunlight at your selected time.'},
  earth:{name:'South-pole mean Earth visibility',projection:'sp',url:'https://trek.nasa.gov/tiles/Moon/SP/AVGVISIB_85S_060M_201608_EARTH_SP/1.0.0/WMTSCapabilities.xml',description:'Long-term terrain-based Earth-visibility context near the south pole. Not a ground-station schedule or mission-time prediction.'}
};
const NASA_TEXTURE_URL='https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg';
function wmtsFromXml(text,config){
  if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('Unsupported XML entities in map description.');
  const root=new DOMParser().parseFromString(text,'application/xml');
  if(root.querySelector('parsererror'))throw new Error('NASA returned an invalid map description.');
  const children=(n,name)=>[...(n?.children||[])].filter(x=>x.localName===name);
  const first=(n,name)=>children(n,name)[0];const value=(n,name)=>first(n,name)?.textContent.trim();
  const contents=first(root.documentElement,'Contents'),layer=first(contents,'Layer');
  if(!layer)throw new Error('No map layer in the service response.');
  const resource=children(layer,'ResourceURL').find(x=>x.getAttribute('resourceType')==='tile');
  const template=(resource?.getAttribute('template')||'').replace('http://trek.nasa.gov/','https://trek.nasa.gov/');
  const url=new URL(template);if(url.protocol!=='https:'||url.hostname!=='trek.nasa.gov'||!url.pathname.startsWith('/tiles/'))throw new Error('Unapproved map-tile host.');
  const setid=value(first(layer,'TileMatrixSetLink'),'TileMatrixSet');
  const set=children(contents,'TileMatrixSet').find(x=>value(x,'Identifier')===setid);
  if(!set)throw new Error('The map grid description is missing.');
  const whole=(text,key)=>{const n=Number(text);if(!Number.isSafeInteger(n)||n<1||n>2**31)throw new Error('Invalid map dimension: '+key);return n;};
  const matrices=children(set,'TileMatrix').map(x=>({id:value(x,'Identifier'),scale:Number(value(x,'ScaleDenominator')),top_left:(value(x,'TopLeftCorner')||'').split(/\s+/).map(Number),tile_width:whole(value(x,'TileWidth'),'TileWidth'),tile_height:whole(value(x,'TileHeight'),'TileHeight'),width:whole(value(x,'MatrixWidth'),'MatrixWidth'),height:whole(value(x,'MatrixHeight'),'MatrixHeight')}));
  if(!matrices.length||matrices.some(m=>!Number.isFinite(m.scale)||m.scale<=0||m.top_left.length!==2||!m.top_left.every(Number.isFinite)||m.tile_width>4096||m.tile_height>4096))throw new Error('Unsupported map grid.');
  matrices.sort((a,b)=>b.scale-a.scale);
  const styles=children(layer,'Style'),style=styles.find(x=>['true','1'].includes(x.getAttribute('isDefault')))||styles[0];
  return {identifier:value(layer,'Identifier'),style:value(style,'Identifier')||'default',template,matrix_set:setid,matrices,projection:config.projection,name:config.name,attribution:'NASA / LROC / JPL Moon Trek',source_url:config.url,description:config.description};
}
class LunarMap {
  constructor(){
    this.el=$('lunarCanvas');this.cap=null;this.raster=null;this.layer='imagery';this.zoom=2;this.center=[0,-25];this.tileCache=new Map();this.pick=null;this.drag=null;this.connected=false;this.failed=0;this.loaded=0;this.generation=0;this.loading=false;this.route='server';this.logs=[];
    this.resize=new ResizeObserver(()=>this.schedule());this.resize.observe(this.el);
    this.el.addEventListener('pointerdown',e=>{if(!this.cap)return;this.drag={x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,moved:false};this.el.setPointerCapture(e.pointerId);});
    this.el.addEventListener('pointermove',e=>{if(!this.cap)return;const rect=this.el.getBoundingClientRect();if(this.drag){const dx=e.clientX-this.drag.lastX,dy=e.clientY-this.drag.lastY;this.drag.lastX=e.clientX;this.drag.lastY=e.clientY;this.drag.moved ||=Math.hypot(e.clientX-this.drag.x,e.clientY-this.drag.y)>5;const p=this.toPixel(this.center[1],this.center[0]),ll=this.fromPixel(p[0]-dx,p[1]-dy,true);this.center=[ll.lon,ll.lat];this.schedule();}else{const ll=this.at(e.clientX-rect.left,e.clientY-rect.top);$('mapCoord').textContent=ll.inBounds?`${fmt(ll.lat,5)}° N · ${fmt(ll.lon,5)}° E`:'Outside this layer’s map extent';}});
    this.el.addEventListener('pointerup',e=>{if(this.drag&&!this.drag.moved&&this.cap){const r=this.el.getBoundingClientRect(),ll=this.at(e.clientX-r.left,e.clientY-r.top);if(ll.inBounds)this.select(ll);else this.status('That point is outside this layer. Use the coordinate fields or return to the layer extent.','warn');}this.drag=null;});
    this.el.addEventListener('pointercancel',()=>this.drag=null);this.el.addEventListener('lostpointercapture',()=>this.drag=null);
    this.el.addEventListener('wheel',e=>{if(!this.cap)return;e.preventDefault();this.changeZoom(e.deltaY>0?-1:1);},{passive:false});
    this.el.addEventListener('keydown',e=>{if(['+','=','-'].includes(e.key)){e.preventDefault();this.changeZoom(e.key==='-'?-1:1);}});
  }
  status(text,kind='neutral'){if($('mapStatus')){$('mapStatus').textContent=text;$('mapStatus').className='map-status '+kind;}}
  log(stage,message){this.logs.push({time:new Date().toISOString(),layer:this.layer,stage,message:String(message)});this.logs=this.logs.slice(-50);}
  async directCapabilities(config){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),14000);try{const r=await fetch(config.url,{signal:controller.signal});if(!r.ok)throw new Error('NASA HTTP '+r.status);return wmtsFromXml(await r.text(),config);}finally{clearTimeout(timer);}}
  async loadImage(url,timeout=15000){return new Promise((resolve,reject)=>{const im=new Image(),timer=setTimeout(()=>{im.src='';reject(new Error('Image request timed out.'));},timeout);im.onload=()=>{clearTimeout(timer);resolve(im);};im.onerror=()=>{clearTimeout(timer);reject(new Error('Image unavailable.'));};im.src=url;});}
  async connect(layer=$('lunarLayer').value){
    const config=MOON_MAP_SOURCES[layer];if(!config)return;
    const generation=++this.generation;this.layer=layer;this.cap=null;this.raster=null;this.tileCache.clear();this.failed=this.loaded=0;this.connected=false;this.loading=true;this.drag=null;
    $('lunarLayer').value=layer;$('mapEmpty').classList.remove('hidden');$('mapConnect').disabled=true;$('mapConnect').textContent='Connecting…';$('mapError').textContent='Reading NASA’s map-grid description. The rest of the app stays available.';
    $('mapProjection').textContent=config.description;$('mapCredit').textContent='NASA / LROC / JPL Moon Trek';this.status('Connecting to '+config.name+'…','loading');this.draw();
    try{
      let c;
      try{c=await api('/api/map?layer='+encodeURIComponent(layer),undefined,{timeoutMs:16000});this.route='server';this.log('metadata','Local adapter returned valid grid.');}
      catch(error){if(generation!==this.generation)return;this.log('server',error.message);$('mapError').textContent='The Python connection failed. Trying NASA directly from your browser…';c=await this.directCapabilities(config);this.route='browser';this.log('metadata','Browser returned valid grid.');}
      if(generation!==this.generation)return;
      this.cap=c;this.zoom=Math.min(layer==='imagery'?2:0,c.matrices.length-1);
      if(c.projection==='sp'){const m=this.matrix(),ll=this.fromPixel(m.width*m.tile_width/2,m.height*m.tile_height/2,true);this.center=[ll.lon,ll.lat];}else this.center=[0,-25];
      $('mapEmpty').classList.add('hidden');$('mapError').textContent='';this.status('Map grid ready. Loading '+config.name+' tiles…','loading');this.draw();
    }catch(error){
      if(generation!==this.generation)return;this.log('connection',error.message);
      if(layer==='imagery'){
        $('mapError').textContent='Detailed tiles are unavailable. Trying NASA’s coarse reference image…';
        try{
          let im;try{im=await this.loadImage('./api/texture');}catch(_){im=await this.loadImage(NASA_TEXTURE_URL);}
          if(generation!==this.generation)return;
          this.raster=im;this.cap={projection:'eq',attribution:'NASA / GSFC / ASU · LROC-derived CGI Moon Kit reference texture',matrices:Array.from({length:5},(_,z)=>({tile_width:256,tile_height:256,width:2**(z+1),height:2**z}))};this.zoom=1;this.center=[0,-20];this.connected=true;
          $('mapEmpty').classList.add('hidden');$('mapError').textContent='';$('mapProjection').textContent='Coarse LROC-derived reference texture only. Polar gaps were inpainted by NASA’s source producer. Not high-resolution terrain and not used in the physics calculation.';this.status('Coarse NASA imagery only — detailed tile service is unavailable.','warn');this.draw();
        }catch(fallbackError){if(generation!==this.generation)return;this.cap=null;this.log('texture',fallbackError.message);this.showUnavailable(error);}
      }else this.showUnavailable(error);
    }finally{if(generation===this.generation){this.loading=false;$('mapConnect').disabled=false;$('mapConnect').textContent='Retry this NASA layer';this.updateControls();}}
  }
  showUnavailable(error){
    this.connected=false;this.cap=null;this.raster=null;$('mapEmpty').classList.remove('hidden');$('mapError').textContent='This NASA layer could not be loaded. Retry, check the connection report, or continue with the selected-site Sun & Earth view. No other image is being presented as this layer.';
    this.status('Layer unavailable. The selected-site calculations still work with attached data.','error');$('mapProjection').textContent=MOON_MAP_SOURCES[this.layer].description;$('mapCredit').textContent='No imagery loaded';this.draw();
  }
  updateControls(){const ok=!!this.cap;for(const id of ['mapPlus','mapMinus'])$(id).disabled=!ok;$('mapHome').disabled=!ok;}
  matrix(){return this.cap?.matrices[this.zoom];}
  toPixel(lat,lon){const m=this.matrix();if(!m)return[0,0];if(this.cap.projection==='sp'){const rho=2*1737400*Math.tan(Math.PI/4+lat*Math.PI/360),a=lon*Math.PI/180,res=m.scale*.00028;return[(rho*Math.sin(a)-m.top_left[0])/res,(m.top_left[1]-rho*Math.cos(a))/res];}return[((lon+180)%360+360)%360/360*m.width*m.tile_width,(90-lat)/180*m.height*m.tile_height];}
  fromPixel(x,y,clamp=false){const m=this.matrix(),W=m.width*m.tile_width,H=m.height*m.tile_height;let inBounds=y>=0&&y<=H&&(this.cap.projection==='eq'||(x>=0&&x<=W));if(clamp){y=Math.max(0,Math.min(H,y));if(this.cap.projection==='sp')x=Math.max(0,Math.min(W,x));}
    if(this.cap.projection==='sp'){const res=m.scale*.00028,X=m.top_left[0]+x*res,Y=m.top_left[1]-y*res;return{lat:(2*Math.atan(Math.hypot(X,Y)/(2*1737400))-Math.PI/2)*180/Math.PI,lon:(Math.atan2(X,Y)*180/Math.PI+360)%360,inBounds};}
    return{lon:((x/W*360-180)%360+360)%360,lat:90-y/H*180,inBounds};
  }
  at(x,y){const r=this.el.getBoundingClientRect(),p=this.toPixel(this.center[1],this.center[0]);return this.fromPixel(p[0]+x-r.width/2,p[1]+y-r.height/2);}
  select(ll){if(!Number.isFinite(ll.lat)||!Number.isFinite(ll.lon)||Math.abs(ll.lat)>90)return;this.pick={lat:ll.lat,lon:ll.lon};$('pickLat').value=ll.lat.toFixed(6);$('pickLon').value=ll.lon.toFixed(6);$('pickMessage').textContent='Candidate marker only. Saving it does not transfer another site’s terrain or sky data.';this.schedule();}
  centerOn(lat,lon){this.center=[lon,lat];this.select({lat,lon});if(!this.cap)this.status('Coordinates selected. Connect a map layer to see the point; you can still save it now.','warn');this.schedule();}
  changeZoom(d){if(!this.cap)return;this.zoom=Math.max(0,Math.min(this.cap.matrices.length-1,this.zoom+d));this.schedule();}
  tileUrl(z,row,col){let url=this.cap.template;const m=this.cap.matrices[z];for(const[k,v]of Object.entries({Style:this.cap.style,TileMatrixSet:this.cap.matrix_set,TileMatrix:m.id,TileRow:row,TileCol:col}))url=url.replaceAll('{'+k+'}',String(v));return url;}
  getTile(z,row,col){
    const key=[this.layer,z,row,col].join('/');let t=this.tileCache.get(key);if(t)return t;
    const generation=this.generation,direct=this.tileUrl(z,row,col),local='./api/tile?layer='+this.layer+'&z='+z+'&row='+row+'&col='+col;
    t={image:null,status:'loading'};this.tileCache.set(key,t);
    (async()=>{try{try{t.image=await this.loadImage(this.route==='browser'?direct:local,18000);}catch(e){if(this.route==='browser')throw e;t.image=await this.loadImage(direct,14000);}if(generation!==this.generation)return;t.status='loaded';this.loaded++;this.connected=true;
      }catch(e){if(generation!==this.generation)return;t.status='failed';this.failed++;this.log('tile',key+' unavailable');}this.schedule();})();
    return t;
  }
  schedule(){if(this.raf)return;this.raf=requestAnimationFrame(()=>{this.raf=null;this.draw();});}
  draw(){
    const q=canvas('lunarCanvas');if(!q)return;const{ctx,w,h}=q;ctx.fillStyle='#152d36';ctx.fillRect(0,0,w,h);
    if(!this.cap){ctx.strokeStyle='#38515a';ctx.lineWidth=.5;for(let x=0;x<w;x+=60){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}for(let y=0;y<h;y+=60){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}this.updateControls();return;}
    const m=this.matrix(),cp=this.toPixel(this.center[1],this.center[0]),left=cp[0]-w/2,top=cp[1]-h/2,tw=m.tile_width,th=m.tile_height,W=m.width*tw,H=m.height*th;
    const c0=Math.floor(left/tw),c1=Math.floor((left+w)/tw),r0=Math.max(0,Math.floor(top/th)),r1=Math.min(m.height-1,Math.floor((top+h)/th));let visibleLoaded=0,visiblePending=0,visibleFailed=0;
    if(this.raster){for(let wrap=Math.floor(left/W)-1;wrap<=Math.ceil((left+w)/W)+1;wrap++)ctx.drawImage(this.raster,wrap*W-left,-top,W,H);}
    else for(let row=r0;row<=r1;row++)for(let col=c0;col<=c1;col++){let wrapped=col;if(this.cap.projection==='eq')wrapped=((col%m.width)+m.width)%m.width;else if(col<0||col>=m.width)continue;const t=this.getTile(this.zoom,row,wrapped),x=col*tw-left,y=row*th-top;
      if(t.status==='loaded'){ctx.drawImage(t.image,x,y,tw,th);visibleLoaded++;}else{t.status==='failed'?visibleFailed++:visiblePending++;ctx.fillStyle=t.status==='failed'?'#293239':'#203a44';ctx.fillRect(x,y,tw,th);ctx.strokeStyle='#344c55';ctx.strokeRect(x,y,tw,th);ctx.fillStyle='#b8c6c8';ctx.font='11px sans-serif';ctx.fillText(t.status==='failed'?'No tile / no coverage':'Loading…',x+10,y+22);}}
    this.drawNight(ctx,w,h,left,top);
    const placed=[];const drawPoint=(lat,lon,color,text,big=false)=>{const p=this.toPixel(lat,lon);let x=p[0]-left,y=p[1]-top;if(this.cap.projection==='eq'){x+=Math.round((w/2-x)/W)*W;}if(x<-30||x>w+30||y<-30||y>h+30)return;ctx.beginPath();ctx.arc(x,y,big?7:4,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();if(text&&!placed.some(v=>Math.hypot(v[0]-x,v[1]-y)<60)){placed.push([x,y]);text=String(text).slice(0,23);ctx.font='600 11px sans-serif';const width=ctx.measureText(text).width;ctx.fillStyle='#112b35e8';ctx.fillRect(x-width/2-7,y+12,width+14,21);ctx.fillStyle='#fff';ctx.textAlign='center';ctx.fillText(text,x,y+27);ctx.textAlign='left';}};
    const site=currentSite();if(site)drawPoint(site.latitude_deg,site.longitude_deg,'#eec478',shortName(site),true);if(this.pick)drawPoint(this.pick.lat,this.pick.lon,'#8ddccb','Candidate',true);(S.project?.sites||[]).filter(s=>s.id!==S.selected).forEach(s=>drawPoint(s.latitude_deg,s.longitude_deg,'#90bcb0',s.id));
    $('mapCredit').textContent=this.cap.attribution;
    if(!this.raster&&!this.loading){if(visiblePending)this.status(`Loading tiles · ${visibleLoaded} visible · ${visiblePending} pending`,'loading');else if(visibleFailed)this.status(visibleLoaded?'Partial coverage. Some tiles failed; Retry will request them again.':'No tiles loaded in this view. Retry, zoom out or return to the layer extent.','warn');else if(!visibleLoaded)this.status('Outside this layer’s tile extent. Return to the layer extent or zoom out.','warn');else this.status(MOON_MAP_SOURCES[this.layer].name+' · '+visibleLoaded+' tiles loaded','success');}
    const n=$('mapOverlayNote');if(n)n.textContent=!$('nightOverlay').checked?'Illumination overlay is off. The photograph keeps its original lighting.':this.layer!=='imagery'?'Time shading is disabled on average-data layers. Use LROC imagery or Sun & Earth.':!sampleInfo()?'Run a visibility calculation before displaying selected-time shading.':`${prettyDate(sampleInfo().track.time_utc,true)} · smooth-sphere day/night only${current().synthetic_track?' · SYNTHETIC TIME GEOMETRY':''}`;
    this.updateControls();
  }
  drawNight(ctx,w,h,left,top){
    if(!$('nightOverlay')?.checked||this.layer!=='imagery')return;const d=sampleInfo(),site=currentSite();if(!d||!site)return;const rad=Math.PI/180,p=site.latitude_deg*rad,l=site.longitude_deg*rad,a=d.track.sun_azimuth_deg*rad,e=d.track.sun_elevation_deg*rad;
    const east=[-Math.sin(l),Math.cos(l),0],north=[-Math.sin(p)*Math.cos(l),-Math.sin(p)*Math.sin(l),Math.cos(p)],up=[Math.cos(p)*Math.cos(l),Math.cos(p)*Math.sin(l),Math.sin(p)];const sun=up.map((v,k)=>v*Math.sin(e)+north[k]*Math.cos(e)*Math.cos(a)+east[k]*Math.cos(e)*Math.sin(a));
    const step=5;for(let y=0;y<h;y+=step)for(let x=0;x<w;x+=step){const ll=this.fromPixel(left+x+step/2,top+y+step/2);if(!ll.inBounds)continue;const ph=ll.lat*rad,la=ll.lon*rad,dot=Math.cos(ph)*Math.cos(la)*sun[0]+Math.cos(ph)*Math.sin(la)*sun[1]+Math.sin(ph)*sun[2];if(dot<0){ctx.fillStyle='rgba(3,10,18,'+(Math.min(.76,.18-dot*3)).toFixed(3)+')';ctx.fillRect(x,y,step,step);}}
  }
}
