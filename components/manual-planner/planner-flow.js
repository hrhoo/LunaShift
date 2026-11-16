import { icon } from './icons.js';
import { fmtHours, fmtDate, timeUTC, escapeHTML as esc } from './charts.js';
import { localGuide } from './guide.js';
import { normalize } from './core/rehearsal.js';
import { lunaRabbit } from './luna-mascot.js';
import {
  samePlan,
  shiftedSettings,
  checkedUTC,
  outcomeTitle,
  checkRows,
  orderedAlternatives,
  changeSummary,
} from './planner-decision.js';

const $ = (id) => document.getElementById(id);
const num = (v, n = 1) => Number(v).toLocaleString('en-GB', { maximumFractionDigits: n });
const elapsed = (h) => (h === null || h === undefined ? 'Not completed' : fmtHours(h));
const shortSite = (s) => s.name.split('·').at(-1).trim();
const when = (s) => `${fmtDate(s.startUTC)} · ${timeUTC(s.startUTC)} UTC`;
const action = (id, label, cls = 'secondary', value = '') =>
  `<button class="${cls}" data-flow="${id}"${value !== '' ? ` data-value="${esc(String(value))}"` : ''}>${label}</button>`;

/**
 * Bounded guided UI for the Mission Planner page.
 * baseline = adopted plan; trial/selected = uncommitted calculations.
 */
export class PlannerFlow {
  constructor(api) {
    this.api = api;
    this.state = api.state;
    this.stage = 'current';
    this.kind = 'date';
    this.trial = null;
    this.selected = null;
    this.options = [];
    this.searchBase = null;
    this.searchMode = 'both';
    this.chatOpen = false;
    this.started = false;
    this.context = 'welcome';
    this.error = '';
    this.allowAutoOpen = true;
    this._destroyed = false;
    this._ac = new AbortController();
    this._timers = new Set();

    if ($('lunaPeek')) $('lunaPeek').innerHTML = lunaRabbit('peek');
    if ($('lunaHeaderAvatar')) $('lunaHeaderAvatar').innerHTML = lunaRabbit('avatar');
    if ($('lunaLauncherArt')) $('lunaLauncherArt').innerHTML = lunaRabbit('launch');
    $('chatMessages')?.replaceChildren();
    this.bind();
    this.sync();
    if ($('chatMessages')) this.welcome();
  }

  _delay(fn, ms) {
    const id = window.setTimeout(() => {
      this._timers.delete(id);
      if (!this._destroyed) fn();
    }, ms);
    this._timers.add(id);
  }

  destroy() {
    this._destroyed = true;
    this._ac.abort();
    for (const id of this._timers) window.clearTimeout(id);
    this._timers.clear();
  }

  bind() {
    const { signal } = this._ac;
    $('decisionBody').addEventListener(
      'click',
      (e) => {
        const b = e.target.closest('[data-flow]');
        if (b && !b.disabled) this.perform(b.dataset.flow, b.dataset.value);
      },
      { signal }
    );
    $('lunaChoices')?.addEventListener(
      'click',
      (e) => {
        const b = e.target.closest('[data-flow]');
        if (b && !b.disabled) {
          this.say(b.textContent.trim(), true);
          this.perform(b.dataset.flow, b.dataset.value, true);
        }
      },
      { signal }
    );
    $('decisionBody').addEventListener(
      'submit',
      (e) => {
        e.preventDefault();
        this.perform('check');
      },
      { signal }
    );

    if ($('lunaHelpTop')) $('lunaHelpTop').onclick = () => this.toggleChat(true);
    if ($('restoreGuide')) $('restoreGuide').onclick = () => this.toggleChat(true);
    if ($('collapseGuide')) $('collapseGuide').onclick = () => this.toggleChat(false);
    $('compareBtn').onclick = () => this.perform('change');
    $('viewEvidence').onclick = () => this.evidence();
    $('editPlanDetails').onclick = () => this.openEditor();
    $('runBtn').onclick = () => this.perform('advanced-check');
    $('missionBtn').onclick = () => this.settings();

    if ($('chatForm')) {
      $('chatForm').onsubmit = (e) => {
        e.preventDefault();
        const text = $('chatInput')?.value.trim();
        if (text) {
          if ($('chatInput')) $('chatInput').value = '';
          this.ask(text);
        }
      };
    }
    if ($('chatInput')) {
      $('chatInput').onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          $('chatForm')?.requestSubmit();
        }
      };
    }
    $('guideQuick')
      ?.querySelectorAll('[data-prompt]')
      .forEach((b) => (b.onclick = () => this.ask(b.dataset.prompt)));

    $('settingsForm').onsubmit = (e) => {
      e.preventDefault();
      const patch = {};
      for (const el of e.currentTarget.elements) {
        if (el.name) patch[el.name] = el.tagName === 'SELECT' ? el.value : +el.value;
      }
      const next = { ...this.reference().settings, ...patch };
      if (next.deadlineHours > next.durationHours) {
        this.api.notify('The deadline must fit inside the evaluated mission.', true);
        return;
      }
      $('settingsDialog').close();
      this.preview(next);
    };

    $('missionEvidence').addEventListener(
      'toggle',
      () => {
        const evidenceEl = $('missionEvidence');
        if (!evidenceEl) return;
        if (this.state.scene) this.state.scene.active = this.state.page === 'planner' && evidenceEl.open;
        if (evidenceEl.open) {
          this._delay(() => {
            this.state.scene?.resize();
            this.api.updateFrame();
          }, 80);
        }
      },
      { signal }
    );
    $('planEditor').addEventListener(
      'toggle',
      () => {
        if ($('planEditor')?.open) this.fillEditor(this.reference().settings);
      },
      { signal }
    );

    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape' && this.chatOpen && !document.querySelector('.manual-planner-shell dialog[open]')) {
          this.toggleChat(false);
        }
      },
      { signal }
    );

    $('searchBtn').onclick = () => this.perform('search', $('searchMode').value);
    $('searchMode').onchange = () => this.perform('search', $('searchMode').value);
  }

  reference() {
    return this.selected || this.trial || this.state.baseline;
  }

  onPage(name) {
    const evidenceEl = $('missionEvidence');
    if (this.state.scene) this.state.scene.active = name === 'planner' && Boolean(evidenceEl?.open);
    if (name === 'planner') {
      if (!this.started) {
        this.started = true;
        if ($('guidePanel') && window.innerWidth >= 1220) this.toggleChat(true, false);
      }
      this.sync();
    }
  }

  onCommit() {
    this.trial = null;
    this.selected = null;
    this.options = [];
    this.stage = 'current';
    this.context = 'welcome';
    this.error = '';
    this.searchBase = null;
    this.sync();
  }

  setBusy(value, text = '') {
    $('decisionWorkspace')?.setAttribute('aria-busy', String(value));
    for (const root of [$('decisionBody'), $('lunaChoices')]) {
      root?.querySelectorAll('button').forEach((b) => (b.disabled = value));
    }
    if ($('sendChat')) $('sendChat').disabled = value;
    if ($('chatInput')) $('chatInput').disabled = value;
    $('guidePanel')?.classList.toggle('luna-thinking', value);
    if ($('lunaContext')) {
      $('lunaContext').innerHTML = value
        ? `<span class="luna-thinking-dots"><i></i><i></i><i></i></span>${esc(text)}`
        : `<i></i>${this.selected ? 'Inspecting an alternative' : this.trial ? 'Checking a proposed change' : 'Reading your current plan'}`;
    }
  }

  toggleChat(open, focus = true) {
    if (!$('guidePanel')) {
      this.chatOpen = false;
      $('plannerPage')?.classList.remove('luna-open');
      return;
    }
    this.chatOpen = open;
    $('guidePanel').hidden = !open;
    if ($('restoreGuide')) {
      $('restoreGuide').hidden = open;
      $('restoreGuide').setAttribute('aria-expanded', String(open));
    }
    $('plannerPage')?.classList.toggle('luna-open', open);
    if (open) {
      if ($('guideBody')) $('guideBody').scrollTop = $('guideBody').scrollHeight;
      if (focus && window.innerWidth > 700) $('chatInput')?.focus({ preventScroll: true });
    } else if (focus) {
      $('restoreGuide')?.focus({ preventScroll: true });
    }
    this._delay(() => {
      this.state.scene?.resize();
      if ($('missionEvidence')?.open) this.api.updateFrame();
    }, 180);
  }

  sync() {
    const b = this.state.baseline;
    if (!b || this._destroyed) return;
    $('committedPlan').innerHTML =
      `<div class="plan-strip-name"><span class="plan-pin">${icon('pin')}</span><div><small>YOUR CURRENT PLAN</small><strong>${esc(shortSite(b.site))}</strong></div></div>` +
      `<div><small>LANDING · UTC</small><strong>${esc(when(b.settings))}</strong></div>` +
      `<div><small>SCIENCE & DATA RETURN</small><strong>${num(b.settings.scienceMinutes, 0)} min measurement · ${num(b.settings.dataMB)} MB</strong></div>` +
      `<div><small>DEADLINE</small><strong>${fmtHours(b.settings.deadlineHours)} after landing</strong></div>`;
    this.render();
    if ($('lunaContext')) {
      $('lunaContext').innerHTML = `<i></i>${
        this.selected ? 'Inspecting an alternative' : this.trial ? 'Proposed change · not yet applied' : 'Current plan · ' + esc(shortSite(b.site))
      }`;
    }
    $('evidenceContext').innerHTML = `${icon(this.state.active === 'current' ? 'pin' : 'compare', '', 15)}<b>${
      this.state.active === 'current' ? 'CURRENT PLAN' : 'PREVIEW ONLY'
    }</b><span>${esc(shortSite(this.state.result.site))} · ${esc(when(this.state.result.settings))}</span>${
      this.state.active === 'current' ? '' : '<em>Your current plan has not changed.</em>'
    }`;
    if ($('guideResult')) $('guideResult').hidden = true;
    if ($('guideMode')) {
      $('guideMode').innerHTML = `<i></i>${this.state.aiEnabled ? 'Connected AI · engine-checked actions' : 'Guided questions · works offline'}`;
    }
  }

  render() {
    const b = this.state.baseline;
    const r = this.reference();
    const trial = this.trial;
    if (this.stage === 'checked' && !trial) this.stage = 'current';
    const step = this.stage === 'current' || this.stage === 'kept' ? 1 : this.stage === 'change' ? 2 : 3;
    $('plannerPage')
      ?.querySelectorAll('[data-step]')
      .forEach((e) => {
        e.classList.toggle('active', +e.dataset.step === step);
        e.classList.toggle('done', +e.dataset.step < step);
      });

    let html = '';
    if (this.stage === 'current' || this.stage === 'kept') {
      html =
        this.resultHero(b, false, this.stage === 'kept') +
        this.metrics(b) +
        `<div class="decision-question"><div><h3>${
          this.stage === 'kept' ? 'Current plan kept.' : 'Need to change the plan?'
        }</h3><p>${
          this.stage === 'kept'
            ? 'Nothing was changed. Overview will replay this plan.'
            : 'A landing delay or a different site? Check it before replacing anything.'
        }</p></div><div class="decision-buttons">${action('change', `Yes, test a change ${icon('arrow', '', 16)}`, 'primary')}${action(
          this.stage === 'kept' ? 'watch' : 'keep',
          this.stage === 'kept' ? `${icon('play', '', 16)} Watch in Overview` : 'No, keep this plan',
          'secondary'
        )}</div></div>`;
    } else if (this.stage === 'change') {
      const base = b.settings;
      html =
        `<div class="change-title"><span class="step-bubble">2</span><div><h2>What changed?</h2><p>We’ll hold the science, hardware, and deadline relative to landing fixed.</p></div>${action(
          'cancel',
          'Cancel',
          'text-btn'
        )}</div>` +
        `<div class="change-kind" role="group" aria-label="Type of plan change">${[
          ['date', 'clock', 'Landing time'],
          ['site', 'pin', 'Location'],
          ['both', 'compare', 'Site & time'],
        ]
          .map(
            ([k, i, t]) =>
              `<button data-flow="kind" data-value="${k}" aria-pressed="${this.kind === k}" class="${this.kind === k ? 'selected' : ''}">${icon(i)}${t}</button>`
          )
          .join('')}</div>` +
        `<form id="changePlanForm" class="change-fields">`;
      if (this.kind !== 'site') {
        html += `<div class="delay-controls"><label>Landing delayed by<div><input id="delayAmount" type="number" min="0" max="14" step=".5" value="1" aria-label="Landing delay"><select id="delayUnit" aria-label="Delay units"><option value="days">days</option><option value="hours">hours</option></select></div></label><span>or choose an exact date</span><label>Proposed landing · UTC<input id="proposedDate" type="datetime-local" min="2026-01-01T00:00" max="2027-12-31T23:59" value="${shiftedSettings(
          base,
          1
        ).startUTC.slice(0, 16)}"></label></div>`;
      }
      if (this.kind !== 'date') {
        html += `<label class="proposed-site">Proposed landing site<select id="proposedSite">${this.state.bundle.sites
          .map((s) => `<option value="${esc(s.id)}" ${s.id === base.siteId ? 'selected' : ''}>${esc(s.name)}</option>`)
          .join('')}</select></label>`;
      }
      html += `<div class="change-footer"><span>${icon('checkcircle', '', 15)}Current plan stays unchanged until you confirm.</span><button class="primary" type="submit">Check this change ${icon(
        'arrow',
        '',
        16
      )}</button></div></form>`;
    } else if (this.stage === 'checked') {
      html =
        `<div class="preview-ribbon">${icon('compare', '', 16)}PROPOSED CHANGE <span>Not yet applied</span>${action('change', 'Edit change', 'text-btn')}</div>` +
        this.resultHero(trial, true) +
        this.comparison(b, trial) +
        `<div class="decision-question"><div><h3>${
          trial.metrics.feasible ? 'Keep this revision?' : 'What are you able to change?'
        }</h3><p>${
          trial.metrics.feasible
            ? 'You can use it, or keep the current plan. No alternative is required.'
            : 'Search around this proposed plan. The mission and hardware stay fixed.'
        }</p></div><div class="decision-buttons">${
          trial.metrics.feasible ? action('accept', `Use this revised plan ${icon('check', '', 16)}`, 'primary') : ''
        }${action('cancel', 'Keep current plan', 'secondary')}</div></div>`;
      html += trial.metrics.feasible ? `<div class="optional-search">${action('scope', 'Explore alternatives anyway', 'text-btn')}</div>` : this.scopeControls();
    } else if (this.stage === 'scope') {
      html =
        `<div class="change-title"><span class="step-bubble">3</span><div><h2>What can change?</h2><p>Searching from ${esc(
          shortSite(r.site)
        )} · ${esc(when(r.settings))}.</p></div>${action('cancel', 'Back to current plan', 'text-btn')}</div>` + this.scopeControls();
    } else if (this.stage === 'alternatives') {
      html = this.alternativesHTML();
    } else if (this.stage === 'accepted') {
      html =
        this.resultHero(b, false, true) +
        this.metrics(b) +
        `<div class="decision-question"><div><h3>This is now your current plan.</h3><p>Overview will replay the adopted site, date, and mission result.</p></div><div class="decision-buttons">${action(
          'watch',
          `${icon('play', '', 16)} Watch in Overview`,
          'primary'
        )}${action('change', 'Test another change', 'secondary')}</div></div>`;
    }

    $('decisionBody').innerHTML =
      html + `<div id="decisionError" class="decision-error" role="alert" ${this.error ? '' : 'hidden'}>${esc(this.error)}</div>`;
    this.api.renderPrimaryActions($('decisionBody'));
    if (this.stage === 'change' && this.kind !== 'site') {
      const update = () => {
        try {
          $('proposedDate').value = shiftedSettings(b.settings, $('delayAmount').value, $('delayUnit').value).startUTC.slice(0, 16);
        } catch (e) {
          this.inlineError(e.message);
        }
      };
      $('delayAmount').oninput = update;
      $('delayUnit').onchange = update;
    }
    this.setBusy(this.state.busy);
  }

  resultHero(r, trial = false, kept = false) {
    const m = r.metrics;
    const rows = checkRows(r);
    return `<div class="plan-verdict ${m.feasible ? 'is-good' : 'needs-attention'}"><div class="verdict-symbol">${icon(
      m.feasible ? 'checkcircle' : 'warning',
      '',
      30
    )}</div><div class="verdict-copy"><div class="verdict-eyebrow">${
      kept ? 'CURRENT PLAN CONFIRMED' : trial ? 'CHANGE CHECKED' : 'CURRENT PLAN CHECKED'
    } <span>MODELLED RESULT</span></div><h2>${outcomeTitle(r, trial)}</h2><p>${esc(m.reason)}</p><div class="verdict-checks">${rows
      .map(
        (c) =>
          `<span class="${c.pass ? 'pass' : 'fail'}" title="${esc(c.label)}">${icon(c.icon, '', 14)}${
            c.key === 'reserve' ? 'Reserve' : c.key === 'data' ? 'Data on time' : 'Science'
          }${icon(c.pass ? 'check' : 'close', '', 12)}</span>`
      )
      .join('')}</div></div>${action('explain', `${icon('info', '', 16)}Why?`, 'verdict-why')}</div>`;
  }

  metrics(r) {
    const m = r.metrics;
    return `<div class="decision-metrics"><div><span class="dm-icon solar">${icon('sun')}</span><small>SOLAR ENERGY</small><strong>${num(
      m.energyKWh,
      2
    )} <em>kWh</em></strong><span>Harvested over ${fmtHours(r.settings.durationHours)}</span></div><div><span class="dm-icon battery">${icon(
      'battery'
    )}</span><small>LOWEST BATTERY</small><strong>${num(m.minSocPct)} <em>%</em></strong><span>Full period · reserve ${
      r.settings.reservePct
    }%</span></div><div><span class="dm-icon contact">${icon('antenna')}</span><small>GROUND CONTACT</small><strong>${elapsed(
      m.contactHours
    )}</strong><span>Geometric opportunity · not a booking</span></div><div><span class="dm-icon returned">${icon(
      'data'
    )}</span><small>RESULT RETURNED</small><strong>${elapsed(m.completeHour)}</strong><span>After landing · deadline ${fmtHours(
      r.settings.deadlineHours
    )}</span></div></div>`;
  }

  comparison(a, b) {
    const diff = changeSummary(a.settings, b.settings);
    const rows = [
      ['pin', 'Site', shortSite(a.site), shortSite(b.site)],
      ['clock', 'Landing UTC', when(a.settings), when(b.settings)],
      ['sun', 'Solar energy', num(a.metrics.energyKWh, 2) + ' kWh', num(b.metrics.energyKWh, 2) + ' kWh'],
      ['antenna', 'Contact time', elapsed(a.metrics.contactHours), elapsed(b.metrics.contactHours)],
      [
        'data',
        'Data by deadline',
        num(a.metrics.deliveredByDeadlineMB) + ' / ' + num(a.settings.dataMB) + ' MB',
        num(b.metrics.deliveredByDeadlineMB) + ' / ' + num(b.settings.dataMB) + ' MB',
      ],
      ['checkcircle', 'Objective', a.metrics.feasible ? 'Met' : 'Not met', b.metrics.feasible ? 'Met' : 'Not met'],
    ];
    return `<div class="plain-comparison"><div class="comparison-column-head"><span>Same requirements. Clear differences.</span><b>Current plan</b><b>Proposed plan</b></div>${rows
      .map(
        ([i, label, x, y]) =>
          `<div class="plain-row"><span>${icon(i, '', 15)}${label}</span><span>${esc(x)}</span><strong class="${
            x !== y ? 'changed-value' : ''
          }">${esc(y)}</strong></div>`
      )
      .join('')}<p>${icon('checkcircle', '', 14)}${
      diff.hardwareFixed && diff.taskFixed
        ? 'Hardware, activity, data target, and deadline after landing are unchanged.'
        : 'Explicitly edited assumptions are included in this preview; inspect details before adopting.'
    }</p></div>`;
  }

  scopeControls() {
    return `<div class="scope-options"><button data-flow="search" data-value="site">${icon(
      'pin'
    )}<b>Keep the proposed date</b><span>Compare the three prepared sites</span>${icon(
      'arrow',
      '',
      16
    )}</button><button data-flow="search" data-value="date">${icon(
      'clock'
    )}<b>Keep the proposed site</b><span>Test this time and six later daily starts</span>${icon(
      'arrow',
      '',
      16
    )}</button><button data-flow="search" data-value="both">${icon(
      'compare'
    )}<b>Either can change</b><span>Compare all 21 prepared site/date cases</span>${icon(
      'arrow',
      '',
      16
    )}</button></div><p class="search-boundary">Tested candidates only, not a global optimum. Deadlines remain relative to landing.</p>`;
  }

  alternativesHTML() {
    const valid = this.options.filter((c) => c.metrics);
    const pass = valid.filter((c) => c.metrics.feasible);
    const b = this.state.baseline;
    const sorted = orderedAlternatives(this.options, this.searchBase);
    const cards = sorted.filter((c) => c.metrics.feasible).slice(0, 3);
    const referencePass = this.options.find((c) => samePlan(c.settings, this.searchBase) && c.metrics?.feasible);
    let h = `<div class="alternatives-heading"><div><span class="eyebrow">CHECKED, NOT GUESSED</span><h2>${
      pass.length ? 'There are workable options.' : 'No tested option meets the objective.'
    }</h2><p>${pass.length} of ${valid.length} calculated cases meet the objective.${
      valid.length < this.options.length ? ` ${this.options.length - valid.length} outside supported coverage.` : ''
    }</p></div>${action('scope', 'Change search', 'secondary')}</div><div class="search-context">${icon(
      'settings',
      '',
      15
    )}${
      this.searchMode === 'site' ? 'Proposed date held fixed' : this.searchMode === 'date' ? 'Proposed site held fixed' : 'Site and date may change'
    } · Same hardware and activity · Current plan not replaced</div>`;
    if (!cards.length) {
      h += `<div class="no-options">${icon(referencePass ? 'checkcircle' : 'info', '', 24)}<div><h3>${
        referencePass ? 'The searched plan already works.' : 'Keep the limits visible.'
      }</h3><p>${
        referencePass
          ? 'No different passing alternative was found in this tested set.'
          : 'The tested sites and starts do not meet these requirements. You can change the search, or explicitly review mission assumptions.'
      }</p></div></div>`;
    }
    h += `<div class="luna-option-grid">${cards
      .map((c, i) => {
        const idx = this.options.indexOf(c);
        const sel = this.selected && samePlan(c.settings, this.selected.settings);
        const d = changeSummary(this.searchBase, c.settings);
        return `<article class="luna-option ${sel ? 'selected' : ''}"><div class="option-tag">${
          i === 0 ? 'FIRST PASSING ALTERNATIVE' : 'PASSING OPTION'
        }${icon('checkcircle', '', 15)}</div><h3>${esc(shortSite(c.site))}</h3><p class="option-date">${esc(
          when(c.settings)
        )}</p><div class="option-change">${
          c.distanceKm < 0.005 ? 'Same site' : num(c.distanceKm, 2) + ' km from search site'
        } · ${d.hours === 0 ? 'same date' : fmtHours(d.hours) + ' later'}</div><dl><div><dt>${icon(
          'data',
          '',
          14
        )}Result returned</dt><dd>${elapsed(c.metrics.completeHour)}</dd></div><div><dt>${icon(
          'clock',
          '',
          14
        )}Before deadline</dt><dd>${elapsed(c.metrics.deadlineMarginHours)}</dd></div><div><dt>${icon(
          'battery',
          '',
          14
        )}Lowest charge</dt><dd>${num(c.metrics.minSocPct)}%</dd></div></dl>${action(
          'review',
          `${sel ? 'Selected' : 'Review this option'} ${icon('arrow', '', 15)}`,
          sel ? 'primary' : 'secondary',
          idx
        )}</article>`;
      })
      .join('')}</div><p class="search-boundary">Ordered by passing status, then smallest delay, then distance among evaluated candidates. Inspect the differences before adopting.</p>`;
    if (this.selected) {
      h += `<section class="adoption-review"><div><span class="eyebrow">REVIEW BEFORE REPLACING</span><h3>Use this as your current plan?</h3><p>Only this confirmation updates the plan shown in Overview.</p></div>${this.comparison(
        b,
        this.selected
      )}<div class="adoption-actions">${action('accept', `${icon('check', '', 16)}Use this plan`, 'primary')}${action(
        'evidence',
        'Inspect the mission',
        'secondary'
      )}${action('cancel', 'Keep current plan', 'text-btn')}</div></section>`;
    }
    h += `<details class="all-cases"><summary>${icon('compare', '', 16)}See every tested case (${this.options.length})<span data-icon="down"></span></summary><div class="cases-scroll"><table><thead><tr><th>Site</th><th>Landing UTC</th><th>Outcome</th><th>Reason</th><th></th></tr></thead><tbody>${this.options
      .map(
        (c, i) =>
          `<tr><td>${esc(shortSite(c.site))}</td><td>${esc(when(c.settings))}</td><td><span class="case-state ${
            c.metrics?.feasible ? 'pass' : 'fail'
          }">${icon(c.metrics?.feasible ? 'checkcircle' : c.metrics ? 'warning' : 'info', '', 13)}${
            c.metrics?.feasible ? 'Meets objective' : c.metrics ? 'Does not meet' : 'Not evaluated'
          }</span></td><td>${esc(c.metrics?.reason || c.error || 'No data')}</td><td>${
            c.metrics ? action('review', 'Inspect', 'text-btn', i) : ''
          }</td></tr>`
      )
      .join('')}</tbody></table></div></details>`;
    if (!this.selected) {
      h += `<div class="alternatives-footer">${action('cancel', 'Keep current plan', 'secondary')}${action(
        'explain',
        'Explain these results',
        'text-btn'
      )}</div>`;
    }
    return h;
  }

  async perform(id, value) {
    if (this.state.busy || this._destroyed) return;
    this.error = '';
    try {
      switch (id) {
        case 'keep':
          this.resetPreview();
          this.stage = 'kept';
          this.sync();
          this.say('Your current plan is kept. Nothing has changed. You can watch its mission in Overview.');
          this.context = 'kept';
          this.choices([
            ['watch', 'Watch in Overview'],
            ['change', 'Test a change'],
          ]);
          break;
        case 'change':
          this.stage = 'change';
          this.kind = 'date';
          this.selected = null;
          this.sync();
          this.say('What changed? I’ll check it without replacing your current plan.');
          this.context = 'change';
          this.choices([
            ['kind', 'Landing delayed', 'date'],
            ['kind', 'Different location', 'site'],
            ['kind', 'Site and time', 'both'],
          ]);
          break;
        case 'kind':
          this.kind = ['date', 'site', 'both'].includes(value) ? value : 'date';
          this.stage = 'change';
          this.sync();
          if (this.kind === 'date') {
            this.context = 'delay';
            this.say('How much later is the landing? The mission, hardware, and deadline after landing will stay the same.');
            this.choices([
              ['delay', '1 day later', '1'],
              ['delay', '3 days later', '3'],
              ['custom', 'Choose a date'],
            ]);
          } else if (this.kind === 'site') {
            this.context = 'site';
            this.say('Which prepared location should I check at the same landing time?');
            this.choices(
              this.state.bundle.sites.filter((s) => s.id !== this.state.baseline.site.id).map((s) => ['site', shortSite(s), s.id])
            );
          } else {
            this.say('Choose the proposed site and UTC time in the form, then select “Check this change”.');
            this.choices([
              ['custom', 'Show the form'],
              ['cancel', 'Keep current plan'],
            ]);
          }
          break;
        case 'custom':
          $('decisionWorkspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          if (window.innerWidth < 900) this.toggleChat(false);
          $('proposedDate')?.focus({ preventScroll: true });
          break;
        case 'delay':
          await this.preview(shiftedSettings(this.state.baseline.settings, +value));
          break;
        case 'site':
          await this.preview({ ...this.state.baseline.settings, siteId: value });
          break;
        case 'check': {
          const s = { ...this.state.baseline.settings };
          if (this.kind !== 'site') s.startUTC = checkedUTC($('proposedDate').value);
          if (this.kind !== 'date') s.siteId = $('proposedSite').value;
          await this.preview(s);
          break;
        }
        case 'advanced-check': {
          const s = {
            ...this.reference().settings,
            siteId: $('siteInput').value,
            startUTC: checkedUTC($('dateInput').value),
            durationHours: +$('durationInput').value,
          };
          if (s.deadlineHours > s.durationHours) {
            throw new Error('The evaluated duration must include the existing return deadline. Edit it explicitly in Activity & hardware.');
          }
          await this.preview(s);
          break;
        }
        case 'scope':
          this.stage = 'scope';
          this.selected = null;
          this.sync();
          this.context = 'scope';
          this.say('What must stay fixed while I look for alternatives?');
          this.choices([
            ['search', 'Keep the proposed date', 'site'],
            ['search', 'Keep the proposed site', 'date'],
            ['search', 'Either can change', 'both'],
          ]);
          break;
        case 'search':
          await this.search(value || 'both');
          break;
        case 'review':
          await this.review(Number(value));
          break;
        case 'accept':
          await this.accept();
          break;
        case 'cancel':
          this.resetPreview();
          this.stage = 'current';
          this.sync();
          this.say('Back to your current plan. The proposed changes have not been applied.');
          this.context = 'welcome';
          this.choices([
            ['change', 'Test a change'],
            ['keep', 'Keep current plan'],
          ]);
          break;
        case 'watch':
          this.api.page('overview');
          break;
        case 'evidence':
          this.evidence();
          break;
        case 'explain':
          this.explain();
          break;
        case 'settings':
          this.settings();
          break;
        case 'transmit':
          this.evidence();
          this.api.jump('transmit');
          this.say(
            this.state.result.metrics.firstTxHour === null
              ? 'There is no powered transmission in this calculated result. The selected ground station may be blocked, or the mission may lack data or radio power.'
              : `The timeline is at the first powered transmission, ${elapsed(
                  this.state.result.metrics.firstTxHour
                )} after landing. Earth visibility alone does not mean the radio is transmitting.`
          );
          break;
        default:
          this.say('Use the suggested answers, or ask about the current calculation.');
      }
    } catch (e) {
      this.inlineError(e.message);
      this.say(`I could not check that change: ${e.message} Your current plan is unchanged.`);
    }
  }

  resetPreview() {
    this.stage = 'current';
    this.trial = null;
    this.selected = null;
    this.options = [];
    this.searchBase = null;
    this.state.active = 'current';
    this.state.alternative = null;
    this.api.showResult(this.state.baseline);
    if ($('compareSection')) $('compareSection').hidden = true;
    this.fillEditor(this.state.baseline.settings);
  }

  async preview(settings) {
    if (this.state.busy || this._destroyed) return;
    this.api.busy(true, 'Checking your proposed change');
    try {
      const next = normalize(settings);
      if (!this.state.bundle.sites.some((s) => s.id === next.siteId)) {
        throw new Error('Choose one of the three prepared sites.');
      }
      const r = await this.api.compute(next);
      if (this._destroyed) return;
      this.trial = r;
      this.selected = null;
      this.options = [];
      this.stage = 'checked';
      this.state.active = 'alternative';
      this.state.alternative = r;
      this.api.showResult(r);
      this.fillEditor(r.settings);
      this.error = '';
      this.sync();
      this.say(
        `${r.metrics.feasible ? 'The revised plan still meets the objective.' : 'This revised plan does not meet the objective.'} ${
          r.metrics.reason
        }\n\n${r.metrics.feasible ? 'Would you like to use this revision or keep the current plan?' : 'What can change to find an alternative?'}`
      );
      this.context = r.metrics.feasible ? 'accept' : 'scope';
      this.choices(
        r.metrics.feasible
          ? [
              ['accept', 'Use revised plan'],
              ['cancel', 'Keep current plan'],
              ['scope', 'Compare alternatives'],
            ]
          : [
              ['search', 'Keep proposed date', 'site'],
              ['search', 'Keep proposed site', 'date'],
              ['search', 'Either can change', 'both'],
              ['cancel', 'Keep current plan'],
            ]
      );
    } catch (e) {
      this.inlineError(e.message);
      this.say(`That change could not be evaluated: ${e.message} Your current plan is unchanged.`);
    } finally {
      this.api.busy(false);
    }
  }

  async search(mode) {
    if (this.state.busy || this._destroyed) return;
    this.searchMode = ['site', 'date', 'both'].includes(mode) ? mode : 'both';
    this.searchBase = { ...(this.trial || this.state.baseline).settings };
    this.selected = null;
    this.api.busy(true, 'Checking the permitted alternatives');
    try {
      this.options = await this.api.request('search', { settings: this.searchBase, mode: this.searchMode });
      if (this._destroyed) return;
      this.stage = 'alternatives';
      this.sync();
      const passing = this.options.filter((c) => c.metrics?.feasible);
      this.say(
        passing.length
          ? `${passing.length} of ${
              this.options.filter((c) => c.metrics).length
            } evaluated cases meet the objective. The options keep the same science and hardware. Review an option before adopting it.`
          : 'None of the evaluated alternatives meets the objective. I have not changed your requirements or replaced your current plan.'
      );
      const ranked = orderedAlternatives(this.options, this.searchBase)
        .filter((c) => c.metrics.feasible)
        .slice(0, 2);
      this.context = 'options';
      this.choices([
        ...ranked.map((c) => ['review', `${shortSite(c.site)} · ${fmtDate(c.settings.startUTC, true)}`, this.options.indexOf(c)]),
        ['scope', 'Change the search'],
        ['cancel', 'Keep current plan'],
      ]);
      $('decisionWorkspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      this.inlineError(e.message);
      this.say('The search could not finish. ' + e.message);
    } finally {
      this.api.busy(false);
    }
  }

  async review(index) {
    const c = this.options[index];
    if (!c?.metrics) throw new Error('Choose a calculated option.');
    this.api.busy(true, 'Opening this calculated option');
    try {
      const r = await this.api.compute(c.settings);
      if (this._destroyed) return;
      this.selected = r;
      this.stage = 'alternatives';
      this.state.active = 'alternative';
      this.state.alternative = r;
      this.api.showResult(r);
      this.sync();
      this.say(
        `${shortSite(r.site)} on ${when(r.settings)}. ${r.metrics.reason}\n\n${
          r.metrics.feasible
            ? 'Review the changes on the left. Shall I use this as your current plan?'
            : 'This option does not meet the objective. Keep looking rather than treating it as a fix.'
        }`
      );
      this.context = 'accept';
      this.choices(
        r.metrics.feasible
          ? [
              ['accept', 'Use this plan'],
              ['evidence', 'Show the evidence'],
              ['cancel', 'Keep current plan'],
            ]
          : [
              ['evidence', 'Show the limitation'],
              ['scope', 'Change the search'],
              ['cancel', 'Keep current plan'],
            ]
      );
    } finally {
      this.api.busy(false);
    }
  }

  async accept() {
    const r = this.selected || this.trial;
    if (!r) {
      this.say('There is no proposed plan to adopt. Your current plan is unchanged.');
      return;
    }
    if (!r.metrics.feasible) {
      this.say(
        'This proposal does not meet the objective, so I will not present it as a working replacement. Inspect its limitation or change the search.'
      );
      return;
    }
    const success = await this.api.run(r.settings);
    if (success && !this._destroyed) {
      this.stage = 'accepted';
      this.sync();
      this.say('Done. This is now your current plan. Overview will show the adopted result.');
      this.context = 'kept';
      this.choices([
        ['watch', 'Watch in Overview'],
        ['change', 'Test another change'],
      ]);
    }
  }

  openEditor() {
    const el = $('planEditor');
    if (!el) return;
    el.open = true;
    this.fillEditor(this.reference().settings);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  fillEditor(s) {
    if (!$('siteInput')) return;
    $('siteInput').value = s.siteId;
    $('dateInput').value = s.startUTC.slice(0, 16);
    if (![...$('durationInput').options].some((o) => +o.value === s.durationHours)) {
      $('durationInput').add(new Option(fmtHours(s.durationHours), s.durationHours));
    }
    $('durationInput').value = s.durationHours;
    $('missionSummary').textContent = `${s.scienceMinutes} min measurement · ${num(s.dataMB)} MB`;
  }

  settings() {
    this.api.settingsDialog();
    const s = this.reference().settings;
    for (const el of $('settingsForm').elements) {
      if (el.name && s[el.name] !== undefined) el.value = s[el.name];
    }
  }

  evidence() {
    const el = $('missionEvidence');
    if (!el) return;
    el.open = true;
    this._delay(() => {
      this.state.scene?.resize();
      this.api.updateFrame();
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  }

  inlineError(msg) {
    this.error = String(msg);
    if ($('decisionError')) {
      $('decisionError').textContent = this.error;
      $('decisionError').hidden = false;
    }
    this.api.notify(this.error, true);
  }

  say(text, user = false) {
    if (!$('chatMessages')) return;
    const row = document.createElement('div');
    row.className = 'chat-message' + (user ? ' user' : ' luna-message');
    const label = document.createElement('small');
    label.textContent = user ? 'YOU' : 'LUNA';
    const body = document.createElement('p');
    body.textContent = text;
    row.append(label, body);
    $('chatMessages').append(row);
    while ($('chatMessages').children.length > 24) $('chatMessages').firstElementChild.remove();
    if ($('guideBody')) $('guideBody').scrollTop = $('guideBody').scrollHeight;
  }

  choices(items) {
    if (!$('lunaChoices')) return;
    $('lunaChoices').innerHTML = items
      .map(([id, label, value]) => action(id, `${esc(label)}${icon('chevron', '', 13)}`, 'luna-answer', value ?? ''))
      .join('');
    if ($('guideBody')) $('guideBody').scrollTop = $('guideBody').scrollHeight;
  }

  welcome() {
    const b = this.state.baseline;
    this.say(
      `Hi, I’m Luna, your moon-rabbit guide. ${
        b.metrics.feasible ? 'Your current plan meets the selected objective.' : 'Your current plan needs attention.'
      }\n\nDo you need to change the plan?`
    );
    this.choices([
      ['change', 'Yes, test a change'],
      ['keep', 'No, keep the plan'],
      ['explain', 'Explain the result'],
    ]);
  }

  explain(r = this.reference()) {
    this.context = 'explain';
    const m = r.metrics;
    const prefix = samePlan(r, this.state.baseline)
      ? 'Current plan'
      : this.selected
      ? 'Inspected alternative'
      : 'Proposed change';
    const explainDialog = $('explainDialog');
    const explainContent = $('explainContent');
    if (explainDialog && explainContent) {
      explainContent.innerHTML =
        `<div class="plan-verdict ${m.feasible ? 'is-good' : 'needs-attention'}" style="border-radius:12px;margin-bottom:16px">` +
        `<div class="verdict-symbol">${icon(m.feasible ? 'checkcircle' : 'warning', '', 26)}</div>` +
        `<div class="verdict-copy"><div class="verdict-eyebrow">${esc(prefix.toUpperCase())} <span>${
          m.feasible ? 'OBJECTIVE MET' : 'LIMITATION DETECTED'
        }</span></div><h3 style="font-size:20px;margin:0 0 6px">${esc(outcomeTitle(r, !samePlan(r, this.state.baseline)))}</h3><p style="margin:0">${esc(
          m.reason
        )}</p></div></div>` +
        `<table><tbody>` +
        `<tr><th>Landing site</th><td>${esc(r.site.name)}</td></tr>` +
        `<tr><th>Landing UTC</th><td>${esc(when(r.settings))}</td></tr>` +
        `<tr><th>Ready to start activity</th><td>${esc(elapsed(m.readyHour))}</td></tr>` +
        `<tr><th>Science completed</th><td>${esc(elapsed(m.scienceEndHour))} after landing</td></tr>` +
        `<tr><th>Data return completed</th><td>${esc(elapsed(m.completeHour))} after landing</td></tr>` +
        `<tr><th>Return deadline</th><td>${esc(fmtHours(r.settings.deadlineHours))} after landing</td></tr>` +
        `<tr><th>Lowest battery</th><td>${num(m.minSocPct)}% (reserve ${r.settings.reservePct}%)</td></tr>` +
        `<tr><th>Gross solar harvested</th><td>${num(m.energyKWh, 2)} kWh over ${esc(fmtHours(r.settings.durationHours))}</td></tr>` +
        `<tr><th>Ground contact opportunity</th><td>${esc(elapsed(m.contactHours))} (actual transmitting ${esc(elapsed(m.transmissionHours))})</td></tr>` +
        `</tbody></table>` +
        `<p style="margin-top:14px">Ground contact reflects geometric line-of-sight from ${esc(
          r.settings.stationId
        )}, not a reserved DSN booking.</p>`;
      explainDialog.showModal();
      return;
    }
    if (!$('guidePanel')) return;
    this.toggleChat(true, false);
    this.say(
      `${prefix}: ${
        m.feasible ? 'The objective is met under the selected assumptions.' : 'The objective is not met.'
      } ${m.reason}\n\nScience completes: ${elapsed(m.scienceEndHour)} after landing.\nData return: ${elapsed(
        m.completeHour
      )} after landing.\nDeadline: ${fmtHours(r.settings.deadlineHours)}.\nGround contact: ${elapsed(
        m.contactHours
      )}.\nActual transmission: ${elapsed(m.transmissionHours)}.\n\nContact is a modelled opportunity, not a ground-station reservation.`
    );
    this.choices([
      ['evidence', 'Explore the evidence'],
      ['transmit', 'Show data return'],
      ['change', 'Test a change'],
    ]);
  }

  async ask(text) {
    if (this.state.busy || !text.trim() || this._destroyed) return;
    this.say(text, true);
    const q = text.toLowerCase().trim();
    if (/^(yes|yes please|yep|sure)[.! ]*$/.test(q)) {
      return this.perform(this.context === 'accept' ? 'accept' : this.context === 'scope' ? 'scope' : 'change');
    }
    if (/^(no|no thanks|keep (it|this|the current plan)|keep current plan)[.! ]*$/.test(q)) return this.perform('keep');
    if (/start (over|again)|reset.*chat/.test(q)) {
      this.resetPreview();
      this.stage = 'current';
      this.sync();
      $('chatMessages')?.replaceChildren();
      this.welcome();
      return;
    }
    if (/need.*change|change.*plan/.test(q) && !/(\d|site|date|delay)/.test(q)) return this.perform('change');
    if (/current.*(good|work|okay)|plan.*still.*(work|good)|why|explain/.test(q) && !/closer|nearer/.test(q)) {
      this.explain(q.includes('current') ? this.state.baseline : this.reference());
      return;
    }
    if (this.context === 'site') {
      const site = this.state.bundle.sites.find((s) => q === shortSite(s).toLowerCase() || q === s.id);
      if (site) return this.perform('site', site.id);
    }
    if (/(?:delay|later)/.test(q) && !/[0-9]/.test(q)) return this.perform('kind', 'date');
    if (this.context === 'delay' && /^\d+(\.\d+)?\s*(days?|hours?)?$/.test(q)) {
      const n = parseFloat(q);
      return this.preview(shiftedSettings(this.state.baseline.settings, n, q.includes('hour') ? 'hours' : 'days'));
    }
    if (/same date|keep.*date/.test(q) && this.context === 'scope') return this.perform('search', 'site');
    if (/same site|keep.*site/.test(q) && this.context === 'scope') return this.perform('search', 'date');
    if (/either|both/.test(q) && this.context === 'scope') return this.perform('search', 'both');
    if (/use (this|the revised|the alternative)|adopt/.test(q)) return this.perform('accept');
    if (/hardware|settings/.test(q)) {
      this.settings();
      return;
    }

    try {
      const answer = localGuide(text, { result: this.reference() });
      if (answer.action === 'update') {
        const permitted = [
          'siteId',
          'startUTC',
          'durationHours',
          'scienceMinutes',
          'scienceW',
          'dataMB',
          'deadlineHours',
          'areaM2',
          'panelMode',
          'batteryKWh',
          'initialSocPct',
          'reservePct',
          'loadW',
          'stationId',
          'maxRateMbps',
          'txPowerW',
          'heightM',
        ];
        const params = {};
        for (const [k, v] of Object.entries(answer.params || {})) {
          if (!permitted.includes(k) || typeof v !== typeof this.reference().settings[k]) {
            throw new Error('Unsupported setting: ' + k);
          }
          params[k] = v;
        }
        await this.preview({ ...this.reference().settings, ...params });
      } else if (answer.action === 'compare') {
        this.stage = 'scope';
        this.sync();
        this.context = 'scope';
        this.say('What can change while the hardware and mission requirements stay fixed?');
        this.choices([
          ['search', 'Location only', 'site'],
          ['search', 'Date only', 'date'],
          ['search', 'Site and date', 'both'],
        ]);
      } else if (answer.action === 'seek') {
        this.evidence();
        this.api.jump(answer.event);
        this.say(answer.text);
      } else if (answer.action === 'camera') {
        this.evidence();
        this.state.scene?.setCamera(answer.camera);
        this.say(answer.text);
      } else if (answer.action === 'sources') {
        this.api.openSources();
        this.say('The source dialog identifies the prepared NASA data and the model assumptions.');
      } else if (answer.action === 'play') {
        this.evidence();
        this.state.playing = true;
        this.api.updateFrame();
        this.say('Playing the calculated sequence. You can pause, scrub time, or select a mission milestone.');
      } else if (answer.action === 'latest') {
        this.evidence();
        await this.api.findLatest();
        if (!this._destroyed && $('latestResult')) this.say($('latestResult').textContent);
      } else {
        this.context = 'general';
        this.say(
          answer.text.startsWith('I’m the built-in guide')
            ? 'I can help check a plan, test a delay, compare prepared sites, or explain energy and contact results. Start with one of these answers.'
            : answer.text
        );
        this.choices([
          ['change', 'Test a change'],
          ['explain', 'Explain the result'],
          ['transmit', 'Show data return'],
        ]);
      }
    } catch (e) {
      this.state.aiEnabled = false;
      this.say(`I could not complete that request: ${e.message} The offline guided buttons still work. Your plan has not been replaced.`);
    } finally {
      if ($('sendChat')) $('sendChat').disabled = false;
    }
  }
}
