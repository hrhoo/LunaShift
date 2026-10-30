# Architecture — v0.5.0

A local standard-library HTTP server serves the existing browser app. Optional dependencies are lazy-loaded. Core teaching mode remains usable without SPICE or Rasterio.

- `run.py`: REST handlers, token protection, atomic workspace updates and background job polling within the running local server.
- `lunashift/geometry.py`: Automatic/Horizons/SPICE routing; multi-site preparation and diagnostic comparisons.
- `lunashift/spice_engine.py`: managed NASA kernel setup, readiness, date coverage, pinned frame, serialized CSPICE calculations, exact-request cache and provenance.
- `lunashift/horizons.py`: existing online adapter and response parser.
- `lunashift/data.py`: project validation, UI settings, import/export; imported CSV clears inherited provider metadata.
- Existing visibility, terrain, energy, radio, search and map modules are retained.
- `web/geometry.js` and `geometry.css`: new source picker and guided setup inside the original design.
- `web/app.js`, `studio.js`, `v4.js`, `sky.js`: existing interactions, source-aware preflight and synchronized views.
- `tools/setup_spice.py`: CLI setup/check.
- `tools/verify_spice.py`: actual local-kernel smoke check, optional Horizons diagnostic.
- `tools/export_spice.py`: managed default CSV exporter; custom meta-kernel remains advanced.

Source choice is stored in ui_state. Actual track provider is stored independently on each site. Source selection never relabels the current dataset. Prepare operations validate on a copy and replace data only after success; site changes during a long operation are detected. Files, hashes, exact interval and geometry conventions are included in provenance.

SPICE's global kernel pool is not thread-safe by default; this app serializes its use with one lock and clears the pool before/after each operation. Do not call CSPICE directly from new API routes outside the managed context.
