/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import FlyingButton from '@/components/ui/FlyingButton';
import Lanyard from '@/components/ui/Lanyard';
import LunarRoverScene from '@/components/ui/LunarRoverScene';
import UniverseStarfield from '@/components/ui/UniverseStarfield';

const BADGE_LOGO_SRC = '/assets/aistudio/Luna_Shift__3__4181c459.png';
const STRAP_LOGO_SRC = '/assets/aistudio/Luna_Shift__2__8704c0a0.png';

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

export default function App() {
  const [frontBadge, setFrontBadge] = useState<string>(() => createFrontBadgeDataUrl());
  const [backBadge, setBackBadge] = useState<string>(() => createBackBadgeDataUrl());
  const [strapBadge, setStrapBadge] = useState<string>(() => createStrapDataUrl());
  const [isCrossFading, setIsCrossFading] = useState(false);
  const [hideLaunchLayer, setHideLaunchLayer] = useState(false);
  const launchTimerRef = useRef<number | null>(null);
  const unmountTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const badgeImg = new Image();
    badgeImg.crossOrigin = 'anonymous';
    badgeImg.onload = () => {
      setFrontBadge(createFrontBadgeDataUrl(badgeImg));
      setBackBadge(createBackBadgeDataUrl(badgeImg));
    };
    badgeImg.src = BADGE_LOGO_SRC;

    const strapImg = new Image();
    strapImg.crossOrigin = 'anonymous';
    strapImg.onload = () => {
      setStrapBadge(createStrapDataUrl(strapImg));
    };
    strapImg.src = STRAP_LOGO_SRC;

    return () => {
      if (launchTimerRef.current !== null) window.clearTimeout(launchTimerRef.current);
      if (unmountTimerRef.current !== null) window.clearTimeout(unmountTimerRef.current);
    };
  }, []);

  const handleLaunchClick = () => {
    if (launchTimerRef.current !== null || isCrossFading) return;

    // After 5.5 seconds, trigger smooth cross-fade transition to the Lunar Rover page
    launchTimerRef.current = window.setTimeout(() => {
      setIsCrossFading(true);
      unmountTimerRef.current = window.setTimeout(() => {
        setHideLaunchLayer(true);
      }, 1600);
    }, 5500);
  };

  return (
    <main className="relative min-h-screen w-full bg-[#010103] flex items-center justify-center overflow-hidden">
      {/* New Page: Unreal Engine 5 Lunar Rover Mission Scene (Cross-fades in at 5.5s) */}
      <div
        className={`fixed inset-0 w-full h-full z-30 transition-opacity duration-[1500ms] ease-in-out ${
          isCrossFading ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        <LunarRoverScene active={isCrossFading} />
      </div>

      {/* Initial Launch Page Layer (Cross-fades out smoothly at 5.5s) */}
      {!hideLaunchLayer && (
        <>
          {/* Deep-Space Universe Starfield Backdrop matching the Lunar Rover Sky */}
          <div
            className={`fixed inset-0 w-full h-full pointer-events-none z-20 transition-opacity duration-[1500ms] ease-in-out ${
              isCrossFading ? 'opacity-0' : 'opacity-100'
            }`}
          >
            <UniverseStarfield />
          </div>

          {/* 3D Interactive Lanyard Badge (Behind Launch Button) */}
          <div
            className={`fixed inset-0 w-full h-full pointer-events-none z-40 transition-opacity duration-[1500ms] ease-in-out ${
              isCrossFading ? 'opacity-0' : 'opacity-100'
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
              anchor="center"
              size={0.51}
              strapLength={0.40}
            />
          </div>

          {/* Launch Button (Always in front of the Badge) */}
          <div
            className={`fixed bottom-0 left-0 right-0 w-full z-[99999999] h-[240px] flex items-end justify-center pointer-events-none transition-opacity duration-[1500ms] ease-in-out ${
              isCrossFading ? 'opacity-0' : 'opacity-100'
            }`}
          >
            <FlyingButton
              theme="dark"
              size="medium"
              altitude={150}
              hoverTime={2.4}
              jets={3}
              thrusters
              trigger="click"
              carryCursor={false}
              smoke={1}
              turbulence={1}
              wobble={1}
              thrustColor="#ff002a"
              smokeColor="#f4f4f5"
              buttonColor="linear-gradient(135deg, #FFFFFF 0%, #ff002a 100%)"
              textColor="#000000"
              style={{ '--fly-width': 'min(calc(100% - 2rem), 384px)' } as CSSProperties}
              onClick={handleLaunchClick}
            >
              Enter Experience
            </FlyingButton>
          </div>
          {/* Top-Right Frosted Glass Mission Summary Box */}
          <div
            className={`fixed top-5 right-5 sm:top-8 sm:right-8 z-50 max-w-[290px] pointer-events-none transition-opacity duration-[1500ms] ease-in-out ${
              isCrossFading ? 'opacity-0' : 'opacity-100'
            }`}
          >
            <div className="rounded-2xl border border-white/20 bg-white/[0.06] backdrop-blur-[2px] px-4 py-3.5 shadow-[0_18px_45px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.25)]">
              <p className="text-center font-['Inter',sans-serif] text-[12.5px] leading-relaxed font-medium text-white/90 tracking-tight">
                Compare locations and landing dates through sunlight, stored energy and a clear line of sight to Earth.
              </p>
            </div>
          </div>
        </>
      )}
    </main>
  );
}

