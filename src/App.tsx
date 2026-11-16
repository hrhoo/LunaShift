import { publicAssetUrl } from './publicAssetUrl.js';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import AgentBuilderPage from '@/components/ui/AgentBuilderPage';
import Lanyard from '@/components/ui/Lanyard';
import ManualPlannerPage from '@/components/ui/ManualPlannerPage';
import moonBgVideoUrl from './assets/moon-bg.mp4';

const BADGE_LOGO_SRC = publicAssetUrl('assets/aistudio/Luna_Shift__3__4181c459.png');
const STRAP_LOGO_SRC = publicAssetUrl('assets/aistudio/Luna_Shift__2__8704c0a0.png');

function createStrapDataUrl(wormImg?: HTMLImageElement): string {
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // NASA Insignia Blue band
  ctx.fillStyle = '#0B3D91';
  ctx.fillRect(0, 0, 600, 160);

  // Top & bottom NASA Vector Red borders
  ctx.fillStyle = '#FC3D21';
  ctx.fillRect(0, 0, 600, 16);
  ctx.fillRect(0, 144, 600, 16);

  // Subtle interior seam/stitch lines
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.fillRect(0, 18, 600, 1.5);
  ctx.fillRect(0, 140.5, 600, 1.5);

  if (wormImg) {
    // Exact crop bounding box of the transparent LUNA wordmark (minX: 179, minY: 768, w: 1657, h: 481)
    const cropX = 179;
    const cropY = 768;
    const cropW = 1657;
    const cropH = 481;

    // Preserving the crisp visual footprint (~180px × 52px) centered at x=150 and x=450
    const targetW = 180;
    const targetH = Math.round((cropH / cropW) * targetW);
    const targetY = Math.round((160 - targetH) / 2);

    // First logo instance (centered at x = 150)
    ctx.drawImage(
      wormImg,
      cropX,
      cropY,
      cropW,
      cropH,
      150 - Math.round(targetW / 2),
      targetY,
      targetW,
      targetH
    );

    // Second logo instance (centered at x = 450)
    ctx.drawImage(
      wormImg,
      cropX,
      cropY,
      cropW,
      cropH,
      450 - Math.round(targetW / 2),
      targetY,
      targetW,
      targetH
    );
  } else {
    // Fallback while image loads
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 48px Arial, Helvetica, sans-serif';
    ctx.letterSpacing = '10px';
    ctx.fillText('LUNA', 150, 80);
    ctx.fillText('LUNA', 450, 80);
  }

  return canvas.toDataURL('image/png');
}

function createFrontBadgeDataUrl(logoImg?: HTMLImageElement): string {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 900;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Deep space black backdrop to seamlessly blend with the 3D NASA logo's black background
  const bg = ctx.createLinearGradient(0, 0, 0, 900);
  bg.addColorStop(0, '#000000');
  bg.addColorStop(0.62, '#000000');
  bg.addColorStop(1, '#040D21');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 640, 900);

  // Top NASA Vector Red stripe
  const stripe = ctx.createLinearGradient(0, 0, 640, 0);
  stripe.addColorStop(0, '#FC3D21');
  stripe.addColorStop(1, '#FF6B4A');
  ctx.fillStyle = stripe;
  ctx.fillRect(0, 148, 640, 12);

  // Draw the transparent-cutout LUNA SHIFT front emblem (exact opaque bounds 68, 103, 1884, 1782)
  if (logoImg) {
    const cropX = 68;
    const cropY = 103;
    const cropW = 1884;
    const cropH = 1782;
    const targetW = 376;
    const targetH = Math.round((cropH / cropW) * targetW);
    const targetX = (640 - targetW) / 2;
    const targetY = Math.round(172 + (370 - targetH) / 2);
    ctx.drawImage(
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
  }

  // Badge typography
  ctx.textAlign = 'center';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '900 34px Arial, Helvetica, sans-serif';
  ctx.letterSpacing = '5px';
  ctx.fillText('MISSION CONTROL', 320, 590);

  ctx.fillStyle = '#FC3D21';
  ctx.font = '700 20px "Courier New", monospace';
  ctx.letterSpacing = '2px';
  ctx.fillText('LUNAR SOUTH POLE MISSION PLANNER', 320, 638);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.fillRect(110, 690, 420, 3);

  ctx.fillStyle = '#A5C4FF';
  ctx.font = '700 22px "Courier New", monospace';
  ctx.letterSpacing = '4px';
  ctx.fillText('CLEARANCE: LS-NAVIGATOR', 320, 752);

  // Bottom ID pill
  ctx.fillStyle = 'rgba(11, 61, 145, 0.35)';
  ctx.beginPath();
  ctx.roundRect(165, 786, 310, 44, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 20px "Courier New", monospace';
  ctx.letterSpacing = '4px';
  ctx.fillText('ID-0847 - LUNA', 320, 815);

  return canvas.toDataURL('image/png');
}

function createBackBadgeDataUrl(logoImg?: HTMLImageElement): string {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 900;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 640, 900);

  ctx.fillStyle = '#0B3D91';
  ctx.fillRect(0, 152, 640, 12);
  ctx.fillStyle = '#FC3D21';
  ctx.fillRect(0, 164, 640, 8);

  if (logoImg) {
    const cropX = 68;
    const cropY = 103;
    const cropW = 1884;
    const cropH = 1782;
    const targetW = 320;
    const targetH = Math.round((cropH / cropW) * targetW);
    const targetX = (640 - targetW) / 2;
    const targetY = 205;
    ctx.drawImage(
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
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '900 32px Arial, Helvetica, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillText('The Dream Team', 320, 582);

  // Subtle NASA Vector Red & white accent divider
  ctx.fillStyle = '#FC3D21';
  ctx.fillRect(210, 610, 220, 2.55);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.fillRect(100, 624, 440, 1.5);

  // Team members in 2 clean rows of 3
  const teamRows = [
    ['Leon', 'Reza', 'Hyunsung'],
    ['Andrew', 'Yahia', 'Jianlong'],
  ];
  const colXs = [135, 320, 505];
  const rowYs = [682, 742];

  ctx.fillStyle = '#A5C4FF';
  ctx.font = '700 24px "Courier New", monospace';
  ctx.letterSpacing = '2px';

  teamRows.forEach((row, rIdx) => {
    row.forEach((name, cIdx) => {
      ctx.fillText(name, colXs[cIdx], rowYs[rIdx]);
    });
  });

  return canvas.toDataURL('image/png');
}

function createOverlayLogoDataUrl(logoImg: HTMLImageElement): string {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const nw = logoImg.naturalWidth || 256;
  const nh = logoImg.naturalHeight || 256;
  const s = Math.min(256 / nw, 256 / nh);
  const dw = Math.round(nw * s);
  const dh = Math.round(nh * s);
  ctx.drawImage(logoImg, Math.round((256 - dw) / 2), Math.round((256 - dh) / 2), dw, dh);
  return canvas.toDataURL('image/png');
}

export default function App() {
  const [frontBadge, setFrontBadge] = useState<string>(() => createFrontBadgeDataUrl());
  const [backBadge, setBackBadge] = useState<string>(() => createBackBadgeDataUrl());
  const [strapBadge, setStrapBadge] = useState<string>(() => createStrapDataUrl());
  const [overlayLogo, setOverlayLogo] = useState<string>('');
  const [isCrossFading, setIsCrossFading] = useState(false);
  const [hideLaunchLayer, setHideLaunchLayer] = useState(false);
  const [isBuilderMounted, setIsBuilderMounted] = useState(false);
  const [isBuilderVisible, setIsBuilderVisible] = useState(false);
  const [isManualPlannerMounted, setIsManualPlannerMounted] = useState(false);
  const [isManualPlannerVisible, setIsManualPlannerVisible] = useState(false);
  const [showPlannerOverlay, setShowPlannerOverlay] = useState(false);
  const [isPlannerAssetsLoaded, setIsPlannerAssetsLoaded] = useState(false);
  const [isPlannerRevealComplete, setIsPlannerRevealComplete] = useState(false);
  const builderTimerRef = useRef<number | null>(null);
  const builderMountRafRef = useRef<number | null>(null);
  const builderMountTimerRef = useRef<number | null>(null);
  const overlayHideTimerRef = useRef<number | null>(null);
  const manualPlannerRafRef = useRef<number | null>(null);
  const manualPlannerRaf2Ref = useRef<number | null>(null);
  const manualPlannerTimerRef = useRef<number | null>(null);
  const isHomeBackgroundVisible = !isBuilderVisible && !isManualPlannerVisible;
  const bgVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const videoEl = bgVideoRef.current;
    if (!videoEl) return;
    if (isHomeBackgroundVisible) {
      videoEl.muted = true;
      videoEl.play().catch(() => {});
    } else {
      videoEl.pause();
    }
  }, [isHomeBackgroundVisible]);

  useEffect(() => {
    const badgeImg = new Image();
    badgeImg.crossOrigin = 'anonymous';
    badgeImg.onload = () => {
      setFrontBadge(createFrontBadgeDataUrl(badgeImg));
      setBackBadge(createBackBadgeDataUrl(badgeImg));
      setOverlayLogo(createOverlayLogoDataUrl(badgeImg));
    };
    badgeImg.src = BADGE_LOGO_SRC;

    const strapImg = new Image();
    strapImg.crossOrigin = 'anonymous';
    strapImg.onload = () => {
      setStrapBadge(createStrapDataUrl(strapImg));
    };
    strapImg.src = STRAP_LOGO_SRC;

    return () => {
      if (builderTimerRef.current !== null) window.clearTimeout(builderTimerRef.current);
      if (builderMountRafRef.current !== null) window.cancelAnimationFrame(builderMountRafRef.current);
      if (builderMountTimerRef.current !== null) window.clearTimeout(builderMountTimerRef.current);
      if (overlayHideTimerRef.current !== null) window.clearTimeout(overlayHideTimerRef.current);
      if (manualPlannerRafRef.current !== null) window.cancelAnimationFrame(manualPlannerRafRef.current);
      if (manualPlannerRaf2Ref.current !== null) window.cancelAnimationFrame(manualPlannerRaf2Ref.current);
      if (manualPlannerTimerRef.current !== null) window.clearTimeout(manualPlannerTimerRef.current);
    };
  }, []);

  const handleEnterPlanner = () => {
    setIsCrossFading(true);
    setHideLaunchLayer(true);
    handleOpenBuilder();
  };

  const clearManualPlannerTimers = () => {
    if (manualPlannerRafRef.current !== null) {
      window.cancelAnimationFrame(manualPlannerRafRef.current);
      manualPlannerRafRef.current = null;
    }
    if (manualPlannerRaf2Ref.current !== null) {
      window.cancelAnimationFrame(manualPlannerRaf2Ref.current);
      manualPlannerRaf2Ref.current = null;
    }
    if (manualPlannerTimerRef.current !== null) {
      window.clearTimeout(manualPlannerTimerRef.current);
      manualPlannerTimerRef.current = null;
    }
  };

  const handleOpenBuilder = () => {
    clearManualPlannerTimers();
    setIsManualPlannerVisible(false);
    setIsManualPlannerMounted(false);
    if (builderTimerRef.current !== null) {
      window.clearTimeout(builderTimerRef.current);
      builderTimerRef.current = null;
    }
    if (builderMountRafRef.current !== null) {
      window.cancelAnimationFrame(builderMountRafRef.current);
      builderMountRafRef.current = null;
    }
    if (builderMountTimerRef.current !== null) {
      window.clearTimeout(builderMountTimerRef.current);
      builderMountTimerRef.current = null;
    }
    if (overlayHideTimerRef.current !== null) {
      window.clearTimeout(overlayHideTimerRef.current);
      overlayHideTimerRef.current = null;
    }
    setShowPlannerOverlay(true);
    setIsPlannerAssetsLoaded(false);
    setIsPlannerRevealComplete(false);
    // Let the browser paint the fullscreen black Luna Shift overlay before mounting the 3D Planner
    builderMountRafRef.current = window.requestAnimationFrame(() => {
      builderMountRafRef.current = null;
      builderMountTimerRef.current = window.setTimeout(() => {
        builderMountTimerRef.current = null;
        setIsBuilderMounted(true);
        setIsBuilderVisible(true);
      }, 0);
    });
  };

  const handlePlannerAssetsLoaded = () => {
    setIsPlannerAssetsLoaded(true);
    if (overlayHideTimerRef.current !== null) {
      window.clearTimeout(overlayHideTimerRef.current);
    }
    overlayHideTimerRef.current = window.setTimeout(() => {
      setShowPlannerOverlay(false);
      setIsPlannerRevealComplete(true);
      overlayHideTimerRef.current = null;
    }, 360);
  };

  const handleCloseBuilder = () => {
    clearManualPlannerTimers();
    if (builderMountRafRef.current !== null) {
      window.cancelAnimationFrame(builderMountRafRef.current);
      builderMountRafRef.current = null;
    }
    if (builderMountTimerRef.current !== null) {
      window.clearTimeout(builderMountTimerRef.current);
      builderMountTimerRef.current = null;
    }
    if (overlayHideTimerRef.current !== null) {
      window.clearTimeout(overlayHideTimerRef.current);
      overlayHideTimerRef.current = null;
    }
    setShowPlannerOverlay(false);
    setIsPlannerAssetsLoaded(false);
    setIsPlannerRevealComplete(false);
    setIsManualPlannerVisible(false);
    setIsBuilderVisible(false);
    setIsCrossFading(false);
    setHideLaunchLayer(false);
    if (builderTimerRef.current !== null) window.clearTimeout(builderTimerRef.current);
    builderTimerRef.current = window.setTimeout(() => {
      setIsManualPlannerMounted(false);
      setIsBuilderMounted(false);
      builderTimerRef.current = null;
    }, 520);
  };

  const handleOpenManualPlanner = () => {
    clearManualPlannerTimers();
    setIsManualPlannerMounted(true);
    setIsManualPlannerVisible(false);
    // Wait two frames so opacity-0 is painted before starting the 500ms crossfade.
    manualPlannerRafRef.current = window.requestAnimationFrame(() => {
      manualPlannerRafRef.current = null;
      manualPlannerRaf2Ref.current = window.requestAnimationFrame(() => {
        manualPlannerRaf2Ref.current = null;
        setIsManualPlannerVisible(true);
      });
    });
  };

  const handleCloseManualPlanner = () => {
    clearManualPlannerTimers();
    setIsManualPlannerVisible(false);
    manualPlannerTimerRef.current = window.setTimeout(() => {
      setIsManualPlannerMounted(false);
      manualPlannerTimerRef.current = null;
    }, 520);
  };

  const handleWatchOverviewFromManualPlanner = () => {
    handleCloseBuilder();
  };

  return (
    <main className="relative min-h-screen w-full bg-[#010103] flex items-center justify-center overflow-hidden">
      {/* Home Page Background: Local Looping Moon Video (native, no player UI) */}
      <div
        className={`fixed inset-0 w-full h-full z-20 pointer-events-none transition-opacity duration-500 ease-in-out ${
          isHomeBackgroundVisible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <video
          ref={bgVideoRef}
          src={moonBgVideoUrl}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          disableRemotePlayback
          controls={false}
          tabIndex={-1}
          aria-hidden="true"
          className="w-full h-full object-cover object-center select-none pointer-events-none"
        />
      </div>

      {/* Mission Planner + Embedded Surface View Window (Opens behind the preload overlay on pen click) */}
      {isBuilderMounted && (
        <div
          className={`fixed inset-0 w-full h-full z-40 ${showPlannerOverlay ? '' : 'transition-opacity duration-500 ease-in-out'
            } ${isBuilderVisible && !isManualPlannerVisible
              ? 'opacity-100 pointer-events-auto'
              : 'opacity-0 pointer-events-none'
            }`}
        >
          <AgentBuilderPage
            sceneActive={isBuilderVisible && !isManualPlannerVisible}
            isRevealComplete={isPlannerRevealComplete}
            onAssetsLoaded={handlePlannerAssetsLoaded}
            onOpenManualPlanner={handleOpenManualPlanner}
            onClose={handleCloseBuilder}
          />
        </div>
      )}

      {/* Manual Surface Mission Planner Page (Cross-fades in when manual icon is clicked) */}
      {isManualPlannerMounted && (
        <div
          className={`fixed inset-0 w-full h-full z-50 transition-opacity duration-500 ease-in-out ${isManualPlannerVisible
              ? 'opacity-100 pointer-events-auto'
              : 'opacity-0 pointer-events-none'
            }`}
        >
          <ManualPlannerPage
            active={isManualPlannerVisible}
            onBack={handleCloseManualPlanner}
            onWatchOverview={handleWatchOverviewFromManualPlanner}
          />
        </div>
      )}

      {/* Fullscreen Black Preload Overlay — covers background & mounts AI Planner instantaneously */}
      {showPlannerOverlay && (
        <div
          aria-busy="true"
          aria-label="Loading Mission Planner"
          className={`fixed inset-0 z-[100000000] bg-black flex flex-col items-center justify-center gap-6 transition-opacity duration-[350ms] ease-out ${isPlannerAssetsLoaded ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto'
            }`}
        >
          <div className="relative flex items-center justify-center w-36 h-36">
            <div className="absolute inset-0 rounded-full border-2 border-white/10" />
            <div className="absolute inset-0 rounded-full luna-tricolor-ring animate-spin" />
            <div className="relative z-10 w-24 h-24 rounded-full overflow-hidden flex items-center justify-center">
              <img
                src={overlayLogo || BADGE_LOGO_SRC}
                alt="LunaShift Logo"
                decoding="sync"
                loading="eager"
                className="w-full h-full object-contain scale-[1.08]"
              />
            </div>
          </div>
          <div className="text-[12.65px] font-mono tracking-[0.26em] uppercase">
            <span className="planner-silver-shimmer">Loading Mission Planner</span>
          </div>
        </div>
      )}

      {/* Initial Home Page Layer */}
      {!hideLaunchLayer && (
        <>
          {/* 3D Interactive Lanyard Badge (Right-hand side) */}
          <div
            className={`fixed inset-0 w-full h-full pointer-events-none z-40 transition-opacity duration-500 ease-in-out ${isCrossFading ? 'opacity-0' : 'opacity-100'
              }`}
          >
            <Lanyard
              frontImage={frontBadge}
              backImage={backBadge}
              strapImage={strapBadge}
              cardColor="#000000"
              strapColor="#0B3D91"
              finish="holographic"
              metal="silver"
              anchor="right"
              size={0.51}
              strapLength={0.40}
            />
          </div>

          {/* Mission Entry Panel (shifted 10.5% rightward from left edge: +20% - 7% - 4% + 1.5%) */}
          <div
            data-no-lanyard
            data-hud-interactive
            className={`fixed left-[min(calc(1.25rem+10.5vw),max(1.25rem,calc(100vw-340px-1.25rem)))] sm:left-[min(calc(2rem+10.5vw),calc(100vw-340px-2rem))] top-1/2 -translate-y-1/2 z-50 w-[min(340px,calc(100vw-2.5rem))] pointer-events-auto transition-opacity duration-500 ease-in-out ${isCrossFading ? 'opacity-0 pointer-events-none' : 'opacity-100'
              }`}
          >
            <div className="mission-entry-panel max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[34px] px-7 pt-12 pb-10 text-white">
              <h1
                className="mx-auto max-w-[270px] text-center text-[32px] sm:text-[34px] font-medium leading-[1.08] tracking-[-0.025em] text-white"
                style={{ fontFamily: "'Newsreader', Georgia, serif" }}
              >
                LunaShift Mission Planner
              </h1>

              <p className="mt-7 text-center font-['Inter',sans-serif] text-[14.5px] leading-[1.52] font-normal text-white/[0.88] tracking-[-0.005em]">
                Compare locations and landing dates through sunlight, stored energy and a clear line of sight to Earth.
              </p>

              <div className="my-8 h-px w-full bg-white/[0.14]" />

              <div className="space-y-5">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-['JetBrains_Mono',monospace] text-[11px] font-medium uppercase tracking-[0.08em] text-white/[0.56]">
                    TIME
                  </span>
                  <span className="font-['Inter',sans-serif] text-[13.5px] font-medium text-white/[0.94] tabular-nums">
                    48 hours
                  </span>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <span className="font-['JetBrains_Mono',monospace] text-[11px] font-medium uppercase tracking-[0.08em] text-white/[0.56]">
                    DIFFICULTY
                  </span>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-[5px]" aria-hidden="true">
                      <span className="h-[7px] w-[15px] rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.28)]" />
                      <span className="h-[7px] w-[15px] rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.28)]" />
                      <span className="h-[7px] w-[15px] rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.28)]" />
                      <span className="h-[7px] w-[15px] rounded-full bg-white/[0.22]" />
                    </div>
                    <span className="font-['Inter',sans-serif] text-[13.5px] font-medium text-white/[0.94]">
                      Intermediate
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={handleEnterPlanner}
                className="mission-enter-btn mt-10 flex h-12 w-full cursor-pointer items-center justify-center rounded-full"
              >
                <span className="mission-enter-btn-label relative z-[1] font-['Inter',sans-serif] text-[15px] font-semibold tracking-[-0.01em] text-[#111216]">
                  Enter
                </span>
              </button>
            </div>
          </div>
        </>
      )}
    </main>
  );
}

