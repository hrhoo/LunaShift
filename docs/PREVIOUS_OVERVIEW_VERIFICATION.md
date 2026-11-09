# Overview-only update — verification

Build date: 8 November 2026.

## Actual tests

- **131/131 automated unit tests passed** (125 retained tests plus six data-connection-state tests).
- **65/65 source-preservation, browser-workflow and local-HTTP checks passed**. The detailed record is `qa/overview/results.json`.
- The standalone document's exact bytes were loaded through Playwright `set_content`. Direct `file://` and localhost navigation are blocked by policy in this browser environment; they were not falsely reported as tested.
- Chromium headless with WebGL disabled was used. The new Overview uses the existing Canvas/software sphere renderer. No claim of Safari or accelerated-WebGL verification is made.

## Preserved without modification

SHA-256 checks matched the preceding input build for:

- solar-model.js
- mission-model.js
- decision-model.js
- sky-model.js
- polar-scene.js
- comparison-scene.js
- worker.bundle.js
- data/lunar-data.json

The full `#page-planner` source section also matched exactly. Shared navigation was simplified, and data-connection detection/messages were corrected. The retained original example still tested 45 combinations, found 13 passing combinations and selected Connecting Ridge · Crest on 10 November 2026 under the same priority. Apply/restore, CSV export, JSON save and the existing views were exercised.

## New Overview checked

Only two navigation entries; removed redundant launch/example/Guide/Present controls; no interactive data badge in the header; no old workflow/footer blocks; current UTC; pause/resume; accelerated playback; return to Now; drag and keyboard rotation; reset; out-of-coverage refusal; navigation state isolation; no horizontal overflow at 1280, 768 and 390 pixel widths. The standalone made no external HTTP(S) requests during the browser workflow.

## Online distinction

Six unit tests exercised the exact data-status function using explicitly controlled file, valid-server, invalid-server, failed-request, failed-cross-check and successful-cross-check responses. These are state tests, not proof of JPL connectivity.

The real local Python server served its health endpoint and revised HTML. A real POST to its Horizons adapter returned a structured failure because outbound DNS resolution was unavailable in this environment. **A successful live JPL response was not verified.** Offline calculation availability remained separate from that result.

## Scientific display limits

Overview uses the packaged Moon-fixed geometric ephemeris, with its existing interpolation and limitations. It is not live imagery or a new precision validation. Body sizes and distances are compressed. Earth's illustration is not a forecast of its cloud pattern or orientation. Sphere shading is not a terrain-wide shadow simulation. The fixed reference-site sky readouts use the unchanged numerical terrain skyline at 2 m.
