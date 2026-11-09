import * as THREE from './assets/vendor/three.module.js';
import { OrbitControls } from './assets/vendor/OrbitControls.js';

const R_MOON = 1737400;
const DEG = Math.PI / 180;
const geoVector = (lat, lon, r = 1) => new THREE.Vector3(
  r * Math.cos(lat * DEG) * Math.cos(lon * DEG),
  r * Math.sin(lat * DEG),
  -r * Math.cos(lat * DEG) * Math.sin(lon * DEG)
);
const disposeObject = object => object.traverse(child => {
  child.geometry?.dispose();
  if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
  else child.material?.dispose();
});

function labelSprite(text, color = '#c4d0df', background = null) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, 512, 96); }
  ctx.font = '500 38px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.fillText(text, 256, 48);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(1, 0.1875, 1); sprite.userData.isLabel = true;
  return sprite;
}

function meshValues(mesh) {
  if (!mesh) return null;
  const values = mesh.elevations_m || mesh.elevations || mesh.heights || mesh.z;
  if (!values) return null;
  const width = mesh.width || mesh.nx || (Array.isArray(values[0]) ? values[0].length : 0);
  const height = mesh.height || mesh.ny || (Array.isArray(values[0]) ? values.length : 0);
  if (!width || !height) return null;
  const flat = Array.isArray(values[0]) ? values.flat() : values;
  return { width, height, values: flat, spacing: mesh.spacing_m || mesh.step_m || mesh.spacing || 25,
    originX: mesh.origin_x_m ?? mesh.x_min_m ?? -((width - 1) * (mesh.spacing_m || 25)) / 2,
    originY: mesh.origin_y_m ?? mesh.y_min_m ?? -((height - 1) * (mesh.spacing_m || 25)) / 2,
    rowOrder: mesh.row_order || 'south_to_north' };
}

export class MoonScene {
  constructor(canvas, options = {}) {
    this.canvas = canvas; this.options = options; this.home = !!options.home;
    this.mode = '3d'; this.scope = this.home ? 'moon' : 'site';
    this.bundle = null; this.site = null; this.result = null; this.sample = null;
    this.pendingFrame = null; this.pointerStart = null; this.pickables = [];
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(this.home ? '#0e1825' : '#101a29');
    this.perspective = new THREE.PerspectiveCamera(36, 1, 0.005, 5000);
    this.orthographic = new THREE.OrthographicCamera(-3, 3, 3, -3, 0.005, 5000);
    this.camera = this.perspective;
    this.renderer = new THREE.WebGLRenderer({ canvas, context: options.context, antialias: true, alpha: false, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.setClearColor(this.scene.background);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = false; this.controls.enablePan = !this.home;
    this.controls.zoomSpeed = 0.7; this.controls.rotateSpeed = 0.55;
    this.controls.addEventListener('change', () => this.requestRender());
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.scene.add(new THREE.AmbientLight(0xb3c3db, 0.65));
    this.sunLight = new THREE.DirectionalLight(0xfff1da, 2.8);
    this.sunLight.position.set(-4, 3, 5); this.scene.add(this.sunLight);
    this.scene.add(new THREE.HemisphereLight(0x9baec6, 0x152033, 0.65));
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(canvas.parentElement);
    canvas.addEventListener('pointerdown', event => { this.pointerStart = { x: event.clientX, y: event.clientY }; });
    canvas.addEventListener('pointerup', event => {
      if (!this.home && this.pointerStart && Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) < 5) this.pick(event);
      this.pointerStart = null;
    });
    this.resetView(); this.resize();
    const loader = new THREE.TextureLoader();
    loader.load('./assets/moon-color.jpg', texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
      this.texture = texture; if (this.bundle) this.rebuild(); else this.buildMoon();
      this.options.onReady?.();
    }, undefined, () => this.options.onError?.('Lunar imagery could not be loaded. The terrain calculations remain available.'));
  }

  setBundle(bundle) { this.bundle = bundle; this.site = bundle.sites?.[0] || null; this.rebuild(); }
  setSite(site) { if (!site || this.site?.id === site.id) return; this.site = site; if (this.scope === 'site') this.rebuild(); else { this.updatePins(); this.requestRender(); } }
  setMode(mode) { if (!['2d', '3d'].includes(mode) || mode === this.mode) return; this.mode = mode; this.rebuild(); }
  setScope(scope) { if (!['moon', 'site'].includes(scope) || scope === this.scope) return; this.scope = scope; this.rebuild(); }
  setResult(result, index = 0) { this.result = result; if (result?.site) this.setSite(result.site); this.setSample(result?.samples?.[index] || null); }
  setSample(sample) {
    this.sample = sample;
    if (this.sunArrow) this.sunArrow.visible = !!sample;
    if (this.sunSprite) this.sunSprite.visible = !!sample;
    for(const o of [this.earthArrow,this.earthSprite,this.stationArrow,this.panelVisual])if(o)o.visible=!!sample;
    if (this.scope === 'site' && this.sunArrow && sample) {
      const az = sample.sunAzDeg * DEG, el = sample.sunElDeg * DEG;
      const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
      this.sunArrow.setDirection(dir); this.sunArrow.setColor(sample.sunFraction > 0.001 ? 0xe9b65b : 0x6e839e);
      this.sunLight.position.copy(dir.clone().multiplyScalar(30));
      const marker = this.collectorMarker;
      if (marker) { marker.material.color.setHex(sample.sunFraction > 0.001 ? 0xffc66d : 0x82a8cf); marker.position.y = (this.result?.settings?.heightM || 0) / 1000; }
      this.sunArrow.position.y = (this.result?.settings?.heightM || 0) / 1000 + .025;
      if (this.sunSprite) this.sunSprite.position.copy(this.sunArrow.position).addScaledVector(dir, this.localSpan * 0.37);
    }
    if(this.scope==='site' && sample && this.earthArrow){
      const az=sample.earthAzDeg*DEG,el=sample.earthElDeg*DEG;
      const dir=new THREE.Vector3(Math.sin(az)*Math.cos(el),Math.sin(el),-Math.cos(az)*Math.cos(el));
      this.earthArrow.setDirection(dir);this.earthArrow.setColor(sample.earthVisible?0x7bb5de:0x5c6d80);
      this.earthArrow.position.y=(this.result?.settings?.antennaHeightM||0)/1000+.025;
      this.earthSprite.position.copy(this.earthArrow.position).addScaledVector(dir,this.localSpan*.39);
      const saz=sample.stationAzDeg*DEG,sel=sample.stationElDeg*DEG;
      this.stationArrow.setDirection(new THREE.Vector3(Math.sin(saz)*Math.cos(sel),Math.sin(sel),-Math.cos(saz)*Math.cos(sel)));
      this.stationArrow.position.copy(this.earthArrow.position);
      this.stationArrow.setColor(sample.linkAvailable?0xc2deed:0x64778a);
      const cfg=this.result?.settings;
      if(cfg&&this.panelVisual){
        let pAz=cfg.panelMode==='fixed'?cfg.azimuthDeg*DEG:sample.sunAzDeg*DEG;
        let tilt=cfg.panelMode==='horizontal'?0:cfg.panelMode==='tracking'?Math.PI/2-sample.sunElDeg*DEG:cfg.panelMode==='fixed'?cfg.tiltDeg*DEG:Math.PI/2;
        const normal=new THREE.Vector3(Math.sin(tilt)*Math.sin(pAz),Math.cos(tilt),-Math.sin(tilt)*Math.cos(pAz));
        this.panelVisual.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);
        this.panelVisual.position.y=(cfg.heightM||0)/1000+.035;
      }
    }
    this.requestRender();
  }

  clearRoot() { disposeObject(this.root); this.root.clear(); this.pickables = []; this.sunArrow = null; this.sunSprite = null; this.earthArrow=null; this.earthSprite=null; this.stationArrow=null; this.panelVisual=null; this.collectorMarker = null; this.pinGroup = null; this.localPin = null; }
  rebuild() {
    this.clearRoot();
    if (this.scope === 'moon') this.buildMoon(); else this.buildTerrain();
    this.resetView(); this.setSample(this.sample); this.resize();
  }

  buildMoon() {
    if (this.root.children.length) this.clearRoot();
    let geometry, material;
    if (this.mode === '2d' && !this.home) {
      geometry = new THREE.PlaneGeometry(2 * Math.PI, Math.PI, 1, 1);
      material = new THREE.MeshBasicMaterial({ map: this.texture || null, color: this.texture ? 0xffffff : 0x8a8f97, side: THREE.DoubleSide });
      this.moon = new THREE.Mesh(geometry, material); this.moon.userData.flatMoon = true;
    } else {
      geometry = new THREE.SphereGeometry(1, 128, 64);
      material = new THREE.MeshStandardMaterial({ map: this.texture || null, color: this.texture ? 0xffffff : 0x8a8f97, roughness: 1, metalness: 0 });
      this.moon = new THREE.Mesh(geometry, material); this.moon.userData.globe = true;
    }
    this.root.add(this.moon); this.pickables.push(this.moon);
    this.pinGroup = new THREE.Group(); this.root.add(this.pinGroup); this.updatePins();
    if (!this.home && this.mode === '2d') {
      const points = [];
      for (let lon = -180; lon <= 180; lon += 30) points.push(lon * DEG, -Math.PI / 2, 0.006, lon * DEG, Math.PI / 2, 0.006);
      for (let lat = -60; lat <= 60; lat += 30) points.push(-Math.PI, lat * DEG, 0.006, Math.PI, lat * DEG, 0.006);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      this.root.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xa5b7cc, opacity: 0.14, transparent: true })));
    }
    this.sunLight.position.set(-4, 3, 5); this.requestRender();
  }

  updatePins() {
    if (!this.pinGroup) return;
    disposeObject(this.pinGroup); this.pinGroup.clear();
    this.pickables = this.pickables.filter(o => !o.userData.siteId && !o.userData.cluster);
    for (const site of this.site ? [this.site] : []) {
      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0xffc66d, depthTest: true }));
      const lat = site.latitude_deg, lon = site.longitude_deg;
      if (this.mode === '2d') marker.position.set(lon * DEG, lat * DEG, 0.03); else marker.position.copy(geoVector(lat, lon, 1.008));
      marker.userData.cluster = true; this.pinGroup.add(marker); this.pickables.push(marker);
    }
    if (this.customPin) {
      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.020, 14, 8), new THREE.MeshBasicMaterial({ color: 0xffc66d }));
      if (this.mode === '2d') marker.position.set(this.customPin.lon * DEG, this.customPin.lat * DEG, 0.03);
      else marker.position.copy(geoVector(this.customPin.lat, this.customPin.lon, 1.012));
      this.pinGroup.add(marker);
    }
  }

  setPin(lat, lon) {
    this.customPin = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
    if (this.scope === 'moon') this.updatePins(); else this.updateLocalPin();
    this.requestRender();
  }

  updateLocalPin() {
    if (this.localPin) { this.root.remove(this.localPin); disposeObject(this.localPin); this.localPin = null; }
    if (!this.customPin || !this.site) return;
    const info = meshValues(this.site.mesh); if (!info) return;
    const a = this.site.latitude_deg * DEG, b = this.customPin.lat * DEG, dl = (this.customPin.lon - this.site.longitude_deg) * DEG;
    let z = this.site.ground_elevation_m, east, north;
    for (let iteration = 0; iteration < 3; iteration++) {
      east = (R_MOON + z) * Math.cos(b) * Math.sin(dl);
      north = (R_MOON + z) * (Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(dl));
      const col = (east - info.originX) / info.spacing;
      const row = info.rowOrder === 'north_to_south' ? (info.originY - north) / info.spacing : (north - info.originY) / info.spacing;
      if (col < 0 || row < 0 || col >= info.width - 1 || row >= info.height - 1) return;
      const c = Math.floor(col), r = Math.floor(row), u = col - c, v = row - r;
      const at = (y, x) => info.values[y * info.width + x];
      z = (1-v)*((1-u)*at(r,c)+u*at(r,c+1)) + v*((1-u)*at(r+1,c)+u*at(r+1,c+1));
    }
    const up = Math.sqrt((R_MOON + z) ** 2 - east ** 2 - north ** 2) - (R_MOON + this.site.ground_elevation_m);
    this.localPin = new THREE.Mesh(new THREE.SphereGeometry(this.localSpan * .008, 12, 8), new THREE.MeshBasicMaterial({ color: 0x92c8ff, depthTest: false }));
    this.localPin.position.set(east/1000, up/1000 + .006, -north/1000); this.root.add(this.localPin);
  }

  buildTerrain() {
    const mesh = meshValues(this.site?.mesh || this.site?.terrain_mesh || this.bundle?.mesh);
    if (!mesh) {
      const note = labelSprite('Preparing terrain', '#a9b8ca'); note.scale.set(3, .55, 1); this.root.add(note);
      this.localSpan = 8; return;
    }
    const { width, height, values, spacing, originX, originY, rowOrder } = mesh;
    this.meshInfo = mesh;
    this.localSpan = Math.max((width - 1) * spacing, (height - 1) * spacing) / 1000;
    this.centerElevation = this.site.ground_elevation_m || values[Math.floor(values.length / 2)];
    let low = Infinity, high = -Infinity;
    for (const v of values) if (Number.isFinite(v)) { low = Math.min(low, v); high = Math.max(high, v); }
    const positions = [], colors = [], indices = [];
    const paletteLow = new THREE.Color(0x273343), paletteHigh = new THREE.Color(0xaab0b5);
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
      const z = Number.isFinite(values[row * width + col]) ? values[row * width + col] : low;
      const n = rowOrder === 'north_to_south' ? originY - row * spacing : originY + row * spacing;
      const east = originX + col * spacing;
      const up = Math.sqrt((R_MOON + z) ** 2 - east ** 2 - n ** 2) - (R_MOON + this.centerElevation);
      positions.push(east / 1000, up / 1000, -n / 1000);
      const t = Math.min(1, Math.max(0, (z - low) / (high - low || 1)));
      const color = paletteLow.clone().lerp(paletteHigh, 0.25 + t * 0.75);
      colors.push(color.r, color.g, color.b);
    }
    for (let row = 0; row < height - 1; row++) for (let col = 0; col < width - 1; col++) {
      const a = row * width + col, b = a + 1, c = a + width, d = c + 1;
      if (rowOrder === 'north_to_south') indices.push(a, c, b, b, c, d);
      else indices.push(a, b, c, b, d, c);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    this.terrain = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide }));
    this.terrain.userData.terrain = true; this.root.add(this.terrain); this.pickables.push(this.terrain);
    const step = Math.max(50, Math.round((high - low) / 12 / 50) * 50);
    const contourPoints = [];
    const xy = (r, c) => [positions[(r * width + c) * 3], positions[(r * width + c) * 3 + 2]];
    for (let level = Math.ceil(low / step) * step; level < high; level += step) {
      for (let r = 0; r < height - 1; r++) for (let c = 0; c < width - 1; c++) {
        const corners = [[r, c], [r, c + 1], [r + 1, c + 1], [r + 1, c]];
        const intersections = [];
        for (let e = 0; e < 4; e++) {
          const [ra, ca] = corners[e], [rb, cb] = corners[(e + 1) % 4];
          const va = values[ra * width + ca], vb = values[rb * width + cb];
          if (!Number.isFinite(va) || !Number.isFinite(vb) || (va < level) === (vb < level)) continue;
          const t = (level - va) / (vb - va), pa = xy(ra, ca), pb = xy(rb, cb);
          const x = pa[0] + (pb[0] - pa[0]) * t, z = pa[1] + (pb[1] - pa[1]) * t;
          const up = Math.sqrt((R_MOON + level) ** 2 - (x*1000) ** 2 - (z*1000) ** 2) - (R_MOON + this.centerElevation);
          intersections.push([x, up / 1000 + .003, z]);
        }
        if (intersections.length >= 2) contourPoints.push(...intersections[0], ...intersections[1]);
      }
    }
    const contours = new THREE.BufferGeometry(); contours.setAttribute('position', new THREE.Float32BufferAttribute(contourPoints, 3));
    this.root.add(new THREE.LineSegments(contours, new THREE.LineBasicMaterial({ color: 0x98a7bc, transparent: true, opacity: this.mode === '2d' ? 0.33 : 0.12 })));
    const size = this.localSpan;
    this.collectorMarker = new THREE.Mesh(new THREE.SphereGeometry(size * 0.009, 16, 10), new THREE.MeshBasicMaterial({ color: 0xffc66d, depthTest: false }));
    this.collectorMarker.position.set(0, 0.025, 0); this.root.add(this.collectorMarker);
    const ring = new THREE.Mesh(new THREE.RingGeometry(size * 0.022, size * 0.025, 48), new THREE.MeshBasicMaterial({ color: 0xffc66d, side: THREE.DoubleSide, transparent: true, opacity: .7, depthTest: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = .015; this.root.add(ring);
    const centerLabel = labelSprite(this.site.name || 'Selected location', '#f4e6cd');
    centerLabel.scale.set(size * .30, size * .056, 1); centerLabel.position.set(0, size * .07, 0); this.root.add(centerLabel);
    const north = labelSprite('N', '#c2d1e3'); north.scale.set(size * .09, size * .017, 1);
    north.position.set(0, 0.05, -size * .45); this.root.add(north);
    const origin = new THREE.Vector3(0, .04, 0);
    this.sunArrow = new THREE.ArrowHelper(new THREE.Vector3(.7, .03, -.7).normalize(), origin, size * .3, 0xe9b65b, size * .025, size * .014);
    this.root.add(this.sunArrow);
    this.sunSprite = labelSprite('SUN', '#efc47d'); this.sunSprite.scale.set(size * .15, size * .028, 1); this.root.add(this.sunSprite);
    this.earthArrow=new THREE.ArrowHelper(new THREE.Vector3(0,.1,-1).normalize(),origin.clone(),size*.34,0x7bb5de,size*.024,size*.013);
    this.stationArrow=new THREE.ArrowHelper(new THREE.Vector3(0,.1,-1).normalize(),origin.clone(),size*.25,0xc2deed,size*.016,size*.008);
    this.root.add(this.earthArrow,this.stationArrow);
    this.earthSprite=labelSprite('EARTH','#8bc4ec');this.earthSprite.scale.set(size*.16,size*.03,1);this.root.add(this.earthSprite);
    this.panelVisual=new THREE.Mesh(new THREE.PlaneGeometry(size*.025,size*.045),new THREE.MeshBasicMaterial({color:0x3c6b98,side:THREE.DoubleSide,depthTest:false}));
    this.root.add(this.panelVisual);
    if (this.mode === '2d') this.sunLight.position.set(-10, 25, 10);
    this.updateLocalPin();
    this.requestRender();
  }

  resetView() {
    this.camera = this.mode === '2d' && !this.home ? this.orthographic : this.perspective;
    this.controls.object = this.camera;
    this.controls.enableRotate = this.mode === '3d'; this.controls.enablePan = !this.home;
    this.controls.target.set(0, 0, 0);
    if (this.scope === 'moon') {
      this.controls.minPolarAngle = 0; this.controls.maxPolarAngle = Math.PI;
      if (this.mode === '2d' && !this.home) this.camera.position.set(0, 0, 8);
      else if (this.home) this.camera.position.set(0.8, -0.65, 3.2);
      else this.camera.position.copy(geoVector(-72, 20, 3.3));
      this.camera.up.set(0, 1, 0); this.controls.minDistance = 1.12; this.controls.maxDistance = 8;
      this.orthoSpan = Math.PI * 1.12;
    } else {
      const s = this.localSpan || 8;
      if (this.mode === '2d') { this.camera.position.set(0, s * 3, 0); this.camera.up.set(0, 0, -1); }
      else { this.camera.up.set(0, 1, 0); this.camera.position.set(s * .62, s * .66, s * .92); }
      this.controls.minDistance = s * .05; this.controls.maxDistance = s * 6;
      this.controls.maxPolarAngle = Math.PI * .49;
      this.orthoSpan = s * .57;
    }
    this.camera.zoom = 1; this.camera.lookAt(0, 0, 0); this.controls.update(); this.resize();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
    if (w < 5 || h < 5) return;
    this.renderer.setSize(w, h, false);
    this.perspective.aspect = w / h; this.perspective.updateProjectionMatrix();
    const span = this.orthoSpan || 3, aspect = w / h;
    this.orthographic.left = -span * aspect; this.orthographic.right = span * aspect;
    this.orthographic.top = span; this.orthographic.bottom = -span; this.orthographic.updateProjectionMatrix();
    this.requestRender();
  }

  requestRender() {
    if (this.pendingFrame != null) return;
    this.pendingFrame = requestAnimationFrame(() => {
      this.pendingFrame = null;
      if (this.canvas.getClientRects().length && this.canvas.clientWidth > 1) this.renderer.render(this.scene, this.camera);
    });
  }

  pick(event) {
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(pointer, this.camera);
    const hit = ray.intersectObjects(this.pickables, false)[0];
    if (!hit) return;
    if (hit.object.userData.cluster) { this.options.onPick?.({ cluster: true }); return; }
    if (hit.object.userData.siteId) { this.options.onPick?.({ siteId: hit.object.userData.siteId }); return; }
    let lat, lon;
    if (hit.object.userData.flatMoon) { lat = hit.point.y / DEG; lon = hit.point.x / DEG; }
    else if (hit.object.userData.globe) {
      const p = hit.point.clone().normalize(); lat = Math.asin(p.y) / DEG; lon = Math.atan2(-p.z, p.x) / DEG;
    } else if (hit.object.userData.terrain && this.site) {
      const east = hit.point.x * 1000, north = -hit.point.z * 1000;
      const distance = Math.hypot(east, north), bearing = Math.atan2(east, north);
      const l0 = this.site.latitude_deg * DEG, p0 = this.site.longitude_deg * DEG;
      const a = Math.atan2(distance, R_MOON + this.site.ground_elevation_m + hit.point.y * 1000);
      const l1 = Math.asin(Math.sin(l0) * Math.cos(a) + Math.cos(l0) * Math.sin(a) * Math.cos(bearing));
      const p1 = p0 + Math.atan2(Math.sin(bearing) * Math.sin(a) * Math.cos(l0), Math.cos(a) - Math.sin(l0) * Math.sin(l1));
      lat = l1 / DEG; lon = ((p1 / DEG + 540) % 360) - 180;
    }
    if (Number.isFinite(lat) && Number.isFinite(lon)) { this.setPin(lat, lon); this.options.onPick?.({ lat, lon }); }
  }

  destroy() { this.resizeObserver.disconnect(); this.controls.dispose(); disposeObject(this.root); this.renderer.dispose(); }
}
