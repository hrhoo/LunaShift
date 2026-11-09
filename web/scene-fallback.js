// Canvas 2D renderer for browsers without WebGL. Geometry and picking remain 3D.
// The Moon texture is appearance data. Local relief is the packaged, measured DEM.
const DEG = Math.PI / 180;
const R_MOON = 1737400;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normal = a => { const n = Math.hypot(...a) || 1; return a.map(v => v / n); };
const geo = (lat, lon) => [Math.cos(lat * DEG) * Math.cos(lon * DEG), Math.sin(lat * DEG), -Math.cos(lat * DEG) * Math.sin(lon * DEG)];
let texturePromise;

function loadMoonTexture() {
  if (!texturePromise) texturePromise = new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(1536, image.naturalWidth);
        canvas.height = Math.round(canvas.width * image.naturalHeight / image.naturalWidth);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve({ canvas, width: canvas.width, height: canvas.height,
          pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data });
      } catch (error) { reject(error); }
    };
    image.onerror = () => reject(new Error('Lunar imagery could not be loaded.'));
    image.src = './assets/moon-color.jpg';
  });
  return texturePromise;
}

function readMesh(source, ground) {
  if (!source) return null;
  const input = source.elevations_m || source.elevations || source.heights || source.z;
  if (!input) return null;
  const nested = Array.isArray(input[0]);
  const width = source.width || source.nx || (nested ? input[0].length : 0);
  const height = source.height || source.ny || (nested ? input.length : 0);
  if (width < 2 || height < 2) return null;
  const values = nested ? input.flat() : input;
  const spacing = source.spacing_m || source.step_m || source.spacing || 25;
  const originX = source.origin_x_m ?? source.x_min_m ?? -(width - 1) * spacing / 2;
  const originY = source.origin_y_m ?? source.y_min_m ?? -(height - 1) * spacing / 2;
  const northward = source.row_order !== 'north_to_south';
  const elevation = Number.isFinite(ground) ? ground : values[Math.floor(height / 2) * width + Math.floor(width / 2)];
  const tangent = (east, north, absolute) => Math.sqrt(Math.max(0, (R_MOON + absolute) ** 2 - east ** 2 - north ** 2)) - (R_MOON + elevation);
  const rows = [], cols = [];
  for (let r = 0; r < height - 1; r += 3) rows.push(r);
  for (let c = 0; c < width - 1; c += 3) cols.push(c);
  rows.push(height - 1); cols.push(width - 1);
  const vertices = [];
  let low = Infinity, high = -Infinity;
  for (const row of rows) for (const col of cols) {
    const absolute = values[row * width + col];
    const east = originX + col * spacing, north = originY + row * spacing * (northward ? 1 : -1);
    if (!Number.isFinite(absolute)) { vertices.push(null); continue; }
    vertices.push({ p: [east, north, tangent(east, north, absolute)], absolute });
    low = Math.min(low, absolute); high = Math.max(high, absolute);
  }
  const triangles = [], quads = [], light = normal([-0.55, 0.4, 0.9]);
  const nc = cols.length;
  const addTriangle = (ia, ib, ic) => {
    const a = vertices[ia], b = vertices[ib], c = vertices[ic];
    if (!a || !b || !c) return;
    const u = b.p.map((v, k) => v - a.p[k]), v = c.p.map((x, k) => x - a.p[k]);
    let n = normal([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]);
    if (n[2] < 0) n = n.map(x => -x);
    const shade = 0.35 + 0.65 * Math.max(0, dot(n, light));
    const elevationTone = ((a.absolute + b.absolute + c.absolute) / 3 - low) / (high - low || 1);
    const brightness = (145 + 40 * elevationTone) * shade;
    triangles.push({ indices: [ia, ib, ic], color: `rgb(${Math.round(brightness)},${Math.round(brightness * 1.035)},${Math.round(brightness * 1.075)})` });
  };
  for (let r = 0; r < rows.length - 1; r++) for (let c = 0; c < nc - 1; c++) {
    const a = r * nc + c, b = a + 1, d = a + nc, e = d + 1;
    addTriangle(a, b, d); addTriangle(b, e, d);
    if ([a, b, e, d].every(i => vertices[i])) quads.push([a, b, e, d]);
  }
  const contours = [];
  const contourStep = Math.max(25, Math.ceil((high - low) / 14 / 25) * 25);
  for (let level = Math.ceil(low / contourStep) * contourStep; level < high; level += contourStep) {
    for (const q of quads) {
      const hits = [];
      for (let edge = 0; edge < 4; edge++) {
        const a = vertices[q[edge]], b = vertices[q[(edge + 1) % 4]];
        if ((a.absolute < level) === (b.absolute < level)) continue;
        const t = (level - a.absolute) / (b.absolute - a.absolute);
        const east = a.p[0] + t * (b.p[0] - a.p[0]), north = a.p[1] + t * (b.p[1] - a.p[1]);
        hits.push([east, north, tangent(east, north, level)]);
      }
      for (let j = 0; j + 1 < hits.length; j += 2) contours.push([hits[j], hits[j + 1]]);
    }
  }
  return { width, height, values, spacing, originX, originY, northward, elevation,
    tangent, vertices, triangles, contours, contourStep, low, high,
    span: Math.max((width - 1) * spacing, (height - 1) * spacing) };
}

export class FallbackMoonScene {
  constructor(canvas, options = {}) {
    this.canvas = canvas; this.options = options; this.home = !!options.home;
    this.ctx = canvas.getContext('2d', { alpha: false });
    if (!this.ctx) throw new Error('Canvas graphics are unavailable in this browser.');
    this.mode = '3d'; this.scope = this.home ? 'moon' : 'site';
    this.bundle = null; this.site = null; this.sample = null; this.result = null;
    this.mesh = null; this.customPin = null; this.frame = null; this.destroyed = false;
    this.width = 1; this.height = 1; this.pointers = new Map(); this.hitPins = [];
    this.canvas.style.touchAction = 'none';
    this.canvas.style.cursor = 'grab';
    this.canvas.tabIndex = 0;
    this.canvas.title = 'Drag to rotate. Scroll to zoom. Arrow keys rotate; + and − zoom.';
    this.handlers = {
      pointerdown: event => this.pointerDown(event),
      pointermove: event => this.pointerMove(event),
      pointerup: event => this.pointerUp(event),
      pointercancel: event => this.pointerUp(event, true),
      wheel: event => { event.preventDefault(); this.zoom = clamp(this.zoom * Math.exp(-event.deltaY * .001), .55, 5); this.requestRender(); },
      keydown: event => this.keyDown(event)
    };
    for (const [name, handler] of Object.entries(this.handlers)) canvas.addEventListener(name, handler, name === 'wheel' ? { passive: false } : undefined);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    if (typeof IntersectionObserver !== 'undefined') {
      this.visibilityObserver = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) this.resize();
      });
      this.visibilityObserver.observe(canvas);
    }
    this.resetView(); this.resize();
    loadMoonTexture().then(texture => {
      if (this.destroyed) return;
      this.texture = texture; this.sphereKey = ''; this.resize(); this.requestRender(); this.ready();
    }).catch(error => { this.options.onError?.(error.message); this.textureError = true; this.ready(); this.requestRender(); });
  }

  ready() { if (!this.isReady) { this.isReady = true; this.options.onReady?.(); } }
  setBundle(bundle) { this.bundle = bundle; this.site = bundle?.sites?.[0] || null; this.buildTerrain(); this.requestRender(); }
  setSite(site) { if (!site || site === this.site) return; this.site = site; this.buildTerrain(); this.requestRender(); }
  setMode(mode) { if (!['2d', '3d'].includes(mode)) return; this.mode = mode; this.resetView(); }
  setScope(scope) { if (!['site', 'moon'].includes(scope)) return; this.scope = scope; this.resetView(); }
  setResult(result, index = 0) {
    this.result = result;
    if (result?.site) {
      const site = this.bundle?.sites?.find(s => s.id === result.site.id) || result.site;
      if (site.mesh || site.terrain_mesh) this.setSite(site);
    }
    this.setSample(result?.samples?.[index] || null);
  }
  setSample(sample) { this.sample = sample; this.requestRender(); }
  setPin(lat, lon) { this.customPin = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null; this.requestRender(); }
  buildTerrain() { this.mesh = readMesh(this.site?.mesh || this.site?.terrain_mesh || this.bundle?.mesh, this.site?.ground_elevation_m); if (this.mesh) this.ready(); }
  resetView() {
    this.zoom = 1; this.panX = 0; this.panY = 0;
    this.longitude = (this.home ? 0 : 20) * DEG;
    this.latitude = (this.home ? -12 : -72) * DEG;
    this.yaw = 145 * DEG; this.pitch = 40 * DEG;
    this.sphereKey = ''; this.requestRender();
  }
  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    if (rect.width < 5 || rect.height < 5) return;
    this.width = rect.width; this.height = rect.height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const pixelWidth = Math.round(this.width * this.dpr), pixelHeight = Math.round(this.height * this.dpr);
    // Assigning either dimension clears a canvas, even when its value is unchanged.
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth; this.canvas.height = pixelHeight;
      this.sphereKey = '';
    }
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Page changes can occur between animation frames. Paint this visible surface
    // now so that it never depends on a further pointer or keyboard event.
    if (this.canvas.getClientRects().length) this.render();
  }
  requestRender() {
    if (this.frame != null || this.destroyed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      if (this.destroyed || !this.canvas.getClientRects().length || this.width < 5) return;
      this.render();
    });
  }
  render() {
    const { ctx, width: w, height: h } = this;
    ctx.setTransform(this.dpr || 1, 0, 0, this.dpr || 1, 0, 0);
    ctx.fillStyle = this.home ? '#0e1825' : '#101a29'; ctx.fillRect(0, 0, w, h);
    this.hitPins = []; this.projectedTriangles = [];
    if (this.scope === 'moon') this.mode === '2d' && !this.home ? this.drawFlatMoon() : this.drawGlobe();
    else this.drawTerrain();
  }

  globeBasis() {
    const c = Math.cos(this.longitude), s = Math.sin(this.longitude), cl = Math.cos(this.latitude), sl = Math.sin(this.latitude);
    return { right: [-s, 0, -c], up: [-sl * c, cl, sl * s], front: [cl * c, sl, -cl * s] };
  }
  drawGlobe() {
    const { ctx, width: w, height: h } = this;
    const radius = Math.min(w, h) * .415 * this.zoom;
    const cx = w / 2 + this.panX, cy = h / 2 + this.panY;
    const basis = this.globeBasis(); this.globeProjection = { radius, cx, cy, basis };
    if (!this.texture) { this.statusText(this.textureError ? 'Moon imagery unavailable' : 'Loading lunar imagery'); return; }
    const size = Math.round(clamp(radius * 2 * (this.dpr || 1), 180, this.dragging ? 430 : 660));
    const key = `${size}:${this.longitude.toFixed(5)}:${this.latitude.toFixed(5)}`;
    if (key !== this.sphereKey) {
      if (!this.sphereLayer) this.sphereLayer = document.createElement('canvas');
      if (!this.spherePixels || this.sphereLayer.width !== size || this.sphereLayer.height !== size) {
        this.sphereLayer.width = size; this.sphereLayer.height = size;
        const context = this.sphereLayer.getContext('2d');
        this.spherePixels = context.createImageData(size, size);
        this.sphereNormals = new Float32Array(size * size * 3);
        const edge = (size - 2) / 2;
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          const i = y * size + x, nx = (x - size / 2 + .5) / edge, ny = (size / 2 - y - .5) / edge;
          const inside = 1 - nx * nx - ny * ny;
          if (inside <= 0) { this.sphereNormals[i * 3 + 2] = -1; continue; }
          this.sphereNormals[i * 3] = nx; this.sphereNormals[i * 3 + 1] = ny; this.sphereNormals[i * 3 + 2] = Math.sqrt(inside);
          this.spherePixels.data[i * 4 + 3] = Math.round(255 * Math.min(1, inside * edge));
        }
      }
      const { pixels, width: tw, height: th } = this.texture;
      const data = this.spherePixels.data, normals = this.sphereNormals;
      const right = basis.right, up = basis.up, front = basis.front;
      const light = [-.54, .46, .705];
      for (let i = 0; i < size * size; i++) {
        const k = i * 3, nz = normals[k + 2]; if (nz < 0) continue;
        const nx = normals[k], ny = normals[k + 1];
        const wx = nx * right[0] + ny * up[0] + nz * front[0];
        const wy = nx * right[1] + ny * up[1] + nz * front[1];
        const wz = nx * right[2] + ny * up[2] + nz * front[2];
        let u = .5 + Math.atan2(-wz, wx) / (Math.PI * 2); u -= Math.floor(u);
        const v = .5 - Math.asin(clamp(wy, -1, 1)) / Math.PI;
        const source = (clamp(Math.floor(v * th), 0, th - 1) * tw + Math.floor(u * tw)) * 4;
        const shade = .10 + .98 * Math.max(0, nx * light[0] + ny * light[1] + nz * light[2]);
        const out = i * 4;
        data[out] = Math.min(255, pixels[source] * shade);
        data[out + 1] = Math.min(255, pixels[source + 1] * shade);
        data[out + 2] = Math.min(255, pixels[source + 2] * shade);
      }
      this.sphereLayer.getContext('2d').putImageData(this.spherePixels, 0, 0);
      this.sphereKey = key;
    }
    ctx.drawImage(this.sphereLayer, cx - radius, cy - radius, radius * 2, radius * 2);
    if (!this.home) {
      this.drawMoonPins(point => {
        const v = geo(point.lat, point.lon), z = dot(v, basis.front);
        return z > .015 ? { x: cx + radius * dot(v, basis.right), y: cy - radius * dot(v, basis.up) } : null;
      });
      this.cornerText('Global view · reference illumination');
    }
  }
  drawFlatMoon() {
    if (!this.texture) { this.statusText(this.textureError ? 'Moon imagery unavailable' : 'Loading lunar imagery'); return; }
    const { ctx, width: w, height: h } = this;
    const mapW = Math.min(w - 42, (h - 62) * 2) * this.zoom, mapH = mapW / 2;
    const x = (w - mapW) / 2 + this.panX, y = (h - mapH) / 2 + this.panY;
    this.flatProjection = { x, y, width: mapW, height: mapH };
    ctx.drawImage(this.texture.canvas, x, y, mapW, mapH);
    ctx.strokeStyle = 'rgba(219,232,247,.18)'; ctx.lineWidth = .65; ctx.beginPath();
    for (let lon = -180; lon <= 180; lon += 30) { const px = x + (lon + 180) / 360 * mapW; ctx.moveTo(px, y); ctx.lineTo(px, y + mapH); }
    for (let lat = -90; lat <= 90; lat += 30) { const py = y + (90 - lat) / 180 * mapH; ctx.moveTo(x, py); ctx.lineTo(x + mapW, py); }
    ctx.stroke();
    this.drawMoonPins(point => ({ x: x + (point.lon + 180) / 360 * mapW, y: y + (90 - point.lat) / 180 * mapH }));
    this.cornerText('Equirectangular map · north up');
  }
  drawMoonPins(project) {
    const selected = this.site || this.bundle?.sites?.[0];
    if (selected) {
      const p = project({ lat: selected.latitude_deg, lon: selected.longitude_deg });
      if (p) { this.drawPin(p.x, p.y, '#e4ad4e', 'Connecting Ridge'); this.hitPins.push({ ...p, cluster: true }); }
    }
    if (this.customPin) {
      const p = project(this.customPin);
      if (p) this.drawPin(p.x, p.y, '#d3e6f7');
    }
  }

  terrainBasis() {
    if (this.mode === '2d') return { right: [1, 0, 0], up: [0, 1, 0], front: [0, 0, 1] };
    const sa = Math.sin(this.yaw), ca = Math.cos(this.yaw), se = Math.sin(this.pitch), ce = Math.cos(this.pitch);
    return { right: [-ca, sa, 0], up: [-sa * se, -ca * se, ce], front: [sa * ce, ca * ce, se] };
  }
  drawTerrain() {
    const mesh = this.mesh;
    if (!mesh) { this.statusText('Preparing lunar terrain'); return; }
    const { ctx, width: w, height: h } = this, basis = this.terrainBasis();
    const scale = Math.min((w - 42) / (mesh.span * (this.mode === '2d' ? 1 : 1.45)), (h - 68) / (mesh.span * (this.mode === '2d' ? 1 : 1.12))) * this.zoom;
    const cx = w / 2 + this.panX, cy = h * .50 + this.panY;
    const project = p => ({ x: cx + dot(p, basis.right) * scale, y: cy - dot(p, basis.up) * scale, depth: dot(p, basis.front) });
    this.terrainProjection = { project, scale, cx, cy, basis };
    const points = mesh.vertices.map(v => v ? project(v.p) : null);
    const ordered = mesh.triangles.map(tri => ({ tri, p: tri.indices.map(i => points[i]), depth: tri.indices.reduce((sum, i) => sum + points[i].depth, 0) / 3 })).sort((a, b) => a.depth - b.depth);
    ctx.lineWidth = .45;
    for (const item of ordered) {
      const [a, b, c] = item.p;
      if (Math.max(a.x, b.x, c.x) < 0 || Math.min(a.x, b.x, c.x) > w || Math.max(a.y, b.y, c.y) < 0 || Math.min(a.y, b.y, c.y) > h) continue;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.closePath();
      ctx.fillStyle = item.tri.color; ctx.strokeStyle = item.tri.color; ctx.fill(); ctx.stroke();
      this.projectedTriangles.push(item);
    }
    if (this.mode === '2d') {
      ctx.lineWidth = .7; ctx.strokeStyle = 'rgba(18,30,43,.40)'; ctx.beginPath();
      for (const [p, q] of mesh.contours) { const a = project(p), b = project(q); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      ctx.stroke();
    }
    const atGround = this.heightAt(0, 0) ?? 0;
    const collectorHeight = this.result?.settings?.heightM ?? 0;
    const collector = [0, 0, atGround + collectorHeight];
    const center = project(collector), base = project([0, 0, atGround]);
    ctx.strokeStyle = '#ecc681'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(center.x, center.y); ctx.stroke();
    if (this.sample) {
      const az = this.sample.sunAzDeg * DEG, el = this.sample.sunElDeg * DEG;
      const direction = [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
      const end = project(collector.map((v, i) => v + direction[i] * mesh.span * .28));
      this.drawArrow(center, end, this.sample.sunFraction > .001 ? '#e4ad4e' : '#8fa8c0');
      this.label('Sun direction', end.x, end.y - 13, '#efd4a5');
    }
    if(this.sample && Number.isFinite(this.sample.earthAzDeg)){
      const az=this.sample.earthAzDeg*DEG,el=this.sample.earthElDeg*DEG;
      const direction=[Math.sin(az)*Math.cos(el),Math.cos(az)*Math.cos(el),Math.sin(el)];
      const end=project(collector.map((v,i)=>v+direction[i]*mesh.span*.34));
      this.drawArrow(center,end,this.sample.earthVisible?'#85bbdf':'#64788c');
      this.label('Earth direction',end.x,end.y-13,'#85bbdf');
      const saz=this.sample.stationAzDeg*DEG,sel=this.sample.stationElDeg*DEG;
      const sd=[Math.sin(saz)*Math.cos(sel),Math.cos(saz)*Math.cos(sel),Math.sin(sel)];
      const se=project(collector.map((v,i)=>v+sd[i]*mesh.span*.24));
      this.drawArrow(center,se,this.sample.linkAvailable?'#cadde9':'#6d8195');
      ctx.fillStyle='#31587b';ctx.strokeStyle='#95b3d0';ctx.fillRect(center.x-7,center.y-10,14,9);ctx.strokeRect(center.x-7,center.y-10,14,9);
    }
    this.drawPin(center.x, center.y, this.sample && this.sample.sunFraction <= .001 ? '#a5bdd7' : '#e4ad4e');
    this.label(this.site?.name || 'Selected site', center.x, center.y - 22, '#f3e4ca');
    this.hitPins.push({ x: center.x, y: center.y, siteId: this.site?.id });
    if (this.customPin) {
      const point = this.localFromGeo(this.customPin.lat, this.customPin.lon);
      if (point) { const p = project(point); this.drawPin(p.x, p.y, '#d7e7f7'); }
    }
    this.drawCompass(basis);
    this.drawScale(scale, mesh.span);
    this.cornerText(this.mode === '2d' ? `Elevation contours · ${mesh.contourStep} m interval` : 'Terrain relief · vertical scale 1×');
  }
  heightAt(east, north) {
    const m = this.mesh; if (!m) return null;
    const col = (east - m.originX) / m.spacing;
    const row = (north - m.originY) / m.spacing * (m.northward ? 1 : -1);
    if (col < 0 || row < 0 || col > m.width - 1 || row > m.height - 1) return null;
    const c = Math.min(m.width - 2, Math.floor(col)), r = Math.min(m.height - 2, Math.floor(row));
    const u = col - c, v = row - r;
    const values = [m.values[r * m.width + c], m.values[r * m.width + c + 1], m.values[(r + 1) * m.width + c], m.values[(r + 1) * m.width + c + 1]];
    if (!values.every(Number.isFinite)) return null;
    const absolute = values[0] * (1 - u) * (1 - v) + values[1] * u * (1 - v) + values[2] * (1 - u) * v + values[3] * u * v;
    return m.tangent(east, north, absolute);
  }
  localFromGeo(lat, lon) {
    if (!this.site || !this.mesh) return null;
    const a = this.site.latitude_deg * DEG, b = lat * DEG, d = (lon - this.site.longitude_deg) * DEG;
    const angle = Math.acos(clamp(Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos(d), -1, 1));
    const bearing = Math.atan2(Math.sin(d) * Math.cos(b), Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(d));
    const radius = R_MOON + this.mesh.elevation;
    let horizontal = radius * Math.tan(angle), east, north, z;
    for (let i = 0; i < 3; i++) {
      east = horizontal * Math.sin(bearing); north = horizontal * Math.cos(bearing);
      z = this.heightAt(east, north); if (z == null) return null;
      horizontal = (radius + z) * Math.tan(angle);
    }
    return [east, north, z];
  }
  geoFromLocal(east, north, up) {
    const distance = Math.hypot(east, north), bearing = Math.atan2(east, north);
    const angle = Math.atan2(distance, R_MOON + (this.site?.ground_elevation_m || 0) + up);
    const lat0 = this.site.latitude_deg * DEG, lon0 = this.site.longitude_deg * DEG;
    const lat = Math.asin(Math.sin(lat0) * Math.cos(angle) + Math.cos(lat0) * Math.sin(angle) * Math.cos(bearing));
    const lon = lon0 + Math.atan2(Math.sin(bearing) * Math.sin(angle) * Math.cos(lat0), Math.cos(angle) - Math.sin(lat0) * Math.sin(lat));
    return { lat: lat / DEG, lon: ((lon / DEG + 540) % 360) - 180 };
  }

  drawPin(x, y, color, label) {
    const ctx = this.ctx;
    ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.strokeStyle = color; ctx.globalAlpha = .35; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = '#152233'; ctx.lineWidth = 1.5; ctx.stroke();
    if (label) this.label(label, x, y - 18, color);
  }
  label(text, x, y, color = '#c5d2df') {
    const ctx = this.ctx;
    ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const width = ctx.measureText(text).width + 12;
    x = clamp(x, width / 2 + 6, this.width - width / 2 - 6); y = clamp(y, 15, this.height - 15);
    ctx.fillStyle = 'rgba(12,24,38,.73)'; ctx.fillRect(x - width / 2, y - 9, width, 18);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }
  drawArrow(start, end, color) {
    const ctx = this.ctx, a = Math.atan2(end.y - start.y, end.x - start.x);
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(end.x, end.y); ctx.lineTo(end.x - 8 * Math.cos(a - .4), end.y - 8 * Math.sin(a - .4)); ctx.lineTo(end.x - 8 * Math.cos(a + .4), end.y - 8 * Math.sin(a + .4)); ctx.closePath(); ctx.fill();
  }
  drawCompass(basis) {
    const ctx = this.ctx, x = this.width - 38, y = 44;
    const north = { x: x + basis.right[1] * 23, y: y - basis.up[1] * 23 };
    this.drawArrow({ x, y }, north, '#a4b4c5');
    ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#c6d1dc'; ctx.fillText('N', north.x, north.y - 10);
  }
  drawScale(scale, span) {
    const candidates = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
    const target = Math.min(span / 4, 90 / scale);
    const metres = candidates.filter(n => n <= target).pop() || 10, length = metres * scale;
    const ctx = this.ctx, x = this.width - 26 - length, y = this.height - 34;
    ctx.strokeStyle = '#a7b6c5'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y - 3); ctx.lineTo(x, y); ctx.lineTo(x + length, y); ctx.lineTo(x + length, y - 3); ctx.stroke();
    ctx.fillStyle = '#a7b6c5'; ctx.textAlign = 'center'; ctx.font = '9px system-ui, sans-serif'; ctx.fillText(metres >= 1000 ? `${metres / 1000} km` : `${metres} m`, x + length / 2, y - 11);
  }
  cornerText(text) {
    const ctx = this.ctx; ctx.font = '9px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#97a8ba'; ctx.fillText(text, 17, this.height - 12);
  }
  statusText(text) {
    const ctx = this.ctx; ctx.font = '13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#94a5b8'; ctx.fillText(text, this.width / 2, this.height / 2);
  }

  pointerDown(event) {
    if (event.button != null && event.button !== 0) return;
    this.canvas.setPointerCapture?.(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.pointerStart = { x: event.clientX, y: event.clientY, time: performance.now() };
    this.previous = { x: event.clientX, y: event.clientY };
    this.dragging = false; this.canvas.style.cursor = 'grabbing';
    if (this.pointers.size === 2) this.pinchDistance = this.pointerDistance();
  }
  pointerDistance() { const [a, b] = [...this.pointers.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; }
  pointerMove(event) {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size > 1) {
      const distance = this.pointerDistance();
      if (this.pinchDistance > 0) this.zoom = clamp(this.zoom * distance / this.pinchDistance, .55, 5);
      this.pinchDistance = distance; this.dragging = true; this.requestRender(); return;
    }
    const dx = event.clientX - this.previous.x, dy = event.clientY - this.previous.y;
    this.previous = { x: event.clientX, y: event.clientY };
    if (Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) > 4) this.dragging = true;
    if (!this.dragging) return;
    if (this.mode === '2d' && !this.home) { this.panX += dx; this.panY += dy; }
    else if (this.scope === 'moon') { this.longitude -= dx * .006 / Math.sqrt(this.zoom); this.latitude = clamp(this.latitude + dy * .005 / Math.sqrt(this.zoom), -Math.PI / 2 + .01, Math.PI / 2 - .01); }
    else { this.yaw -= dx * .006; this.pitch = clamp(this.pitch + dy * .005, .15, Math.PI / 2 - .02); }
    this.requestRender();
  }
  pointerUp(event, cancelled = false) {
    const wasDragging = this.dragging;
    this.pointers.delete(event.pointerId);
    try { this.canvas.releasePointerCapture?.(event.pointerId); } catch { /* Pointer may already have been released. */ }
    if (!cancelled && !wasDragging && this.pointerStart && !this.home) {
      const rect = this.canvas.getBoundingClientRect(); this.pick(event.clientX - rect.left, event.clientY - rect.top);
    }
    if (!this.pointers.size) { this.dragging = false; this.pointerStart = null; this.canvas.style.cursor = 'grab'; }
    else this.previous = [...this.pointers.values()][0];
    this.requestRender();
  }
  keyDown(event) {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home'];
    if (!keys.includes(event.key)) return; event.preventDefault();
    if (event.key === 'Home') { this.resetView(); return; }
    if (['+', '=', '-'].includes(event.key)) this.zoom = clamp(this.zoom * (event.key === '-' ? .9 : 1.1), .55, 5);
    else {
      const dx = event.key === 'ArrowLeft' ? -.1 : event.key === 'ArrowRight' ? .1 : 0;
      const dy = event.key === 'ArrowUp' ? .08 : event.key === 'ArrowDown' ? -.08 : 0;
      if (this.mode === '2d' && !this.home) { this.panX -= dx * 250; this.panY += dy * 250; }
      else if (this.scope === 'moon') { this.longitude += dx; this.latitude = clamp(this.latitude + dy, -1.56, 1.56); }
      else { this.yaw += dx; this.pitch = clamp(this.pitch + dy, .15, Math.PI / 2 - .02); }
    }
    this.requestRender();
  }
  pick(x, y) {
    const pin = this.hitPins.find(p => Math.hypot(p.x - x, p.y - y) < 12);
    if (pin) { this.options.onPick?.(pin.cluster ? { cluster: true } : { siteId: pin.siteId }); return; }
    let point;
    if (this.scope === 'moon') {
      if (this.mode === '2d' && this.flatProjection) {
        const p = this.flatProjection;
        if (x < p.x || x > p.x + p.width || y < p.y || y > p.y + p.height) return;
        point = { lat: 90 - (y - p.y) / p.height * 180, lon: (x - p.x) / p.width * 360 - 180 };
      } else if (this.globeProjection) {
        const p = this.globeProjection, nx = (x - p.cx) / p.radius, ny = (p.cy - y) / p.radius;
        const z2 = 1 - nx * nx - ny * ny; if (z2 < 0) return;
        const nz = Math.sqrt(z2), { right, up, front } = p.basis;
        const v = right.map((value, k) => value * nx + up[k] * ny + front[k] * nz);
        point = { lat: Math.asin(clamp(v[1], -1, 1)) / DEG, lon: Math.atan2(-v[2], v[0]) / DEG };
      }
    } else if (this.mesh && this.site) {
      for (let i = this.projectedTriangles.length - 1; i >= 0; i--) {
        const { p, tri } = this.projectedTriangles[i], [a, b, c] = p;
        if (x < Math.min(a.x, b.x, c.x) || x > Math.max(a.x, b.x, c.x) || y < Math.min(a.y, b.y, c.y) || y > Math.max(a.y, b.y, c.y)) continue;
        const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
        if (Math.abs(denominator) < 1e-9) continue;
        const u = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / denominator;
        const v = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / denominator;
        const t = 1 - u - v;
        if (u < -.001 || v < -.001 || t < -.001) continue;
        const vertices = tri.indices.map(index => this.mesh.vertices[index].p);
        const hit = [0, 1, 2].map(k => u * vertices[0][k] + v * vertices[1][k] + t * vertices[2][k]);
        point = this.geoFromLocal(...hit); break;
      }
    }
    if (point && Number.isFinite(point.lat) && Number.isFinite(point.lon)) { this.setPin(point.lat, point.lon); this.options.onPick?.(point); }
  }
  destroy() {
    this.destroyed = true; this.resizeObserver.disconnect(); this.visibilityObserver?.disconnect();
    if (this.frame != null) cancelAnimationFrame(this.frame);
    for (const [name, handler] of Object.entries(this.handlers)) this.canvas.removeEventListener(name, handler);
  }
}
