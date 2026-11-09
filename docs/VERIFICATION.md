# Verification — Planner upgrade

Build basis: the accepted `LunaShift_Clean_Overview.zip`.
Tested in the current build session; see `qa/upgrade/` for logs and browser results.

## Preservation

- Overview section markup: exact comparison against the accepted baseline.
- Planner top introduction and hidden removed actions: exact comparison.
- Overview controller: SHA-256 preserved.
- Solar engine, mission energy/radio engine and numerical bundle: SHA-256 preserved.
- Existing decision/search module, worker and core geometry: unchanged by this update.
- Main navigation stays Overview / Planner. Removed Guide / Present / top example-save-open controls are not restored.

New planner diagnostics, charting, layout, controlled comparisons and display annotations are extensions. The online cross-check adapter changes are explicitly separate from the offline model.

## Automated checks

**174 JavaScript unit/numerical tests: 174 passed, 0 failed.**

The new tests include energy accounting with initial charge and curtailment; signed alternative gains; restored and regressed requirements; percentage-point battery changes; missing/sparse controlled comparisons; sampled-date runs; geometry versus powered transmission; exact UI-section preservation; height-aware inspected-scenario online requests; and ideal BER reference validation against independent quadrature. Existing numerical, geometry, battery, communication and decision tests continue to pass.

**7 Python online-adapter tests: 7 passed.**

These use controlled responses to test airless angle parsing, finite values, UTC behavior, separate collector/antenna heights and malformed input. They are not evidence of a successful outbound JPL service call.

**82 exact-standalone browser workflow assertions: 82 passed.**

Covered: preserved navigation/introduction; collapsible settings; actual computed example results; expand/restore of 3D/map/horizon; 45-case search and 13 passes; location/date matrix interaction; four controlled comparisons; restored requirements and quantified gains; failing manually inspected alternatives; A preservation; powered-radio event; five real chart modes; source-reference disclosures; apply/restore; changed preference handling; retained polar/lander views; 30-day geometry playback without changing mission totals; CSV columns; offline data status; mouse-closeable drawer; responsive layout at 1280/900/768/390 px; stale-result invalidation; changed area changing computed energy; impossible-capacity search guard; no observed JavaScript exceptions and no external network requests in standalone operation.

The browser's prohibited localhost/file navigation was not bypassed. The exact standalone HTML was loaded using Playwright set_content; its own embedded scripts, worker and data ran normally. Chromium software/Canvas rendering was exercised. Safari and a hardware WebGL renderer were not independently visually verified. Rehearse on the actual presentation machine.

**6 local HTTP checks passed:** health, source page, new CSS, controlled source-success response, separate equipment-height forwarding, and clear 503 source-error response. The endpoint test used a mocked external provider; it does not certify live availability.

A separate ordinary Chromium graphics probe (without disabling WebGL) also selected the Canvas fallback, with no observed JavaScript errors.

## Live online attempt

A real Horizons request was attempted and failed immediately with `Temporary failure in name resolution` in the build environment. The app must therefore not claim live cross-check verification here. `qa/upgrade/live-horizons.json` records the failure. The local HTTP adapter can still be exercised with mock source data and error propagation.

## Reproducible sample outcome

Default seven-day Shoulder mission: 55.0563 kWh generated, 10.7162% minimum charge, 5.2519 h task-ready, 0 GB delivered. Preferred tested Crest mission on 10 November: 70.8155 kWh, 30.0% minimum charge, 5.2362 h task-ready, 1 GB delivered. Relocation is about 1.59 km and delay is three days.

The default Both search tests 3 loaded sites × 15 dates = 45 cases, of which 13 pass. Crest on the original date passes 3/4 checks; Shoulder on the alternative date passes 1/4; changing both passes 4/4. Results remain model-dependent.

## Bounds

Three prepared locations, 2026–2027 coverage; imported sites require compatible numerical data. No continuous or whole-Moon optimum, no landing-safety certification, no operational station reservation. Collector-point solar model; declared electrical losses; preliminary adaptive radio/fade-margin model. Optional BER diagnostic is perfect-sync uncoded reference only. Scene scale and celestial symbols are enlarged and terrain surface lighting is illustrative. A displayed passing sample does not certify all times between grid dates.
