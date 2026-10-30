# SPICE in LunaShift v0.5.0

## The normal workflow
SPICE is now integrated, not hidden behind an exporter. Choose it in Mission Setup and use Prepare Sun & Earth data. All downstream visibility, battery, power and generic radio models consume the resulting tracks through the same interface.

## What Automatic means
- Ready, date-covered SPICE is preferred when a new track is requested.
- Otherwise Horizons is selected and the reason is saved.
- A failure after a chosen calculation has begun is shown, not masked with invented geometry.
- Explicit SPICE and Horizons selections never silently switch engines.
- Existing imported sky data are reusable in Automatic. Press Prepare to deliberately replace them.
- Selecting a source does not replace the teaching dataset without preparation.

## Setup
Use Enable_SPICE_Mac.sh or Enable_SPICE_Windows.bat. Use the updated Colab notebook in Colab. After Python support is installed, Data & Sources > SPICE made simple can download, inspect and check the managed NASA files. No arbitrary shell commands are accepted through the HTTP API.

## Compatible managed set
DE421 is deliberately paired with MOON_ME_DE421, matching the app's declared coordinate convention. It is not advertised as the newest planetary ephemeris. Do not replace a kernel with an unrelated version without adding explicit frame transformation and validation.

| File | Purpose |
|---|---|
| naif0012.tls | UTC and ephemeris-time conversion |
| pck00011.tpc | Body size constants |
| de421.bsp | Planetary positions |
| moon_pa_de421_1900-2050.bpc | Matching lunar rotation |
| moon_080317.tf | Matching lunar frame definitions |

Official sources are fixed to https://naif.jpl.nasa.gov/pub/naif/generic_kernels/ . The planetary file is in spk/planets/a_old_versions/. Current readiness and the requested interval are checked from the actual loaded files; do not infer precise coverage only from filenames.

Downloads are explicit, bounded, staged and committed together. File signatures and sizes are checked, the published de421 MD5 is verified, and SHA-256 hashes are recorded for every file. Subsequent changes are detected against the local manifest. Existing complete files are not overwritten by a failed installation. Leap-second updates require a deliberate managed-set revision rather than replacing files by hand.

## Calculation details
- Python wrapper: SpiceyPy; optional dependency.
- CSPICE routine: spkcpo, constant observer position relative to MOON.
- Frame: MOON_ME_DE421, evaluated at observer epoch.
- Reception corrections: CN+S.
- Site coordinates: spherical planetocentric latitude, east longitude, radius 1737.4 km plus supplied ground elevation.
- Azimuth: north=0, clockwise; elevation: radial-horizontal local plane.
- Mean spherical radii approximate apparent disc size.
- Observer is at the ground point for celestial tracks. Mast-height parallax is neglected, consistent with the current Horizons route; mast height still changes terrain obstruction.
- Entire CSPICE kernel-pool use is locked to avoid cross-request contamination.
- Complete SPK-chain and lunar rotation coverage is intersected and padded by one hour, with geometry probes and per-sample evaluation.
- Exact request cache includes file hashes. Provenance is exported with the workspace.

## Validation limits
The automated offline tests use a fake CSPICE object or provider fixtures to check routing, frames, coverage handling, concurrency and failure behavior. They are not actual ephemeris accuracy tests.
The build environment blocked package and kernel downloads. Run on the installed machine:

```bash
.venv/bin/python tools/verify_spice.py
.venv/bin/python tools/verify_spice.py --online
```

On Windows replace `.venv/bin/python` with `.\.venv\Scripts\python.exe`.
The first checks actual local calculations; `--online` also requests Horizons comparisons. The UI comparison uses the first 24 mission hours at hourly spacing, does not modify attached tracks, and reports angle differences. This is a diagnostic, not a pass/fail flight certificate. Horizons can use a newer underlying ephemeris, so outputs are not promised to be identical.

## What it does not add
No terrain, spacecraft telemetry, map imagery, station booking or flight certification is supplied by SPICE. It supplies celestial geometry. Real terrain and clear engineering assumptions remain necessary.
