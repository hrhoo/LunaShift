import React, { memo, useEffect, useRef } from 'react';
import '../manual-planner/manual-planner.css';
import '../manual-planner/planner-theme.css';
import { hydrate, icon } from '../manual-planner/icons.js';
import { DEFAULTS, evaluate, latestStart, distanceKm, sampleAt, normalize } from '../manual-planner/core/rehearsal.js';
import { MissionScene } from '../manual-planner/scene.js';
import { drawHorizon, drawTimeline, drawMap, fmtHours, fmtDate, timeUTC, escapeHTML as esc } from '../manual-planner/charts.js';
import '../manual-planner/event-slider.css';
import { attachEventLabels, syncEventLabels } from '../manual-planner/event-slider.js';
import { PlannerFlow } from '../manual-planner/planner-flow.js';
import { missionPlannerStore } from '../manual-planner/missionStore';

export interface ManualPlannerPageProps {
  active?: boolean;
  onBack?: () => void;
  onWatchOverview?: () => void;
}

const ManualPlannerDom = memo(function ManualPlannerDom({
  onBackClick,
}: {
  onBackClick: () => void;
}) {
  return (
    <>
      <header className="header">
        <button
          type="button"
          className="brand-emblem-btn"
          id="brandHome"
          aria-label="Back to Luna Planner"
          title="Back to Luna Planner"
          onClick={onBackClick}
        >
          <img src="/assets/aistudio/Luna_Shift__3__4181c459.png" alt="LunaShift Logo" />
        </button>
        <div className="header-right">
          <button id="sourceBtn" type="button" className="text-btn">
            <span data-icon="layers" /> Sources &amp; assumptions
          </button>
          <button
            type="button"
            className="manual-header-back"
            onClick={onBackClick}
            aria-label="Back to Luna Planner"
            title="Back to Luna Planner"
          >
            <span data-icon="left" /> Back
          </button>
        </div>
      </header>

      <main id="plannerPage">
        <section className="planner-heading luna-planner-heading">
          <div>
            <div className="eyebrow">MISSION CHECK / LUNAR SOUTH POLE</div>
            <h1>Does your plan still work?</h1>
            <p>Check your mission. Test a change. Keep the decision yours.</p>
          </div>
          <div className="heading-actions">
            <button id="exportBtn" type="button" className="secondary" title="Export the inspected calculation">
              <span data-icon="download" />
              Export
            </button>
            <button id="compareBtn" type="button" className="secondary">
              <span data-icon="compare" />
              Test a change
            </button>
          </div>
        </section>

        <nav className="decision-steps" aria-label="Planning steps">
          <span data-step="1" className="active">
            <b>1</b>Check your plan
          </span>
          <i />
          <span data-step="2">
            <b>2</b>Test a change
          </span>
          <i />
          <span data-step="3">
            <b>3</b>Keep or replace
          </span>
        </nav>

        <section className="current-plan-strip" id="committedPlan" aria-label="Your current evaluated plan" />
        <section className="decision-workspace" id="decisionWorkspace" aria-label="Guided mission decision">
          <div id="decisionBody" aria-live="polite" />
        </section>

        <div className="planner-detail-links">
          <button id="viewEvidence" type="button">
            <span data-icon="horizon" />
            Explore the calculated mission
            <span data-icon="down" />
          </button>
          <button id="editPlanDetails" type="button">
            <span data-icon="settings" />
            Plan details &amp; hardware
          </button>
          <span>Three prepared sites · computed forecasts, not mission certification</span>
        </div>

        <details id="planEditor" className="planner-editor">
          <summary>
            <span data-icon="settings" />
            Direct controls <small>Changes are previewed before you use them</small>
          </summary>
          <section className="scenario-bar" aria-label="Mission settings">
            <label className="site-field">
              <span>
                <i data-icon="pin" /> LANDING SITE
              </span>
              <select id="siteInput" aria-label="Landing site" defaultValue="ridge-crest">
                <option value="ridge-crest">Connecting Ridge · Crest</option>
                <option value="ridge-shoulder">Connecting Ridge · Shoulder</option>
                <option value="ridge-low">Connecting Ridge · Lower ground</option>
              </select>
            </label>
            <label>
              <span>
                <i data-icon="clock" /> LANDING TIME · UTC
              </span>
              <input id="dateInput" type="datetime-local" defaultValue="2026-11-18T00:00" min="2026-01-01T00:00" max="2027-12-24T00:00" />
            </label>
            <label>
              <span>
                <i data-icon="orbit" /> EVALUATE
              </span>
              <select id="durationInput" defaultValue="24">
                <option value="6">6 hours</option>
                <option value="24">24 hours</option>
                <option value="72">3 days</option>
                <option value="168">7 days</option>
              </select>
            </label>
            <button id="missionBtn" type="button" className="mission-edit">
              <span className="small-symbol" data-icon="flask" />
              <span>
                <b id="missionSummary">30 min measurement · 100 MB</b>
                <small>
                  Edit activity &amp; hardware <span data-icon="settings" />
                </small>
              </span>
            </button>
            <button id="runBtn" type="button" className="run-btn">
              <span data-icon="play" />
              <span>Check changes</span>
            </button>
          </section>
        </details>

        <div id="validation" role="alert" hidden />

        <details id="missionEvidence" className="mission-evidence">
          <summary>
            <span data-icon="horizon" />
            <strong>Mission evidence</strong>
            <span>3D view, horizon, power, and contact timeline</span>
            <i data-icon="down" />
          </summary>
          <div className="evidence-context" id="evidenceContext">
            Inspecting your current plan
          </div>
          <section className="metrics-row" aria-label="Live mission values">
            <button className="metric" type="button" data-jump="sun">
              <span className="metric-icon gold" data-icon="sun" />
              <span className="metric-content">
                <small>SOLAR GENERATION</small>
                <b id="powerValue">
                  — <em>W</em>
                </b>
                <span id="powerNote">Loading geometry</span>
              </span>
              <span className="metric-chevron" data-icon="chevron" />
            </button>
            <button className="metric" type="button" data-jump="ready">
              <span className="metric-icon sage" data-icon="battery" />
              <span className="metric-content">
                <small>BATTERY CHARGE</small>
                <b id="batteryValue">
                  — <em>%</em>
                </b>
                <span id="batteryNote">Includes initial charge</span>
              </span>
              <span className="metric-chevron" data-icon="chevron" />
            </button>
            <button className="metric" type="button" data-jump="transmit">
              <span className="metric-icon blue" data-icon="antenna" />
              <span className="metric-content">
                <small>GROUND CONNECTION</small>
                <b id="linkValue" className="word-value">
                  —
                </b>
                <span id="linkNote">Canberra · DSS 43</span>
              </span>
              <span className="metric-chevron" data-icon="chevron" />
            </button>
            <button className="metric" type="button" data-jump="complete">
              <span className="metric-icon teal" data-icon="data" />
              <span className="metric-content">
                <small>SCIENCE DATA RETURNED</small>
                <b id="dataValue">
                  — <em>MB</em>
                </b>
                <span id="dataNote">After measurement completion</span>
              </span>
              <span className="metric-chevron" data-icon="chevron" />
            </button>
          </section>

          <div className="workspace" id="workspace">
            <div className="visual-column">
              <section className="mission-stage" id="missionStage">
                <div className="stage-toolbar">
                  <div className="stage-name">
                    <i className="live-dot" />
                    <b>Surface rehearsal</b>
                    <span id="roleBadge">CURRENT PLAN</span>
                  </div>
                  <div className="stage-actions">
                    <button id="revealBtn" type="button" className="active" title="Show outlined positions behind terrain" aria-pressed="true">
                      <span data-icon="eye" /> Reveal hidden bodies
                    </button>
                    <button id="mapToggle" type="button" title="Show site map" aria-label="Show site map">
                      <span data-icon="pin" />
                    </button>
                    <button id="expandBtn" type="button" title="Expand view" aria-label="Expand 3D view">
                      <span data-icon="expand" />
                    </button>
                  </div>
                </div>

                <div className="scene-wrap" id="sceneWrap">
                  <canvas id="sceneCanvas" aria-label="Interactive 3D lunar lander scene. Drag to orbit and scroll to zoom." />
                  <div className="scene-top">
                    <div className="scene-location">
                      <small>CONNECTING RIDGE</small>
                      <strong id="sceneSite">Crest</strong>
                      <span id="sceneCoordinates">89.43891° S · 137.14357° W</span>
                    </div>
                    <div className="scene-time">
                      <small>SIMULATION TIME · UTC</small>
                      <strong id="sceneUTC">18 NOV 2026 · 00:00</strong>
                      <span id="elapsedLabel">T + 00h 00m</span>
                    </div>
                  </div>

                  <div id="sceneLabels">
                    <button className="celestial-label" type="button" data-body="sun" title="Face the Sun">
                      <i className="body-icon sun-icon" />
                      <span>
                        <strong>Sun</strong>
                        <small>Loading</small>
                      </span>
                    </button>
                    <button className="celestial-label" type="button" data-body="earth" title="Face Earth">
                      <i className="body-icon earth-icon" />
                      <span>
                        <strong>Earth</strong>
                        <small>Loading</small>
                      </span>
                    </button>
                  </div>

                  <div className="scene-phase">
                    <span id="phaseIcon" className="phase-icon" data-icon="sun" />
                    <div>
                      <small>LANDER ACTIVITY</small>
                      <b id="phaseLabel">Preparing the mission</b>
                      <span id="phaseDetail">One simulation. Connected results.</span>
                    </div>
                  </div>

                  <div className="scene-map" id="sceneMap" hidden>
                    <div>
                      <b>Site map</b>
                      <small>Three prepared points</small>
                    </div>
                    <canvas id="mapCanvas" width={290} height={220} aria-label="Local site map" />
                    <span>LOLA elevations · contours 100 m</span>
                  </div>

                  <div className="camera-controls" role="group" aria-label="Camera views">
                    <button type="button" data-camera="orbit" className="active">
                      <span data-icon="orbit" />
                      Orbit lander
                    </button>
                    <button type="button" data-camera="surface">
                      <span data-icon="horizon" />
                      Surface
                    </button>
                    <button type="button" data-camera="sun">
                      <span data-icon="sun" />
                      Toward Sun
                    </button>
                    <button type="button" data-camera="earth">
                      <span data-icon="earth" />
                      Toward Earth
                    </button>
                    <button type="button" data-camera="map">
                      <span data-icon="pin" />
                      Terrain
                    </button>
                  </div>

                  <div id="sceneFallback" hidden>
                    <span data-icon="horizon" />
                    <h3>Interactive horizon view</h3>
                    <p>WebGL is unavailable in this browser. The mission calculations, timeline, and comparisons still work.</p>
                  </div>
                </div>

                <div className="scene-caption">
                  <span>Drag to orbit · scroll to zoom</span>
                  <span>Measured 3 km terrain · angular skyline to 80 km · enhanced viewing exposure</span>
                </div>
                <div className="horizon-head">
                  <span>
                    <b>Local horizon</b> <small>From the selected equipment height</small>
                  </span>
                  <span className="horizon-key">
                    <i />
                    Terrain <i className="key-sun" />
                    Sun <i className="key-earth" />
                    Earth
                  </span>
                </div>
                <canvas id="horizonCanvas" aria-label="Azimuth versus elevation showing terrain, Sun, Earth, and the selected station" />
              </section>
            </div>
          </div>

          <section className="timeline-section">
            <div className="timeline-title">
              <div>
                <span className="eyebrow">ONE SHARED MISSION CLOCK</span>
                <h2>From sunlight to science return</h2>
              </div>
              <div className="play-controls">
                <button id="resetTime" type="button" className="icon-btn" title="Return to landing" aria-label="Return to landing">
                  <span data-icon="reset" />
                </button>
                <button id="playBtn" type="button" className="play-btn">
                  <span data-icon="play" />
                  <span>Play mission</span>
                </button>
                <select id="speedInput" aria-label="Playback speed" defaultValue=".25">
                  <option value=".05">3 min / sec</option>
                  <option value=".25">15 min / sec</option>
                  <option value="1">1 hour / sec</option>
                  <option value="6">6 hours / sec</option>
                </select>
              </div>
            </div>

            <div className="time-scrubber">
              <span id="timeReadout">T + 0h</span>
              <label htmlFor="timeRange" className="sr-only">
                Mission elapsed time
              </label>
              <input id="timeRange" type="range" min="0" max="24" defaultValue="0" step=".001" />
              <div id="milestones" aria-label="Jump to a calculated mission event" />
            </div>
            <div className="timeline-plot">
              <canvas id="timelineCanvas" aria-label="Mission timeline showing sunlight, battery charge, measurement, Earth visibility, and transmission" />
            </div>
            <div className="timeline-legend" aria-label="Timeline legend">
              <span><i style={{ background: '#b88900' }} />Sunlight</span>
              <span><i className="charge-key" />Battery: high → low</span>
              <span><i style={{ background: '#1e40af' }} />Measurement</span>
              <span><i style={{ background: '#115e59' }} />Earth visible / ground contact</span>
              <span><i style={{ background: '#a78bfa' }} />Transmitting</span>
            </div>
            <div className="timeline-bottom">
              <p id="completionSummary">Calculating your mission…</p>
              <button id="latestBtn" type="button" className="text-btn">
                <span data-icon="clock" /> Find latest tested start
              </button>
            </div>
            <div id="latestResult" className="latest-result" hidden />
          </section>

          <section className="compare-section" id="compareSection" hidden>
            <div className="section-head">
              <div>
                <span className="eyebrow">THE SAME MISSION. DIFFERENT POSSIBILITIES.</span>
                <h2>Compare sites &amp; landing dates</h2>
                <p id="compareDescription">Hardware and activity requirements remain fixed.</p>
              </div>
              <div className="compare-scope">
                <label htmlFor="searchMode">Allow changes to</label>
                <select id="searchMode" defaultValue="both">
                  <option value="both">Site &amp; date</option>
                  <option value="site">Location only</option>
                  <option value="date">Date only</option>
                </select>
                <button id="searchBtn" type="button" className="secondary">
                  <span data-icon="compare" />
                  Evaluate options
                </button>
              </div>
            </div>
            <div className="compare-cards" id="compareCards" />
            <div className="atlas-wrap">
              <div className="atlas-header">
                <b>Mission completion map</b>
                <span>
                  <i className="pass-dot" />
                  Objective met <i className="fail-dot" />
                  Inspect limitation
                </span>
              </div>
              <div id="atlas" />
              <p className="atlas-note">
                Each cell is a computed scenario, not an interpolated guarantee. Select one to inspect it. The earliest/closest claims apply only to the tested set.
              </p>
            </div>
            <div id="comparisonDetail" />
          </section>
        </details>

        <footer className="footer">
          <span className="footer-brand">
            Luna Shift <span>·</span> An independent lunar planning prototype
          </span>
          <span>
            Prepared LOLA / DE421 data · 2026–2027{' '}
            <button id="footerSources" type="button">
              Model boundaries
            </button>
          </span>
        </footer>
      </main>

      <dialog id="settingsDialog">
        <form id="settingsForm">
          <div className="dialog-head">
            <div>
              <span className="eyebrow">KEEP THE ASSUMPTIONS VISIBLE</span>
              <h2>Activity &amp; spacecraft</h2>
            </div>
            <button type="button" data-close-dialog="" className="icon-btn" aria-label="Close settings">
              <span data-icon="close" />
            </button>
          </div>
          <p className="dialog-lead">
            A generic lander, one measurement, and a resumable data return. These are editable scenario assumptions, not specifications of a NASA vehicle.
          </p>
          <div className="settings-grid">
            <fieldset>
              <legend>
                <span data-icon="flask" /> Science objective
              </legend>
              <label>
                Measurement duration <span>minutes</span>
                <input name="scienceMinutes" type="number" min="1" max="240" step="1" required />
              </label>
              <label>
                Instrument power <span>W, in addition to housekeeping</span>
                <input name="scienceW" type="number" min="0" max="2000" step="1" required />
              </label>
              <label>
                Data produced <span>decimal MB</span>
                <input name="dataMB" type="number" min=".01" max="100000" step="any" required />
              </label>
              <label>
                Return deadline <span>hours after landing</span>
                <input name="deadlineHours" type="number" min=".1" max="168" step="any" required />
              </label>
            </fieldset>
            <fieldset>
              <legend>
                <span data-icon="sun" /> Solar array
              </legend>
              <label>
                Active panel area <span>m², total</span>
                <input name="areaM2" type="number" min=".1" max="100" step=".1" required />
              </label>
              <label>
                Panel orientation
                <select name="panelMode">
                  <option value="vertical_tracking">Vertical · azimuth tracking</option>
                  <option value="tracking">Ideal two-axis tracking</option>
                  <option value="horizontal">Horizontal · fixed</option>
                  <option value="fixed">Fixed tilt &amp; azimuth</option>
                </select>
              </label>
              <div className="field-pair">
                <label>
                  Fixed tilt <span>degrees</span>
                  <input name="tiltDeg" type="number" min="0" max="180" step="1" required />
                </label>
                <label>
                  Fixed azimuth <span>° clockwise from north</span>
                  <input name="azimuthDeg" type="number" min="0" max="360" step="1" required />
                </label>
              </div>
              <label>
                Conversion efficiency <span>fraction</span>
                <input name="efficiency" type="number" min=".01" max="1" step=".01" required />
              </label>
              <label>
                Panel height <span>m above local ground</span>
                <input name="heightM" type="number" min=".1" max="30" step=".1" required />
              </label>
            </fieldset>
            <fieldset>
              <legend>
                <span data-icon="battery" /> Battery &amp; loads
              </legend>
              <label>
                Capacity <span>kWh</span>
                <input name="batteryKWh" type="number" min=".1" max="100" step=".1" required />
              </label>
              <div className="field-pair">
                <label>
                  Initial charge <span>%</span>
                  <input name="initialSocPct" type="number" min="0" max="100" step="1" required />
                </label>
                <label>
                  Reserve <span>%</span>
                  <input name="reservePct" type="number" min="0" max="99" step="1" required />
                </label>
              </div>
              <label>
                Housekeeping power <span>W, always active</span>
                <input name="loadW" type="number" min="0" max="3000" step="1" required />
              </label>
              <p>
                Charge and discharge efficiency: 95%. Radio demand is added during transmission. The activity starts only with enough stored energy to finish without future solar input.
              </p>
            </fieldset>
            <fieldset>
              <legend>
                <span data-icon="antenna" /> Ground link
              </legend>
              <label>
                Reference ground station
                <select name="stationId">
                  <option value="canberra">Canberra · DSS 43</option>
                  <option value="goldstone">Goldstone · DSS 14</option>
                  <option value="madrid">Madrid · DSS 63</option>
                </select>
              </label>
              <label>
                Maximum physical rate <span>Mbit/s, before 85% protocol factor</span>
                <input name="maxRateMbps" type="number" min=".001" max="100" step="any" required />
              </label>
              <label>
                RF transmit power <span>W</span>
                <input name="txPowerW" type="number" min=".01" max="100" step="any" required />
              </label>
              <label>
                Lander antenna gain <span>dBi</span>
                <input name="txGainDbi" type="number" min="0" max="60" step="any" required />
              </label>
              <p>
                8.4 GHz · ground G/T 50 dB/K · 10° Earth-side elevation mask · 0.2° lunar clearance. Assumed station access, not a reservation. Full constants are included in exports.
              </p>
            </fieldset>
          </div>
          <div className="dialog-actions">
            <button type="button" id="defaultSettings" className="text-btn">
              Restore example hardware
            </button>
            <button type="submit" className="primary">
              Preview changes <span data-icon="arrow" />
            </button>
          </div>
        </form>
      </dialog>

      <dialog id="sourcesDialog">
        <div className="dialog-head">
          <div>
            <span className="eyebrow">DATA &amp; MODEL TRANSPARENCY</span>
            <h2>What this result is built on</h2>
          </div>
          <button type="button" data-close-dialog="" className="icon-btn" aria-label="Close sources">
            <span data-icon="close" />
          </button>
        </div>
        <div id="sourcesContent" />
      </dialog>

      <dialog id="explainDialog">
        <div className="dialog-head">
          <div>
            <span className="eyebrow">CALCULATION BREAKDOWN</span>
            <h2>Why this result occurs</h2>
          </div>
          <button type="button" data-close-dialog="" className="icon-btn" aria-label="Close explanation">
            <span data-icon="close" />
          </button>
        </div>
        <div id="explainContent" />
      </dialog>

      <div className="busy-banner" id="busyBanner" role="status" hidden>
        <span className="spinner" />
        <span id="busyText">Calculating your mission</span>
        <progress id="busyProgress" max={1} value={0} />
      </div>
      <div className="toast" id="toast" role="status" hidden />
    </>
  );
}, () => true);

export default function ManualPlannerPage({ active = true, onBack, onWatchOverview }: ManualPlannerPageProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef(active);
  const onBackRef = useRef(onBack);
  const onWatchOverviewRef = useRef(onWatchOverview);
  const sceneRef = useRef<any>(null);

  activeRef.current = active;
  onBackRef.current = onBack;
  onWatchOverviewRef.current = onWatchOverview;

  useEffect(() => {
    const scene = sceneRef.current;
    const evidenceEl = document.getElementById('missionEvidence') as HTMLDetailsElement | null;
    if (scene) scene.active = active && Boolean(evidenceEl?.open);
  }, [active]);

  useEffect(() => {
    const root = shellRef.current;
    if (!root) return;

    let destroyed = false;
    let rafId = 0;
    let detachEventLabels: (() => void) | undefined;
    let notifyTimer = 0;
    let isBootstrapping = true;
    let manualTouched = false;
    const abortController = new AbortController();
    const { signal } = abortController;

    const $ = (id: string) => document.getElementById(id);
    const snapOnMount = missionPlannerStore.getSnapshot();

    const state: any = {
      bundle: null,
      baseline: null,
      result: null,
      alternative: null,
      choices: [],
      settings: { ...(snapOnMount.settings || DEFAULTS) },
      hour: snapOnMount.hour || 0,
      playing: false,
      speed: 0.25,
      busy: false,
      page: 'planner',
      scene: null,
      flow: null,
      active: snapOnMount.preview ? 'alternative' : 'current',
      aiAvailable: false,
      aiEnabled: false,
      worker: null,
      nextId: 0,
      pending: new Map(),
      cache: new Map(),
      latest: snapOnMount.latestStart || null,
    };

    function pushToSharedStore(markChecked = true) {
      if (isBootstrapping || !state.baseline) return;
      manualTouched = true;
      missionPlannerStore.syncFromManual({
        settings: state.baseline.settings || state.settings,
        baseline: state.baseline,
        preview: state.active === 'alternative' ? state.alternative || state.result : null,
        latestStart: state.latest,
        hour: state.hour,
        markChecked,
      });
    }

    hydrate(root);

    const stationName = (id: string) =>
      ({ canberra: 'Canberra · DSS 43', goldstone: 'Goldstone · DSS 14', madrid: 'Madrid · DSS 63' }[id] || id);
    const shortSite = (s: any) => s.name.split('·')[1]?.trim() || s.name;
    const fmt = (v: number, n = 1) => Number(v).toLocaleString('en-GB', { maximumFractionDigits: n, minimumFractionDigits: n });
    const stamp = (h: number | null) => (h === null ? 'Not reached' : fmtHours(h));

    function notify(text: string, error = false) {
      const toast = $('toast');
      if (!toast) return;
      toast.textContent = text;
      toast.classList.toggle('error', error);
      toast.hidden = false;
      window.clearTimeout(notifyTimer);
      notifyTimer = window.setTimeout(() => {
        if (toast) toast.hidden = true;
      }, error ? 8000 : 4500);
    }

    function busy(value: boolean, text = 'Calculating your mission') {
      state.busy = value;
      state.flow?.setBusy(value, text);
      if ($('busyBanner')) $('busyBanner')!.hidden = !value;
      if ($('busyText')) $('busyText')!.textContent = text;
      const prog = $('busyProgress') as HTMLProgressElement | null;
      if (prog) prog.value = 0;
      for (const id of ['runBtn', 'compareBtn', 'searchBtn', 'latestBtn']) {
        const btn = $(id) as HTMLButtonElement | null;
        if (btn) btn.disabled = value;
      }
    }

    function reportError(error: any) {
      console.error(error);
      const val = $('validation');
      if (val) {
        val.textContent = error?.message || String(error);
        val.hidden = false;
      }
      notify(error?.message || String(error), true);
    }

    async function request(type: string, payload: any = {}) {
      if (state.worker) {
        const id = ++state.nextId;
        return new Promise((resolve, reject) => {
          state.pending.set(id, { resolve, reject });
          state.worker.postMessage({ id, type, ...payload });
        });
      }
      await new Promise((r) => setTimeout(r, 25));
      if (type === 'evaluate') return evaluate(state.bundle, payload.settings);
      if (type === 'latest') return latestStart(state.bundle, payload.settings);
      if (type === 'search') {
        const sites = payload.mode === 'date' ? state.bundle.sites.filter((s: any) => s.id === payload.settings.siteId) : state.bundle.sites;
        const shifts = payload.mode === 'site' ? [0] : [0, 1, 2, 3, 4, 5, 6];
        const res: any[] = [];
        const base = state.bundle.sites.find((s: any) => s.id === payload.settings.siteId);
        for (const site of sites) {
          for (const delay of shifts) {
            const settings = {
              ...payload.settings,
              siteId: site.id,
              startUTC: new Date(Date.parse(payload.settings.startUTC) + delay * 86400000).toISOString(),
            };
            try {
              const r = evaluate(state.bundle, settings);
              res.push({ settings, site: r.site, metrics: r.metrics, delay, distanceKm: distanceKm(site, base) });
            } catch (e: any) {
              res.push({ settings, site, delay, error: e.message });
            }
            const prog = $('busyProgress') as HTMLProgressElement | null;
            if (prog) prog.value = res.length / (sites.length * shifts.length);
            await new Promise((r) => setTimeout(r, 0));
          }
        }
        return res;
      }
      return true;
    }

    async function initWorker() {
      try {
        const w = new Worker(new URL('../manual-planner/worker.js', import.meta.url), { type: 'module' });
        state.worker = w;
        w.onmessage = ({ data: m }) => {
          const req = state.pending.get(m.id);
          if (!req) return;
          if (m.progress !== undefined) {
            const prog = $('busyProgress') as HTMLProgressElement | null;
            if (prog) prog.value = m.progress;
            return;
          }
          state.pending.delete(m.id);
          if (m.ok) req.resolve(m.result);
          else req.reject(new Error(m.error));
        };
        w.onerror = () => {
          for (const q of state.pending.values()) q.reject(new Error('Background worker unavailable.'));
          state.pending.clear();
          state.worker?.terminate();
          state.worker = null;
        };
        await Promise.race([
          request('init', { bundle: state.bundle }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Worker initialization timed out')), 10000)),
        ]);
      } catch (e: any) {
        state.worker?.terminate();
        state.worker = null;
        console.warn('Using direct calculation fallback:', e?.message);
      }
    }

    function readTop() {
      const date = ($('dateInput') as HTMLInputElement).value;
      if (!date) throw new Error('Choose a landing date and time in UTC.');
      const duration = +($('durationInput') as HTMLSelectElement).value;
      return {
        ...state.settings,
        siteId: ($('siteInput') as HTMLSelectElement).value,
        startUTC: new Date(date + 'Z').toISOString(),
        durationHours: duration,
        deadlineHours: Math.min(state.settings.deadlineHours, duration),
      };
    }

    function fillTop(s: any) {
      const siteEl = $('siteInput') as HTMLSelectElement | null;
      const dateEl = $('dateInput') as HTMLInputElement | null;
      const durEl = $('durationInput') as HTMLSelectElement | null;
      if (siteEl) siteEl.value = s.siteId;
      if (dateEl) dateEl.value = s.startUTC.slice(0, 16);
      if (durEl) {
        if (![...durEl.options].some((o) => +o.value === s.durationHours)) {
          durEl.add(new Option(fmtHours(s.durationHours), String(s.durationHours)));
        }
        durEl.value = String(s.durationHours);
      }
      if ($('missionSummary')) $('missionSummary')!.textContent = `${s.scienceMinutes} min measurement · ${fmt(s.dataMB, 0)} MB`;
    }

    async function compute(s: any) {
      const key = JSON.stringify(s);
      const cached = state.cache.get(key);
      if (cached) return cached;
      const r = await request('evaluate', { settings: s });
      state.cache.set(key, r);
      if (state.cache.size > 10) state.cache.delete(state.cache.keys().next().value);
      return r;
    }

    function nextContact(r: any, h: number) {
      for (const [a, b] of r.windows.link) {
        if (h < a) return `Next geometric contact in ${fmtHours(a - h)}`;
        if (h >= a && h < b) return `Contact ends in ${fmtHours(b - h)}`;
      }
      return 'No further contact in this period';
    }

    function updateFrame() {
      const r = state.result;
      if (!r || destroyed) return;
      const p: any = sampleAt(r, state.hour);
      if (!p) return;
      state.sample = p;
      state.scene?.setSample(p);
      $('powerValue')!.innerHTML = `${fmt(p.powerW, 0)} <em>W</em>`;
      const net = p.powerW - p.loadW;
      $('powerNote')!.textContent =
        p.sunFraction < 0.001
          ? 'No direct sunlight at this time'
          : `${Math.round(p.sunFraction * 100)}% of Sun visible · ${Math.round(p.incidence * 100)}% incidence`;
      $('batteryValue')!.innerHTML = `${fmt(p.socPct, 1)} <em>%</em>`;
      $('batteryNote')!.textContent = `${net >= 0 ? 'Surplus' : 'Deficit'} ${fmt(Math.abs(net), 0)} W · reserve ${r.settings.reservePct}%`;
      $('linkValue')!.textContent = p.transmitting ? 'Sending data' : p.linkAvailable ? 'Available' : 'Unavailable';
      $('linkNote')!.textContent = p.transmitting
        ? `${fmt(p.actualTxMbps, 2)} Mbit/s · ${fmt(p.pendingMB, 1)} MB left`
        : p.linkAvailable
          ? p.pendingMB > 0
            ? 'Waiting for radio power'
            : p.generatedMB > 0
              ? 'Required data already returned'
              : 'Waiting for science data'
          : nextContact(r, state.hour);
      $('dataValue')!.innerHTML = `${fmt(p.deliveredMB, 1)} <em>MB</em>`;
      $('dataNote')!.textContent =
        p.generatedMB > 0 ? `${fmt(p.pendingMB, 1)} MB onboard · target ${r.settings.dataMB} MB` : 'No science file until the activity finishes';
      $('sceneUTC')!.textContent = `${fmtDate(p.utc).toUpperCase()} · ${timeUTC(p.utc)}`;
      $('elapsedLabel')!.textContent = `T + ${fmtHours(state.hour)}`;
      const phase = (
        {
          charging: ['battery', net > 0 ? 'Collecting energy' : 'Waiting for usable energy', `Net ${net >= 0 ? '+' : ''}${Math.round(net)} W · ${stationName(r.settings.stationId)}`],
          science: ['flask', 'Measurement in progress', `${Math.round(p.scienceProgress * 100)}% complete · ${r.settings.scienceW} W instrument`],
          waiting_contact: ['antenna', 'Data waiting onboard', `${fmt(p.pendingMB, 0)} MB · ${p.linkAvailable ? 'contact available' : 'awaiting usable contact'}`],
          transmitting: ['signal', 'Returning science data', `${fmt(p.actualTxMbps, 2)} Mbit/s · ${fmt(p.pendingMB, 1)} MB remaining`],
          complete: ['checkcircle', 'Science result returned', `Objective completed at T + ${fmtHours(r.metrics.completeHour)}`],
          incomplete: ['warning', 'Activity not completed', 'Inspect the energy and deadline requirements'],
        } as Record<string, [string, string, string]>
      )[p.phase] || ['battery', 'Collecting energy', ''];
      $('phaseIcon')!.innerHTML = icon(phase[0]);
      $('phaseLabel')!.textContent = phase[1];
      $('phaseDetail')!.textContent = phase[2];
      $('timeReadout')!.textContent = `T + ${fmtHours(state.hour)}`;
      ($('timeRange') as HTMLInputElement).value = String(state.hour);
      $('playBtn')!.innerHTML = icon(state.playing ? 'pause' : 'play') + `<span>${state.playing ? 'Pause' : 'Play mission'}</span>`;
      syncEventLabels($('milestones'), state.hour);
      drawHorizon($('horizonCanvas') as HTMLCanvasElement, r, p);
      drawTimeline($('timelineCanvas') as HTMLCanvasElement, r, state.hour, Number(($('timeRange') as HTMLInputElement).max));
    }

    function setTime(h: number, play = false) {
      if (!state.result) return;
      state.hour = Math.max(0, Math.min(state.result.settings.durationHours, h));
      state.playing = play;
      updateFrame();
    }

    function jump(event: string) {
      if (!state.result) return;
      const m = state.result.metrics;
      const lookup: Record<string, number | null | undefined> = {
        landing: 0,
        ready: m.readyHour,
        science: m.scienceStartHour,
        data: m.scienceEndHour,
        transmit: m.firstTxHour,
        complete: m.completeHour,
        sun: state.hour,
      };
      let h = lookup[event];
      if (h === null || h === undefined) {
        notify(`This event does not occur in the evaluated mission. ${m.reason}`);
        if (event === 'transmit') state.scene?.setCamera('earth');
        return;
      }
      if (event === 'transmit') h += Math.min(0.03, m.transmissionHours / 2);
      if (event === 'science') h += 0.02;
      setTime(h);
      if (event === 'sun') state.scene?.setCamera('sun');
      if (event === 'transmit') state.scene?.setCamera('earth');
    }

    function renderMilestones() {
      const m = state.result.metrics;
      const items: Array<[string, string, string, number | null]> = [
        ['landing', 'pin', 'Landed', 0],
        ['ready', 'battery', 'Energy ready', m.readyHour],
        ['science', 'flask', 'Measurement', m.scienceStartHour],
        ['data', 'data', 'Data created', m.scienceEndHour],
        ['transmit', 'antenna', 'Sending begins', m.firstTxHour],
        ['complete', 'check', 'Result returned', m.completeHour],
      ];
      $('milestones')!.innerHTML = items
        .map(
          ([key, i, title, h]) =>
            `<button class="milestone" type="button" data-event="${key}" data-hour="${h === null ? '' : h}"><span>${icon(
              i
            )}</span><span><small>${title}</small><b>${h === 0 ? 'T + 0' : stamp(h)}</b></span></button>`
        )
        .join('');
      $('milestones')!
        .querySelectorAll<HTMLButtonElement>('button')
        .forEach((button) => {
          button.disabled = button.dataset.hour === '';
          button.onclick = () => setTime(Number(button.dataset.hour));
        });
      detachEventLabels = attachEventLabels($('timeRange'), $('milestones'), state.result.settings.durationHours, {
        plotCanvas: $('timelineCanvas'),
      });
    }

    function renderOutcome() {
      const r = state.result;
      if (!r) return;
      const m = r.metrics;
      const guideResult = $('guideResult');
      if (guideResult) {
        guideResult.classList.toggle('failed', !m.feasible);
        guideResult.innerHTML = `<div class="result-status">${icon(m.feasible ? 'checkcircle' : 'warning')}${m.feasible ? 'FORECAST · OBJECTIVE MET' : 'FORECAST · LIMITATION'
          }</div><h3 style="margin-top:10px">${m.feasible
            ? 'This mission can finish.'
            : m.cause === 'energy'
              ? 'The activity needs more energy.'
              : m.cause === 'contact'
                ? 'A contact is missing.'
                : 'The timing needs a change.'
          }</h3><p>${esc(m.reason)}</p><dl><div><dt>Ready to begin</dt><dd>${stamp(
            m.readyHour
          )}</dd></div><div><dt>Measurement complete</dt><dd>${stamp(m.scienceEndHour)}</dd></div><div><dt>Result returned</dt><dd>${stamp(
            m.completeHour
          )}</dd></div><div><dt>Contact available</dt><dd>${fmtHours(
            m.contactHours
          )}</dd></div><div><dt>Actually transmitting</dt><dd>${fmtHours(
            m.transmissionHours
          )}</dd></div><div><dt>Gross energy harvested</dt><dd>${fmt(m.energyKWh, 2)} kWh</dd></div></dl>`;
      }
      if ($('completionSummary')) {
        $('completionSummary')!.textContent = m.feasible
          ? `Result returned ${fmtHours(m.completeHour)} after landing · ${fmtHours(m.deadlineMarginHours)} before the deadline.`
          : m.reason;
      }
    }

    function showResult(r: any, preserveHour = false) {
      if (destroyed) return;
      state.result = r;
      state.hour = preserveHour ? Math.min(state.hour, r.settings.durationHours) : 0;
      state.playing = false;
      state.latest = null;
      $('latestResult')!.hidden = true;
      ($('timeRange') as HTMLInputElement).max = String(r.settings.durationHours);
      ($('timeRange') as HTMLInputElement).value = String(state.hour);
      $('roleBadge')!.textContent = state.active === 'current' ? 'CURRENT PLAN' : 'ALTERNATIVE';
      $('sceneSite')!.textContent = shortSite(r.site);
      $('sceneCoordinates')!.textContent = `${Math.abs(r.site.latitude_deg).toFixed(5)}° S · ${Math.abs(r.site.longitude_deg).toFixed(5)}° W`;
      if (state.scene) state.scene.setResult(r, state.bundle);
      drawMap(
        $('mapCanvas') as HTMLCanvasElement,
        state.bundle.sites.find((s: any) => s.id === r.site.id),
        state.bundle
      );
      renderMilestones();
      renderOutcome();
      updateFrame();
      state.flow?.sync();
      pushToSharedStore(true);
    }

    async function run(s: any = null) {
      if (state.busy || destroyed) return false;
      try {
        const settings = normalize(s || readTop());
        $('validation')!.hidden = true;
        busy(true);
        state.playing = false;
        const result = await compute(settings);
        if (destroyed) return false;
        state.settings = result.settings;
        state.baseline = result;
        state.alternative = null;
        state.choices = [];
        state.latest = null;
        state.active = 'current';
        fillTop(result.settings);
        $('compareSection')!.hidden = true;
        showResult(result);
        state.flow?.onCommit();
        pushToSharedStore(true);
        return true;
      } catch (e) {
        reportError(e);
        return false;
      } finally {
        if (!destroyed) busy(false);
      }
    }

    async function findLatest() {
      if (state.busy || !state.result || destroyed) return;
      try {
        busy(true, 'Testing activity start times');
        const result: any = await request('latest', { settings: state.result.settings });
        if (destroyed) return;
        state.latest = result;
        pushToSharedStore(true);
        $('latestResult')!.hidden = false;
        $('latestResult')!.textContent =
          result.hour === null
            ? 'No start on the tested 15-minute grid meets the selected objective.'
            : `Latest passing tested start: T + ${fmtHours(result.hour)}. Result returned at T + ${fmtHours(
              result.completeHour
            )}. Tested on a 15-minute grid under the same conservative energy policy; this is not a continuous-time safety guarantee.`;
      } catch (e) {
        reportError(e);
      } finally {
        if (!destroyed) busy(false);
      }
    }

    function settingsDialog() {
      const s = state.settings;
      const form = $('settingsForm') as HTMLFormElement | null;
      if (!form) return;
      for (const el of Array.from(form.elements) as Array<HTMLInputElement | HTMLSelectElement>) {
        if (el.name && s[el.name] !== undefined) el.value = String(s[el.name]);
      }
      ($('settingsDialog') as HTMLDialogElement).showModal();
    }

    function openSources() {
      $('sourcesContent')!.innerHTML = `<h3>Real sources, bounded coverage</h3><p>The calculation uses the prepared dataset supplied with the planner. It preserves the solar and geometry source modules, and models a single science activity followed by data return.</p><table><thead><tr><th>Input</th><th>Source and role</th></tr></thead><tbody><tr><td>Near-site terrain</td><td><a href="https://pgda.gsfc.nasa.gov/products/78" target="_blank" rel="noopener">LOLA / NASA PGDA product 78</a> · Connecting Ridge Site01. A 5 m source DEM was sampled into a 20 m local display grid.</td></tr><tr><td>Regional skyline</td><td><a href="https://pgda.gsfc.nasa.gov/products/90" target="_blank" rel="noopener">LOLA / NASA PGDA product 90</a> · 80 m regional source. Prepared rays every 0.5° to 80 km; a reference sphere beyond. Unresolved terrain can change visibility.</td></tr><tr><td>Sun &amp; Earth</td><td><a href="https://naif.jpl.nasa.gov/naif/" target="_blank" rel="noopener">JPL DE421 / NAIF</a> · hourly geometric vectors, interpolated in MOON_ME_DE421. January 2026–January 2028 coverage. Earth station orientation uses approximate IAU_EARTH, not operational ITRF/EOP.</td></tr><tr><td>Geometry reference</td><td><a href="https://ssd.jpl.nasa.gov/horizons/" target="_blank" rel="noopener">JPL Horizons</a> · official challenge resource for independent position checks; this release uses cached DE421 data, not live Horizons requests.</td></tr><tr><td>Moon appearance</td><td><a href="https://svs.gsfc.nasa.gov/4720/" target="_blank" rel="noopener">NASA CGI Moon Kit</a> · global colour texture, for appearance only.</td></tr><tr><td>Site exploration</td><td><a href="https://quickmap.lroc.asu.edu/" target="_blank" rel="noopener">QuickMap</a> and <a href="https://trek.nasa.gov/moon/" target="_blank" rel="noopener">Moon Trek</a> · challenge resources for inspecting lunar terrain and mapped products.</td></tr><tr><td>Engineering context</td><td><a href="https://ntrs.nasa.gov/citations/20200000285" target="_blank" rel="noopener">Solar Power for Lunar Pole Missions</a> · NASA Langley/Glenn, 2019. Generic lander and array concepts; no NASA vehicle specifications are assumed.</td></tr><tr><td>Mission context</td><td><a href="https://www.asc-csa.gc.ca/eng/astronomy/moon-exploration/" target="_blank" rel="noopener">CSA Moon Exploration</a> and <a href="https://svs.gsfc.nasa.gov/5228/" target="_blank" rel="noopener">NASA polar illumination visualization</a>.</td></tr></tbody></table><h3>What the model does — and does not — claim</h3><p>Three prepared Connecting Ridge points, not approved landing sites. One fixed lander, one measurement, and one resumable file transfer. All reported times are approximate and scenario-dependent. No landing safety, thermal survival, mission certification, or ground-station reservation is implied.</p><ul>${(
        state.result?.assumptions || []
      )
        .map((a: string) => `<li>${esc(a)}</li>`)
        .join(
          ''
        )}</ul><p>Optical solar-disc clipping uses the sampled horizon. The 3D background rim reproduces that angular skyline at a compressed display distance; it is not a reconstruction of a continuous distant mountain range. Small-scale surface grain, lander materials, viewing fill light and binary packets are explanatory graphics.</p><p>Protocol efficiency 85%; constant solar loss factor 90%; battery efficiencies 95%. Full radio assumptions and all selected inputs are included in the mission export. Energy and communication thresholds are user inputs.</p><h3>About this calculation</h3><p>All metrics, power margins, terrain skyline intersections, and communication windows are computed locally in the browser against the prepared LOLA and JPL DE421 dataset.</p>`;
      ($('sourcesDialog') as HTMLDialogElement).showModal();
    }

    function downloadMission() {
      if (!state.result) return;
      const r = state.result;
      const payload = {
        application: 'Luna Shift',
        version: '5.0.0',
        exportedUTC: new Date().toISOString(),
        settings: r.settings,
        site: r.site,
        metrics: r.metrics,
        events: r.events,
        windows: r.windows,
        assumptions: r.assumptions,
        provenance: r.provenance,
        latestTestedStart: state.latest,
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `LunaShift_${r.site.id}_${r.settings.startUTC.slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('Mission inputs, results, events, and assumptions exported.');
    }

    function handlePage(name: string) {
      if (name === 'overview') {
        if (onWatchOverviewRef.current) onWatchOverviewRef.current();
        else onBackRef.current?.();
      }
    }

    function bindStaticControls() {
      $('exportBtn')!.onclick = downloadMission;
      $('footerSources')!.onclick = openSources;
      if ($('guideInfo')) $('guideInfo')!.onclick = openSources;
      $('sourceBtn')!.onclick = openSources;

      root!
        .querySelectorAll<HTMLButtonElement>('[data-close-dialog]')
        .forEach((b) => (b.onclick = () => (b.closest('dialog') as HTMLDialogElement | null)?.close()));
      root!.querySelectorAll<HTMLDialogElement>('dialog').forEach((d) =>
        d.addEventListener(
          'click',
          (e) => {
            if (
              e.target === d &&
              e.clientX &&
              (e.clientX < d.getBoundingClientRect().left ||
                e.clientX > d.getBoundingClientRect().right ||
                e.clientY < d.getBoundingClientRect().top ||
                e.clientY > d.getBoundingClientRect().bottom)
            ) {
              d.close();
            }
          },
          { signal }
        )
      );

      $('defaultSettings')!.onclick = () => {
        const form = $('settingsForm') as HTMLFormElement | null;
        if (!form) return;
        for (const el of Array.from(form.elements) as Array<HTMLInputElement | HTMLSelectElement>) {
          if (el.name && (DEFAULTS as any)[el.name] !== undefined) el.value = String((DEFAULTS as any)[el.name]);
        }
      };

      root!
        .querySelectorAll<HTMLButtonElement>('[data-camera]')
        .forEach((b) => (b.onclick = () => state.scene?.setCamera(b.dataset.camera)));
      root!
        .querySelectorAll<HTMLButtonElement>('[data-body]')
        .forEach((b) => (b.onclick = () => state.scene?.setCamera(b.dataset.body)));

      $('revealBtn')!.onclick = () => {
        const btn = $('revealBtn')!;
        const v = btn.getAttribute('aria-pressed') !== 'true';
        btn.setAttribute('aria-pressed', String(v));
        btn.classList.toggle('active', v);
        state.scene?.setReveal(v);
      };
      $('mapToggle')!.onclick = () => {
        $('sceneMap')!.hidden = !$('sceneMap')!.hidden;
      };
      $('expandBtn')!.onclick = () => {
        $('missionStage')!.classList.toggle('expanded');
        state.scene?.resize();
        updateFrame();
      };
      document.addEventListener(
        'keydown',
        (e) => {
          if (e.key === 'Escape') {
            $('missionStage')?.classList.remove('expanded');
            state.scene?.resize();
          }
        },
        { signal }
      );

      root!
        .querySelectorAll<HTMLButtonElement>('[data-jump]')
        .forEach((b) => (b.onclick = () => jump(b.dataset.jump!)));
      $('resetTime')!.onclick = () => setTime(0);
      $('playBtn')!.onclick = () => {
        if (!state.result) return;
        if (state.hour >= state.result.settings.durationHours) setTime(0);
        state.playing = !state.playing;
        updateFrame();
      };
      $('speedInput')!.onchange = () => (state.speed = +($('speedInput') as HTMLSelectElement).value);
      ($('timeRange') as HTMLInputElement).oninput = () => setTime(+($('timeRange') as HTMLInputElement).value);
      $('timeRange')!.addEventListener('timeline-range-change', updateFrame, { signal });
      $('timelineCanvas')!.onclick = (e) => {
        const canvas = e.currentTarget as any;
        const info = canvas._timeline;
        if (!info) return;
        const rect = canvas.getBoundingClientRect();
        setTime(((e.clientX - rect.left - info.left) / (info.right - info.left)) * info.duration);
      };
      $('latestBtn')!.onclick = findLatest;

      window.addEventListener(
        'resize',
        () => {
          if (!destroyed && $('missionEvidence')?.hasAttribute('open')) updateFrame();
        },
        { signal }
      );
    }

    async function init() {
      bindStaticControls();
      busy(true, 'Loading the prepared NASA dataset');
      try {
        const bundle = await missionPlannerStore.ensureLoaded();
        if (destroyed) return;
        state.bundle = bundle;
        await initWorker();
        if (destroyed) return;
        try {
          state.scene = new MissionScene($('sceneCanvas'), {
            labelsEl: $('sceneLabels'),
            onCamera: (mode: string) =>
              root!
                .querySelectorAll<HTMLElement>('[data-camera]')
                .forEach((b) => b.classList.toggle('active', b.dataset.camera === mode)),
          });
          sceneRef.current = state.scene;
          state.scene.active = activeRef.current && Boolean(($('missionEvidence') as HTMLDetailsElement | null)?.open);
        } catch (e) {
          console.warn('WebGL fallback', e);
          if ($('sceneFallback')) $('sceneFallback')!.hidden = false;
        }
        const latestSnap = missionPlannerStore.getSnapshot();
        const baselineResult = latestSnap.baseline || (await compute(state.settings));
        if (destroyed) return;
        const initialDisplay = latestSnap.preview || baselineResult;
        state.settings = baselineResult.settings;
        state.baseline = baselineResult;
        state.alternative = latestSnap.preview || null;
        state.active = latestSnap.preview ? 'alternative' : 'current';
        state.hour = Math.min(latestSnap.hour || 0, initialDisplay.settings.durationHours);
        fillTop(initialDisplay.settings);
        showResult(initialDisplay, true);
        state.flow = new PlannerFlow({
          state,
          compute,
          run,
          showResult,
          setTime,
          jump,
          notify,
          reportError,
          request,
          busy,
          page: handlePage,
          settingsDialog,
          openSources,
          findLatest,
          downloadMission,
          updateFrame,
        });
        state.flow.onPage('planner');
        if (state.active === 'alternative' && state.alternative) {
          state.flow.trial = state.alternative;
          state.flow.stage = 'checked';
          state.flow.sync();
        }
        isBootstrapping = false;
      } catch (e: any) {
        isBootstrapping = false;
        if (!destroyed && e?.name !== 'AbortError') reportError(e);
      } finally {
        if (!destroyed) busy(false);
      }

      let then = performance.now();
      let lastDraw = 0;
      function frame(now: number) {
        if (destroyed) return;
        const dt = Math.min(0.2, (now - then) / 1000);
        then = now;
        if (state.playing && state.result && activeRef.current && !document.hidden) {
          state.hour = Math.min(state.result.settings.durationHours, state.hour + dt * state.speed);
          if (state.hour >= state.result.settings.durationHours) state.playing = false;
          if (now - lastDraw > 65) {
            updateFrame();
            lastDraw = now;
          }
        }
        rafId = requestAnimationFrame(frame);
      }
      rafId = requestAnimationFrame(frame);
    }

    init();

    return () => {
      if (manualTouched && state.baseline) {
        missionPlannerStore.syncFromManual({
          settings: state.baseline.settings || state.settings,
          baseline: state.baseline,
          preview: state.active === 'alternative' ? state.alternative || state.result : null,
          latestStart: state.latest,
          hour: state.hour,
          markChecked: true,
        });
      }
      destroyed = true;
      detachEventLabels?.();
      abortController.abort();
      window.clearTimeout(notifyTimer);
      cancelAnimationFrame(rafId);
      state.flow?.destroy();
      state.pending.clear();
      state.worker?.terminate();
      state.worker = null;
      state.scene?.dispose();
      sceneRef.current = null;
      root.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((d) => d.close());
    };
  }, []);

  return (
    <div ref={shellRef} className="manual-planner-shell">
      <ManualPlannerDom onBackClick={() => onBackRef.current?.()} />
    </div>
  );
}
