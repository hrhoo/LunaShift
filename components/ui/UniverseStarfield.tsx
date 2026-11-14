'use client';

import { useEffect, useRef } from 'react';

interface StarParticle {
  x: number;
  y: number;
  depth: number;
  size: number;
  lum: number;
  specIdx: number;
  hasSpikes: boolean;
  twinklePhase: number;
  twinkleSpeed: number;
}

// Spectral Planckian color palette matching LunarRoverScene.tsx
const SPECTRAL_PALETTE: ReadonlyArray<[number, number, number]> = [
  [173, 209, 255], // O/B class hot blue-white
  [219, 235, 255], // B/A class blue-white
  [250, 252, 255], // A/F class pure white
  [255, 245, 219], // G class solar yellowish-white
  [255, 217, 168], // K class orange-gold
  [255, 181, 133], // M class cool amber-red
];

function createGlowSprite(r: number, g: number, b: number, withSpikes: boolean): HTMLCanvasElement {
  const size = withSpikes ? 64 : 32;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return c;

  const half = size * 0.5;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.14, `rgba(${Math.min(255, r + 40)}, ${Math.min(255, g + 40)}, ${Math.min(255, b + 40)}, 0.92)`);
  grad.addColorStop(0.38, `rgba(${r}, ${g}, ${b}, 0.34)`);
  grad.addColorStop(1.0, `rgba(${r}, ${g}, ${b}, 0.0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  if (withSpikes) {
    // Subtle 4-point optical diffraction cross on 1st-magnitude beacon stars
    const hGrad = ctx.createLinearGradient(0, half, size, half);
    hGrad.addColorStop(0.0, 'rgba(255,255,255,0)');
    hGrad.addColorStop(0.35, `rgba(${r}, ${g}, ${b}, 0.22)`);
    hGrad.addColorStop(0.5, 'rgba(255,255,255,0.65)');
    hGrad.addColorStop(0.65, `rgba(${r}, ${g}, ${b}, 0.22)`);
    hGrad.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = hGrad;
    ctx.fillRect(0, half - 0.75, size, 1.5);

    const vGrad = ctx.createLinearGradient(half, 0, half, size);
    vGrad.addColorStop(0.0, 'rgba(255,255,255,0)');
    vGrad.addColorStop(0.35, `rgba(${r}, ${g}, ${b}, 0.22)`);
    vGrad.addColorStop(0.5, 'rgba(255,255,255,0.65)');
    vGrad.addColorStop(0.65, `rgba(${r}, ${g}, ${b}, 0.22)`);
    vGrad.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = vGrad;
    ctx.fillRect(half - 0.75, 0, 1.5, size);
  }

  return c;
}

export default function UniverseStarfield() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const glowSprites = SPECTRAL_PALETTE.map(([r, g, b]) => createGlowSprite(r, g, b, false));
    const spikeSprites = SPECTRAL_PALETTE.map(([r, g, b]) => createGlowSprite(r, g, b, true));

    let width = 1;
    let height = 1;
    let dpr = 1;
    const stars: StarParticle[] = [];

    const buildStars = (w: number, h: number) => {
      stars.length = 0;
      const area = w * h;
      const count = Math.min(2400, Math.max(1100, Math.round(area / 1100)));

      for (let i = 0; i < count; i++) {
        // 36% of stars cluster softly along an inclined Milky Way galactic band
        const isGalacticBand = i < count * 0.36;
        let x: number;
        let y: number;

        if (isGalacticBand) {
          const u = Math.random();
          // Diagonal band from bottom-left toward upper-right with Gaussian scatter
          const bandCenterY = (1.0 - u * 0.85 - 0.08) * h;
          const gauss = (Math.random() + Math.random() + Math.random() - 1.5) * 0.24 * h;
          x = u * w;
          y = (bandCenterY + gauss + h) % h;
        } else {
          x = Math.random() * w;
          y = Math.random() * h;
        }

        // Power-law apparent magnitude distribution matching LunarRoverScene.tsx
        const magRoll = Math.random();
        let size = 1.3;
        let lum = 0.45;
        let hasSpikes = false;
        if (magRoll > 0.986) {
          size = 6.0 + Math.random() * 3.0;
          lum = 0.92 + Math.random() * 0.08;
          hasSpikes = true;
        } else if (magRoll > 0.93) {
          size = 3.2 + Math.random() * 1.9;
          lum = 0.74 + Math.random() * 0.16;
        } else if (magRoll > 0.72) {
          size = 1.9 + Math.random() * 1.1;
          lum = 0.52 + Math.random() * 0.22;
        } else {
          size = 1.0 + Math.random() * 0.85;
          lum = 0.28 + Math.random() * 0.26;
        }

        const specProb = Math.random();
        const specIdx =
          specProb < 0.12
            ? 0
            : specProb < 0.28
            ? 1
            : specProb < 0.62
            ? 2
            : specProb < 0.82
            ? 3
            : specProb < 0.94
            ? 4
            : 5;

        stars.push({
          x,
          y,
          depth: 0.25 + (size / 9.0) * 0.75,
          size,
          lum,
          specIdx,
          hasSpikes,
          twinklePhase: Math.random() * Math.PI * 2,
          twinkleSpeed: 0.35 + Math.random() * 0.85,
        });
      }
    };

    const resize = () => {
      const parent = canvas.parentElement;
      width = Math.max(1, parent ? parent.clientWidth : window.innerWidth);
      height = Math.max(1, parent ? parent.clientHeight : window.innerHeight);
      dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildStars(width, height);
    };

    resize();
    window.addEventListener('resize', resize);

    let targetParX = 0;
    let targetParY = 0;
    let parX = 0;
    let parY = 0;

    const onPointerMove = (e: PointerEvent) => {
      const nx = (e.clientX / Math.max(width, 1)) * 2 - 1;
      const ny = (e.clientY / Math.max(height, 1)) * 2 - 1;
      targetParX = -nx * 18;
      targetParY = -ny * 14;
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });

    let rafId = 0;
    let lastTime = performance.now();
    let elapsed = 0;

    const render = (now: number) => {
      const dt = Math.min((now - lastTime) * 0.001, 0.05);
      lastTime = now;

      if (!document.hidden) {
        elapsed += dt;
        const ease = 1 - Math.exp(-dt * 4.5);
        parX += (targetParX - parX) * ease;
        parY += (targetParY - parY) * ease;

        // Exact vacuum deep-space base (#010103) matching LunarRoverScene.tsx
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#010103';
        ctx.fillRect(0, 0, width, height);

        // Ultra-faint diagonal Milky Way cosmic dust glow
        const bandGrad = ctx.createLinearGradient(0, height * 0.88, width, height * 0.12);
        bandGrad.addColorStop(0.0, 'rgba(11, 24, 52, 0.0)');
        bandGrad.addColorStop(0.32, 'rgba(18, 34, 72, 0.075)');
        bandGrad.addColorStop(0.5, 'rgba(26, 44, 88, 0.11)');
        bandGrad.addColorStop(0.68, 'rgba(18, 34, 72, 0.075)');
        bandGrad.addColorStop(1.0, 'rgba(11, 24, 52, 0.0)');
        ctx.fillStyle = bandGrad;
        ctx.fillRect(0, 0, width, height);

        // Slow cosmic drift + parallax starfield
        const driftX = elapsed * 2.2;
        const driftY = elapsed * -0.9;

        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < stars.length; i++) {
          const st = stars[i];
          const sx = (((st.x + (driftX + parX) * st.depth) % width) + width) % width;
          const sy = (((st.y + (driftY + parY) * st.depth) % height) + height) % height;

          const scint = 0.88 + 0.12 * Math.sin(elapsed * st.twinkleSpeed + st.twinklePhase);
          ctx.globalAlpha = Math.min(1, st.lum * scint);

          if (st.size <= 2.1) {
            const [r, g, b] = SPECTRAL_PALETTE[st.specIdx];
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(sx - st.size * 0.5, sy - st.size * 0.5, st.size, st.size);
          } else {
            const sprite = st.hasSpikes ? spikeSprites[st.specIdx] : glowSprites[st.specIdx];
            const drawSize = st.hasSpikes ? st.size * 3.8 : st.size * 2.6;
            const half = drawSize * 0.5;
            ctx.drawImage(sprite, sx - half, sy - half, drawSize, drawSize);
          }
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointerMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="fixed inset-0 w-full h-full pointer-events-none block"
    />
  );
}
