# Work on LunaShift together

Keep one clean release folder and export a workspace before changes. Do not share private caches, virtual environments or kernel binaries through source control. Share data source URLs, hashes and workspace JSON instead.

## Useful ownership boundaries
- Interface: web/geometry.js, geometry.css, existing page scripts.
- Geometry: geometry.py, spice_engine.py, horizons.py.
- Terrain: existing DEM preparation and horizon modules.
- Engineering: battery, solar, link budget and repair modules.
- QA/documentation: tests/, qa/, docs/ and the illustrated manual.

## Change safely
1. Make a feature branch.
2. State the units, frame and assumptions affected.
3. Add a regression test.
4. Run `python -m unittest discover -s tests -v`.
5. Check the interface with the app actually running.
6. Export and reopen a project.
7. Update the manual and source labels.

## Next scientific validation
Run `tools/verify_spice.py --online` in a configured SPICE environment and inspect direction differences at multiple sites/dates. Keep the JSON report. Do not turn an arbitrary tolerance into an accuracy claim. Compare coordinate definitions, ephemeris versions and aberration choices first.

The included browser QA uses a localhost API bridge due build-environment navigation restrictions. Native Mac/Windows/Colab end-to-end checks remain valuable and are not replaced by these harness tests.
