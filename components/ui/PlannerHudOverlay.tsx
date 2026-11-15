import React, { useEffect, useMemo, useState } from 'react';
import './PlannerHudOverlay.css';
import {
  AlertTriangle,
  BatteryCharging,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Eye,
  Maximize2,
  Pause,
  Play,
  Radio,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Sun,
} from 'lucide-react';
import { fmtDate, fmtHours, timeUTC } from '../manual-planner/charts.js';
import { sampleAt } from '../manual-planner/core/rehearsal.js';
import {
  type CameraFocusMode,
  type MissionResult,
  type MissionSample,
  STATION_LABELS,
  missionPlannerStore,
  useMissionHour,
  useMissionPlannerStore,
} from '../manual-planner/missionStore';
import { checkRows, outcomeTitle } from '../manual-planner/planner-decision.js';

interface PlannerHudOverlayProps {
  active: boolean;
  onSampleChange?: (sample: MissionSample | null) => void;
  onOpenManualPlanner?: () => void;
}

export const PlannerHudOverlay: React.FC<PlannerHudOverlayProps> = ({
  active,
  onSampleChange,
  onOpenManualPlanner,
}) => {
  const store = useMissionPlannerStore();
  const hour = useMissionHour();
  const [collapsed, setCollapsed] = useState(false);

  const activeResult: MissionResult | null = store.preview || store.baseline;
  const isPreview = Boolean(store.preview);

  // Advance mission scrubber timeline smoothly when playing and visible
  useEffect(() => {
    if (!active || !store.playing || !activeResult) return;
    let rafId = 0;
    let lastNow = performance.now();

    const step = (now: number) => {
      const dt = Math.min(0.1, (now - lastNow) / 1000);
      lastNow = now;
      const snap = missionPlannerStore.getSnapshot();
      const res = snap.preview || snap.baseline;
      if (!snap.playing || !res) return;

      const nextHour = snap.hour + dt * snap.speed * 2.5;
      if (nextHour >= res.settings.durationHours) {
        missionPlannerStore.setHour(res.settings.durationHours, false);
        return;
      }
      missionPlannerStore.setHour(nextHour);
      rafId = window.requestAnimationFrame(step);
    };

    rafId = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(rafId);
  }, [active, store.playing, activeResult]);

  const currentSample = useMemo<MissionSample | null>(() => {
    if (!activeResult || !store.hasCheckedPlan) return null;
    return (sampleAt(activeResult, hour) as MissionSample) || null;
  }, [activeResult, hour, store.hasCheckedPlan]);

  useEffect(() => {
    onSampleChange?.(currentSample);
  }, [currentSample, onSampleChange]);

  if (!store.hasCheckedPlan || !activeResult || !currentSample) {
    return null;
  }

  const m = activeResult.metrics;
  const s = activeResult.settings;
  const duration = Math.max(1, s.durationHours);
  const rows = checkRows(activeResult);
  const netW = currentSample.powerW - currentSample.loadW;
  const stationName = STATION_LABELS[s.stationId] || s.stationId;
  const shortSiteName = activeResult.site.name.includes('·')
    ? activeResult.site.name.split('·')[1].trim()
    : activeResult.site.name;

  const phaseMeta: Record<string, { label: string; color: string }> = {
    charging: {
      label: netW > 0 ? 'Collecting solar energy' : 'Waiting for usable energy',
      color: 'text-amber-300',
    },
    science: {
      label: `Measurement running (${Math.round(currentSample.scienceProgress * 100)}%)`,
      color: 'text-[#1ac8db]',
    },
    waiting_contact: {
      label: currentSample.linkAvailable ? 'Data ready · waiting radio power' : 'Data onboard · waiting DSN pass',
      color: 'text-[#1ac8db]',
    },
    transmitting: {
      label: `Downlinking (${currentSample.actualTxMbps.toFixed(2)} Mbit/s)`,
      color: 'text-[#00E81F]',
    },
    complete: {
      label: 'Science result returned',
      color: 'text-[#00E81F]',
    },
    incomplete: {
      label: 'Activity not completed',
      color: 'text-[#ff6961]',
    },
  };
  const currentPhase = phaseMeta[currentSample.phase] || phaseMeta.charging;

  const milestones: Array<{ key: string; label: string; hour: number | null; focus?: CameraFocusMode }> = [
    { key: 'landing', label: 'Landed', hour: 0, focus: 'default' },
    { key: 'ready', label: 'Ready', hour: m.readyHour },
    { key: 'science', label: 'Science', hour: m.scienceStartHour },
    { key: 'data', label: 'Created', hour: m.scienceEndHour },
    { key: 'transmit', label: 'Transmit', hour: m.firstTxHour, focus: 'earth' },
    { key: 'complete', label: 'Returned', hour: m.completeHour },
  ];

  // Build SVG polyline points for battery SoC across duration
  const socPolyline = activeResult.samples
    .map((pt) => {
      const x = (pt.elapsedHours / duration) * 100;
      const y = 100 - Math.max(0, Math.min(100, pt.socPct));
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
  const reserveY = 100 - Math.max(0, Math.min(100, s.reservePct));
  const playheadPct = Math.max(0, Math.min(100, (hour / duration) * 100));

  const renderTrackWindows = (windows: Array<[number, number]>, colorClass: string) =>
    windows.map(([a, b], idx) => {
      const leftPct = Math.max(0, (a / duration) * 100);
      const widthPct = Math.max(0.8, ((b - a) / duration) * 100);
      return (
        <span
          key={idx}
          className={`absolute top-0 bottom-0 rounded-full ${colorClass}`}
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
        />
      );
    });

  if (collapsed) {
    return (
      <div className="pointer-events-none absolute inset-0 z-20 p-3 flex flex-col justify-between">
        <div className="pointer-events-auto self-start vision-glass backdrop-blur-2xl bg-[#101319]/65 flex items-center gap-2 rounded-full px-3 py-1 border border-white/20">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              m.feasible
                ? 'bg-[#00E81F] shadow-[0_0_8px_rgba(0,232,31,0.8)]'
                : 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.75)]'
            }`}
          />
          <span className="text-[10px] font-medium text-white tracking-tight">
            {shortSiteName} · {m.feasible ? 'Plan works' : 'Needs attention'}
          </span>
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="ml-0.5 flex items-center gap-1 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 px-2 py-0.5 text-[9px] font-medium text-white transition-colors cursor-pointer"
          >
            <ChevronDown className="w-2.5 h-2.5" /> Show HUD
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-20 p-2.5 sm:p-3 flex flex-col justify-between overflow-hidden select-none @container">
      {/* TOP ROW: Telemetry Stack (Right) */}
      <div className="flex items-start justify-end gap-2.5">
        {/* Top-Right Translucent Glassmorphism Telemetry Cards */}
        <div className="pointer-events-auto hidden lg:flex flex-col gap-1.5 w-[178px]">
          {/* Solar PV Card */}
          <div className="vision-glass backdrop-blur-2xl bg-[#101319]/65 border border-white/20 rounded-[14px] px-2.5 py-2">
            <div className="flex items-center justify-between text-[7.5px] uppercase tracking-[0.11em] text-white/65">
              <span className="flex items-center gap-1">
                <Sun className="w-2.5 h-2.5 text-amber-300" /> Solar PV
              </span>
              <span className="font-telemetry text-amber-300 font-medium">
                {Math.round(currentSample.sunFraction * 100)}% SUN
              </span>
            </div>
            <div className="flex items-baseline justify-between mt-0.5">
              <span className="font-telemetry text-[12px] font-semibold text-white">
                {Math.round(currentSample.powerW)} W
              </span>
              <span className="font-telemetry text-[8.5px] text-white/65">{m.energyKWh.toFixed(1)} kWh total</span>
            </div>
          </div>

          {/* Battery SoC Card */}
          <div className="vision-glass backdrop-blur-2xl bg-[#101319]/65 border border-white/20 rounded-[14px] px-2.5 py-2">
            <div className="flex items-center justify-between text-[7.5px] uppercase tracking-[0.11em] text-white/65">
              <span className="flex items-center gap-1">
                <BatteryCharging className="w-2.5 h-2.5 text-[#00E81F]" /> Battery SoC
              </span>
              <span className="font-telemetry text-white/75">MIN {m.minSocPct.toFixed(0)}%</span>
            </div>
            <div className="flex items-baseline justify-between mt-0.5">
              <span className="font-telemetry text-[12px] font-semibold text-white">
                {currentSample.socPct.toFixed(1)}%
              </span>
              <span
                className={`font-telemetry text-[8.5px] font-medium ${
                  netW >= 0 ? 'text-[#00E81F]' : 'text-amber-300'
                }`}
              >
                {netW >= 0 ? `+${Math.round(netW)}` : Math.round(netW)} W net
              </span>
            </div>
            {/* Surgical 3px capsule SoC bar on 10% white track */}
            <div className="mt-1.5 h-[3px] rounded-full bg-white/10 overflow-hidden relative">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#00E81F] to-[#1ac8db] shadow-[0_0_8px_rgba(0,232,31,0.6)] transition-[width] duration-150"
                style={{ width: `${Math.max(2, Math.min(100, currentSample.socPct))}%` }}
              />
              <span
                title={`Reserve ${s.reservePct}%`}
                className="absolute top-0 bottom-0 w-px bg-amber-300"
                style={{ left: `${s.reservePct}%` }}
              />
            </div>
          </div>

          {/* Earth Link Card */}
          <div className="vision-glass backdrop-blur-2xl bg-[#101319]/65 border border-white/20 rounded-[14px] px-2.5 py-2">
            <div className="flex items-center justify-between text-[7.5px] uppercase tracking-[0.11em] text-white/65">
              <span className="flex items-center gap-1">
                <Radio className="w-2.5 h-2.5 text-[#1ac8db]" /> Earth Link
              </span>
              <span className="font-telemetry text-[#1ac8db] font-medium">{fmtHours(m.contactHours)}</span>
            </div>
            <div
              className={`text-[10.5px] font-semibold mt-0.5 truncate ${
                currentSample.transmitting
                  ? 'font-telemetry text-[#00E81F]'
                  : currentSample.linkAvailable
                  ? 'text-[#1ac8db]'
                  : 'text-white'
              }`}
            >
              {currentSample.transmitting
                ? `TX ${currentSample.actualTxMbps.toFixed(2)} Mb/s`
                : currentSample.linkAvailable
                ? 'DSN Available'
                : 'No Line of Sight'}
            </div>
            <div className="text-[8px] text-white/60 truncate mt-0.5">{stationName}</div>
          </div>

          {/* Data Return Card */}
          <div className="vision-glass backdrop-blur-2xl bg-[#101319]/65 border border-white/20 rounded-[14px] px-2.5 py-2">
            <div className="flex items-center justify-between text-[7.5px] uppercase tracking-[0.11em] text-white/65">
              <span className="flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5 text-[#1ac8db]" /> Data Return
              </span>
              <span className="font-telemetry text-white/75">GOAL {s.dataMB} MB</span>
            </div>
            <div className="flex items-baseline justify-between mt-0.5">
              <span className="font-telemetry text-[11.5px] font-semibold text-white">
                {currentSample.deliveredMB.toFixed(1)} MB
              </span>
              <span
                className={`font-telemetry text-[8.5px] font-medium ${
                  m.completeHour !== null ? 'text-[#00E81F]' : 'text-[#1ac8db]'
                }`}
              >
                {m.completeHour !== null ? `Done T+${fmtHours(m.completeHour)}` : `Limit ${fmtHours(s.deadlineHours)}`}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* BOTTOM ROW: Current Plan Verdict Card (Left) + Timeline Dock */}
      <div className="flex flex-col @[820px]:flex-row items-start @[820px]:items-end gap-2.5">
        {/* Bottom-Left Translucent Glassmorphism Verdict Card */}
        <div className="pointer-events-auto vision-glass backdrop-blur-2xl bg-[#101319]/65 border border-white/20 w-full max-w-[320px] shrink-0 rounded-[18px] p-3 space-y-2">
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className={`px-2 py-0.5 rounded-full text-[8px] font-semibold tracking-[0.08em] uppercase border shrink-0 ${
                  isPreview
                    ? 'bg-[#1ac8db]/10 text-[#1ac8db] border-[#1ac8db]/25'
                    : 'bg-white/[0.08] text-white/90 border-white/10'
                }`}
              >
                {isPreview ? 'Preview Change' : 'Current Plan'}
              </span>
              <span className="text-[9.5px] text-white/80 font-medium truncate">
                {shortSiteName} ·{' '}
                <span className="font-telemetry text-[9px] text-white/75">
                  {fmtDate(s.startUTC, true)} {timeUTC(s.startUTC)} UTC
                </span>
              </span>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {onOpenManualPlanner && (
                <button
                  type="button"
                  onClick={onOpenManualPlanner}
                  title="Open full Manual Planner report"
                  className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[8.5px] font-medium text-white/80 hover:text-white bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 transition-colors cursor-pointer"
                >
                  <Maximize2 className="w-2 h-2" />
                  <span>Full</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                title="Minimize Plan HUD"
                className="w-5 h-5 flex items-center justify-center rounded-full text-white/60 hover:text-white bg-white/[0.05] hover:bg-white/[0.12] border border-white/10 transition-colors cursor-pointer"
              >
                <ChevronUp className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Verdict Headline & Reason */}
          <div className="flex items-start gap-2">
            {m.feasible ? (
              <CheckCircle2 className="w-[14px] h-[14px] text-[#00E81F] drop-shadow-[0_0_8px_rgba(0,232,31,0.45)] shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-[14px] h-[14px] text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.4)] shrink-0 mt-0.5" />
            )}
            <div className="min-w-0">
              <div
                className={`text-[11.5px] font-semibold leading-tight tracking-tight ${
                  m.feasible ? 'text-white' : 'text-amber-100'
                }`}
              >
                {outcomeTitle(activeResult, isPreview)}
              </div>
              <p className="text-[9.5px] text-white/70 mt-0.5 leading-snug">{m.reason}</p>
            </div>
          </div>

          {/* 3 Luminous Capsule Status Tags */}
          <div className="flex flex-wrap items-center gap-1.5">
            {rows.map((row) => (
              <span
                key={row.key}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[8.5px] font-medium ${
                  row.pass
                    ? 'bg-[#00E81F]/10 text-[#00E81F] border border-[#00E81F]/20'
                    : 'bg-[#ff453a]/12 text-[#ff6961] border border-[#ff453a]/25'
                }`}
              >
                <span className="font-bold">{row.pass ? '✓' : '✕'}</span>
                <span>
                  {row.key === 'science'
                    ? 'Measurement'
                    : row.key === 'data'
                    ? 'Data on time'
                    : 'Reserve'}
                </span>
              </span>
            ))}
          </div>

          {/* Compact telemetry summary for smaller viewports */}
          <div className="grid grid-cols-4 gap-1.5 pt-1.5 border-t border-white/10 lg:hidden text-[8.5px]">
            <div>
              <div className="text-white/45 uppercase text-[7.5px] tracking-wider">Solar</div>
              <div className="font-telemetry text-white font-semibold">{Math.round(currentSample.powerW)}W</div>
            </div>
            <div>
              <div className="text-white/45 uppercase text-[7.5px] tracking-wider">Battery</div>
              <div className="font-telemetry text-[#00E81F] font-semibold">{currentSample.socPct.toFixed(0)}%</div>
            </div>
            <div>
              <div className="text-white/45 uppercase text-[7.5px] tracking-wider">Contact</div>
              <div className="font-telemetry text-[#1ac8db] font-semibold">{fmtHours(m.contactHours)}</div>
            </div>
            <div>
              <div className="text-white/45 uppercase text-[7.5px] tracking-wider">Returned</div>
              <div className="font-telemetry text-white font-semibold">{currentSample.deliveredMB.toFixed(0)}MB</div>
            </div>
          </div>

          {/* Preview Adopt / Discard Controls when inspecting an alternative */}
          {isPreview && (
            <div className="flex items-center justify-between gap-1.5 pt-1.5 border-t border-white/10">
              <span className="text-[9px] text-[#1ac8db]">Testing alternative — baseline kept</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => missionPlannerStore.discardPreview()}
                  className="px-2.5 py-0.5 rounded-full text-[9px] font-medium text-white/80 hover:text-white bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 transition-colors cursor-pointer"
                >
                  Keep original
                </button>
                {m.feasible && (
                  <button
                    type="button"
                    onClick={() => missionPlannerStore.adoptPreview('auto')}
                    className="px-2.5 py-0.5 rounded-full text-[9px] font-semibold text-black bg-[#00E81F] hover:bg-[#32ff4b] shadow-[0_0_16px_rgba(0,232,31,0.45)] transition-colors cursor-pointer"
                  >
                    Use plan
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* BOTTOM DOCK: Translucent Glassmorphism Timeline, Surgical Tracks & Capsule Tags */}
        <div className="pointer-events-auto w-full @[820px]:flex-1 min-w-0 vision-glass backdrop-blur-2xl bg-[#101319]/65 border border-white/20 rounded-[18px] px-3 py-2 space-y-1.5">
        {/* Controls & Phase Header */}
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => missionPlannerStore.togglePlay()}
              className="flex items-center gap-1 rounded-full bg-[#1ac8db]/15 hover:bg-[#1ac8db]/25 border border-[#1ac8db]/30 px-2.5 py-0.5 text-[9.5px] font-semibold text-[#1ac8db] transition-colors cursor-pointer"
            >
              {store.playing ? <Pause className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}
              <span>{store.playing ? 'Pause' : 'Play'}</span>
            </button>
            <button
              type="button"
              onClick={() => missionPlannerStore.setHour(0, false)}
              title="Reset timeline to Landing T+0"
              className="w-5 h-5 flex items-center justify-center rounded-full bg-white/[0.06] hover:bg-white/[0.14] border border-white/10 text-white/75 hover:text-white transition-colors cursor-pointer"
            >
              <RotateCcw className="w-2.5 h-2.5" />
            </button>
            <span className="font-telemetry text-[9.5px] text-white flex items-center gap-1 pl-0.5">
              <Clock className="w-2.5 h-2.5 text-white/50" />
              <span>T + {fmtHours(hour)}</span>
              <span className="text-white/40">/ {fmtHours(duration)}</span>
            </span>
            <span className={`hidden sm:inline text-[9.5px] font-medium ${currentPhase.color}`}>
              · {currentPhase.label}
            </span>
          </div>

          {/* 3D Camera Focus Capsule Pills */}
          <div className="flex items-center gap-1">
            {(
              [
                { id: 'default', label: '3D Pad', deg: null, icon: SlidersHorizontal },
                { id: 'sun', label: 'Sun', deg: `${currentSample.sunElDeg.toFixed(1)}°`, icon: Sun },
                { id: 'earth', label: 'Earth', deg: `${currentSample.earthElDeg.toFixed(1)}°`, icon: Eye },
              ] as const
            ).map((cam) => {
              const IconComp = cam.icon;
              const isActiveCam = store.cameraFocus === cam.id;
              return (
                <button
                  key={cam.id}
                  type="button"
                  onClick={() => missionPlannerStore.setCameraFocus(cam.id)}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[9px] font-medium border transition-colors cursor-pointer ${
                    isActiveCam
                      ? 'bg-[#1ac8db]/15 text-[#1ac8db] border-[#1ac8db]/30'
                      : 'bg-white/[0.06] text-white/75 hover:text-white border-white/10 hover:bg-white/[0.12]'
                  }`}
                >
                  <IconComp className="w-2.5 h-2.5" />
                  <span>{cam.label}</span>
                  {cam.deg && <span className="font-telemetry text-[8.5px]">{cam.deg}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Multi-Track Surgical Progress Bars (4px height, capsule ends, 10% white tracks) + Battery Curve */}
        <div className="relative pt-0.5">
          <div className="space-y-1">
            {[
              {
                label: 'Sunlight',
                windows: activeResult.windows.sun,
                cls: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.45)]',
              },
              {
                label: 'Science',
                windows: activeResult.windows.science,
                cls: 'bg-[#1ac8db] shadow-[0_0_10px_rgba(26,200,219,0.75)]',
              },
              {
                label: 'Contact',
                windows: activeResult.windows.link,
                cls: 'bg-[#1ac8db]/60 shadow-[0_0_8px_rgba(26,200,219,0.4)]',
              },
              {
                label: 'Transmit',
                windows: activeResult.windows.transmitting,
                cls: 'bg-[#00E81F] shadow-[0_0_10px_rgba(0,232,31,0.75)]',
              },
            ].map((track) => (
              <div key={track.label} className="flex items-center gap-2">
                <span className="w-[42px] text-[8px] font-medium text-white/55 text-right shrink-0">
                  {track.label}
                </span>
                <div className="relative flex-1 h-[4px] rounded-full bg-white/10 overflow-hidden">
                  {renderTrackWindows(track.windows, track.cls)}
                </div>
              </div>
            ))}

            {/* Battery curve track */}
            <div className="flex items-center gap-2 pt-0.5">
              <span className="w-[42px] text-[8px] font-medium text-white/55 text-right shrink-0">Battery</span>
              <div className="relative flex-1 h-3 rounded-full bg-white/[0.06] border border-white/[0.06] overflow-hidden">
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full block">
                  <line
                    x1="0"
                    y1={reserveY}
                    x2="100"
                    y2={reserveY}
                    stroke="#fbbf24"
                    strokeOpacity="0.6"
                    strokeWidth="1.5"
                    strokeDasharray="3 3"
                  />
                  <polyline
                    fill="none"
                    stroke="#00E81F"
                    strokeWidth="2.5"
                    vectorEffect="non-scaling-stroke"
                    style={{ filter: 'drop-shadow(0 0 4px rgba(0,232,31,0.55))' }}
                    points={socPolyline}
                  />
                </svg>
              </div>
            </div>
          </div>

          {/* Vertical Laser Playhead across surgical tracks */}
          <div className="pointer-events-none absolute top-0.5 bottom-0 left-[50px] right-0" aria-hidden="true">
            <div
              className="absolute top-0 bottom-0 w-[1.5px] bg-gradient-to-b from-white via-[#1ac8db] to-white shadow-[0_0_8px_rgba(26,200,219,0.9)]"
              style={{ left: `${playheadPct}%` }}
            />
          </div>

          {/* Surgical Range Scrubber aligned cleanly over tracks */}
          <div className="flex items-center gap-2 mt-1">
            <span className="w-[42px] font-telemetry text-[8px] text-white/45 text-right shrink-0">Scrub</span>
            <input
              type="range"
              aria-label="Scrub mission elapsed hours"
              min={0}
              max={duration}
              step={Math.max(0.05, duration / 240)}
              value={hour}
              onChange={(e) => missionPlannerStore.setHour(Number(e.target.value), false)}
              className="vision-scrubber flex-1"
              style={{
                background: `linear-gradient(to right, #1ac8db 0%, #1ac8db ${playheadPct}%, rgba(255, 255, 255, 0.14) ${playheadPct}%, rgba(255, 255, 255, 0.14) 100%)`,
              }}
            />
          </div>
        </div>

        {/* Signature Apple Capsule Milestone Tags */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 pt-0.5">
          <div className="flex flex-wrap items-center gap-1">
            {milestones.map((ms) => {
              const reached = ms.hour !== null && ms.hour <= hour + 1e-6;
              return (
                <button
                  key={ms.key}
                  type="button"
                  disabled={ms.hour === null}
                  onClick={() => {
                    if (ms.hour === null) return;
                    const offset =
                      ms.key === 'transmit'
                        ? Math.min(0.03, m.transmissionHours / 2)
                        : ms.key === 'science'
                        ? 0.02
                        : 0;
                    missionPlannerStore.setHour(ms.hour + offset, false);
                    if (ms.focus) missionPlannerStore.setCameraFocus(ms.focus);
                  }}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[8.5px] border transition-colors ${
                    ms.hour === null
                      ? 'bg-white/[0.02] text-white/30 border-white/[0.06] cursor-not-allowed'
                      : reached
                      ? 'bg-[#00E81F]/10 text-[#00E81F] border-[#00E81F]/25 hover:bg-[#00E81F]/18 cursor-pointer'
                      : 'bg-white/[0.05] text-white/75 border-white/10 hover:bg-white/[0.12] hover:text-white cursor-pointer'
                  }`}
                >
                  <span className="font-medium">{ms.label}</span>
                  <span className="font-telemetry text-[8px] opacity-90">
                    {ms.hour === null ? '—' : ms.hour === 0 ? 'T+0' : fmtHours(ms.hour)}
                  </span>
                </button>
              );
            })}
          </div>

          <span className="hidden xl:inline font-telemetry text-[8px] tracking-[0.14em] text-white/45 uppercase">
            Scroll to zoom · Drag to orbit
          </span>
        </div>
      </div>
      </div>
    </div>
  );
};

export default PlannerHudOverlay;
