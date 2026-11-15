import * as THREE from 'three';

// ============================================================================
// PROCEDURAL PBR CREWED LUNAR LANDER
// Matches reference silhouette:
// - 4 radial A-frame titanium landing legs + dished footpads flush at y = 0
// - Lower matte-white cylindrical descent stage + curved silver front shield
// - 4 upper gold RCS thruster quads + recessed central descent engine nozzle
// - Dark annular service catwalk collar + safety railing + 8 V-truss struts
// - 6 Voronoi-crinkled gold Kapton MLI spherical propellant tanks
// - Horizontal capsule crew module with 3-pane forward cockpit windows & side airlocks
// - Vertical mast + 10-gore pleated circular Ultraflex photovoltaic dish
// - Variable-thrust vacuum engine plume + regolith glow for 5s powered descent
// ============================================================================

export interface LunarLanderBuildResult {
  group: THREE.Group;
  solarDishPivot: THREE.Group;
  setDescentThrust: (thrust01: number, altitudeM: number, elapsedSec: number) => void;
  dispose: () => void;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates seamless Voronoi-crinkled gold Kapton MLI textures (albedo, normal, roughness).
 */
function createKaptonGoldTextures(maxAniso = 4): {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const size = 512;
  const heightBuf = new Float32Array(size * size);
  const rand = mulberry32(731942);

  const buildPoints = (gridN: number) => {
    const pts = new Float32Array(gridN * gridN * 2);
    for (let gy = 0; gy < gridN; gy++) {
      for (let gx = 0; gx < gridN; gx++) {
        const i = (gy * gridN + gx) * 2;
        pts[i] = (gx + 0.15 + 0.7 * rand()) / gridN;
        pts[i + 1] = (gy + 0.15 + 0.7 * rand()) / gridN;
      }
    }
    return pts;
  };

  const octaves = [
    { gridN: 9, pts: buildPoints(9), weight: 0.56 },
    { gridN: 20, pts: buildPoints(20), weight: 0.30 },
    { gridN: 42, pts: buildPoints(42), weight: 0.14 },
  ];

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      let h = 0;
      for (let o = 0; o < octaves.length; o++) {
        const { gridN, pts, weight } = octaves[o];
        const cx = Math.floor(u * gridN);
        const cy = Math.floor(v * gridN);
        let d1 = 999;
        let d2 = 999;
        let tilt = 0;

        for (let oy = -1; oy <= 1; oy++) {
          const ny = (cy + oy + gridN) % gridN;
          for (let ox = -1; ox <= 1; ox++) {
            const nx = (cx + ox + gridN) % gridN;
            const pIdx = (ny * gridN + nx) * 2;
            let dx = pts[pIdx] - u;
            let dy = pts[pIdx + 1] - v;
            if (dx > 0.5) dx -= 1;
            if (dx < -0.5) dx += 1;
            if (dy > 0.5) dy -= 1;
            if (dy < -0.5) dy += 1;
            const dist = Math.hypot(dx, dy) * gridN;
            if (dist < d1) {
              d2 = d1;
              d1 = dist;
              tilt = dx * 0.72 - dy * 0.68;
            } else if (dist < d2) {
              d2 = dist;
            }
          }
        }

        const crease = Math.exp(-Math.max(0, d2 - d1) * 4.6);
        const slope = Math.tanh(tilt * 2.1) * 0.38;
        h += (1.0 - crease * 0.85 + slope) * weight;
      }
      heightBuf[y * size + x] = h;
    }
  }

  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = size;
  albedoCanvas.height = size;
  const aCtx = albedoCanvas.getContext('2d')!;
  const aImg = aCtx.createImageData(size, size);

  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = size;
  normalCanvas.height = size;
  const nCtx = normalCanvas.getContext('2d')!;
  const nImg = nCtx.createImageData(size, size);

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d')!;
  const rImg = rCtx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    const yp = (y - 1 + size) % size;
    const yn = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xp = (x - 1 + size) % size;
      const xn = (x + 1) % size;
      const idx = y * size + x;
      const p4 = idx * 4;

      const hC = heightBuf[idx];
      const dx = (heightBuf[y * size + xn] - heightBuf[y * size + xp]) * 4.2;
      const dy = (heightBuf[yn * size + x] - heightBuf[yp * size + x]) * 4.2;
      const nx = -dx;
      const ny = -dy;
      const nz = 1.0;
      const inv = 1.0 / Math.hypot(nx, ny, nz);

      nImg.data[p4] = Math.round((nx * inv * 0.5 + 0.5) * 255);
      nImg.data[p4 + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
      nImg.data[p4 + 2] = Math.round((nz * inv * 0.5 + 0.5) * 255);
      nImg.data[p4 + 3] = 255;

      const shade = THREE.MathUtils.clamp(0.65 + (hC - 0.5) * 0.45, 0.38, 1.08);
      aImg.data[p4] = Math.min(255, Math.round(212 * shade));
      aImg.data[p4 + 1] = Math.min(255, Math.round(148 * shade));
      aImg.data[p4 + 2] = Math.min(255, Math.round(32 * shade));
      aImg.data[p4 + 3] = 255;

      const rVal = Math.round(THREE.MathUtils.clamp(0.24 + (1.0 - hC) * 0.28, 0.16, 0.58) * 255);
      rImg.data[p4] = rVal;
      rImg.data[p4 + 1] = rVal;
      rImg.data[p4 + 2] = rVal;
      rImg.data[p4 + 3] = 255;
    }
  }

  aCtx.putImageData(aImg, 0, 0);
  nCtx.putImageData(nImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);

  const map = new THREE.CanvasTexture(albedoCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = maxAniso;

  const normalMap = new THREE.CanvasTexture(normalCanvas);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.anisotropy = maxAniso;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = maxAniso;

  return { map, normalMap, roughnessMap };
}

/**
 * Generates crisp matte aerospace hull paneling texture with subtle panel seams and rivets.
 */
function createDescentHullTexture(maxAniso = 4): THREE.CanvasTexture {
  const w = 1024;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0.0, '#d9dde4');
  grad.addColorStop(0.5, '#cfd4dc');
  grad.addColorStop(1.0, '#bfc5cf');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Subtle vertical composite gore seams & circumferential ring seams
  ctx.strokeStyle = 'rgba(42, 48, 58, 0.22)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    const x = Math.round((i / 8) * w);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (const ry of [0.16, 0.48, 0.82]) {
    const y = Math.round(ry * h);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Dark instrumentation band near upper collar
  ctx.fillStyle = 'rgba(30, 36, 46, 0.72)';
  ctx.fillRect(0, Math.round(h * 0.84), w, 6);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  return tex;
}

/**
 * Generates pleated circular Ultraflex solar array dish texture matching the 10-gore radial pattern.
 */
function createUltraflexSolarTexture(maxAniso = 4): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size * 0.5;
  const cy = size * 0.5;

  ctx.fillStyle = '#33465e';
  ctx.fillRect(0, 0, size, size);

  const sectors = 10;
  const rOuter = size * 0.49;
  const rInner = size * 0.115;

  // Radial alternating pleated solar sectors
  for (let s = 0; s < sectors; s++) {
    const a0 = (s / sectors) * Math.PI * 2;
    const a1 = ((s + 1) / sectors) * Math.PI * 2;
    const aMid = (a0 + a1) * 0.5;

    // Two half-gore bevel faces per sector for crisp accordion solar shading
    for (let half = 0; half < 2; half++) {
      const ha0 = half === 0 ? a0 : aMid;
      const ha1 = half === 0 ? aMid : a1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ha0) * rInner, cy + Math.sin(ha0) * rInner);
      ctx.lineTo(cx + Math.cos(ha0) * rOuter, cy + Math.sin(ha0) * rOuter);
      ctx.lineTo(cx + Math.cos(ha1) * rOuter, cy + Math.sin(ha1) * rOuter);
      ctx.lineTo(cx + Math.cos(ha1) * rInner, cy + Math.sin(ha1) * rInner);
      ctx.closePath();

      const g = ctx.createRadialGradient(cx, cy, rInner, cx, cy, rOuter);
      if (half === 0) {
        g.addColorStop(0, '#5a7696');
        g.addColorStop(0.55, '#4b6584');
        g.addColorStop(1, '#3c536e');
      } else {
        g.addColorStop(0, '#445c78');
        g.addColorStop(0.55, '#374c64');
        g.addColorStop(1, '#2b3d52');
      }
      ctx.fillStyle = g;
      ctx.fill();
    }
  }

  // Concentric photovoltaic cell string arcs
  ctx.strokeStyle = 'rgba(205, 224, 245, 0.22)';
  ctx.lineWidth = 2.0;
  for (let rFrac = 0.17; rFrac <= 0.47; rFrac += 0.033) {
    const r = size * rFrac;
    ctx.beginPath();
    for (let s = 0; s <= sectors; s++) {
      const a = (s / sectors) * Math.PI * 2;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (s === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // Crisp radial aluminum spar ribs
  ctx.strokeStyle = 'rgba(195, 212, 228, 0.48)';
  ctx.lineWidth = 3.2;
  for (let s = 0; s < sectors; s++) {
    const a = (s / sectors) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * rInner, cy + Math.sin(a) * rInner);
    ctx.lineTo(cx + Math.cos(a) * rOuter, cy + Math.sin(a) * rOuter);
    ctx.stroke();
  }

  // Dark central deployable hub
  ctx.beginPath();
  ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
  ctx.fillStyle = '#181a1f';
  ctx.fill();
  ctx.strokeStyle = '#6b7280';
  ctx.lineWidth = 4;
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

/**
 * Helper to create a tubular strut mesh spanning precisely between two 3D points.
 */
function createStrutBetween(
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  radius: number,
  mat: THREE.Material,
  trackGeo: <T extends THREE.BufferGeometry>(g: T) => T,
  radialSegs = 10
): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(p1, p0);
  const len = Math.max(0.001, dir.length());
  const geo = trackGeo(new THREE.CylinderGeometry(radius, radius, len, radialSegs));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(p0).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildLunarLanderModel(maxAniso = 4): LunarLanderBuildResult {
  const root = new THREE.Group();
  root.name = 'LunaShift_Crewed_Lunar_Lander';

  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geos.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    mats.push(m);
    return m;
  };
  const trackTex = <T extends THREE.Texture>(t: T): T => {
    texs.push(t);
    return t;
  };

  // =========================================================================
  // 1. AEROSPACE PBR MATERIALS & TEXTURES
  // =========================================================================
  const hullTex = trackTex(createDescentHullTexture(maxAniso));
  const goldMaps = createKaptonGoldTextures(maxAniso);
  trackTex(goldMaps.map);
  trackTex(goldMaps.normalMap);
  trackTex(goldMaps.roughnessMap);
  const solarTex = trackTex(createUltraflexSolarTexture(maxAniso));

  const whiteHullMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: hullTex,
      color: 0xe6e9ef,
      roughness: 0.62,
      metalness: 0.08,
      envMapIntensity: 0.28,
    })
  );

  const cabinWhiteMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xdfe3ea,
      roughness: 0.54,
      metalness: 0.12,
      envMapIntensity: 0.35,
    })
  );

  const brushedSilverMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xcbd2dc,
      roughness: 0.26,
      metalness: 0.88,
      envMapIntensity: 0.72,
    })
  );

  const darkTitaniumMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x262930,
      roughness: 0.44,
      metalness: 0.78,
      envMapIntensity: 0.45,
    })
  );

  const nozzleMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x1b1d22,
      roughness: 0.48,
      metalness: 0.82,
      envMapIntensity: 0.35,
    })
  );

  const goldKaptonMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: goldMaps.map,
      normalMap: goldMaps.normalMap,
      normalScale: new THREE.Vector2(1.15, 1.15),
      roughnessMap: goldMaps.roughnessMap,
      roughness: 0.34,
      metalness: 0.90,
      envMapIntensity: 0.82,
    })
  );

  const cockpitGlassMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0x0c1320,
      roughness: 0.08,
      metalness: 0.25,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
      envMapIntensity: 1.1,
    })
  );

  const solarDishMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: solarTex,
      roughness: 0.32,
      metalness: 0.42,
      side: THREE.DoubleSide,
      envMapIntensity: 0.65,
    })
  );

  // =========================================================================
  // 2. FOUR RADIAL A-FRAME LANDING LEGS & DISHED FOOTPADS (GROUNDED y = 0)
  // =========================================================================
  const legAngles = [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75];
  const padRadiusFromCenter = 2.48;
  const padGeo = trackGeo(new THREE.CylinderGeometry(0.32, 0.37, 0.08, 24));
  const padRimGeo = trackGeo(new THREE.TorusGeometry(0.33, 0.025, 8, 24));
  padRimGeo.rotateX(Math.PI / 2);
  const ankleGeo = trackGeo(new THREE.SphereGeometry(0.085, 14, 12));
  const clevisGeo = trackGeo(new THREE.CylinderGeometry(0.065, 0.065, 0.14, 12));

  for (const ang of legAngles) {
    const cosA = Math.cos(ang);
    const sinA = Math.sin(ang);
    const tanX = -sinA;
    const tanZ = cosA;

    const padPos = new THREE.Vector3(cosA * padRadiusFromCenter, 0.04, sinA * padRadiusFromCenter);
    const footPad = new THREE.Mesh(padGeo, brushedSilverMat);
    footPad.position.copy(padPos);
    footPad.castShadow = true;
    footPad.receiveShadow = true;
    root.add(footPad);

    const padRim = new THREE.Mesh(padRimGeo, darkTitaniumMat);
    padRim.position.set(padPos.x, 0.075, padPos.z);
    root.add(padRim);

    const anklePos = new THREE.Vector3(padPos.x, 0.095, padPos.z);
    const ankle = new THREE.Mesh(ankleGeo, darkTitaniumMat);
    ankle.position.copy(anklePos);
    root.add(ankle);

    // Primary upper shock-absorber compression strut (from descent shoulder down to footpad)
    const upperHip = new THREE.Vector3(cosA * 1.24, 2.02, sinA * 1.24);
    root.add(createStrutBetween(upperHip, anklePos, 0.048, brushedSilverMat, trackGeo, 12));

    const hipBracket = new THREE.Mesh(clevisGeo, darkTitaniumMat);
    hipBracket.position.copy(upperHip);
    hipBracket.rotation.y = -ang;
    root.add(hipBracket);

    // Twin lower V-brace struts gripping the base skirt
    for (const side of [-1, 1]) {
      const sideAng = ang + side * 0.24;
      const lowerRoot = new THREE.Vector3(Math.cos(sideAng) * 1.22, 0.86, Math.sin(sideAng) * 1.22);
      root.add(createStrutBetween(lowerRoot, anklePos, 0.032, brushedSilverMat, trackGeo, 10));
    }

    // Mid-strut diagonal tie link for articulated suspension realism
    const midHip = new THREE.Vector3(
      cosA * 1.25 + tanX * 0.0,
      1.34,
      sinA * 1.25 + tanZ * 0.0
    );
    const midLegTarget = new THREE.Vector3().lerpVectors(upperHip, anklePos, 0.56);
    root.add(createStrutBetween(midHip, midLegTarget, 0.028, darkTitaniumMat, trackGeo, 8));
  }

  // =========================================================================
  // 3. LOWER CYLINDRICAL DESCENT STAGE, CURVED SILVER FRONT SHIELD & ENGINE
  // =========================================================================
  // Lower dark aft skirt ring
  const baseSkirtGeo = trackGeo(new THREE.CylinderGeometry(1.225, 1.18, 0.16, 48));
  const baseSkirt = new THREE.Mesh(baseSkirtGeo, darkTitaniumMat);
  baseSkirt.position.y = 0.64;
  baseSkirt.castShadow = true;
  baseSkirt.receiveShadow = true;
  root.add(baseSkirt);

  // Main cylindrical propellant & avionics barrel
  const mainHullGeo = trackGeo(new THREE.CylinderGeometry(1.22, 1.22, 2.02, 48));
  const mainHull = new THREE.Mesh(mainHullGeo, whiteHullMat);
  mainHull.position.y = 1.72;
  mainHull.castShadow = true;
  mainHull.receiveShadow = true;
  root.add(mainHull);

  // Upper beveled conical shoulder taper up to service deck
  const upperTaperGeo = trackGeo(new THREE.CylinderGeometry(1.14, 1.22, 0.28, 48));
  const upperTaper = new THREE.Mesh(upperTaperGeo, whiteHullMat);
  upperTaper.position.y = 2.86;
  upperTaper.castShadow = true;
  upperTaper.receiveShadow = true;
  root.add(upperTaper);

  // Mid horizontal dark structural belt
  const beltRingGeo = trackGeo(new THREE.CylinderGeometry(1.235, 1.235, 0.055, 48));
  const beltRing = new THREE.Mesh(beltRingGeo, darkTitaniumMat);
  beltRing.position.y = 1.04;
  root.add(beltRing);

  // Prominent curved brushed-silver front shield / elevator panel facing -Z
  // CylinderGeometry theta=0 is +Z, theta=Math.PI is -Z (forward face!)
  const frontArcSpan = Math.PI * 0.36;
  const frontShieldGeo = trackGeo(
    new THREE.CylinderGeometry(
      1.26,
      1.26,
      1.96,
      24,
      1,
      false,
      Math.PI - frontArcSpan * 0.5,
      frontArcSpan
    )
  );
  const frontShield = new THREE.Mesh(frontShieldGeo, brushedSilverMat);
  frontShield.position.y = 1.70;
  frontShield.castShadow = true;
  frontShield.receiveShadow = true;
  root.add(frontShield);

  // Backing dark recess frame along the curved shield edges
  const shieldFrameGeo = trackGeo(
    new THREE.CylinderGeometry(
      1.245,
      1.245,
      2.00,
      24,
      1,
      false,
      Math.PI - frontArcSpan * 0.52,
      frontArcSpan * 1.04
    )
  );
  const shieldFrame = new THREE.Mesh(shieldFrameGeo, darkTitaniumMat);
  shieldFrame.position.y = 1.70;
  root.add(shieldFrame);

  // 4 Gold RCS Thruster Quads near upper shoulder collar (match golden cruciform pods in photo)
  const rcsAngles = [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75];
  const rcsPodGeo = trackGeo(new THREE.BoxGeometry(0.11, 0.14, 0.11));
  const rcsNozzleGeo = trackGeo(new THREE.ConeGeometry(0.036, 0.085, 12));
  for (const ang of rcsAngles) {
    const rcsGroup = new THREE.Group();
    rcsGroup.position.set(Math.cos(ang) * 1.25, 2.54, Math.sin(ang) * 1.25);
    rcsGroup.rotation.y = -ang;

    const pod = new THREE.Mesh(rcsPodGeo, darkTitaniumMat);
    rcsGroup.add(pod);

    const nozUp = new THREE.Mesh(rcsNozzleGeo, goldKaptonMat);
    nozUp.position.y = 0.095;
    rcsGroup.add(nozUp);

    const nozDown = new THREE.Mesh(rcsNozzleGeo, goldKaptonMat);
    nozDown.rotation.x = Math.PI;
    nozDown.position.y = -0.095;
    rcsGroup.add(nozDown);

    for (const tz of [-0.075, 0.075]) {
      const nozSide = new THREE.Mesh(rcsNozzleGeo, goldKaptonMat);
      nozSide.rotation.x = tz > 0 ? Math.PI / 2 : -Math.PI / 2;
      nozSide.position.z = tz;
      rcsGroup.add(nozSide);
    }
    root.add(rcsGroup);
  }

  // Central Descent Rocket Engine Bell underneath the lower cylinder
  const engineNozzleGeo = trackGeo(new THREE.CylinderGeometry(0.17, 0.35, 0.38, 28, 1, true));
  const engineNozzle = new THREE.Mesh(engineNozzleGeo, nozzleMat);
  engineNozzle.position.y = 0.44;
  engineNozzle.material.side = THREE.DoubleSide;
  engineNozzle.castShadow = true;
  root.add(engineNozzle);

  const engineThroatGeo = trackGeo(new THREE.CircleGeometry(0.28, 24));
  engineThroatGeo.rotateX(Math.PI / 2);
  const engineThroatMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0xffc875,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
    })
  );
  const engineThroat = new THREE.Mesh(engineThroatGeo, engineThroatMat);
  engineThroat.position.y = 0.30;
  root.add(engineThroat);

  // Animated Vacuum Descent Exhaust Plume (active during 5-second touchdown descent)
  const plumeGroup = new THREE.Group();
  plumeGroup.position.y = 0.28;
  plumeGroup.visible = false;
  root.add(plumeGroup);

  const outerPlumeGeo = trackGeo(new THREE.CylinderGeometry(0.32, 1.35, 3.6, 28, 1, true));
  outerPlumeGeo.translate(0, -1.8, 0);
  const outerPlumeMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0x93c5fd,
      transparent: true,
      opacity: 0.24,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  const outerPlume = new THREE.Mesh(outerPlumeGeo, outerPlumeMat);
  plumeGroup.add(outerPlume);

  const corePlumeGeo = trackGeo(new THREE.CylinderGeometry(0.18, 0.56, 2.2, 20, 1, true));
  corePlumeGeo.translate(0, -1.1, 0);
  const corePlumeMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0xfff3d6,
      transparent: true,
      opacity: 0.52,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  const corePlume = new THREE.Mesh(corePlumeGeo, corePlumeMat);
  plumeGroup.add(corePlume);

  const descentEngineLight = new THREE.PointLight(0xffdca8, 0.0, 26.0, 1.35);
  descentEngineLight.position.set(0, 0.15, 0);
  root.add(descentEngineLight);

  // =========================================================================
  // 4. MID-DECK SERVICE PLATFORM, V-TRUSS & 6 GOLD KAPTON SPHERICAL TANKS
  // =========================================================================
  const deckGeo = trackGeo(new THREE.CylinderGeometry(1.48, 1.46, 0.12, 48));
  const serviceDeck = new THREE.Mesh(deckGeo, darkTitaniumMat);
  serviceDeck.position.y = 3.04;
  serviceDeck.castShadow = true;
  serviceDeck.receiveShadow = true;
  root.add(serviceDeck);

  // Outer perimeter safety railing along aft/sides of catwalk (leaving forward bay clean)
  const railRadius = 1.44;
  const railArc = Math.PI * 1.45;
  const topRailGeo = trackGeo(new THREE.TorusGeometry(railRadius, 0.018, 8, 40, railArc));
  topRailGeo.rotateX(Math.PI / 2);
  topRailGeo.rotateY(-Math.PI * 0.225);
  const topRail = new THREE.Mesh(topRailGeo, darkTitaniumMat);
  topRail.position.y = 3.40;
  root.add(topRail);

  const postGeo = trackGeo(new THREE.CylinderGeometry(0.016, 0.016, 0.34, 8));
  for (let p = 0; p <= 8; p++) {
    const a = -Math.PI * 0.225 + (p / 8) * railArc;
    const post = new THREE.Mesh(postGeo, darkTitaniumMat);
    post.position.set(Math.cos(a) * railRadius, 3.24, Math.sin(a) * railRadius);
    root.add(post);
  }

  // 6 Crinkled Gold Kapton MLI Spherical Propellant Tanks under the crew module
  const tankGeo = trackGeo(new THREE.SphereGeometry(0.43, 28, 22));
  const tankAngles = [
    Math.PI * 0.18,
    Math.PI * 0.45,
    Math.PI * 0.78,
    Math.PI * 1.22,
    Math.PI * 1.55,
    Math.PI * 1.82,
  ];
  for (const ang of tankAngles) {
    const tank = new THREE.Mesh(tankGeo, goldKaptonMat);
    tank.position.set(Math.cos(ang) * 0.80, 3.55, Math.sin(ang) * 0.80);
    tank.rotation.set(ang * 0.7, ang * 1.3, ang * 0.4);
    tank.castShadow = true;
    tank.receiveShadow = true;
    root.add(tank);
  }

  // Diagonal V-truss support struts carrying the crew module above the service deck
  const trussNodes: [THREE.Vector3, THREE.Vector3][] = [
    [new THREE.Vector3(-1.12, 3.09, -0.52), new THREE.Vector3(-0.62, 4.18, -0.45)],
    [new THREE.Vector3(-0.56, 3.09, -1.08), new THREE.Vector3(-0.62, 4.18, -0.45)],
    [new THREE.Vector3(1.12, 3.09, -0.52), new THREE.Vector3(0.62, 4.18, -0.45)],
    [new THREE.Vector3(0.56, 3.09, -1.08), new THREE.Vector3(0.62, 4.18, -0.45)],
    [new THREE.Vector3(-1.12, 3.09, 0.52), new THREE.Vector3(-0.62, 4.18, 0.45)],
    [new THREE.Vector3(-0.56, 3.09, 1.08), new THREE.Vector3(-0.62, 4.18, 0.45)],
    [new THREE.Vector3(1.12, 3.09, 0.52), new THREE.Vector3(0.62, 4.18, 0.45)],
    [new THREE.Vector3(0.56, 3.09, 1.08), new THREE.Vector3(0.62, 4.18, 0.45)],
    [new THREE.Vector3(0.0, 3.09, -1.24), new THREE.Vector3(0.0, 4.02, -0.68)],
    [new THREE.Vector3(0.0, 3.09, 1.24), new THREE.Vector3(0.0, 4.02, 0.68)],
  ];
  for (const [p0, p1] of trussNodes) {
    root.add(createStrutBetween(p0, p1, 0.036, brushedSilverMat, trackGeo, 10));
  }

  // =========================================================================
  // 5. HORIZONTAL CAPSULE CREW MODULE (FORWARD COCKPIT FACING -Z)
  // =========================================================================
  const cabinY = 4.66;
  const cabinR = 0.78;
  const cabinLen = 0.88;

  const cabinBarrelGeo = trackGeo(new THREE.CylinderGeometry(cabinR, cabinR, cabinLen, 40));
  cabinBarrelGeo.rotateX(Math.PI / 2);
  const cabinBarrel = new THREE.Mesh(cabinBarrelGeo, cabinWhiteMat);
  cabinBarrel.position.set(0, cabinY, 0);
  cabinBarrel.castShadow = true;
  cabinBarrel.receiveShadow = true;
  root.add(cabinBarrel);

  // Hemispherical front (-Z) & rear (+Z) domes
  const domeGeo = trackGeo(new THREE.SphereGeometry(cabinR, 36, 24));
  const frontDome = new THREE.Mesh(domeGeo, cabinWhiteMat);
  frontDome.scale.set(1, 1, 0.92);
  frontDome.position.set(0, cabinY, -cabinLen * 0.5);
  frontDome.castShadow = true;
  frontDome.receiveShadow = true;
  root.add(frontDome);

  const rearDome = new THREE.Mesh(domeGeo, cabinWhiteMat);
  rearDome.scale.set(1, 1, 0.88);
  rearDome.position.set(0, cabinY, cabinLen * 0.5);
  rearDome.castShadow = true;
  rearDome.receiveShadow = true;
  root.add(rearDome);

  // 3-Pane Forward Cockpit Window Band on the front dome (facing -Z)
  const centerWinGeo = trackGeo(new THREE.BoxGeometry(0.28, 0.16, 0.08));
  const centerWin = new THREE.Mesh(centerWinGeo, cockpitGlassMat);
  centerWin.position.set(0, cabinY + 0.08, -cabinLen * 0.5 - cabinR * 0.86);
  centerWin.rotation.x = -0.14;
  root.add(centerWin);

  const sideWinGeo = trackGeo(new THREE.BoxGeometry(0.22, 0.15, 0.08));
  for (const s of [-1, 1]) {
    const sideWin = new THREE.Mesh(sideWinGeo, cockpitGlassMat);
    sideWin.position.set(s * 0.28, cabinY + 0.075, -cabinLen * 0.5 - cabinR * 0.78);
    sideWin.rotation.set(-0.14, s * 0.36, 0);
    root.add(sideWin);
  }

  // Left & Right Cylindrical Side Airlock / Docking Hatch Drums
  const airlockBarrelGeo = trackGeo(new THREE.CylinderGeometry(0.46, 0.49, 0.34, 32));
  airlockBarrelGeo.rotateZ(Math.PI / 2);
  const hatchFaceGeo = trackGeo(new THREE.CylinderGeometry(0.35, 0.35, 0.04, 28));
  hatchFaceGeo.rotateZ(Math.PI / 2);

  for (const s of [-1, 1]) {
    const airlock = new THREE.Mesh(airlockBarrelGeo, cabinWhiteMat);
    airlock.position.set(s * 0.72, cabinY, 0.08);
    airlock.castShadow = true;
    airlock.receiveShadow = true;
    root.add(airlock);

    const hatch = new THREE.Mesh(hatchFaceGeo, brushedSilverMat);
    hatch.position.set(s * 0.895, cabinY, 0.08);
    root.add(hatch);
  }

  // Top cylindrical turret / mast base hub
  const topTurretGeo = trackGeo(new THREE.CylinderGeometry(0.34, 0.38, 0.18, 28));
  const topTurret = new THREE.Mesh(topTurretGeo, cabinWhiteMat);
  topTurret.position.set(0, cabinY + cabinR + 0.02, 0.02);
  topTurret.castShadow = true;
  root.add(topTurret);

  const topCapGeo = trackGeo(new THREE.CylinderGeometry(0.24, 0.32, 0.06, 24));
  const topCap = new THREE.Mesh(topCapGeo, darkTitaniumMat);
  topCap.position.set(0, cabinY + cabinR + 0.13, 0.02);
  root.add(topCap);

  // =========================================================================
  // 6. TOP MAST & 10-GORE PLEATED CIRCULAR ULTRAFLEX SOLAR ARRAY DISH
  // =========================================================================
  const mastH = 1.48;
  const mastGeo = trackGeo(new THREE.CylinderGeometry(0.032, 0.042, mastH, 12));
  const solarMast = new THREE.Mesh(mastGeo, brushedSilverMat);
  solarMast.position.set(0, cabinY + cabinR + 0.14 + mastH * 0.5, 0.02);
  solarMast.castShadow = true;
  root.add(solarMast);

  const solarDishPivot = new THREE.Group();
  solarDishPivot.position.set(0, 7.12, 0.02);
  // Slight backward tilt (~10°) so circular array catches low Sun glare cleanly from front
  solarDishPivot.rotation.x = 0.16;
  root.add(solarDishPivot);

  // Build pleated 10-sided decagonal solar dish geometry with radial ridge/valley facets
  const dishSectors = 10;
  const dishSubSteps = 2; // valley -> ridge per sector
  const totalDishSegs = dishSectors * dishSubSteps;
  const dishRadius = 1.18;
  const dishGeo = trackGeo(new THREE.CircleGeometry(dishRadius, totalDishSegs));
  const posAttr = dishGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vy = posAttr.getY(i);
    const r = Math.hypot(vx, vy);
    if (r > 0.12) {
      const ang = Math.atan2(vy, vx);
      const pleat = Math.cos(ang * dishSectors) * 0.042 * (r / dishRadius);
      posAttr.setZ(i, pleat);
    }
  }
  dishGeo.computeVertexNormals();

  const solarDishMesh = new THREE.Mesh(dishGeo, solarDishMat);
  solarDishMesh.castShadow = true;
  solarDishMesh.receiveShadow = true;
  solarDishPivot.add(solarDishMesh);

  // Central gimbal & rear truss ring on the solar array hub
  const hubGeo = trackGeo(new THREE.CylinderGeometry(0.24, 0.24, 0.10, 24));
  hubGeo.rotateX(Math.PI / 2);
  const solarHub = new THREE.Mesh(hubGeo, darkTitaniumMat);
  solarHub.castShadow = true;
  solarDishPivot.add(solarHub);

  // =========================================================================
  // 7. ANIMATED DESCENT ENGINE PLUME CONTROLLER
  // =========================================================================
  const setDescentThrust = (thrust01: number, altitudeM: number, elapsedSec: number) => {
    const t = THREE.MathUtils.clamp(thrust01, 0, 1);
    if (t <= 0.005) {
      plumeGroup.visible = false;
      engineThroatMat.opacity = 0.0;
      descentEngineLight.intensity = 0.0;
      return;
    }

    plumeGroup.visible = true;
    const flicker = 0.92 + 0.08 * Math.sin(elapsedSec * 46.0) + 0.05 * Math.cos(elapsedSec * 71.0);
    // Flare wider when close to the regolith surface (ground-effect plume impingement)
    const groundProximity = 1.0 - THREE.MathUtils.smoothstep(altitudeM, 0.2, 6.5);
    const spreadXZ = (0.75 + 0.55 * t + groundProximity * 0.65) * flicker;
    const plumeLenY = THREE.MathUtils.clamp((0.45 + 0.85 * t) * flicker, 0.25, Math.max(0.28, (altitudeM + 0.28) / 3.4));

    plumeGroup.scale.set(spreadXZ, plumeLenY, spreadXZ);
    outerPlumeMat.opacity = 0.26 * t * flicker;
    corePlumeMat.opacity = 0.62 * t * flicker;
    engineThroatMat.opacity = 0.92 * t;
    descentEngineLight.intensity = (6.5 + groundProximity * 6.0) * t * flicker;
  };

  return {
    group: root,
    solarDishPivot,
    setDescentThrust,
    dispose: () => {
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      texs.forEach((t) => t.dispose());
    },
  };
}
