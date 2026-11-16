import { publicAssetUrl } from '../../src/publicAssetUrl.js';
'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export interface SlsRocketProps {
  isLaunching?: boolean;
  isLiftoff?: boolean;
}

const THREE_FULL_ROTATIONS = Math.PI * 6; // 3 x 360deg

export default function SlsRocket({ isLaunching = false, isLiftoff = false }: SlsRocketProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ isLaunching, isLiftoff });
  stateRef.current = { isLaunching, isLiftoff };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return undefined;

    const isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch {
      return undefined;
    }

    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Darkened by another 7% (0.94 * 0.93 = 0.87)
    renderer.toneMappingExposure = 0.87;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));

    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    container.appendChild(canvas);

    const scene = new THREE.Scene();
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envTarget.texture;
    // Darkened by another 7% (0.75 * 0.93 = 0.70)
    scene.environmentIntensity = 0.7;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    camera.position.set(0, 0.2, 10.2);
    camera.lookAt(0, 0.15, 0);

    // Warm/Cool studio lighting darkened by another 7% + thruster ignition uplight
    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x0b3d91, 0.63);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff7ed, 1.67);
    keyLight.position.set(4, 6, 7);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x60a5fa, 0.98);
    rimLight.position.set(-5, 3, -4);
    scene.add(rimLight);

    const thrusterLight = new THREE.PointLight(0xfc3d21, 0, 8, 1.5);
    thrusterLight.position.set(0, -2.5, 0.6);
    scene.add(thrusterLight);

    const rocketGroup = new THREE.Group();
    scene.add(rocketGroup);

    let alive = true;
    let modelLoaded = false;
    let introComplete = false;
    let isDragging = false;
    let lastPointerX = 0;
    let lastPointerY = 0;
    let angularVelocityY = 0;
    let targetTiltX = 0;
    let frameId = 0;
    let timeoutId = 0;

    const loader = new GLTFLoader();
    loader.load(
      publicAssetUrl('assets/aistudio/nasa_sls_block_1_crew_v4.glb'),
      (gltf) => {
        if (!alive) return;
        const model = gltf.scene;

        // Compute bounding box and normalize scale & center
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        const maxDim = Math.max(size.x, size.y, size.z);
        const targetHeight = 4.65;
        const scale = maxDim > 0 ? targetHeight / maxDim : 1;

        model.scale.setScalar(scale);

        // Recompute bounding box after scaling to center100% accurately
        const scaledBox = new THREE.Box3().setFromObject(model);
        const scaledCenter = new THREE.Vector3();
        scaledBox.getCenter(scaledCenter);

        model.position.x -= scaledCenter.x;
        model.position.z -= scaledCenter.z;
        model.position.y -= scaledCenter.y - 0.15;

        const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((mat) => {
              const stdMat = mat as THREE.MeshStandardMaterial;
              if (stdMat.map) {
                stdMat.map.anisotropy = maxAnisotropy;
              }
            });
          }
        });

        rocketGroup.add(model);
        modelLoaded = true;
      },
      undefined,
      (err) => {
        console.error('Failed to load SLS rocket GLB:', err);
      }
    );

    // Interactive user drag-to-rotate handlers (enabled once 3 full rotations finish)
    const onPointerDown = (e: PointerEvent) => {
      if (!introComplete || e.button !== 0) return;
      isDragging = true;
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
      angularVelocityY = 0;
      canvas.setPointerCapture?.(e.pointerId);
      canvas.style.cursor = 'grabbing';
      e.preventDefault();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!introComplete) return;
      if (!isDragging) {
        if (canvas.style.cursor !== 'grab') canvas.style.cursor = 'grab';
        return;
      }
      const dx = e.clientX - lastPointerX;
      const dy = e.clientY - lastPointerY;
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;

      rocketGroup.rotation.y += dx * 0.012;
      angularVelocityY = dx * 0.45;
      targetTiltX = THREE.MathUtils.clamp(targetTiltX + dy * 0.004, -0.35, 0.35);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!isDragging) return;
      isDragging = false;
      canvas.releasePointerCapture?.(e.pointerId);
      if (introComplete) canvas.style.cursor = 'grab';
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('lostpointercapture', onPointerUp);

    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    let last = performance.now();

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
      gl.flush?.();
      const poll = () => {
        if (!alive) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          timeoutId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          timeoutId = window.setTimeout(cb, 80);
        }
      };
      timeoutId = window.setTimeout(poll, 5);
    };

    const tick = (now: number) => {
      if (!alive) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;

      const { isLaunching: launching, isLiftoff: liftoff } = stateRef.current;

      if (modelLoaded) {
        if (!introComplete) {
          // Rotate 3 full turns (6 * PI radians), easing smoothly to a stop at the end
          const remaining = THREE_FULL_ROTATIONS - rocketGroup.rotation.y;
          if (remaining <= 0.015) {
            rocketGroup.rotation.y = THREE_FULL_ROTATIONS;
            introComplete = true;
            canvas.style.cursor = 'grab';
          } else {
            // Smooth ease-out during the final half-turn, steady speed before that
            const baseSpeed = 2.6;
            const slowDownZone = Math.PI * 0.85;
            const speed =
              remaining < slowDownZone
                ? Math.max(0.25, baseSpeed * (remaining / slowDownZone))
                : baseSpeed;
            rocketGroup.rotation.y = Math.min(
              THREE_FULL_ROTATIONS,
              rocketGroup.rotation.y + speed * dt
            );
          }
        } else if (!isDragging) {
          // Apply smooth inertia after user releases drag
          if (Math.abs(angularVelocityY) > 0.001) {
            rocketGroup.rotation.y += angularVelocityY * dt;
            angularVelocityY *= Math.exp(-4.5 * dt);
          } else {
            angularVelocityY = 0;
          }
          // Gently return vertical tilt back to upright when not dragging
          targetTiltX = THREE.MathUtils.damp(targetTiltX, 0, 4, dt);
        }

        rocketGroup.rotation.x = THREE.MathUtils.damp(rocketGroup.rotation.x, targetTiltX, 10, dt);
      }

      // Illuminate lower boosters with fiery orange/red light on liftoff
      const targetIntensity = liftoff ? 8 + Math.sin(now * 0.06) * 2.5 : launching ? 1.5 : 0;
      thrusterLight.intensity = THREE.MathUtils.damp(thrusterLight.intensity, targetIntensity, 10, dt);

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(() => {
          if (alive) frameId = requestAnimationFrame(tick);
        });
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    frameId = requestAnimationFrame(tick);

    return () => {
      alive = false;
      cancelAnimationFrame(frameId);
      clearTimeout(timeoutId);
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('lostpointercapture', onPointerUp);
      envTarget.dispose();
      renderer.dispose();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
  }, []);

  return <div ref={mountRef} className="w-full h-full relative z-20" />;
}
