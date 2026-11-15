import * as T from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { interpolateHorizon } from './core/solar-model.js';

const D = Math.PI / 180;
const vec = (az, el, r = 1) =>
  new T.Vector3(Math.sin(az * D) * Math.cos(el * D) * r, Math.sin(el * D) * r, -Math.cos(az * D) * Math.cos(el * D) * r);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function textureCanvas(w, h, fn) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  fn(c.getContext('2d'), w, h);
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  return t;
}

function panelTexture() {
  return textureCanvas(512, 256, (c, w, h) => {
    c.fillStyle = '#0b1837';
    c.fillRect(0, 0, w, h);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 10; x++) {
        const px = x * 50 + 6;
        const py = y * 62 + 5;
        const g = c.createLinearGradient(px, py, px + 48, py + 58);
        g.addColorStop(0, '#193d7c');
        g.addColorStop(0.5, '#101e4b');
        g.addColorStop(1, '#253e80');
        c.fillStyle = g;
        c.fillRect(px, py, 46, 56);
        c.strokeStyle = '#7a92b14f';
        c.lineWidth = 1;
        c.strokeRect(px, py, 46, 56);
        c.fillStyle = '#9dabc14a';
        c.fillRect(px + 14, py, 1, 56);
        c.fillRect(px + 30, py, 1, 56);
      }
    }
  });
}

function regolithTexture() {
  let seed = 913;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  return textureCanvas(512, 512, (c, w, h) => {
    const a = c.createImageData(w, h);
    for (let i = 0; i < a.data.length; i += 4) {
      const v = 120 + rand() * 55;
      a.data[i] = v;
      a.data[i + 1] = v;
      a.data[i + 2] = v;
      a.data[i + 3] = 255;
    }
    c.putImageData(a, 0, 0);
  });
}

function cylinderBetween(a, b, r, material, segments = 10) {
  const d = b.clone().sub(a);
  const m = new T.Mesh(new T.CylinderGeometry(r, r, d.length(), segments), material);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize());
  m.castShadow = true;
  return m;
}

function discard(object) {
  object.traverse((o) => {
    o.geometry?.dispose();
    if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
    else o.material?.dispose();
  });
}

export class MissionScene {
  constructor(canvas, { onCamera, labelsEl } = {}) {
    this.canvas = canvas;
    this.onCamera = onCamera;
    this.sample = null;
    this.result = null;
    this.reveal = true;
    this.mode = 'orbit';
    this.active = true;
    this.cameraGoal = null;
    this.disposed = false;

    this.scene = new T.Scene();
    this.scene.background = new T.Color('#101827');
    this.camera = new T.PerspectiveCamera(44, 1, 0.05, 20000);
    this.camera.position.set(7, 4.4, 9);

    this.renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.16;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.target.set(0, 1, 0);
    this.controls.maxDistance = 2200;
    this.controls.minDistance = 3;
    this.controls.maxPolarAngle = Math.PI * 0.54;
    this.controls.enablePan = true;
    this.controls.addEventListener('start', () => {
      this.cameraGoal = null;
    });

    this.sunLight = new T.DirectionalLight(0xfff5e0, 3.5);
    this.sunLight.position.set(100, 4, -100);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.left = -12;
    this.sunLight.shadow.camera.right = 12;
    this.sunLight.shadow.camera.top = 12;
    this.sunLight.shadow.camera.bottom = -12;
    this.sunLight.shadow.camera.near = 0.1;
    this.sunLight.shadow.camera.far = 400;
    this.sunLight.shadow.bias = -0.0002;
    this.sunLight.shadow.normalBias = 0.02;
    this.scene.add(this.sunLight, this.sunLight.target);

    this.fill = new T.HemisphereLight(0xb8cbd9, 0x20252b, 0.68);
    this.scene.add(this.fill);
    this.scene.add(new T.AmbientLight(0xc0cad8, 0.18));

    const pts = [];
    const rnd = (() => {
      let s = 43;
      return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
      };
    })();
    for (let i = 0; i < 650; i++) {
      const v = new T.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize().multiplyScalar(9000);
      pts.push(v.x, v.y, v.z);
    }
    const starGeo = new T.BufferGeometry();
    starGeo.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
    this.stars = new T.Points(
      starGeo,
      new T.PointsMaterial({ color: 0xc2c9d1, size: 3, sizeAttenuation: true, transparent: true, opacity: 0.45 })
    );
    this.scene.add(this.stars);

    this.landGroup = new T.Group();
    this.scene.add(this.landGroup);
    this.craft = new T.Group();
    this.scene.add(this.craft);
    this.buildLander();

    this.sun = this.makeBody('sun');
    this.earth = this.makeBody('earth');
    this.labels = labelsEl || document.getElementById('sceneLabels');
    this.eye = new T.Vector3(0, 2, 0);

    this.regolith = regolithTexture();
    this.regolith.wrapS = this.regolith.wrapT = T.RepeatWrapping;
    this.regolith.repeat.set(90, 90);

    this.earthImage = new Image();
    this.earthImage.src = '/assets/earth-illustration.webp';
    this.earthImage.onload = () => {
      if (!this.disposed && this.sample) this.updateBodies();
    };

    this.beamMat = new T.LineDashedMaterial({ color: 0x72d6c7, transparent: true, opacity: 0.5, dashSize: 0.8, gapSize: 0.5 });
    this.beam = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]), this.beamMat);
    this.scene.add(this.beam);

    this.bitSprites = [];
    for (let i = 0; i < 20; i++) {
      const tex = textureCanvas(32, 48, (c, w, h) => {
        c.font = 'bold 35px monospace';
        c.fillStyle = '#8debd8';
        c.textAlign = 'center';
        c.fillText(i % 2 ? '1' : '0', w / 2, 37);
      });
      const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, depthTest: false, transparent: true, opacity: 0.9 }));
      sp.scale.set(0.18, 0.27, 1);
      sp.visible = false;
      this.bitSprites.push(sp);
      this.scene.add(sp);
    }

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
    this.draw = () => this.animate();
    this.raf = requestAnimationFrame(this.draw);
  }

  makeBody(kind) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const tex = new T.CanvasTexture(canvas);
    tex.colorSpace = T.SRGBColorSpace;
    const mesh = new T.Sprite(
      new T.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false, toneMapped: false })
    );
    mesh.renderOrder = 3;
    this.scene.add(mesh);
    const ghostTex = textureCanvas(256, 256, (c) => {
      c.strokeStyle = kind === 'sun' ? '#d3b876' : '#89b5d7';
      c.lineWidth = 3;
      c.setLineDash([8, 9]);
      c.beginPath();
      c.arc(128, 128, 108, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
      c.globalAlpha = 0.25;
      for (let q = -1; q <= 1; q++) {
        c.beginPath();
        c.ellipse(128, 128, Math.abs(q) * 35 + 25, 108, 0, 0, Math.PI * 2);
        c.stroke();
      }
      c.beginPath();
      c.ellipse(128, 128, 108, 35, 0, 0, Math.PI * 2);
      c.stroke();
    });
    const ghost = new T.Sprite(
      new T.SpriteMaterial({ map: ghostTex, transparent: true, depthTest: false, depthWrite: false, opacity: 0.6, toneMapped: false })
    );
    ghost.renderOrder = 10;
    this.scene.add(ghost);
    return { mesh, ghost, canvas, tex, ghostTex, kind };
  }

  buildLander() {
    this.craft.clear();
    const metal = new T.MeshStandardMaterial({ color: 0xc6cbd0, metalness: 0.78, roughness: 0.35 });
    const dark = new T.MeshStandardMaterial({ color: 0x202831, metalness: 0.65, roughness: 0.4 });
    const foil = new T.MeshStandardMaterial({ color: 0xa48851, metalness: 0.72, roughness: 0.48 });
    const white = new T.MeshStandardMaterial({ color: 0xdadbd7, roughness: 0.55, metalness: 0.22 });
    const mesh = (g, m, x = 0, y = 0, z = 0) => {
      const o = new T.Mesh(g, m);
      o.position.set(x, y, z);
      o.castShadow = true;
      o.receiveShadow = true;
      this.craft.add(o);
      return o;
    };
    mesh(new T.CylinderGeometry(0.7, 0.78, 0.85, 8), foil, 0, 1.13, 0);
    mesh(new T.CylinderGeometry(0.83, 0.83, 0.08, 8), metal, 0, 1.58, 0);
    mesh(new T.CylinderGeometry(0.8, 0.8, 0.09, 8), dark, 0, 0.69, 0);
    mesh(new T.BoxGeometry(0.88, 0.32, 0.72), white, 0, 1.72, 0);
    mesh(new T.BoxGeometry(0.9, 0.07, 0.74), dark, 0, 1.92, 0);
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const rib = mesh(new T.BoxGeometry(0.024, 0.77, 0.028), metal, Math.cos(a) * 0.75, 1.15, Math.sin(a) * 0.75);
      rib.rotation.y = -a;
    }
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const foot = new T.Vector3(Math.cos(a) * 1.5, 0.06, Math.sin(a) * 1.5);
      const upper = new T.Vector3(Math.cos(a) * 0.63, 1.35, Math.sin(a) * 0.63);
      const lower = new T.Vector3(Math.cos(a) * 0.68, 0.75, Math.sin(a) * 0.68);
      this.craft.add(cylinderBetween(upper, foot, 0.045, metal), cylinderBetween(lower, foot, 0.027, dark));
      mesh(new T.CylinderGeometry(0.22, 0.25, 0.07, 20), dark, foot.x, 0.04, foot.z);
      const sleeve = upper.clone().lerp(foot, 0.5);
      this.craft.add(cylinderBetween(upper.clone().lerp(foot, 0.25), sleeve, 0.07, foil));
    }
    mesh(new T.ConeGeometry(0.24, 0.35, 18, 1, true), dark, 0, 0.43, 0).rotation.x = Math.PI;
    this.panelRoots = [];
    this.panelTex = panelTexture();
    for (const sign of [-1, 1]) {
      this.craft.add(cylinderBetween(new T.Vector3(sign * 0.65, 1.8, 0), new T.Vector3(sign * 1.5, 2, 0), 0.028, metal));
      const root = new T.Group();
      root.position.set(sign * 1.65, 2, 0);
      this.craft.add(root);
      const backing = new T.Mesh(new T.BoxGeometry(1.24, 0.54, 0.04), metal);
      root.add(backing);
      const active = new T.Mesh(
        new T.PlaneGeometry(1.2, 0.5),
        new T.MeshStandardMaterial({ map: this.panelTex, metalness: 0.5, roughness: 0.3, side: T.DoubleSide, emissive: 0x0b1535, emissiveIntensity: 0.2 })
      );
      active.position.z = 0.022;
      root.add(active);
      this.panelRoots.push(root);
    }
    this.craft.add(cylinderBetween(new T.Vector3(0.15, 1.9, -0.1), new T.Vector3(0.15, 2, -0.1), 0.035, metal));
    this.dish = new T.Group();
    this.dish.position.set(0.15, 2, -0.1);
    this.craft.add(this.dish);
    const pts = [];
    for (let j = 0; j <= 20; j++) {
      const r = (0.46 * j) / 20;
      pts.push(new T.Vector2(r, 0.5 * r * r));
    }
    const dishMesh = new T.Mesh(
      new T.LatheGeometry(pts, 48),
      new T.MeshStandardMaterial({ color: 0xe1e5e3, metalness: 0.55, roughness: 0.3, side: T.DoubleSide })
    );
    dishMesh.rotation.x = Math.PI / 2;
    this.dish.add(dishMesh);
    const ring = new T.Mesh(new T.TorusGeometry(0.46, 0.012, 8, 48), metal);
    this.dish.add(ring);
    this.dish.add(cylinderBetween(new T.Vector3(), new T.Vector3(0, 0, 0.3), 0.012, metal));
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3;
      this.dish.add(cylinderBetween(new T.Vector3(Math.cos(a) * 0.45, Math.sin(a) * 0.45, 0), new T.Vector3(0, 0, 0.3), 0.008, metal));
    }
    this.scienceLens = mesh(
      new T.CylinderGeometry(0.14, 0.14, 0.25, 24),
      new T.MeshStandardMaterial({ color: 0x3c9e9c, metalness: 0.6, roughness: 0.2, emissive: 0x176d66, emissiveIntensity: 0.3 }),
      0.35,
      1.45,
      0.77
    );
    this.scienceLens.rotation.x = Math.PI / 2;
    mesh(new T.BoxGeometry(0.33, 0.28, 0.2), white, -0.3, 1.45, 0.75);
    const ringGeo = new T.RingGeometry(1.75, 1.77, 100);
    const ringMat = new T.MeshBasicMaterial({ color: 0xc5b579, transparent: true, opacity: 0.45, side: T.DoubleSide, depthWrite: false });
    this.baseRing = new T.Mesh(ringGeo, ringMat);
    this.baseRing.rotation.x = -Math.PI / 2;
    this.baseRing.position.y = 0.045;
    this.scene.add(this.baseRing);
  }

  setResult(result, bundle) {
    const changed = this.result?.site.id !== result.site.id;
    this.result = result;
    this.bundle = bundle;
    if (changed) {
      this.site = bundle.sites.find((s) => s.id === result.site.id);
      this.buildTerrain();
      this.setCamera('orbit', true);
    } else {
      this.buildHorizon();
    }
    const scale = Math.sqrt(result.settings.areaM2 / 1.2);
    for (const p of this.panelRoots) {
      p.scale.set(scale, scale, 1);
      p.position.y = result.settings.heightM;
    }
    this.dish.position.y = result.settings.antennaHeightM;
    this.eye.y = this.terrainHeight(0, 0) + result.settings.heightM;
    this.buildHorizon();
  }

  terrainHeight(e, n) {
    const m = this.site.mesh;
    const c = clamp((e - m.origin_x_m) / m.spacing_m, 0, m.width - 1);
    const r = clamp((n - m.origin_y_m) / m.spacing_m, 0, m.height - 1);
    const i = Math.min(m.width - 2, Math.floor(c));
    const j = Math.min(m.height - 2, Math.floor(r));
    const u = c - i;
    const v = r - j;
    return (
      (m.elevations_m[j][i] * (1 - u) + m.elevations_m[j][i + 1] * u) * (1 - v) +
      (m.elevations_m[j + 1][i] * (1 - u) + m.elevations_m[j + 1][i + 1] * u) * v -
      this.site.ground_elevation_m -
      (e * e + n * n) / (2 * 1737400)
    );
  }

  buildTerrain() {
    while (this.landGroup.children.length) {
      const o = this.landGroup.children[0];
      this.landGroup.remove(o);
      discard(o);
    }
    const m = this.site.mesh;
    const positions = [];
    const uv = [];
    const indices = [];
    for (let r = 0; r < m.height; r++) {
      for (let c = 0; c < m.width; c++) {
        const x = m.origin_x_m + c * m.spacing_m;
        const n = m.origin_y_m + r * m.spacing_m;
        positions.push(x, this.terrainHeight(x, n), -n);
        uv.push(c / (m.width - 1), r / (m.height - 1));
      }
    }
    for (let r = 0; r < m.height - 1; r++) {
      for (let c = 0; c < m.width - 1; c++) {
        const a = r * m.width + c;
        const b = a + 1;
        const d = a + m.width;
        const e = d + 1;
        indices.push(a, b, d, b, e, d);
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    const terrain = new T.Mesh(
      g,
      new T.MeshStandardMaterial({ color: 0xb5b0a6, roughness: 1, metalness: 0, map: this.regolith, side: T.DoubleSide })
    );
    terrain.receiveShadow = true;
    this.landGroup.add(terrain);
    const base = this.terrainHeight(0, 0);
    this.craft.position.y = base;
    this.baseRing.position.y = base + 0.04;
    this.eye.set(0, base + 2, 0);
    this.buildHorizon();
  }

  buildHorizon() {
    if (this.rim) {
      this.scene.remove(this.rim);
      discard(this.rim);
    }
    if (!this.result) return;
    const hor = this.result.horizon;
    const pos = [];
    const idx = [];
    const radius = 3500;
    for (let i = 0; i <= 720; i++) {
      const az = i * 0.5;
      const e = interpolateHorizon(hor.azimuthDeg, hor.elevationDeg, az);
      const v = vec(az, 0, radius);
      pos.push(v.x, Math.tan(e * D) * radius + this.eye.y, v.z, v.x, -3500, v.z);
    }
    for (let i = 0; i < 720; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.rim = new T.Mesh(g, new T.MeshBasicMaterial({ color: 0x30363b, side: T.DoubleSide }));
    this.scene.add(this.rim);
  }

  setCamera(mode, instant = false) {
    this.mode = mode;
    const eye = this.eye || new T.Vector3(0, 2, 0);
    const p = this.sample;
    let at = new T.Vector3(0, (this.craft?.position.y || 0) + 0.8, 0);
    let to = vec((p?.sunAzDeg ?? this.result?.samples?.[0]?.sunAzDeg ?? 240) + 28, 22, 9.8).add(at);
    if (mode === 'surface') {
      to = eye.clone().add(new T.Vector3(0, 0.2, 3.6));
      at = to.clone().add(vec(p?.sunAzDeg ?? 260, 0, 50));
    }
    if (mode === 'sun' || mode === 'earth') {
      const az = p ? (mode === 'sun' ? p.sunAzDeg : p.earthAzDeg) : 260;
      const el = p ? (mode === 'sun' ? p.sunElDeg : p.earthElDeg) : 0;
      to = eye.clone().add(new T.Vector3(0, 0, 0.03));
      at = to.clone().add(vec(az, el, 120));
    }
    if (mode === 'map') {
      to = new T.Vector3(0, 2200, 1);
      at = new T.Vector3(0, 0, 0);
    }
    if (instant) {
      this.camera.position.copy(to);
      this.controls.target.copy(at);
      this.controls.update();
    } else {
      this.cameraGoal = { to, at };
    }
    this.controls.minDistance = ['sun', 'earth', 'surface'].includes(mode) ? 0.05 : 3;
    this.onCamera?.(mode);
  }

  setReveal(value) {
    this.reveal = value;
    if (this.sample) this.updateBodies();
  }

  setSample(sample) {
    this.sample = sample;
    if (!sample || !this.result) return;
    for (const bit of this.bitSprites) bit.visible = !!sample.transmitting;
    const s = this.result.settings;
    const az = s.panelMode === 'fixed' ? s.azimuthDeg : sample.sunAzDeg;
    const tilt =
      s.panelMode === 'horizontal'
        ? 0
        : s.panelMode === 'fixed'
        ? s.tiltDeg
        : s.panelMode === 'tracking'
        ? 90 - sample.sunElDeg
        : 90;
    const normal = vec(az, 90 - tilt);
    for (const p of this.panelRoots) p.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), normal);
    this.dish.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), vec(sample.stationAzDeg, sample.stationElDeg));
    this.sunLight.position.copy(vec(sample.sunAzDeg, sample.sunElDeg, 150));
    this.sunLight.target.position.set(0, 1, 0);
    this.sunLight.intensity = 0.2 + 3.5 * sample.sunFraction;
    this.scienceLens.material.emissiveIntensity = sample.scienceActive ? 1.8 : 0.12;
    this.updateBodies();
  }

  updateBodies() {
    const p = this.sample;
    if (!p || !this.result) return;
    for (const body of [this.sun, this.earth]) {
      const isSun = body.kind === 'sun';
      const az = isSun ? p.sunAzDeg : p.earthAzDeg;
      const el = isSun ? p.sunElDeg : p.earthElDeg;
      const r = isSun ? p.sunAngularRadiusDeg : Math.asin(6378.137 / p.earthDistanceKm) / D;
      const horizon = isSun ? this.result.horizon : this.result.antennaHorizon;
      const fraction = isSun ? p.sunFraction : p.earthFraction;
      const c = body.canvas.getContext('2d');
      c.clearRect(0, 0, 256, 256);
      c.save();
      c.beginPath();
      c.arc(128, 128, 112, 0, Math.PI * 2);
      c.clip();
      if (isSun) {
        const g = c.createRadialGradient(100, 85, 10, 128, 128, 120);
        g.addColorStop(0, '#fffce5');
        g.addColorStop(0.65, '#ffeaaa');
        g.addColorStop(1, '#eac46d');
        c.fillStyle = g;
        c.fillRect(0, 0, 256, 256);
      } else if (this.earthImage.complete && this.earthImage.naturalWidth) {
        c.drawImage(this.earthImage, 16, 16, 224, 224);
      } else {
        c.fillStyle = '#5384a0';
        c.fillRect(0, 0, 256, 256);
      }
      c.globalCompositeOperation = 'destination-out';
      c.fillStyle = '#000';
      for (let x = 0; x < 256; x++) {
        const dx = ((x - 128) / 112) * r;
        const h = interpolateHorizon(horizon.azimuthDeg, horizon.elevationDeg, az + dx / Math.max(0.01, Math.cos(el * D)));
        const y = 128 - ((h - el) / r) * 112;
        c.fillRect(x, clamp(y, 0, 256), 1, 256);
      }
      if (isSun) {
        const dx = (((p.earthAzDeg - p.sunAzDeg + 540) % 360) - 180) * Math.cos(el * D);
        const dy = p.earthElDeg - p.sunElDeg;
        const er = Math.asin(6378.137 / p.earthDistanceKm) / D;
        if (Math.hypot(dx, dy) < r + er) {
          c.beginPath();
          c.arc(128 + (dx / r) * 112, 128 - (dy / r) * 112, (er / r) * 112, 0, Math.PI * 2);
          c.fill();
        }
      }
      c.restore();
      body.tex.needsUpdate = true;
      const pos = vec(az, el, 6000).add(this.eye);
      body.mesh.position.copy(pos);
      body.ghost.position.copy(pos);
      const diameter = (2 * 6000 * Math.tan(r * D) * 256) / 224;
      body.mesh.scale.set(diameter, diameter, 1);
      body.ghost.scale.set(diameter, diameter, 1);
      body.mesh.visible = fraction > 1e-5;
      body.ghost.visible = this.reveal && fraction < 0.999;
      body.ghost.material.opacity = fraction < 0.001 ? 0.55 : 0.28;
    }
  }

  project(v) {
    const p = v.clone().project(this.camera);
    return { x: ((p.x + 1) / 2) * this.width, y: ((1 - p.y) / 2) * this.height, front: p.z < 1 && p.z > -1 };
  }

  updateLabels() {
    if (!this.labels || !this.sample) return;
    const p = this.sample;
    for (const name of ['sun', 'earth']) {
      const label = this.labels.querySelector(`[data-body="${name}"]`);
      if (!label) continue;
      const b = this[name];
      const q = this.project(b.mesh.position);
      const frac = name === 'sun' ? p.sunFraction : p.earthFraction;
      const az = name === 'sun' ? p.sunAzDeg : p.earthAzDeg;
      const el = name === 'sun' ? p.sunElDeg : p.earthElDeg;
      const inside = q.front && q.x > 38 && q.x < this.width - 180 && q.y > 42 && q.y < this.height - 60;
      label.style.left = `${inside ? q.x + 16 : name === 'sun' ? 20 : this.width - 192}px`;
      label.style.top = `${inside ? q.y - 20 : 100}px`;
      label.classList.toggle('offscreen', !inside);
      label.classList.toggle('hidden-body', frac < 0.001);
      label.style.display = frac < 0.001 && !this.reveal ? 'none' : '';
      label.querySelector('strong').textContent = name === 'sun' ? 'Sun' : 'Earth';
      label.querySelector('small').textContent =
        (frac < 0.001 ? 'Hidden · ' : frac < 0.999 ? 'Partial · ' : inside ? 'Visible · ' : 'Direction · ') + el.toFixed(1) + '°';
      label.title = `Azimuth ${az.toFixed(1)}°. ${Math.round(frac * 100)}% visible at the selected observer height. Click to face ${name}.`;
    }
  }

  resize() {
    if (!this.canvas.parentElement) return;
    const box = this.canvas.parentElement.getBoundingClientRect();
    if (box.width < 5 || box.height < 5) return;
    this.width = box.width;
    this.height = box.height;
    this.renderer.setSize(box.width, box.height, false);
    this.camera.aspect = box.width / box.height;
    this.camera.updateProjectionMatrix();
  }

  animate() {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.draw);
    const now = performance.now();
    const dt = Math.min(0.25, (now - (this.previousFrame || now)) / 1000);
    this.previousFrame = now;
    if (!this.active || document.hidden) return;
    if (this.cameraGoal) {
      const f = 1 - Math.exp(-9 * dt);
      this.camera.position.lerp(this.cameraGoal.to, f);
      this.controls.target.lerp(this.cameraGoal.at, f);
      if (this.camera.position.distanceTo(this.cameraGoal.to) < 0.02 && this.controls.target.distanceTo(this.cameraGoal.at) < 0.02) {
        this.camera.position.copy(this.cameraGoal.to);
        this.controls.target.copy(this.cameraGoal.at);
        this.cameraGoal = null;
      }
    }
    this.controls.update();
    if (this.sample) {
      const p = this.sample;
      const begin = this.dish.getWorldPosition(new T.Vector3());
      const end = begin.clone().add(vec(p.stationAzDeg, p.stationElDeg, 25));
      this.beam.geometry.setFromPoints([begin, end]);
      this.beam.computeLineDistances();
      this.beam.visible = !!p.linkAvailable;
      this.beamMat.opacity = p.transmitting ? 0.6 : 0.16;
      const tick = performance.now() / 1000;
      this.bitSprites.forEach((sp, i) => {
        sp.visible = !!p.transmitting;
        if (sp.visible) {
          const f = (i / this.bitSprites.length + tick * 0.34) % 1;
          sp.position.copy(begin).lerp(end, f);
          sp.material.opacity = 0.2 + 0.75 * Math.sin(f * Math.PI);
          const dist = sp.position.distanceTo(this.camera.position);
          const pixel = (2 * dist * Math.tan((this.camera.fov * D) / 2)) / this.height;
          sp.scale.set(pixel * 8, pixel * 12, 1);
        }
      });
    }
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => discard(o));
    this.regolith?.dispose();
    this.panelTex?.dispose();
    this.sun?.tex?.dispose();
    this.sun?.ghostTex?.dispose();
    this.earth?.tex?.dispose();
    this.earth?.ghostTex?.dispose();
    this.bitSprites?.forEach((sp) => sp.material?.map?.dispose());
    this.renderer.dispose();
  }
}
