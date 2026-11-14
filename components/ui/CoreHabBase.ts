import * as THREE from 'three';

// ============================================================================
// COREHAB LUNAR SURFACE HABITAT — NASA INSPECTION-GRADE PROCEDURAL PBR REPLICA
// Mirrors corehab-beautyshot.png:
// - 4-bay quilted MMOD white thermal blanket hull + corner gussets + twin-stud louvers
// - 5 beveled dark charcoal ring ribs + fore/aft 12-gore pillowed hemispherical domes
// - Anodized cobalt-blue 8-rib recessed docking collars + rounded-rect EVA hatches,
//   dark tinted portholes, twin amber-gold EVA grab handrails & chrome dogging latches
// - 4-bay brushed-aluminum lower Warren-truss skid cradle (flush bottom-center y = 0)
// - Crinkled gold Kapton MLI lower main tanks + mid-deck horizontal manifold tanks
// - 12 crinkled silver MLI pressure bottles with 6 dark clamping bands each
// - Dual-bank 8-fin brushed-aluminum radiator cabinet + gold Kapton side cheeks +
//   horizontal glowing rose-pink thermal bar
// - Overhead roof rack truss + dark equipment cassette + warm-tan folded deployable
//   blanket stack + twin cylindrical end-roller drums
// ============================================================================

export interface CoreHabBuildResult {
  group: THREE.Group;
  colliderHalfExtents: { halfWidthX: number; halfLengthZ: number };
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
 * Generates high-resolution seamless procedural PBR maps (albedo + tangent normal + roughness)
 * for crinkled aerospace Kapton (gold) and aluminized Mylar (silver) MLI blankets using
 * multi-scale Voronoi facet creases + micro-crumple harmonics.
 */
function createCrinkledFoilTextures(
  variant: 'gold' | 'silver',
  size = 1024,
  maxAniso = 4
): {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const heightBuf = new Float32Array(size * size);
  const rand = mulberry32(variant === 'gold' ? 918273 : 445566);

  // Tileable Voronoi feature points across 3 frequency octaves for crisp crinkled foil facets
  const buildVoronoiPoints = (gridN: number) => {
    const pts = new Float32Array(gridN * gridN * 2);
    for (let gy = 0; gy < gridN; gy++) {
      for (let gx = 0; gx < gridN; gx++) {
        const i = (gy * gridN + gx) * 2;
        pts[i + 0] = (gx + 0.14 + 0.72 * rand()) / gridN;
        pts[i + 1] = (gy + 0.14 + 0.72 * rand()) / gridN;
      }
    }
    return pts;
  };

  const octaves = [
    { gridN: 10, pts: buildVoronoiPoints(10), weight: 0.56 },
    { gridN: 22, pts: buildVoronoiPoints(22), weight: 0.30 },
    { gridN: 46, pts: buildVoronoiPoints(46), weight: 0.14 },
  ];

  // Sample cellular ridge height (F2 - F1 sharp crease ridges + faceted tilt)
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      let h = 0;
      for (let o = 0; o < octaves.length; o++) {
        const { gridN, pts, weight } = octaves[o];
        const cx = Math.floor(u * gridN);
        const cy = Math.floor(v * gridN);
        let d1 = 999.0;
        let d2 = 999.0;
        let tilt = 0.0;

        for (let oy = -1; oy <= 1; oy++) {
          const ny = (cy + oy + gridN) % gridN;
          for (let ox = -1; ox <= 1; ox++) {
            const nx = (cx + ox + gridN) % gridN;
            const pIdx = (ny * gridN + nx) * 2;
            let dx = pts[pIdx + 0] - u;
            let dy = pts[pIdx + 1] - v;
            if (dx > 0.5) dx -= 1.0;
            if (dx < -0.5) dx += 1.0;
            if (dy > 0.5) dy -= 1.0;
            if (dy < -0.5) dy += 1.0;
            const dist = Math.hypot(dx, dy) * gridN;
            if (dist < d1) {
              d2 = d1;
              d1 = dist;
              tilt = dx * 0.75 - dy * 0.65;
            } else if (dist < d2) {
              d2 = dist;
            }
          }
        }

        const edgeDist = Math.max(0, d2 - d1);
        const crease = Math.exp(-edgeDist * 4.8);
        const facetSlope = Math.tanh(tilt * 2.2) * 0.38;
        h += (1.0 - crease * 0.85 + facetSlope) * weight;
      }

      // Subtle directional wrap tension folds along cylinder circumference
      h += Math.sin(u * Math.PI * 16.0 + Math.sin(v * Math.PI * 6.0) * 1.6) * 0.06;
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

  const normalStrength = variant === 'gold' ? 4.4 : 3.9;

  for (let y = 0; y < size; y++) {
    const yPrev = (y - 1 + size) % size;
    const yNext = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xPrev = (x - 1 + size) % size;
      const xNext = (x + 1) % size;
      const idx = y * size + x;
      const p4 = idx * 4;

      const hC = heightBuf[idx];
      const hL = heightBuf[y * size + xPrev];
      const hR = heightBuf[y * size + xNext];
      const hU = heightBuf[yPrev * size + x];
      const hD = heightBuf[yNext * size + x];

      const dx = (hR - hL) * normalStrength;
      const dy = (hD - hU) * normalStrength;
      const nx = -dx;
      const ny = -dy;
      const nz = 1.0;
      const invLen = 1.0 / Math.hypot(nx, ny, nz);

      nImg.data[p4 + 0] = Math.round((nx * invLen * 0.5 + 0.5) * 255);
      nImg.data[p4 + 1] = Math.round((ny * invLen * 0.5 + 0.5) * 255);
      nImg.data[p4 + 2] = Math.round((nz * invLen * 0.5 + 0.5) * 255);
      nImg.data[p4 + 3] = 255;

      // Foil wrinkle trough darkens slightly and increases micro-scatter roughness
      const t = THREE.MathUtils.clamp((hC - 0.35) / 0.9, 0, 1);
      const roughVal = Math.round(THREE.MathUtils.lerp(132, 54, t));
      rImg.data[p4 + 0] = roughVal;
      rImg.data[p4 + 1] = roughVal;
      rImg.data[p4 + 2] = roughVal;
      rImg.data[p4 + 3] = 255;

      if (variant === 'gold') {
        // Rich NASA amber-gold Kapton MLI gradient (warm bronze creases -> brilliant gold ridges)
        aImg.data[p4 + 0] = Math.round(THREE.MathUtils.lerp(166, 246, t));
        aImg.data[p4 + 1] = Math.round(THREE.MathUtils.lerp(94, 178, t));
        aImg.data[p4 + 2] = Math.round(THREE.MathUtils.lerp(12, 34, t));
      } else {
        // Aluminized silver-white MLI foil gradient
        const s = Math.round(THREE.MathUtils.lerp(158, 232, t));
        aImg.data[p4 + 0] = s;
        aImg.data[p4 + 1] = Math.min(255, s + 2);
        aImg.data[p4 + 2] = Math.min(255, s + 6);
      }
      aImg.data[p4 + 3] = 255;
    }
  }

  aCtx.putImageData(aImg, 0, 0);
  nCtx.putImageData(nImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);

  const map = new THREE.CanvasTexture(albedoCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = maxAniso;

  const normalMap = new THREE.CanvasTexture(normalCanvas);
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.anisotropy = maxAniso;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = maxAniso;

  return { map, normalMap, roughnessMap };
}

/**
 * Generates a crisp 2048x1024 quilted MMOD thermal blanket PBR texture set for the 4-bay hull:
 * - Off-white thermal fabric weave & gentle panel pillowing
 * - Crisp bay divisions + longitudinal panel seams + corner diamond stitch gussets
 * - Twin-stud horizontal fastener louver band along the lower cylinder flank
 */
function createHullBlanketTextures(maxAniso = 4): {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const w = 2048;
  const h = 1024;

  const aCanvas = document.createElement('canvas');
  aCanvas.width = w;
  aCanvas.height = h;
  const aCtx = aCanvas.getContext('2d')!;

  const nCanvas = document.createElement('canvas');
  nCanvas.width = w;
  nCanvas.height = h;
  const nCtx = nCanvas.getContext('2d')!;

  const rCanvas = document.createElement('canvas');
  rCanvas.width = w;
  rCanvas.height = h;
  const rCtx = rCanvas.getContext('2d')!;

  // Base ceramic-white / aerospace MMOD cloth
  aCtx.fillStyle = '#d7d9dd';
  aCtx.fillRect(0, 0, w, h);

  // Neutral tangent normal fill
  nCtx.fillStyle = 'rgb(128, 128, 255)';
  nCtx.fillRect(0, 0, w, h);

  // Base matte-cloth roughness (~0.66)
  rCtx.fillStyle = 'rgb(168, 168, 168)';
  rCtx.fillRect(0, 0, w, h);

  const rand = mulberry32(202604);

  // Subtle fabric micro-texture & gentle panel tonal variance across 4 bays (U) x 16 strips (V)
  const bayCount = 4;
  const stripCount = 16;
  const bayW = w / bayCount;
  const stripH = h / stripCount;

  for (let by = 0; by < stripCount; by++) {
    for (let bx = 0; bx < bayCount; bx++) {
      for (let sub = 0; sub < 2; sub++) {
        const px = bx * bayW + sub * (bayW * 0.5);
        const py = by * stripH;
        const pw = bayW * 0.5;
        const ph = stripH;

        const shadeShift = Math.round((rand() - 0.5) * 9);
        const baseV = 215 + shadeShift;
        const grad = aCtx.createLinearGradient(px, py, px, py + ph);
        grad.addColorStop(0.0, `rgb(${baseV - 10}, ${baseV - 9}, ${baseV - 7})`);
        grad.addColorStop(0.14, `rgb(${baseV + 2}, ${baseV + 3}, ${baseV + 5})`);
        grad.addColorStop(0.5, `rgb(${baseV + 6}, ${baseV + 7}, ${baseV + 9})`);
        grad.addColorStop(0.86, `rgb(${baseV + 1}, ${baseV + 2}, ${baseV + 4})`);
        grad.addColorStop(1.0, `rgb(${baseV - 12}, ${baseV - 11}, ${baseV - 9})`);
        aCtx.fillStyle = grad;
        aCtx.fillRect(px, py, pw, ph);

        // Soft quilted pillow bevel in normal map
        const nGrad = nCtx.createLinearGradient(px, py, px, py + ph);
        nGrad.addColorStop(0.0, 'rgb(128, 86, 245)');
        nGrad.addColorStop(0.16, 'rgb(128, 128, 255)');
        nGrad.addColorStop(0.84, 'rgb(128, 128, 255)');
        nGrad.addColorStop(1.0, 'rgb(128, 170, 245)');
        nCtx.fillStyle = nGrad;
        nCtx.fillRect(px, py, pw, ph);
      }
    }
  }

  // Subtle Beta-cloth weave noise
  aCtx.fillStyle = 'rgba(110, 114, 120, 0.04)';
  for (let i = 0; i < 6000; i++) {
    const rx = rand() * w;
    const ry = rand() * h;
    aCtx.fillRect(rx, ry, 2, 1);
  }

  // Longitudinal seam grooves & crisp stitched tape edges
  for (let by = 0; by <= stripCount; by++) {
    const yPos = by * stripH;
    aCtx.fillStyle = 'rgba(72, 76, 84, 0.58)';
    aCtx.fillRect(0, yPos - 1.5, w, 3);
    nCtx.fillStyle = 'rgb(128, 72, 240)';
    nCtx.fillRect(0, yPos - 2, w, 2);
    nCtx.fillStyle = 'rgb(128, 184, 240)';
    nCtx.fillRect(0, yPos, w, 2);
  }

  // Mid-bay vertical blanket seams + rib edge borders
  for (let bx = 0; bx < bayCount; bx++) {
    const xBay = bx * bayW;
    const xMid = xBay + bayW * 0.5;
    aCtx.fillStyle = 'rgba(86, 90, 98, 0.45)';
    aCtx.fillRect(xMid - 1.5, 0, 3, h);
    nCtx.fillStyle = 'rgb(96, 128, 245)';
    nCtx.fillRect(xMid - 2, 0, 2, h);
    nCtx.fillStyle = 'rgb(160, 128, 245)';
    nCtx.fillRect(xMid, 0, 2, h);

    // Subtle dark recessed shadow right alongside rib boundaries
    aCtx.fillStyle = 'rgba(65, 68, 76, 0.35)';
    aCtx.fillRect(xBay, 0, 6, h);
    aCtx.fillRect(xBay + bayW - 6, 0, 6, h);
  }

  // Corner diamond tie-down gusset patches at rib-seam intersections (prominent in corehab-beautyshot)
  for (let by = 0; by <= stripCount; by++) {
    const yPos = (by * stripH) % h;
    for (let bx = 0; bx <= bayCount; bx++) {
      const xPos = bx * bayW;
      for (const ox of [xPos, xPos + 6, xPos - 6]) {
        if (ox < 0 || ox > w) continue;
        aCtx.save();
        aCtx.translate(ox, yPos);
        aCtx.rotate(Math.PI / 4);
        aCtx.fillStyle = '#aeb3bc';
        aCtx.fillRect(-10, -10, 20, 20);
        aCtx.strokeStyle = '#6e737c';
        aCtx.lineWidth = 1.8;
        aCtx.strokeRect(-10, -10, 20, 20);
        aCtx.restore();
      }
    }
  }

  // Lower flank twin-stud fastener louver row (aligned at +X and -X lower hull shoulders)
  for (const flankV of [0.268, 0.732]) {
    const yBand = flankV * h;
    for (let bx = 0; bx < bayCount; bx++) {
      const bayStart = bx * bayW + 26;
      const baySpan = bayW - 52;
      const louverCount = 12;
      for (let k = 0; k < louverCount; k++) {
        const lx = bayStart + (k + 0.5) * (baySpan / louverCount);
        aCtx.fillStyle = '#7b8089';
        aCtx.fillRect(lx - 8, yBand - 7, 16, 14);
        aCtx.fillStyle = '#f2f4f7';
        aCtx.fillRect(lx - 6, yBand - 5, 12, 5);
        aCtx.fillStyle = '#3c4048';
        aCtx.fillRect(lx - 4, yBand + 1, 2.5, 4);
        aCtx.fillRect(lx + 1.5, yBand + 1, 2.5, 4);
      }
    }
  }

  const map = new THREE.CanvasTexture(aCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAniso;

  const normalMap = new THREE.CanvasTexture(nCanvas);
  normalMap.anisotropy = maxAniso;

  const roughnessMap = new THREE.CanvasTexture(rCanvas);
  roughnessMap.anisotropy = maxAniso;

  return { map, normalMap, roughnessMap };
}

/**
 * Generates radial-gore segmented MMOD blanket texture for fore & aft domes (~12 gores).
 */
function createDomeGoreTextures(maxAniso = 4): {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
} {
  const w = 1024;
  const h = 512;

  const aCanvas = document.createElement('canvas');
  aCanvas.width = w;
  aCanvas.height = h;
  const aCtx = aCanvas.getContext('2d')!;

  const nCanvas = document.createElement('canvas');
  nCanvas.width = w;
  nCanvas.height = h;
  const nCtx = nCanvas.getContext('2d')!;

  aCtx.fillStyle = '#d3d5da';
  aCtx.fillRect(0, 0, w, h);

  nCtx.fillStyle = 'rgb(128, 128, 255)';
  nCtx.fillRect(0, 0, w, h);

  const goreCount = 12;
  const goreW = w / goreCount;

  // Radial gore shading & bevels
  for (let i = 0; i < goreCount; i++) {
    const gx = i * goreW;
    const grad = aCtx.createLinearGradient(gx, 0, gx + goreW, 0);
    grad.addColorStop(0.0, '#aeb2ba');
    grad.addColorStop(0.12, '#d5d7dc');
    grad.addColorStop(0.5, '#dfe1e5');
    grad.addColorStop(0.88, '#d5d7dc');
    grad.addColorStop(1.0, '#aeb2ba');
    aCtx.fillStyle = grad;
    aCtx.fillRect(gx, 0, goreW, h);

    // Crisp seam line
    aCtx.fillStyle = 'rgba(54, 58, 66, 0.72)';
    aCtx.fillRect(gx - 1.5, 0, 3, h);

    // Gore pillow normals
    const nGrad = nCtx.createLinearGradient(gx, 0, gx + goreW, 0);
    nGrad.addColorStop(0.0, 'rgb(82, 128, 245)');
    nGrad.addColorStop(0.15, 'rgb(128, 128, 255)');
    nGrad.addColorStop(0.85, 'rgb(128, 128, 255)');
    nGrad.addColorStop(1.0, 'rgb(174, 128, 245)');
    nCtx.fillStyle = nGrad;
    nCtx.fillRect(gx, 0, goreW, h);

    // Small dark tie-down dots flanking seam lines (prominent in corehab-beautyshot)
    for (const dy of [0.28, 0.56, 0.80]) {
      aCtx.fillStyle = '#2d3138';
      aCtx.beginPath();
      aCtx.arc(gx + 10, dy * h, 3.0, 0, Math.PI * 2);
      aCtx.arc(gx + goreW - 10, dy * h, 3.0, 0, Math.PI * 2);
      aCtx.fill();
    }
  }

  // Concentric stitched seam ring midway up dome
  for (const ry of [0.35, 0.72]) {
    const y = ry * h;
    aCtx.fillStyle = 'rgba(72, 76, 84, 0.52)';
    aCtx.fillRect(0, y - 1.5, w, 3);
    nCtx.fillStyle = 'rgb(128, 86, 245)';
    nCtx.fillRect(0, y - 2, w, 2);
    nCtx.fillStyle = 'rgb(128, 170, 245)';
    nCtx.fillRect(0, y, w, 2);
  }

  const map = new THREE.CanvasTexture(aCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.anisotropy = maxAniso;

  const normalMap = new THREE.CanvasTexture(nCanvas);
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.anisotropy = maxAniso;

  return { map, normalMap };
}

/**
 * Generates brushed aerospace aluminum directional grain + subtle contact shadow apron texture.
 */
function createBrushedMetalRoughnessTexture(maxAniso = 4): THREE.CanvasTexture {
  const s = 512;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgb(76, 76, 76)';
  ctx.fillRect(0, 0, s, s);
  const rand = mulberry32(778899);
  for (let y = 0; y < s; y++) {
    const v = 64 + Math.round(rand() * 34);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(0, y, s, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  return tex;
}

function createUnderBaseContactShadowTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(w * 0.5, h * 0.5, 45, w * 0.5, h * 0.5, 245);
  grad.addColorStop(0.0, 'rgba(0, 0, 0, 0.72)');
  grad.addColorStop(0.52, 'rgba(0, 0, 0, 0.52)');
  grad.addColorStop(0.82, 'rgba(0, 0, 0, 0.16)');
  grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

/**
 * Creates a rounded-rectangle THREE.Shape centered at (0,0).
 */
function createRoundedRectShape(width: number, height: number, radius: number): THREE.Shape {
  const hw = width * 0.5;
  const hh = height * 0.5;
  const r = Math.min(radius, hw - 0.01, hh - 0.01);
  const s = new THREE.Shape();
  s.moveTo(-hw + r, -hh);
  s.lineTo(hw - r, -hh);
  s.quadraticCurveTo(hw, -hh, hw, -hh + r);
  s.lineTo(hw, hh - r);
  s.quadraticCurveTo(hw, hh, hw - r, hh);
  s.lineTo(-hw + r, hh);
  s.quadraticCurveTo(-hw, hh, -hw, hh - r);
  s.lineTo(-hw, -hh + r);
  s.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
  return s;
}

/**
 * Helper to create a strut/cylinder segment between two 3D points pA and pB.
 */
function addStrutBetween(
  parent: THREE.Object3D,
  pA: THREE.Vector3,
  pB: THREE.Vector3,
  radius: number,
  unitCylGeo: THREE.CylinderGeometry,
  mat: THREE.Material
): void {
  const dir = new THREE.Vector3().subVectors(pB, pA);
  const len = dir.length();
  if (len < 0.0001) return;
  const mesh = new THREE.Mesh(unitCylGeo, mat);
  mesh.position.copy(pA).addScaledVector(dir, 0.5);
  mesh.scale.set(radius, len, radius);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
}

/**
 * Builds the complete NASA-grade CoreHab 3D habitat assembly with bottom-center pivot at (0, 0, 0).
 */
export function buildCoreHabBase(maxAniso = 4): CoreHabBuildResult {
  const root = new THREE.Group();
  root.name = 'CoreHab_Lunar_Surface_Habitat';

  const disposablesGeo: THREE.BufferGeometry[] = [];
  const disposablesMat: THREE.Material[] = [];
  const disposablesTex: THREE.Texture[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    disposablesGeo.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    disposablesMat.push(m);
    return m;
  };
  const trackTex = <T extends THREE.Texture>(t: T): T => {
    disposablesTex.push(t);
    return t;
  };

  // =========================================================================
  // 1. PROCEDURAL PBR TEXTURES & AEROSPACE MATERIALS
  // =========================================================================
  const hullMaps = createHullBlanketTextures(maxAniso);
  trackTex(hullMaps.map);
  trackTex(hullMaps.normalMap);
  trackTex(hullMaps.roughnessMap);

  const domeMaps = createDomeGoreTextures(maxAniso);
  trackTex(domeMaps.map);
  trackTex(domeMaps.normalMap);

  const goldMaps = createCrinkledFoilTextures('gold', 1024, maxAniso);
  trackTex(goldMaps.map);
  trackTex(goldMaps.normalMap);
  trackTex(goldMaps.roughnessMap);

  const silverMaps = createCrinkledFoilTextures('silver', 1024, maxAniso);
  trackTex(silverMaps.map);
  trackTex(silverMaps.normalMap);
  trackTex(silverMaps.roughnessMap);

  const brushedRoughTex = createBrushedMetalRoughnessTexture(maxAniso);
  trackTex(brushedRoughTex);

  const shadowApronTex = createUnderBaseContactShadowTexture();
  trackTex(shadowApronTex);

  const hullBlanketMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: hullMaps.map,
      normalMap: hullMaps.normalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughnessMap: hullMaps.roughnessMap,
      roughness: 0.72,
      metalness: 0.06,
      envMapIntensity: 0.25,
    })
  );

  const domeBlanketMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: domeMaps.map,
      normalMap: domeMaps.normalMap,
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughness: 0.68,
      metalness: 0.06,
      envMapIntensity: 0.25,
    })
  );

  const darkRibMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x1d2026,
      roughness: 0.34,
      metalness: 0.72,
      envMapIntensity: 0.75,
    })
  );

  const rubberGasketMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x111317,
      roughness: 0.82,
      metalness: 0.08,
      envMapIntensity: 0.15,
    })
  );

  const cobaltCollarMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0x0f4098,
      roughness: 0.30,
      metalness: 0.82,
      clearcoat: 0.35,
      clearcoatRoughness: 0.25,
      envMapIntensity: 0.95,
    })
  );

  const hatchGrayMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xb6bcc5,
      roughnessMap: brushedRoughTex,
      roughness: 0.48,
      metalness: 0.42,
      envMapIntensity: 0.55,
    })
  );

  const portholeGlassMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0x060a12,
      roughness: 0.06,
      metalness: 0.22,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      envMapIntensity: 1.25,
    })
  );

  const amberGoldRailMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xd99b26,
      roughness: 0.24,
      metalness: 0.88,
      envMapIntensity: 0.95,
    })
  );

  const brushedAlumMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xc9ced6,
      roughnessMap: brushedRoughTex,
      roughness: 0.28,
      metalness: 0.88,
      anisotropy: 0.55,
      envMapIntensity: 0.9,
    })
  );

  const radiatorFinMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xd4d8df,
      roughnessMap: brushedRoughTex,
      roughness: 0.24,
      metalness: 0.84,
      anisotropy: 0.72,
      envMapIntensity: 0.95,
    })
  );

  const goldKaptonMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      map: goldMaps.map,
      normalMap: goldMaps.normalMap,
      normalScale: new THREE.Vector2(1.45, 1.45),
      roughnessMap: goldMaps.roughnessMap,
      roughness: 0.28,
      metalness: 0.94,
      clearcoat: 0.25,
      clearcoatRoughness: 0.22,
      envMapIntensity: 1.15,
    })
  );

  const silverMliMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      map: silverMaps.map,
      normalMap: silverMaps.normalMap,
      normalScale: new THREE.Vector2(1.35, 1.35),
      roughnessMap: silverMaps.roughnessMap,
      roughness: 0.26,
      metalness: 0.92,
      clearcoat: 0.2,
      clearcoatRoughness: 0.2,
      envMapIntensity: 1.1,
    })
  );

  const roseThermalBarMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffb3c4,
      emissive: new THREE.Color(0xff7296),
      emissiveIntensity: 2.35,
      roughness: 0.22,
      metalness: 0.15,
    })
  );

  const foldedWingMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xdfb97a,
      roughness: 0.62,
      metalness: 0.12,
      envMapIntensity: 0.35,
    })
  );

  const foldedPleatMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xc2934e,
      roughness: 0.68,
      metalness: 0.10,
      envMapIntensity: 0.30,
    })
  );

  // =========================================================================
  // 2. CANONICAL ARCHITECTURAL DIMENSIONS (METERS)
  // =========================================================================
  const R_HULL = 2.16;
  const Y_AXIS = 2.66;
  const BAY_LEN = 1.92;
  const HALF_CYL_LEN = BAY_LEN * 2.0; // 3.84m -> 7.68m cylinder span
  const DOME_DEPTH = 1.32;
  const DOME_NECK_R = 1.36;

  // =========================================================================
  // 3. PRIMARY 4-BAY PRESSURIZED HULL & 5 BEVELED CHARCOAL RING RIBS
  // =========================================================================
  // Rotate CylinderGeometry around X by +PI/2 so axis lies on Z and UV seam (theta=0) sits hidden on -Y belly,
  // then swap (u, v) -> (v, u) so canvas X maps to the 4 Z-bays and canvas Y wraps circumference.
  const hullGeo = trackGeo(new THREE.CylinderGeometry(R_HULL, R_HULL, HALF_CYL_LEN * 2.0, 64, 16, true));
  hullGeo.rotateX(Math.PI / 2);
  const hullUv = hullGeo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < hullUv.count; i++) {
    const uOrig = hullUv.getX(i);
    const vOrig = hullUv.getY(i);
    hullUv.setXY(i, vOrig, uOrig);
  }
  hullUv.needsUpdate = true;
  const hullMesh = new THREE.Mesh(hullGeo, hullBlanketMat);
  hullMesh.position.set(0, Y_AXIS, 0);
  hullMesh.castShadow = true;
  hullMesh.receiveShadow = true;
  root.add(hullMesh);

  // 5 Circumferential beveled dark charcoal ring ribs at z = -3.84, -1.92, 0.0, +1.92, +3.84
  const ribProfile = [
    new THREE.Vector2(R_HULL - 0.02, -0.078),
    new THREE.Vector2(R_HULL + 0.088, -0.056),
    new THREE.Vector2(R_HULL + 0.098, -0.028),
    new THREE.Vector2(R_HULL + 0.098, 0.028),
    new THREE.Vector2(R_HULL + 0.088, 0.056),
    new THREE.Vector2(R_HULL - 0.02, 0.078),
  ];
  const ribGeo = trackGeo(new THREE.LatheGeometry(ribProfile, 64));
  ribGeo.rotateX(Math.PI / 2);

  // End ribs are slightly wider structural adapter rings
  const endRibProfile = [
    new THREE.Vector2(R_HULL - 0.03, -0.105),
    new THREE.Vector2(R_HULL + 0.102, -0.076),
    new THREE.Vector2(R_HULL + 0.112, -0.034),
    new THREE.Vector2(R_HULL + 0.112, 0.034),
    new THREE.Vector2(R_HULL + 0.102, 0.076),
    new THREE.Vector2(R_HULL - 0.03, 0.105),
  ];
  const endRibGeo = trackGeo(new THREE.LatheGeometry(endRibProfile, 64));
  endRibGeo.rotateX(Math.PI / 2);

  for (let i = 0; i < 5; i++) {
    const rz = -HALF_CYL_LEN + i * BAY_LEN;
    const isEnd = i === 0 || i === 4;
    const rib = new THREE.Mesh(isEnd ? endRibGeo : ribGeo, darkRibMat);
    rib.position.set(0, Y_AXIS, rz);
    rib.castShadow = true;
    rib.receiveShadow = true;
    root.add(rib);
  }

  // 3D Instanced Lower Lateral Twin-Stud Fastener Louvers along both lower hull flanks
  const louverGeo = trackGeo(new THREE.BoxGeometry(0.036, 0.045, 0.078));
  const studGeo = trackGeo(new THREE.CylinderGeometry(0.008, 0.008, 0.022, 6));
  studGeo.rotateZ(Math.PI / 2);

  const louverPerBay = 11;
  const totalLouvers = 4 * louverPerBay * 2;
  const louverInst = new THREE.InstancedMesh(louverGeo, darkRibMat, totalLouvers);
  louverInst.castShadow = true;
  louverInst.receiveShadow = true;
  const studInst = new THREE.InstancedMesh(studGeo, brushedAlumMat, totalLouvers * 2);

  const lDummy = new THREE.Object3D();
  let lIdx = 0;
  let sIdx = 0;
  const flankAngle = -0.11; // right above the silver 3-stack on cylinder shoulder
  const rLouver = R_HULL + 0.012;

  for (const side of [-1, 1] as const) {
    for (let bay = 0; bay < 4; bay++) {
      const bayZ0 = -HALF_CYL_LEN + bay * BAY_LEN;
      for (let k = 0; k < louverPerBay; k++) {
        const lz = bayZ0 + 0.16 + (k / (louverPerBay - 1)) * (BAY_LEN - 0.32);
        const lx = side * rLouver * Math.cos(flankAngle);
        const ly = Y_AXIS - rLouver * Math.sin(flankAngle);
        lDummy.position.set(lx, ly, lz);
        lDummy.rotation.set(0, 0, side * flankAngle);
        lDummy.updateMatrix();
        louverInst.setMatrixAt(lIdx++, lDummy.matrix);

        for (const dz of [-0.018, 0.018]) {
          lDummy.position.set(lx + side * 0.018, ly, lz + dz);
          lDummy.rotation.set(0, 0, side * flankAngle);
          lDummy.updateMatrix();
          studInst.setMatrixAt(sIdx++, lDummy.matrix);
        }
      }
    }
  }
  louverInst.instanceMatrix.needsUpdate = true;
  louverInst.computeBoundingSphere();
  studInst.instanceMatrix.needsUpdate = true;
  studInst.computeBoundingSphere();
  root.add(louverInst);
  root.add(studInst);

  // =========================================================================
  // 4. FORE & AFT RADIAL-GORE DOMES + COBALT-BLUE COLLARS & EVA HATCHES
  // =========================================================================
  // Ellipsoidal dome lathe profile tapering from R_HULL (at z=0) down to DOME_NECK_R (at z=DOME_DEPTH)
  const domePts: THREE.Vector2[] = [];
  const domeSteps = 22;
  for (let s = 0; s <= domeSteps; s++) {
    const t = s / domeSteps; // 0 = base ring, 1 = docking collar
    const angle = t * 1.12;
    const rad = THREE.MathUtils.lerp(R_HULL, DOME_NECK_R, Math.sin(angle) / Math.sin(1.12));
    const depth = (1.0 - Math.cos(angle)) / (1.0 - Math.cos(1.12)) * DOME_DEPTH;
    domePts.push(new THREE.Vector2(rad, depth));
  }
  const domeGeo = trackGeo(new THREE.LatheGeometry(domePts, 72));
  domeGeo.rotateX(Math.PI / 2);

  // Apply subtle 3D 12-gore pillowing so grazing solar light reveals every radial gore rib
  const dPos = domeGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < dPos.count; i++) {
    const px = dPos.getX(i);
    const py = dPos.getY(i);
    const pz = dPos.getZ(i);
    const r = Math.hypot(px, py);
    if (r > DOME_NECK_R + 0.03 && r < R_HULL - 0.03) {
      const ang = Math.atan2(py, px);
      const goreWave = Math.abs(Math.sin(ang * 6.0)); // 12 quilted gores
      const edgeFade = Math.sin(((r - DOME_NECK_R) / (R_HULL - DOME_NECK_R)) * Math.PI);
      const puff = 0.018 * goreWave * edgeFade;
      dPos.setX(i, px + (px / r) * puff);
      dPos.setY(i, py + (py / r) * puff);
    }
    dPos.setZ(i, pz);
  }
  domeGeo.computeVertexNormals();

  // Outer charcoal trim collar around docking ring
  const collarBezelGeo = trackGeo(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(1.23, -0.06),
        new THREE.Vector2(1.40, -0.06),
        new THREE.Vector2(1.40, 0.07),
        new THREE.Vector2(1.25, 0.07),
      ],
      48
    )
  );
  collarBezelGeo.rotateX(Math.PI / 2);

  // Recessed anodized cobalt-blue conical collar dish
  const cobaltDishGeo = trackGeo(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.0, -0.22),
        new THREE.Vector2(1.06, -0.22),
        new THREE.Vector2(1.25, 0.06),
        new THREE.Vector2(1.25, 0.02),
        new THREE.Vector2(1.04, -0.25),
        new THREE.Vector2(0.0, -0.25),
      ],
      48
    )
  );
  cobaltDishGeo.rotateX(Math.PI / 2);

  // 8 radial cobalt-blue stiffening gussets inside the recessed collar
  const radialRibShape = new THREE.Shape();
  radialRibShape.moveTo(0.88, -0.22);
  radialRibShape.lineTo(1.23, 0.02);
  radialRibShape.lineTo(1.23, 0.05);
  radialRibShape.lineTo(0.84, -0.20);
  radialRibShape.closePath();
  const radialRibGeo = trackGeo(
    new THREE.ExtrudeGeometry(radialRibShape, {
      depth: 0.036,
      bevelEnabled: true,
      bevelSize: 0.008,
      bevelThickness: 0.008,
      bevelSegments: 2,
    })
  );
  radialRibGeo.translate(0, 0, -0.018);

  // Rounded-rectangle thermal seal frame & EVA pressure hatch
  const gasketOuter = createRoundedRectShape(1.00, 1.72, 0.24);
  const gasketInner = createRoundedRectShape(0.84, 1.56, 0.17);
  gasketOuter.holes.push(gasketInner);
  const gasketGeo = trackGeo(
    new THREE.ExtrudeGeometry(gasketOuter, {
      depth: 0.11,
      bevelEnabled: true,
      bevelSize: 0.014,
      bevelThickness: 0.014,
      bevelSegments: 3,
    })
  );

  const hatchShape = createRoundedRectShape(0.82, 1.54, 0.16);
  const hatchGeo = trackGeo(
    new THREE.ExtrudeGeometry(hatchShape, {
      depth: 0.055,
      bevelEnabled: true,
      bevelSize: 0.012,
      bevelThickness: 0.012,
      bevelSegments: 2,
    })
  );

  const portholeBezelGeo = trackGeo(new THREE.TorusGeometry(0.158, 0.028, 12, 32));
  const portholeGlassGeo = trackGeo(new THREE.CylinderGeometry(0.142, 0.142, 0.03, 28));
  portholeGlassGeo.rotateX(Math.PI / 2);

  // Amber-gold U-shaped EVA grab handrail
  const handrailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.14, 0.0),
    new THREE.Vector3(0, -0.14, 0.068),
    new THREE.Vector3(0, 0.14, 0.068),
    new THREE.Vector3(0, 0.14, 0.0),
  ]);
  const handrailGeo = trackGeo(new THREE.TubeGeometry(handrailCurve, 20, 0.016, 10, false));

  const buildEndBulkhead = (signZ: 1 | -1) => {
    const endGroup = new THREE.Group();
    endGroup.position.set(0, Y_AXIS, signZ * HALF_CYL_LEN);
    if (signZ === -1) {
      endGroup.rotation.y = Math.PI;
    }

    const domeMesh = new THREE.Mesh(domeGeo, domeBlanketMat);
    domeMesh.castShadow = true;
    domeMesh.receiveShadow = true;
    endGroup.add(domeMesh);

    const airlockGroup = new THREE.Group();
    airlockGroup.position.set(0, 0, DOME_DEPTH);

    const bezel = new THREE.Mesh(collarBezelGeo, darkRibMat);
    bezel.castShadow = true;
    bezel.receiveShadow = true;
    airlockGroup.add(bezel);

    const cobaltDish = new THREE.Mesh(cobaltDishGeo, cobaltCollarMat);
    cobaltDish.castShadow = true;
    cobaltDish.receiveShadow = true;
    airlockGroup.add(cobaltDish);

    // 8 radial cobalt-blue stiffener ribs around the recessed docking collar
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4.0;
      const ribWrap = new THREE.Group();
      ribWrap.rotation.z = a;
      const rib = new THREE.Mesh(radialRibGeo, cobaltCollarMat);
      rib.rotation.x = Math.PI / 2;
      rib.castShadow = true;
      rib.receiveShadow = true;
      ribWrap.add(rib);
      airlockGroup.add(ribWrap);
    }

    // Dark charcoal thermal gasket + brushed light-gray EVA pressure hatch
    const gasket = new THREE.Mesh(gasketGeo, rubberGasketMat);
    gasket.position.z = -0.22;
    gasket.castShadow = true;
    gasket.receiveShadow = true;
    airlockGroup.add(gasket);

    const hatch = new THREE.Mesh(hatchGeo, hatchGrayMat);
    hatch.position.z = -0.20;
    hatch.castShadow = true;
    hatch.receiveShadow = true;
    airlockGroup.add(hatch);

    // Upper circular dark-glass porthole + machined dark bezel (front of hatch = -0.133)
    const portPosY = 0.30;
    const portBezel = new THREE.Mesh(portholeBezelGeo, darkRibMat);
    portBezel.position.set(0, portPosY, -0.118);
    portBezel.castShadow = true;
    airlockGroup.add(portBezel);

    const portGlass = new THREE.Mesh(portholeGlassGeo, portholeGlassMat);
    portGlass.position.set(0, portPosY, -0.122);
    airlockGroup.add(portGlass);

    // Left & right amber-gold U-shaped EVA grab handrails
    for (const hx of [-0.255, 0.255]) {
      const rail = new THREE.Mesh(handrailGeo, amberGoldRailMat);
      rail.position.set(hx, 0.02, -0.132);
      rail.castShadow = true;
      airlockGroup.add(rail);
    }

    // Lower central vertical chrome dogging latch plate + L-handle
    const latchPlateGeo = trackGeo(new THREE.BoxGeometry(0.11, 0.22, 0.025));
    const latchPlate = new THREE.Mesh(latchPlateGeo, darkRibMat);
    latchPlate.position.set(0, -0.34, -0.122);
    airlockGroup.add(latchPlate);

    const latchStemGeo = trackGeo(new THREE.BoxGeometry(0.022, 0.14, 0.055));
    const latchStem = new THREE.Mesh(latchStemGeo, brushedAlumMat);
    latchStem.position.set(0, -0.36, -0.095);
    latchStem.castShadow = true;
    airlockGroup.add(latchStem);

    // Tiny perimeter fastener studs around hatch panel
    const dotGeo = trackGeo(new THREE.CylinderGeometry(0.011, 0.011, 0.018, 6));
    dotGeo.rotateX(Math.PI / 2);
    for (let p = 0; p < 12; p++) {
      const py = -0.60 + (p / 11) * 1.20;
      for (const px of [-0.34, 0.34]) {
        const stud = new THREE.Mesh(dotGeo, darkRibMat);
        stud.position.set(px, py, -0.128);
        airlockGroup.add(stud);
      }
    }

    endGroup.add(airlockGroup);
    root.add(endGroup);
  };

  buildEndBulkhead(-1);
  buildEndBulkhead(1);

  // =========================================================================
  // 5. LOWER 4-BAY BRUSHED-ALUMINUM SPACEFRAME SKID CRADLE (GROUNDED y = 0)
  // =========================================================================
  const skidGroup = new THREE.Group();
  const unitCylGeo = trackGeo(new THREE.CylinderGeometry(1, 1, 1, 10));
  const X_SKID = 2.31;
  const Y_BOT = 0.048;
  const Y_TOP = 0.96;
  const Z_STATIONS = [-4.62, -3.84, -1.92, 0.0, 1.92, 3.84, 4.62];
  const R_TUBE = 0.036;
  const R_DIAG = 0.025;

  // Longitudinal top & bottom truss rails on both sides
  for (const sx of [-X_SKID, X_SKID]) {
    addStrutBetween(
      skidGroup,
      new THREE.Vector3(sx, Y_BOT, Z_STATIONS[0]),
      new THREE.Vector3(sx, Y_BOT, Z_STATIONS[Z_STATIONS.length - 1]),
      R_TUBE,
      unitCylGeo,
      brushedAlumMat
    );
    addStrutBetween(
      skidGroup,
      new THREE.Vector3(sx, Y_TOP, Z_STATIONS[0]),
      new THREE.Vector3(sx, Y_TOP, Z_STATIONS[Z_STATIONS.length - 1]),
      R_TUBE,
      unitCylGeo,
      brushedAlumMat
    );
    // Vertical posts at every station
    for (let s = 0; s < Z_STATIONS.length; s++) {
      const z = Z_STATIONS[s];
      addStrutBetween(
        skidGroup,
        new THREE.Vector3(sx, Y_BOT, z),
        new THREE.Vector3(sx, Y_TOP, z),
        R_TUBE,
        unitCylGeo,
        brushedAlumMat
      );
    }
    // Alternating Warren-truss diagonals along every bay
    for (let b = 0; b < Z_STATIONS.length - 1; b++) {
      const z0 = Z_STATIONS[b];
      const z1 = Z_STATIONS[b + 1];
      const zMid = (z0 + z1) * 0.5;
      if (b === 0 || b === Z_STATIONS.length - 2) {
        // End cantilever bay diagonal + angled gusset
        const pA = b === 0 ? new THREE.Vector3(sx, Y_BOT, z0) : new THREE.Vector3(sx, Y_TOP, z0);
        const pB = b === 0 ? new THREE.Vector3(sx, Y_TOP, z1) : new THREE.Vector3(sx, Y_BOT, z1);
        addStrutBetween(skidGroup, pA, pB, R_DIAG, unitCylGeo, brushedAlumMat);
      } else {
        // V-truss pair matching corehab-beautyshot's crisp side diagonals
        addStrutBetween(
          skidGroup,
          new THREE.Vector3(sx, Y_BOT, z0),
          new THREE.Vector3(sx, Y_TOP, zMid),
          R_DIAG,
          unitCylGeo,
          brushedAlumMat
        );
        addStrutBetween(
          skidGroup,
          new THREE.Vector3(sx, Y_TOP, zMid),
          new THREE.Vector3(sx, Y_BOT, z1),
          R_DIAG,
          unitCylGeo,
          brushedAlumMat
        );
      }
    }
  }

  // Transverse floor & upper frame crossbeams at stations + ground skid foot pads (y = 0)
  const footPadGeo = trackGeo(new THREE.BoxGeometry(0.17, 0.032, 0.22));
  const nodeCollarGeo = trackGeo(new THREE.SphereGeometry(0.048, 8, 8));
  for (let s = 0; s < Z_STATIONS.length; s++) {
    const z = Z_STATIONS[s];
    addStrutBetween(
      skidGroup,
      new THREE.Vector3(-X_SKID, Y_BOT, z),
      new THREE.Vector3(X_SKID, Y_BOT, z),
      R_TUBE * 0.92,
      unitCylGeo,
      brushedAlumMat
    );
    addStrutBetween(
      skidGroup,
      new THREE.Vector3(-X_SKID, Y_TOP, z),
      new THREE.Vector3(X_SKID, Y_TOP, z),
      R_DIAG,
      unitCylGeo,
      darkRibMat
    );

    for (const sx of [-X_SKID, X_SKID]) {
      const pad = new THREE.Mesh(footPadGeo, darkRibMat);
      pad.position.set(sx, 0.016, z);
      pad.castShadow = true;
      pad.receiveShadow = true;
      skidGroup.add(pad);

      const collarBot = new THREE.Mesh(nodeCollarGeo, brushedAlumMat);
      collarBot.position.set(sx, Y_BOT, z);
      skidGroup.add(collarBot);

      const collarTop = new THREE.Mesh(nodeCollarGeo, brushedAlumMat);
      collarTop.position.set(sx, Y_TOP, z);
      skidGroup.add(collarTop);
    }
  }

  // Front & rear lower end-cradle vertical dark framing under the dome
  for (const signZ of [-1, 1] as const) {
    const endApronGeo = trackGeo(new THREE.BoxGeometry(X_SKID * 1.94, 0.72, 0.08));
    const endApron = new THREE.Mesh(endApronGeo, darkRibMat);
    endApron.position.set(0, 0.68, signZ * 4.24);
    endApron.castShadow = true;
    endApron.receiveShadow = true;
    skidGroup.add(endApron);
  }

  root.add(skidGroup);

  // =========================================================================
  // 6. CRINKLED GOLD KAPTON MLI TANKS (LOWER CRADLE + MID-DECK MANIFOLDS)
  // =========================================================================
  // Lower Main Tanks: 3 sequential horizontal capsule tanks per side (visible inside bottom truss)
  const lowerTankRadius = 0.405;
  const lowerTankBodyLen = 1.62;
  const lowerTankGeo = trackGeo(
    new THREE.CapsuleGeometry(lowerTankRadius, lowerTankBodyLen, 16, 32)
  );
  lowerTankGeo.rotateX(Math.PI / 2);

  const lowerStrapGeo = trackGeo(
    new THREE.TorusGeometry(lowerTankRadius + 0.012, 0.016, 8, 32)
  );

  for (const sx of [-1.62, 0.0, 1.62]) {
    const isCenter = sx === 0.0;
    const zCenters = isCenter ? [-2.4, 0.0, 2.4] : [-2.68, 0.0, 2.68];
    for (const tz of zCenters) {
      const tank = new THREE.Mesh(lowerTankGeo, goldKaptonMat);
      tank.position.set(sx, 0.48, tz);
      tank.castShadow = true;
      tank.receiveShadow = true;
      root.add(tank);

      if (!isCenter) {
        for (const sz of [-0.62, 0.62]) {
          const strap = new THREE.Mesh(lowerStrapGeo, brushedAlumMat);
          strap.position.set(sx, 0.48, tz + sz);
          root.add(strap);
        }
      }
    }
  }

  // Mid-Deck Horizontal Gold Kapton Manifold Tanks + Lower Brushed Side Apron Plates
  const midGoldGeo = trackGeo(new THREE.CapsuleGeometry(0.205, 2.15, 14, 28));
  midGoldGeo.rotateX(Math.PI / 2);
  const midStrapGeo = trackGeo(new THREE.TorusGeometry(0.214, 0.014, 8, 28));
  const sideApronGeo = trackGeo(new THREE.BoxGeometry(0.11, 0.28, 2.62));
  const centerSillGeo = trackGeo(new THREE.BoxGeometry(0.14, 0.14, 2.08));

  for (const side of [-1, 1] as const) {
    // Front & rear lower rectangular light-gray apron skirt plates
    for (const az of [-2.45, 2.45]) {
      const apron = new THREE.Mesh(sideApronGeo, hatchGrayMat);
      apron.position.set(side * 2.24, 1.07, az);
      apron.castShadow = true;
      apron.receiveShadow = true;
      root.add(apron);

      const midTank = new THREE.Mesh(midGoldGeo, goldKaptonMat);
      midTank.position.set(side * 2.07, 1.24, az);
      midTank.castShadow = true;
      midTank.receiveShadow = true;
      root.add(midTank);

      for (let k = -2; k <= 2; k++) {
        const strap = new THREE.Mesh(midStrapGeo, darkRibMat);
        strap.position.set(side * 2.07, 1.24, az + k * 0.48);
        root.add(strap);
      }
    }

    // Center radiator sill bezel connecting smoothly between front & rear aprons
    const cSill = new THREE.Mesh(centerSillGeo, hatchGrayMat);
    cSill.position.set(side * 2.26, 1.01, 0);
    cSill.castShadow = true;
    cSill.receiveShadow = true;
    root.add(cSill);
  }

  // =========================================================================
  // 7. SIDE-MOUNTED CRINKLED SILVER MLI PRESSURE VESSELS (12 TOTAL, 6 BANDS EACH)
  // =========================================================================
  const silverTankRadius = 0.168;
  const silverTankBodyLen = 2.18;
  const silverTankGeo = trackGeo(
    new THREE.CapsuleGeometry(silverTankRadius, silverTankBodyLen, 14, 28)
  );
  silverTankGeo.rotateX(Math.PI / 2);

  const silverBandGeo = trackGeo(
    new THREE.TorusGeometry(silverTankRadius + 0.011, 0.014, 8, 28)
  );
  const rackRailGeo = trackGeo(new THREE.BoxGeometry(0.18, 1.06, 0.065));

  for (const side of [-1, 1] as const) {
    for (const bayZ of [-2.42, 2.42]) {
      // 3 stacked horizontal silver tanks per bay
      for (let row = 0; row < 3; row++) {
        const ty = 1.56 + row * 0.365;
        const tank = new THREE.Mesh(silverTankGeo, silverMliMat);
        tank.position.set(side * 2.20, ty, bayZ);
        tank.castShadow = true;
        tank.receiveShadow = true;
        root.add(tank);

        // 6 dark clamping bands evenly spaced along each cylinder (exact count from photo)
        for (let b = 0; b < 6; b++) {
          const bz = bayZ - 0.92 + (b / 5.0) * 1.84;
          const band = new THREE.Mesh(silverBandGeo, darkRibMat);
          band.position.set(side * 2.20, ty, bz);
          band.castShadow = true;
          root.add(band);
        }
      }

      // Vertical rack spine brackets tying the 3-high stack into the hull
      for (const rz of [-0.74, 0.74]) {
        const bracket = new THREE.Mesh(rackRailGeo, darkRibMat);
        bracket.position.set(side * 2.06, 1.92, bayZ + rz);
        root.add(bracket);
      }
    }
  }

  // =========================================================================
  // 8. CENTER-BAY DUAL-BANK 8-FIN RADIATOR CABINET & ROSE-PINK THERMAL BAR
  // =========================================================================
  const finCount = 8;
  const cabinetSpanZ = 2.02;
  const finPitch = cabinetSpanZ / finCount;
  const finWidthZ = finPitch - 0.022;
  const upperFinGeo = trackGeo(new THREE.BoxGeometry(0.18, 0.84, finWidthZ));
  const lowerFinGeo = trackGeo(new THREE.BoxGeometry(0.18, 0.78, finWidthZ));
  const cabinetCoreGeo = trackGeo(new THREE.BoxGeometry(0.28, 1.80, cabinetSpanZ - 0.03));
  const goldCheekUpperGeo = trackGeo(new THREE.BoxGeometry(0.32, 0.84, 0.038));
  const goldCheekLowerGeo = trackGeo(new THREE.BoxGeometry(0.32, 0.78, 0.038));
  const roseBarGeo = trackGeo(new THREE.BoxGeometry(0.16, 0.095, cabinetSpanZ - 0.02));
  const roseCavityGeo = trackGeo(new THREE.BoxGeometry(0.14, 0.135, cabinetSpanZ - 0.01));

  for (const side of [-1, 1] as const) {
    const cabGroup = new THREE.Group();
    cabGroup.position.set(side * 2.24, 0, 0);

    // Recessed dark thermal cabinet backing core
    const core = new THREE.Mesh(cabinetCoreGeo, darkRibMat);
    core.position.set(-side * 0.04, 1.97, 0);
    core.castShadow = true;
    core.receiveShadow = true;
    cabGroup.add(core);

    // 8 vertical upper & lower brushed-aluminum radiator fin plates with shadow gaps
    for (let f = 0; f < finCount; f++) {
      const fz = -cabinetSpanZ * 0.5 + (f + 0.5) * finPitch;

      const uFin = new THREE.Mesh(upperFinGeo, radiatorFinMat);
      uFin.position.set(side * 0.07, 2.44, fz);
      uFin.castShadow = true;
      uFin.receiveShadow = true;
      cabGroup.add(uFin);

      const lFin = new THREE.Mesh(lowerFinGeo, radiatorFinMat);
      lFin.position.set(side * 0.07, 1.47, fz);
      lFin.castShadow = true;
      lFin.receiveShadow = true;
      cabGroup.add(lFin);
    }

    // Crinkled gold Kapton MLI side cheeks capping front & rear walls of the radiator banks
    for (const cz of [-cabinetSpanZ * 0.5, cabinetSpanZ * 0.5]) {
      const uCheek = new THREE.Mesh(goldCheekUpperGeo, goldKaptonMat);
      uCheek.position.set(0, 2.44, cz);
      uCheek.castShadow = true;
      uCheek.receiveShadow = true;
      cabGroup.add(uCheek);

      const lCheek = new THREE.Mesh(goldCheekLowerGeo, goldKaptonMat);
      lCheek.position.set(0, 1.47, cz);
      lCheek.castShadow = true;
      lCheek.receiveShadow = true;
      cabGroup.add(lCheek);
    }

    // Signature horizontal glowing rose-pink thermal bar slicing between upper & lower banks
    const cavity = new THREE.Mesh(roseCavityGeo, darkRibMat);
    cavity.position.set(side * 0.03, 1.94, 0);
    cabGroup.add(cavity);

    const roseBar = new THREE.Mesh(roseBarGeo, roseThermalBarMat);
    roseBar.position.set(side * 0.075, 1.94, 0);
    cabGroup.add(roseBar);

    root.add(cabGroup);
  }

  // =========================================================================
  // 9. OVERHEAD ROOF RACK TRUSS, CHARCOAL CASSETTE & FOLDED DEPLOYABLE WING
  // =========================================================================
  const roofGroup = new THREE.Group();
  const X_ROOF = 1.24;
  const Y_ROOF_BASE = Y_AXIS + R_HULL - 0.14; // intersects cleanly into upper rib crowns
  const Y_ROOF_TOP = 5.18;
  const R_ROOF_TUBE = 0.028;
  const Z_ROOF_RIBS = [-3.84, -1.92, 0.0, 1.92, 3.84];

  for (const rx of [-X_ROOF, X_ROOF]) {
    addStrutBetween(
      roofGroup,
      new THREE.Vector3(rx, Y_ROOF_TOP, Z_ROOF_RIBS[0]),
      new THREE.Vector3(rx, Y_ROOF_TOP, Z_ROOF_RIBS[4]),
      R_ROOF_TUBE,
      unitCylGeo,
      brushedAlumMat
    );
    // Vertical standoffs from each rib
    for (let i = 0; i < Z_ROOF_RIBS.length; i++) {
      addStrutBetween(
        roofGroup,
        new THREE.Vector3(rx, Y_ROOF_BASE, Z_ROOF_RIBS[i]),
        new THREE.Vector3(rx, Y_ROOF_TOP, Z_ROOF_RIBS[i]),
        R_ROOF_TUBE * 0.9,
        unitCylGeo,
        brushedAlumMat
      );
    }
    // End bay diagonal braces clearly visible at fore & aft top corners
    addStrutBetween(
      roofGroup,
      new THREE.Vector3(rx, Y_ROOF_BASE, Z_ROOF_RIBS[0]),
      new THREE.Vector3(rx, Y_ROOF_TOP, Z_ROOF_RIBS[1]),
      R_ROOF_TUBE * 0.78,
      unitCylGeo,
      brushedAlumMat
    );
    addStrutBetween(
      roofGroup,
      new THREE.Vector3(rx, Y_ROOF_TOP, Z_ROOF_RIBS[3]),
      new THREE.Vector3(rx, Y_ROOF_BASE, Z_ROOF_RIBS[4]),
      R_ROOF_TUBE * 0.78,
      unitCylGeo,
      brushedAlumMat
    );
  }

  for (let i = 0; i < Z_ROOF_RIBS.length; i++) {
    addStrutBetween(
      roofGroup,
      new THREE.Vector3(-X_ROOF, Y_ROOF_TOP, Z_ROOF_RIBS[i]),
      new THREE.Vector3(X_ROOF, Y_ROOF_TOP, Z_ROOF_RIBS[i]),
      R_ROOF_TUBE * 0.9,
      unitCylGeo,
      brushedAlumMat
    );
  }

  // Dark Charcoal Overhead Equipment Cassette Box
  const cassetteGeo = trackGeo(new THREE.BoxGeometry(0.76, 0.24, 5.26));
  const cassette = new THREE.Mesh(cassetteGeo, darkRibMat);
  cassette.position.set(-0.46, Y_ROOF_TOP + 0.14, 0.96);
  cassette.castShadow = true;
  cassette.receiveShadow = true;
  roofGroup.add(cassette);

  // Warm-Tan Stacked Folded Accordion Deployable Blanket Wing
  const wingW = 1.06;
  const wingLen = 5.14;
  const layerCount = 5;
  const layerH = 0.036;
  const wingZ = 0.96;
  const wingX = 0.48;

  for (let l = 0; l < layerCount; l++) {
    const isTop = l === layerCount - 1;
    const pleatGeo = trackGeo(new THREE.BoxGeometry(wingW - (l % 2) * 0.025, layerH, wingLen));
    const pleat = new THREE.Mesh(pleatGeo, isTop ? foldedWingMat : foldedPleatMat);
    pleat.position.set(wingX, Y_ROOF_TOP + 0.08 + l * (layerH + 0.008), wingZ);
    pleat.castShadow = true;
    pleat.receiveShadow = true;
    roofGroup.add(pleat);
  }

  // Twin Cylindrical End-Roller Drums with silver barrels & dark machined end bearings
  const rollerGeo = trackGeo(new THREE.CylinderGeometry(0.132, 0.132, 1.24, 24));
  rollerGeo.rotateZ(Math.PI / 2);
  const rollerCapGeo = trackGeo(new THREE.CylinderGeometry(0.142, 0.142, 0.09, 24));
  rollerCapGeo.rotateZ(Math.PI / 2);
  const rollerHubGeo = trackGeo(new THREE.CylinderGeometry(0.068, 0.068, 0.05, 16));
  rollerHubGeo.rotateZ(Math.PI / 2);

  for (const rz of [wingZ - wingLen * 0.5 - 0.10, wingZ + wingLen * 0.5 + 0.10]) {
    const roller = new THREE.Mesh(rollerGeo, brushedAlumMat);
    roller.position.set(wingX, Y_ROOF_TOP + 0.16, rz);
    roller.castShadow = true;
    roller.receiveShadow = true;
    roofGroup.add(roller);

    for (const cx of [-0.58, 0.58]) {
      const cap = new THREE.Mesh(rollerCapGeo, darkRibMat);
      cap.position.set(wingX + cx, Y_ROOF_TOP + 0.16, rz);
      cap.castShadow = true;
      roofGroup.add(cap);

      const hub = new THREE.Mesh(rollerHubGeo, brushedAlumMat);
      hub.position.set(wingX + cx + Math.sign(cx) * 0.04, Y_ROOF_TOP + 0.16, rz);
      roofGroup.add(hub);
    }
  }

  root.add(roofGroup);

  // =========================================================================
  // 10. SUBTLE UNDER-SKID CONTACT SHADOW APRON (ANCHORS REGOLITH GROUNDING)
  // =========================================================================
  const contactApronGeo = trackGeo(new THREE.PlaneGeometry(8.2, 12.6));
  contactApronGeo.rotateX(-Math.PI / 2);
  const contactApronMat = trackMat(
    new THREE.MeshBasicMaterial({
      map: shadowApronTex,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
  );
  const contactApron = new THREE.Mesh(contactApronGeo, contactApronMat);
  contactApron.position.set(0, 0.015, 0);
  root.add(contactApron);

  return {
    group: root,
    colliderHalfExtents: {
      halfWidthX: 2.55,
      halfLengthZ: 5.45,
    },
    dispose: () => {
      disposablesGeo.forEach((g) => g.dispose());
      disposablesMat.forEach((m) => m.dispose());
      disposablesTex.forEach((t) => t.dispose());
    },
  };
}
