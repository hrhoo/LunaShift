# LunaShift — Lunar South Pole Mission Planner

## Open it

Double-click **LunaShift_Open.html** in a current desktop browser. It contains the app, visual assets and prepared calculation data. No account, internet connection, Python or npm is required for the standalone application.

The approved Overview and the Planner's top introduction are unchanged. Navigation still contains only **Overview** and **Planner**. No Guide/Present buttons or visible Load example/Save/Open controls have been restored at the top.

## Start with the included mission

1. Select **Planner**. The Shoulder mission beginning 7 November 2026 calculates automatically.
2. Expand **Mission requirements & hardware** only to change settings. Its summary stays visible when closed.
3. Inspect the linked **3D surface, 2D map and local horizon**. Each has an expand/restore control. One time cursor drives all of them.
4. Click **Find an alternative**. The default search allows both locations and dates, up to 14 days later, sampled daily.
5. Compare blue A with gold B. The gain panel reports changes in actual units, including regressions.
6. Select **Explore all tested sites & dates**. The site-by-date matrix shows every tested case. Click a cell to inspect that case as B, without replacing A.
7. Read **Is it the location, the date, or both?** This controlled comparison keeps hardware and requirements fixed and uses results actually evaluated by the search.

The baseline search evaluates 45 combinations and finds 13 that meet the four selected checks. Under the unchanged highest-minimum-battery ranking, Crest on 10 November 2026 is the preferred tested choice. This is a bounded prepared-data demonstration, not a global lunar optimum.

## What this update adds

- A calmer two-column Planner and collapsible hardware inputs.
- Larger linked 3D, 2D and horizon views; automatic framing of both landers.
- An interactive site × landing-date feasibility matrix.
- Explicit original/location-only/date-only/combined comparisons.
- A quantified benefit panel with restored and newly failed requirements.
- Electrical energy accounting: loads, storage, losses, unused surplus and initial charge.
- Separate gross-harvest and task-ready clocks.
- Link-quality readouts: station clearance, C/N0, rate-cap margin and powered transmission.
- Cumulative energy and link-margin plots sharing the mission cursor.
- An optional, source-grounded uncoded Rician-BPSK reference, not a modem or coded-link claim.
- Equipment-height-aware online Horizons cross-check, with discrepancy warnings.
- A fixed data-drawer stacking issue that could previously block mouse clicks.

The solar, battery/radio mission engine, search equations and numerical data are retained. The new decision explanations operate on their results, rather than replacing them with invented scores.

## Offline and online

The standalone file uses prepared numerical data, including for its current-UTC sky. Current-time calculation does not imply an internet connection.

For the optional online JPL Horizons check, extract the full package and run **Start_Windows.bat**, **Start_Mac.command**, **start_linux.sh**, or:

```sh
python3 run.py
```

Open the localhost address printed by the launcher. Keep that window open. The application needs this server's `/api/horizons` route; a plain static server does not provide it. The launcher uses only the Python standard library.

Inside Planner, open **Data, online check & imports**. A successful health check proves only that the local server exists, not that JPL is reachable. The online request uses the inspected A/B site, time, collector height and antenna height. It compares Sun and Earth angles but does not silently replace data, validate terrain, extend coverage or reserve a ground station. Differences exceeding 0.1° are warned about, not automatically accepted as agreement.

Live JPL retrieval was attempted in this build environment and failed at DNS resolution. The adapter and response/error paths were checked with controlled fixtures; successful outbound live retrieval remains unverified here.

## Data bounds and scientific interpretation

The packaged calculation data cover three prepared Connecting Ridge locations and 1 January 2026 through 1 January 2028. Imports can add compatible numerical terrain/skyline sites. A map pin alone cannot generate missing terrain.

Task-ready energy includes initial battery charge and means energy stored above reserve. It does not automatically execute the payload task. Generated kWh are not all stored: surplus is curtailed when loads and storage cannot absorb it.

The radio assessment is a declared preliminary link budget plus fade-margin model. Ground access, model rate and actual powered transmission are different quantities. The optional ideal BER diagnostic has no effect on the delivered-data calculation and is not the uploaded paper's PLL/LDPC simulation.

Landers, panels and celestial symbols are exaggerated for readability. The local mesh is explanatory, not a validated complete shadow map or landing-safety model. Geometry-only sky playback does not create battery/data results beyond the mission.

## Read more

- `docs/QUICK_START.md`: settings, matrix, comparison and presentation walkthrough.
- `docs/SOURCE_MODEL_BOUNDARIES.md`: exactly how the two supplied sources relate to the code.
- `docs/VERIFICATION.md`: tests, preservation checks and known limitations.
- `docs/DATA_SOURCES.md` and `docs/MODEL.md`: retained preparation and model details.

## Source and tests

```sh
npm test
python3 qa/upgrade/online_adapter_test.py
python3 tools/build_worker.py
python3 tools/build_standalone.py
```

`qa/upgrade/browser_test.py` requires Python Playwright and Chromium. It tests the exact standalone file via in-memory loading because local browser navigation is restricted in the build environment. Change the Chromium executable path in the script for your system. Application users do not need these tools.

The full package contains source, generated standalone application, numerical data, attribution notices, examples and test records. No original licensed paper PDF is redistributed.
