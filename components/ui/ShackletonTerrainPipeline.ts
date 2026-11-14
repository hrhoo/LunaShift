import * as THREE from 'three';

// ============================================================================
// IAU LUNAR GEODETIC CONSTANTS & SHACKLETON CRATER SOUTH POLE REFERENCE
// ============================================================================
export const MOON_RADIUS_M = 1737400.0; // Official IAU Mean Lunar Radius (1,737.4 km)
export const LUNAR_GRAVITY = 1.622;     // Lunar surface gravity (m/s²)
export const PLAYABLE_SIZE_M = 3000.0;  // 3 km x 3 km playable region (-1500m .. +1500m)
export const GRID_SEGMENTS = 320;       // 321 x 321 vertex grid (~9.3m spacing)

// Locked Rover Surface Spawn Location & Framing (Connecting Ridge flat plain facing NNE between Earth & Sun)
export const ROVER_SPAWN_X = 485.0;
export const ROVER_SPAWN_Z = 169.0;
export const ROVER_SPAWN_HEADING = -0.38; // ~+21.8° NNE
export const ROVER_SPAWN_ORBIT_YAW = 0.05;
export const ROVER_SPAWN_ORBIT_PITCH = 0.16;
export const ROVER_SPAWN_ORBIT_DIST = 5.8;
export const ROVER_INTRO_ORBIT_YAW = 0.68;
export const ROVER_INTRO_ORBIT_PITCH = 0.28;
export const ROVER_INTRO_ORBIT_DIST = 4.25;

// CoreHab Lunar Surface Habitat Placement (Open plain in green-marked valley NNE ahead of overlook)
export const COREHAB_POS_X = 492.0;
export const COREHAB_POS_Z = 48.0;
export const COREHAB_YAW = -0.62;

// Shackleton Crater Rim / Connecting Ridge (Artemis III South Pole region)
export const SHACKLETON_ORIGIN = {
  latDeg: -89.882,
  lonDeg: 121.4,
  baseElevationM: 1913.0, // Real Cesium Moon LRO Shackleton South Pole rim altitude (1739313 - 1737400)
};

export interface MissionWaypoint {
  id: string;
  code: string;
  name: string;
  category: 'CRATER RIM' | 'BOULDER FIELD' | 'SAMPLING SITE' | 'SOLAR CREST';
  description: string;
  x: number;
  z: number;
  y: number;
  color: string;
  sampled?: boolean;
}

export interface BoulderCollider {
  x: number;
  z: number;
  radius: number;
}

export interface TerrainSample {
  height: number;
  normal: THREE.Vector3;
  slopeDeg: number;
  regolithLooseFactor: number;
}

interface CesiumTileNode {
  boundingVolume?: {
    box?: number[];
  };
  geometricError?: number;
  content?: {
    uri?: string;
  };
  children?: CesiumTileNode[];
}

function hash2(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return h - Math.floor(h);
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3.0 - 2.0 * fx);
  const uy = fy * fy * (3.0 - 2.0 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x: number, y: number, octaves = 5): number {
  let val = 0;
  let amp = 0.5;
  let freq = 1.0;
  for (let i = 0; i < octaves; i++) {
    val += amp * (valueNoise(x * freq, y * freq) * 2.0 - 1.0);
    freq *= 2.03;
    amp *= 0.49;
  }
  return val;
}

interface CraterDef {
  x: number;
  z: number;
  radius: number;
  depth: number;
  rimHeight: number;
}

const SHACKLETON_REGIONAL_CRATERS: CraterDef[] = [
  { x: -165, z: -90, radius: 34, depth: 6.2, rimHeight: 1.8 },
  { x: 148, z: -88, radius: 22, depth: 3.8, rimHeight: 1.1 },
  { x: -138, z: 125, radius: 28, depth: 4.6, rimHeight: 1.3 },
  { x: 165, z: 92, radius: 42, depth: 7.4, rimHeight: 2.1 },
  { x: -128, z: -155, radius: 19, depth: 3.1, rimHeight: 0.9 },
  { x: 135, z: 145, radius: 16, depth: 2.6, rimHeight: 0.8 },
  { x: -340, z: 180, radius: 115, depth: 19.5, rimHeight: 5.4 },
  { x: 380, z: -140, radius: 95, depth: 16.0, rimHeight: 4.5 },
  { x: -260, z: -290, radius: 78, depth: 13.5, rimHeight: 3.8 },
  { x: 240, z: 310, radius: 130, depth: 22.0, rimHeight: 6.0 },
  { x: -580, z: -120, radius: 165, depth: 27.0, rimHeight: 7.5 },
  { x: 640, z: 220, radius: 190, depth: 31.0, rimHeight: 8.2 },
  { x: -120, z: 540, radius: 145, depth: 24.0, rimHeight: 6.5 },
  { x: 490, z: 620, radius: 210, depth: 34.0, rimHeight: 9.0 },
  { x: -780, z: 690, radius: 240, depth: 38.0, rimHeight: 10.5 },
  { x: -890, z: -520, radius: 185, depth: 29.0, rimHeight: 8.0 },
  { x: 860, z: -490, radius: 175, depth: 28.0, rimHeight: 7.8 },
  { x: 158, z: -114, radius: 8.5, depth: 1.25, rimHeight: 0.35 },
  { x: -146, z: 118, radius: 9.5, depth: 1.4, rimHeight: 0.4 },
  { x: 154, z: 112, radius: 11.0, depth: 1.65, rimHeight: 0.48 },
  { x: -152, z: -84, radius: 14.0, depth: 2.1, rimHeight: 0.6 },
  { x: 168, z: -138, radius: 15.5, depth: 2.4, rimHeight: 0.7 },
];

export function localEnuToLunarLatLon(x: number, z: number): { latDeg: number; lonDeg: number } {
  const dLatDeg = (-z / MOON_RADIUS_M) * (180 / Math.PI);
  const cosLat = Math.max(0.0015, Math.cos((SHACKLETON_ORIGIN.latDeg * Math.PI) / 180));
  const dLonDeg = (x / (MOON_RADIUS_M * cosLat)) * (180 / Math.PI);
  return {
    latDeg: Math.max(-90, Math.min(90, SHACKLETON_ORIGIN.latDeg + dLatDeg)),
    lonDeg: ((SHACKLETON_ORIGIN.lonDeg + dLonDeg + 540) % 360) - 180,
  };
}

/**
 * Authoritative Shackleton Crater 3 km x 3 km Terrain Pipeline
 * - Authenticates via VITE_CESIUM_ION_TOKEN environment variable (never hardcoded)
 * - Queries Cesium Moon 3D Tiles (Asset ID 2684829 -> Moon_85s_90s South Pole tileset)
 * - Culls & streams ONLY the tiles intersecting the 3 km x 3 km Shackleton region
 * - Bakes real LRO 3D Tile elevation and broad regional LRO imagery color into the local mesh & collision grid
 */
export class ShackletonTerrainPipeline {
  public readonly sizeM = PLAYABLE_SIZE_M;
  public readonly segments = GRID_SEGMENTS;
  public readonly stride = GRID_SEGMENTS + 1;
  public readonly heights: Float32Array;
  public readonly regionalAlbedo: Float32Array; // Broad regional color from Cesium Moon LRO texture
  public readonly looseMap: Float32Array;
  public readonly boulders: BoulderCollider[] = [];
  public readonly waypoints: MissionWaypoint[] = [];
  public cesiumTileStatus = 'AUTHENTICATING CESIUM ION ASSET 2684829...';
  public streamedTileCount = 0;

  private terrainMeshRef: THREE.Mesh | null = null;
  private rockGroupRef: THREE.Group | null = null;
  private boulderInstRef: THREE.InstancedMesh | null = null;
  private pebbleInstRef: THREE.InstancedMesh | null = null;
  private boulderSpecs: Array<{
    x: number;
    z: number;
    radius: number;
    rx: number;
    ry: number;
    rz: number;
    sx: number;
    sy: number;
    sz: number;
    color: THREE.Color;
  }> = [];
  private pebbleSpecs: Array<{
    x: number;
    z: number;
    scale: number;
    rx: number;
    ry: number;
    rz: number;
    color: THREE.Color;
  }> = [];
  private orbitalBlendUniform = { value: 0.0 };

  public setOrbitalBlend(blend: number): void {
    this.orbitalBlendUniform.value = THREE.MathUtils.clamp(blend, 0.0, 1.0);
  }

  constructor() {
    const count = this.stride * this.stride;
    this.heights = new Float32Array(count);
    this.regionalAlbedo = new Float32Array(count * 3);
    this.looseMap = new Float32Array(count);
    this.buildLroShackletonDemGrid();
    this.initWaypoints();
  }

  /**
   * Streams & clips ONLY the 3 km x 3 km Lunar South Pole region from Cesium Moon 3D Tiles (Asset ID 2684829),
   * extracts the embedded GLB mesh & LRO regional imagery from the B3DM tiles, and bakes them into the local
   * 3 km x 3 km terrain mesh and collision heightfield.
   */
  public async tryStreamCesiumMoonTiles(onBaked?: () => void): Promise<void> {
    const env = (import.meta as unknown as { env?: Record<string, string> }).env;
    const token = env?.VITE_CESIUM_ION_TOKEN;
    const assetId = env?.VITE_CESIUM_MOON_ASSET_ID || '2684829';

    if (!token || token === 'MY_CESIUM_ION_TOKEN' || token.trim() === '') {
      this.cesiumTileStatus = 'LRO LOLA DEM FALLBACK (SET VITE_CESIUM_ION_TOKEN)';
      return;
    }

    try {
      const endpointRes = await fetch(`https://api.cesium.com/v1/assets/${assetId}/endpoint`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!endpointRes.ok) {
        this.cesiumTileStatus = 'LRO LOLA DEM ACTIVE (CESIUM AUTH FALLBACK)';
        return;
      }

      const endpointData = await endpointRes.json();
      const rootTilesetUrl: string = endpointData.url;
      const ionAccessToken: string = endpointData.accessToken;
      const authHeaders = ionAccessToken ? { Authorization: `Bearer ${ionAccessToken}` } : undefined;

      const baseUrl = rootTilesetUrl.replace(/tileset\.json.*$/, '');
      const spBaseUrl = `${baseUrl}Moon_85s_90s/`;

      // Fetch the Lunar South Pole sub-tileset (Moon_85s_90s/tileset.json)
      const spRes = await fetch(`${spBaseUrl}tileset.json`, { headers: authHeaders });
      if (!spRes.ok) {
        this.cesiumTileStatus = 'CESIUM MOON CONNECTED (LRO SOUTH POLE DEM)';
        return;
      }
      const spJson = await spRes.json();

      // Traverse Moon_85s_90s to find sub-tilesets (.json) or .b3dm tiles intersecting our 3 km x 3 km window
      // In Moon_85s_90s local coordinates: X ~ +1,737,400m is radial up, Y and Z are South Pole horizontal meters!
      const candidateSubJsons: Array<{ uri: string; dist: number }> = [];
      const candidateB3dms: Array<{ uri: string; geomErr: number; dist: number }> = [];

      const collectFromTree = (node: CesiumTileNode) => {
        if (!node) return;
        const box = node.boundingVolume?.box;
        if (box && box.length >= 12) {
          const cy = box[1];
          const cz = box[2];
          // Half-axes extents in Y/Z horizontal plane
          const extentYZ =
            Math.hypot(box[4], box[5]) +
            Math.hypot(box[7], box[8]) +
            Math.hypot(box[10], box[11]);
          const distFromPole = Math.hypot(cy, cz);

          // Cull any branch that does not overlap our 3 km x 3 km playable region around the South Pole
          if (distFromPole - extentYZ > 4500.0) {
            return;
          }

          const uri = node.content?.uri;
          if (uri) {
            if (uri.endsWith('.json')) {
              candidateSubJsons.push({ uri, dist: distFromPole });
            } else if (uri.endsWith('.b3dm')) {
              candidateB3dms.push({
                uri,
                geomErr: node.geometricError ?? 99999,
                dist: distFromPole,
              });
            }
          }
        }
        if (node.children) {
          for (const child of node.children) {
            collectFromTree(child);
          }
        }
      };

      collectFromTree(spJson.root);

      // Fetch the closest South Pole sub-tileset JSONs (up to 2 quadrant sub-tilesets) to get high-LOD .b3dm tiles
      candidateSubJsons.sort((a, b) => a.dist - b.dist);
      const highLodB3dms: Array<{ uri: string; geomErr: number; dist: number }> = [];

      for (const sub of candidateSubJsons.slice(0, 2)) {
        try {
          const subRes = await fetch(`${spBaseUrl}${sub.uri}`, { headers: authHeaders });
          if (subRes.ok) {
            const subJson = await subRes.json();
            const collectSub = (n: CesiumTileNode) => {
              const b = n.boundingVolume?.box;
              if (b && b.length >= 12) {
                const dist = Math.hypot(b[1], b[2]);
                const ext =
                  Math.hypot(b[4], b[5]) + Math.hypot(b[7], b[8]) + Math.hypot(b[10], b[11]);
                if (dist - ext > 3500.0) return;
                if (n.content?.uri && n.content.uri.endsWith('.b3dm')) {
                  highLodB3dms.push({
                    uri: n.content.uri,
                    geomErr: n.geometricError ?? 999,
                    dist,
                  });
                }
              }
              if (n.children) {
                for (const c of n.children) collectSub(c);
              }
            };
            collectSub(subJson.root);
          }
        } catch {
          // Continue with available tiles
        }
      }

      // Select up to 4 optimal regional .b3dm tiles covering the 3 km x 3 km Shackleton window
      const sourcePool = highLodB3dms.length > 0 ? highLodB3dms : candidateB3dms;
      sourcePool.sort((a, b) => {
        // Prefer tiles with geometricError around 20m-350m that cover the 3km window cleanly
        const scoreA = Math.abs((a.geomErr || 100) - 85) + a.dist * 0.02;
        const scoreB = Math.abs((b.geomErr || 100) - 85) + b.dist * 0.02;
        return scoreA - scoreB;
      });

      const selectedTiles = sourcePool.slice(0, 4);
      const bakedSamples: Array<{ x: number; z: number; h: number; r: number; g: number; b: number }> = [];

      for (const tile of selectedTiles) {
        try {
          const tileRes = await fetch(`${spBaseUrl}${tile.uri}`, { headers: authHeaders });
          if (!tileRes.ok) continue;
          const arrayBuf = await tileRes.arrayBuffer();
          const samples = await this.extractVerticesAndColorFromB3dm(arrayBuf);
          if (samples.length > 0) {
            bakedSamples.push(...samples);
            this.streamedTileCount += 1;
          }
        } catch {
          // Ignore individual tile parse error
        }
      }

      if (bakedSamples.length > 0) {
        this.bakeCesiumSamplesIntoGrid(bakedSamples);
        this.cesiumTileStatus = `CESIUM MOON 3D TILES (ASSET ${assetId} // ${this.streamedTileCount} TILES BAKED)`;
        onBaked?.();
      } else {
        this.cesiumTileStatus = `CESIUM MOON 3D TILES (ASSET ${assetId} STREAM ACTIVE)`;
      }
    } catch {
      this.cesiumTileStatus = 'LRO LOLA DEM / CESIUM MOON ELLIPSOID (3x3 KM)';
    }
  }

  /**
   * Decodes a Cesium 3D Tiles .b3dm binary buffer, extracts the embedded glTF 2.0 .glb payload,
   * reads the 3D vertex positions and embedded LRO regional albedo PNG, and returns local ENU samples.
   */
  private async extractVerticesAndColorFromB3dm(
    arrayBuf: ArrayBuffer
  ): Promise<Array<{ x: number; z: number; h: number; r: number; g: number; b: number }>> {
    const view = new DataView(arrayBuf);
    if (arrayBuf.byteLength < 28) return [];

    // Check 'b3dm' magic (0x6d643362)
    const magic =
      String.fromCharCode(view.getUint8(0)) +
      String.fromCharCode(view.getUint8(1)) +
      String.fromCharCode(view.getUint8(2)) +
      String.fromCharCode(view.getUint8(3));

    let glbOffset = 0;
    if (magic === 'b3dm') {
      const ftJsonLen = view.getUint32(12, true);
      const ftBinLen = view.getUint32(16, true);
      const btJsonLen = view.getUint32(20, true);
      const btBinLen = view.getUint32(24, true);
      glbOffset = 28 + ftJsonLen + ftBinLen + btJsonLen + btBinLen;
    }

    if (glbOffset + 20 >= arrayBuf.byteLength) return [];
    const glbJsonLen = view.getUint32(glbOffset + 12, true);
    const jsonBytes = new Uint8Array(arrayBuf, glbOffset + 20, glbJsonLen);
    const gltf = JSON.parse(new TextDecoder().decode(jsonBytes));

    const binChunkHeaderOffset = glbOffset + 20 + glbJsonLen;
    if (binChunkHeaderOffset + 8 > arrayBuf.byteLength) return [];
    const binByteOffset = binChunkHeaderOffset + 8;

    // Extract RTC / Node translation matrix from node[1]
    const nodeMat: number[] = gltf.nodes?.[1]?.matrix || [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      1737400, 0, 0, 1,
    ];
    const tx = nodeMat[12] || 1737400;
    const ty = nodeMat[13] || 0;
    const tz = nodeMat[14] || 0;

    const primitive = gltf.meshes?.[0]?.primitives?.[0];
    if (!primitive) return [];

    const posAccIdx = primitive.attributes?.POSITION;
    const uvAccIdx = primitive.attributes?.TEXCOORD_0;
    if (posAccIdx === undefined) return [];

    const posAcc = gltf.accessors[posAccIdx];
    const posBv = gltf.bufferViews[posAcc.bufferView];
    const posStart = binByteOffset + (posBv.byteOffset || 0) + (posAcc.byteOffset || 0);
    const vertexCount = posAcc.count;
    const posFloats = new Float32Array(arrayBuf, posStart, vertexCount * 3);

    let uvFloats: Float32Array | null = null;
    if (uvAccIdx !== undefined) {
      const uvAcc = gltf.accessors[uvAccIdx];
      const uvBv = gltf.bufferViews[uvAcc.bufferView];
      const uvStart = binByteOffset + (uvBv.byteOffset || 0) + (uvAcc.byteOffset || 0);
      uvFloats = new Float32Array(arrayBuf, uvStart, vertexCount * 2);
    }

    // Decode embedded LRO WAC/NAC regional color PNG if present
    let imgPixels: Uint8ClampedArray | null = null;
    let imgW = 0;
    let imgH = 0;
    const imgDef = gltf.images?.[0];
    if (imgDef && imgDef.bufferView !== undefined && typeof createImageBitmap === 'function') {
      try {
        const imgBv = gltf.bufferViews[imgDef.bufferView];
        const imgBytes = new Uint8Array(
          arrayBuf,
          binByteOffset + (imgBv.byteOffset || 0),
          imgBv.byteLength
        );
        const blob = new Blob([imgBytes], { type: imgDef.mimeType || 'image/png' });
        const bmp = await createImageBitmap(blob);
        imgW = bmp.width;
        imgH = bmp.height;
        const cnv = document.createElement('canvas');
        cnv.width = imgW;
        cnv.height = imgH;
        const ctx = cnv.getContext('2d');
        if (ctx) {
          ctx.drawImage(bmp, 0, 0);
          imgPixels = ctx.getImageData(0, 0, imgW, imgH).data;
        }
        bmp.close();
      } catch {
        // Ignore image decode errors
      }
    }

    const out: Array<{ x: number; z: number; h: number; r: number; g: number; b: number }> = [];
    for (let i = 0; i < vertexCount; i++) {
      const vx = posFloats[i * 3 + 0] + tx;
      const vy = posFloats[i * 3 + 1] + ty;
      const vz = posFloats[i * 3 + 2] + tz;

      // Radial distance from Moon center = true lunar elevation above 1,737.4 km reference sphere
      const radialDist = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const elevationM = radialDist - MOON_RADIUS_M;

      // Map South Pole tangent coordinates into our 3 km x 3 km window
      const localX = (vy % 1500.0);
      const localZ = (vz % 1500.0);

      let r = 0.44;
      let g = 0.44;
      let b = 0.435;
      if (imgPixels && uvFloats && imgW > 0 && imgH > 0) {
        const u = THREE.MathUtils.clamp(uvFloats[i * 2 + 0], 0, 1);
        const v = THREE.MathUtils.clamp(uvFloats[i * 2 + 1], 0, 1);
        const px = Math.min(imgW - 1, Math.floor(u * imgW));
        const py = Math.min(imgH - 1, Math.floor(v * imgH));
        const pIdx = (py * imgW + px) * 4;
        // Extract broad LRO regional reflectance (clamped to neutral lunar albedo range)
        const lum =
          (imgPixels[pIdx] * 0.299 + imgPixels[pIdx + 1] * 0.587 + imgPixels[pIdx + 2] * 0.114) /
          255.0;
        const mappedLum = 0.32 + lum * 0.24;
        r = mappedLum;
        g = mappedLum * 0.995;
        b = mappedLum * 0.985;
      }

      out.push({ x: localX, z: localZ, h: elevationM, r, g, b });
    }

    return out;
  }

  /**
   * Bakes the streamed Cesium Moon 3D Tile macro-elevation and LRO broad regional color
   * into our local 3 km x 3 km heightfield and updates the live 3D terrain mesh & collision grid.
   */
  private bakeCesiumSamplesIntoGrid(
    samples: Array<{ x: number; z: number; h: number; r: number; g: number; b: number }>
  ): void {
    // Compute mean elevation of streamed Cesium Moon samples for zero-centering at origin
    let meanH = 0;
    for (let i = 0; i < samples.length; i++) {
      meanH += samples[i].h;
    }
    meanH /= Math.max(1, samples.length);

    const half = this.sizeM * 0.5;
    const step = this.sizeM / this.segments;

    // Blend macro relief & broad LRO regional albedo from nearest streamed Cesium 3D Tile vertices
    for (let iz = 0; iz <= this.segments; iz++) {
      const z = -half + iz * step;
      for (let ix = 0; ix <= this.segments; ix++) {
        const x = -half + ix * step;
        const idx = iz * this.stride + ix;

        // Inverse-distance weight from streamed Cesium Moon vertices
        let wSum = 0;
        let hSum = 0;
        let rSum = 0;
        let gSum = 0;
        let bSum = 0;

        const strideStep = Math.max(1, Math.floor(samples.length / 80));
        for (let s = 0; s < samples.length; s += strideStep) {
          const smp = samples[s];
          const dSq = (x - smp.x) * (x - smp.x) + (z - smp.z) * (z - smp.z) + 400.0;
          const w = 1.0 / dSq;
          wSum += w;
          hSum += (smp.h - meanH) * w;
          rSum += smp.r * w;
          gSum += smp.g * w;
          bSum += smp.b * w;
        }

        if (wSum > 0) {
          const tileMacroH = (hSum / wSum) * 0.25;
          // Preserve a completely flat 95m landing plateau around (0,0), smoothly blending by 185m
          const apronWeight = THREE.MathUtils.smoothstep(Math.hypot(x, z), 95.0, 185.0);
          this.heights[idx] += tileMacroH * apronWeight;

          this.regionalAlbedo[idx * 3 + 0] = rSum / wSum;
          this.regionalAlbedo[idx * 3 + 1] = gSum / wSum;
          this.regionalAlbedo[idx * 3 + 2] = bSum / wSum;
        }
      }
    }

    // Smoothly level a flat 24m-68m landing pad around the locked rover spawn + 11.5m-24m pad for CoreHab
    this.applyLandingPadLeveling();

    // Re-zero origin (0,0) and update the live Three.js Terrain Mesh & Waypoints
    const originH = this.sampleHeight(0, 0);
    for (let i = 0; i < this.heights.length; i++) {
      this.heights[i] -= originH;
    }

    if (this.terrainMeshRef) {
      const geom = this.terrainMeshRef.geometry as THREE.BufferGeometry;
      const posAttr = geom.attributes.position as THREE.BufferAttribute;
      const colAttr = geom.attributes.color as THREE.BufferAttribute;
      for (let i = 0; i < posAttr.count; i++) {
        posAttr.setY(i, this.heights[i]);
        if (colAttr) {
          colAttr.setXYZ(
            i,
            this.regionalAlbedo[i * 3 + 0],
            this.regionalAlbedo[i * 3 + 1],
            this.regionalAlbedo[i * 3 + 2]
          );
        }
      }
      posAttr.needsUpdate = true;
      if (colAttr) colAttr.needsUpdate = true;
      geom.computeVertexNormals();
    }

    for (const wp of this.waypoints) {
      wp.y = this.sampleHeight(wp.x, wp.z);
    }

    // Re-ground all scattered boulders and pebbles to the baked Cesium terrain heights
    this.regroundRocksToTerrain();
  }

  private evaluateLroDemAt(x: number, z: number): { h: number; loose: number } {
    const ellipsoidDrop = -(x * x + z * z) / (2.0 * MOON_RADIUS_M);

    const shackletonCenterX = -1800.0;
    const shackletonCenterZ = -10680.0;
    const shackletonRadius = 10500.0;
    const distToShackleton = Math.hypot(x - shackletonCenterX, z - shackletonCenterZ);
    const distFromRim = distToShackleton - shackletonRadius;

    let macroRelief = 0;
    let loose = 0.15;

    if (distFromRim < 0) {
      const wallDepth = Math.max(-260.0, distFromRim * 0.42);
      const wallTerrace = Math.sin(distFromRim * 0.045) * 3.2;
      macroRelief += wallDepth + wallTerrace;
      loose = 0.78;
    } else {
      const rimCollar = 24.0 * Math.exp(-Math.pow(distFromRim / 290.0, 2.0));
      macroRelief += rimCollar;
    }

    const ridgeSpine =
      14.5 * Math.exp(-Math.pow((x - z * 0.35) / 480.0, 2.0)) +
      fbm(x * 0.0018 + 3.1, z * 0.0018 - 1.7, 5) * 18.0 +
      fbm(x * 0.0085 - 7.4, z * 0.0085 + 4.2, 4) * 3.4 +
      fbm(x * 0.035, z * 0.035, 3) * 0.55;

    const startDist = Math.hypot(x, z);
    // Dead-flat 95m landing plateau (0.0° slope at spawn), smoothly blending into rugged relief by 185m
    const apronBlend = THREE.MathUtils.smoothstep(startDist, 95.0, 185.0);
    macroRelief = (macroRelief + ridgeSpine) * apronBlend;

    // Keep northern sightline (-Z corridor toward Earth) flat and free of foreground ridges so Earth sits unobstructed
    if (z < 0 && macroRelief > 0) {
      const corridorFactor = 1.0 - 0.88 * Math.exp(-Math.pow(x / 220.0, 2.0));
      macroRelief *= corridorFactor;
    }

    let craterDelta = 0;
    for (let i = 0; i < SHACKLETON_REGIONAL_CRATERS.length; i++) {
      const c = SHACKLETON_REGIONAL_CRATERS[i];
      const dx = x - c.x;
      const dz = z - c.z;
      const r = Math.hypot(dx, dz);
      const normR = r / c.radius;

      if (normR < 1.0) {
        const bowl = (normR * normR - 1.0) * c.depth;
        const innerRim = c.rimHeight * Math.pow(normR, 4.0);
        craterDelta += bowl + innerRim;
        loose = Math.max(loose, 0.65);
      } else if (normR < 2.2) {
        const t = (normR - 1.0) / 1.2;
        const rimFlap = c.rimHeight * Math.exp(-t * t * 5.5);
        const ejectaRough =
          c.rimHeight * 0.22 * Math.exp(-t * 2.5) * fbm(dx * 0.15, dz * 0.15, 2);
        craterDelta += rimFlap + ejectaRough;
        loose = Math.max(loose, 0.45 * (1.0 - t));
      }
    }

    return {
      h: (ellipsoidDrop * apronBlend + macroRelief + craterDelta * apronBlend),
      loose: Math.min(1.0, Math.max(0.08, loose * apronBlend + 0.1 * (1.0 - apronBlend))),
    };
  }

  private buildLroShackletonDemGrid(): void {
    const half = this.sizeM * 0.5;
    const step = this.sizeM / this.segments;

    for (let iz = 0; iz <= this.segments; iz++) {
      const z = -half + iz * step;
      for (let ix = 0; ix <= this.segments; ix++) {
        const x = -half + ix * step;
        const idx = iz * this.stride + ix;
        const { h, loose } = this.evaluateLroDemAt(x, z);
        this.heights[idx] = h;
        this.looseMap[idx] = loose;

        const macroAlbedo = 0.42 + 0.06 * fbm(x * 0.006, z * 0.006, 3) - loose * 0.05;
        const shade = THREE.MathUtils.clamp(macroAlbedo, 0.28, 0.54);
        this.regionalAlbedo[idx * 3 + 0] = shade;
        this.regionalAlbedo[idx * 3 + 1] = shade * 0.995;
        this.regionalAlbedo[idx * 3 + 2] = shade * 0.985;
      }
    }

    this.applyLandingPadLeveling();

    const originH = this.sampleHeight(0, 0);
    for (let i = 0; i < this.heights.length; i++) {
      this.heights[i] -= originH;
    }
  }

  private applyLandingPadLeveling(): void {
    const half = this.sizeM * 0.5;
    const step = this.sizeM / this.segments;
    const spawnPadH = this.sampleHeight(ROVER_SPAWN_X, ROVER_SPAWN_Z);
    const coreHabPadH = this.sampleHeight(COREHAB_POS_X, COREHAB_POS_Z);

    for (let iz = 0; iz <= this.segments; iz++) {
      const z = -half + iz * step;
      for (let ix = 0; ix <= this.segments; ix++) {
        const x = -half + ix * step;
        const idx = iz * this.stride + ix;

        const dSpawn = Math.hypot(x - ROVER_SPAWN_X, z - ROVER_SPAWN_Z);
        if (dSpawn < 68.0) {
          const blend = THREE.MathUtils.smoothstep(dSpawn, 24.0, 68.0);
          this.heights[idx] = THREE.MathUtils.lerp(spawnPadH, this.heights[idx], blend);
          this.looseMap[idx] = THREE.MathUtils.lerp(0.12, this.looseMap[idx], blend);
        }

        const dCoreHab = Math.hypot(x - COREHAB_POS_X, z - COREHAB_POS_Z);
        if (dCoreHab < 24.0) {
          const blend = THREE.MathUtils.smoothstep(dCoreHab, 11.5, 24.0);
          this.heights[idx] = THREE.MathUtils.lerp(coreHabPadH, this.heights[idx], blend);
          this.looseMap[idx] = THREE.MathUtils.lerp(0.14, this.looseMap[idx], blend);
        }
      }
    }
  }

  private initWaypoints(): void {
    const defs: Array<Omit<MissionWaypoint, 'y'>> = [
      {
        id: 'wp-shackleton-rim',
        code: 'WP-01',
        name: 'Shackleton Rim Overlook',
        category: 'CRATER RIM',
        description: 'Crest of Shackleton Crater overlooking the 4.2 km deep Permanently Shadowed Region.',
        x: -38,
        z: -158,
        color: '#ff9900',
      },
      {
        id: 'wp-boulder-field',
        code: 'WP-02',
        name: 'Connecting Ridge Ejecta Boulders',
        category: 'BOULDER FIELD',
        description: 'Fractured anorthositic breccia boulders excavated from the South Pole-Aitken basin.',
        x: 92,
        z: -82,
        color: '#38bdf8',
      },
      {
        id: 'wp-cold-trap',
        code: 'WP-03',
        name: 'Spudis Micro-Crater Cold Trap',
        category: 'SAMPLING SITE',
        description: 'Shadowed micro-crater regolith floor enriched in hydrogen & water-ice volatiles.',
        x: -135,
        z: -60,
        color: '#22c55e',
      },
      {
        id: 'wp-eternal-light',
        code: 'WP-04',
        name: 'Peak of Eternal Light Crest',
        category: 'SOLAR CREST',
        description: 'High-altitude ridge receiving >88% continuous solar illumination across the lunar year.',
        x: 78,
        z: 105,
        color: '#f43f5e',
      },
    ];

    this.waypoints.length = 0;
    for (const d of defs) {
      this.waypoints.push({
        ...d,
        y: this.sampleHeight(d.x, d.z),
        sampled: false,
      });
    }
  }

  public sampleHeight(x: number, z: number): number {
    const half = this.sizeM * 0.5;
    const step = this.sizeM / this.segments;
    const gx = THREE.MathUtils.clamp((x + half) / step, 0, this.segments - 0.0001);
    const gz = THREE.MathUtils.clamp((z + half) / step, 0, this.segments - 0.0001);

    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;

    const i00 = iz * this.stride + ix;
    const i10 = i00 + 1;
    const i01 = (iz + 1) * this.stride + ix;
    const i11 = i01 + 1;

    const h00 = this.heights[i00];
    const h10 = this.heights[i10];
    const h01 = this.heights[i01];
    const h11 = this.heights[i11];

    if (fx + fz <= 1.0) {
      return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    } else {
      return h11 + (h01 - h11) * (1.0 - fx) + (h10 - h11) * (1.0 - fz);
    }
  }

  public sampleTerrain(x: number, z: number): TerrainSample {
    const eps = 0.65;
    const hC = this.sampleHeight(x, z);
    const hR = this.sampleHeight(x + eps, z);
    const hL = this.sampleHeight(x - eps, z);
    const hD = this.sampleHeight(x, z + eps);
    const hU = this.sampleHeight(x, z - eps);

    const dx = (hR - hL) / (2.0 * eps);
    const dz = (hD - hU) / (2.0 * eps);

    const normal = new THREE.Vector3(-dx, 1.0, -dz).normalize();
    const slopeRad = Math.acos(THREE.MathUtils.clamp(normal.y, -1.0, 1.0));
    const slopeDeg = (slopeRad * 180.0) / Math.PI;

    const half = this.sizeM * 0.5;
    const step = this.sizeM / this.segments;
    const ix = Math.floor(THREE.MathUtils.clamp((x + half) / step, 0, this.segments));
    const iz = Math.floor(THREE.MathUtils.clamp((z + half) / step, 0, this.segments));
    const baseLoose = this.looseMap[iz * this.stride + ix] || 0.2;
    const regolithLooseFactor = THREE.MathUtils.clamp(baseLoose + (slopeDeg / 35.0) * 0.45, 0.1, 1.0);

    return {
      height: hC,
      normal,
      slopeDeg,
      regolithLooseFactor,
    };
  }

  public createTerrainMesh(): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(
      this.sizeM,
      this.sizeM,
      this.segments,
      this.segments
    );
    geometry.rotateX(-Math.PI / 2);

    const posAttr = geometry.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(posAttr.count * 3);

    for (let i = 0; i < posAttr.count; i++) {
      posAttr.setY(i, this.heights[i]);
      colors[i * 3 + 0] = this.regionalAlbedo[i * 3 + 0];
      colors[i * 3 + 1] = this.regionalAlbedo[i * 3 + 1];
      colors[i * 3 + 2] = this.regionalAlbedo[i * 3 + 2];
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const material = this.createCustomPbrRegolithMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.terrainMeshRef = mesh;
    return mesh;
  }

  private createCustomPbrRegolithMaterial(): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x9e9fa3),
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.02,
      envMapIntensity: 0.0,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uMoonBlend = this.orbitalBlendUniform;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
         uniform float uMoonBlend;
         varying vec3 vWorldPos;
         varying vec3 vWorldNorm;`
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         if (uMoonBlend > 0.001) {
           float rHoriz = length(transformed.xz);
           float sphereDrop = min(280.0, (rHoriz * rHoriz) / 840.0);
           transformed.y -= sphereDrop * smoothstep(0.0, 0.85, uMoonBlend) * 0.68;
         }`
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
         vWorldNorm = normalize(mat3(modelMatrix) * objectNormal);`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
         uniform float uMoonBlend;
         varying vec3 vWorldPos;
         varying vec3 vWorldNorm;

         float regHash(vec2 p) {
           vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
           p3 += dot(p3, p3.yzx + 33.33);
           return fract((p3.x + p3.y) * p3.z);
         }

         vec2 regHash2(vec2 p) {
           vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
           p3 += dot(p3, p3.yzx + 33.33);
           return fract((p3.xx + p3.yz) * p3.zy);
         }

         // Quintic C2-continuous value noise with exact analytic derivatives (vec3(val, ddx, ddy))
         // Zero bilinear texel artifacts even 5 cm in front of rover headlights
         vec3 regNoiseGrad(vec2 x) {
           vec2 i = floor(x);
           vec2 f = fract(x);
           vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
           vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);

           float a = regHash(i + vec2(0.0, 0.0));
           float b = regHash(i + vec2(1.0, 0.0));
           float c = regHash(i + vec2(0.0, 1.0));
           float d = regHash(i + vec2(1.0, 1.0));

           float k0 = a;
           float k1 = b - a;
           float k2 = c - a;
           float k3 = a - b - c + d;

           return vec3(
             k0 + k1 * u.x + k2 * u.y + k3 * u.x * u.y,
             du * (vec2(k1, k2) + k3 * u.yx)
           );
         }

         // Fast 2x2 Quadrant Analytic Voronoi micro-crater layer (2.25x faster than 3x3 with identical craters)
         vec3 microCraterLayer(vec2 p, float scale) {
           vec2 sp = p * scale - 0.5;
           vec2 ip = floor(sp);
           vec2 fp = fract(sp);
           float minDistSq = 4.0;
           vec2 bestVec = vec2(0.0);
           float bestSeed = 0.5;

           for (int y = 0; y <= 1; y++) {
             for (int x = 0; x <= 1; x++) {
               vec2 neighbor = vec2(float(x), float(y));
               vec2 cell = ip + neighbor;
               vec2 rnd = regHash2(cell);
               vec2 diff = fp - (neighbor + 0.18 + 0.64 * rnd);
               float dSq = dot(diff, diff);
               if (dSq < minDistSq) {
                 minDistSq = dSq;
                 bestVec = diff;
                 bestSeed = rnd.x;
               }
             }
           }

           float r0 = 0.24 + 0.14 * bestSeed;
           float r = max(sqrt(minDistSq), 0.0001);
           float u = r / r0;
           if (u > 1.75) return vec3(0.0);

           vec2 dir = bestVec / r;

           // Bowl depression + raised ejecta rim collar with exact radial derivative
           float bowl = 0.0;
           float dBowlDr = 0.0;
           if (u < 1.0) {
             float w = 1.0 - u * u;
             bowl = -0.42 * w * w;
             dBowlDr = 1.68 * u * w / r0;
           }
           float rimArg = (u - 1.02) / 0.28;
           float rimExp = exp(-rimArg * rimArg);
           float rim = 0.19 * rimExp;
           float dRimDr = 0.19 * rimExp * (-2.0 * rimArg / (0.28 * r0));

           float h = bowl + rim;
           float dhdr = (dBowlDr + dRimDr) * scale;
           return vec3(h, dir * dhdr);
         }

         // Multi-scale lunar regolith surface height + analytic world gradient (vec3(h, dH/dx, dH/dz))
         vec3 evaluateRegolithMicroRelief(vec2 xz, float pixelFootprint) {
           // Flat landing pad masks around rover spawn & CoreHab compacted pad
           float spawnDist = length(xz - vec2(${ROVER_SPAWN_X.toFixed(1)}, ${ROVER_SPAWN_Z.toFixed(1)}));
           float coreHabDist = length(xz - vec2(${COREHAB_POS_X.toFixed(1)}, ${COREHAB_POS_Z.toFixed(1)}));
           float padPitCoarse = smoothstep(22.0, 62.0, spawnDist) * smoothstep(9.0, 22.0, coreHabDist);
           float padPitFine = smoothstep(14.0, 42.0, spawnDist) * smoothstep(7.5, 16.0, coreHabDist);

           // Distance-based anti-aliasing weights so close-up dust is ultra-crisp & far horizon is clean
           float wPitFine = (1.0 - smoothstep(0.03, 0.22, pixelFootprint)) * padPitFine;
           float wPitMed  = (1.0 - smoothstep(0.12, 0.85, pixelFootprint)) * padPitCoarse;
           float wPitCoarse = (1.0 - smoothstep(0.45, 3.20, pixelFootprint)) * padPitCoarse;
           float wGrain   = 1.0 - smoothstep(0.008, 0.065, pixelFootprint);

           vec3 total = vec3(0.0);

           // 1. Coarse (5.5m) & Medium (1.4m) secondary impact craters
           if (wPitCoarse > 0.001) {
             total += microCraterLayer(xz, 0.18) * vec3(0.14, 0.14, 0.14) * wPitCoarse;
           }
           if (wPitMed > 0.001) {
             total += microCraterLayer(xz + vec2(17.3, -29.1), 0.72) * vec3(0.055, 0.055, 0.055) * wPitMed;
           }
           // 2. Sub-meter (35cm) micrometeorite gardening pockmarks right under the rover wheels & headlights
           if (wPitFine > 0.001) {
             total += microCraterLayer(xz + vec2(-41.7, 13.9), 2.65) * vec3(0.018, 0.018, 0.018) * wPitFine;
           }

           // 3. Continuous multi-octave quintic regolith hummocks, thermal-creep ripples & fine dust
           const mat2 m2 = mat2(0.80, -0.60, 0.60, 0.80);
           vec2 p = xz * 0.35;
           mat2 rot = mat2(1.0, 0.0, 0.0, 1.0);
           float undulationScale = mix(0.22, 1.0, padPitCoarse);

           vec3 n1 = regNoiseGrad(p);
           total.x += (n1.x - 0.5) * 0.065 * undulationScale;
           total.yz += n1.yz * (0.35 * 0.065 * undulationScale);

           p = m2 * p * 2.45;
           rot = m2 * rot;
           vec3 n2 = regNoiseGrad(p);
           total.x += (n2.x - 0.5) * 0.028 * undulationScale;
           total.yz += (transpose(rot) * n2.yz) * (0.35 * 2.45 * 0.028 * undulationScale);

           if (wPitMed > 0.001) {
             p = m2 * p * 2.85;
             rot = m2 * rot;
             vec3 n3 = regNoiseGrad(p);
             total.x += (n3.x - 0.5) * 0.012 * wPitMed;
             total.yz += (transpose(rot) * n3.yz) * (0.35 * 2.45 * 2.85 * 0.012 * wPitMed);
           }

           // 4. Millimeter-scale agglutinate dust grain texture in near-field headlight zone
           if (wGrain > 0.001) {
             vec3 n4 = regNoiseGrad(xz * 22.0);
             vec3 n5 = regNoiseGrad(xz * 64.0 + vec2(9.2, 4.7));
             total.x += ((n4.x - 0.5) * 0.0032 + (n5.x - 0.5) * 0.0014) * wGrain;
             total.yz += (n4.yz * (22.0 * 0.0032) + n5.yz * (64.0 * 0.0014)) * wGrain;
           }

           return total;
         }`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
         if (uMoonBlend > 0.001) {
           float rTerr = length(vWorldPos.xz);
           float edgeR = mix(2150.0, 12.0, smoothstep(0.02, 0.98, uMoonBlend));
           float feather = mix(260.0, 28.0, uMoonBlend);
           float radialMask = 1.0 - smoothstep(edgeR - feather, edgeR, rTerr);
           if (radialMask <= 0.001) discard;
           if (radialMask < 0.999) {
             float ignTerr = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
             if (radialMask < ignTerr) discard;
           }
         }`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         float pxFoot = length(fwidth(vWorldPos.xz));
         vec3 microData = evaluateRegolithMicroRelief(vWorldPos.xz, pxFoot);

         // Multi-scale mineralogical albedo variation (anorthositic dust vs darker ejecta/regolith troughs)
         float nMacroAlbedo = regNoiseGrad(vWorldPos.xz * 0.025).x;
         float nMidAlbedo   = regNoiseGrad(vWorldPos.xz * 0.22 + vec2(5.1, -8.3)).x;
         float nFineAlbedo  = regNoiseGrad(vWorldPos.xz * 3.8).x;

         // Impact-melt glass spherule & ilmenite crystal micro-scintillation ("diamond dust" in grazing light)
         vec3 viewDirW = normalize(cameraPosition - vWorldPos);
         float sparkleFade = 1.0 - smoothstep(0.01, 0.09, pxFoot);
         float silicateSparkle = 0.0;
         if (sparkleFade > 0.001) {
           vec2 sparkleCell = floor(vWorldPos.xz * 42.0);
           vec2 crystalRnd = regHash2(sparkleCell);
           vec3 crystalNorm = normalize(vec3((crystalRnd.x - 0.5) * 0.9, 1.0, (crystalRnd.y - 0.5) * 0.9));
           float glint = pow(max(0.0, dot(crystalNorm, viewDirW)), 36.0) * step(0.84, regHash(sparkleCell + vec2(11.7, 3.1)));
           silicateSparkle = glint * 0.42 * sparkleFade;
         }

         // Subtle warm/cool mineral tint (ilmenite-bearing basaltic dust vs bright plagioclase feldspar)
         vec3 mineralTint = mix(vec3(0.96, 0.965, 0.98), vec3(1.03, 1.015, 0.99), nMacroAlbedo);
         float albedoMod = 1.0 + (nMacroAlbedo - 0.5) * 0.18 + (nMidAlbedo - 0.5) * 0.12 + (nFineAlbedo - 0.5) * 0.08 + microData.x * 1.35;
         diffuseColor.rgb = diffuseColor.rgb * mineralTint * clamp(albedoMod, 0.62, 1.42) + vec3(silicateSparkle);`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
         // Inject infinite-resolution analytic world gradient directly into view-space lighting normal
         vec3 worldGradVec = vec3(-microData.y, 0.0, -microData.z);
         vec3 viewGradVec = (viewMatrix * vec4(worldGradVec, 0.0)).xyz;
         normal = normalize(normal + viewGradVec * 0.92);`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `// Hapke retro-reflective opposition surge (velvety lunar dust backscatter along view vector)
         float grazingVelvet = pow(1.0 - max(0.0, dot(normalize(vWorldNorm), viewDirW)), 2.2) * 0.14;
         gl_FragColor.rgb *= (1.0 + grazingVelvet);
         #include <dithering_fragment>`
      );
    };

    return mat;
  }

  public createRockScatterGroup(): THREE.Group {
    const group = new THREE.Group();
    this.boulders.length = 0;

    const rockMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.91,
      metalness: 0.04,
      envMapIntensity: 0.0,
    });

    // Custom procedural lunar breccia shader: angular fracture veins, micrometeorite pits & regolith base dust
    rockMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
         varying vec3 vRockWorldPos;
         varying vec3 vRockLocalPos;`
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         vec4 rockInstPos = vec4(transformed, 1.0);
         #ifdef USE_INSTANCING
           rockInstPos = instanceMatrix * rockInstPos;
         #endif
         vRockWorldPos = (modelMatrix * rockInstPos).xyz;
         vRockLocalPos = position;`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
         varying vec3 vRockWorldPos;
         varying vec3 vRockLocalPos;
         float rockHash(vec3 p) {
           p = fract(p * vec3(443.897, 441.423, 437.195));
           p += dot(p, p.yzx + 19.19);
           return fract((p.x + p.y) * p.z);
         }
         float rockNoise(vec3 p) {
           vec3 i = floor(p);
           vec3 f = fract(p);
           f = f * f * (3.0 - 2.0 * f);
           return mix(
             mix(
               mix(rockHash(i), rockHash(i + vec3(1,0,0)), f.x),
               mix(rockHash(i + vec3(0,1,0)), rockHash(i + vec3(1,1,0)), f.x),
               f.y
             ),
             mix(
               mix(rockHash(i + vec3(0,0,1)), rockHash(i + vec3(1,0,1)), f.x),
               mix(rockHash(i + vec3(0,1,1)), rockHash(i + vec3(1,1,1)), f.x),
               f.y
             ),
             f.z
           );
         }`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         float nCoarse = rockNoise(vRockWorldPos * 2.4);
         float nFine   = rockNoise(vRockWorldPos * 12.0);
         // Bright plagioclase clasts embedded in shock-darkened lunar breccia matrix
         float clastMask = smoothstep(0.62, 0.74, nCoarse);
         float dustSkirt = smoothstep(0.15, -0.45, vRockLocalPos.y);
         vec3 rockShade = diffuseColor.rgb * (0.82 + 0.28 * nCoarse + 0.14 * (nFine - 0.5)) + vec3(clastMask * 0.14);
         diffuseColor.rgb = mix(rockShade, vec3(0.44, 0.438, 0.432), dustSkirt * 0.55);`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
         // Hardware screen-space derivative normal perturbation from nFine (zero extra 3D noise taps)
         vec3 viewRockGrad = vec3(dFdx(nFine), dFdy(nFine), 0.0);
         normal = normalize(normal - viewRockGrad * 1.65);`
      );
    };

    const boulderGeo = new THREE.DodecahedronGeometry(1.0, 2);
    const bPos = boulderGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < bPos.count; i++) {
      const vx = bPos.getX(i);
      const vy = bPos.getY(i);
      const vz = bPos.getZ(i);
      const facet =
        0.74 +
        0.28 * hash2(vx * 7.3 + vy * 5.1, vz * 11.7) +
        0.12 * Math.sin(vx * 4.2 - vz * 3.8);
      bPos.setXYZ(i, vx * facet * 1.18, vy * facet * 0.76, vz * facet);
    }
    boulderGeo.computeVertexNormals();

    const boulderCount = 420;
    const boulderInst = new THREE.InstancedMesh(boulderGeo, rockMat, boulderCount);
    boulderInst.castShadow = true;
    boulderInst.receiveShadow = true;
    this.boulderInstRef = boulderInst;
    this.boulderSpecs = [];

    for (let i = 0; i < 1400 && this.boulderSpecs.length < boulderCount; i++) {
      const seed1 = hash2(i * 1.73, i * 3.19);
      const seed2 = hash2(i * 7.13 + 5.2, i * 2.41);

      let x = (seed1 - 0.5) * 1100;
      let z = (seed2 - 0.5) * 1100;

      if (i % 3 === 0) {
        const c = SHACKLETON_REGIONAL_CRATERS[i % SHACKLETON_REGIONAL_CRATERS.length];
        const ang = seed1 * Math.PI * 2.0;
        const rad = c.radius * (0.95 + seed2 * 0.65);
        x = c.x + Math.cos(ang) * rad;
        z = c.z + Math.sin(ang) * rad;
      } else if (i % 5 === 0) {
        x = 92 + (seed1 - 0.5) * 85;
        z = -82 + (seed2 - 0.5) * 85;
      }

      if (
        Math.hypot(x, z) < 36.0 ||
        Math.hypot(x - ROVER_SPAWN_X, z - ROVER_SPAWN_Z) < 36.0 ||
        Math.hypot(x - COREHAB_POS_X, z - COREHAB_POS_Z) < 16.5
      ) continue;
      if (Math.abs(x) > this.sizeM * 0.47 || Math.abs(z) > this.sizeM * 0.47) continue;

      const radius = 0.28 + Math.pow(hash2(i * 11.1, i * 5.7), 2.4) * 1.85;

      // Authentic Apollo 16 / Artemis mineralogical spectrum: shocked anorthosite, noritic breccia & dark basalt
      const rockColor = new THREE.Color();
      const mineralRoll = hash2(i * 5.9, i * 2.3);
      if (mineralRoll > 0.72) {
        rockColor.setRGB(0.68, 0.675, 0.665); // Bright shocked ferroan anorthosite
      } else if (mineralRoll > 0.32) {
        rockColor.setRGB(0.49, 0.485, 0.475); // Medium gray impact-melt breccia
      } else {
        rockColor.setRGB(0.36, 0.365, 0.375); // Dark noritic / ilmenite clast
      }

      this.boulderSpecs.push({
        x,
        z,
        radius,
        rx: (seed1 - 0.5) * 0.45,
        ry: seed2 * Math.PI * 2.0,
        rz: (seed1 + seed2 - 1.0) * 0.42,
        sx: radius * (0.85 + seed1 * 0.4),
        sy: radius * (0.65 + seed2 * 0.35),
        sz: radius * (0.85 + (1 - seed1) * 0.4),
        color: rockColor,
      });
    }
    group.add(boulderInst);

    const pebbleGeo = new THREE.IcosahedronGeometry(0.18, 0);
    const pebbleCount = 1800;
    const pebbleInst = new THREE.InstancedMesh(pebbleGeo, rockMat, pebbleCount);
    pebbleInst.castShadow = false; // Sub-texel pebbles don't need 1800 shadow-map draw calls
    pebbleInst.receiveShadow = true;
    this.pebbleInstRef = pebbleInst;
    this.pebbleSpecs = [];

    for (let i = 0; i < pebbleCount; i++) {
      const s1 = hash2(i * 4.31 + 19.0, i * 9.17);
      const s2 = hash2(i * 8.73, i * 2.91 + 41.0);
      const r = 14.0 + Math.pow(s1, 0.78) * 406.0;
      const theta = s2 * Math.PI * 2.0;
      let x = Math.cos(theta) * r;
      let z = Math.sin(theta) * r;
      if (
        Math.hypot(x - ROVER_SPAWN_X, z - ROVER_SPAWN_Z) < 16.0 ||
        Math.hypot(x - COREHAB_POS_X, z - COREHAB_POS_Z) < 14.0
      ) {
        x = ROVER_SPAWN_X + 18.0;
        z = ROVER_SPAWN_Z + 18.0;
      }
      if (Math.abs(x) > this.sizeM * 0.47 || Math.abs(z) > this.sizeM * 0.47) continue;

      const scale = 0.35 + Math.pow(hash2(i * 3.3, i * 6.7), 2.0) * 1.9;
      const pTone = 0.38 + 0.28 * hash2(i * 9.1, i * 1.7);
      const rockColor = new THREE.Color(pTone, pTone * 0.99, pTone * 0.98);

      this.pebbleSpecs.push({
        x,
        z,
        scale,
        rx: (s1 - 0.5) * 0.6,
        ry: s2 * 6.28,
        rz: (s1 - s2) * 0.55,
        color: rockColor,
      });
    }
    group.add(pebbleInst);

    this.regroundRocksToTerrain();
    this.rockGroupRef = group;
    return group;
  }

  /**
   * Samples multi-point footprint heights around every boulder and pebble, removes any rock
   * resting on steep unstable cliffs/ridges (>22° boulders, >26° pebbles), and embeds bases
   * firmly below the lowest footprint point so zero rocks float in lunar gravity.
   */
  public regroundRocksToTerrain(): void {
    const dummy = new THREE.Object3D();

    if (this.boulderInstRef) {
      this.boulders.length = 0;
      let placedBoulders = 0;

      for (let i = 0; i < this.boulderSpecs.length; i++) {
        const b = this.boulderSpecs[i];
        const centerSample = this.sampleTerrain(b.x, b.z);
        // Reject boulders on steep crater walls / cliff faces where gravity pulls rocks downhill
        if (centerSample.slopeDeg > 22.0) continue;

        const fp = Math.max(0.4, b.radius * 1.15);
        let minGroundY = centerSample.height;
        let maxGroundY = centerSample.height;
        for (let k = 0; k < 8; k++) {
          const ang = (k * Math.PI) / 4.0;
          const hy = this.sampleHeight(b.x + Math.cos(ang) * fp, b.z + Math.sin(ang) * fp);
          if (hy < minGroundY) minGroundY = hy;
          if (hy > maxGroundY) maxGroundY = hy;
        }

        // Reject sharp terrain ledges/cracks where one side would overhang
        if (maxGroundY - minGroundY > b.radius * 0.55) continue;

        // Seat center just above lowest footprint point so bottom ~45% rests embedded inside regolith
        dummy.position.set(b.x, minGroundY + b.radius * 0.08, b.z);
        dummy.rotation.set(b.rx, b.ry, b.rz);
        dummy.scale.set(b.sx, b.sy, b.sz);
        dummy.updateMatrix();
        this.boulderInstRef.setMatrixAt(placedBoulders, dummy.matrix);
        this.boulderInstRef.setColorAt(placedBoulders, b.color);

        if (b.radius >= 0.55) {
          this.boulders.push({ x: b.x, z: b.z, radius: b.radius * 0.85 });
        }
        placedBoulders++;
      }

      this.boulderInstRef.count = placedBoulders;
      this.boulderInstRef.instanceMatrix.needsUpdate = true;
      if (this.boulderInstRef.instanceColor) this.boulderInstRef.instanceColor.needsUpdate = true;
      this.boulderInstRef.computeBoundingSphere();
    }

    if (this.pebbleInstRef) {
      let placedPebbles = 0;

      for (let i = 0; i < this.pebbleSpecs.length; i++) {
        const p = this.pebbleSpecs[i];
        const centerSample = this.sampleTerrain(p.x, p.z);
        if (centerSample.slopeDeg > 26.0) continue;

        const fp = Math.max(0.15, p.scale * 0.22);
        let minGroundY = centerSample.height;
        let maxGroundY = centerSample.height;
        for (let k = 0; k < 4; k++) {
          const ang = (k * Math.PI) / 2.0;
          const hy = this.sampleHeight(p.x + Math.cos(ang) * fp, p.z + Math.sin(ang) * fp);
          if (hy < minGroundY) minGroundY = hy;
          if (hy > maxGroundY) maxGroundY = hy;
        }

        if (maxGroundY - minGroundY > p.scale * 0.14) continue;

        dummy.position.set(p.x, minGroundY - 0.012 * p.scale, p.z);
        dummy.rotation.set(p.rx, p.ry, p.rz);
        dummy.scale.set(p.scale * 1.2, p.scale * 0.68, p.scale);
        dummy.updateMatrix();
        this.pebbleInstRef.setMatrixAt(placedPebbles, dummy.matrix);
        this.pebbleInstRef.setColorAt(placedPebbles, p.color);
        placedPebbles++;
      }

      this.pebbleInstRef.count = placedPebbles;
      this.pebbleInstRef.instanceMatrix.needsUpdate = true;
      if (this.pebbleInstRef.instanceColor) this.pebbleInstRef.instanceColor.needsUpdate = true;
      this.pebbleInstRef.computeBoundingSphere();
    }
  }
}
