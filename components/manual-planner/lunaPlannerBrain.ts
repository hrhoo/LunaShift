import { fmtDate, fmtHours, timeUTC } from './charts.js';
import { DEFAULTS, normalize } from './core/rehearsal.js';
import { localGuide } from './guide.js';
import {
  type AlternativeChoice,
  type CameraFocusMode,
  type LatestStartResult,
  type MissionResult,
  type MissionSettings,
  type MissionStoreSnapshot,
  SITE_LABELS,
  STATION_LABELS,
  missionPlannerStore,
} from './missionStore.js';
import {
  NEMOTRON_DISPLAY_NAME,
  NEMOTRON_MODEL_ID,
  OPENROUTER_KEYS_URL,
  OpenRouterApiError,
  type OpenRouterDelta,
  type OpenRouterMessage,
  type OpenRouterTool,
  type OpenRouterToolCall,
  type OpenRouterUsage,
  callOpenRouterNemotron,
  getActiveByokModelId,
  isOpenRouterModelId,
  readStoredByokKeys,
} from './openrouterClient.js';
import { checkRows, outcomeTitle } from './planner-decision.js';

export type PlannerIntent =
  | 'alternatives'
  | 'custom_setup'
  | 'explain_fail'
  | 'sample_walkthrough'
  | 'freeform';

export interface QuestionOptionItem {
  id: string;
  label: string;
}

export interface PlannerQuestionCard {
  title: string;
  options: QuestionOptionItem[];
  allowCustom?: boolean;
}

export interface LunaActionButton {
  id: string;
  label: string;
  kind:
    | 'check_plan'
    | 'search_alternatives'
    | 'preview_alternative'
    | 'adopt_preview'
    | 'discard_preview'
    | 'test_delay'
    | 'latest_start'
    | 'camera'
    | 'open_manual'
    | 'open_api_key'
    | 'start_over'
    | 'hardware_q';
  payload?: any;
  variant?: 'primary' | 'secondary' | 'subtle';
}

export interface LunaDraftState {
  phase: 'discovering' | 'ready_to_check' | 'checked';
  intent: PlannerIntent | null;
  step: number;
  draftSettings: Partial<MissionSettings>;
  searchMode: 'site' | 'date' | 'both';
  focusTopic?: string;
  parsedNotes: string[];
}

export interface LunaBrainTurnResult {
  reasoning: string;
  planStatus?: string;
  tasksCount?: string;
  tasks?: { id: string; label: string; status: 'done' | 'running' }[];
  content: string;
  questionCard?: PlannerQuestionCard | null;
  questionPendingText?: string;
  actions?: LunaActionButton[];
  draft: LunaDraftState;
  alreadyStreamed?: boolean;
  modelLabel?: string;
}

export function createInitialLunaDraft(): LunaDraftState {
  return {
    phase: 'discovering',
    intent: null,
    step: 0,
    draftSettings: {
      siteId: DEFAULTS.siteId,
      startUTC: DEFAULTS.startUTC,
      durationHours: DEFAULTS.durationHours,
      scienceMinutes: DEFAULTS.scienceMinutes,
      scienceW: DEFAULTS.scienceW,
      dataMB: DEFAULTS.dataMB,
      deadlineHours: DEFAULTS.deadlineHours,
      stationId: DEFAULTS.stationId,
    },
    searchMode: 'both',
    parsedNotes: [],
  };
}

export function formatUtcReadable(utc: string): string {
  return `${fmtDate(utc)} · ${timeUTC(utc)} UTC`;
}

export function siteShortName(siteId: string): string {
  const full = SITE_LABELS[siteId] || siteId;
  return full.includes('·') ? full.split('·')[1].trim() : full;
}

/** Extracts mission parameters cleanly from freeform natural language or MCQ answers. */
export function parseMissionParameters(
  rawText: string,
  baseSettings: Partial<MissionSettings> = {}
): { patch: Partial<MissionSettings>; notes: string[] } {
  const q = rawText.toLowerCase().trim();
  const patch: Partial<MissionSettings> = {};
  const notes: string[] = [];

  // Sites
  if (q.includes('shoulder')) {
    patch.siteId = 'ridge-shoulder';
    notes.push('Site -> Connecting Ridge · Shoulder');
  } else if (q.includes('lower') || q.includes('ridge-low')) {
    patch.siteId = 'ridge-low';
    notes.push('Site -> Connecting Ridge · Lower ground');
  } else if (q.includes('crest')) {
    patch.siteId = 'ridge-crest';
    notes.push('Site -> Connecting Ridge · Crest');
  }

  // Ground station
  if (q.includes('goldstone') || q.includes('dss 14')) {
    patch.stationId = 'goldstone';
    notes.push('Station -> Goldstone · DSS 14');
  } else if (q.includes('madrid') || q.includes('dss 63')) {
    patch.stationId = 'madrid';
    notes.push('Station -> Madrid · DSS 63');
  } else if (q.includes('canberra') || q.includes('dss 43')) {
    patch.stationId = 'canberra';
    notes.push('Station -> Canberra · DSS 43');
  }

  // Panel tracking modes
  if (q.includes('two-axis') || q.includes('2-axis') || q.includes('ideal tracking')) {
    patch.panelMode = 'tracking';
    notes.push('Solar array -> Ideal 2-axis tracking');
  } else if (q.includes('horizontal')) {
    patch.panelMode = 'horizontal';
    notes.push('Solar array -> Horizontal fixed');
  } else if (q.includes('vertical')) {
    patch.panelMode = 'vertical_tracking';
    notes.push('Solar array -> Vertical azimuth tracking');
  }

  // Explicit ISO date (2026 or 2027)
  const isoMatch = rawText.match(/\b(202[67]-\d{2}-\d{2})(?:[tT ](\d{2}:\d{2}))?/);
  if (isoMatch) {
    const timePart = isoMatch[2] || '00:00';
    const candidate = `${isoMatch[1]}T${timePart}:00Z`;
    if (!Number.isNaN(Date.parse(candidate))) {
      patch.startUTC = new Date(candidate).toISOString();
      notes.push(`Landing -> ${formatUtcReadable(patch.startUTC)}`);
    }
  } else {
    // Natural month-day like "18 Nov 2026", "Nov 19, 2026", "15 Dec 2026 · 12:00 UTC", "Mar 1 2027"
    const months: Record<string, string> = {
      jan: '01',
      january: '01',
      feb: '02',
      february: '02',
      mar: '03',
      march: '03',
      apr: '04',
      april: '04',
      may: '05',
      jun: '06',
      june: '06',
      jul: '07',
      july: '07',
      aug: '08',
      august: '08',
      sep: '09',
      sept: '09',
      september: '09',
      oct: '10',
      october: '10',
      nov: '11',
      november: '11',
      dec: '12',
      december: '12',
    };
    const m1 = q.match(
      /\b(\d{1,2})\s+(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)(?:\s+(202[67]))?(?:[,\s·@]+(\d{1,2}:\d{2}))?/
    );
    const m2 = q.match(
      /\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:[,\s]+(202[67]))?(?:[,\s·@]+(\d{1,2}:\d{2}))?/
    );
    const matchedDay = m1 ? +m1[1] : m2 ? +m2[2] : null;
    const matchedMonth = m1 ? months[m1[2]] : m2 ? months[m2[1]] : null;
    const matchedYear = m1?.[3] || m2?.[3] || '2026';
    const matchedClock = m1?.[4] || m2?.[4] || '00:00';
    if (matchedDay && matchedMonth) {
      const dd = String(matchedDay).padStart(2, '0');
      const hhmm = matchedClock.length === 4 ? `0${matchedClock}` : matchedClock;
      const iso = `${matchedYear}-${matchedMonth}-${dd}T${hhmm}:00Z`;
      if (!Number.isNaN(Date.parse(iso))) {
        patch.startUTC = new Date(iso).toISOString();
        notes.push(`Landing -> ${formatUtcReadable(patch.startUTC)}`);
      }
    }
  }

  // Relative delay / earlier shift (only when explicit shift intent is present)
  const delayMatch =
    q.match(/(?:delay(?:\s+by)?|shift(?:\s+by)?|move(?:\s+by)?|\+)\s*(\d+(?:\.\d+)?)\s*(day|days|d|hour|hours|hr|hrs|h)\b/) ||
    q.match(/\b(\d+(?:\.\d+)?)\s*(day|days|hour|hours|hr|hrs)\s*(?:later|slip|delay)\b/);
  if (delayMatch && !patch.startUTC) {
    const val = Number(delayMatch[1]);
    const isDay = delayMatch[2].startsWith('d');
    const baseMs = Date.parse(baseSettings.startUTC || DEFAULTS.startUTC);
    if (Number.isFinite(val) && Number.isFinite(baseMs)) {
      patch.startUTC = new Date(baseMs + val * (isDay ? 86400000 : 3600000)).toISOString();
      notes.push(`Landing shifted +${val}${isDay ? 'd' : 'h'} -> ${formatUtcReadable(patch.startUTC)}`);
    }
  }

  // Science measurement duration
  const sciMatch = q.match(/(\d+(?:\.\d+)?)\s*[- ]?(?:minute|minutes|min|mins)\b/);
  if (sciMatch) {
    const mins = Math.max(1, Math.min(240, Math.round(Number(sciMatch[1]))));
    patch.scienceMinutes = mins;
    notes.push(`Measurement -> ${mins} min`);
  }

  // Data volume
  const dataMatch = q.match(/(\d+(?:\.\d+)?)\s*(mb|gb)\b/);
  if (dataMatch) {
    const rawVal = Number(dataMatch[1]);
    const mb = dataMatch[2] === 'gb' ? rawVal * 1000 : rawVal;
    if (Number.isFinite(mb) && mb > 0) {
      patch.dataMB = Math.max(1, Math.min(10000, Math.round(mb)));
      notes.push(`Data target -> ${patch.dataMB} MB`);
    }
  }

  // Deadline hours (avoid matching delay phrases like "delay by 1 day")
  const deadlineMatch =
    q.match(/(?:within|deadline(?:\s*(?:of|in|is|:))?)\s*(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|day|days)\b/) ||
    q.match(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|day|days)\s*deadline\b/);
  if (deadlineMatch) {
    const raw = Number(deadlineMatch[1]);
    const hrs = deadlineMatch[2].startsWith('d') ? raw * 24 : raw;
    if (Number.isFinite(hrs) && hrs >= 1 && hrs <= 168) {
      patch.deadlineHours = hrs;
      patch.durationHours = Math.max(hrs, baseSettings.durationHours || DEFAULTS.durationHours);
      notes.push(`Deadline -> ${hrs}h`);
    }
  }

  // Hardware specs: solar area m2, battery kWh, reserve %
  const solarMatch = q.match(/(\d+(?:\.\d+)?)\s*(?:m2|m²|sq\s*m)\b/);
  if (solarMatch) {
    const area = Math.max(0.2, Math.min(20, Number(solarMatch[1])));
    patch.areaM2 = area;
    notes.push(`Solar array -> ${area} m²`);
  }
  const battMatch = q.match(/(\d+(?:\.\d+)?)\s*kwh\b/);
  if (battMatch) {
    const kwh = Math.max(0.2, Math.min(50, Number(battMatch[1])));
    patch.batteryKWh = kwh;
    notes.push(`Battery -> ${kwh} kWh`);
  }
  const resMatch = q.match(/(\d+(?:\.\d+)?)\s*%\s*reserve\b|reserve\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*%/);
  if (resMatch) {
    const pct = Math.max(5, Math.min(80, Math.round(Number(resMatch[1] || resMatch[2]))));
    patch.reservePct = pct;
    notes.push(`Battery reserve -> ${pct}%`);
  }

  return { patch, notes };
}

function summarizeDraftCard(s: Partial<MissionSettings>): string {
  const merged = normalize({ ...DEFAULTS, ...s }) as MissionSettings;
  return [
    `**Mission Configuration Ready to Check**`,
    `- **Site:** ${SITE_LABELS[merged.siteId] || merged.siteId}`,
    `- **Landing (UTC):** ${formatUtcReadable(merged.startUTC)}`,
    `- **Science & Data:** ${merged.scienceMinutes} min measurement (${merged.scienceW} W) -> ${merged.dataMB} MB return`,
    `- **Deadline / Window:** ${fmtHours(merged.deadlineHours)} deadline within ${fmtHours(merged.durationHours)}`,
    `- **Spacecraft & Link:** ${merged.areaM2} m² solar · ${merged.batteryKWh} kWh (${merged.initialSocPct}% init / ${merged.reservePct}% reserve) · ${STATION_LABELS[merged.stationId] || merged.stationId}`,
  ].join('\n');
}

function buildReadyToCheckResult(
  draft: LunaDraftState,
  introText: string,
  reasoningLines: string[]
): LunaBrainTurnResult {
  const nextDraft: LunaDraftState = { ...draft, phase: 'ready_to_check' };
  const merged = normalize({ ...DEFAULTS, ...nextDraft.draftSettings }) as MissionSettings;

  return {
    reasoning: reasoningLines.join('\n'),
    planStatus: 'Mission parameters gathered',
    tasksCount: '2/2 tasks',
    tasks: [
      {
        id: 'gather-1',
        label: `Site & landing UTC (${siteShortName(merged.siteId)} · ${fmtDate(merged.startUTC, true)})`,
        status: 'done',
      },
      {
        id: 'gather-2',
        label: `Science & link budget (${merged.scienceMinutes} min · ${merged.dataMB} MB · ${fmtHours(merged.deadlineHours)} deadline)`,
        status: 'done',
      },
    ],
    content: `${introText}\n\n${summarizeDraftCard(merged)}\n\nClick **Check plan** below to run the NASA ephemeris & energy simulation and reflect the telemetry onto the 3D lunar view on the left.`,
    questionCard: null,
    actions: [
      {
        id: 'btn-check-plan',
        label: 'Check plan',
        kind: 'check_plan',
        payload: { settings: merged, intent: nextDraft.intent, searchMode: nextDraft.searchMode },
        variant: 'primary',
      },
      {
        id: 'btn-tune-hw',
        label: 'Customize solar / battery / station',
        kind: 'hardware_q',
        variant: 'secondary',
      },
    ],
    draft: nextDraft,
  };
}

function starterQuestionsByIntent(intent: PlannerIntent, merged: MissionSettings): {
  content: string;
  question: PlannerQuestionCard;
  reasoning: string;
} {
  if (intent === 'alternatives') {
    return {
      reasoning:
        'User wants to find a better site or landing date.\nNeed baseline reference site & date, search degrees of freedom (site, date, or both), and science constraint before scanning.',
      content:
        'I can scan all 3 prepared Shackleton Connecting Ridge locations and +0 to +6 day landing shifts using the real LOLA horizon and DE421 ephemerides.\n\nFirst, which **baseline site & landing date** should we compare against?',
      question: {
        title: '1/3 · Select the baseline mission to improve',
        options: [
          { id: 'base-crest', label: 'Connecting Ridge · Crest — 18 Nov 2026 (Default)' },
          { id: 'base-low', label: 'Connecting Ridge · Lower ground — 18 Nov 2026' },
          { id: 'base-shoulder', label: 'Connecting Ridge · Shoulder — 18 Nov 2026' },
          {
            id: 'base-current',
            label: `Active config (${siteShortName(merged.siteId)} · ${fmtDate(merged.startUTC, true)})`,
          },
        ],
        allowCustom: true,
      },
    };
  }

  if (intent === 'explain_fail') {
    return {
      reasoning:
        'User wants to inspect why a mission works or fails and how to read the views.\nOffer representative healthy vs. failing/constrained NASA South Pole scenarios first.',
      content:
        'Great — the fastest way to understand power, shadow, and DSN link limits is to simulate a concrete case and inspect it on the 3D scene and HUD.\n\nWhich **scenario** should we load for diagnosis?',
      question: {
        title: '1/2 · Which mission scenario would you like to diagnose?',
        options: [
          { id: 'diag-low', label: 'Lower ground shadow challenge (Ridge · Lower ground · 18 Nov 2026)' },
          { id: 'diag-stress', label: 'Tight 12h deadline + 250 MB heavy downlink stress test' },
          { id: 'diag-delay', label: 'Crest delayed landing (+3 days · 21 Nov 2026)' },
          { id: 'diag-crest', label: 'Healthy Crest baseline (18 Nov 2026 · 30 min / 100 MB)' },
        ],
        allowCustom: true,
      },
    };
  }

  if (intent === 'sample_walkthrough') {
    return {
      reasoning:
        'User chose sample mission walkthrough.\nAsk which reference landing site to anchor the walkthrough before presenting Check plan.',
      content:
        'Let’s walk through a real Lunar South Pole mission step by step using LOLA terrain horizons and DSN link modeling.\n\nWhich **sample site** would you like to explore?',
      question: {
        title: '1/2 · Pick a Connecting Ridge reference site',
        options: [
          { id: 'sample-crest', label: 'Connecting Ridge · Crest (18 Nov 2026 · Nominal passes)' },
          { id: 'sample-shoulder', label: 'Connecting Ridge · Shoulder (Lander reference site)' },
          { id: 'sample-low', label: 'Connecting Ridge · Lower ground (Harsher terrain shadows)' },
        ],
        allowCustom: true,
      },
    };
  }

  // Default: custom_setup
  return {
    reasoning:
      'User wants to set up their own custom mission.\nGather (1) landing site along Connecting Ridge, (2) landing UTC date, and (3) science duration / data volume / deadline before enabling Check plan.',
    content:
      'Let’s configure your custom South Pole mission step by step (smart NASA spacecraft defaults are preloaded and customizable).\n\nStep 1: Which **Connecting Ridge landing site** are we targeting?',
    question: {
      title: '1/3 · Choose your landing site',
      options: [
        { id: 'site-crest', label: 'Connecting Ridge · Crest (High solar ridge, 89.44° S)' },
        { id: 'site-shoulder', label: 'Connecting Ridge · Shoulder (Lander pad, 89.39° S)' },
        { id: 'site-low', label: 'Connecting Ridge · Lower ground (Terrain-shielded basin, 89.42° S)' },
      ],
      allowCustom: true,
    },
  };
}

/** Handles both structured Q&A steps and adaptive discovery inputs before Plan Check. */
export function advanceDiscoveryConversation(
  userInput: string,
  prevDraft: LunaDraftState,
  storeSnapshot: MissionStoreSnapshot
): LunaBrainTurnResult {
  const q = userInput.toLowerCase().trim();
  const baseMerged = normalize({ ...storeSnapshot.settings, ...prevDraft.draftSettings }) as MissionSettings;
  const { patch, notes } = parseMissionParameters(userInput, baseMerged);

  let intent: PlannerIntent | null = prevDraft.intent;
  if (!intent) {
    if (q.includes('better site') || q.includes('alternative') || q.includes('compare')) intent = 'alternatives';
    else if (q.includes('explain') || q.includes('fail') || q.includes('read the views')) intent = 'explain_fail';
    else if (q.includes('walk me') || q.includes('sample')) intent = 'sample_walkthrough';
    else if (q.includes('set up') || q.includes('own mission') || q.includes('custom')) intent = 'custom_setup';
  }

  // Handle shortcut presets embedded inside specific diagnostic option labels
  if (q.includes('heavy downlink stress')) {
    patch.siteId = patch.siteId || 'ridge-crest';
    patch.scienceMinutes = 60;
    patch.dataMB = 250;
    patch.deadlineHours = 12;
    patch.durationHours = 24;
  } else if (q.includes('delayed landing (+3 days)')) {
    patch.siteId = 'ridge-crest';
    patch.startUTC = new Date(Date.parse('2026-11-18T00:00:00Z') + 3 * 86400000).toISOString();
  }

  const nextDraft: LunaDraftState = {
    ...prevDraft,
    intent: intent || 'custom_setup',
    draftSettings: { ...prevDraft.draftSettings, ...patch },
    parsedNotes: [...prevDraft.parsedNotes, ...notes],
  };

  // Step 0 -> just selected one of the 4 initial paths (or freeform request)
  if (prevDraft.step === 0) {
    // If user typed a rich free-form prompt with >= 2 concrete params ("check shoulder nov 22 60 min 200 mb")
    if (
      !prevDraft.intent &&
      !q.includes('find a better site') &&
      !q.includes('set up my own') &&
      !q.includes('explain why a plan fails') &&
      !q.includes('walk me through')
    ) {
      if (Object.keys(patch).length >= 2 || q.startsWith('check ')) {
        return buildReadyToCheckResult(
          { ...nextDraft, step: 3 },
          `I parsed your custom mission request (${notes.join(' · ') || 'using NASA defaults for remaining fields'}).`,
          [
            `Detected freeform mission intent: "${userInput}"`,
            `Extracted parameters: ${notes.join(', ') || 'Baseline DEFAULTS'}`,
            'All required simulation parameters are populated; exposing Check plan CTA.',
          ]
        );
      }
    }

    const startFlow = starterQuestionsByIntent(nextDraft.intent!, baseMerged);
    return {
      reasoning: startFlow.reasoning,
      planStatus: 'Guided discovery started',
      tasksCount: '1/2 tasks',
      tasks: [
        { id: 'd1', label: `Objective selected: ${userInput}`, status: 'done' },
        { id: 'd2', label: 'Gather mission parameters for simulation', status: 'running' },
      ],
      content: startFlow.content,
      questionCard: startFlow.question,
      questionPendingText: 'Question pending - answer below',
      draft: { ...nextDraft, step: 1, phase: 'discovering' },
    };
  }

  // Subsequent guided steps depend on intent
  const mergedNow = normalize({ ...DEFAULTS, ...nextDraft.draftSettings }) as MissionSettings;

  // Hardware tuning optional card callback
  if (q === '__hardware_q__') {
    return {
      reasoning: 'User opted to tune spacecraft power / DSN station before checking.',
      content: 'Select a spacecraft power or ground station preset (or type your own values like `2 m2, 3 kWh, Goldstone`):',
      questionCard: {
        title: 'Optional · Tune Spacecraft & Ground Station',
        options: [
          { id: 'hw-default', label: 'Standard lander (1.2 m² solar · 2 kWh battery · Canberra DSS 43)' },
          { id: 'hw-highcap', label: 'High-endurance power (2.0 m² solar · 3.5 kWh battery · 20% reserve)' },
          { id: 'hw-goldstone', label: 'Switch DSN ground station to Goldstone · DSS 14' },
          { id: 'hw-madrid', label: 'Switch DSN ground station to Madrid · DSS 63' },
        ],
        allowCustom: true,
      },
      questionPendingText: 'Optional hardware selection pending - answer below',
      draft: { ...nextDraft, step: 99 },
    };
  }

  if (prevDraft.step === 99) {
    if (q.includes('high-endurance') || q.includes('3.5 kwh')) {
      nextDraft.draftSettings.areaM2 = 2.0;
      nextDraft.draftSettings.batteryKWh = 3.5;
      nextDraft.draftSettings.reservePct = 20;
    }
    return buildReadyToCheckResult(
      { ...nextDraft, step: 4 },
      'Updated hardware & link assumptions.',
      ['Applied hardware / ground station configuration.', 'All parameters validated against Rehearsal limits.']
    );
  }

  // PATH: custom_setup (3 steps after welcome)
  if (nextDraft.intent === 'custom_setup') {
    if (prevDraft.step === 1) {
      return {
        reasoning: `Captured landing site (${siteShortName(mergedNow.siteId)}).\nNext: gather landing date/time UTC in the 2026-2027 ephemeris window.`,
        content: `Got it — targeting **${SITE_LABELS[mergedNow.siteId] || mergedNow.siteId}**.\n\nStep 2: When should the lander touch down (UTC within **2026–2027**)?`,
        questionCard: {
          title: '2/3 · Choose landing date & time (UTC)',
          options: [
            { id: 'dt-nov18', label: '18 Nov 2026 · 00:00 UTC (Nominal mission baseline)' },
            { id: 'dt-nov19', label: '19 Nov 2026 · 00:00 UTC (+1 day landing slip)' },
            { id: 'dt-dec15', label: '15 Dec 2026 · 12:00 UTC (Peak summer illumination)' },
            { id: 'dt-mar01', label: '01 Mar 2027 · 06:00 UTC (2027 equinox test)' },
          ],
          allowCustom: true,
        },
        questionPendingText: 'Question pending - answer below',
        draft: { ...nextDraft, step: 2 },
      };
    }

    if (prevDraft.step === 2) {
      return {
        reasoning: `Landing UTC set to ${formatUtcReadable(mergedNow.startUTC)}.\nNext: science measurement duration, data return volume (MB), and return deadline.`,
        content: `Landing window locked to **${formatUtcReadable(mergedNow.startUTC)}**.\n\nStep 3: What **science activity & data return target** should we evaluate?`,
        questionCard: {
          title: '3/3 · Choose science measurement & deadline target',
          options: [
            { id: 'sci-nom', label: 'Nominal · 30 min measurement · 100 MB within 24 hours (Recommended)' },
            { id: 'sci-quick', label: 'Quick core assay · 15 min · 40 MB within 12 hours' },
            { id: 'sci-ext', label: 'Extended spectroscopy · 60 min · 250 MB within 36 hours' },
            { id: 'sci-heavy', label: 'Heavy radar sweep · 90 min · 400 MB within 48 hours' },
          ],
          allowCustom: true,
        },
        questionPendingText: 'Question pending - answer below',
        draft: { ...nextDraft, step: 3 },
      };
    }

    if (prevDraft.step >= 3) {
      if (q.includes('quick')) {
        nextDraft.draftSettings.scienceMinutes = 15;
        nextDraft.draftSettings.dataMB = 40;
        nextDraft.draftSettings.deadlineHours = 12;
        nextDraft.draftSettings.durationHours = 24;
      } else if (q.includes('extended')) {
        nextDraft.draftSettings.scienceMinutes = 60;
        nextDraft.draftSettings.dataMB = 250;
        nextDraft.draftSettings.deadlineHours = 36;
        nextDraft.draftSettings.durationHours = 48;
      } else if (q.includes('heavy')) {
        nextDraft.draftSettings.scienceMinutes = 90;
        nextDraft.draftSettings.dataMB = 400;
        nextDraft.draftSettings.deadlineHours = 48;
        nextDraft.draftSettings.durationHours = 48;
      } else if (q.includes('nominal')) {
        nextDraft.draftSettings.scienceMinutes = 30;
        nextDraft.draftSettings.dataMB = 100;
        nextDraft.draftSettings.deadlineHours = 24;
        nextDraft.draftSettings.durationHours = 24;
      }
      return buildReadyToCheckResult(
        { ...nextDraft, step: 4 },
        'I have everything needed to run your mission check.',
        [
          'Captured custom site, landing UTC, and science/downlink target.',
          'Prepared spacecraft defaults (1.2 m² vertical tracking PV, 2 kWh battery, 20% reserve, DSS 43).',
          'Ready to run Check plan.',
        ]
      );
    }
  }

  // PATH: alternatives (3 steps)
  if (nextDraft.intent === 'alternatives') {
    if (prevDraft.step === 1) {
      return {
        reasoning: `Baseline site/date selected (${siteShortName(mergedNow.siteId)}). Next ask what can move: site, date, or both.`,
        content: `Baseline set to **${siteShortName(mergedNow.siteId)} · ${formatUtcReadable(mergedNow.startUTC)}**.\n\nStep 2: What is allowed to change when we search for better options?`,
        questionCard: {
          title: '2/3 · Search scope',
          options: [
            { id: 'alt-both', label: 'Test both nearby sites & landing delays (+0 to +6 days) (Recommended)' },
            { id: 'alt-site', label: 'Keep landing date fixed · compare all 3 Connecting Ridge sites' },
            { id: 'alt-date', label: 'Keep site fixed · scan landing delays (+0 to +6 days)' },
          ],
          allowCustom: true,
        },
        questionPendingText: 'Question pending - answer below',
        draft: { ...nextDraft, step: 2 },
      };
    }

    if (prevDraft.step === 2) {
      const mode: 'site' | 'date' | 'both' =
        q.includes('keep landing date') || q.includes('site only')
          ? 'site'
          : q.includes('keep site') || q.includes('date only')
          ? 'date'
          : 'both';
      return {
        reasoning: `Search mode = ${mode}. Confirm science/deadline budget before enabling Check plan + search.`,
        content: `Search scope: **${mode === 'both' ? 'All 3 sites × 7 days (21 evaluations)' : mode === 'site' ? 'All 3 sites at fixed date' : 'Selected site across +0..6 days'}**.\n\nStep 3: Confirm the required **science & deadline** budget to hold constant across alternatives:`,
        questionCard: {
          title: '3/3 · Science requirement to preserve',
          options: [
            { id: 'req-nom', label: 'Nominal · 30 min measurement · 100 MB within 24h' },
            { id: 'req-tight', label: 'Tight window · 30 min · 100 MB within 12h' },
            { id: 'req-ext', label: 'Large dataset · 60 min · 250 MB within 36h' },
          ],
          allowCustom: true,
        },
        questionPendingText: 'Question pending - answer below',
        draft: { ...nextDraft, searchMode: mode, step: 3 },
      };
    }

    if (prevDraft.step >= 3) {
      if (q.includes('tight')) {
        nextDraft.draftSettings.scienceMinutes = 30;
        nextDraft.draftSettings.dataMB = 100;
        nextDraft.draftSettings.deadlineHours = 12;
        nextDraft.draftSettings.durationHours = 24;
      } else if (q.includes('large') || q.includes('250')) {
        nextDraft.draftSettings.scienceMinutes = 60;
        nextDraft.draftSettings.dataMB = 250;
        nextDraft.draftSettings.deadlineHours = 36;
        nextDraft.draftSettings.durationHours = 48;
      }
      return buildReadyToCheckResult(
        { ...nextDraft, step: 4 },
        'Your baseline & search constraints are ready. Click **Check plan** first to verify the baseline on the 3D view — then we can compare the best site/date alternatives.',
        [
          `Baseline + search scope (${nextDraft.searchMode}) + science constraints verified.`,
          'Ready for user to click Check plan.',
        ]
      );
    }
  }

  // PATH: explain_fail or sample_walkthrough
  if (prevDraft.step === 1) {
    const labelFocus = nextDraft.intent === 'explain_fail' ? 'diagnostic lens' : 'mission aspect';
    return {
      reasoning: `Scenario chosen (${siteShortName(mergedNow.siteId)}). Ask quick final focus preference before Check plan.`,
      content: `Scenario locked: **${SITE_LABELS[mergedNow.siteId] || mergedNow.siteId}** on **${formatUtcReadable(mergedNow.startUTC)}**.\n\nWhich **${labelFocus}** should I emphasize once we check the plan?`,
      questionCard: {
        title: nextDraft.intent === 'explain_fail' ? '2/2 · What should we focus on first?' : '2/2 · What do you want highlighted first?',
        options: [
          { id: 'foc-full', label: 'Full mission diagnosis (Power, Battery, Link & Deadline)' },
          { id: 'foc-solar', label: 'Solar terrain shadowing & battery reserve margin' },
          { id: 'foc-link', label: 'Earth visibility, DSN contact window & data downlink' },
        ],
        allowCustom: true,
      },
      questionPendingText: 'Question pending - answer below',
      draft: { ...nextDraft, step: 2 },
    };
  }

  const focusTopic = q.includes('solar') || q.includes('shadow') ? 'solar' : q.includes('link') || q.includes('earth') ? 'link' : 'full';
  return buildReadyToCheckResult(
    { ...nextDraft, focusTopic, step: 3 },
    'Everything is lined up.',
    [`Focus topic = ${focusTopic}.`, 'Ready for user to click Check plan and reflect in left 3D view.']
  );
}

/** Formats a checked NASA MissionResult into rich Luna chat guidance + follow-up buttons. */
export function buildCheckResultTurn(
  result: MissionResult,
  options: { isPreview?: boolean; intent?: PlannerIntent | null; focusTopic?: string } = {}
): Omit<LunaBrainTurnResult, 'draft'> {
  const { isPreview = false, intent = null, focusTopic } = options;
  const m = result.metrics;
  const s = result.settings;
  const rows = checkRows(result);
  const title = outcomeTitle(result, isPreview);

  const lines: string[] = [];
  lines.push(`### ${m.feasible ? 'Mission Check Passed' : 'Mission Limitation Detected'} — ${title}`);
  lines.push(
    `**${SITE_LABELS[s.siteId] || result.site.name}** · **${formatUtcReadable(s.startUTC)}** (${STATION_LABELS[s.stationId] || s.stationId})`
  );
  lines.push('');
  lines.push(m.reason);
  lines.push('');
  for (const row of rows) {
    lines.push(`[STATUS:${row.pass ? 'done' : 'failed'}:${row.label}]`);
  }
  lines.push('');
  lines.push(
    `**Key Telemetry:** Energy ready at **${fmtHours(m.readyHour)}** · Measurement complete **${fmtHours(
      m.scienceEndHour
    )}** · Result returned **${fmtHours(m.completeHour)}** · Deadline margin **${
      m.deadlineMarginHours === null ? 'Missed' : (m.deadlineMarginHours >= 0 ? '+' : '') + fmtHours(m.deadlineMarginHours)
    }**`
  );
  lines.push(
    `**Budget:** Solar harvested **${m.energyKWh.toFixed(2)} kWh** (${m.sunlitHours.toFixed(1)}h sunlight) · Lowest battery **${m.minSocPct.toFixed(
      1
    )}%** (reserve ${s.reservePct}%) · Ground contact **${fmtHours(m.contactHours)}** · Active TX **${fmtHours(
      m.transmissionHours
    )}** (${m.deliveredMB.toFixed(1)}/${s.dataMB} MB)`
  );

  if (focusTopic === 'solar') {
    lines.push(
      `\n*Solar focus:* Average gross PV harvest is ${(m.energyKWh * 1000 / s.durationHours).toFixed(0)} W over ${s.durationHours}h; stored energy must stay at least ${(
        m.requiredStartWh / 1000
      ).toFixed(2)} kWh before science can safely start.`
    );
  } else if (focusTopic === 'link') {
    lines.push(
      `\n*Downlink focus:* ${STATION_LABELS[s.stationId] || s.stationId} sees ${fmtHours(
        m.contactHours
      )} of geometric line-of-sight above its 10° elevation mask, yielding ${fmtHours(m.transmissionHours)} of powered transmission.`
    );
  }

  lines.push(
    `\nThe left window HUD and 3D lunar clock now reflect this ${isPreview ? 'previewed change' : 'checked plan'}. Choose a next step below or ask me anything (e.g., *"delay by 1 day"*, *"why did it fail?"*, *"try Shoulder"*).`
  );

  const actions: LunaActionButton[] = isPreview
    ? [
        ...(m.feasible
          ? [
              {
                id: 'act-adopt',
                label: 'Use revised plan',
                kind: 'adopt_preview' as const,
                variant: 'primary' as const,
              },
            ]
          : []),
        { id: 'act-discard', label: 'Keep original plan', kind: 'discard_preview', variant: 'secondary' },
        { id: 'act-search', label: 'Find a better site or date', kind: 'search_alternatives', payload: 'both', variant: 'secondary' },
        { id: 'act-latest', label: 'Latest safe start', kind: 'latest_start', variant: 'subtle' },
      ]
    : [
        {
          id: 'act-search',
          label: intent === 'alternatives' || !m.feasible ? 'Find a better site or date' : 'Compare sites & dates',
          kind: 'search_alternatives',
          payload: 'both',
          variant: !m.feasible || intent === 'alternatives' ? 'primary' : 'secondary',
        },
        { id: 'act-delay1d', label: 'Test +1 day delay', kind: 'test_delay', payload: { days: 1 }, variant: 'secondary' },
        { id: 'act-latest', label: 'Find latest safe start', kind: 'latest_start', variant: 'secondary' },
        { id: 'act-earth', label: 'Focus Earth link', kind: 'camera', payload: 'earth', variant: 'subtle' },
        { id: 'act-sun', label: 'Focus Sun view', kind: 'camera', payload: 'sun', variant: 'subtle' },
        { id: 'act-manual', label: 'Open Full Manual Report', kind: 'open_manual', variant: 'subtle' },
      ];

  return {
    reasoning: `Evaluated ${s.siteId} @ ${s.startUTC} via NASA LOLA/DE421 Rehearsal engine.\nFeasible: ${m.feasible} (cause: ${m.cause}).\nSyncing metrics, windows, and sample state to Unified Mission Store & Left HUD.`,
    planStatus: isPreview ? 'Preview calculated' : 'Mission check complete',
    tasksCount: '3/3 tasks',
    tasks: [
      { id: 'c1', label: 'Evaluate LOLA terrain horizon & DE421 illumination', status: 'done' },
      { id: 'c2', label: `Simulate battery dispatch & ${STATION_LABELS[s.stationId] || s.stationId} link budget`, status: 'done' },
      { id: 'c3', label: 'Sync verdict & live timeline to Left 3D HUD', status: 'done' },
    ],
    content: lines.join('\n'),
    actions,
    questionCard: null,
  };
}

export interface LunaConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ProcessFreeformLunaParams {
  userText: string;
  draft: LunaDraftState;
  storeSnapshot: MissionStoreSnapshot;
  history?: LunaConversationTurn[];
  chatEndpoint?: string;
  signal?: AbortSignal;
  onDelta?: (delta: OpenRouterDelta) => void;
}

const CANNED_FALLBACK_PREFIX = 'I’m the built-in guide, with a small set of supported actions';

const LUNA_OPENROUTER_TOOLS: OpenRouterTool[] = [
  {
    type: 'function',
    function: {
      name: 'evaluate_mission_plan',
      description:
        'Run the NASA LOLA terrain & JPL DE421 illumination/power/DSN link simulation for a Connecting Ridge South Pole landing scenario and sync it to the 3D Moon view and HUD.',
      parameters: {
        type: 'object',
        properties: {
          siteId: {
            type: 'string',
            enum: ['ridge-crest', 'ridge-shoulder', 'ridge-low'],
            description: 'Prepared Connecting Ridge landing site.',
          },
          startUTC: {
            type: 'string',
            description: 'Landing timestamp in ISO-8601 UTC within 2026-01-01 to 2027-12-31 (e.g. 2026-11-18T00:00:00Z).',
          },
          scienceMinutes: { type: 'number', description: 'Science measurement duration in minutes (1-240).' },
          dataMB: { type: 'number', description: 'Science data return target in MB (1-10000).' },
          deadlineHours: { type: 'number', description: 'Return deadline in hours after landing (1-168).' },
          stationId: {
            type: 'string',
            enum: ['canberra', 'goldstone', 'madrid'],
            description: 'Deep Space Network ground station.',
          },
          areaM2: { type: 'number', description: 'Solar array area in m^2.' },
          batteryKWh: { type: 'number', description: 'Battery capacity in kWh.' },
          reservePct: { type: 'number', description: 'Minimum battery reserve percentage.' },
          panelMode: {
            type: 'string',
            enum: ['vertical_tracking', 'tracking', 'horizontal'],
            description: 'Solar panel tracking mode.',
          },
          asPreview: {
            type: 'boolean',
            description: 'True to inspect as a preview without overwriting baseline; false to commit as current plan.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compare_sites_and_dates',
      description: 'Evaluate all 3 prepared Connecting Ridge sites and/or +0..+6 day landing shifts keeping science & hardware fixed.',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['both', 'site', 'date'],
            description: 'Search across both site & date, sites only, or dates only.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_latest_safe_start',
      description: 'Scan 15-minute start intervals to find the latest measurement start time that still meets the deadline.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'focus_3d_camera',
      description: 'Rotate the 3D lunar surface camera toward the Sun, Earth, or default lander view.',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', enum: ['sun', 'earth', 'default'] },
        },
        required: ['target'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'seek_timeline',
      description: 'Jump the 3D lunar simulation clock to a specific mission elapsed hour or toggle timeline playback.',
      parameters: {
        type: 'object',
        properties: {
          hour: { type: 'number', description: 'Elapsed mission hour to inspect.' },
          play: { type: 'boolean', description: 'Toggle timeline animation playback.' },
        },
      },
    },
  },
];

/** Processes freeform chat using local NASA engine + NVIDIA Nemotron 3 Ultra (OpenRouter) or configured BYOK LLM. */
export async function processFreeformLunaMessage({
  userText,
  draft,
  storeSnapshot,
  history = [],
  chatEndpoint,
  signal,
  onDelta,
}: ProcessFreeformLunaParams): Promise<LunaBrainTurnResult> {
  const q = userText.toLowerCase().trim();

  if (q === 'new plan' || q === 'start over' || q.includes('new mission setup')) {
    const fresh = createInitialLunaDraft();
    return {
      reasoning: 'Resetting guided setup flow at user request.',
      content: 'Starting a fresh mission setup. How would you like to begin?',
      questionCard: {
        title: 'How would you like to start with this mission?',
        options: [
          { id: 'opt-1', label: 'Find a better site or landing date' },
          { id: 'opt-2', label: 'Set up my own mission' },
          { id: 'opt-3', label: 'Explain why a plan fails & read the views' },
          { id: 'opt-4', label: 'Walk me through the sample mission' },
        ],
        allowCustom: true,
      },
      questionPendingText: 'Question pending - answer below',
      draft: fresh,
    };
  }

  let activeResult = storeSnapshot.preview || storeSnapshot.baseline;
  let currentDraft = draft;
  const baseSettings = activeResult?.settings || ({ ...DEFAULTS, ...currentDraft.draftSettings } as MissionSettings);

  // Respect explicit discovery starter clicks/phrases before a plan is checked
  if (
    !activeResult &&
    currentDraft.phase === 'discovering' &&
    currentDraft.step === 0 &&
    (q.includes('find a better site') ||
      q.includes('set up my own') ||
      q.includes('explain why a plan fails') ||
      q.includes('walk me through'))
  ) {
    return advanceDiscoveryConversation(userText, currentDraft, storeSnapshot);
  }

  const { patch, notes } = parseMissionParameters(userText, baseSettings);
  const guideReply = activeResult ? localGuide(userText, { result: activeResult }) : null;
  const mergedPatch: Partial<MissionSettings> = {
    ...(guideReply?.action === 'update' ? guideReply.params : {}),
    ...patch,
  };

  const hasQuestionIntent =
    userText.includes('?') ||
    /\b(why|explain|how|should|recommend|better|fix|improve|what if|would|could|tell me|compare)\b/i.test(userText);

  // Execute explicit parameter updates against the NASA Rehearsal engine immediately
  if (Object.keys(mergedPatch).length > 0 && (activeResult || Object.keys(mergedPatch).length >= 2 || q.startsWith('check') || q.startsWith('run'))) {
    const candidateSettings = normalize({ ...baseSettings, ...mergedPatch }) as MissionSettings;
    const isExplicitCheck = !activeResult || q.startsWith('check') || q.includes('apply') || q.includes('run ');
    const checkedRes = await missionPlannerStore.checkPlan(candidateSettings, {
      asPreview: !isExplicitCheck,
      markChecked: true,
      source: 'auto',
    });
    activeResult = checkedRes;
    currentDraft = { ...currentDraft, phase: 'checked', draftSettings: candidateSettings };
    const deterministicTurn = buildCheckResultTurn(checkedRes, { isPreview: !isExplicitCheck, intent: currentDraft.intent });

    if (!hasQuestionIntent) {
      return {
        ...deterministicTurn,
        reasoning: `Parsed parameter adjustments (${notes.join(', ') || 'guide rule'}).\nComputed revised NASA result (${checkedRes.metrics.feasible ? 'PASS' : checkedRes.metrics.cause}).`,
        content: `${guideReply?.action === 'update' ? guideReply.text + '\n\n' : ''}${deterministicTurn.content}`,
        draft: currentDraft,
      };
    }

    // Parameter update + open question -> enhance with Nemotron 3 Ultra grounded on the newly checked plan
    const llmResult = await callActiveLlm({
      userText,
      activeResult: checkedRes,
      draft: currentDraft,
      storeSnapshot: missionPlannerStore.getSnapshot(),
      localReply: deterministicTurn.content,
      history,
      chatEndpoint,
      signal,
      onDelta,
    });

    if (llmResult.usedLlm) {
      return {
        ...deterministicTurn,
        reasoning: llmResult.reasoning,
        content: llmResult.text,
        alreadyStreamed: llmResult.streamed,
        modelLabel: llmResult.modelName,
        draft: currentDraft,
      };
    }

    return {
      ...deterministicTurn,
      reasoning: `${deterministicTurn.reasoning}${llmResult.error ? `\nAI fallback note: ${llmResult.error.message}` : ''}`,
      actions: mergeMissingKeyAction(deterministicTurn.actions, llmResult.error),
      draft: currentDraft,
    };
  }

  if (activeResult && (guideReply?.action === 'latest' || q.includes('latest safe') || q.includes('last chance'))) {
    const latest: LatestStartResult = await missionPlannerStore.findLatestSafeStart();
    const msg =
      latest.hour === null
        ? `No safe measurement start works within the ${activeResult.settings.deadlineHours}h deadline across ${latest.tested} tested 15-minute slots under current constraints.`
        : `Latest safe measurement start is **T + ${fmtHours(latest.hour)}**, which completes data return by **T + ${fmtHours(
            latest.completeHour ?? null
          )}** (tested ${latest.tested} intervals). Jumped the left timeline scrubber to that start time so you can inspect lighting.`;
    if (latest.hour !== null) missionPlannerStore.setHour(latest.hour, false);
    return {
      reasoning: `Executed latestStart sweep across ${latest.tested} slots.`,
      planStatus: 'Latest safe start computed',
      tasksCount: '1/1 tasks',
      tasks: [{ id: 'lat-1', label: `Scanned ${latest.tested} start times (15-min grid)`, status: 'done' }],
      content: msg,
      actions: [
        { id: 'act-search2', label: 'Find a better site or date', kind: 'search_alternatives', payload: 'both', variant: 'secondary' },
        { id: 'act-manual2', label: 'Open Full Manual Report', kind: 'open_manual', variant: 'subtle' },
      ],
      draft: currentDraft,
    };
  }

  if (activeResult && guideReply?.action === 'compare') {
    const mode = (guideReply as any).mode || 'both';
    const choices = await missionPlannerStore.searchAlternatives(mode);
    return formatAlternativesResponse(choices, activeResult, currentDraft);
  }

  if (guideReply?.action === 'camera') {
    const cam: CameraFocusMode = (guideReply as any).camera === 'sun' ? 'sun' : 'earth';
    missionPlannerStore.setCameraFocus(cam);
    return {
      reasoning: `Shifted 3D surface camera to ${cam} focus.`,
      content: `${guideReply.text}\n\nRotated the left 3D Lunar surface camera toward **${cam === 'sun' ? 'the Sun' : 'Earth'}**.`,
      actions: [
        { id: 'cam-def', label: 'Reset 3D camera', kind: 'camera', payload: 'default', variant: 'subtle' },
        { id: 'cam-other', label: cam === 'sun' ? 'Focus Earth view' : 'Focus Sun view', kind: 'camera', payload: cam === 'sun' ? 'earth' : 'sun', variant: 'subtle' },
      ],
      draft: currentDraft,
    };
  }

  if (activeResult && guideReply?.action === 'seek') {
    const targetH = activeResult.metrics.firstTxHour;
    if (targetH !== null) {
      missionPlannerStore.setHour(targetH + Math.min(0.03, activeResult.metrics.transmissionHours / 2), false);
    }
    missionPlannerStore.setCameraFocus('earth');
    return {
      reasoning: 'Jumped scrubber to transmission milestone and aimed 3D camera toward Earth.',
      content: guideReply.text,
      actions: [{ id: 'cam-def2', label: 'Reset 3D camera', kind: 'camera', payload: 'default', variant: 'subtle' }],
      draft: currentDraft,
    };
  }

  if (guideReply?.action === 'play') {
    missionPlannerStore.togglePlay();
    return {
      reasoning: 'Toggled left HUD mission timeline playback.',
      content: guideReply.text,
      draft: currentDraft,
    };
  }

  // Open-ended or analytical question -> route directly to Nemotron 3 Ultra (OpenRouter) or active BYOK LLM
  const hasTopicLocalReply = Boolean(guideReply && !guideReply.text.startsWith(CANNED_FALLBACK_PREFIX));
  const localReply = hasTopicLocalReply ? guideReply!.text : '';

  const enhanced = await callActiveLlm({
    userText,
    activeResult,
    draft: currentDraft,
    storeSnapshot,
    localReply,
    history,
    chatEndpoint,
    signal,
    onDelta,
  });

  if (enhanced.usedLlm) {
    const baseActions: LunaActionButton[] = enhanced.toolActions.length
      ? enhanced.toolActions
      : activeResult
      ? [
          { id: 'act-alt3', label: 'Compare sites & dates', kind: 'search_alternatives', payload: 'both', variant: 'secondary' },
          { id: 'act-dly3', label: 'Test +1 day delay', kind: 'test_delay', payload: { days: 1 }, variant: 'secondary' },
          { id: 'act-man3', label: 'Open Full Manual Report', kind: 'open_manual', variant: 'subtle' },
        ]
      : [
          {
            id: 'act-chk-def',
            label: 'Check default mission plan',
            kind: 'check_plan',
            payload: { settings: normalize({ ...DEFAULTS, ...currentDraft.draftSettings }) },
            variant: 'primary',
          },
          { id: 'act-start-over', label: 'Guided mission setup', kind: 'start_over', variant: 'secondary' },
        ];

    return {
      reasoning: enhanced.reasoning,
      content: enhanced.text,
      actions: baseActions,
      draft: enhanced.updatedDraft,
      alreadyStreamed: enhanced.streamed,
      modelLabel: enhanced.modelName,
    };
  }

  // Fallback when OpenRouter key is missing or returned an API error
  const defaultActions: LunaActionButton[] = activeResult
    ? [
        { id: 'act-key-connect', label: 'Connect Nemotron 3 Ultra', kind: 'open_api_key', variant: 'primary' },
        { id: 'act-alt3', label: 'Compare sites & dates', kind: 'search_alternatives', payload: 'both', variant: 'secondary' },
        { id: 'act-man3', label: 'Open Full Manual Report', kind: 'open_manual', variant: 'subtle' },
      ]
    : [
        { id: 'act-key-connect', label: 'Connect Nemotron 3 Ultra', kind: 'open_api_key', variant: 'primary' },
        {
          id: 'act-chk-def',
          label: 'Check default mission plan',
          kind: 'check_plan',
          payload: { settings: normalize({ ...DEFAULTS, ...currentDraft.draftSettings }) },
          variant: 'secondary',
        },
        { id: 'act-start-over', label: 'Guided mission setup', kind: 'start_over', variant: 'subtle' },
      ];

  const errMsg = enhanced.error?.message || 'OpenRouter API key is not configured yet.';
  const isMissingKey = enhanced.error?.status === 401;

  if (hasTopicLocalReply) {
    return {
      reasoning: `Answered using local NASA mission explainer (OpenRouter unavailable: ${errMsg}).`,
      content: `${localReply}\n\n---\n*Note: ${
        isMissingKey
          ? `Connect your OpenRouter key (\`OPENROUTER_API_KEY\`) to enable live **${NEMOTRON_DISPLAY_NAME}** responses.`
          : `OpenRouter (${NEMOTRON_DISPLAY_NAME}) returned ${enhanced.error?.status || 'an error'}: ${errMsg}`
      }*`,
      actions: defaultActions,
      draft: currentDraft,
    };
  }

  const setupHint = isMissingKey
    ? `**${NEMOTRON_DISPLAY_NAME}** (\`${NEMOTRON_MODEL_ID}\`) via OpenRouter needs an API key before I can answer open-ended questions.\n\n- Click **Connect Nemotron 3 Ultra** below to paste your OpenRouter key (from ${OPENROUTER_KEYS_URL}), **or** add \`OPENROUTER_API_KEY="sk-or-v1-..."\` to \`.env.local\`.\n- Meanwhile, you can still run deterministic NASA checks or use **Guided mission setup**.`
    : `Could not reach **${NEMOTRON_DISPLAY_NAME}** via OpenRouter (${enhanced.error?.status ?? 'error'}): ${errMsg}\n\nCheck your OpenRouter key or credits, or run deterministic NASA checks below.`;

  return {
    reasoning: `OpenRouter error (${enhanced.error?.status ?? 'unavailable'}): ${errMsg}`,
    content: setupHint,
    actions: defaultActions,
    draft: currentDraft,
  };
}

/** Backwards-compatible wrapper for post-check message callers. */
export async function processPostCheckMessage(
  userText: string,
  draft: LunaDraftState,
  storeSnapshot: MissionStoreSnapshot,
  signal?: AbortSignal
): Promise<LunaBrainTurnResult> {
  return processFreeformLunaMessage({ userText, draft, storeSnapshot, signal });
}

function mergeMissingKeyAction(actions: LunaActionButton[] | undefined, error?: OpenRouterApiError): LunaActionButton[] | undefined {
  if (!error) return actions;
  const list = actions ? [...actions] : [];
  if (!list.some((a) => a.kind === 'open_api_key')) {
    list.push({ id: 'act-open-key', label: 'API Key Settings', kind: 'open_api_key', variant: 'subtle' });
  }
  return list;
}

export function formatAlternativesResponse(
  choices: AlternativeChoice[],
  reference: MissionResult,
  draft: LunaDraftState
): LunaBrainTurnResult {
  const passing = choices.filter((c) => c.metrics?.feasible);
  const top = (passing.length ? passing : choices.filter((c) => c.metrics)).slice(0, 3);

  const lines: string[] = [];
  if (passing.length) {
    lines.push(
      `Evaluated **${choices.filter((c) => c.metrics).length}** site/date combinations with your science & hardware fixed — **${passing.length}** pass your deadline:`
    );
  } else {
    lines.push(
      `None of the **${choices.filter((c) => c.metrics).length}** evaluated site/date combinations pass under current science/deadline limits. Closest attempts:`
    );
  }
  lines.push('');

  top.forEach((c, idx) => {
    const m = c.metrics!;
    lines.push(
      `${idx + 1}. **${siteShortName(c.site.id)}** · ${formatUtcReadable(c.settings.startUTC)} (${
        c.delay === 0 ? 'same day' : `+${c.delay}d`
      }) — ${m.feasible ? `**PASS** (returned in ${fmtHours(m.completeHour)})` : `**FAIL** (${m.cause})`} · Min batt ${m.minSocPct.toFixed(
        0
      )}% · ${m.energyKWh.toFixed(1)} kWh`
    );
  });

  lines.push('');
  lines.push('Click any option below to preview it directly on the 3D scene & HUD on the left before adopting it:');

  const actions: LunaActionButton[] = [
    ...top.map((c, idx) => ({
      id: `alt-preview-${idx}`,
      label: `Preview: ${siteShortName(c.site.id)} · ${fmtDate(c.settings.startUTC, true)} (${c.metrics?.feasible ? 'PASS' : 'FAIL'})`,
      kind: 'preview_alternative' as const,
      payload: c.settings,
      variant: (idx === 0 && c.metrics?.feasible ? 'primary' : 'secondary') as 'primary' | 'secondary',
    })),
    { id: 'alt-manual', label: 'Inspect full comparison matrix in Manual Mode', kind: 'open_manual', variant: 'subtle' },
  ];

  return {
    reasoning: `Ranked ${choices.length} alternatives against ${reference.site.id} @ ${reference.settings.startUTC}.`,
    planStatus: 'Alternative search complete',
    tasksCount: '2/2 tasks',
    tasks: [
      { id: 's1', label: `Evaluated ${choices.length} site/date candidates in background`, status: 'done' },
      { id: 's2', label: `Found ${passing.length} passing mission option(s)`, status: 'done' },
    ],
    content: lines.join('\n'),
    actions,
    draft,
  };
}

function buildGroundedContextSnapshot(
  activeResult: MissionResult | null,
  draft: LunaDraftState,
  storeSnapshot: MissionStoreSnapshot
): string {
  const sitesCatalog = missionPlannerStore.getSites().map((s) => ({
    id: s.id,
    name: s.name,
    latitude_deg: s.latitude_deg,
    longitude_deg: s.longitude_deg,
    elevation_m: s.ground_elevation_m,
    slope_deg: s.slope_deg,
  }));

  if (!activeResult) {
    return JSON.stringify({
      status: 'no_plan_checked_yet',
      draftSettings: normalize({ ...DEFAULTS, ...storeSnapshot.settings, ...draft.draftSettings }),
      availableSites: sitesCatalog,
      availableGroundStations: STATION_LABELS,
      ephemerisRangeUTC: '2026-01-01T00:00:00Z to 2027-12-31T23:59:59Z',
    });
  }

  const m = activeResult.metrics;
  const s = activeResult.settings;
  return JSON.stringify({
    status: storeSnapshot.preview ? 'preview_active' : 'baseline_checked',
    site: activeResult.site.name,
    siteId: s.siteId,
    startUTC: s.startUTC,
    durationHours: s.durationHours,
    station: STATION_LABELS[s.stationId] || s.stationId,
    feasible: m.feasible,
    cause: m.cause,
    reason: m.reason,
    checklist: checkRows(activeResult).map((r) => ({ check: r.key, pass: r.pass, label: r.label })),
    readyHour: m.readyHour,
    scienceStartHour: m.scienceStartHour,
    scienceEndHour: m.scienceEndHour,
    firstTxHour: m.firstTxHour,
    completeHour: m.completeHour,
    deadlineHours: s.deadlineHours,
    deadlineMarginHours: m.deadlineMarginHours,
    energyKWh: m.energyKWh,
    sunlitHours: m.sunlitHours,
    minSocPct: m.minSocPct,
    reservePct: s.reservePct,
    contactHours: m.contactHours,
    transmissionHours: m.transmissionHours,
    deliveredMB: m.deliveredMB,
    dataMB: s.dataMB,
    solarM2: s.areaM2,
    batteryKWh: s.batteryKWh,
    panelMode: s.panelMode,
    availableSites: sitesCatalog,
    availableGroundStations: STATION_LABELS,
  });
}

async function executeLunaToolCall(
  toolCall: OpenRouterToolCall,
  draft: LunaDraftState
): Promise<{ output: string; draft: LunaDraftState; actions: LunaActionButton[]; summary: string }> {
  let args: Record<string, any> = {};
  try {
    args = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};
  } catch {
    args = {};
  }

  const name = toolCall.function.name;
  const snap = missionPlannerStore.getSnapshot();
  const base = (snap.preview || snap.baseline)?.settings || snap.settings;

  if (name === 'evaluate_mission_plan') {
    const candidate = normalize({ ...base, ...args }) as MissionSettings;
    const asPreview = typeof args.asPreview === 'boolean' ? args.asPreview : Boolean(snap.hasCheckedPlan);
    const res = await missionPlannerStore.checkPlan(candidate, {
      asPreview,
      markChecked: true,
      source: 'auto',
    });
    const nextDraft: LunaDraftState = { ...draft, phase: 'checked', draftSettings: candidate };
    const turn = buildCheckResultTurn(res, { isPreview: asPreview, intent: nextDraft.intent });
    return {
      output: buildGroundedContextSnapshot(res, nextDraft, missionPlannerStore.getSnapshot()),
      draft: nextDraft,
      actions: turn.actions || [],
      summary: `evaluate_mission_plan(${res.site.id}, ${res.settings.startUTC}) -> ${res.metrics.feasible ? 'PASS' : 'FAIL'}`,
    };
  }

  if (name === 'compare_sites_and_dates') {
    const mode: 'both' | 'site' | 'date' =
      args.mode === 'site' || args.mode === 'date' ? args.mode : 'both';
    const ref = missionPlannerStore.getActiveResult();
    if (!ref) {
      await missionPlannerStore.checkPlan(base, { asPreview: false, markChecked: true, source: 'auto' });
    }
    const choices = await missionPlannerStore.searchAlternatives(mode);
    const active = missionPlannerStore.getActiveResult();
    const formatted = active ? formatAlternativesResponse(choices, active, draft) : null;
    const compact = choices.slice(0, 6).map((c) => ({
      siteId: c.site.id,
      siteName: c.site.name,
      startUTC: c.settings.startUTC,
      delayDays: c.delay,
      feasible: c.metrics?.feasible ?? false,
      cause: c.metrics?.cause,
      completeHour: c.metrics?.completeHour,
      minSocPct: c.metrics?.minSocPct,
      energyKWh: c.metrics?.energyKWh,
    }));
    return {
      output: JSON.stringify({ mode, candidates: compact }),
      draft,
      actions: formatted?.actions || [],
      summary: `compare_sites_and_dates(${mode}) -> ${choices.filter((c) => c.metrics?.feasible).length}/${choices.length} passing`,
    };
  }

  if (name === 'find_latest_safe_start') {
    if (!missionPlannerStore.getActiveResult()) {
      await missionPlannerStore.checkPlan(base, { asPreview: false, markChecked: true, source: 'auto' });
    }
    const latest = await missionPlannerStore.findLatestSafeStart();
    if (latest.hour !== null) missionPlannerStore.setHour(latest.hour, false);
    return {
      output: JSON.stringify(latest),
      draft,
      actions: [
        { id: 'act-search-tool', label: 'Compare sites & dates', kind: 'search_alternatives', payload: 'both', variant: 'secondary' },
      ],
      summary: `find_latest_safe_start() -> ${latest.hour === null ? 'none' : `T+${fmtHours(latest.hour)}`}`,
    };
  }

  if (name === 'focus_3d_camera') {
    const target: CameraFocusMode = args.target === 'sun' || args.target === 'earth' ? args.target : 'default';
    missionPlannerStore.setCameraFocus(target);
    return {
      output: JSON.stringify({ ok: true, cameraFocus: target }),
      draft,
      actions: [{ id: 'cam-reset-tool', label: 'Reset 3D camera', kind: 'camera', payload: 'default', variant: 'subtle' }],
      summary: `focus_3d_camera(${target})`,
    };
  }

  if (name === 'seek_timeline') {
    if (typeof args.hour === 'number' && Number.isFinite(args.hour)) {
      missionPlannerStore.setHour(Math.max(0, args.hour), false);
    }
    if (args.play === true) {
      missionPlannerStore.togglePlay();
    }
    return {
      output: JSON.stringify({ ok: true, hour: missionPlannerStore.getSnapshot().hour }),
      draft,
      actions: [],
      summary: `seek_timeline(hour=${args.hour ?? 'unchanged'}, play=${Boolean(args.play)})`,
    };
  }

  return {
    output: JSON.stringify({ error: `Unknown tool: ${name}` }),
    draft,
    actions: [],
    summary: `unknown(${name})`,
  };
}

function formatUsageReasoning(modelLabel: string, reasoning: string, toolLogs: string[], usage?: OpenRouterUsage): string {
  const sections: string[] = [`Powered by ${modelLabel} via OpenRouter`];
  if (toolLogs.length) {
    sections.push(`Simulation tools executed:\n- ${toolLogs.join('\n- ')}`);
  }
  if (reasoning.trim()) {
    sections.push(reasoning.trim());
  }
  if (usage && (usage.prompt_tokens || usage.completion_tokens || usage.total_tokens)) {
    const parts = [
      usage.prompt_tokens !== undefined ? `${usage.prompt_tokens} in` : '',
      usage.completion_tokens !== undefined ? `${usage.completion_tokens} out` : '',
      usage.cost !== undefined ? `$${Number(usage.cost).toFixed(6)}` : '',
    ].filter(Boolean);
    if (parts.length) sections.push(`Usage: ${parts.join(' · ')}`);
  }
  return sections.join('\n\n');
}

async function callActiveLlm({
  userText,
  activeResult,
  draft,
  storeSnapshot,
  localReply,
  history,
  chatEndpoint,
  signal,
  onDelta,
}: {
  userText: string;
  activeResult: MissionResult | null;
  draft: LunaDraftState;
  storeSnapshot: MissionStoreSnapshot;
  localReply: string;
  history: LunaConversationTurn[];
  chatEndpoint?: string;
  signal?: AbortSignal;
  onDelta?: (delta: OpenRouterDelta) => void;
}): Promise<{
  text: string;
  reasoning: string;
  usedLlm: boolean;
  streamed: boolean;
  modelName?: string;
  updatedDraft: LunaDraftState;
  toolActions: LunaActionButton[];
  error?: OpenRouterApiError;
}> {
  const keys = readStoredByokKeys();
  const activeModelId = getActiveByokModelId();
  const hasExplicitOtherModel =
    !isOpenRouterModelId(activeModelId) && Boolean(keys[activeModelId]?.trim());

  // Default & OpenRouter path: NVIDIA Nemotron 3 Ultra (`nvidia/nemotron-3-ultra-550b-a55b`)
  if (!hasExplicitOtherModel) {
    let workingDraft = draft;
    const groundedContext = buildGroundedContextSnapshot(activeResult, workingDraft, storeSnapshot);
    const systemPrompt = [
      `You are Luna, the AI mission planning assistant inside Luna Shift (powered by NVIDIA Nemotron 3 Ultra, model ID "${NEMOTRON_MODEL_ID}").`,
      'You help users plan, inspect, and troubleshoot Lunar South Pole (Connecting Ridge / Shackleton Rim, 2026–2027) lander missions using NASA LOLA terrain horizons, JPL DE421 solar/Earth ephemerides, battery energy margins, and DSN ground station links.',
      'Guidelines:',
      '- Be concise, practical, clear, and scientifically accurate.',
      '- ONLY cite simulation metrics and numbers present in the verified NASA snapshot or tool outputs (never fabricate mission telemetry).',
      '- Use the provided tools when the user asks to simulate/change parameters, compare sites/dates, find latest safe start, or aim the 3D camera/timeline.',
      `Current verified NASA mission state:\n${groundedContext}`,
      localReply ? `Deterministic local engine summary:\n${localReply}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const recentHistory: OpenRouterMessage[] = history
      .filter((m) => m.content.trim().length > 0)
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content }));

    const messages: OpenRouterMessage[] = [
      { role: 'system', content: systemPrompt },
      ...recentHistory,
      { role: 'user', content: userText },
    ];

    const toolLogs: string[] = [];
    const collectedActions: LunaActionButton[] = [];

    try {
      const firstPass = await callOpenRouterNemotron({
        model: NEMOTRON_MODEL_ID,
        messages,
        chatEndpoint,
        stream: true,
        max_tokens: 1200,
        temperature: 0.35,
        reasoning_effort: 'medium',
        tools: LUNA_OPENROUTER_TOOLS,
        tool_choice: 'auto',
        signal,
        onDelta,
      });

      if (firstPass.toolCalls.length > 0) {
        messages.push({
          role: 'assistant',
          content: firstPass.content || null,
          tool_calls: firstPass.toolCalls,
        });

        for (const tc of firstPass.toolCalls) {
          const exec = await executeLunaToolCall(tc, workingDraft);
          workingDraft = exec.draft;
          toolLogs.push(exec.summary);
          for (const act of exec.actions) {
            if (!collectedActions.some((existing) => existing.label === act.label)) {
              collectedActions.push(act);
            }
          }
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.function.name,
            content: exec.output,
          });
        }

        const secondPass = await callOpenRouterNemotron({
          model: NEMOTRON_MODEL_ID,
          messages,
          chatEndpoint,
          stream: true,
          max_tokens: 1200,
          temperature: 0.35,
          reasoning_effort: 'medium',
          signal,
          onDelta,
        });

        const finalContent = secondPass.content || firstPass.content || localReply;
        const combinedReasoning = [firstPass.reasoning, secondPass.reasoning].filter(Boolean).join('\n\n');
        return {
          text: finalContent,
          reasoning: formatUsageReasoning(
            `${NEMOTRON_DISPLAY_NAME} (${NEMOTRON_MODEL_ID})`,
            combinedReasoning,
            toolLogs,
            secondPass.usage || firstPass.usage
          ),
          usedLlm: Boolean(finalContent),
          streamed: Boolean(onDelta && finalContent),
          modelName: `${NEMOTRON_DISPLAY_NAME} (OpenRouter)`,
          updatedDraft: workingDraft,
          toolActions: collectedActions,
        };
      }

      if (firstPass.content) {
        return {
          text: firstPass.content,
          reasoning: formatUsageReasoning(
            `${NEMOTRON_DISPLAY_NAME} (${NEMOTRON_MODEL_ID})`,
            firstPass.reasoning,
            toolLogs,
            firstPass.usage
          ),
          usedLlm: true,
          streamed: Boolean(onDelta),
          modelName: `${NEMOTRON_DISPLAY_NAME} (OpenRouter)`,
          updatedDraft: workingDraft,
          toolActions: collectedActions,
        };
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' || signal?.aborted) {
        throw err;
      }
      const apiErr =
        err instanceof OpenRouterApiError
          ? err
          : new OpenRouterApiError(502, 502, err instanceof Error ? err.message : 'OpenRouter request failed.');
      return {
        text: localReply,
        reasoning: `OpenRouter (${NEMOTRON_MODEL_ID}) error ${apiErr.status}: ${apiErr.message}`,
        usedLlm: false,
        streamed: false,
        updatedDraft: workingDraft,
        toolActions: [],
        error: apiErr,
      };
    }

    return {
      text: localReply,
      reasoning: 'OpenRouter returned an empty response; using local NASA calculation summary.',
      usedLlm: false,
      streamed: false,
      updatedDraft: workingDraft,
      toolActions: [],
    };
  }

  // Legacy BYOK fallback providers if user explicitly chose & keyed another provider
  try {
    const modelId = activeModelId;
    const apiKey = keys[modelId].trim();
    const groundedContext = buildGroundedContextSnapshot(activeResult, draft, storeSnapshot);
    const systemPrompt =
      `You are Luna, the Luna Shift lunar South Pole mission planning assistant. Always be concise, practical, and scientifically accurate. You must ONLY state numerical values from this verified NASA calculation snapshot (never invent numbers):\n${groundedContext}${
        localReply ? `\nFallback engine note:\n${localReply}` : ''
      }`;

    const timeoutController = new AbortController();
    const timeoutId = window.setTimeout(() => timeoutController.abort(), 15000);
    const combinedSignal = signal
      ? (AbortSignal as any).any
        ? (AbortSignal as any).any([signal, timeoutController.signal])
        : timeoutController.signal
      : timeoutController.signal;

    try {
      if (modelId.startsWith('gemini')) {
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(
            apiKey
          )}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: combinedSignal,
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\nUser question: ${userText}` }] }],
            }),
          }
        );
        if (!resp.ok) throw new Error(`Gemini HTTP ${resp.status}`);
        const data = await resp.json();
        const out = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (out) {
          return {
            text: out,
            reasoning: `Enhanced response with Gemini (BYOK) grounded on real NASA engine metrics.`,
            usedLlm: true,
            streamed: false,
            modelName: 'Gemini (BYOK)',
            updatedDraft: draft,
            toolActions: [],
          };
        }
      } else if (modelId.startsWith('claude')) {
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          signal: combinedSignal,
          body: JSON.stringify({
            model: modelId === 'claude-3-opus' ? 'claude-3-opus-20240229' : 'claude-3-5-sonnet-latest',
            max_tokens: 600,
            system: systemPrompt,
            messages: [{ role: 'user', content: userText }],
          }),
        });
        if (!resp.ok) throw new Error(`Anthropic HTTP ${resp.status}`);
        const data = await resp.json();
        const out = data?.content?.[0]?.text?.trim();
        if (out) {
          return {
            text: out,
            reasoning: `Enhanced response with ${modelId} grounded on real NASA engine metrics.`,
            usedLlm: true,
            streamed: false,
            modelName: modelId,
            updatedDraft: draft,
            toolActions: [],
          };
        }
      } else if (modelId.startsWith('gpt') || modelId.startsWith('deepseek')) {
        const endpoint = modelId.startsWith('deepseek')
          ? 'https://api.deepseek.com/chat/completions'
          : 'https://api.openai.com/v1/chat/completions';
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          signal: combinedSignal,
          body: JSON.stringify({
            model: modelId.startsWith('deepseek') ? 'deepseek-chat' : 'gpt-4o-mini',
            messages: [
              { role: 'system', content: systemPrompt },
              ...history.slice(-8).map((m) => ({ role: m.role, content: m.content })),
              { role: 'user', content: userText },
            ],
            max_tokens: 600,
          }),
        });
        if (!resp.ok) throw new Error(`LLM HTTP ${resp.status}`);
        const data = await resp.json();
        const out = data?.choices?.[0]?.message?.content?.trim();
        if (out) {
          return {
            text: out,
            reasoning: `Enhanced response with ${modelId} grounded on real NASA engine metrics.`,
            usedLlm: true,
            streamed: false,
            modelName: modelId,
            updatedDraft: draft,
            toolActions: [],
          };
        }
      }
    } finally {
      window.clearTimeout(timeoutId);
    }
  } catch (err) {
    if ((err as Error)?.name === 'AbortError' || signal?.aborted) throw err;
  }

  return {
    text: localReply,
    reasoning: 'Answered using built-in NASA mission explainer.',
    usedLlm: false,
    streamed: false,
    updatedDraft: draft,
    toolActions: [],
  };
}
