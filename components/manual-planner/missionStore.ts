import { publicAssetUrl } from '../../src/publicAssetUrl.js';
import { useSyncExternalStore } from 'react';
import { DEFAULTS, distanceKm, evaluate, latestStart, normalize } from './core/rehearsal.js';
import { orderedAlternatives } from './planner-decision.js';

export type CameraFocusMode = 'default' | 'sun' | 'earth';

export interface MissionSettings {
  siteId: string;
  startUTC: string;
  durationHours: number;
  stepMinutes: number;
  areaM2: number;
  panelMode: string;
  tiltDeg: number;
  azimuthDeg: number;
  efficiency: number;
  heightM: number;
  batteryKWh: number;
  initialSocPct: number;
  reservePct: number;
  loadW: number;
  stationId: string;
  maxRateMbps: number;
  txPowerW: number;
  txGainDbi: number;
  scienceMinutes: number;
  scienceW: number;
  dataMB: number;
  deadlineHours: number;
  [key: string]: unknown;
}

export interface MissionSample {
  elapsedHours: number;
  utc: string;
  powerW: number;
  loadW: number;
  socPct: number;
  storedKWh: number;
  deliveredMB: number;
  pendingMB: number;
  generatedMB: number;
  cumulativeEnergyKWh: number;
  scienceProgress: number;
  phase: string;
  transmitting?: boolean;
  scienceActive?: boolean;
  linkAvailable: number;
  actualTxMbps: number;
  sunElDeg: number;
  sunAzDeg: number;
  sunFraction: number;
  incidence: number;
  earthElDeg: number;
  earthAzDeg: number;
  earthFraction: number;
  stationClearanceDeg: number;
  groundElevationDeg: number;
  horizonDeg: number;
  earthHorizonDeg: number;
  stationHorizonDeg: number;
  stationElDeg: number;
  stationAzDeg: number;
  maxRateMarginDb: number;
  radioPowerW: number;
}

export interface MissionEvent {
  hour: number;
  type: string;
  title: string;
  detail: string;
}

export interface MissionMetrics {
  feasible: boolean;
  cause: string;
  reason: string;
  energyKWh: number;
  loadKWh: number;
  unservedKWh: number;
  spillKWh: number;
  chargeLossKWh: number;
  dischargeLossKWh: number;
  energyBalanceErrorWh: number;
  finalSocPct: number;
  minSocPct: number;
  readyHour: number | null;
  scienceStartHour: number | null;
  scienceEndHour: number | null;
  firstTxHour: number | null;
  completeHour: number | null;
  deadlineMarginHours: number | null;
  firstReserveHour: number | null;
  firstOutageHour: number | null;
  transmissionHours: number;
  contactHours: number;
  generatedMB: number;
  deliveredMB: number;
  deliveredByDeadlineMB: number;
  sunlitHours: number;
  requiredStartWh: number;
  model: string;
}

export interface MissionSiteInfo {
  id: string;
  name: string;
  latitude_deg: number;
  longitude_deg: number;
  ground_elevation_m: number;
  slope_deg: number;
}

export interface MissionResult {
  settings: MissionSettings;
  site: MissionSiteInfo;
  horizon: { azimuthDeg: number[]; elevationDeg: number[] };
  antennaHorizon?: { azimuthDeg: number[]; elevationDeg: number[] };
  samples: MissionSample[];
  events: MissionEvent[];
  windows: {
    sun: Array<[number, number]>;
    link: Array<[number, number]>;
    transmitting: Array<[number, number]>;
    science: Array<[number, number]>;
  };
  metrics: MissionMetrics;
  assumptions: string[];
  provenance: unknown;
}

export interface AlternativeChoice {
  settings: MissionSettings;
  site: MissionSiteInfo;
  metrics?: MissionMetrics;
  delay: number;
  distanceKm?: number;
  error?: string;
}

export interface LatestStartResult {
  hour: number | null;
  stepMinutes: number;
  completeHour?: number | null;
  tested: number;
}

export interface MissionStoreSnapshot {
  bundleReady: boolean;
  loadingBundle: boolean;
  loadError: string | null;
  busy: boolean;
  busyText: string;
  progress: number;
  hasCheckedPlan: boolean;
  settings: MissionSettings;
  baseline: MissionResult | null;
  preview: MissionResult | null;
  alternatives: AlternativeChoice[];
  latestStart: LatestStartResult | null;
  hour: number;
  playing: boolean;
  speed: number;
  cameraFocus: CameraFocusMode;
  cameraFocusTrigger: number;
  lastUpdatedBy: 'init' | 'auto' | 'manual';
  revision: number;
}

type Listener = () => void;

const FALLBACK_SITES: MissionSiteInfo[] = [
  {
    id: 'ridge-crest',
    name: 'Connecting Ridge · Crest',
    latitude_deg: -89.438909,
    longitude_deg: -137.14357,
    ground_elevation_m: 1924,
    slope_deg: 5.2,
  },
  {
    id: 'ridge-shoulder',
    name: 'Connecting Ridge · Shoulder',
    latitude_deg: -89.391807,
    longitude_deg: -139.397863,
    ground_elevation_m: 1819,
    slope_deg: 6.8,
  },
  {
    id: 'ridge-low',
    name: 'Connecting Ridge · Lower ground',
    latitude_deg: -89.422776,
    longitude_deg: -126.871534,
    ground_elevation_m: 1640,
    slope_deg: 8.4,
  },
];

export const SITE_LABELS: Record<string, string> = {
  'ridge-crest': 'Connecting Ridge · Crest',
  'ridge-shoulder': 'Connecting Ridge · Shoulder',
  'ridge-low': 'Connecting Ridge · Lower ground',
};

export const STATION_LABELS: Record<string, string> = {
  canberra: 'Canberra · DSS 43',
  goldstone: 'Goldstone · DSS 14',
  madrid: 'Madrid · DSS 63',
};

class MissionPlannerStore {
  private snapshot: MissionStoreSnapshot = {
    bundleReady: false,
    loadingBundle: false,
    loadError: null,
    busy: false,
    busyText: '',
    progress: 0,
    hasCheckedPlan: false,
    settings: { ...(DEFAULTS as MissionSettings) },
    baseline: null,
    preview: null,
    alternatives: [],
    latestStart: null,
    hour: 0,
    playing: false,
    speed: 0.5,
    cameraFocus: 'default',
    cameraFocusTrigger: 0,
    lastUpdatedBy: 'init',
    revision: 0,
  };

  private listeners = new Set<Listener>();
  private timeListeners = new Set<Listener>();
  private bundle: any = null;
  private loadPromise: Promise<any> | null = null;
  private worker: Worker | null = null;
  private nextReqId = 0;
  private pendingReqs = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private resultCache = new Map<string, MissionResult>();

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  subscribeTime = (listener: Listener): (() => void) => {
    this.timeListeners.add(listener);
    return () => this.timeListeners.delete(listener);
  };

  getSnapshot = (): MissionStoreSnapshot => this.snapshot;
  getHourSnapshot = (): number => this.snapshot.hour;

  private update(patch: Partial<MissionStoreSnapshot>, bumpRevision = false, timeOnly = false) {
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      revision: bumpRevision ? this.snapshot.revision + 1 : this.snapshot.revision,
    };
    this.timeListeners.forEach((l) => l());
    if (!timeOnly) {
      this.listeners.forEach((l) => l());
    }
  }

  getBundle(): any {
    return this.bundle;
  }

  getSites(): MissionSiteInfo[] {
    if (this.bundle?.sites?.length) return this.bundle.sites;
    return FALLBACK_SITES;
  }

  getActiveResult(): MissionResult | null {
    return this.snapshot.preview || this.snapshot.baseline;
  }

  private async initWorker(bundle: any) {
    if (this.worker) return;
    try {
      const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      this.worker = w;
      w.onmessage = ({ data: m }) => {
        const req = this.pendingReqs.get(m.id);
        if (!req) return;
        if (m.progress !== undefined) {
          this.update({ progress: m.progress });
          return;
        }
        this.pendingReqs.delete(m.id);
        if (m.ok) req.resolve(m.result);
        else req.reject(new Error(m.error));
      };
      w.onerror = () => {
        for (const q of this.pendingReqs.values()) q.reject(new Error('Background worker unavailable.'));
        this.pendingReqs.clear();
        this.worker?.terminate();
        this.worker = null;
      };
      await Promise.race([
        this.requestWorker('init', { bundle }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Worker initialization timed out')), 10000)),
      ]);
    } catch {
      this.worker?.terminate();
      this.worker = null;
    }
  }

  private async requestWorker(type: string, payload: Record<string, any> = {}): Promise<any> {
    if (this.worker) {
      const id = ++this.nextReqId;
      return new Promise((resolve, reject) => {
        this.pendingReqs.set(id, { resolve, reject });
        this.worker!.postMessage({ id, type, ...payload });
      });
    }
    await new Promise((r) => setTimeout(r, 15));
    if (!this.bundle) throw new Error('NASA lunar data bundle is not loaded.');
    if (type === 'evaluate') return evaluate(this.bundle, payload.settings);
    if (type === 'latest') return latestStart(this.bundle, payload.settings);
    if (type === 'search') {
      const sites =
        payload.mode === 'date'
          ? this.bundle.sites.filter((s: any) => s.id === payload.settings.siteId)
          : this.bundle.sites;
      const shifts = payload.mode === 'site' ? [0] : [0, 1, 2, 3, 4, 5, 6];
      const base = this.bundle.sites.find((s: any) => s.id === payload.settings.siteId);
      const res: AlternativeChoice[] = [];
      for (const site of sites) {
        for (const delay of shifts) {
          const settings = {
            ...payload.settings,
            siteId: site.id,
            startUTC: new Date(Date.parse(payload.settings.startUTC) + delay * 86400000).toISOString(),
          };
          try {
            const r = evaluate(this.bundle, settings) as MissionResult;
            res.push({ settings, site: r.site, metrics: r.metrics, delay, distanceKm: distanceKm(site, base) });
          } catch (e: any) {
            res.push({ settings, site, delay, error: e?.message || String(e) });
          }
          this.update({ progress: res.length / (sites.length * shifts.length) });
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      return res;
    }
    return true;
  }

  async ensureLoaded(): Promise<any> {
    if (this.bundle) return this.bundle;
    if (this.loadPromise) return this.loadPromise;

    this.update({ loadingBundle: true, loadError: null });
    this.loadPromise = (async () => {
      try {
        const resp = await fetch(publicAssetUrl('data/lunar-data.json'));
        if (!resp.ok) throw new Error('Could not load NASA terrain/ephemeris dataset.');
        const bundle = await resp.json();
        this.bundle = bundle;
        await this.initWorker(bundle);
        this.update({ bundleReady: true, loadingBundle: false, loadError: null });
        return bundle;
      } catch (err: any) {
        this.loadPromise = null;
        this.update({ loadingBundle: false, loadError: err?.message || 'Failed to load NASA dataset.' });
        throw err;
      }
    })();

    return this.loadPromise;
  }

  async evaluateSettings(partial?: Partial<MissionSettings>): Promise<MissionResult> {
    await this.ensureLoaded();
    const normalized = normalize({ ...this.snapshot.settings, ...(partial || {}) }) as MissionSettings;
    const key = JSON.stringify(normalized);
    const cached = this.resultCache.get(key);
    if (cached) return cached;

    const result = (await this.requestWorker('evaluate', { settings: normalized })) as MissionResult;
    this.resultCache.set(key, result);
    if (this.resultCache.size > 16) {
      const firstKey = this.resultCache.keys().next().value;
      if (firstKey !== undefined) this.resultCache.delete(firstKey);
    }
    return result;
  }

  async checkPlan(
    partial?: Partial<MissionSettings>,
    options: { asPreview?: boolean; markChecked?: boolean; source?: 'auto' | 'manual' } = {}
  ): Promise<MissionResult> {
    const { asPreview = false, markChecked = true, source = 'auto' } = options;
    const baseInput = asPreview ? this.getActiveResult()?.settings || this.snapshot.settings : this.snapshot.settings;
    this.update({
      busy: true,
      busyText: asPreview ? 'Testing proposed mission change' : 'Running NASA terrain & link simulation',
      progress: 0,
    });
    try {
      await this.ensureLoaded();
      const normalized = normalize({ ...baseInput, ...(partial || {}) }) as MissionSettings;
      const result = await this.evaluateSettings(normalized);
      if (asPreview) {
        this.update(
          {
            busy: false,
            busyText: '',
            hasCheckedPlan: markChecked || this.snapshot.hasCheckedPlan,
            preview: result,
            latestStart: null,
            hour: 0,
            playing: false,
            lastUpdatedBy: source,
          },
          true
        );
      } else {
        this.update(
          {
            busy: false,
            busyText: '',
            hasCheckedPlan: markChecked || this.snapshot.hasCheckedPlan,
            settings: result.settings,
            baseline: result,
            preview: null,
            alternatives: [],
            latestStart: null,
            hour: 0,
            playing: false,
            lastUpdatedBy: source,
          },
          true
        );
      }
      return result;
    } catch (err) {
      this.update({ busy: false, busyText: '' });
      throw err;
    }
  }

  adoptPreview(source: 'auto' | 'manual' = 'auto') {
    const preview = this.snapshot.preview;
    if (!preview) return;
    this.update(
      {
        settings: preview.settings,
        baseline: preview,
        preview: null,
        alternatives: [],
        latestStart: null,
        hour: 0,
        playing: false,
        hasCheckedPlan: true,
        lastUpdatedBy: source,
      },
      true
    );
  }

  discardPreview() {
    if (!this.snapshot.preview) return;
    this.update({ preview: null, hour: 0, playing: false }, true);
  }

  async searchAlternatives(
    mode: 'site' | 'date' | 'both' = 'both',
    baseOverride?: Partial<MissionSettings>
  ): Promise<AlternativeChoice[]> {
    this.update({ busy: true, busyText: 'Searching alternative landing sites & dates', progress: 0 });
    try {
      await this.ensureLoaded();
      const refSettings = normalize({
        ...(this.getActiveResult()?.settings || this.snapshot.settings),
        ...(baseOverride || {}),
      }) as MissionSettings;
      const raw = (await this.requestWorker('search', { settings: refSettings, mode })) as AlternativeChoice[];
      const ranked = orderedAlternatives(raw, refSettings) as AlternativeChoice[];
      this.update({ busy: false, busyText: '', progress: 1, alternatives: ranked }, true);
      return ranked;
    } catch (err) {
      this.update({ busy: false, busyText: '' });
      throw err;
    }
  }

  async findLatestSafeStart(baseOverride?: Partial<MissionSettings>): Promise<LatestStartResult> {
    this.update({ busy: true, busyText: 'Scanning latest safe science start time', progress: 0 });
    try {
      await this.ensureLoaded();
      const refSettings = normalize({
        ...(this.getActiveResult()?.settings || this.snapshot.settings),
        ...(baseOverride || {}),
      }) as MissionSettings;
      const latest = (await this.requestWorker('latest', { settings: refSettings })) as LatestStartResult;
      this.update({ busy: false, busyText: '', latestStart: latest }, true);
      return latest;
    } catch (err) {
      this.update({ busy: false, busyText: '' });
      throw err;
    }
  }

  setHour(hour: number, playing?: boolean) {
    const active = this.getActiveResult();
    const maxHour = active ? active.settings.durationHours : this.snapshot.settings.durationHours;
    const clamped = Math.max(0, Math.min(maxHour, hour));
    const playingChanged = playing !== undefined && playing !== this.snapshot.playing;
    this.update(
      {
        hour: clamped,
        playing: playing !== undefined ? playing : this.snapshot.playing,
      },
      false,
      !playingChanged
    );
  }

  togglePlay() {
    const active = this.getActiveResult();
    if (!active) return;
    const atEnd = this.snapshot.hour >= active.settings.durationHours - 1e-4;
    this.update({
      hour: atEnd && !this.snapshot.playing ? 0 : this.snapshot.hour,
      playing: !this.snapshot.playing,
    });
  }

  setCameraFocus(focus: CameraFocusMode) {
    this.update({
      cameraFocus: focus,
      cameraFocusTrigger: this.snapshot.cameraFocusTrigger + 1,
    });
  }

  syncFromManual(patch: {
    settings?: MissionSettings;
    baseline?: MissionResult;
    preview?: MissionResult | null;
    alternatives?: AlternativeChoice[];
    latestStart?: LatestStartResult | null;
    hour?: number;
    playing?: boolean;
    markChecked?: boolean;
  }) {
    this.update(
      {
        ...(patch.settings ? { settings: patch.settings } : {}),
        ...(patch.baseline ? { baseline: patch.baseline } : {}),
        ...(patch.preview !== undefined ? { preview: patch.preview } : {}),
        ...(patch.alternatives !== undefined ? { alternatives: patch.alternatives } : {}),
        ...(patch.latestStart !== undefined ? { latestStart: patch.latestStart } : {}),
        ...(patch.hour !== undefined ? { hour: patch.hour } : {}),
        ...(patch.playing !== undefined ? { playing: patch.playing } : {}),
        ...(patch.markChecked ? { hasCheckedPlan: true } : {}),
        lastUpdatedBy: 'manual',
      },
      true
    );
  }
}

export const missionPlannerStore = new MissionPlannerStore();

export function useMissionPlannerStore(): MissionStoreSnapshot {
  return useSyncExternalStore(
    missionPlannerStore.subscribe,
    missionPlannerStore.getSnapshot,
    missionPlannerStore.getSnapshot
  );
}

export function useMissionHour(): number {
  return useSyncExternalStore(
    missionPlannerStore.subscribeTime,
    missionPlannerStore.getHourSnapshot,
    missionPlannerStore.getHourSnapshot
  );
}
