'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  ShackletonTerrainPipeline,
  LUNAR_GRAVITY,
  SHACKLETON_ORIGIN,
  ROVER_SPAWN_X,
  ROVER_SPAWN_Z,
  ROVER_SPAWN_HEADING,
  ROVER_SPAWN_ORBIT_YAW,
  ROVER_SPAWN_ORBIT_PITCH,
  ROVER_SPAWN_ORBIT_DIST,
  ROVER_INTRO_ORBIT_YAW,
  ROVER_INTRO_ORBIT_PITCH,
  ROVER_INTRO_ORBIT_DIST,
  COREHAB_POS_X,
  COREHAB_POS_Z,
  COREHAB_YAW,
  localEnuToLunarLatLon,
} from './ShackletonTerrainPipeline';
import { buildCoreHabBase } from './CoreHabBase';
import {
  LunarOverviewBackend,
  RIDGE_SHOULDER_SITE,
} from './LunarOverviewModel';

const ROVER_GLB_URL = '/assets/aistudio/24883_MER_static-1.glb';
const EARTH_GLB_URL = '/assets/aistudio/earth.glb';
const MOON_GLB_URL = '/assets/aistudio/moon_small.glb';
const LUNA_FLAG_LOGO_URL = '/assets/aistudio/Luna_Shift__3__4181c459.png';
import SUN_GLB_URL from './Sun_1_1391000.glb?url';

type DirectionKey = 'up' | 'down' | 'left' | 'right';
type HeadlightMode = 'HIGH' | 'LOW' | 'OFF';

interface RiggedPart {
  obj: THREE.Object3D;
  baseQuat: THREE.Quaternion;
  basePos: THREE.Vector3;
}

interface CuriosityRig {
  leftWheels: RiggedPart[];
  rightWheels: RiggedPart[];
  frontSteer: RiggedPart[];
  rearSteer: RiggedPart[];
  leftSuspension: RiggedPart[];
  rightSuspension: RiggedPart[];
  mastHead: RiggedPart | null;
}

interface TelemetryState {
  headingDeg: number;
  roverX: number;
  roverZ: number;
  nearestWaypointDistM: number;
  earthX: number;
  earthZ: number;
  sunDirX: number;
  sunDirZ: number;
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

export default function LunarRoverScene({ active = true }: { active?: boolean } = {}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const activeRef = useRef<boolean>(active);

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

  const [utcDoyClock, setUtcDoyClock] = useState<string>(() => formatUtcDoyClock());

  const [sceneReady, setSceneReady] = useState(false);
  const [moonOverviewActive, setMoonOverviewActive] = useState(true);
  const moonOverviewActiveRef = useRef(true);
  const headlightModeRef = useRef<HeadlightMode>('HIGH');
  const exposureRef = useRef(1.18);
  const fovRef = useRef(42);

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

  const activeWaypointIdxRef = useRef(0);
  const [sampleBanner, setSampleBanner] = useState<string | null>(null);

  // Guarantee the surface rover always starts in the 4.4s close-up hero view before panning out & unlocking controls
  const resetSurfaceToEarthSpawnRef = useRef(false);
  const [surfaceControlsReady, setSurfaceControlsReady] = useState(false);
  const surfaceControlsReadyRef = useRef(false);

  // Active directional control state (driven by keyboard WASD / Arrows or 3D WASD buttons)
  const activeDirsRef = useRef<Record<DirectionKey, boolean>>({
    up: false,
    down: false,
    left: false,
    right: false,
  });
  const [activeDirsUI, setActiveDirsUI] = useState<Record<DirectionKey, boolean>>({
    up: false,
    down: false,
    left: false,
    right: false,
  });

  const [telemetry, setTelemetry] = useState<TelemetryState>({
    headingDeg: Math.round((((-ROVER_SPAWN_HEADING * 180) / Math.PI) % 360 + 360) % 360),
    roverX: ROVER_SPAWN_X,
    roverZ: ROVER_SPAWN_Z,
    nearestWaypointDistM: 617,
    earthX: 0,
    earthZ: -8200,
    sunDirX: 0.76,
    sunDirZ: -0.635,
  });

  const setDirectionActive = useCallback((dir: DirectionKey, isActive: boolean) => {
    if (isActive && !surfaceControlsReadyRef.current) return;
    if (activeDirsRef.current[dir] === isActive) return;
    activeDirsRef.current[dir] = isActive;
    setActiveDirsUI({ ...activeDirsRef.current });
  }, []);

  const handleCycleHeadlights = useCallback(() => {
    const next: HeadlightMode =
      headlightModeRef.current === 'HIGH'
        ? 'LOW'
        : headlightModeRef.current === 'LOW'
        ? 'OFF'
        : 'HIGH';
    headlightModeRef.current = next;
  }, []);

  const handleToggleMoonOverview = useCallback(() => {
    const next = !moonOverviewActiveRef.current;
    moonOverviewActiveRef.current = next;
    setMoonOverviewActive(next);
    setSpeedMenuOpen(false);
    surfaceControlsReadyRef.current = false;
    setSurfaceControlsReady(false);
    activeDirsRef.current = { up: false, down: false, left: false, right: false };
    setActiveDirsUI({ up: false, down: false, left: false, right: false });
    if (!next) {
      resetSurfaceToEarthSpawnRef.current = true;
    }
  }, []);

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
    if (!active || !sceneReady || !moonOverviewActive) {
      setDragCueThinking(false);
      return;
    }
    setDragCueThinking(true);
    const timerId = window.setTimeout(() => {
      setDragCueThinking(false);
    }, 12000);
    return () => window.clearTimeout(timerId);
  }, [active, sceneReady, moonOverviewActive]);

  // Interactive hand-pointer demo 2s after the orbital scene loads into view:
  // Opens Speed dropdown -> selects 24× -> clicks Play button (cancels immediately on user input)
  useEffect(() => {
    if (!active || !sceneReady || !moonOverviewActive || demoHasPlayedRef.current) return;
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
  }, [active, sceneReady, moonOverviewActive, handleSelectOrbitalSpeed, syncOverviewFromBackend]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      const testCanvas = document.createElement('canvas');
      const gl = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

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
      32000
    );
    cameraRef.current = camera;

    // Build Authoritative 3 km x 3 km Shackleton Crater Terrain Pipeline + MOON_ME_DE421 Sky Model
    const terrainPipeline = new ShackletonTerrainPipeline();
    const overviewBackend = new LunarOverviewBackend(terrainPipeline, RIDGE_SHOULDER_SITE);
    overviewBackendRef.current = overviewBackend;
    syncOverviewFromBackend(simTimeMsRef.current);

    const terrainMesh = terrainPipeline.createTerrainMesh();
    scene.add(terrainMesh);

    const rockScatterGroup = terrainPipeline.createRockScatterGroup();
    scene.add(rockScatterGroup);

    // Mount Exact NASA-Grade CoreHab 3D Surface Habitat on the graded NNE plain
    const coreHab = buildCoreHabBase(renderer.capabilities.getMaxAnisotropy());
    coreHab.group.position.set(
      COREHAB_POS_X,
      terrainPipeline.sampleHeight(COREHAB_POS_X, COREHAB_POS_Z),
      COREHAB_POS_Z
    );
    coreHab.group.rotation.y = COREHAB_YAW;
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

      const r = 16000.0;
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

    // Distant 3D Earth (earth.glb) framed ahead in the northern sky on spawn & upper-left in 4x orbital view
    // Positioned safely outside the 7200m orbital Moon envelope with clear visibility above Shackleton's rim
    const earthAnchorGroup = new THREE.Group();
    earthAnchorGroup.position.set(0, 1280, -8200);
    // Subtle axial tilt (23.4°)
    earthAnchorGroup.rotation.z = 0.41;
    scene.add(earthAnchorGroup);

    const earthSpinGroup = new THREE.Group();
    earthAnchorGroup.add(earthSpinGroup);

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

    const earthGltfLoader = new GLTFLoader();
    earthGltfLoader.load(
      EARTH_GLB_URL,
      (gltf) => {
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
                  std.emissiveMap = std.map;
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

        earthSpinGroup.add(earthModel);
      },
      undefined,
      (err) => {
        console.error('Failed to load earth.glb:', err);
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
    const shadowHalfExtent = 46.0;
    sunLight.shadow.camera.left = -shadowHalfExtent;
    sunLight.shadow.camera.right = shadowHalfExtent;
    sunLight.shadow.camera.top = shadowHalfExtent;
    sunLight.shadow.camera.bottom = -shadowHalfExtent;
    sunLight.shadow.bias = -0.00045;
    scene.add(sunLight);
    scene.add(sunLight.target);

    // 3D Sun GLB (Sun_1_1391000.glb) + soft radial additive solar corona halo
    const sunAnchorGroup = new THREE.Group();
    sunAnchorGroup.position.copy(sunDirNormalized).multiplyScalar(13800);
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
        const targetDiameter = 1060.0;
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
      },
      undefined,
      (err) => {
        console.error('Failed to load Sun_1_1391000.glb:', err);
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
    let isDisposed = false;

    const moonGltfLoader = new GLTFLoader();
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
    terrainPipeline.tryStreamCesiumMoonTiles(() => {
      terrainPipeline.waypoints.forEach((wp, idx) => {
        const marker = waypointMarkersGroup.children[idx];
        if (marker) {
          marker.position.y = wp.y;
        }
      });
      coreHab.group.position.y = terrainPipeline.sampleHeight(COREHAB_POS_X, COREHAB_POS_Z);
      surfaceFlagGroup.position.y = terrainPipeline.sampleHeight(surfaceFlagX, surfaceFlagZ);
      renderer.shadowMap.needsUpdate = true;
    });


    // =========================================================================
    // 3. PERSISTENT 6-WHEEL NASA CHEVRON TRACK DECALS & VACUUM BALLISTIC DUST
    // =========================================================================
    const trackCanvas = document.createElement('canvas');
    trackCanvas.width = 512;
    trackCanvas.height = 512;
    const tCtx = trackCanvas.getContext('2d');
    if (tCtx) {
      tCtx.clearRect(0, 0, 512, 512);
      const img = tCtx.createImageData(512, 512);
      const d = img.data;
      for (let y = 0; y < 512; y++) {
        const ny = y / 511.0; // 0..1 along rolling direction
        // Smooth longitudinal feathering at front & back edges so consecutive stamps fuse seamlessly
        const edgeFadeY = Math.sin(ny * Math.PI);
        const fadeY = Math.min(1.0, Math.pow(edgeFadeY, 0.55) * 1.25);

        for (let x = 0; x < 512; x++) {
          const nx = (x / 511.0) * 2.0 - 1.0; // -1..+1 across tire width
          const absX = Math.abs(nx);
          const idx = (y * 512 + x) * 4;

          if (absX > 0.94) {
            d[idx + 3] = 0;
            continue;
          }

          // Raised displaced regolith berm along outer tire shoulders (absX in 0.72..0.92)
          const shoulderBerm = Math.exp(-Math.pow((absX - 0.78) / 0.085, 2.0));
          // Deep compressed tire trough inside (-0.72..+0.72)
          const troughMask = 1.0 - THREE.MathUtils.smoothstep(absX, 0.66, 0.82);

          // NASA Curiosity / Artemis zig-zag chevron grouser cleat ribs
          const chevronPhase = ny * 5.0 * Math.PI * 2.0 + absX * 2.35;
          const cleatWave = Math.sin(chevronPhase);
          const cleatShadow = Math.max(0.0, cleatWave);
          const cleatRidge = Math.max(0.0, -cleatWave);

          // Fine regolith grain noise inside the compressed track
          const grain =
            Math.sin(x * 12.9898 + y * 78.233) * 43758.5453 -
            Math.floor(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453);

          // Dark compressed trough + crisp dark cleat cavities + slightly brighter compressed ridges & berms
          const shadeBase =
            24 +
            cleatRidge * 38 * troughMask -
            cleatShadow * 16 * troughMask +
            shoulderBerm * 46 +
            (grain - 0.5) * 12;
          const v = Math.max(8, Math.min(130, Math.round(shadeBase)));

          const alphaProfile =
            (troughMask * (0.46 + 0.34 * cleatShadow + 0.14 * cleatRidge) + shoulderBerm * 0.38) *
            fadeY;

          d[idx + 0] = v;
          d[idx + 1] = v;
          d[idx + 2] = Math.min(255, v + 2);
          d[idx + 3] = Math.round(Math.max(0, Math.min(1, alphaProfile)) * 225);
        }
      }
      tCtx.putImageData(img, 0, 0);
    }
    const trackTex = new THREE.CanvasTexture(trackCanvas);
    trackTex.colorSpace = THREE.SRGBColorSpace;
    trackTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    trackTex.needsUpdate = true;

    const maxTrackDecals = 2000;
    const trackGeo = new THREE.PlaneGeometry(0.26, 0.42);
    trackGeo.rotateX(-Math.PI / 2);
    const trackMat = new THREE.MeshBasicMaterial({
      map: trackTex,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const trackInstanced = new THREE.InstancedMesh(trackGeo, trackMat, maxTrackDecals);
    trackInstanced.count = 0;
    trackInstanced.frustumCulled = false;
    scene.add(trackInstanced);
    let nextTrackIdx = 0;
    const trackDummy = new THREE.Object3D();
    const trackBasisMat = new THREE.Matrix4();
    const trackFwdVec = new THREE.Vector3();
    const trackRightVec = new THREE.Vector3();

    // Vacuum Ballistic Dust Spray (parabolic trajectories under g = 1.622 m/s², zero billowing clouds)
    const ballisticCount = 160;
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
      color: 0x8c8d91,
      size: 0.09,
      transparent: true,
      opacity: 0.75,
    });
    const ballisticPoints = new THREE.Points(ballisticGeo, ballisticMat);
    ballisticPoints.frustumCulled = false;
    scene.add(ballisticPoints);
    let nextBallisticIdx = 0;

    // =========================================================================
    // 4. LOAD 3D NASA CURIOSITY ROVER GLB & 6-WHEEL RAYCAST SUSPENSION RIG
    // =========================================================================
    const roverWorldRoot = new THREE.Group();
    const startY = terrainPipeline.sampleHeight(ROVER_SPAWN_X, ROVER_SPAWN_Z);
    roverWorldRoot.position.set(ROVER_SPAWN_X, startY, ROVER_SPAWN_Z);
    roverWorldRoot.rotation.y = ROVER_SPAWN_HEADING;
    scene.add(roverWorldRoot);

    const roverChassisGroup = new THREE.Group();
    roverWorldRoot.add(roverChassisGroup);

    // =========================================================================
    // 4B. INTEGRATED ROVER HEADLIGHT ASSEMBLIES (FRONT BULKHEAD & MASTCAM-Z)
    // =========================================================================
    // Create a crisp radial optical glare texture for the LED lenses (no atmospheric fog cone)
    const flareCanvas = document.createElement('canvas');
    flareCanvas.width = 128;
    flareCanvas.height = 128;
    const flareCtx = flareCanvas.getContext('2d');
    if (flareCtx) {
      const grad = flareCtx.createRadialGradient(64, 64, 2, 64, 64, 62);
      grad.addColorStop(0.0, 'rgba(255, 253, 245, 1.0)');
      grad.addColorStop(0.22, 'rgba(255, 244, 214, 0.85)');
      grad.addColorStop(0.55, 'rgba(255, 210, 140, 0.22)');
      grad.addColorStop(1.0, 'rgba(255, 180, 90, 0.0)');
      flareCtx.fillStyle = grad;
      flareCtx.fillRect(0, 0, 128, 128);
    }
    const flareTex = new THREE.CanvasTexture(flareCanvas);

    const lampHousingMat = new THREE.MeshStandardMaterial({
      color: 0x242830,
      roughness: 0.42,
      metalness: 0.84,
    });
    const lampKaptonMat = new THREE.MeshStandardMaterial({
      color: 0xc9933b,
      roughness: 0.35,
      metalness: 0.88,
    });
    const lampLensMat = new THREE.MeshBasicMaterial({
      color: 0xfffbeb,
    });

    const lensSprites: THREE.Sprite[] = [];
    const buildHeadlightPod = (isMastPod = false): THREE.Group => {
      const pod = new THREE.Group();
      const radius = isMastPod ? 0.048 : 0.056;
      const length = isMastPod ? 0.095 : 0.12;

      // Machined titanium cylindrical lamp barrel aligned along Z
      const barrelGeo = new THREE.CylinderGeometry(radius, radius * 0.88, length, 16);
      barrelGeo.rotateX(Math.PI / 2);
      const barrel = new THREE.Mesh(barrelGeo, lampHousingMat);
      pod.add(barrel);

      // Gold/Kapton thermal collar ring
      const collarGeo = new THREE.CylinderGeometry(radius * 1.04, radius * 1.04, length * 0.28, 16);
      collarGeo.rotateX(Math.PI / 2);
      const collar = new THREE.Mesh(collarGeo, lampKaptonMat);
      collar.position.z = length * 0.1;
      pod.add(collar);

      // Structural mounting strut bridging back into the rover bulkhead
      if (!isMastPod) {
        const strutGeo = new THREE.BoxGeometry(0.045, 0.045, 0.18);
        const strut = new THREE.Mesh(strutGeo, lampHousingMat);
        strut.position.set(0, -0.02, 0.08);
        pod.add(strut);
      }

      // High-luminance LED emitter lens on front face (-Z)
      const lensGeo = new THREE.CircleGeometry(radius * 0.82, 16);
      lensGeo.rotateY(Math.PI);
      const lens = new THREE.Mesh(lensGeo, lampLensMat);
      lens.position.z = -length * 0.5 - 0.002;
      pod.add(lens);

      // Optical lens star-glow sprite
      const spriteMat = new THREE.SpriteMaterial({
        map: flareTex,
        color: 0xfff6e0,
        transparent: true,
        opacity: 0.88,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(spriteMat);
      const flareScale = isMastPod ? 0.34 : 0.42;
      sprite.scale.set(flareScale, flareScale, 1);
      sprite.position.z = -length * 0.5 - 0.02;
      pod.add(sprite);
      lensSprites.push(sprite);

      return pod;
    };

    // 1. Left & Right Front Chassis LED Floodlight Pods (mounted flush on MER front electronics box)
    const leftHazPod = buildHeadlightPod(false);
    leftHazPod.position.set(-0.32, 0.65, -0.74);
    leftHazPod.rotation.x = -0.14;
    roverChassisGroup.add(leftHazPod);

    const rightHazPod = buildHeadlightPod(false);
    rightHazPod.position.set(0.32, 0.65, -0.74);
    rightHazPod.rotation.x = -0.14;
    roverChassisGroup.add(rightHazPod);

    // 2. Steerable Pancam Mast Optical High-Beam Pod (calibrated to MER Pancam head)
    const mastLampPivot = new THREE.Group();
    mastLampPivot.position.set(0.05, 1.77, -0.54);
    roverChassisGroup.add(mastLampPivot);

    const mastLightPod = buildHeadlightPod(true);
    mastLightPod.position.set(0, 0.04, -0.09);
    mastLightPod.rotation.x = -0.11;
    mastLampPivot.add(mastLightPod);

    // 3. Dual Front Chassis Flood SpotLights + Steerable MastCam High-Beam SpotLight
    const leftFloodLight = new THREE.SpotLight(0xfff8eb, 26.0, 78.0, Math.PI / 2.6, 0.65, 1.15);
    leftFloodLight.position.set(-0.32, 0.65, -0.79);
    leftFloodLight.target.position.set(-2.4, -1.35, -22.0);
    roverChassisGroup.add(leftFloodLight);
    roverChassisGroup.add(leftFloodLight.target);

    const rightFloodLight = new THREE.SpotLight(0xfff8eb, 26.0, 78.0, Math.PI / 2.6, 0.65, 1.15);
    rightFloodLight.position.set(0.32, 0.65, -0.79);
    rightFloodLight.target.position.set(2.4, -1.35, -22.0);
    roverChassisGroup.add(rightFloodLight);
    roverChassisGroup.add(rightFloodLight.target);

    const mastHighBeam = new THREE.SpotLight(0xffffff, 42.0, 135.0, Math.PI / 3.5, 0.55, 1.1);
    mastHighBeam.position.set(0, 0.04, -0.12);
    mastHighBeam.target.position.set(0, -2.1, -38.0);
    mastLampPivot.add(mastHighBeam);
    roverChassisGroup.add(mastHighBeam.target);

    // Subtle near-field bulkhead fill light so the rover's own front suspension & wheels catch headlight bounce
    const frontChassisFill = new THREE.PointLight(0xfff4e0, 2.2, 5.2, 1.4);
    frontChassisFill.position.set(0, 0.78, -1.02);
    roverChassisGroup.add(frontChassisFill);

    // =========================================================================
    // 4C. INTEGRATED FLAGPOLE & LUNA SHIFT EMBLEM FLAG ON ROVER DECK
    // =========================================================================
    const flagCanvas = document.createElement('canvas');
    flagCanvas.width = 1024;
    flagCanvas.height = 640;
    const fCtx = flagCanvas.getContext('2d');

    const drawLunaShiftFlag = (logoImg?: HTMLImageElement) => {
      if (!fCtx) return;

      // Deep Aerospace dark navy field with subtle ripstop weave
      const bgGrad = fCtx.createLinearGradient(0, 0, 1024, 640);
      bgGrad.addColorStop(0.0, '#04122d');
      bgGrad.addColorStop(0.5, '#082558');
      bgGrad.addColorStop(1.0, '#030d21');
      fCtx.fillStyle = bgGrad;
      fCtx.fillRect(0, 0, 1024, 640);

      // Subtle ripstop nylon grid texture
      fCtx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      fCtx.lineWidth = 1;
      for (let gx = 0; gx < 1024; gx += 16) {
        fCtx.beginPath();
        fCtx.moveTo(gx, 0);
        fCtx.lineTo(gx, 640);
        fCtx.stroke();
      }
      for (let gy = 0; gy < 640; gy += 16) {
        fCtx.beginPath();
        fCtx.moveTo(0, gy);
        fCtx.lineTo(1024, gy);
        fCtx.stroke();
      }

      // Outer white & red stitched hem border
      fCtx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      fCtx.lineWidth = 14;
      fCtx.strokeRect(18, 18, 988, 604);

      fCtx.strokeStyle = '#fc3d21';
      fCtx.lineWidth = 4;
      fCtx.strokeRect(32, 32, 960, 576);

      const cx = 512;
      const cy = 324;

      if (logoImg) {
        // Exact transparent-cutout LUNA SHIFT emblem bounds matching the launch badge
        const cropX = 68;
        const cropY = 103;
        const cropW = 1884;
        const cropH = 1782;
        const targetH = 420;
        const targetW = Math.round((cropW / cropH) * targetH);
        const targetX = Math.round(cx - targetW * 0.5);
        const targetY = Math.round(cy - targetH * 0.5);

        fCtx.save();
        fCtx.shadowColor = 'rgba(0, 0, 0, 0.65)';
        fCtx.shadowBlur = 16;
        fCtx.shadowOffsetY = 4;
        fCtx.drawImage(
          logoImg,
          cropX,
          cropY,
          cropW,
          cropH,
          targetX,
          targetY,
          targetW,
          targetH
        );
        fCtx.restore();
      }

      // Top & Bottom Mission Stenciling
      fCtx.textAlign = 'center';
      fCtx.textBaseline = 'middle';
      fCtx.fillStyle = 'rgba(255, 255, 255, 0.88)';
      fCtx.font = 'bold 22px monospace';
      fCtx.fillText('LUNA SHIFT // LUNAR SOUTH POLE MISSION', cx, 62);
      fCtx.fillStyle = '#ff9900';
      fCtx.font = 'bold 20px monospace';
      fCtx.fillText('CONNECTING RIDGE // SHACKLETON CRATER EXPEDITION', cx, 584);
    };

    drawLunaShiftFlag();

    const nasaFlagTex = new THREE.CanvasTexture(flagCanvas);
    nasaFlagTex.colorSpace = THREE.SRGBColorSpace;
    nasaFlagTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    nasaFlagTex.needsUpdate = true;

    const lunaFlagLogoImg = new Image();
    lunaFlagLogoImg.crossOrigin = 'anonymous';
    lunaFlagLogoImg.onload = () => {
      if (isDisposed) return;
      drawLunaShiftFlag(lunaFlagLogoImg);
      nasaFlagTex.needsUpdate = true;
    };
    lunaFlagLogoImg.src = LUNA_FLAG_LOGO_URL;

    // Mount the Flagpole Assembly flush on the rear-left solar deck of the MER rover
    const nasaFlagMount = new THREE.Group();
    nasaFlagMount.position.set(-0.37, 0.77, 0.68);
    roverChassisGroup.add(nasaFlagMount);

    // Machined deck socket & gold Kapton collar attaching the pole to the rover deck
    const socketGeo = new THREE.CylinderGeometry(0.036, 0.044, 0.09, 16);
    const socketMesh = new THREE.Mesh(socketGeo, lampHousingMat);
    socketMesh.position.y = 0.045;
    nasaFlagMount.add(socketMesh);

    const socketCollarGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.025, 16);
    const socketCollar = new THREE.Mesh(socketCollarGeo, lampKaptonMat);
    socketCollar.position.y = 0.08;
    nasaFlagMount.add(socketCollar);

    // Pivoting Flagpole Mast Group (sways subtly with rover acceleration & terrain pitch/roll)
    const nasaFlagPolePivot = new THREE.Group();
    nasaFlagPolePivot.position.y = 0.08;
    nasaFlagMount.add(nasaFlagPolePivot);

    const poleHeight = 0.78;
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0xd8dee9,
      roughness: 0.28,
      metalness: 0.88,
    });
    const poleGeo = new THREE.CylinderGeometry(0.011, 0.014, poleHeight, 12);
    const poleMesh = new THREE.Mesh(poleGeo, poleMat);
    poleMesh.position.y = poleHeight * 0.5;
    poleMesh.castShadow = true;
    nasaFlagPolePivot.add(poleMesh);

    // Gold Finial Sphere atop the flagpole
    const finialGeo = new THREE.SphereGeometry(0.022, 12, 12);
    const finialMesh = new THREE.Mesh(finialGeo, lampKaptonMat);
    finialMesh.position.y = poleHeight + 0.01;
    nasaFlagPolePivot.add(finialMesh);

    // Apollo-style horizontal telescoping top crossbar rod (holds flag taut in lunar vacuum)
    const flagWidth = 0.44;
    const flagHeight = 0.275;
    const crossbarGeo = new THREE.CylinderGeometry(0.006, 0.006, flagWidth + 0.02, 8);
    crossbarGeo.rotateX(Math.PI / 2);
    const crossbarMesh = new THREE.Mesh(crossbarGeo, poleMat);
    crossbarMesh.position.set(0, poleHeight - 0.01, flagWidth * 0.5 + 0.01);
    nasaFlagPolePivot.add(crossbarMesh);

    // 3D Ripstop NASA Flag Mesh with realistic Apollo vacuum crinkles
    const flagGeo = new THREE.PlaneGeometry(flagWidth, flagHeight, 18, 12);
    flagGeo.rotateY(Math.PI * 0.5); // Align along the +Z rearward trail axis so both sides are visible
    const flagPosAttr = flagGeo.attributes.position as THREE.BufferAttribute;
    const flagBaseX = new Float32Array(flagPosAttr.count);
    for (let i = 0; i < flagPosAttr.count; i++) {
      const fz = flagPosAttr.getZ(i); // 0..flagWidth along the horizontal rod
      const fy = flagPosAttr.getY(i);
      const normSpan = (fz + flagWidth * 0.5) / flagWidth;
      // Subtle static vacuum fabric crinkles (zero at pole edge, rippled along fabric)
      const crinkle =
        Math.sin(normSpan * 14.0 + fy * 18.0) * 0.009 * normSpan +
        Math.cos(normSpan * 7.5 - fy * 12.0) * 0.006 * normSpan;
      flagPosAttr.setX(i, crinkle);
      flagBaseX[i] = crinkle;
    }
    flagGeo.computeVertexNormals();

    const flagMat = new THREE.MeshStandardMaterial({
      map: nasaFlagTex,
      emissiveMap: nasaFlagTex,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.28, // Ensures the NASA logo remains vivid even in dark crater shadows
      roughness: 0.62,
      metalness: 0.08,
      side: THREE.DoubleSide,
    });
    const flagMesh = new THREE.Mesh(flagGeo, flagMat);
    flagMesh.position.set(0, poleHeight - flagHeight * 0.5 - 0.015, flagWidth * 0.5 + 0.012);
    flagMesh.castShadow = true;
    flagMesh.receiveShadow = true;
    nasaFlagPolePivot.add(flagMesh);

    // =========================================================================
    // 4D. FULL-SCALE NASA LUNAR FLAG ASSEMBLY BESIDE COREHAB (3x5 FT / 2.28M MAST)
    // =========================================================================
    const chCosInit = Math.cos(COREHAB_YAW);
    const chSinInit = Math.sin(COREHAB_YAW);
    const surfaceFlagLocalX = -4.55;
    const surfaceFlagLocalZ = 4.75;
    const surfaceFlagX = COREHAB_POS_X + surfaceFlagLocalX * chCosInit + surfaceFlagLocalZ * chSinInit;
    const surfaceFlagZ = COREHAB_POS_Z - surfaceFlagLocalX * chSinInit + surfaceFlagLocalZ * chCosInit;

    const surfaceFlagGroup = new THREE.Group();
    surfaceFlagGroup.position.set(
      surfaceFlagX,
      terrainPipeline.sampleHeight(surfaceFlagX, surfaceFlagZ),
      surfaceFlagZ
    );
    // Angle flag plane so its full 3x5 ft LUNA SHIFT banner faces the rover approach cleanly
    surfaceFlagGroup.rotation.y = Math.PI * 0.42;
    scene.add(surfaceFlagGroup);

    // Subtle disturbed regolith soil mound around driven mast base
    const flagMoundGeo = new THREE.CylinderGeometry(0.11, 0.30, 0.075, 16);
    const flagMoundMat = new THREE.MeshStandardMaterial({
      color: 0x5c5c60,
      roughness: 0.96,
      metalness: 0.02,
      envMapIntensity: 0.0,
    });
    const flagMound = new THREE.Mesh(flagMoundGeo, flagMoundMat);
    flagMound.position.y = 0.035;
    flagMound.receiveShadow = true;
    flagMound.castShadow = true;
    surfaceFlagGroup.add(flagMound);

    // Lower driven telescoping ground sleeve + locking collar clamp (~2.28m exposed total pole)
    const lfaSleeveH = 0.48;
    const lfaSleeveGeo = new THREE.CylinderGeometry(0.022, 0.024, lfaSleeveH, 14);
    const lfaSleeve = new THREE.Mesh(lfaSleeveGeo, poleMat);
    lfaSleeve.position.y = lfaSleeveH * 0.5;
    lfaSleeve.castShadow = true;
    lfaSleeve.receiveShadow = true;
    surfaceFlagGroup.add(lfaSleeve);

    const lfaClampGeo = new THREE.CylinderGeometry(0.030, 0.030, 0.055, 16);
    const lfaClamp = new THREE.Mesh(lfaClampGeo, lampKaptonMat);
    lfaClamp.position.y = lfaSleeveH;
    lfaClamp.castShadow = true;
    surfaceFlagGroup.add(lfaClamp);

    // Upper anodized telescoping mast (NASA Apollo LFA ~2.28m / 7.5 ft exposed above regolith)
    const lfaPoleH = 2.28;
    const lfaMastGeo = new THREE.CylinderGeometry(0.016, 0.018, lfaPoleH - lfaSleeveH, 14);
    const lfaMast = new THREE.Mesh(lfaMastGeo, poleMat);
    lfaMast.position.y = lfaSleeveH + (lfaPoleH - lfaSleeveH) * 0.5;
    lfaMast.castShadow = true;
    lfaMast.receiveShadow = true;
    surfaceFlagGroup.add(lfaMast);

    const lfaFinialGeo = new THREE.SphereGeometry(0.032, 14, 14);
    const lfaFinial = new THREE.Mesh(lfaFinialGeo, lampKaptonMat);
    lfaFinial.position.y = lfaPoleH + 0.018;
    lfaFinial.castShadow = true;
    surfaceFlagGroup.add(lfaFinial);

    // Authentic NASA 3 x 5 ft lunar surface flag dimensions (0.914m H x 1.524m W)
    const lfaFlagW = 1.524;
    const lfaFlagH = 0.914;
    const lfaCrossbarGeo = new THREE.CylinderGeometry(0.010, 0.010, lfaFlagW + 0.04, 10);
    lfaCrossbarGeo.rotateX(Math.PI / 2);
    const lfaCrossbar = new THREE.Mesh(lfaCrossbarGeo, poleMat);
    lfaCrossbar.position.set(0, lfaPoleH - 0.015, lfaFlagW * 0.5 + 0.02);
    lfaCrossbar.castShadow = true;
    surfaceFlagGroup.add(lfaCrossbar);

    const lfaEndCapGeo = new THREE.SphereGeometry(0.016, 10, 10);
    const lfaEndCap = new THREE.Mesh(lfaEndCapGeo, lampKaptonMat);
    lfaEndCap.position.set(0, lfaPoleH - 0.015, lfaFlagW + 0.042);
    surfaceFlagGroup.add(lfaEndCap);

    // 3D Ripstop LUNA SHIFT Lunar Surface Flag with static frozen Apollo vacuum crinkles
    const lfaFlagGeo = new THREE.PlaneGeometry(lfaFlagW, lfaFlagH, 28, 16);
    lfaFlagGeo.rotateY(Math.PI * 0.5);
    const lfaPosAttr = lfaFlagGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < lfaPosAttr.count; i++) {
      const fz = lfaPosAttr.getZ(i);
      const fy = lfaPosAttr.getY(i);
      const normSpan = (fz + lfaFlagW * 0.5) / lfaFlagW;
      const crinkle =
        Math.sin(normSpan * 11.5 + fy * 7.2) * 0.032 * normSpan +
        Math.cos(normSpan * 5.8 - fy * 4.5) * 0.022 * normSpan;
      lfaPosAttr.setX(i, crinkle);
    }
    lfaFlagGeo.computeVertexNormals();

    const lfaFlagMesh = new THREE.Mesh(lfaFlagGeo, flagMat);
    lfaFlagMesh.position.set(0, lfaPoleH - lfaFlagH * 0.5 - 0.024, lfaFlagW * 0.5 + 0.022);
    lfaFlagMesh.castShadow = true;
    lfaFlagMesh.receiveShadow = true;
    surfaceFlagGroup.add(lfaFlagMesh);

    const rig: CuriosityRig = {
      leftWheels: [],
      rightWheels: [],
      frontSteer: [],
      rearSteer: [],
      leftSuspension: [],
      rightSuspension: [],
      mastHead: null,
    };

    let roverModelScale = 0.76;

    const gltfLoader = new GLTFLoader();
    gltfLoader.load(
      ROVER_GLB_URL,
      (gltf) => {
        const model = gltf.scene;

        // Lock animation at t = 6.5s with LoopOnce + clampWhenFinished so all 6 wheels are
        // deployed level on the ground (avoiding LoopRepeat wrap-around to t=0 stowed sky-crane pose)
        if (gltf.animations && gltf.animations.length > 0) {
          const mixer = new THREE.AnimationMixer(model);
          const clip = gltf.animations[0];
          const action = mixer.clipAction(clip);
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
          action.play();
          mixer.setTime(Math.min(6.5, clip.duration * 0.45));
          mixer.update(0);
        }

        // Align Front (Pancam Mast & IDD Arm) to face -Z (North toward Shackleton Crater & Earth)
        model.rotation.y = Math.PI;
        model.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);

        // Balanced Lunar-Class MER rover wingspan (~2.65m wide across solar array)
        const maxDim = Math.max(size.x, size.y, size.z, 0.001);
        const targetSpan = 2.65;
        const scale = targetSpan / maxDim;
        roverModelScale = scale;
        model.scale.setScalar(scale);

        model.updateMatrixWorld(true);
        const scaledBox = new THREE.Box3().setFromObject(model);
        const scaledCenter = new THREE.Vector3();
        scaledBox.getCenter(scaledCenter);

        model.position.x -= scaledCenter.x;
        model.position.z -= scaledCenter.z;
        model.updateMatrixWorld(true);

        // Calibrate vertical grounding (y = 0) from rigged tire nodes if present, else mesh min.y
        const wheelNamesOrdered = [
          'wheel_01_L',
          'wheel_02_L',
          'wheel_03_L',
          'wheel_01_R',
          'wheel_02_R',
          'wheel_03_R',
        ];
        let wheelTreadMinY = Infinity;
        for (const wn of wheelNamesOrdered) {
          const wObj = model.getObjectByName(wn);
          if (wObj) {
            const wb = new THREE.Box3().setFromObject(wObj);
            if (wb.min.y < wheelTreadMinY) wheelTreadMinY = wb.min.y;
          }
        }
        model.position.y -= Number.isFinite(wheelTreadMinY) ? wheelTreadMinY : scaledBox.min.y;
        model.updateMatrixWorld(true);

        // Populate exact 6-wheel contact offsets from rigged nodes or MER's calibrated tire footprint
        let hasNamedWheels = false;
        for (let idx = 0; idx < wheelNamesOrdered.length; idx++) {
          const wObj = model.getObjectByName(wheelNamesOrdered[idx]);
          if (wObj) {
            hasNamedWheels = true;
            const wb = new THREE.Box3().setFromObject(wObj);
            const wc = new THREE.Vector3();
            wb.getCenter(wc);
            wheelLocalOffsets[idx].set(wc.x, 0, wc.z);
          }
        }
        if (!hasNamedWheels) {
          const merRawWheels = [
            new THREE.Vector3(0.509, 0, 0.606),   // 0: FL
            new THREE.Vector3(0.455, 0, -0.102),  // 1: ML
            new THREE.Vector3(0.511, 0, -0.599),  // 2: RL
            new THREE.Vector3(-0.509, 0, 0.606),  // 3: FR
            new THREE.Vector3(-0.455, 0, -0.102), // 4: MR
            new THREE.Vector3(-0.511, 0, -0.599), // 5: RR
          ];
          for (let idx = 0; idx < merRawWheels.length; idx++) {
            const p = merRawWheels[idx].applyMatrix4(model.matrix);
            wheelLocalOffsets[idx].set(p.x, 0, p.z);
          }
        }

        const leftWheelMap: Record<string, RiggedPart> = {};
        const rightWheelMap: Record<string, RiggedPart> = {};

        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            mats.forEach((m) => {
              if (m && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
                const std = m as THREE.MeshStandardMaterial;
                std.roughness = Math.min(0.85, Math.max(0.2, std.roughness * 0.9));
                std.metalness = Math.min(0.92, std.metalness + 0.08);
                std.needsUpdate = true;
              }
            });
          }

          const n = child.name;
          const part: RiggedPart = {
            obj: child,
            baseQuat: child.quaternion.clone(),
            basePos: child.position.clone(),
          };
          if (n === 'wheel_01_L' || n === 'wheel_02_L' || n === 'wheel_03_L') {
            leftWheelMap[n] = part;
          } else if (n === 'wheel_01_R' || n === 'wheel_02_R' || n === 'wheel_03_R') {
            rightWheelMap[n] = part;
          } else if (n === 'suspension_steer_F_L' || n === 'suspension_steer_F_R') {
            rig.frontSteer.push(part);
          } else if (n === 'suspension_steer_B_L' || n === 'suspension_steer_B_R') {
            rig.rearSteer.push(part);
          } else if (n === 'suspension_arm_B2_L') {
            rig.leftSuspension.push(part);
          } else if (n === 'suspension_arm_B2_R') {
            rig.rightSuspension.push(part);
          } else if (n === 'mast_02.001') {
            rig.mastHead = part;
          }
        });

        // Preserve strict Front -> Mid -> Rear ordering for per-wheel ground height clamping
        rig.leftWheels = ['wheel_01_L', 'wheel_02_L', 'wheel_03_L']
          .map((n) => leftWheelMap[n])
          .filter(Boolean);
        rig.rightWheels = ['wheel_01_R', 'wheel_02_R', 'wheel_03_R']
          .map((n) => rightWheelMap[n])
          .filter(Boolean);

        roverChassisGroup.add(model);
        roverWorldRoot.updateMatrixWorld(true);

        // Snap the optical spotlight pivot to MastCam if present, otherwise calibrated MER Pancam head
        const mastCamObj = model.getObjectByName('MastCam') || rig.mastHead?.obj;
        if (mastCamObj) {
          const mastBox = new THREE.Box3().setFromObject(mastCamObj);
          const mastCenterWorld = new THREE.Vector3();
          mastBox.getCenter(mastCenterWorld);
          roverChassisGroup.worldToLocal(mastCenterWorld);
          mastLampPivot.position.copy(mastCenterWorld);
        } else {
          const merPancamLocal = new THREE.Vector3(-0.045, 1.522, 0.377).applyMatrix4(model.matrix);
          mastLampPivot.position.copy(merPancamLocal);
        }

        // Pre-compile both Surface & Orbital Moon shaders on the GPU so transitions have zero stutter
        orbitalMoonGroup.visible = true;
        renderer.compile(scene, camera);
        orbitalMoonGroup.visible = false;
        renderer.shadowMap.needsUpdate = true;

        setSceneReady(true);
      },
      undefined,
      () => {
        setSceneReady(true);
      }
    );

    // =========================================================================
    // 5. CAMERA ORBIT / POINTER INTERACTION & KEYBOARD CONTROLS
    // =========================================================================
    let isPointerDragging = false;
    let prevPointerX = 0;
    let prevPointerY = 0;
    // Unified Chase + Orbit camera defaults starting at the close-up hero angle before 4.4s pan-out
    let orbitYaw = ROVER_INTRO_ORBIT_YAW;
    let orbitPitch = ROVER_INTRO_ORBIT_PITCH;
    let orbitDist = ROVER_INTRO_ORBIT_DIST;
    let introPhase: 'IDLE' | 'HOLD' | 'PAN_OUT' | 'DONE' = 'IDLE';
    let introHoldTimer = 0;
    let introPanTimer = 0;

    // Orbital Full-Moon Space View camera state (enters directly in paused 3-body framing)
    let moonTransition = 1.0;
    let moonOrbitYaw = -0.465;
    let moonOrbitPitch = 0.06;
    let moonOrbitDist = 4560.0;
    const pointerLook = { x: 0, y: 0 };

    const handlePointerDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement)?.closest('button, input, [data-hud-interactive]')) return;
      if (!moonOverviewActiveRef.current && !surfaceControlsReadyRef.current) return;
      orbitalResetPendingRef.current = false;
      isPointerDragging = true;
      prevPointerX = e.clientX;
      prevPointerY = e.clientY;
    };

    const handlePointerMove = (e: PointerEvent) => {
      const nx = (e.clientX / Math.max(window.innerWidth, 1)) * 2 - 1;
      const ny = (e.clientY / Math.max(window.innerHeight, 1)) * 2 - 1;
      pointerLook.x = nx;
      pointerLook.y = -ny;

      if (isPointerDragging) {
        const dx = e.clientX - prevPointerX;
        const dy = e.clientY - prevPointerY;
        prevPointerX = e.clientX;
        prevPointerY = e.clientY;

        if (moonOverviewActiveRef.current) {
          moonOrbitYaw -= dx * 0.0065;
          moonOrbitPitch = THREE.MathUtils.clamp(moonOrbitPitch + dy * 0.0055, -1.46, 1.46);
        } else if (surfaceControlsReadyRef.current) {
          introPhase = 'DONE';
          orbitYaw -= dx * 0.0065;
          orbitPitch = THREE.MathUtils.clamp(orbitPitch + dy * 0.0055, 0.06, 1.35);
        }
      }
    };

    const handlePointerUp = () => {
      isPointerDragging = false;
    };

    const handleWheel = (e: WheelEvent) => {
      if (moonOverviewActiveRef.current) {
        orbitalResetPendingRef.current = false;
        moonOrbitDist = THREE.MathUtils.clamp(
          moonOrbitDist * Math.exp(e.deltaY * 0.0011),
          580.0,
          7200.0
        );
      } else if (surfaceControlsReadyRef.current) {
        introPhase = 'DONE';
        orbitDist = THREE.MathUtils.clamp(orbitDist + e.deltaY * 0.006, 2.6, 24.0);
      }
    };

    const mapKeyToDir = (key: string): DirectionKey | null => {
      const k = key.toLowerCase();
      if (k === 'arrowup' || k === 'w') return 'up';
      if (k === 'arrowdown' || k === 's') return 'down';
      if (k === 'arrowleft' || k === 'a') return 'left';
      if (k === 'arrowright' || k === 'd') return 'right';
      return null;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const dir = mapKeyToDir(e.key);
      if (dir) {
        e.preventDefault();
        if (surfaceControlsReadyRef.current) {
          setDirectionActive(dir, true);
        }
        return;
      }
      if (e.key.toLowerCase() === 'l') {
        handleCycleHeadlights();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const dir = mapKeyToDir(e.key);
      if (dir) {
        e.preventDefault();
        setDirectionActive(dir, false);
      }
    };

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('wheel', handleWheel, { passive: true });
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('resize', handleResize);

    // =========================================================================
    // 6. SIX-WHEEL RAYCAST SUSPENSION & LUNAR GRAVITY (1.622 m/s²) SIMULATION
    // =========================================================================
    // 6 wheel local offsets relative to rover center (calibrated to deployed MER GLB wheel centers)
    const wheelLocalOffsets = [
      new THREE.Vector3(-0.592, 0, -0.806), // 0: FL
      new THREE.Vector3(-0.529, 0, 0.018),  // 1: ML
      new THREE.Vector3(-0.594, 0, 0.595),  // 2: RL
      new THREE.Vector3(0.592, 0, -0.806),  // 3: FR
      new THREE.Vector3(0.529, 0, 0.018),   // 4: MR
      new THREE.Vector3(0.594, 0, 0.595),   // 5: RR
    ];
    const wheelWorldPositions = wheelLocalOffsets.map(() => new THREE.Vector3());
    const wheelGroundHeights = new Float32Array(6);
    const wheelSuspOffsets = new Float32Array(6);

    let roverX = ROVER_SPAWN_X;
    let roverZ = ROVER_SPAWN_Z;
    let roverY = startY;
    let verticalVel = 0;
    let heading = ROVER_SPAWN_HEADING;
    let forwardSpeed = 0; // m/s
    let steerInputSmoothed = 0;
    let chassisPitch = 0;
    let chassisRoll = 0;
    let leftWheelSpin = 0;
    let rightWheelSpin = 0;
    let distanceSinceLastDecal = 0;
    let telemetryTimer = 0;
    let overviewEvalTimer = 0;
    let lastOverviewKey = '';
    let lastClockKey = '';

    const initTotalYaw = ROVER_SPAWN_HEADING + ROVER_SPAWN_ORBIT_YAW;
    const initFwdX = -Math.sin(ROVER_SPAWN_HEADING);
    const initFwdZ = -Math.cos(ROVER_SPAWN_HEADING);
    const chaseCamPos = new THREE.Vector3(
      ROVER_SPAWN_X + ROVER_SPAWN_ORBIT_DIST * Math.cos(ROVER_SPAWN_ORBIT_PITCH) * Math.sin(initTotalYaw),
      startY + 0.45 + ROVER_SPAWN_ORBIT_DIST * Math.sin(ROVER_SPAWN_ORBIT_PITCH),
      ROVER_SPAWN_Z + ROVER_SPAWN_ORBIT_DIST * Math.cos(ROVER_SPAWN_ORBIT_PITCH) * Math.cos(initTotalYaw)
    );
    const chaseCamLook = new THREE.Vector3(
      ROVER_SPAWN_X + initFwdX * 1.8,
      startY + 1.48,
      ROVER_SPAWN_Z + initFwdZ * 1.8
    );
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
    let lastShadowSunPhase = 0;

    let flagSwayAngleX = 0;
    let flagSwayAngleZ = 0;
    let flagSwayVelX = 0;
    let flagSwayVelZ = 0;

    const qSpinX = new THREE.Quaternion();
    const qSteerZ = new THREE.Quaternion();
    const qSuspX = new THREE.Quaternion();
    const axisX = new THREE.Vector3(1, 0, 0);
    const axisZ = new THREE.Vector3(0, 0, 1);

    const clock = new THREE.Clock();
    let frameId = 0;
    let warmupFramesRemaining = 3;
    let lastShadowRoverX = -9999;
    let lastShadowRoverZ = -9999;
    let lastShadowHeading = -9999;
    let wasTerrainHidden = false;
    let lastTelemetryKey = '';

    const tick = () => {
      // Pause heavy 3D lunar rendering while the Launch screen is active (after initial GPU warmup frames)
      if (document.hidden || (!activeRef.current && warmupFramesRemaining <= 0)) {
        clock.getDelta();
        frameId = requestAnimationFrame(tick);
        return;
      }
      if (warmupFramesRemaining > 0) {
        warmupFramesRemaining--;
      }

      const dt = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.getElapsedTime();

      const dirs = activeDirsRef.current;
      const controlsEnabled = surfaceControlsReadyRef.current && !moonOverviewActiveRef.current;
      const throttleCmd = controlsEnabled ? (dirs.up ? 1 : 0) - (dirs.down ? 0.75 : 0) : 0;
      const turnCmd = controlsEnabled ? (dirs.right ? 1 : 0) - (dirs.left ? 1 : 0) : 0;

      // Sample terrain at current rover center for slope & regolith traction physics
      const centerSample = terrainPipeline.sampleTerrain(roverX, roverZ);
      const cosH = Math.cos(heading);
      const sinH = Math.sin(heading);
      const forwardDirX = -sinH;
      const forwardDirZ = -cosH;
      const rightDirX = cosH;
      const rightDirZ = -sinH;

      // 1. Pre-sample terrain under current wheel positions for slope/traction physics
      for (let i = 0; i < 6; i++) {
        const off = wheelLocalOffsets[i];
        const wx = roverX + off.x * rightDirX - off.z * forwardDirX;
        const wz = roverZ + off.x * rightDirZ - off.z * forwardDirZ;
        wheelGroundHeights[i] = terrainPipeline.sampleHeight(wx, wz);
      }

      const frontAvgPre = (wheelGroundHeights[0] + wheelGroundHeights[3]) * 0.5;
      const rearAvgPre = (wheelGroundHeights[2] + wheelGroundHeights[5]) * 0.5;
      const wheelBaseSpan = Math.max(0.5, wheelLocalOffsets[2].z - wheelLocalOffsets[0].z);
      const prePitch = Math.atan2(frontAvgPre - rearAvgPre, wheelBaseSpan);

      // Game-tuned traction & high-torque 6WD climbing on steep lunar ridges
      const uphillGrade = Math.sin(prePitch);
      const slopePenalty = uphillGrade > 0.12 ? Math.max(0.82, 1.0 - (uphillGrade - 0.12) * 0.35) : 1.0;
      const slipRatio = THREE.MathUtils.clamp(
        (centerSample.slopeDeg / 32.0) * centerSample.regolithLooseFactor * (0.35 + Math.abs(throttleCmd) * 0.65),
        0,
        0.88
      );

      // +15% faster 6WD lunar drive (5.82 m/s) with responsive hill-climb torque & anti-rollback hold
      const maxSpeedMs = 5.82 * slopePenalty;
      const targetSpeed = throttleCmd * maxSpeedMs * (1.0 - slipRatio * 0.12);
      const slopeGravityPull = throttleCmd !== 0 ? 0 : -uphillGrade * LUNAR_GRAVITY * 0.12;
      forwardSpeed = THREE.MathUtils.damp(
        throttleCmd === 0 && Math.abs(forwardSpeed) < 0.08 ? 0 : forwardSpeed + slopeGravityPull * dt,
        targetSpeed,
        throttleCmd !== 0 ? 3.2 : 4.0,
        dt
      );

      steerInputSmoothed = THREE.MathUtils.damp(steerInputSmoothed, turnCmd, 4.8, dt);

      // Differential & Ackermann steering rate
      const turnDir = forwardSpeed < -0.1 ? -1 : 1;
      const yawRate =
        -steerInputSmoothed *
        0.58 *
        (0.45 + 0.55 * Math.min(1, Math.abs(forwardSpeed) / 2.5)) *
        turnDir;
      heading += yawRate * dt;

      // Advance Rover Position within the 3 km x 3 km playable Shackleton region
      const stepDist = forwardSpeed * dt;
      const cosHNext = Math.cos(heading);
      const sinHNext = Math.sin(heading);
      const fwdX = -sinHNext;
      const fwdZ = -cosHNext;
      const rgtX = cosHNext;
      const rgtZ = -sinHNext;

      let nextX = THREE.MathUtils.clamp(roverX + fwdX * stepDist, -1420, 1420);
      let nextZ = THREE.MathUtils.clamp(roverZ + fwdZ * stepDist, -1420, 1420);

      // Physical Boulder Collision Pushback
      for (let i = 0; i < terrainPipeline.boulders.length; i++) {
        const b = terrainPipeline.boulders[i];
        const dx = nextX - b.x;
        const dz = nextZ - b.z;
        const minDist = b.radius + 1.35;
        const dSq = dx * dx + dz * dz;
        if (dSq < minDist * minDist && dSq > 0.0001) {
          const d = Math.sqrt(dSq);
          const push = (minDist - d) / d;
          nextX += dx * push;
          nextZ += dz * push;
          forwardSpeed *= 0.65;
        }
      }

      // Oriented Bounding-Box (OBB) Collision Pushback against CoreHab Surface Habitat
      const chCos = Math.cos(COREHAB_YAW);
      const chSin = Math.sin(COREHAB_YAW);
      const chDx = nextX - COREHAB_POS_X;
      const chDz = nextZ - COREHAB_POS_Z;
      const localX = chDx * chCos - chDz * chSin;
      const localZ = chDx * chSin + chDz * chCos;
      const colHalfX = coreHab.colliderHalfExtents.halfWidthX + 1.45;
      const colHalfZ = coreHab.colliderHalfExtents.halfLengthZ + 1.45;
      if (Math.abs(localX) < colHalfX && Math.abs(localZ) < colHalfZ) {
        const penX = colHalfX - Math.abs(localX);
        const penZ = colHalfZ - Math.abs(localZ);
        let pushLx = 0;
        let pushLz = 0;
        if (penX < penZ) {
          pushLx = localX >= 0 ? penX : -penX;
        } else {
          pushLz = localZ >= 0 ? penZ : -penZ;
        }
        nextX += pushLx * chCos + pushLz * chSin;
        nextZ += -pushLx * chSin + pushLz * chCos;
        forwardSpeed *= 0.5;
      }

      // Physical Collision Pushback against Surface Flag Mast beside CoreHab
      const flDx = nextX - surfaceFlagX;
      const flDz = nextZ - surfaceFlagZ;
      const flMinDist = 1.55;
      const flDSq = flDx * flDx + flDz * flDz;
      if (flDSq < flMinDist * flMinDist && flDSq > 0.0001) {
        const flD = Math.sqrt(flDSq);
        const push = (flMinDist - flD) / flD;
        nextX += flDx * push;
        nextZ += flDz * push;
        forwardSpeed *= 0.6;
      }

      roverX = nextX;
      roverZ = nextZ;

      // 2. Sample exact terrain heights under all 6 wheels at the updated rover position
      for (let i = 0; i < 6; i++) {
        const off = wheelLocalOffsets[i];
        const wx = roverX + off.x * rgtX - off.z * fwdX;
        const wz = roverZ + off.x * rgtZ - off.z * fwdZ;
        const wh = terrainPipeline.sampleHeight(wx, wz);
        wheelWorldPositions[i].set(wx, wh, wz);
        wheelGroundHeights[i] = wh;
      }

      // Compute exact right-handed 3D pitch & roll from the 6 wheel ground contact heights
      // Note: In Three.js right-handed basis (+X Right, +Y Up, -Z Forward):
      // - Positive rotation.x (pitch) lifts Front (-Z) UP and lowers Rear (+Z) DOWN.
      // - Positive rotation.z (roll) lifts Right (+X) UP and lowers Left (-X) DOWN.
      const frontAvg = (wheelGroundHeights[0] + wheelGroundHeights[3]) * 0.5;
      const rearAvg = (wheelGroundHeights[2] + wheelGroundHeights[5]) * 0.5;
      const leftAvg = (wheelGroundHeights[0] + wheelGroundHeights[1] + wheelGroundHeights[2]) / 3.0;
      const rightAvg = (wheelGroundHeights[3] + wheelGroundHeights[4] + wheelGroundHeights[5]) / 3.0;

      const trackWidthSpan = Math.max(0.5, wheelLocalOffsets[3].x - wheelLocalOffsets[0].x);
      const targetPitch = Math.atan2(frontAvg - rearAvg, wheelBaseSpan);
      const targetRoll = Math.atan2(rightAvg - leftAvg, trackWidthSpan);

      // Smooth chassis pitch (including subtle acceleration squat) and roll
      const accelTorquePitch = (targetSpeed - forwardSpeed) * 0.012;
      chassisPitch = THREE.MathUtils.damp(chassisPitch, targetPitch + accelTorquePitch, 8.5, dt);
      chassisRoll = THREE.MathUtils.damp(chassisRoll, targetRoll, 8.5, dt);

      // Compute the required roverWorldRoot Y so the tilted chassis plane supports all 6 wheels
      // At local wheel offset (x_i, 0, z_i), tilted height delta is: dy_i = -z_i * sin(pitch) + x_i * sin(roll)
      const sinP = Math.sin(chassisPitch);
      const sinR = Math.sin(chassisRoll);
      let sumReqY = 0;
      let maxReqY = -Infinity;
      for (let i = 0; i < 6; i++) {
        const off = wheelLocalOffsets[i];
        const reqY = wheelGroundHeights[i] + off.z * sinP - off.x * sinR;
        sumReqY += reqY;
        if (reqY > maxReqY) maxReqY = reqY;
      }
      const avgReqY = sumReqY / 6.0;
      // Blend average plane and upper contact envelope so convex ridges never bury middle wheels
      const targetGroundY = avgReqY * 0.55 + maxReqY * 0.45 + 0.008;

      // Vertical Lunar Gravity (1.622 m/s²) & Spring-Damper Suspension Heave (zero underground sag)
      const springStiffness = 36.0;
      const springDamping = 9.5;
      const dispY = targetGroundY - roverY;
      if (roverY <= targetGroundY + 0.05) {
        const springForce = dispY * springStiffness - verticalVel * springDamping;
        verticalVel += springForce * dt;
        roverY += verticalVel * dt;
        if (roverY < avgReqY - 0.015) {
          roverY = avgReqY - 0.015;
          verticalVel = Math.max(0, verticalVel);
        }
      } else {
        // Low-gravity lunar airborne phase over sharp crater crests (g = 1.622 m/s²)
        verticalVel -= LUNAR_GRAVITY * dt;
        roverY += verticalVel * dt;
        if (roverY < targetGroundY) {
          roverY = targetGroundY;
          verticalVel = Math.max(0, verticalVel * -0.15);
        }
      }

      roverWorldRoot.position.set(roverX, roverY, roverZ);
      roverWorldRoot.rotation.order = 'YXZ';
      roverWorldRoot.rotation.y = heading;
      roverWorldRoot.rotation.x = chassisPitch;
      roverWorldRoot.rotation.z = chassisRoll;

      // Spin Earth & Sun on their polar axes while orbiting both around the stationary Moon
      const orbitSpinMult = orbitalPausedRef.current
        ? 0.0
        : 1.0 + Math.log10(Math.max(1, orbitalSpeedRef.current)) * 3.8;
      if (orbitSpinMult > 0.0) {
        earthOrbitPhase += dt * 0.042 * orbitSpinMult;
        sunOrbitPhase += dt * 0.026 * orbitSpinMult;

        tmpOrbitVec.copy(earthBaseOrbitOffset).applyAxisAngle(orbitUpAxis, earthOrbitPhase);
        earthAnchorGroup.position.copy(orbitalMoonCenter).add(tmpOrbitVec);

        tmpOrbitVec.copy(sunBaseOrbitOffset).applyAxisAngle(orbitUpAxis, sunOrbitPhase);
        sunAnchorGroup.position.copy(orbitalMoonCenter).add(tmpOrbitVec);

        sunDirNormalized.copy(sunAnchorGroup.position).sub(orbitalMoonCenter).normalize();
      }
      earthSpinGroup.rotation.y += dt * 0.055 * orbitSpinMult;
      sunSpinGroup.rotation.y += dt * 0.032 * orbitSpinMult;

      // Update Sun Shadow Camera to tightly follow the Rover across the 3 km x 3 km terrain
      sunLight.target.position.set(roverX, roverY, roverZ);
      sunLight.position
        .copy(sunDirNormalized)
        .multiplyScalar(110.0)
        .add(sunLight.target.position);

      // =======================================================================
      // ARTICULATE 6-WHEEL RIG, PER-WHEEL GROUND CONTACT & ROCKER-BOGIE ARMS
      // =======================================================================
      const wheelAngularVel = forwardSpeed * 2.35 * (1.0 + slipRatio * 0.6);
      leftWheelSpin -= (wheelAngularVel - yawRate * 1.15) * dt;
      rightWheelSpin -= (wheelAngularVel + yawRate * 1.15) * dt;

      const invScale = 1.0 / Math.max(roverModelScale, 0.001);

      qSpinX.setFromAxisAngle(axisX, leftWheelSpin);
      for (let i = 0; i < rig.leftWheels.length; i++) {
        const w = rig.leftWheels[i];
        w.obj.quaternion.copy(w.baseQuat).multiply(qSpinX);

        // Per-wheel vertical terrain clamping so left tires (0, 1, 2) sit flush on curved slopes
        const off = wheelLocalOffsets[i];
        const wheelPlaneY = roverY - off.z * sinP + off.x * sinR;
        const deltaH = THREE.MathUtils.clamp(wheelGroundHeights[i] - wheelPlaneY + 0.006, -0.18, 0.22);
        wheelSuspOffsets[i] = THREE.MathUtils.damp(wheelSuspOffsets[i], deltaH, 16.0, dt);
        w.obj.position.set(
          w.basePos.x,
          w.basePos.y,
          w.basePos.z + wheelSuspOffsets[i] * invScale
        );
      }

      qSpinX.setFromAxisAngle(axisX, rightWheelSpin);
      for (let i = 0; i < rig.rightWheels.length; i++) {
        const w = rig.rightWheels[i];
        w.obj.quaternion.copy(w.baseQuat).multiply(qSpinX);

        // Per-wheel vertical terrain clamping so right tires (3, 4, 5) sit flush on curved slopes
        const wi = i + 3;
        const off = wheelLocalOffsets[wi];
        const wheelPlaneY = roverY - off.z * sinP + off.x * sinR;
        const deltaH = THREE.MathUtils.clamp(wheelGroundHeights[wi] - wheelPlaneY + 0.006, -0.18, 0.22);
        wheelSuspOffsets[wi] = THREE.MathUtils.damp(wheelSuspOffsets[wi], deltaH, 16.0, dt);
        w.obj.position.set(
          w.basePos.x,
          w.basePos.y,
          w.basePos.z + wheelSuspOffsets[wi] * invScale
        );
      }

      // 4-Corner Steering Knuckles
      const frontSteerAngle = -steerInputSmoothed * 0.42;
      qSteerZ.setFromAxisAngle(axisZ, frontSteerAngle);
      for (let i = 0; i < rig.frontSteer.length; i++) {
        const s = rig.frontSteer[i];
        s.obj.quaternion.copy(s.baseQuat).multiply(qSteerZ);
      }

      const rearSteerAngle = steerInputSmoothed * 0.34;
      qSteerZ.setFromAxisAngle(axisZ, rearSteerAngle);
      for (let i = 0; i < rig.rearSteer.length; i++) {
        const s = rig.rearSteer[i];
        s.obj.quaternion.copy(s.baseQuat).multiply(qSteerZ);
      }

      // Subtle Rear Rocker-Bogie Differential Articulation (suspension_arm_B2_L / R)
      const leftBogieDiff = THREE.MathUtils.clamp((wheelSuspOffsets[2] - wheelSuspOffsets[1]) * 0.35, -0.10, 0.10);
      qSuspX.setFromAxisAngle(axisX, leftBogieDiff);
      for (let i = 0; i < rig.leftSuspension.length; i++) {
        const arm = rig.leftSuspension[i];
        arm.obj.quaternion.copy(arm.baseQuat).multiply(qSuspX);
      }

      const rightBogieDiff = THREE.MathUtils.clamp((wheelSuspOffsets[5] - wheelSuspOffsets[4]) * 0.35, -0.10, 0.10);
      qSuspX.setFromAxisAngle(axisX, rightBogieDiff);
      for (let i = 0; i < rig.rightSuspension.length; i++) {
        const arm = rig.rightSuspension[i];
        arm.obj.quaternion.copy(arm.baseQuat).multiply(qSuspX);
      }

      const mastScan = -steerInputSmoothed * 0.45 + Math.sin(elapsed * 0.7) * 0.05;
      if (rig.mastHead) {
        qSteerZ.setFromAxisAngle(axisZ, mastScan);
        rig.mastHead.obj.quaternion.copy(rig.mastHead.baseQuat).multiply(qSteerZ);
      }

      // Sync Steerable MastCam-Z High-Beam & Dual Front Bulkhead Floodlights
      mastLampPivot.rotation.y = mastScan;
      mastHighBeam.target.position.set(
        -Math.sin(mastScan) * 36.0,
        -2.2 + pointerLook.y * 2.5,
        -Math.cos(mastScan) * 36.0
      );

      const hlMode = headlightModeRef.current;
      const floodTargetIntensity = hlMode === 'HIGH' ? 28.0 : hlMode === 'LOW' ? 12.0 : 0.0;
      const mastTargetIntensity = hlMode === 'HIGH' ? 44.0 : hlMode === 'LOW' ? 16.0 : 0.0;
      const fillTargetIntensity = hlMode === 'HIGH' ? 2.2 : hlMode === 'LOW' ? 1.0 : 0.0;

      leftFloodLight.intensity = THREE.MathUtils.damp(leftFloodLight.intensity, floodTargetIntensity, 10.0, dt);
      rightFloodLight.intensity = THREE.MathUtils.damp(rightFloodLight.intensity, floodTargetIntensity, 10.0, dt);
      mastHighBeam.intensity = THREE.MathUtils.damp(mastHighBeam.intensity, mastTargetIntensity, 10.0, dt);
      frontChassisFill.intensity = THREE.MathUtils.damp(frontChassisFill.intensity, fillTargetIntensity, 10.0, dt);

      const lensActive = hlMode !== 'OFF';
      lampLensMat.color.setHex(lensActive ? 0xfffbeb : 0x333842);
      for (let i = 0; i < lensSprites.length; i++) {
        lensSprites[i].visible = lensActive;
        const s = (i === 2 ? 0.34 : 0.42) * (hlMode === 'HIGH' ? 1.15 : 0.78);
        lensSprites[i].scale.set(s, s, 1);
      }

      // Spring-damped inertial sway for the Rover's NASA Flagpole & fabric micro-vibration
      const targetSwayX = THREE.MathUtils.clamp(-accelTorquePitch * 3.2 - chassisPitch * 0.35, -0.22, 0.22);
      const targetSwayZ = THREE.MathUtils.clamp(-yawRate * 0.14 - chassisRoll * 0.35, -0.22, 0.22);
      flagSwayVelX += ((targetSwayX - flagSwayAngleX) * 42.0 - flagSwayVelX * 5.5) * dt;
      flagSwayVelZ += ((targetSwayZ - flagSwayAngleZ) * 42.0 - flagSwayVelZ * 5.5) * dt;
      flagSwayAngleX += flagSwayVelX * dt;
      flagSwayAngleZ += flagSwayVelZ * dt;
      nasaFlagPolePivot.rotation.x = flagSwayAngleX;
      nasaFlagPolePivot.rotation.z = flagSwayAngleZ;

      if (Math.abs(forwardSpeed) > 0.05 || Math.abs(yawRate) > 0.05) {
        const vibAmp = Math.min(0.012, (Math.abs(forwardSpeed) + Math.abs(yawRate)) * 0.0028);
        for (let i = 0; i < flagPosAttr.count; i++) {
          const fz = flagPosAttr.getZ(i);
          const normSpan = (fz + flagWidth * 0.5) / flagWidth;
          const wave = Math.sin(elapsed * 14.0 - normSpan * 8.0) * vibAmp * normSpan;
          flagPosAttr.setX(i, flagBaseX[i] + wave);
        }
        flagPosAttr.needsUpdate = true;
      }

      // =======================================================================
      // STAMP PERSISTENT 6-WHEEL TRACK DECALS & BALLISTIC VACUUM REGOLITH SPRAY
      // =======================================================================
      const absSpeed = Math.abs(forwardSpeed) + Math.abs(yawRate) * 0.5;
      distanceSinceLastDecal += absSpeed * dt;
      if (distanceSinceLastDecal >= 0.26) {
        distanceSinceLastDecal = 0;
        // Stamp NASA chevron grouser imprints under Front & Rear wheels aligned to 3D slope plane
        const stampIndices = [0, 2, 3, 5];
        for (const wi of stampIndices) {
          const wp = wheelWorldPositions[wi];
          const wSample = terrainPipeline.sampleTerrain(wp.x, wp.z);
          trackFwdVec.set(fwdX, 0, fwdZ).normalize();
          trackRightVec.crossVectors(trackFwdVec, wSample.normal).normalize();
          trackFwdVec.crossVectors(wSample.normal, trackRightVec).normalize();
          trackBasisMat.makeBasis(trackRightVec, wSample.normal, trackFwdVec.negate());

          trackDummy.position.set(wp.x, wp.y + 0.018, wp.z);
          trackDummy.quaternion.setFromRotationMatrix(trackBasisMat);
          trackDummy.updateMatrix();
          trackInstanced.setMatrixAt(nextTrackIdx, trackDummy.matrix);
          nextTrackIdx = (nextTrackIdx + 1) % maxTrackDecals;
          trackInstanced.count = Math.min(maxTrackDecals, Math.max(trackInstanced.count, nextTrackIdx));
        }
        trackInstanced.instanceMatrix.needsUpdate = true;
      }

      // Emit low-angle ballistic regolith grains in vacuum (parabolic arc under g = 1.622 m/s²)
      if (absSpeed > 0.25) {
        const emitCount = Math.min(4, Math.ceil(absSpeed * 1.2));
        const signDir = forwardSpeed >= 0 ? 1 : -1;
        for (let e = 0; e < emitCount; e++) {
          const wIdx = Math.floor(Math.random() * 6);
          const wp = wheelWorldPositions[wIdx];
          const idx = nextBallisticIdx;
          nextBallisticIdx = (nextBallisticIdx + 1) % ballisticCount;

          ballisticPos[idx * 3 + 0] = wp.x + (Math.random() - 0.5) * 0.25;
          ballisticPos[idx * 3 + 1] = wp.y + 0.08;
          ballisticPos[idx * 3 + 2] = wp.z + (Math.random() - 0.5) * 0.25;

          const kickSpeed = (0.6 + Math.random() * 0.9) * Math.min(2.5, absSpeed);
          ballisticVel[idx * 3 + 0] = -forwardDirX * signDir * kickSpeed + (Math.random() - 0.5) * 0.6;
          ballisticVel[idx * 3 + 1] = 0.45 + Math.random() * 0.65; // Low ballistic angle
          ballisticVel[idx * 3 + 2] = -forwardDirZ * signDir * kickSpeed + (Math.random() - 0.5) * 0.6;
          ballisticLife[idx] = 0.85;
        }
      }

      // Integrate ballistic particles under lunar gravity (1.622 m/s²)
      let ballisticDirty = false;
      for (let i = 0; i < ballisticCount; i++) {
        if (ballisticLife[i] > 0) {
          ballisticLife[i] -= dt;
          ballisticVel[i * 3 + 1] -= LUNAR_GRAVITY * dt;
          ballisticPos[i * 3 + 0] += ballisticVel[i * 3 + 0] * dt;
          ballisticPos[i * 3 + 1] += ballisticVel[i * 3 + 1] * dt;
          ballisticPos[i * 3 + 2] += ballisticVel[i * 3 + 2] * dt;
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

      // =======================================================================
      // UPDATE CAMERA (UNIFIED CHASE + 360° ORBIT / FULL MOON SPACE VIEW)
      // =======================================================================
      if (resetSurfaceToEarthSpawnRef.current) {
        resetSurfaceToEarthSpawnRef.current = false;
        roverX = ROVER_SPAWN_X;
        roverZ = ROVER_SPAWN_Z;
        roverY = terrainPipeline.sampleHeight(ROVER_SPAWN_X, ROVER_SPAWN_Z);
        verticalVel = 0;
        forwardSpeed = 0;
        steerInputSmoothed = 0;
        heading = ROVER_SPAWN_HEADING;
        orbitYaw = ROVER_INTRO_ORBIT_YAW;
        orbitPitch = ROVER_INTRO_ORBIT_PITCH;
        orbitDist = ROVER_INTRO_ORBIT_DIST;
        introPhase = 'HOLD';
        introHoldTimer = 0;
        introPanTimer = 0;
        const introTotalYaw = ROVER_SPAWN_HEADING + ROVER_INTRO_ORBIT_YAW;
        const spawnFwdX = -Math.sin(ROVER_SPAWN_HEADING);
        const spawnFwdZ = -Math.cos(ROVER_SPAWN_HEADING);
        const introAlign = Math.max(0.0, Math.cos(ROVER_INTRO_ORBIT_YAW));
        chaseCamPos.set(
          roverX + orbitDist * Math.cos(orbitPitch) * Math.sin(introTotalYaw),
          roverY + 0.45 + orbitDist * Math.sin(orbitPitch),
          roverZ + orbitDist * Math.cos(orbitPitch) * Math.cos(introTotalYaw)
        );
        chaseCamLook.set(
          roverX + spawnFwdX * 1.8 * introAlign,
          roverY + 1.05 + 0.43 * introAlign,
          roverZ + spawnFwdZ * 1.8 * introAlign
        );
      }

      if (moonOverviewActiveRef.current) {
        introPhase = 'IDLE';
        introHoldTimer = 0;
        introPanTimer = 0;
      } else if (moonTransition <= 0.005) {
        if (introPhase === 'HOLD') {
          introHoldTimer += dt;
          if (introHoldTimer >= 3.0) {
            introPhase = 'PAN_OUT';
            introPanTimer = 0;
            surfaceControlsReadyRef.current = true;
            setSurfaceControlsReady(true);
          }
        } else if (introPhase === 'PAN_OUT') {
          introPanTimer += dt;
          const panT = Math.min(1.0, introPanTimer / 1.5);
          const easePan = panT * panT * panT * (panT * (panT * 6.0 - 15.0) + 10.0);
          orbitYaw = THREE.MathUtils.lerp(ROVER_INTRO_ORBIT_YAW, ROVER_SPAWN_ORBIT_YAW, easePan);
          orbitPitch = THREE.MathUtils.lerp(ROVER_INTRO_ORBIT_PITCH, ROVER_SPAWN_ORBIT_PITCH, easePan);
          orbitDist = THREE.MathUtils.lerp(ROVER_INTRO_ORBIT_DIST, ROVER_SPAWN_ORBIT_DIST, easePan);
          if (panT >= 1.0) {
            introPhase = 'DONE';
          }
        }
      }

      const totalYaw = heading + orbitYaw;
      const orbitCosP = Math.cos(orbitPitch);
      const orbitSinP = Math.sin(orbitPitch);
      const desiredCamX = roverX + orbitDist * orbitCosP * Math.sin(totalYaw);
      const desiredCamZ = roverZ + orbitDist * orbitCosP * Math.cos(totalYaw);
      const groundAtCam = terrainPipeline.sampleHeight(desiredCamX, desiredCamZ);
      const desiredCamY = Math.max(groundAtCam + 0.45, roverY + 0.45 + orbitDist * orbitSinP);

      const camDamp = isPointerDragging ? 22.0 : 7.5;
      chaseCamPos.x = THREE.MathUtils.damp(chaseCamPos.x, desiredCamX, camDamp, dt);
      chaseCamPos.y = THREE.MathUtils.damp(chaseCamPos.y, desiredCamY, camDamp, dt);
      chaseCamPos.z = THREE.MathUtils.damp(chaseCamPos.z, desiredCamZ, camDamp, dt);

      // Lead slightly ahead when trailing behind in default Chase angle so Earth & horizon stay prominent ahead
      const chaseAlignment = Math.max(0.0, Math.cos(orbitYaw));
      const lookLead = 1.8 * chaseAlignment;
      const targetLookX = roverX + forwardDirX * lookLead;
      const targetLookY = roverY + 1.05 + 0.43 * chaseAlignment;
      const targetLookZ = roverZ + forwardDirZ * lookLead;

      chaseCamLook.x = THREE.MathUtils.damp(chaseCamLook.x, targetLookX, 10.0, dt);
      chaseCamLook.y = THREE.MathUtils.damp(chaseCamLook.y, targetLookY, 10.0, dt);
      chaseCamLook.z = THREE.MathUtils.damp(chaseCamLook.z, targetLookZ, 10.0, dt);

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
          const groundSafeY = terrainPipeline.sampleHeight(tmpFlightCamPos.x, tmpFlightCamPos.z) + 0.55;
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
        surfaceFlagGroup.visible = easeT < 0.36;
        trackInstanced.visible = easeT < 0.28;
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
        surfaceFlagGroup.visible = true;
        waypointMarkersGroup.visible = true;
        for (let i = 0; i < wpBeamMats.length; i++) {
          wpBeamMats[i].opacity = 0.55;
          wpRingMats[i].opacity = 0.85;
        }
        trackInstanced.visible = true;
        ballisticPoints.visible = true;
        roverWorldRoot.visible = true;

        camera.position.copy(surfaceCamPos);
        camera.up.set(0, 1, 0);
        camera.lookAt(surfaceCamLook);
      }

      // Only re-render the 2048x2048 directional shadow map when surface is in focus and rover/sun moved
      if (moonTransition < 0.28) {
        const movedDist = Math.hypot(roverX - lastShadowRoverX, roverZ - lastShadowRoverZ);
        const turnedAng = Math.abs(heading - lastShadowHeading);
        const sunAngShift = Math.abs(sunOrbitPhase - lastShadowSunPhase);
        if (
          warmupFramesRemaining > 0 ||
          movedDist > 0.002 ||
          turnedAng > 0.001 ||
          absSpeed > 0.01 ||
          sunAngShift > 0.004
        ) {
          renderer.shadowMap.needsUpdate = true;
          lastShadowRoverX = roverX;
          lastShadowRoverZ = roverZ;
          lastShadowHeading = heading;
          lastShadowSunPhase = sunOrbitPhase;
        }
      }

      // =======================================================================
      // SYNC RADAR NAVIGATION & WAYPOINT PROXIMITY (SMART DIFFED UI UPDATES)
      // =======================================================================
      telemetryTimer += dt;
      if (telemetryTimer >= 0.08 && (!moonOverviewActiveRef.current || moonTransition < 0.5)) {
        telemetryTimer = 0;
        const activeWp = terrainPipeline.waypoints[activeWaypointIdxRef.current] || terrainPipeline.waypoints[0];
        const distToActiveWp = Math.hypot(activeWp.x - roverX, activeWp.z - roverZ);

        // Auto-sample waypoint when driving within 14m and advance to next waypoint
        if (distToActiveWp < 14.0 && !activeWp.sampled) {
          activeWp.sampled = true;
          const nextIdx = terrainPipeline.waypoints.findIndex((w) => !w.sampled);
          if (nextIdx !== -1) {
            activeWaypointIdxRef.current = nextIdx;
          }
          setSampleBanner(`LOGGED TELEMETRY & REGOLITH CORE AT ${activeWp.code}: ${activeWp.name.toUpperCase()}`);
          window.setTimeout(() => setSampleBanner(null), 4000);
        }

        const headingCompass = (((-heading * 180) / Math.PI) % 360 + 360) % 360;
        const headingRounded = Math.round(headingCompass);
        const distRounded = Math.round(distToActiveWp);
        const eX = earthAnchorGroup.position.x;
        const eZ = earthAnchorGroup.position.z;
        const sX = sunDirNormalized.x;
        const sZ = sunDirNormalized.z;
        const nextKey = `${headingRounded}|${roverX.toFixed(1)}|${roverZ.toFixed(1)}|${distRounded}|${eX.toFixed(0)}|${eZ.toFixed(0)}|${sX.toFixed(2)}|${sZ.toFixed(2)}`;

        if (nextKey !== lastTelemetryKey) {
          lastTelemetryKey = nextKey;
          setTelemetry({
            headingDeg: headingRounded,
            roverX,
            roverZ,
            nearestWaypointDistM: distRounded,
            earthX: eX,
            earthZ: eZ,
            sunDirX: sX,
            sunDirZ: sZ,
          });
        }
      }

      // =======================================================================
      // OVERVIEW CONTROLLER TIME STEPPING & MOON_ME_DE421 SKY TELEMETRY
      // =======================================================================
      if (!orbitalPausedRef.current) {
        if (orbitalModeRef.current === 'now') {
          simTimeMsRef.current = Date.now();
        } else {
          simTimeMsRef.current += Math.min(1.0, dt) * 1000.0 * orbitalSpeedRef.current;
        }
      }

      overviewEvalTimer += dt;
      if (overviewEvalTimer >= 0.09) {
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
      cancelAnimationFrame(frameId);
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
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
      trackGeo.dispose();
      trackMat.dispose();
      trackTex.dispose();
      flareTex.dispose();
      nasaFlagTex.dispose();
      flagMoundGeo.dispose();
      flagMoundMat.dispose();
      lfaSleeveGeo.dispose();
      lfaClampGeo.dispose();
      lfaMastGeo.dispose();
      lfaFinialGeo.dispose();
      lfaCrossbarGeo.dispose();
      lfaEndCapGeo.dispose();
      lfaFlagGeo.dispose();
      coreHab.dispose();
      envMapRT.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };

  }, [setDirectionActive, handleCycleHeadlights]);

  const wasdKeys: {
    keyChar: 'W' | 'A' | 'S' | 'D';
    dir: DirectionKey;
    subLabel: string;
    isPrimary?: boolean;
  }[] = [
    { keyChar: 'W', dir: 'up', subLabel: 'FWD', isPrimary: true },
    { keyChar: 'A', dir: 'left', subLabel: 'LEFT' },
    { keyChar: 'S', dir: 'down', subLabel: 'REV' },
    { keyChar: 'D', dir: 'right', subLabel: 'RIGHT' },
  ];

  // Dynamic baby-blue Earth & yellow Sun compass vectors for the Navigation Radar
  const earthVecX = telemetry.earthX - telemetry.roverX;
  const earthVecZ = telemetry.earthZ - telemetry.roverZ;
  const earthVecLen = Math.hypot(earthVecX, earthVecZ) || 1;
  const radarEarthX = (earthVecX / earthVecLen) * 88;
  const radarEarthY = (earthVecZ / earthVecLen) * 88;

  const sunVecLen = Math.hypot(telemetry.sunDirX, telemetry.sunDirZ) || 1;
  const radarSunX = (telemetry.sunDirX / sunVecLen) * 88;
  const radarSunY = (telemetry.sunDirZ / sunVecLen) * 88;

  // Dynamic red-to-blue CoreHab base marker scaled proportionally within the 135m radar envelope
  const coreHabDx = COREHAB_POS_X - telemetry.roverX;
  const coreHabDz = COREHAB_POS_Z - telemetry.roverZ;
  const coreHabDist = Math.hypot(coreHabDx, coreHabDz);
  const coreHabRadarR = Math.min(88, (coreHabDist / 135.0) * 88);
  const radarCoreHabX = coreHabDist > 0.001 ? (coreHabDx / coreHabDist) * coreHabRadarR : 0;
  const radarCoreHabY = coreHabDist > 0.001 ? (coreHabDz / coreHabDist) * coreHabRadarR : 0;

  const renderDriveKeycap = (item: (typeof wasdKeys)[number]) => {
    const isPressed = activeDirsUI[item.dir];
    const isRed = Boolean(item.isPrimary);

    return (
      <button
        key={item.keyChar}
        type="button"
        aria-label={`Drive ${item.subLabel} (${item.keyChar})`}
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.setPointerCapture?.(e.pointerId);
          setDirectionActive(item.dir, true);
        }}
        onPointerUp={() => setDirectionActive(item.dir, false)}
        onPointerCancel={() => setDirectionActive(item.dir, false)}
        onLostPointerCapture={() => setDirectionActive(item.dir, false)}
        className={`group relative w-[38px] h-[38px] sm:w-[45px] sm:h-[45px] rounded-[10px] flex flex-col items-center justify-center transition-all duration-75 cursor-pointer touch-none select-none ${
          isPressed
            ? isRed
              ? 'translate-y-[3px] bg-gradient-to-b from-[#ff5a3d] to-[#fc3d21] border-t border-x border-white/60 border-b-[2px] border-b-[#7f1d1d] shadow-[0_2px_0_#7f1d1d,0_0_18px_rgba(252,61,33,0.85)]'
              : 'translate-y-[3px] bg-gradient-to-b from-[#2563eb] to-[#0b3d91] border-t border-x border-white/60 border-b-[2px] border-b-[#051d4a] shadow-[0_2px_0_#051d4a,0_0_18px_rgba(37,99,235,0.85)]'
            : isRed
            ? 'translate-y-0 bg-gradient-to-b from-[#fc3d21] via-[#d92d14] to-[#b3210c] hover:from-[#ff4f33] hover:to-[#c92610] border-t border-x border-white/35 border-b-[5px] border-b-[#6e1307] shadow-[0_6px_13px_rgba(0,0,0,0.75),inset_0_1px_1px_rgba(255,255,255,0.45)]'
            : 'translate-y-0 bg-gradient-to-b from-[#1652b8] via-[#0b3d91] to-[#082c6c] hover:from-[#1d63d8] hover:to-[#0a3682] border-t border-x border-white/30 border-b-[5px] border-b-[#04163b] shadow-[0_6px_13px_rgba(0,0,0,0.75),inset_0_1px_1px_rgba(255,255,255,0.35)]'
        }`}
      >
        {/* Top Molded 3D Keycap Dish Highlight */}
        <span className="pointer-events-none absolute inset-x-1 top-0.5 h-1.5 rounded-t-md bg-gradient-to-b from-white/25 to-transparent" />
        <span className="text-[13px] sm:text-[15px] font-black tracking-tight text-white leading-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)]">
          {item.keyChar}
        </span>
        <span className="text-[6.5px] font-bold tracking-[0.14em] text-white/80 mt-0.5 leading-none">
          {item.subLabel}
        </span>
      </button>
    );
  };

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden select-none font-mono tabular-nums text-white">
      {/* 3D Shackleton Crater WebGL Canvas */}
      <div ref={mountRef} className="absolute inset-0 w-full h-full" />

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
            strokeWidth="3"
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
            strokeWidth="3"
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
      {!sceneReady && (
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

      {/* Scientific Sample Collection Banner */}
      {sampleBanner && (
        <div
          className="absolute top-12 left-1/2 -translate-x-1/2 z-40 bg-[#060d1f]/95 border border-[#0b3d91] px-6 py-2.5 shadow-[0_0_32px_rgba(11,61,145,0.6)] flex items-center gap-3.5"
          style={{
            clipPath:
              'polygon(10px 0, calc(100% - 10px) 0, 100% 10px, 100% calc(100% - 10px), calc(100% - 10px) 100%, 10px 100%, 0 calc(100% - 10px), 0 10px)',
          }}
        >
          <span className="w-2.5 h-2.5 bg-[#fc3d21] animate-ping" />
          <span className="text-[10px] tracking-[0.22em] text-[#60a5fa] font-bold">
            MISSION LOG
          </span>
          <span className="text-white/30">·</span>
          <span className="text-xs tracking-[0.16em] text-white font-bold">
            {sampleBanner}
          </span>
        </div>
      )}

      {/* =====================================================================
          BOTTOM-LEFT (SURFACE VIEW): 3D WASD KEYCAP CLUSTER (-20% SCALE)
         ===================================================================== */}
      {!moonOverviewActive && (
        <div
          data-hud-interactive
          aria-hidden={!surfaceControlsReady}
          className={`absolute left-5 bottom-5 sm:left-8 sm:bottom-8 z-20 flex flex-col items-start gap-1.5 transition-all duration-700 ease-out ${
            surfaceControlsReady
              ? 'opacity-100 translate-y-0 pointer-events-auto'
              : 'opacity-0 translate-y-2 pointer-events-none'
          }`}
          aria-label="WASD Rover Drive Controls"
        >
          {/* Molded Dark Spacecraft Keybed Housing */}
          <div
            className="p-[1.2px] bg-gradient-to-br from-[#2563eb]/85 via-white/35 to-[#fc3d21]/85 shadow-[0_14px_30px_rgba(0,0,0,0.9)]"
            style={{
              clipPath:
                'polygon(10px 0, calc(100% - 10px) 0, 100% 10px, 100% calc(100% - 10px), calc(100% - 10px) 100%, 10px 100%, 0 calc(100% - 10px), 0 10px)',
            }}
          >
            <div
              className="bg-[#050b18]/92 backdrop-blur-md px-2.5 pt-2.5 pb-3 flex flex-col items-center gap-1.5"
              style={{
                clipPath:
                  'polygon(9px 0, calc(100% - 9px) 0, 100% 9px, 100% calc(100% - 9px), calc(100% - 9px) 100%, 9px 100%, 0 calc(100% - 9px), 0 9px)',
              }}
            >
              {/* Top W Key */}
              <div className="flex justify-center">
                {renderDriveKeycap(wasdKeys[0])}
              </div>

              {/* Bottom A S D Row */}
              <div className="flex items-center gap-1.5">
                {renderDriveKeycap(wasdKeys[1])}
                {renderDriveKeycap(wasdKeys[2])}
                {renderDriveKeycap(wasdKeys[3])}
              </div>
            </div>
          </div>

          {/* Unboxed Zoom & Orbit Cue */}
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
      {moonOverviewActive && (
        <div
          data-hud-interactive
          className="absolute left-1/2 -translate-x-1/2 bottom-5 sm:bottom-8 w-[min(846px,calc(100vw-2.5rem))] z-30 font-sans tabular-nums"
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
          TOP-RIGHT: DAY OF YEAR (DOY) + 24-HOUR UTC CLOCK (NO BACKGROUND)
         ===================================================================== */}
      <div
        className="pointer-events-none select-none absolute top-5 right-5 sm:top-8 sm:right-8 z-30 font-['Inter',sans-serif] font-semibold text-[14px] leading-none tracking-tight text-white/90 tabular-nums drop-shadow-[0_1px_6px_rgba(0,0,0,0.8)]"
        aria-label="Day of Year and 24-hour UTC Clock"
      >
        {utcDoyClock}
      </div>

      {/* =====================================================================
          BOTTOM-RIGHT: ORBITAL EYE MODE TOGGLE BUTTON (MUTED OUTLINE)
         ===================================================================== */}
      <div
        data-hud-interactive
        className="absolute bottom-5 right-5 sm:bottom-8 sm:right-8 z-30"
      >
        <button
          type="button"
          onClick={handleToggleMoonOverview}
          aria-label={moonOverviewActive ? 'Return to Lunar Surface Rover' : 'View Full Moon from Space'}
          title={moonOverviewActive ? 'Return to Lunar Surface' : 'View Full Moon from Stars'}
          className={`group flex items-center justify-center w-10 h-10 rounded-full border backdrop-blur-md transition-all duration-300 cursor-pointer ${
            moonOverviewActive
              ? 'bg-slate-900/55 border-white/25 text-white/90 hover:border-white/40 hover:bg-slate-800/65 shadow-[0_6px_18px_rgba(0,0,0,0.55)] scale-105'
              : 'bg-[#050b18]/85 border-white/20 text-white/85 hover:border-white/38 hover:text-white shadow-[0_6px_18px_rgba(0,0,0,0.65)]'
          }`}
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
            <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>

      {/* =====================================================================
          BOTTOM-RIGHT: NAVIGATION RADAR (-20% SCALE, ABOVE EYE BUTTON IN SURFACE VIEW)
         ===================================================================== */}
      {!moonOverviewActive && (
        <div
          data-hud-interactive
          aria-hidden={!surfaceControlsReady}
          className={`absolute right-5 bottom-[74px] sm:right-8 sm:bottom-[86px] z-30 flex flex-col items-end gap-2.5 transition-all duration-700 ease-out ${
            surfaceControlsReady
              ? 'opacity-100 translate-y-0 pointer-events-auto'
              : 'opacity-0 translate-y-2 pointer-events-none'
          }`}
        >
          <div className="flex flex-col items-center">
            {/* 20% Smaller Navigation Radar Container (154px / 180px vs 192px / 224px) */}
            <div className="relative w-[154px] h-[154px] sm:w-[180px] sm:h-[180px]">
              <svg viewBox="-136 -136 272 272" className="w-full h-full overflow-visible">
                <defs>
                  <linearGradient id="radarConeGrad" x1="0%" y1="100%" x2="0%" y2="0%">
                    <stop offset="0%" stopColor="rgba(11, 61, 145, 0.05)" />
                    <stop offset="62%" stopColor="rgba(37, 99, 235, 0.24)" />
                    <stop offset="100%" stopColor="rgba(255, 255, 255, 0.34)" />
                  </linearGradient>
                  <linearGradient id="coreHabDotGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#fc3d21" />
                    <stop offset="100%" stopColor="#2563eb" />
                  </linearGradient>
                  <radialGradient id="coreHabHaloGrad">
                    <stop offset="0%" stopColor="rgba(252, 61, 33, 0.38)" />
                    <stop offset="55%" stopColor="rgba(37, 99, 235, 0.24)" />
                    <stop offset="100%" stopColor="rgba(37, 99, 235, 0.0)" />
                  </radialGradient>
                  <filter id="nasaNavGlow" x="-80%" y="-80%" width="260%" height="260%">
                    <feGaussianBlur stdDeviation="3.5" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                {/* Outer NASA Blue Octagonal Navigation Bezel */}
                <polygon
                  points="-52,-132 52,-132 132,-52 132,52 52,132 -52,132 -132,52 -132,-52"
                  fill="rgba(5, 11, 24, 0.90)"
                  stroke="rgba(37, 99, 235, 0.72)"
                  strokeWidth="1.8"
                />

                {/* Corner NASA Vector Red Bezel Accents */}
                <polyline
                  points="-52,-132 -32,-132"
                  stroke="#fc3d21"
                  strokeWidth="2.6"
                  fill="none"
                />
                <polyline
                  points="32,-132 52,-132"
                  stroke="#fc3d21"
                  strokeWidth="2.6"
                  fill="none"
                />
                <polyline
                  points="-52,132 -32,132"
                  stroke="#fc3d21"
                  strokeWidth="2.6"
                  fill="none"
                />
                <polyline
                  points="32,132 52,132"
                  stroke="#fc3d21"
                  strokeWidth="2.6"
                  fill="none"
                />

                {/* Crisp White Spacecraft Compass Dial Ring */}
                <circle
                  cx="0"
                  cy="0"
                  r="116"
                  fill="rgba(6, 15, 34, 0.92)"
                  stroke="rgba(255, 255, 255, 0.82)"
                  strokeWidth="1.6"
                />

                {/* Rotating Topographic Compass & Waypoints */}
                <g transform={`rotate(${-telemetry.headingDeg})`}>
                  {Array.from({ length: 72 }).map((_, i) => {
                    const deg = i * 5;
                    const isMajor = deg % 45 === 0;
                    const isMed = deg % 15 === 0;
                    const innerR = isMajor ? 107 : isMed ? 110 : 112.5;
                    return (
                      <line
                        key={deg}
                        x1="0"
                        y1={-innerR}
                        x2="0"
                        y2="-116"
                        transform={`rotate(${deg})`}
                        stroke={
                          isMajor
                            ? '#3b82f6'
                            : isMed
                            ? 'rgba(255,255,255,0.75)'
                            : 'rgba(255,255,255,0.38)'
                        }
                        strokeWidth={isMajor ? '1.8' : '0.9'}
                      />
                    );
                  })}

                  <text x="-4.5" y="-93" fill="#fc3d21" fontSize="10" fontWeight="bold">
                    N
                  </text>
                  <text x="-3" y="102" fill="rgba(255,255,255,0.65)" fontSize="8">
                    S
                  </text>
                  <text x="94" y="3" fill="rgba(255,255,255,0.65)" fontSize="8">
                    E
                  </text>
                  <text x="-102" y="3" fill="rgba(255,255,255,0.65)" fontSize="8">
                    W
                  </text>

                  <circle
                    cx="0"
                    cy="0"
                    r="80"
                    fill="none"
                    stroke="rgba(59, 130, 246, 0.35)"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                  <circle
                    cx="0"
                    cy="0"
                    r="44"
                    fill="none"
                    stroke="rgba(255, 255, 255, 0.22)"
                    strokeWidth="1"
                  />

                  {/* Only 2 Celestial Direction Dots: Baby Blue (Earth) & Yellow (Sun) */}
                  <g transform={`translate(${radarEarthX.toFixed(1)}, ${radarEarthY.toFixed(1)})`}>
                    <circle cx="0" cy="0" r="8.2" fill="rgba(125, 211, 252, 0.24)" />
                    <circle
                      cx="0"
                      cy="0"
                      r="4.6"
                      fill="#7dd3fc"
                      stroke="#ffffff"
                      strokeWidth="1.1"
                    />
                  </g>
                  <g transform={`translate(${radarSunX.toFixed(1)}, ${radarSunY.toFixed(1)})`}>
                    <circle cx="0" cy="0" r="8.2" fill="rgba(250, 204, 21, 0.26)" />
                    <circle
                      cx="0"
                      cy="0"
                      r="4.6"
                      fill="#facc15"
                      stroke="#ffffff"
                      strokeWidth="1.1"
                    />
                  </g>
                  {/* CoreHab Habitat Marker (Red-to-Blue Gradient Dot) */}
                  <g transform={`translate(${radarCoreHabX.toFixed(1)}, ${radarCoreHabY.toFixed(1)})`}>
                    <circle cx="0" cy="0" r="10.2" fill="url(#coreHabHaloGrad)" />
                    <circle
                      cx="0"
                      cy="0"
                      r="5.0"
                      fill="url(#coreHabDotGrad)"
                      stroke="#ffffff"
                      strokeWidth="1.15"
                    />
                  </g>
                </g>

                {/* Forward Camera FOV Cone (Blue to White) */}
                <path
                  d="M 0 0 L -42 -102 A 110 110 0 0 1 42 -102 Z"
                  fill="url(#radarConeGrad)"
                />

                {/* Center Rover Vector Chevron */}
                <path
                  d="M 0 -11 L 8.5 8.5 L 0 3.5 L -8.5 8.5 Z"
                  fill="#fc3d21"
                  stroke="#ffffff"
                  strokeWidth="1.1"
                />
              </svg>
            </div>

            {/* Compact Navigation Footer Tag (Heading + Earth/Sun/CoreHab Legend) */}
            <div
              className="mt-1 px-2.5 py-0.5 bg-[#050b18]/94 border border-[#2563eb]/60 flex items-center gap-1.5 text-[8px] tracking-[0.14em]"
              style={{
                clipPath:
                  'polygon(6px 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%, 0 6px)',
              }}
            >
              <span className="text-[#60a5fa] font-bold">NAV</span>
              <span className="text-white/30">·</span>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#7dd3fc]" />
              <span className="text-[#7dd3fc] font-semibold">EARTH</span>
              <span className="text-white/30">·</span>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#facc15]" />
              <span className="text-[#facc15] font-semibold">SUN</span>
              <span className="text-white/30">·</span>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-gradient-to-br from-[#fc3d21] to-[#2563eb]" />
              <span className="text-white/90 font-semibold">COREHAB</span>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Hand-Pointer Demo Overlay (2s after entering Orbital Overview) */}
      {demoCursor.visible && (
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
