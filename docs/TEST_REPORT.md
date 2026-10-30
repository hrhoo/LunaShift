# Release verification — LunaShift v0.5.0

## Automated checks
- 203 Python tests: existing app logic plus integrated source routing, setup failures, coverage checks, source metadata, atomic updates, caching, kernel-pool isolation, CSV provenance and UI-state compatibility.
- 200 scripted interface checks across six suites: 56 browser, 36 studio, 61 reliability, 16 existing usability, and 31 geometry-source checks.
- Notebook code syntax and structure, Python compilation and shell script syntax checked.
- 11 fresh-archive smoke checks passed: startup/version, source selector, accurate missing-SPICE response, atomic failure, visibility, engineering, repairs, export, PDF serving and restart recovery.
- PDF rendered and visually inspected, with link/page checks.

## What these tests actually mean
The UI harness renders Chromium from local HTML and bridges its requests to the actual loopback Python API. It tests DOM, controls, charts, state and backend integration. It does not validate a native browser network stack or a public deployment. Remote success and failure scenarios use declared fixtures. New SPICE numerical logic tests use mocks; the positive UI preparation test is explicitly a fixture.

## Not executed here
- Actual SpiceyPy/CSPICE with downloaded NASA kernels.
- Live NASA/Horizons/map downloads.
- Native Windows or macOS/Safari launch.
- A signed-in Google Colab session.

External DNS/package downloads were unavailable in the build environment. Therefore scientific SPICE-vs-Horizons accuracy remains unverified. The included tools/verify_spice.py and in-app comparison are provided for running those checks on the user machine. A green Check setup only confirms local setup and requested-date geometry readiness, not mission safety or power/radio accuracy.

## Model limitations
Synthetic teaching inputs remain synthetic. A prepared real sky with teaching terrain is labelled mixed. Terrain is finite-range and sampled; global 3D shadows are not implemented. Energy and radio are explicit engineering estimates. Earth-centre visibility is not ground-station scheduling. Optimization searches tested candidate combinations, not every location or every hardware design.
