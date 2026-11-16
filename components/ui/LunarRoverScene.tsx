import { publicAssetUrl } from '../../src/publicAssetUrl.js';
'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  ShackletonTerrainPipeline,
  LUNAR_GRAVITY,
  ROVER_SPAWN_X,
  ROVER_SPAWN_Z,
  ROVER_SPAWN_HEADING,
  ROVER_SPAWN_ORBIT_YAW,
  ROVER_SPAWN_ORBIT_PITCH,
  ROVER_SPAWN_ORBIT_DIST,
  ROVER_INTRO_ORBIT_DIST,
  COREHAB_POS_X,
  COREHAB_POS_Z,
  COREHAB_YAW,
} from './ShackletonTerrainPipeline';
import { buildCoreHabBase } from './CoreHabBase';
import { buildLunarLanderModel } from './LunarLanderModel';
import {
  LunarOverviewBackend,
  RIDGE_SHOULDER_SITE,
} from './LunarOverviewModel';
import { sampleAt } from '../manual-planner/core/rehearsal.js';
import { missionPlannerStore, type MissionSample, type MissionResult } from '../manual-planner/missionStore';
import { updateSurfaceMissionSky, createSunOcclusion, SUN_DISPLAY_RADIUS } from './surface-mission-sky.js';
import { MissionSiteSurface } from './mission-site-surface.js';

const EARTH_GLB_URL = publicAssetUrl('assets/aistudio/Earth_1_12756.glb');
const MOON_GLB_URL = publicAssetUrl('assets/aistudio/moon_small.glb');
import SUN_GLB_URL from './Sun_1_1391000.glb?url';

let cachedSoftwareGlResult: boolean | null = null;
function detectSoftwareGl(): boolean {
  if (cachedSoftwareGlResult !== null) return cachedSoftwareGlResult;
  const testCanvas = document.createElement('canvas');
  const gl = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl');
  if (!gl) {
    cachedSoftwareGlResult = true;
    return true;
  }
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
  const gpu = String(gl.getParameter(param));
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  cachedSoftwareGlResult = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  return cachedSoftwareGlResult;
}

interface OrbitalTelemetryState {
  siteTitle: string;
  coordsText: string;
  sunElevDeg: number;
  sunAzimuthDeg: number;
  sunStatus: string;
  earthElevDeg: number;
  earthAzimuthDeg: number;
  earthStatus: string;
}

const ORBITAL_SPEED_PRESETS: { value: number; label: string }[] = [
  { value: 1, label: '1× · real time' },
  { value: 24, label: '24×' },
  { value: 3600, label: '1 hour / second' },
  { value: 86400, label: '1 day / second' },
];

function formatUtcDoyClock(now = new Date()): string {
  const startOfYearUtc = Date.UTC(now.getUTCFullYear(), 0, 0);
  const diffMs = now.getTime() - startOfYearUtc;
  const doy = Math.floor(diffMs / 86400000);
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  return `DOY ${String(doy).padStart(3, '0')} · ${hh}:${mm}:${ss} UTC`;
}

export default function LunarRoverScene({
  active = true,
  embedded = false,
  initialOverview = false,
  pauseDescent = false,
  hideLoadingScreen = false,
  hideOverviewHud = false,
  syncToMissionStore = false,
  onOpenPlanner,
  onAssetsLoaded,
}: {
  active?: boolean;
  embedded?: boolean;
  initialOverview?: boolean;
  pauseDescent?: boolean;
  hideLoadingScreen?: boolean;
  hideOverviewHud?: boolean;
  syncToMissionStore?: boolean;
  onOpenPlanner?: () => void;
  onAssetsLoaded?: () => void;
} = {}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const activeRef = useRef<boolean>(active);
  const pauseDescentRef = useRef<boolean>(pauseDescent);
  const onAssetsLoadedRef = useRef(onAssetsLoaded);

  // Refs for frame-synced orbital distance lines (Earth -> Moon & Moon -> Sun)
  const orbitalDistSvgRef = useRef<SVGSVGElement | null>(null);
  const earthMoonGroupRef = useRef<SVGGElement | null>(null);
  const earthMoonGradRef = useRef<SVGLinearGradientElement | null>(null);
  const earthMoonLineRef = useRef<SVGLineElement | null>(null);
  const earthMoonTextRef = useRef<SVGTextElement | null>(null);
  const moonSunGroupRef = useRef<SVGGElement | null>(null);
  const moonSunGradRef = useRef<SVGLinearGradientElement | null>(null);
  const moonSunLineRef = useRef<SVGLineElement | null>(null);
  const moonSunTextRef = useRef<SVGTextElement | null>(null);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    pauseDescentRef.current = pauseDescent;
  }, [pauseDescent]);

  useEffect(() => {
    onAssetsLoadedRef.current = onAssetsLoaded;
  }, [onAssetsLoaded]);

  const [utcDoyClock, setUtcDoyClock] = useState<string>(() => formatUtcDoyClock());

  const [sceneReady, setSceneReady] = useState(false);
  const [missionSkyReadout, setMissionSkyReadout] = useState<{siteTitle: string; coordinates: string; sample: MissionSample} | null>(null);
  const [missionSkyError, setMissionSkyError] = useState(false);
  const [missionTerrainStatus, setMissionTerrainStatus] = useState('Loading selected-site terrain…');
  const [missionHudActive, setMissionHudActive] = useState(() =>
    syncToMissionStore ? missionPlannerStore.getSnapshot().hasCheckedPlan : false
  );

  useEffect(() => {
    if (!syncToMissionStore) {
      setMissionHudActive(false);
      return;
    }
    const syncHudFlag = () => {
      setMissionHudActive(missionPlannerStore.getSnapshot().hasCheckedPlan);
    };
    syncHudFlag();
    return missionPlannerStore.subscribe(syncHudFlag);
  }, [syncToMissionStore]);
  const [moonOverviewActive] = useState(initialOverview);
  const moonOverviewActiveRef = useRef(initialOverview);
  const exposureRef = useRef(1.18);
  const fovRef = useRef(initialOverview ? 42 : 47);

  // Orbital Overview Dock controls state (OverviewController state machine: playing/mode/speed/timeMs)
  const [orbitalPaused, setOrbitalPaused] = useState(true);
  const orbitalPausedRef = useRef(true);
  const [orbitalMode, setOrbitalMode] = useState<'now' | 'playback'>('playback');
  const orbitalModeRef = useRef<'now' | 'playback'>('playback');
  const [orbitalSpeed, setOrbitalSpeed] = useState<number>(1);
  const orbitalSpeedRef = useRef<number>(1);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [hoveredSpeedIdx, setHoveredSpeedIdx] = useState<number | null>(null);
  const orbitalResetPendingRef = useRef(false);
  const simTimeMsRef = useRef<number>(Date.now());
  const overviewBackendRef = useRef<LunarOverviewBackend | null>(null);

  // Refs & state for initial 2s interactive hand-pointer onboarding demo (selects 24× then Play)
  const playButtonRef = useRef<HTMLButtonElement | null>(null);
  const speedTriggerRef = useRef<HTMLButtonElement | null>(null);
  const speedOption24Ref = useRef<HTMLButtonElement | null>(null);
  const demoHasPlayedRef = useRef(false);
  const [demoCursor, setDemoCursor] = useState<{
    visible: boolean;
    x: number;
    y: number;
    pressing: boolean;
  }>({ visible: false, x: 0, y: 0, pressing: false });
  const [dragCueThinking, setDragCueThinking] = useState(false);

  const [orbitalTelemetry, setOrbitalTelemetry] = useState<OrbitalTelemetryState>({
    siteTitle: RIDGE_SHOULDER_SITE.title,
    coordsText: RIDGE_SHOULDER_SITE.coordsText,
    sunElevDeg: 0,
    sunAzimuthDeg: 0,
    sunStatus: 'Evaluating ephemeris',
    earthElevDeg: 0,
    earthAzimuthDeg: 0,
    earthStatus: 'Evaluating ephemeris',
  });

  // Trigger replay of the 5s powered touchdown sequence when returning to Surface View
  const resetSurfaceToEarthSpawnRef = useRef(false);

  const syncOverviewFromBackend = useCallback((timeMs: number) => {
    const backend = overviewBackendRef.current;
    if (!backend) return;
    const sky = backend.evaluateAt(timeMs);
    const site = backend.getSite();
    setOrbitalTelemetry({
      siteTitle: site.title,
      coordsText: site.coordsText,
      sunElevDeg: sky.sunElDeg,
      sunAzimuthDeg: sky.sunAzDeg,
      sunStatus: sky.sunStatus,
      earthElevDeg: sky.earthElDeg,
      earthAzimuthDeg: sky.earthAzDeg,
      earthStatus: sky.earthStatus,
    });
    setUtcDoyClock(formatUtcDoyClock(new Date(timeMs)));
  }, []);

  const handleToggleOrbitalPause = useCallback(() => {
    const nextPaused = !orbitalPausedRef.current;
    orbitalPausedRef.current = nextPaused;
    setOrbitalPaused(nextPaused);
    if (nextPaused) {
      orbitalModeRef.current = 'playback';
      setOrbitalMode('playback');
    }
    syncOverviewFromBackend(simTimeMsRef.current);
  }, [syncOverviewFromBackend]);

  const handleSelectOrbitalSpeed = useCallback(
    (speedVal: number) => {
      orbitalSpeedRef.current = speedVal;
      setOrbitalSpeed(speedVal);
      orbitalModeRef.current = 'playback';
      setOrbitalMode('playback');
      setSpeedMenuOpen(false);
    },
    []
  );

  const handleOrbitalNow = useCallback(() => {
    const nowMs = Date.now();
    simTimeMsRef.current = nowMs;
    orbitalModeRef.current = 'now';
    setOrbitalMode('now');
    orbitalPausedRef.current = false;
    setOrbitalPaused(false);
    orbitalSpeedRef.current = 1;
    setOrbitalSpeed(1);
    setSpeedMenuOpen(false);
    syncOverviewFromBackend(nowMs);
  }, [syncOverviewFromBackend]);

  const handleResetOrbitalView = useCallback(() => {
    orbitalResetPendingRef.current = true;
    setSpeedMenuOpen(false);
  }, []);

  // Animate "Drag to rotate · scroll to zoom" with a silver thinking-indicator sweep for 12 seconds
  useEffect(() => {
    if (!active || !sceneReady || !moonOverviewActive || hideOverviewHud) {
      setDragCueThinking(false);
      return;
    }
    setDragCueThinking(true);
    const timerId = window.setTimeout(() => {
      setDragCueThinking(false);
    }, 12000);
    return () => window.clearTimeout(timerId);
  }, [active, sceneReady, moonOverviewActive, hideOverviewHud]);

  // Interactive hand-pointer demo 2s after the orbital scene loads into view:
  // Opens Speed dropdown -> selects 24× -> clicks Play button (cancels immediately on user input)
  useEffect(() => {
    if (!active || !sceneReady || !moonOverviewActive || hideOverviewHud || demoHasPlayedRef.current) return;
    demoHasPlayedRef.current = true;

    let cancelled = false;
    const timers: number[] = [];
    const schedule = (ms: number, fn: () => void) => {
      const id = window.setTimeout(() => {
        if (!cancelled) fn();
      }, ms);
      timers.push(id);
    };

    const cancelDemo = (e?: Event) => {
      if (e && !e.isTrusted) return;
      if (cancelled) return;
      cancelled = true;
      timers.forEach((id) => window.clearTimeout(id));
      setHoveredSpeedIdx(null);
      setDemoCursor((prev) => ({ ...prev, visible: false, pressing: false }));
      window.removeEventListener('pointerdown', cancelDemo, true);
      window.removeEventListener('wheel', cancelDemo, true);
      window.removeEventListener('keydown', cancelDemo, true);
    };

    window.addEventListener('pointerdown', cancelDemo, true);
    window.addEventListener('wheel', cancelDemo, true);
    window.addEventListener('keydown', cancelDemo, true);

    schedule(2000, () => {
      const trigRect = speedTriggerRef.current?.getBoundingClientRect();
      if (!trigRect) {
        cancelDemo();
        return;
      }
      // 1. Reveal hand pointer just above the Speed button
      setDemoCursor({
        visible: true,
        x: trigRect.left + trigRect.width * 0.65,
        y: trigRect.top - 52,
        pressing: false,
      });

      // 2. Glide to Speed dropdown trigger
      schedule(60, () => {
        const r = speedTriggerRef.current?.getBoundingClientRect();
        if (!r) return;
        setDemoCursor({
          visible: true,
          x: r.left + r.width * 0.52,
          y: r.top + r.height * 0.55,
          pressing: false,
        });
      });

      // 3. Click Speed dropdown open
      schedule(620, () => {
        setDemoCursor((prev) => ({ ...prev, pressing: true }));
        setHoveredSpeedIdx(null);
        setSpeedMenuOpen(true);
      });

      schedule(780, () => {
        setDemoCursor((prev) => ({ ...prev, pressing: false }));
      });

      // 4. Glide up into the open dropdown to "24×" (index 1)
      schedule(920, () => {
        const optRect = speedOption24Ref.current?.getBoundingClientRect();
        if (!optRect) return;
        setHoveredSpeedIdx(1);
        setDemoCursor({
          visible: true,
          x: optRect.left + optRect.width * 0.55,
          y: optRect.top + optRect.height * 0.55,
          pressing: false,
        });
      });

      // 5. Click "24×"
      schedule(1500, () => {
        setDemoCursor((prev) => ({ ...prev, pressing: true }));
      });

      schedule(1660, () => {
        setHoveredSpeedIdx(null);
        handleSelectOrbitalSpeed(24);
        setDemoCursor((prev) => ({ ...prev, pressing: false }));
      });

      // 6. Glide left to the Play button
      schedule(1840, () => {
        const playRect = playButtonRef.current?.getBoundingClientRect();
        if (!playRect) return;
        setDemoCursor({
          visible: true,
          x: playRect.left + playRect.width * 0.5,
          y: playRect.top + playRect.height * 0.5,
          pressing: false,
        });
      });

      // 7. Click Play button so Earth & Sun start moving at 24×
      schedule(2440, () => {
        setDemoCursor((prev) => ({ ...prev, pressing: true }));
        orbitalPausedRef.current = false;
        setOrbitalPaused(false);
        syncOverviewFromBackend(simTimeMsRef.current);
      });

      schedule(2600, () => {
        setDemoCursor((prev) => ({ ...prev, pressing: false }));
      });

      // 8. Fade hand pointer out smoothly
      schedule(3020, () => {
        setDemoCursor((prev) => ({ ...prev, visible: false, pressing: false }));
        window.removeEventListener('pointerdown', cancelDemo, true);
        window.removeEventListener('wheel', cancelDemo, true);
        window.removeEventListener('keydown', cancelDemo, true);
      });
    });

    return () => {
      cancelled = true;
      timers.forEach((id) => window.clearTimeout(id));
      window.removeEventListener('pointerdown', cancelDemo, true);
      window.removeEventListener('wheel', cancelDemo, true);
      window.removeEventListener('keydown', cancelDemo, true);
    };
  }, [active, sceneReady, moonOverviewActive, hideOverviewHud, handleSelectOrbitalSpeed, syncOverviewFromBackend]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const useMissionSky = syncToMissionStore && !initialOverview;
    const isSoftwareGl = detectSoftwareGl();

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false, // Fast native GPU double-buffering (photo capture renders synchronously)
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = exposureRef.current;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.localClippingEnabled = useMissionSky;
    renderer.shadowMap.needsUpdate = true;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // =========================================================================
    // 1. SCENE, SKYBOX (NO ATMOSPHERE / NO FOG) & HARSH SOUTH POLE SUNLIGHT
    // =========================================================================
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x010103); // Pitch-black lunar vacuum sky
    sceneRef.current = scene;

    // Subtle studio PMREM environment reflection for aerospace Kapton gold, silver MLI,
    // brushed aluminum fins & anodized cobalt collar (lunar regolith & rocks keep envMapIntensity=0).
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnvScene = new RoomEnvironment();
    const envMapRT = pmremGenerator.fromScene(roomEnvScene, 0.04);
    roomEnvScene.dispose();
    pmremGenerator.dispose();
    scene.environment = envMapRT.texture;
    scene.environmentIntensity = 0.42;

    const camera = new THREE.PerspectiveCamera(
      fovRef.current,
      container.clientWidth / Math.max(container.clientHeight, 1),
      0.22,
      40000
    );
    cameraRef.current = camera;

    // Build Authoritative 3 km x 3 km Shackleton Crater Terrain Pipeline + MOON_ME_DE421 Sky Model
    const terrainPipeline = new ShackletonTerrainPipeline();
    let missionSurface: MissionSiteSurface | null = null;
    let missionTerrainReady = false;
    let lastTerrainSiteId: string | null = null;
    const sampleGroundHeight = (x: number, z: number): number | null =>
      useMissionSky ? missionSurface?.sampleHeight(x, z) ?? null : terrainPipeline.sampleHeight(x, z);
    const overviewBackend = new LunarOverviewBackend(terrainPipeline, RIDGE_SHOULDER_SITE);
    overviewBackendRef.current = overviewBackend;
    syncOverviewFromBackend(simTimeMsRef.current);

    const terrainMesh = terrainPipeline.createTerrainMesh();
    terrainMesh.visible = !useMissionSky;
    scene.add(terrainMesh);

    const rockScatterGroup = useMissionSky ? new THREE.Group() : terrainPipeline.createRockScatterGroup();
    scene.add(rockScatterGroup);

    // Mount Exact NASA-Grade CoreHab 3D Surface Habitat on the graded NNE plain
    const coreHab = buildCoreHabBase(renderer.capabilities.getMaxAnisotropy());
    coreHab.group.position.set(
      COREHAB_POS_X,
      terrainPipeline.sampleHeight(COREHAB_POS_X, COREHAB_POS_Z),
      COREHAB_POS_Z
    );
    coreHab.group.rotation.y = COREHAB_YAW;
    coreHab.group.visible = !useMissionSky;
    scene.add(coreHab.group);


    // =========================================================================
    // 1B. ASTRONOMICALLY REALISTIC 360° DEEP-SPACE STARFIELD (CUSTOM GLSL)
    // =========================================================================
    const starCount = 5400;
    const starPositions = new Float32Array(starCount * 3);
    const starColors = new Float32Array(starCount * 3);
    const starSizes = new Float32Array(starCount);
    const starBrightness = new Float32Array(starCount);

    // Spectral Planckian color palette (O/B blue-white, A/F white, G warm white, K gold, M amber)
    const spectralPalette = [
      [0.68, 0.82, 1.0],  // O/B class hot blue-white
      [0.86, 0.92, 1.0],  // B/A class blue-white
      [0.98, 0.99, 1.0],  // A/F class pure white
      [1.0, 0.96, 0.86],  // G class solar yellowish-white
      [1.0, 0.85, 0.66],  // K class orange-gold
      [1.0, 0.71, 0.52],  // M class cool amber-red
    ];

    // Inclined galactic plane normal for subtle Milky Way star density band across full 360° sky
    const galacticNormal = new THREE.Vector3(0.48, 0.62, 0.62).normalize();
    const tmpStarDir = new THREE.Vector3();

    for (let i = 0; i < starCount; i++) {
      const isGalacticBand = i < 1800;
      const theta = Math.random() * Math.PI * 2.0;
      // Full 360° celestial sphere so orbital Moon view has stars in every direction
      const phi = Math.acos(1.0 - 2.0 * Math.random());

      if (isGalacticBand) {
        const bandLong = Math.random() * Math.PI * 2.0;
        const bandLat = (Math.random() + Math.random() + Math.random() - 1.5) * 0.22;
        const localVec = new THREE.Vector3(
          Math.cos(bandLat) * Math.cos(bandLong),
          Math.sin(bandLat),
          Math.cos(bandLat) * Math.sin(bandLong)
        );
        const qGal = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          galacticNormal
        );
        localVec.applyQuaternion(qGal).normalize();
        tmpStarDir.copy(localVec);
      } else {
        tmpStarDir.set(
          Math.sin(phi) * Math.cos(theta),
          Math.cos(phi),
          Math.sin(phi) * Math.sin(theta)
        );
      }

      const r = 22000.0;
      starPositions[i * 3 + 0] = tmpStarDir.x * r;
      starPositions[i * 3 + 1] = tmpStarDir.y * r;
      starPositions[i * 3 + 2] = tmpStarDir.z * r;

      // Power-law apparent magnitude distribution (many pinpoint stars, rare brilliant beacons)
      const magRoll = Math.random();
      let sizePx = 1.3;
      let lum = 0.45;
      if (magRoll > 0.986) {
        sizePx = 6.2 + Math.random() * 3.2;
        lum = 0.92 + Math.random() * 0.08;
      } else if (magRoll > 0.93) {
        sizePx = 3.4 + Math.random() * 2.0;
        lum = 0.75 + Math.random() * 0.16;
      } else if (magRoll > 0.72) {
        sizePx = 2.0 + Math.random() * 1.2;
        lum = 0.52 + Math.random() * 0.22;
      } else {
        sizePx = 1.0 + Math.random() * 0.95;
        lum = 0.28 + Math.random() * 0.26;
      }

      starSizes[i] = sizePx;
      starBrightness[i] = lum;

      const specProb = Math.random();
      const spec =
        specProb < 0.12
          ? spectralPalette[0]
          : specProb < 0.28
          ? spectralPalette[1]
          : specProb < 0.62
          ? spectralPalette[2]
          : specProb < 0.82
          ? spectralPalette[3]
          : specProb < 0.94
          ? spectralPalette[4]
          : spectralPalette[5];

      starColors[i * 3 + 0] = spec[0];
      starColors[i * 3 + 1] = spec[1];
      starColors[i * 3 + 2] = spec[2];
    }

    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(starSizes, 1));
    starGeo.setAttribute('aBrightness', new THREE.BufferAttribute(starBrightness, 1));

    const starMat = new THREE.ShaderMaterial({
      uniforms: {
        uPixelRatio: { value: renderer.getPixelRatio() },
      },
      vertexShader: `
        attribute float aSize;
        attribute float aBrightness;
        varying vec3 vColor;
        varying float vBrightness;
        uniform float uPixelRatio;
        void main() {
          vColor = color;
          vBrightness = aBrightness;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = aSize * uPixelRatio;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vBrightness;
        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float dist = length(uv) * 2.0;
          if (dist > 1.0) discard;

          // Crisp Airy-disc optical core + soft exponential corona
          float core = exp(-dist * dist * 9.5);
          float halo = exp(-dist * dist * 2.4) * 0.42;

          // Subtle 4-point optical diffraction cross on 1st-magnitude stars
          float spikes = 0.0;
          if (vBrightness > 0.88) {
            float sx = exp(-abs(uv.y) * 28.0) * exp(-abs(uv.x) * 3.5);
            float sy = exp(-abs(uv.x) * 28.0) * exp(-abs(uv.y) * 3.5);
            spikes = (sx + sy) * 0.35;
          }

          float alpha = clamp((core + halo + spikes) * vBrightness, 0.0, 1.0);
          vec3 finalCol = mix(vColor, vec3(1.0), core * 0.55);
          gl_FragColor = vec4(finalCol, alpha);
        }
      `,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const starField = new THREE.Points(starGeo, starMat);
    scene.add(starField);

    // Distant 3D Earth (earth.glb) framed ahead in the northern sky (+15% radial distance from Moon center)
    const earthAnchorGroup = new THREE.Group();
    earthAnchorGroup.position.set(0, 1535.12, -9430);
    // Subtle axial tilt (23.4°)
    earthAnchorGroup.rotation.z = 0.41;
    scene.add(earthAnchorGroup);

    const earthSpinGroup = new THREE.Group();
    earthAnchorGroup.add(earthSpinGroup);

    const tmpEarthCamLocal = new THREE.Vector3();
    const aimEarthAtCamera = () => {
      earthAnchorGroup.updateMatrixWorld(true);
      tmpEarthCamLocal.copy(camera.position);
      earthAnchorGroup.worldToLocal(tmpEarthCamLocal);
      earthSpinGroup.rotation.y = Math.atan2(tmpEarthCamLocal.x, tmpEarthCamLocal.z);
    };

    // Subtle Rayleigh atmospheric halo rim behind the 3D Earth GLB
    const haloGeo = new THREE.SphereGeometry(584, 32, 32);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.16,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const earthHalo = new THREE.Mesh(haloGeo, haloMat);
    earthAnchorGroup.add(earthHalo);

    let earthLoaded = false;
    let sunLoaded = false;
    let cesiumSettled = false;
    let didNotifyAssetsLoaded = false;
    let isDisposed = false;
    let initialMissionResult: MissionResult | null = null;
    // Evaluate the default mission without marking it checked or changing the
    // user's plan. Later previews/committed plans take precedence each frame.
    if (useMissionSky) {
      missionPlannerStore.evaluateSettings().then(result => {
        if (!isDisposed) initialMissionResult = result;
      }).catch(() => {
        if (!isDisposed) setMissionSkyError(true);
      });
    }
    let readyNotifyTimerId: number | null = null;

    const tryFlushAndNotifyReady = () => {
      if (isDisposed || didNotifyAssetsLoaded) return;
      if (earthLoaded && sunLoaded && cesiumSettled) {
        didNotifyAssetsLoaded = true;
        window.clearTimeout(assetSafetyTimer);
        renderer.compile(scene, camera);
        renderer.shadowMap.needsUpdate = true;
        readyNotifyTimerId = window.setTimeout(() => {
          readyNotifyTimerId = null;
          if (!isDisposed) onAssetsLoadedRef.current?.();
        }, 32);
      }
    };

    const assetSafetyTimer = window.setTimeout(() => {
      if (isDisposed || didNotifyAssetsLoaded) return;
      didNotifyAssetsLoaded = true;
      renderer.shadowMap.needsUpdate = true;
      readyNotifyTimerId = window.setTimeout(() => {
        readyNotifyTimerId = null;
        if (!isDisposed) onAssetsLoadedRef.current?.();
      }, 32);
    }, 8000);

    const earthGltfLoader = new GLTFLoader();
    earthGltfLoader.load(
      EARTH_GLB_URL,
      (gltf) => {
        if (isDisposed) return;
        const earthModel = gltf.scene;
        earthModel.updateMatrixWorld(true);

        // Normalize scale & center the geometry pivot at (0, 0, 0) inside earthSpinGroup
        const box = new THREE.Box3().setFromObject(earthModel);
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z, 0.001);
        const targetDiameter = 1120.0;
        const scale = targetDiameter / maxDim;
        earthModel.scale.setScalar(scale);

        earthModel.updateMatrixWorld(true);
        const scaledBox = new THREE.Box3().setFromObject(earthModel);
        const scaledCenter = new THREE.Vector3();
        scaledBox.getCenter(scaledCenter);
        earthModel.position.sub(scaledCenter);

        earthModel.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            mats.forEach((m) => {
              if (m && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
                const std = m as THREE.MeshStandardMaterial;
                if (std.map) {
                  std.map.colorSpace = THREE.SRGBColorSpace;
                  std.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
                }
                if (std.emissiveMap) {
                  std.emissiveMap.colorSpace = THREE.SRGBColorSpace;
                  std.emissiveMap.anisotropy = renderer.capabilities.getMaxAnisotropy();
                } else if (std.map) {
                  std.emissiveMap = std.map;
                }
                if (std.map || std.emissiveMap) {
                  std.emissive = new THREE.Color(0xffffff);
                  std.emissiveIntensity = 0.22;
                }
                std.roughness = 0.68;
                std.metalness = 0.04;
                std.needsUpdate = true;
              }
            });
          }
        });

        // Center Africa (~198° GLB azimuth, u≈0.92) on +Z and face the active camera on load
        earthModel.rotation.y = (162 * Math.PI) / 180;
        aimEarthAtCamera();
        earthSpinGroup.add(earthModel);
        earthLoaded = true;
        tryFlushAndNotifyReady();
      },
      undefined,
      (err) => {
        console.error('Failed to load Earth_1_12756.glb:', err);
        earthLoaded = true;
        tryFlushAndNotifyReady();
      }
    );

    // Single Extremely Harsh Directional Sun (Low Lunar South Pole Grazing Angle ~7.7°)
    // Oriented so Earth, Moon, and Sun all sit cleanly inside the 4x orbital landing view
    const sunDirNormalized = new THREE.Vector3(0.76, 0.135, -0.635).normalize();
    const sunLight = new THREE.DirectionalLight(0xfffdf8, 5.2);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = isSoftwareGl ? 1024 : 2048;
    sunLight.shadow.mapSize.height = isSoftwareGl ? 1024 : 2048;
    sunLight.shadow.camera.near = 2.0;
    sunLight.shadow.camera.far = 260.0;
    const shadowHalfExtent = 48.0;
    sunLight.shadow.camera.left = -shadowHalfExtent;
    sunLight.shadow.camera.right = shadowHalfExtent;
    sunLight.shadow.camera.top = shadowHalfExtent + 8.0;
    sunLight.shadow.camera.bottom = -shadowHalfExtent;
    sunLight.shadow.bias = -0.00045;
    scene.add(sunLight);
    scene.add(sunLight.target);

    // 3D Sun GLB (Sun_1_1391000.glb) + soft radial additive solar corona halo (+15% distance)
    const sunAnchorGroup = new THREE.Group();
    sunAnchorGroup.position.copy(sunDirNormalized).multiplyScalar(15870);
    scene.add(sunAnchorGroup);

    const sunSpinGroup = new THREE.Group();
    sunAnchorGroup.add(sunSpinGroup);

    const solarCoronaCanvas = document.createElement('canvas');
    solarCoronaCanvas.width = 256;
    solarCoronaCanvas.height = 256;
    const coronaCtx = solarCoronaCanvas.getContext('2d');
    if (coronaCtx) {
      const grad = coronaCtx.createRadialGradient(128, 128, 18, 128, 128, 128);
      grad.addColorStop(0.0, 'rgba(255, 248, 220, 0.95)');
      grad.addColorStop(0.28, 'rgba(255, 198, 110, 0.52)');
      grad.addColorStop(0.62, 'rgba(255, 128, 42, 0.16)');
      grad.addColorStop(1.0, 'rgba(255, 90, 10, 0.0)');
      coronaCtx.fillStyle = grad;
      coronaCtx.fillRect(0, 0, 256, 256);
    }
    const solarCoronaTex = new THREE.CanvasTexture(solarCoronaCanvas);
    solarCoronaTex.colorSpace = THREE.SRGBColorSpace;
    const solarCoronaMat = new THREE.SpriteMaterial({
      map: solarCoronaTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const solarCoronaSprite = new THREE.Sprite(solarCoronaMat);
    solarCoronaSprite.scale.set(2450, 2450, 1);
    sunAnchorGroup.add(solarCoronaSprite);
    const sunOcclusion = useMissionSky ? createSunOcclusion(SUN_DISPLAY_RADIUS, solarCoronaMat) : null;

    const sunGeometries: THREE.BufferGeometry[] = [];
    const sunMaterials: THREE.Material[] = [];
    const sunTextures: THREE.Texture[] = [];
    let sunDisposed = false;

    const sunGltfLoader = new GLTFLoader();
    sunGltfLoader.load(
      SUN_GLB_URL,
      (gltf) => {
        const sunModel = gltf.scene;
        if (sunDisposed) {
          sunModel.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              (child as THREE.Mesh).geometry?.dispose();
            }
          });
          return;
        }

        sunModel.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(sunModel);
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z, 0.001);
        const targetDiameter = SUN_DISPLAY_RADIUS * 2;
        const scale = targetDiameter / maxDim;
        sunModel.scale.setScalar(scale);

        sunModel.updateMatrixWorld(true);
        const scaledBox = new THREE.Box3().setFromObject(sunModel);
        const scaledCenter = new THREE.Vector3();
        scaledBox.getCenter(scaledCenter);
        sunModel.position.sub(scaledCenter);

        const maxAniso = renderer.capabilities.getMaxAnisotropy();
        sunModel.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            if (mesh.geometry) sunGeometries.push(mesh.geometry);
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            mats.forEach((m) => {
              if (!m) return;
              m.depthWrite = true;
              if (sunOcclusion) m.clippingPlanes = [sunOcclusion.plane];
              if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
                const std = m as THREE.MeshStandardMaterial;
                if (std.map) {
                  std.map.colorSpace = THREE.SRGBColorSpace;
                  std.map.anisotropy = maxAniso;
                  sunTextures.push(std.map);
                }
                if (std.emissiveMap) {
                  std.emissiveMap.colorSpace = THREE.SRGBColorSpace;
                  std.emissiveMap.anisotropy = maxAniso;
                  sunTextures.push(std.emissiveMap);
                } else if (std.map) {
                  std.emissiveMap = std.map;
                }
                std.emissive = new THREE.Color(0xffffff);
                std.emissiveIntensity = 1.55;
                std.roughness = 0.85;
                std.metalness = 0.0;
                std.envMapIntensity = 0.0;
                std.needsUpdate = true;
              }
              sunMaterials.push(m);
            });
          }
        });

        sunSpinGroup.add(sunModel);
        sunLoaded = true;
        tryFlushAndNotifyReady();
      },
      undefined,
      (err) => {
        console.error('Failed to load Sun_1_1391000.glb:', err);
        sunLoaded = true;
        tryFlushAndNotifyReady();
      }
    );

    // No atmospheric sky light! Only subtle neutral-gray regolith multi-bounce radiosity from below
    // so shadowed metallic rover struts remain readable via exposure control without any blue tint.
    const regolithBounceLight = new THREE.HemisphereLight(0x1c1c1e, 0x262628, 0.38);
    scene.add(regolithBounceLight);

    // =========================================================================
    // 1C. FULL 3D SPHERICAL MOON GLOBE FOR ORBITAL DEEP-SPACE VIEW (moon_small.glb)
    // =========================================================================
    const orbitalMoonRadius = 420.0;
    // Slight 0.8m subsurface recess prevents Z-fighting at (0,0,0) with the local Shackleton terrain
    const orbitalMoonCenter = new THREE.Vector3(0, -orbitalMoonRadius - 0.8, 0);
    const orbitalMoonGroup = new THREE.Group();
    orbitalMoonGroup.position.copy(orbitalMoonCenter);
    orbitalMoonGroup.visible = false;
    scene.add(orbitalMoonGroup);

    const moonRevealUniform = { value: 0.0 };
    const orbitalMoonMaterials: THREE.Material[] = [];
    const orbitalMoonGeometries: THREE.BufferGeometry[] = [];
    const orbitalMoonTextures: THREE.Texture[] = [];

    const moonGltfLoader = new GLTFLoader();
    if (!embedded) {
      moonGltfLoader.load(
        MOON_GLB_URL,
      (gltf) => {
        const moonModel = gltf.scene;
        if (isDisposed) {
          moonModel.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              mesh.geometry?.dispose();
            }
          });
          return;
        }

        moonModel.updateMatrixWorld(true);

        // Normalize scale & center geometry pivot at (0, 0, 0) inside orbitalMoonGroup
        const box = new THREE.Box3().setFromObject(moonModel);
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z, 0.001);
        const targetDiameter = orbitalMoonRadius * 2.0;
        const scale = targetDiameter / maxDim;
        moonModel.scale.setScalar(scale);

        moonModel.updateMatrixWorld(true);
        const scaledBox = new THREE.Box3().setFromObject(moonModel);
        const scaledCenter = new THREE.Vector3();
        scaledBox.getCenter(scaledCenter);
        moonModel.position.sub(scaledCenter);

        const maxAniso = renderer.capabilities.getMaxAnisotropy();

        moonModel.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            if (mesh.geometry) {
              orbitalMoonGeometries.push(mesh.geometry);
            }
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            mats.forEach((m) => {
              if (!m) return;
              // Keep fully opaque with screen-space IGN dissolve so there is zero transparent overdraw or depth-sorting flicker
              m.side = THREE.FrontSide;
              m.transparent = false;
              m.opacity = 1.0;
              m.depthWrite = true;
              m.polygonOffset = true;
              m.polygonOffsetFactor = 2;
              m.polygonOffsetUnits = 2;

              if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
                const std = m as THREE.MeshStandardMaterial;
                if (std.map) {
                  std.map.colorSpace = THREE.SRGBColorSpace;
                  std.map.anisotropy = maxAniso;
                  std.emissiveMap = std.map;
                  std.emissive = new THREE.Color(0x1b2432);
                  std.emissiveIntensity = 0.06;
                  renderer.initTexture(std.map);
                  orbitalMoonTextures.push(std.map);
                }
                std.roughness = 0.94;
                std.metalness = 0.0;
                std.envMapIntensity = 0.0;
                if ('clearcoat' in std) {
                  (std as THREE.MeshPhysicalMaterial).clearcoat = 0.0;
                }
                if ('specularIntensity' in std) {
                  (std as THREE.MeshPhysicalMaterial).specularIntensity = 0.08;
                }
              }

              const prevCompile = m.onBeforeCompile;
              m.onBeforeCompile = (shader, r) => {
                if (prevCompile) prevCompile(shader, r);
                shader.uniforms.uMoonReveal = moonRevealUniform;
                shader.fragmentShader = shader.fragmentShader.replace(
                  '#include <common>',
                  `#include <common>
                   uniform float uMoonReveal;`
                );
                shader.fragmentShader = shader.fragmentShader.replace(
                  '#include <clipping_planes_fragment>',
                  `#include <clipping_planes_fragment>
                   if (uMoonReveal < 0.999) {
                     if (uMoonReveal <= 0.001) discard;
                     float ignMoon = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
                     if (uMoonReveal < ignMoon) discard;
                   }`
                );
              };
              m.customProgramCacheKey = () => 'nasa-moon-ign-reveal-v1';
              m.needsUpdate = true;
              orbitalMoonMaterials.push(m);
            });
          }
        });

        orbitalMoonGroup.add(moonModel);

        // Silent 1x1 offscreen GPU warm-up pass: forces full shader link, VBO bind, & 12MB texture mipmap upload now
        const prevVisible = orbitalMoonGroup.visible;
        const prevReveal = moonRevealUniform.value;
        const savedPos = camera.position.clone();
        const savedQuat = camera.quaternion.clone();
        const warmTarget = new THREE.WebGLRenderTarget(1, 1);

        orbitalMoonGroup.visible = true;
        moonRevealUniform.value = 1.0;
        camera.position.set(orbitalMoonCenter.x, orbitalMoonCenter.y + 180, orbitalMoonCenter.z + 1100);
        camera.lookAt(orbitalMoonCenter);
        renderer.compile(scene, camera);
        renderer.setRenderTarget(warmTarget);
        renderer.render(scene, camera);
        renderer.setRenderTarget(null);
        warmTarget.dispose();

        camera.position.copy(savedPos);
        camera.quaternion.copy(savedQuat);
        orbitalMoonGroup.visible = prevVisible;
        moonRevealUniform.value = prevReveal;
        },
        undefined,
        (err) => {
          console.error('Failed to load moon_small.glb:', err);
        }
      );
    }

    // =========================================================================
    // 2. MISSION WAYPOINT 3D SURFACE MARKERS (CRATER RIM, BOULDERS, SAMPLING)
    // =========================================================================
    const waypointMarkersGroup = new THREE.Group();
    scene.add(waypointMarkersGroup);

    const wpRings: THREE.Mesh[] = [];
    const wpBeamMats: THREE.MeshBasicMaterial[] = [];
    const wpRingMats: THREE.MeshBasicMaterial[] = [];
    terrainPipeline.waypoints.forEach((wp) => {
      const color = new THREE.Color(wp.color);
      const beaconGroup = new THREE.Group();
      beaconGroup.position.set(wp.x, wp.y, wp.z);

      // Vertical laser/telemetry mast
      const beamGeo = new THREE.CylinderGeometry(0.06, 0.06, 18, 8);
      const beamMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.55,
      });
      wpBeamMats.push(beamMat);
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.y = 9.0;
      beaconGroup.add(beam);

      // Ground target ring
      const ringGeo = new THREE.RingGeometry(2.2, 2.65, 32);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
      });
      wpRingMats.push(ringMat);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 0.15;
      beaconGroup.add(ring);
      wpRings.push(ring);

      waypointMarkersGroup.add(beaconGroup);
    });

    // Stream & bake the 3 km x 3 km Shackleton region from Cesium Moon 3D Tiles (Asset 2684829)
    if (useMissionSky) {
      // The prepared site mesh is authoritative; streaming cannot replace it.
      cesiumSettled = true;
    } else terrainPipeline
      .tryStreamCesiumMoonTiles(() => {
        terrainPipeline.waypoints.forEach((wp, idx) => {
          const marker = waypointMarkersGroup.children[idx];
          if (marker) {
            marker.position.y = wp.y;
          }
        });
        coreHab.group.position.y = terrainPipeline.sampleHeight(COREHAB_POS_X, COREHAB_POS_Z);
        landingGroundY = terrainPipeline.sampleHeight(ROVER_SPAWN_X, ROVER_SPAWN_Z);
        renderer.shadowMap.needsUpdate = true;
      })
      .finally(() => {
        cesiumSettled = true;
        tryFlushAndNotifyReady();
      });


    // =========================================================================
    // 3. VACUUM BALLISTIC REGOLITH PLUME DUST SPRAY (g = 1.622 m/s²)
    // =========================================================================
    const ballisticCount = 260;
    const ballisticPos = new Float32Array(ballisticCount * 3);
    const ballisticVel = new Float32Array(ballisticCount * 3);
    const ballisticLife = new Float32Array(ballisticCount);
    for (let i = 0; i < ballisticCount; i++) {
      ballisticLife[i] = -1;
      ballisticPos[i * 3 + 1] = -9999;
    }
    const ballisticGeo = new THREE.BufferGeometry();
    ballisticGeo.setAttribute('position', new THREE.BufferAttribute(ballisticPos, 3));
    const ballisticMat = new THREE.PointsMaterial({
      color: 0xa1a3a8,
      size: 0.14,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    const ballisticPoints = new THREE.Points(ballisticGeo, ballisticMat);
    ballisticPoints.frustumCulled = false;
    scene.add(ballisticPoints);
    let nextBallisticIdx = 0;

    // =========================================================================
    // 4. MOUNT PROCEDURAL PBR CREWED LUNAR LANDER RIGHT BESIDE COREHAB
    // =========================================================================
    const DESCENT_DURATION = 5.0; // Exact 5-second powered landing on load
    const DESCENT_START_ALT = 10.5;
    let landingGroundY = terrainPipeline.sampleHeight(ROVER_SPAWN_X, ROVER_SPAWN_Z);

    const roverWorldRoot = new THREE.Group();
    roverWorldRoot.position.set(ROVER_SPAWN_X, landingGroundY + DESCENT_START_ALT, ROVER_SPAWN_Z);
    roverWorldRoot.rotation.y = ROVER_SPAWN_HEADING;
    scene.add(roverWorldRoot);

    const lander = buildLunarLanderModel(renderer.capabilities.getMaxAnisotropy());
    lander.solarDishPivot.rotation.set(0.16, 0.22, 0);
    lander.setDescentThrust(0.85, DESCENT_START_ALT, 0);
    roverWorldRoot.add(lander.group);

    // Pre-compile shaders eagerly only when not waiting on an external preload overlay
    if (!onAssetsLoadedRef.current) {
      orbitalMoonGroup.visible = !embedded;
      renderer.compile(scene, camera);
      orbitalMoonGroup.visible = initialOverview;
    }
    renderer.shadowMap.needsUpdate = true;
    setSceneReady(true);

    // =========================================================================
    // 5. CAMERA 360° ORBIT / ZOOM INTERACTION (NO WASD KEYS)
    // =========================================================================
    let isPointerDragging = false;
    let prevPointerX = 0;
    let prevPointerY = 0;
    let orbitYaw = ROVER_SPAWN_ORBIT_YAW;
    let orbitPitch = ROVER_SPAWN_ORBIT_PITCH;
    let orbitDist = ROVER_INTRO_ORBIT_DIST;
    let userAdjustedSurfaceCam = false;

    // Orbital Full-Moon Space View camera state
    let moonTransition = initialOverview ? 1.0 : 0.0;
    let moonOrbitYaw = -0.465;
    let moonOrbitPitch = 0.06;
    let moonOrbitDist = 4560.0;

    const handlePointerDown = (e: PointerEvent) => {
      if (!activeRef.current) return;
      if ((e.target as HTMLElement)?.closest('button, input, [data-hud-interactive]')) return;
      orbitalResetPendingRef.current = false;
      pendingSurfaceFocus = null;
      isPointerDragging = true;
      prevPointerX = e.clientX;
      prevPointerY = e.clientY;
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (isPointerDragging && activeRef.current) {
        const dx = e.clientX - prevPointerX;
        const dy = e.clientY - prevPointerY;
        prevPointerX = e.clientX;
        prevPointerY = e.clientY;

        if (moonOverviewActiveRef.current) {
          moonOrbitYaw -= dx * 0.0065;
          moonOrbitPitch = THREE.MathUtils.clamp(moonOrbitPitch + dy * 0.0055, -1.46, 1.46);
        } else {
          userAdjustedSurfaceCam = true;
          orbitYaw -= dx * 0.0065;
          orbitPitch = THREE.MathUtils.clamp(orbitPitch + dy * 0.0055, 0.04, 1.32);
        }
      }
    };

    const handlePointerUp = () => {
      isPointerDragging = false;
    };

    const handleWheel = (e: WheelEvent) => {
      if (!activeRef.current) return;
      if (moonOverviewActiveRef.current) {
        orbitalResetPendingRef.current = false;
        moonOrbitDist = THREE.MathUtils.clamp(
          moonOrbitDist * Math.exp(e.deltaY * 0.0011),
          580.0,
          7200.0
        );
      } else {
        pendingSurfaceFocus = null;
        userAdjustedSurfaceCam = true;
        orbitDist = THREE.MathUtils.clamp(orbitDist + e.deltaY * 0.015, 7.5, 55.0);
      }
    };

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w <= 0 || h <= 0) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => handleResize());
      resizeObserver.observe(container);
    }

    container.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerup', handlePointerUp);
    container.addEventListener('wheel', handleWheel, { passive: true });
    window.addEventListener('resize', handleResize);

    // =========================================================================
    // 6. POWERED 5-SECOND LUNAR LANDING SIMULATION
    // =========================================================================
    let landerX = ROVER_SPAWN_X;
    let landerZ = ROVER_SPAWN_Z;
    const landerGroundQuaternion = new THREE.Quaternion();
    const landerAttitudeQuaternion = new THREE.Quaternion();
    const landerAttitudeEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    const heading = ROVER_SPAWN_HEADING;
    const fwdX = -Math.sin(heading);
    const fwdZ = -Math.cos(heading);
    const rgtX = Math.cos(heading);
    const rgtZ = -Math.sin(heading);

    let landingElapsed = 0.0;
    let landerAltitude = DESCENT_START_ALT;
    let roverY = landingGroundY + landerAltitude;
    let overviewEvalTimer = 0;
    let lastOverviewKey = '';
    let lastClockKey = '';

    const initTotalYaw = heading + ROVER_SPAWN_ORBIT_YAW;
    let initFocusX = landerX - rgtX * 4.2;
    let initFocusZ = landerZ - rgtZ * 4.2;
    const chaseCamPos = new THREE.Vector3(
      initFocusX + ROVER_INTRO_ORBIT_DIST * Math.cos(ROVER_SPAWN_ORBIT_PITCH) * Math.sin(initTotalYaw),
      landingGroundY + 1.2 + ROVER_INTRO_ORBIT_DIST * Math.sin(ROVER_SPAWN_ORBIT_PITCH),
      initFocusZ + ROVER_INTRO_ORBIT_DIST * Math.cos(ROVER_SPAWN_ORBIT_PITCH) * Math.cos(initTotalYaw)
    );
    const chaseCamLook = new THREE.Vector3(
      initFocusX,
      landingGroundY + 7.2,
      initFocusZ
    );
    if (initialOverview) {
      const initOrbCosP = Math.cos(moonOrbitPitch);
      camera.position.set(
        orbitalMoonCenter.x + moonOrbitDist * initOrbCosP * Math.sin(moonOrbitYaw),
        orbitalMoonCenter.y + moonOrbitDist * Math.sin(moonOrbitPitch),
        orbitalMoonCenter.z + moonOrbitDist * initOrbCosP * Math.cos(moonOrbitYaw)
      );
      camera.lookAt(orbitalMoonCenter);
    } else {
      camera.position.copy(chaseCamPos);
      camera.lookAt(chaseCamLook);
    }
    const surfaceCamPos = new THREE.Vector3();
    const surfaceCamLook = new THREE.Vector3();
    const tmpSurfaceOffset = new THREE.Vector3();
    const tmpDir0 = new THREE.Vector3();
    const tmpDir1 = new THREE.Vector3();
    const tmpPoleDir = new THREE.Vector3();
    const tmpCamDir = new THREE.Vector3();
    const tmpLookTarget = new THREE.Vector3();
    const tmpFlightCamPos = new THREE.Vector3();
    const tmpOrbitVec = new THREE.Vector3();
    const orbitUpAxis = new THREE.Vector3(0, 1, 0);
    const earthBaseOrbitOffset = earthAnchorGroup.position.clone().sub(orbitalMoonCenter);
    const sunBaseOrbitOffset = sunAnchorGroup.position.clone().sub(orbitalMoonCenter);
    let earthOrbitPhase = 0;
    let sunOrbitPhase = 0;
    const lastShadowSunDirection = new THREE.Vector3();
    const skyObserver = new THREE.Vector3(landerX, landingGroundY, landerZ);
    const missionSkyObjects = {sun: sunAnchorGroup, earth: earthAnchorGroup, light: sunLight, sunDirection: sunDirNormalized, sunOcclusion};
    let lastSkyResult: MissionResult | null = null;
    let lastSkyHour = NaN;
    let missionSkySample: MissionSample | null = null;
    let lastSkyReadoutKey = '';
    if (useMissionSky) updateSurfaceMissionSky(missionSkyObjects, null, skyObserver);
    let hasAimedInitialOverviewEarth = false;
    let lastMissionFocusTrigger = syncToMissionStore ? missionPlannerStore.getSnapshot().cameraFocusTrigger : 0;
    let pendingSurfaceFocus: { yaw: number; pitch: number; dist: number } | null = null;

    const clock = new THREE.Clock();
    let frameId = 0;
    let warmupFramesRemaining = 3;
    let wasTerrainHidden = false;

    const tick = () => {
      // Pause 3D lunar rendering while hidden, inactive, or waiting for initial preload overlay
      if (
        document.hidden ||
        (!activeRef.current && warmupFramesRemaining <= 0) ||
        (onAssetsLoadedRef.current && !didNotifyAssetsLoaded)
      ) {
        clock.getDelta();
        frameId = requestAnimationFrame(tick);
        return;
      }
      if (warmupFramesRemaining > 0) {
        warmupFramesRemaining--;
      }

      const dt = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.getElapsedTime();

      const missionSnapshot = useMissionSky ? missionPlannerStore.getSnapshot() : null;
      const frameMissionResult = missionSnapshot
        ? missionSnapshot.preview || missionSnapshot.baseline || initialMissionResult : null;
      if (frameMissionResult && frameMissionResult.site.id !== lastTerrainSiteId) {
        lastTerrainSiteId = frameMissionResult.site.id;
        missionTerrainReady = false;
        const bundle = missionPlannerStore.getBundle();
        const site = bundle?.sites.find((candidate: {id: string}) => candidate.id === lastTerrainSiteId);
        try {
          if (!site?.mesh) throw new Error('No prepared terrain for this site.');
          if (!missionSurface) {
            missionSurface = new MissionSiteSurface(bundle.sites[0]);
            scene.add(missionSurface.mesh);
          }
          missionSurface.selectSite(site);
          const origin = missionSurface.mesh.position;
          const pose = missionSurface.groundPose(origin.x, origin.z, heading, 2.48);
          const habitatPose = missionSurface.groundPose(
            origin.x + COREHAB_POS_X - ROVER_SPAWN_X,
            origin.z + COREHAB_POS_Z - ROVER_SPAWN_Z, COREHAB_YAW, coreHab.groundContactPoints,
          );
          if (!pose || !habitatPose) throw new Error('Missing terrain at the landing site.');
          landerX = pose.position.x;
          landerZ = pose.position.z;
          landingGroundY = pose.position.y;
          landerGroundQuaternion.copy(pose.quaternion);
          coreHab.group.position.copy(habitatPose.position);
          coreHab.group.quaternion.copy(habitatPose.quaternion);
          initFocusX = landerX - rgtX * 4.2;
          initFocusZ = landerZ - rgtZ * 4.2;
          pendingSurfaceFocus = null;
          resetSurfaceToEarthSpawnRef.current = true;
          for (let i = 0; i < ballisticCount; i++) {
            ballisticLife[i] = -1;
            ballisticPos[i * 3 + 1] = -9999;
          }
          ballisticGeo.attributes.position.needsUpdate = true;
          renderer.shadowMap.needsUpdate = true;
          missionTerrainReady = true;
          setMissionTerrainStatus(`LOLA terrain · ${site.mesh.spacing_m} m grid · craft illustrative`);
        } catch {
          if (missionSurface) missionSurface.mesh.visible = false;
          setMissionTerrainStatus('Terrain unavailable for the selected site.');
        }
      }

      if (resetSurfaceToEarthSpawnRef.current) {
        resetSurfaceToEarthSpawnRef.current = false;
        landingElapsed = 0.0;
        userAdjustedSurfaceCam = false;
        orbitYaw = ROVER_SPAWN_ORBIT_YAW;
        orbitPitch = ROVER_SPAWN_ORBIT_PITCH;
        orbitDist = ROVER_INTRO_ORBIT_DIST;
        chaseCamPos.set(
          initFocusX + ROVER_INTRO_ORBIT_DIST * Math.cos(ROVER_SPAWN_ORBIT_PITCH) * Math.sin(initTotalYaw),
          landingGroundY + 1.2 + ROVER_INTRO_ORBIT_DIST * Math.sin(ROVER_SPAWN_ORBIT_PITCH),
          initFocusZ + ROVER_INTRO_ORBIT_DIST * Math.cos(ROVER_SPAWN_ORBIT_PITCH) * Math.cos(initTotalYaw)
        );
        chaseCamLook.set(initFocusX, landingGroundY + 7.2, initFocusZ);
      }

      // Advance 5-second powered landing once scene becomes active & loader overlay has cleared
      if (activeRef.current && !moonOverviewActiveRef.current && !pauseDescentRef.current && (!useMissionSky || missionTerrainReady)) {
        landingElapsed = Math.min(DESCENT_DURATION + 1.2, landingElapsed + dt);
      }

      const p = THREE.MathUtils.clamp(landingElapsed / DESCENT_DURATION, 0.0, 1.0);
      if (p < 1.0) {
        // Smooth terminal lunar descent braking curve touching pad cleanly at t = 5.0s
        landerAltitude = DESCENT_START_ALT * Math.pow(1.0 - p, 2.35);
      } else {
        // Subtle lunar shock-absorber suspension settle over the first 0.5s after contact
        const postT = landingElapsed - DESCENT_DURATION;
        const settle = Math.sin(postT * 10.5) * Math.exp(-postT * 6.5) * -0.05;
        landerAltitude = Math.max(-0.04, settle);
      }

      const attDecay = Math.pow(1.0 - p, 1.8);
      const landerPitch = 0.035 * attDecay;
      const landerRoll = -0.024 * attDecay;

      // Engine thrust throttle profile: strong retro-braking during descent, sharp cutoff at touchdown
      let thrustCmd = 0.0;
      if (landingElapsed < DESCENT_DURATION + 0.18) {
        const cutoff = 1.0 - THREE.MathUtils.smoothstep(landingElapsed, DESCENT_DURATION - 0.12, DESCENT_DURATION + 0.18);
        const flareBoost = 0.78 + 0.22 * THREE.MathUtils.smoothstep(p, 0.25, 0.85);
        thrustCmd = flareBoost * cutoff;
      }

      roverY = landingGroundY + landerAltitude;
      roverWorldRoot.position.set(landerX, roverY, landerZ);
      if (useMissionSky && missionTerrainReady) {
        landerAttitudeEuler.set(landerPitch, 0, landerRoll, 'YXZ');
        roverWorldRoot.quaternion.copy(landerGroundQuaternion)
          .multiply(landerAttitudeQuaternion.setFromEuler(landerAttitudeEuler));
      } else {
        roverWorldRoot.rotation.order = 'YXZ';
        roverWorldRoot.rotation.set(landerPitch, heading, landerRoll);
      }

      lander.setDescentThrust(thrustCmd, Math.max(0, landerAltitude), elapsed);

      // Spin Earth & Sun on their polar axes while orbiting both around the stationary Moon
      const orbitSpinMult = orbitalPausedRef.current
        ? 0.0
        : 1.0 + Math.log10(Math.max(1, orbitalSpeedRef.current)) * 3.8;
      if (!useMissionSky && orbitSpinMult > 0.0) {
        earthOrbitPhase += dt * 0.042 * orbitSpinMult;
        sunOrbitPhase += dt * 0.026 * orbitSpinMult;

        tmpOrbitVec.copy(earthBaseOrbitOffset).applyAxisAngle(orbitUpAxis, earthOrbitPhase);
        earthAnchorGroup.position.copy(orbitalMoonCenter).add(tmpOrbitVec);

        tmpOrbitVec.copy(sunBaseOrbitOffset).applyAxisAngle(orbitUpAxis, sunOrbitPhase);
        sunAnchorGroup.position.copy(orbitalMoonCenter).add(tmpOrbitVec);

        sunDirNormalized.copy(sunAnchorGroup.position).sub(orbitalMoonCenter).normalize();
      }
      if (initialOverview) {
        earthSpinGroup.rotation.y += dt * 0.055 * orbitSpinMult;
      }
      sunSpinGroup.rotation.y += dt * 0.032 * orbitSpinMult;

      if (useMissionSky) {
        const snapshot = missionSnapshot!;
        const result = frameMissionResult;
        const observerY = landingGroundY + (result?.settings.heightM ?? 0);
        const observerMoved = skyObserver.y !== observerY || skyObserver.x !== landerX || skyObserver.z !== landerZ;
        if (result !== lastSkyResult || snapshot.hour !== lastSkyHour || observerMoved) {
          lastSkyResult = result;
          lastSkyHour = snapshot.hour;
          missionSkySample = result ? sampleAt(result, snapshot.hour) as MissionSample | null : null;
          skyObserver.set(landerX, observerY, landerZ);
          updateSurfaceMissionSky(missionSkyObjects, missionSkySample, skyObserver);
          if (observerMoved) renderer.shadowMap.needsUpdate = true;
        }
        if (result && missionSkySample) {
          const sample = missionSkySample;
          simTimeMsRef.current = Date.parse(sample.utc);
          const readoutKey = `${result.site.id}|${sample.utc.slice(0, 19)}|${sample.sunAzDeg.toFixed(1)}|${sample.sunElDeg.toFixed(1)}|${sample.earthAzDeg.toFixed(1)}|${sample.earthElDeg.toFixed(1)}|${sample.sunFraction > 1e-8}|${sample.earthFraction > 1e-8}`;
          if (readoutKey !== lastSkyReadoutKey) {
            lastSkyReadoutKey = readoutKey;
            setMissionSkyReadout({siteTitle: result.site.name, coordinates: `${result.site.latitude_deg.toFixed(5)}°, ${result.site.longitude_deg.toFixed(5)}°`, sample});
            setUtcDoyClock(formatUtcDoyClock(new Date(sample.utc)));
          }
        }
      } else {
        // Standalone orbital overview retains its separate demonstration clock.
        sunLight.target.position.set(landerX, landingGroundY, landerZ);
        sunLight.position.copy(sunDirNormalized).multiplyScalar(115).add(sunLight.target.position);
      }

      // =======================================================================
      // RADIAL VACUUM PLUME IMPINGEMENT DUST SCATTER (BELOW 7.5M ALTITUDE)
      // =======================================================================
      if (thrustCmd > 0.06 && landerAltitude < 7.5 && landerAltitude >= -0.05) {
        const groundProximity = 1.0 - THREE.MathUtils.smoothstep(Math.max(0, landerAltitude), 0.1, 7.5);
        const emitCount = Math.min(10, Math.ceil(thrustCmd * (3 + groundProximity * 7)));
        for (let e = 0; e < emitCount; e++) {
          const idx = nextBallisticIdx;
          nextBallisticIdx = (nextBallisticIdx + 1) % ballisticCount;
          const az = Math.random() * Math.PI * 2.0;
          const spawnR = 0.35 + Math.random() * 1.45;
          ballisticPos[idx * 3 + 0] = landerX + Math.cos(az) * spawnR;
          ballisticPos[idx * 3 + 1] = landingGroundY + 0.08 + Math.random() * 0.12;
          ballisticPos[idx * 3 + 2] = landerZ + Math.sin(az) * spawnR;

          const radialSpeed = (2.8 + Math.random() * 5.2) * thrustCmd * (0.45 + 0.75 * groundProximity);
          ballisticVel[idx * 3 + 0] = Math.cos(az) * radialSpeed;
          ballisticVel[idx * 3 + 1] = 0.22 + Math.random() * 0.65;
          ballisticVel[idx * 3 + 2] = Math.sin(az) * radialSpeed;
          ballisticLife[idx] = 0.75 + Math.random() * 0.55;
        }
      }

      let ballisticDirty = false;
      for (let i = 0; i < ballisticCount; i++) {
        if (ballisticLife[i] > 0) {
          ballisticLife[i] -= dt;
          ballisticVel[i * 3 + 1] -= LUNAR_GRAVITY * dt;
          ballisticPos[i * 3 + 0] += ballisticVel[i * 3 + 0] * dt;
          ballisticPos[i * 3 + 1] += ballisticVel[i * 3 + 1] * dt;
          ballisticPos[i * 3 + 2] += ballisticVel[i * 3 + 2] * dt;
          if (ballisticPos[i * 3 + 1] < landingGroundY) {
            ballisticPos[i * 3 + 1] = landingGroundY;
            ballisticLife[i] = Math.min(ballisticLife[i], 0.05);
          }
          if (ballisticLife[i] <= 0) {
            ballisticPos[i * 3 + 1] = -9999;
          }
          ballisticDirty = true;
        }
      }
      if (ballisticDirty) {
        (ballisticGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      }

      // Pulse waypoint rings
      for (let i = 0; i < wpRings.length; i++) {
        const s = 1.0 + 0.12 * Math.sin(elapsed * 3.0 + i);
        wpRings[i].scale.set(s, s, 1);
      }

      // Camera focus uses the same body positions as the mission sky.
      if (syncToMissionStore) {
        const mSnap = missionPlannerStore.getSnapshot();
        if (mSnap.hasCheckedPlan) {
          if (mSnap.cameraFocusTrigger !== lastMissionFocusTrigger) {
            lastMissionFocusTrigger = mSnap.cameraFocusTrigger;
            if (mSnap.cameraFocus === 'sun') {
              const rawYaw = Math.atan2(-(sunAnchorGroup.position.x - landerX), -(sunAnchorGroup.position.z - landerZ)) - heading;
              const delta = Math.atan2(Math.sin(rawYaw - orbitYaw), Math.cos(rawYaw - orbitYaw));
              pendingSurfaceFocus = { yaw: orbitYaw + delta, pitch: 0.08, dist: ROVER_SPAWN_ORBIT_DIST };
            } else if (mSnap.cameraFocus === 'earth') {
              const rawYaw = Math.atan2(-(earthAnchorGroup.position.x - landerX), -(earthAnchorGroup.position.z - landerZ)) - heading;
              const delta = Math.atan2(Math.sin(rawYaw - orbitYaw), Math.cos(rawYaw - orbitYaw));
              pendingSurfaceFocus = { yaw: orbitYaw + delta, pitch: 0.09, dist: ROVER_SPAWN_ORBIT_DIST };
            } else {
              const delta = Math.atan2(
                Math.sin(ROVER_SPAWN_ORBIT_YAW - orbitYaw),
                Math.cos(ROVER_SPAWN_ORBIT_YAW - orbitYaw)
              );
              pendingSurfaceFocus = { yaw: orbitYaw + delta, pitch: ROVER_SPAWN_ORBIT_PITCH, dist: ROVER_SPAWN_ORBIT_DIST };
            }
          }
        }
      }

      // =======================================================================
      // UPDATE SURFACE CAMERA (FRAMES LANDER + COREHAB HUB + EARTH & SUN)
      // =======================================================================
      if (pendingSurfaceFocus && !moonOverviewActiveRef.current) {
        userAdjustedSurfaceCam = true;
        orbitYaw = THREE.MathUtils.damp(orbitYaw, pendingSurfaceFocus.yaw, 5.5, dt);
        orbitPitch = THREE.MathUtils.damp(orbitPitch, pendingSurfaceFocus.pitch, 5.5, dt);
        orbitDist = THREE.MathUtils.damp(orbitDist, pendingSurfaceFocus.dist, 5.5, dt);
        if (
          Math.abs(orbitYaw - pendingSurfaceFocus.yaw) < 0.004 &&
          Math.abs(orbitPitch - pendingSurfaceFocus.pitch) < 0.004 &&
          Math.abs(orbitDist - pendingSurfaceFocus.dist) < 0.08
        ) {
          pendingSurfaceFocus = null;
        }
      } else if (!userAdjustedSurfaceCam && !moonOverviewActiveRef.current) {
        const easeDescentCam = p * p * (3.0 - 2.0 * p);
        orbitDist = THREE.MathUtils.lerp(ROVER_INTRO_ORBIT_DIST, ROVER_SPAWN_ORBIT_DIST, easeDescentCam);
      }

      const totalYaw = heading + orbitYaw;
      const orbitCosP = Math.cos(orbitPitch);
      const orbitSinP = Math.sin(orbitPitch);
      const focusShift = 1.0 - Math.min(1.0, Math.abs(orbitYaw) * 0.45);
      const focusX = landerX - rgtX * 4.2 * focusShift;
      const focusZ = landerZ - rgtZ * 4.2 * focusShift;
      const desiredCamX = focusX + orbitDist * orbitCosP * Math.sin(totalYaw);
      const desiredCamZ = focusZ + orbitDist * orbitCosP * Math.cos(totalYaw);
      const groundAtCam = sampleGroundHeight(desiredCamX, desiredCamZ) ?? landingGroundY;
      const desiredCamY = Math.max(groundAtCam + 0.85, landingGroundY + 1.2 + orbitDist * orbitSinP);

      const camDamp = isPointerDragging ? 22.0 : 6.5;
      chaseCamPos.x = THREE.MathUtils.damp(chaseCamPos.x, desiredCamX, camDamp, dt);
      chaseCamPos.y = THREE.MathUtils.damp(chaseCamPos.y, desiredCamY, camDamp, dt);
      chaseCamPos.z = THREE.MathUtils.damp(chaseCamPos.z, desiredCamZ, camDamp, dt);

      const lookY = landingGroundY + 4.1 + landerAltitude * 0.34;
      chaseCamLook.x = THREE.MathUtils.damp(chaseCamLook.x, focusX, 8.0, dt);
      chaseCamLook.y = THREE.MathUtils.damp(chaseCamLook.y, lookY, 8.0, dt);
      chaseCamLook.z = THREE.MathUtils.damp(chaseCamLook.z, focusZ, 8.0, dt);

      surfaceCamPos.copy(chaseCamPos);
      surfaceCamLook.copy(chaseCamLook);

      // Smoothly animate transition between Surface Rover View (0) and Full Moon Space View (1)
      const targetOverview = moonOverviewActiveRef.current ? 1.0 : 0.0;
      if (Math.abs(moonTransition - targetOverview) > 0.0005) {
        const stepT = dt / 1.85;
        if (moonTransition < targetOverview) {
          moonTransition = Math.min(1.0, moonTransition + stepT);
        } else {
          moonTransition = Math.max(0.0, moonTransition - stepT);
        }
      } else {
        moonTransition = targetOverview;
      }

      if (moonTransition > 0.0005) {
        // Handle smooth camera reset back to default 3-body framing (camera never auto-moves on play)
        if (orbitalResetPendingRef.current) {
          moonOrbitYaw = THREE.MathUtils.damp(moonOrbitYaw, -0.465, 7.5, dt);
          moonOrbitPitch = THREE.MathUtils.damp(moonOrbitPitch, 0.06, 7.5, dt);
          moonOrbitDist = THREE.MathUtils.damp(moonOrbitDist, 4560.0, 7.5, dt);
          if (
            Math.abs(moonOrbitYaw + 0.465) < 0.003 &&
            Math.abs(moonOrbitPitch - 0.06) < 0.003 &&
            Math.abs(moonOrbitDist - 4560.0) < 4.0
          ) {
            moonOrbitYaw = -0.465;
            moonOrbitPitch = 0.06;
            moonOrbitDist = 4560.0;
            orbitalResetPendingRef.current = false;
          }
        }

        // C2-continuous quintic smootherstep curve
        const t = moonTransition;
        const easeT = t * t * t * (t * (t * 6.0 - 15.0) + 10.0);

        // Dynamic speed-sense FOV breathing (widens gently during orbital climb/descent, settles cleanly at endpoints)
        const targetFov = fovRef.current + Math.sin(easeT * Math.PI) * 9.5;
        if (Math.abs(camera.fov - targetFov) > 0.005) {
          camera.fov = targetFov;
          camera.updateProjectionMatrix();
        }

        // Exponential / logarithmic altitude curve across 5.8m -> 1140m so apparent zoom speed stays silky-constant
        tmpSurfaceOffset.subVectors(surfaceCamPos, surfaceCamLook);
        const d0 = Math.max(2.0, tmpSurfaceOffset.length());
        tmpDir0.copy(tmpSurfaceOffset).divideScalar(d0);

        const orbCosPitch = Math.cos(moonOrbitPitch);
        tmpDir1
          .set(
            orbCosPitch * Math.sin(moonOrbitYaw),
            Math.sin(moonOrbitPitch),
            orbCosPitch * Math.cos(moonOrbitYaw)
          )
          .normalize();

        // Elevated pole-apex waypoint so camera lifts gracefully above crater walls before sweeping to Moon orbit
        tmpPoleDir.set(tmpDir1.x * 0.28, 0.92, tmpDir1.z * 0.28).normalize();
        const oneMinusE = 1.0 - easeT;
        tmpCamDir
          .set(0, 0, 0)
          .addScaledVector(tmpDir0, oneMinusE * oneMinusE)
          .addScaledVector(tmpPoleDir, 2.0 * oneMinusE * easeT)
          .addScaledVector(tmpDir1, easeT * easeT)
          .normalize();

        const logDist = Math.exp(THREE.MathUtils.lerp(Math.log(d0), Math.log(moonOrbitDist), easeT));
        const lookBlend = THREE.MathUtils.smoothstep(easeT, 0.16, 0.88);
        tmpLookTarget.lerpVectors(surfaceCamLook, orbitalMoonCenter, lookBlend);

        tmpFlightCamPos.copy(tmpLookTarget).addScaledVector(tmpCamDir, logDist);

        // Safety ground clearance floor during low-altitude liftoff / touchdown
        if (easeT < 0.45) {
          const groundSafeY = (sampleGroundHeight(tmpFlightCamPos.x, tmpFlightCamPos.z) ?? landingGroundY) + 0.55;
          const floorBlend = 1.0 - THREE.MathUtils.smoothstep(easeT, 0.18, 0.45);
          if (tmpFlightCamPos.y < groundSafeY) {
            tmpFlightCamPos.y = THREE.MathUtils.lerp(tmpFlightCamPos.y, groundSafeY, floorBlend);
          }
        }

        camera.position.copy(tmpFlightCamPos);
        camera.up.set(0, 1, 0);
        camera.lookAt(tmpLookTarget);

        // Seamless radial horizon dissolve on surface terrain + opaque IGN cross-fade on Moon globe
        const terrainBlend = THREE.MathUtils.smoothstep(easeT, 0.06, 0.56);
        terrainPipeline.setOrbitalBlend(terrainBlend);

        const moonReveal = THREE.MathUtils.smoothstep(easeT, 0.12, 0.40);
        moonRevealUniform.value = moonReveal;
        orbitalMoonGroup.visible = moonReveal > 0.002;

        const showTerrain = terrainBlend < 0.995;
        if (showTerrain && wasTerrainHidden) {
          renderer.shadowMap.needsUpdate = true;
        }
        wasTerrainHidden = !showTerrain;

        terrainMesh.visible = showTerrain;
        rockScatterGroup.visible = easeT < 0.36;
        coreHab.group.visible = easeT < 0.36;
        ballisticPoints.visible = easeT < 0.24;
        roverWorldRoot.visible = easeT < 0.42;

        const wpFade = 1.0 - THREE.MathUtils.smoothstep(easeT, 0.06, 0.30);
        waypointMarkersGroup.visible = wpFade > 0.01;
        if (waypointMarkersGroup.visible) {
          for (let i = 0; i < wpBeamMats.length; i++) {
            wpBeamMats[i].opacity = 0.55 * wpFade;
            wpRingMats[i].opacity = 0.85 * wpFade;
          }
        }
      } else {
        if (Math.abs(camera.fov - fovRef.current) > 0.005) {
          camera.fov = fovRef.current;
          camera.updateProjectionMatrix();
        }

        terrainPipeline.setOrbitalBlend(0.0);
        moonRevealUniform.value = 0.0;
        orbitalMoonGroup.visible = false;

        if (wasTerrainHidden) {
          renderer.shadowMap.needsUpdate = true;
          wasTerrainHidden = false;
        }

        terrainMesh.visible = true;
        rockScatterGroup.visible = true;
        coreHab.group.visible = true;
        waypointMarkersGroup.visible = true;
        for (let i = 0; i < wpBeamMats.length; i++) {
          wpBeamMats[i].opacity = 0.55;
          wpRingMats[i].opacity = 0.85;
        }
        ballisticPoints.visible = true;
        roverWorldRoot.visible = true;

        camera.position.copy(surfaceCamPos);
        camera.up.set(0, 1, 0);
        camera.lookAt(surfaceCamLook);
      }

      if (useMissionSky) {
        // Never show the fixed demonstration terrain, rocks or waypoints over a
        // geographic mission site. The selected DEM supplies all ground contact.
        terrainMesh.visible = false;
        rockScatterGroup.visible = false;
        waypointMarkersGroup.visible = false;
        if (missionSurface) missionSurface.mesh.visible = missionTerrainReady;
        roverWorldRoot.visible = coreHab.group.visible = ballisticPoints.visible = missionTerrainReady;
      }

      if (!initialOverview) {
        aimEarthAtCamera();
      } else if (!hasAimedInitialOverviewEarth && earthLoaded && earthOrbitPhase === 0) {
        aimEarthAtCamera();
        hasAimedInitialOverviewEarth = true;
      }

      // Re-render directional shadow map while lander is descending/settling or Sun moves
      if (moonTransition < 0.28) {
        const sunDirectionChanged = sunDirNormalized.distanceToSquared(lastShadowSunDirection) > 1e-8;
        if (
          warmupFramesRemaining > 0 ||
          landingElapsed < DESCENT_DURATION + 0.6 ||
          sunDirectionChanged
        ) {
          renderer.shadowMap.needsUpdate = true;
          lastShadowSunDirection.copy(sunDirNormalized);
        }
      }

      // =======================================================================
      // OVERVIEW CONTROLLER TIME STEPPING & MOON_ME_DE421 SKY TELEMETRY
      // =======================================================================
      if (!useMissionSky && !orbitalPausedRef.current) {
        if (orbitalModeRef.current === 'now') {
          simTimeMsRef.current = Date.now();
        } else {
          simTimeMsRef.current += Math.min(1.0, dt) * 1000.0 * orbitalSpeedRef.current;
        }
      }

      overviewEvalTimer += dt;
      if (!useMissionSky && overviewEvalTimer >= 0.09) {
        overviewEvalTimer = 0;
        const clockStr = formatUtcDoyClock(new Date(simTimeMsRef.current));
        if (clockStr !== lastClockKey) {
          lastClockKey = clockStr;
          setUtcDoyClock(clockStr);
        }

        const sky = overviewBackend.evaluateAt(simTimeMsRef.current);
        const site = overviewBackend.getSite();
        const ovKey = `${sky.sunElDeg.toFixed(2)}|${sky.sunAzDeg.toFixed(1)}|${sky.sunStatus}|${sky.earthElDeg.toFixed(2)}|${sky.earthAzDeg.toFixed(1)}|${sky.earthStatus}`;
        if (ovKey !== lastOverviewKey) {
          lastOverviewKey = ovKey;
          setOrbitalTelemetry({
            siteTitle: site.title,
            coordsText: site.coordsText,
            sunElevDeg: sky.sunElDeg,
            sunAzimuthDeg: sky.sunAzDeg,
            sunStatus: sky.sunStatus,
            earthElevDeg: sky.earthElDeg,
            earthAzimuthDeg: sky.earthAzDeg,
            earthStatus: sky.earthStatus,
          });
        }
      }

      renderer.render(scene, camera);

      // Update frame-synced orbital distance lines (Earth -> Moon: 384,400 km, Moon -> Sun: 149,600,000 km)
      const distSvgEl = orbitalDistSvgRef.current;
      if (distSvgEl) {
        const lineOpacity = THREE.MathUtils.smoothstep(moonTransition, 0.72, 0.98);
        if (lineOpacity <= 0.005) {
          distSvgEl.style.display = 'none';
        } else {
          distSvgEl.style.display = 'block';
          distSvgEl.style.opacity = lineOpacity.toFixed(3);
          const viewW = container.clientWidth || window.innerWidth;
          const viewH = container.clientHeight || window.innerHeight;
          const camRight = tmpDir0.setFromMatrixColumn(camera.matrixWorld, 0).normalize();

          const projectBody = (worldCenter: THREE.Vector3, worldRadius: number) => {
            tmpDir1.copy(worldCenter).project(camera);
            if (tmpDir1.z >= 1.0) return null;
            const cx = (tmpDir1.x * 0.5 + 0.5) * viewW;
            const cy = (-tmpDir1.y * 0.5 + 0.5) * viewH;
            tmpLookTarget.copy(worldCenter).addScaledVector(camRight, worldRadius).project(camera);
            const ex = (tmpLookTarget.x * 0.5 + 0.5) * viewW;
            const ey = (-tmpLookTarget.y * 0.5 + 0.5) * viewH;
            const pxR = Math.hypot(ex - cx, ey - cy);
            return { x: cx, y: cy, r: pxR };
          };

          const updateLink = (
            a: { x: number; y: number; r: number } | null,
            b: { x: number; y: number; r: number } | null,
            groupEl: SVGGElement | null,
            gradEl: SVGLinearGradientElement | null,
            lineEl: SVGLineElement | null,
            textEl: SVGTextElement | null
          ) => {
            if (!groupEl || !gradEl || !lineEl || !textEl) return;
            if (!a || !b) {
              groupEl.style.display = 'none';
              return;
            }
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.hypot(dx, dy);
            const padA = a.r + 14;
            const padB = b.r + 14;
            if (dist <= padA + padB + 26) {
              groupEl.style.display = 'none';
              return;
            }
            const ux = dx / dist;
            const uy = dy / dist;
            const x1 = a.x + ux * padA;
            const y1 = a.y + uy * padA;
            const x2 = b.x - ux * padB;
            const y2 = b.y - uy * padB;

            groupEl.style.display = 'block';
            const x1s = x1.toFixed(1);
            const y1s = y1.toFixed(1);
            const x2s = x2.toFixed(1);
            const y2s = y2.toFixed(1);

            gradEl.setAttribute('x1', x1s);
            gradEl.setAttribute('y1', y1s);
            gradEl.setAttribute('x2', x2s);
            gradEl.setAttribute('y2', y2s);
            lineEl.setAttribute('x1', x1s);
            lineEl.setAttribute('y1', y1s);
            lineEl.setAttribute('x2', x2s);
            lineEl.setAttribute('y2', y2s);

            // Place distance label cleanly underneath the midpoint of the line
            const mx = (x1 + x2) * 0.5;
            const my = (y1 + y2) * 0.5;
            let nx = -uy;
            let ny = ux;
            if (ny < 0) {
              nx = -nx;
              ny = -ny;
            }
            const labelX = mx + nx * 18;
            const labelY = my + Math.max(18, ny * 22) + viewH * 0.07;
            textEl.setAttribute('x', labelX.toFixed(1));
            textEl.setAttribute('y', labelY.toFixed(1));
          };

          const earthProj = projectBody(earthAnchorGroup.position, 584);
          const moonProj = projectBody(orbitalMoonCenter, orbitalMoonRadius);
          const sunProj = projectBody(sunAnchorGroup.position, 560);

          updateLink(
            earthProj,
            moonProj,
            earthMoonGroupRef.current,
            earthMoonGradRef.current,
            earthMoonLineRef.current,
            earthMoonTextRef.current
          );
          updateLink(
            moonProj,
            sunProj,
            moonSunGroupRef.current,
            moonSunGradRef.current,
            moonSunLineRef.current,
            moonSunTextRef.current
          );
        }
      }

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);

    return () => {
      isDisposed = true;
      sunDisposed = true;
      window.clearTimeout(assetSafetyTimer);
      if (readyNotifyTimerId !== null) window.clearTimeout(readyNotifyTimerId);
      cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      container.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      container.removeEventListener('wheel', handleWheel);
      window.removeEventListener('resize', handleResize);
      haloGeo.dispose();
      haloMat.dispose();
      solarCoronaTex.dispose();
      solarCoronaMat.dispose();
      sunGeometries.forEach((g) => g.dispose());
      sunMaterials.forEach((m) => m.dispose());
      sunTextures.forEach((t) => t.dispose());
      orbitalMoonGeometries.forEach((g) => g.dispose());
      orbitalMoonMaterials.forEach((m) => m.dispose());
      orbitalMoonTextures.forEach((t) => t.dispose());
      ballisticGeo.dispose();
      ballisticMat.dispose();
      lander.dispose();
      coreHab.dispose();
      envMapRT.dispose();
      missionSurface?.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };

  }, []);

  return (
    <div className="relative w-full h-full bg-black overflow-hidden select-none font-mono tabular-nums text-white">
      {/* 3D Shackleton Crater WebGL Canvas */}
      <div ref={mountRef} className="absolute inset-0 w-full h-full" />

      {syncToMissionStore && !moonOverviewActive && (
        <div className={`pointer-events-none absolute left-3 right-3 z-20 text-[10px] leading-relaxed text-white/80 drop-shadow-[0_1px_3px_#000] ${missionHudActive ? 'top-12 lg:right-[200px]' : 'top-3'}`} aria-label="Mission sky position">
          {missionSkyReadout ? (
            <>
              <div>{missionSkyReadout.siteTitle} · {missionSkyReadout.coordinates} · {missionSkyReadout.sample.utc.slice(0, 19).replace('T', ' ')} UTC</div>
              <div>
                Sun · az {missionSkyReadout.sample.sunAzDeg.toFixed(1)}° · el {missionSkyReadout.sample.sunElDeg.toFixed(1)}°{missionSkyReadout.sample.sunFraction <= 1e-8 ? ' · obscured' : ''}
                {'  /  '}
                Earth · az {missionSkyReadout.sample.earthAzDeg.toFixed(1)}° · el {missionSkyReadout.sample.earthElDeg.toFixed(1)}°{missionSkyReadout.sample.earthFraction <= 1e-8 ? ' · below site horizon' : ''}
              </div>
              <div className="text-white/50">Mission-time positions · bodies enlarged · {missionTerrainStatus}</div>
            </>
          ) : (
            <div>{missionSkyError ? 'Sky data unavailable. Reopen the viewer to retry.' : 'Loading mission sky…'}</div>
          )}
        </div>
      )}

      {/* Orbital Distance Dotted Lines (Earth -> Moon & Moon -> Sun) */}
      <svg
        ref={orbitalDistSvgRef}
        className="pointer-events-none select-none absolute inset-0 w-full h-full z-10 overflow-visible"
        style={{ display: 'none' }}
      >
        <defs>
          {/* Blue -> White (70%) -> Red gradient along Earth-to-Moon line */}
          <linearGradient
            ref={earthMoonGradRef}
            id="earthMoonLineGrad"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="15%" stopColor="#ffffff" />
            <stop offset="85%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#ef4444" />
          </linearGradient>

          {/* Yellow -> White (70%) -> Yellow gradient along Moon-to-Sun line */}
          <linearGradient
            ref={moonSunGradRef}
            id="moonSunLineGrad"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#facc15" />
            <stop offset="15%" stopColor="#ffffff" />
            <stop offset="85%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#facc15" />
          </linearGradient>

          <filter id="orbitalDistTextShadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="1" stdDeviation="2.5" floodColor="#000000" floodOpacity="0.88" />
          </filter>
        </defs>

        <g ref={earthMoonGroupRef}>
          <line
            ref={earthMoonLineRef}
            stroke="url(#earthMoonLineGrad)"
            strokeWidth="2.55"
            strokeDasharray="1.5 9.5"
            strokeLinecap="round"
          />
          <text
            ref={earthMoonTextRef}
            fill="rgba(255, 255, 255, 0.94)"
            textAnchor="middle"
            dominantBaseline="hanging"
            filter="url(#orbitalDistTextShadow)"
            className="font-['Inter',sans-serif] font-semibold text-[12.6px] tracking-tight tabular-nums"
          >
            384,400 km
          </text>
        </g>

        <g ref={moonSunGroupRef}>
          <line
            ref={moonSunLineRef}
            stroke="url(#moonSunLineGrad)"
            strokeWidth="2.55"
            strokeDasharray="1.5 9.5"
            strokeLinecap="round"
          />
          <text
            ref={moonSunTextRef}
            fill="rgba(255, 255, 255, 0.94)"
            textAnchor="middle"
            dominantBaseline="hanging"
            filter="url(#orbitalDistTextShadow)"
            className="font-['Inter',sans-serif] font-semibold text-[12.6px] tracking-tight tabular-nums"
          >
            149,600,000 km
          </text>
        </g>
      </svg>

      {/* Initial loading screen while 3D Rover & Shackleton DEM initialize */}
      {!sceneReady && !hideLoadingScreen && (
        <div className="absolute inset-0 z-50 bg-[#040814] flex flex-col items-center justify-center gap-4">
          <div className="relative w-16 h-16 flex items-center justify-center">
            <div className="absolute inset-0 border-2 border-[#0b3d91] rounded-full" />
            <div className="w-14 h-14 border-2 border-[#fc3d21] border-t-transparent rounded-full animate-spin" />
          </div>
          <div className="flex items-center gap-2 text-[11px] tracking-[0.26em] text-white/90 uppercase">
            <span className="text-[#60a5fa] font-bold">SHACKLETON 3×3 KM LRO LINK</span>
          </div>
        </div>
      )}

      {/* =====================================================================
          BOTTOM-LEFT (SURFACE VIEW): PLANNER BUTTON + ORBIT / ZOOM CUE
         ===================================================================== */}
      {!moonOverviewActive && !missionHudActive && (
        <div
          data-hud-interactive
          className="absolute left-5 bottom-5 sm:left-8 sm:bottom-8 z-30 flex items-center gap-3.5"
        >
          {!embedded && onOpenPlanner && (
            <button
              type="button"
              onClick={onOpenPlanner}
              aria-label="Open Mission Planner"
              title="Open Mission Planner"
              className="group flex items-center justify-center w-10 h-10 rounded-full border backdrop-blur-md transition-all duration-300 cursor-pointer bg-[#050b18]/85 border-white/20 text-white/85 hover:border-white/38 hover:text-white shadow-[0_6px_18px_rgba(0,0,0,0.65)]"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-[18px] h-[18px] transition-transform duration-300 group-hover:scale-110"
              >
                <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
                <path d="m15 5 4 4" />
              </svg>
            </button>
          )}

          <div className="flex items-center gap-2 text-[9px] tracking-[0.18em] text-white/85">
            <span className="font-bold">SCROLL TO ZOOM</span>
            <span className="text-white/35">·</span>
            <span className="text-[#60a5fa] font-semibold">DRAG TO ORBIT</span>
          </div>
        </div>
      )}



      {/* =====================================================================
          BOTTOM (FULL-MOON VIEW): FROSTED GLASSMORPHISM CONTROLS OVERVIEW DOCK
         ===================================================================== */}
      {moonOverviewActive && !hideOverviewHud && (
        <div
          data-hud-interactive
          className="absolute left-1/2 -translate-x-1/2 bottom-5 sm:bottom-8 w-[min(846px,calc(100%-2rem))] z-30 font-sans tabular-nums"
        >
          <div className="relative rounded-2xl border border-white/15 bg-slate-900/35 backdrop-blur-xl shadow-[0_22px_55px_rgba(0,0,0,0.68),inset_0_1px_0_rgba(255,255,255,0.2)]">
            {/* Subtle Frosted Corner Red & Blue Radial Highlights */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
              <div className="absolute -top-12 -left-12 w-56 h-56 rounded-full bg-[#2563eb]/20 blur-2xl" />
              <div className="absolute -bottom-12 -left-12 w-48 h-48 rounded-full bg-[#3b82f6]/14 blur-2xl" />
              <div className="absolute -top-12 -right-12 w-56 h-56 rounded-full bg-[#fc3d21]/18 blur-2xl" />
              <div className="absolute -bottom-12 -right-12 w-48 h-48 rounded-full bg-[#fc3d21]/14 blur-2xl" />
            </div>

            {/* Literal Machined Brushed-Titanium / Steel Metal Corner Brackets */}
            {(
              [
                { pos: '-top-[2px] -left-[2px]', transform: '' },
                { pos: '-top-[2px] -right-[2px]', transform: 'scale(-1, 1)' },
                { pos: '-bottom-[2px] -left-[2px]', transform: 'scale(1, -1)' },
                { pos: '-bottom-[2px] -right-[2px]', transform: 'scale(-1, -1)' },
              ] as const
            ).map((c, idx) => (
              <svg
                key={c.pos}
                viewBox="0 0 28 28"
                className={`pointer-events-none absolute ${c.pos} w-7 h-7 z-20 drop-shadow-[0_2px_4px_rgba(0,0,0,0.85)]`}
                style={c.transform ? { transform: c.transform } : undefined}
              >
                <defs>
                  <linearGradient id={`steelBracketGrad-${idx}`} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#f1f5f9" />
                    <stop offset="28%" stopColor="#94a3b8" />
                    <stop offset="52%" stopColor="#cbd5e1" />
                    <stop offset="78%" stopColor="#475569" />
                    <stop offset="100%" stopColor="#1e293b" />
                  </linearGradient>
                  <linearGradient id={`steelBevelRim-${idx}`} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="rgba(255,255,255,0.88)" />
                    <stop offset="60%" stopColor="rgba(148,163,184,0.45)" />
                    <stop offset="100%" stopColor="rgba(15,23,42,0.9)" />
                  </linearGradient>
                </defs>
                {/* Machined L-Gusset Metal Plate */}
                <path
                  d="M 1 26 L 1 17 A 16 16 0 0 1 17 1 L 26 1 L 26 5.5 L 17 5.5 A 11.5 11.5 0 0 0 5.5 17 L 5.5 26 Z"
                  fill={`url(#steelBracketGrad-${idx})`}
                  stroke={`url(#steelBevelRim-${idx})`}
                  strokeWidth="0.9"
                  strokeLinejoin="round"
                />
                {/* Machined Recessed Inner Step Shadow */}
                <path
                  d="M 5.5 25 L 5.5 17 A 11.5 11.5 0 0 1 17 5.5 L 25 5.5"
                  fill="none"
                  stroke="rgba(15,23,42,0.85)"
                  strokeWidth="0.85"
                />
                {/* Brushed Micro-Rivet Corner Fastener */}
                <circle cx="6.2" cy="6.2" r="1.75" fill="#1e293b" stroke="rgba(226,232,240,0.45)" strokeWidth="0.45" />
                <circle cx="6.0" cy="6.0" r="0.85" fill="#cbd5e1" />
              </svg>
            ))}

            {/* Row 1: Playback, Speed Selector, Now, Hint & Reset View */}
            <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-2.5 border-b border-white/12">
              <div className="flex items-center gap-2.5 sm:gap-3">
                {/* Pause / Play */}
                <button
                  ref={playButtonRef}
                  type="button"
                  onClick={handleToggleOrbitalPause}
                  aria-label={orbitalPaused ? 'Resume Orbital Time' : 'Pause Orbital Time'}
                  className="w-8 h-8 rounded-lg border border-white/20 bg-white/[0.08] hover:bg-white/[0.15] hover:border-[#60a5fa]/60 flex items-center justify-center text-white transition-colors cursor-pointer"
                >
                  {orbitalPaused ? (
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 translate-x-[0.5px]">
                      <path d="M4.2 2.8a.6.6 0 0 1 .9-.52l8.2 4.7a.6.6 0 0 1 0 1.04l-8.2 4.7a.6.6 0 0 1-.9-.52V2.8z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                      <rect x="4" y="3" width="2.6" height="10" rx="0.8" />
                      <rect x="9.4" y="3" width="2.6" height="10" rx="0.8" />
                    </svg>
                  )}
                </button>

                <span className="text-xs text-white/60 font-medium hidden sm:inline">Speed</span>

                {/* Frosted Speed Dropdown */}
                <div className="relative">
                  <button
                    ref={speedTriggerRef}
                    type="button"
                    onClick={() => {
                      setHoveredSpeedIdx(null);
                      setSpeedMenuOpen((prev) => !prev);
                    }}
                    className="h-8 px-3 rounded-lg border border-white/20 bg-white/[0.07] hover:bg-white/[0.14] hover:border-[#60a5fa]/60 flex items-center gap-2.5 text-xs font-medium text-white/95 whitespace-nowrap transition-colors cursor-pointer"
                  >
                    <span>
                      {ORBITAL_SPEED_PRESETS.find((p) => p.value === orbitalSpeed)?.label ??
                        `${orbitalSpeed}×`}
                    </span>
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      className={`w-3.5 h-3.5 text-white/65 transition-transform duration-150 ${
                        speedMenuOpen ? 'rotate-180' : ''
                      }`}
                    >
                      <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>

                  {speedMenuOpen && (() => {
                    const selectedIdx = Math.max(
                      0,
                      ORBITAL_SPEED_PRESETS.findIndex((p) => p.value === orbitalSpeed)
                    );
                    const activeHighlightIdx =
                      hoveredSpeedIdx !== null ? hoveredSpeedIdx : selectedIdx;
                    return (
                      <div
                        onMouseLeave={() => setHoveredSpeedIdx(null)}
                        className="absolute left-0 bottom-full mb-2 min-w-[172px] whitespace-nowrap rounded-xl border border-white/20 bg-slate-950/90 backdrop-blur-xl shadow-[0_14px_34px_rgba(0,0,0,0.85)] p-1.5 overflow-hidden z-40"
                      >
                        <div className="relative flex flex-col">
                          {/* Smooth gliding highlight pill inset cleanly within rounded container */}
                          <div
                            aria-hidden="true"
                            className="pointer-events-none absolute left-0 right-0 top-0 h-8 rounded-lg bg-[#2563eb]/32 border border-white/10 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
                            style={{ transform: `translateY(${activeHighlightIdx * 32}px)` }}
                          />
                          {ORBITAL_SPEED_PRESETS.map((preset, idx) => {
                            const isSelected = preset.value === orbitalSpeed;
                            const isHighlighted = activeHighlightIdx === idx;
                            return (
                              <button
                                key={preset.value}
                                ref={preset.value === 24 ? speedOption24Ref : undefined}
                                type="button"
                                onMouseEnter={() => setHoveredSpeedIdx(idx)}
                                onClick={() => {
                                  setHoveredSpeedIdx(null);
                                  handleSelectOrbitalSpeed(preset.value);
                                }}
                                className={`relative z-10 h-8 w-full px-2.5 rounded-lg text-left text-xs flex items-center justify-between gap-3 transition-colors duration-150 cursor-pointer ${
                                  isSelected
                                    ? 'text-white font-semibold'
                                    : isHighlighted
                                    ? 'text-white'
                                    : 'text-white/75'
                                }`}
                              >
                                <span>{preset.label}</span>
                                {isSelected && (
                                  <svg
                                    viewBox="0 0 16 16"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className="w-3.5 h-3.5 text-slate-300 shrink-0"
                                  >
                                    <path d="M3.5 8.5l3 3 6-6.5" />
                                  </svg>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Now Button (hidden only when playing && mode === 'now') */}
                {(orbitalPaused || orbitalMode !== 'now') && (
                  <button
                    type="button"
                    onClick={handleOrbitalNow}
                    className="h-8 px-3.5 rounded-lg border border-white/20 bg-white/[0.07] hover:bg-white/[0.15] hover:border-[#fc3d21]/60 text-xs font-medium text-white/95 transition-colors cursor-pointer"
                  >
                    Now
                  </button>
                )}
              </div>

              {/* Center Interaction Cue */}
              <div className="hidden lg:block text-xs tracking-wide transition-colors duration-500">
                <span className={dragCueThinking ? 'silver-thinking-text font-medium' : 'text-white/55'}>
                  Drag to rotate · scroll to zoom
                </span>
              </div>

              {/* Reset View */}
              <button
                type="button"
                onClick={handleResetOrbitalView}
                className="h-8 px-2.5 rounded-lg hover:bg-white/[0.1] flex items-center gap-1.5 text-xs font-medium text-white/90 hover:text-white transition-colors cursor-pointer"
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-3.5 h-3.5 text-[#60a5fa]"
                >
                  <path d="M2.5 8a5.5 5.5 0 1 0 1.45-3.72" />
                  <path d="M2.5 2.75v2.75h2.75" />
                </svg>
                <span>Reset view</span>
              </button>
            </div>

            {/* Row 2: 3-Column Site, Sun & Earth Telemetry */}
            <div className="relative z-10 grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/12">
              {/* Column 1: Reference Site */}
              <div className="px-4 sm:px-6 py-3 sm:py-3.5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">
                  REFERENCE SITE · 2 M HEIGHT
                </div>
                <div className="text-base sm:text-lg font-semibold text-white tracking-tight mt-1 truncate">
                  {orbitalTelemetry.siteTitle}
                </div>
                <div className="text-xs text-white/60 mt-0.5">
                  {orbitalTelemetry.coordsText}
                </div>
              </div>

              {/* Column 2: Sun at the Site */}
              <div className="px-4 sm:px-6 py-3 sm:py-3.5">
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">
                  <span className="w-2 h-2 rounded-full bg-[#c2a85c]/80" />
                  <span>SUN AT THE SITE</span>
                </div>
                <div className="text-base sm:text-lg font-semibold text-white tracking-tight mt-1">
                  {orbitalTelemetry.sunElevDeg >= 0
                    ? `+${orbitalTelemetry.sunElevDeg.toFixed(2)}°`
                    : `${orbitalTelemetry.sunElevDeg.toFixed(2)}°`}{' '}
                  elevation
                </div>
                <div className="text-xs text-white/60 mt-0.5">
                  Azimuth {orbitalTelemetry.sunAzimuthDeg.toFixed(1)}° · {orbitalTelemetry.sunStatus}
                </div>
              </div>

              {/* Column 3: Earth at the Site */}
              <div className="px-4 sm:px-6 py-3 sm:py-3.5">
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">
                  <span className="w-2 h-2 rounded-full bg-[#6b8bb8]/85" />
                  <span>EARTH AT THE SITE</span>
                </div>
                <div className="text-base sm:text-lg font-semibold text-white tracking-tight mt-1">
                  {orbitalTelemetry.earthElevDeg >= 0
                    ? `+${orbitalTelemetry.earthElevDeg.toFixed(2)}°`
                    : `${orbitalTelemetry.earthElevDeg.toFixed(2)}°`}{' '}
                  elevation
                </div>
                <div className="text-xs text-white/60 mt-0.5">
                  Azimuth {orbitalTelemetry.earthAzimuthDeg.toFixed(1)}° · {orbitalTelemetry.earthStatus}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}



      {/* =====================================================================
          TOP-RIGHT: DAY OF YEAR (DOY) + 24-HOUR UTC CLOCK (STANDALONE OVERVIEW ONLY)
         ===================================================================== */}
      {!embedded && !hideOverviewHud && (
        <div
          className="pointer-events-none select-none absolute top-5 right-5 sm:top-8 sm:right-8 z-30 font-telemetry font-semibold text-[13px] leading-none tracking-[0.04em] text-white/90 drop-shadow-[0_1px_6px_rgba(0,0,0,0.85)]"
          aria-label="Day of Year and 24-hour UTC Clock"
        >
          {utcDoyClock}
        </div>
      )}

      {/* =====================================================================
          BOTTOM-LEFT (ORBITAL OVERVIEW): MISSION PLANNER PENCIL BUTTON
         ===================================================================== */}
      {moonOverviewActive && !embedded && !hideOverviewHud && onOpenPlanner && (
        <div
          data-hud-interactive
          className="absolute bottom-5 left-5 sm:bottom-8 sm:left-8 z-30"
        >
          <button
            type="button"
            onClick={onOpenPlanner}
            aria-label="Open Mission Planner"
            title="Open Mission Planner"
            className="group flex items-center justify-center w-10 h-10 rounded-full border backdrop-blur-md transition-all duration-300 cursor-pointer bg-slate-900/55 border-white/25 text-white/90 hover:border-white/40 hover:bg-slate-800/65 shadow-[0_6px_18px_rgba(0,0,0,0.55)] scale-105"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-[18px] h-[18px] transition-transform duration-300 group-hover:scale-110"
            >
              <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
              <path d="m15 5 4 4" />
            </svg>
          </button>
        </div>
      )}

      {/* Interactive Hand-Pointer Demo Overlay (2s after entering Orbital Overview) */}
      {demoCursor.visible && !hideOverviewHud && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[60] transition-[left,top,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{
            left: `${demoCursor.x}px`,
            top: `${demoCursor.y}px`,
            transform: 'translate(-9px, -3px)',
          }}
        >
          {/* Soft tap ripple ring */}
          <span
            className={`absolute -left-2 -top-2 w-7 h-7 rounded-full border border-white/70 transition-all duration-200 ${
              demoCursor.pressing ? 'scale-125 opacity-90' : 'scale-50 opacity-0'
            }`}
          />
          <svg
            viewBox="0 0 28 28"
            className={`w-7 h-7 drop-shadow-[0_4px_10px_rgba(0,0,0,0.85)] transition-transform duration-150 ${
              demoCursor.pressing ? 'scale-90' : 'scale-100'
            }`}
          >
            <path
              d="M11.2 3.2a1.8 1.8 0 0 1 3.6 0v7.6c.5-.3 1.2-.5 1.8-.3.9.2 1.5.9 1.7 1.7.6-.2 1.3-.1 1.9.3.7.4 1.1 1.1 1.2 1.9.6 0 1.2.2 1.7.6.6.5.9 1.3.9 2.2v3.3c0 3.7-2.6 6.7-6.6 6.7h-2.5c-2.6 0-4.7-1.2-6.2-3.3l-3-4.3a1.7 1.7 0 0 1 .4-2.4c.7-.5 1.7-.3 2.3.4l1.8 2.1V3.2z"
              fill="#f8fafc"
              stroke="#0f172a"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      )}
    </div>
  );
}
