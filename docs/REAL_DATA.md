# Real NASA data: from source to decision

## 1. Open a real image; do not confuse it with a calculation

Lunar Map → **Connect NASA map**. Pan, zoom, or enter latitude and east longitude. Global imagery uses an equirectangular map; it is distorted near the poles. Polar context layers use their lunar south-polar stereographic grids. The map reads WMTS capabilities instead of assuming an Earth Web Mercator grid. Matrix IDs and bounds are checked.

A failed detailed-imagery service triggers an explicitly labelled attempt to use NASA's coarse global LROC-derived colour texture. This texture includes source-processed polar gaps and cannot support metre-scale terrain interpretation. The scale/resolution warning must remain visible. If both fail, there is no fabricated replacement.

Click **Save candidate** to add a candidate with missing terrain/ephemerides. Coordinates are not evidence of landing safety. Click **Start with a real location** to remove the teaching sites, after saving a copy.

## 2. Fastest real-data learning route

Enable the terrain packages with `bash Enable_Real_Data_Mac.sh` or the Colab optional-install setting. Open **Data & Sources → Load a real NASA example**. The loader:

1. Downloads the PGDA Site04 surface-elevation GeoTIFF from product 78.
2. Checks the TIFF, lunar CRS, source coverage and pixel metadata.
3. Chooses the actual raster centre as a candidate, not an approved landing point.
4. Builds spherical terrain rays over a limited radius (up to 5 km), with 2-degree azimuth and 100-m range samples.
5. Prepares Sun/Earth AZ/EL, angular sizes and observer ranges using the selected geometry source for the current mission interval.
6. Commits the new workspace only after all steps succeed.

The source is 5 m/pixel, but this first sampling is deliberately coarser and finite-range. **A 5 m source is not the same as a 5 m-accurate result.** Distant terrain, small ridges and transitions between time samples can be missed. The local slope is a DEM-derived estimate, not a certified hazard map. Increase radius and refine sampling; compare successive answers before scientific use.

The network path was not executed successfully in the build environment. The loader may fail on an unavailable product, blocked network, certificate issue or incompatible raster. The existing project stays unchanged. Use the manual route below rather than treating the teaching example as real.

## 3. Manual terrain route

Open the original [PGDA product page](https://pgda.gsfc.nasa.gov/products/78). Select **LDEM / surface elevation**, not the slope, uncertainty, illumination, JPEG preview or clone archive. Download the `.tif` containing your chosen location. Read its README: confirm MOON_ME of DE421, metres, surface height relative to the 1,737,400 m lunar reference sphere.

In **Data & Sources**, choose the saved location, enter the exact product/version in the source field, confirm the documented frame, choose the DEM and click **Attach real terrain**. The server refuses missing pixels, unsupported Earth CRS and rays outside coverage. Browser uploads are capped at 512 MiB. Use the CLI for larger files:

```bash
.venv/bin/python tools/inspect_dem.py --help
.venv/bin/python tools/convert_geotiff.py --help
```

A full example, run from the project root after creating `sites.csv`:

```bash
.venv/bin/python tools/convert_geotiff.py \
  --dem "/full/path/to/site_surface.tif" --sites sites.csv \
  --output terrain_project.json --frame MOON_ME_DE421 \
  --source "NASA PGDA product 78, exact site and file version" \
  --radius-km 5 --az-step-deg 2 --range-step-m 100
```

`sites.csv` columns: `site_id,name,latitude_deg,longitude_deg`. Use the actual point inside that DEM. Opening `terrain_project.json` replaces the workspace. Do not invent a site coordinate from the filename alone.

Attaching terrain updates the ground elevation and clears old ephemerides. Fetch new tracks next.

## 4. Horizons route

In **Data & Sources → Get Sun & Earth tracks**, select the same site. The period must cover the entire mission and every delay you plan to test. For a 120-hour mission and a 24-hour delay, fetch at least 144 hours. The query requests the Moon surface as observer, airless apparent azimuth/elevation, angular diameter and range in kilometres. Sun and Earth are requested sequentially and cached with raw responses.

Longitude is east-positive; project times are UTC. Check original service headers and coordinate conventions. Mast-height parallax in the celestial directions is neglected; mast height is used in the terrain horizon. Never mix an Earth-referenced map CRS with lunar terrain.

Failure is not replaced with synthetic tracks. Import a correctly formatted ephemeris CSV as an alternative. Distances are optional for legacy CSVs; when absent the engineering module visibly uses its stated reference distance/irradiance assumptions.

## 5. Additional NASA layers

Upload a compatible georeferenced GeoTIFF as **context**, declare its variable, source, units and frame. Supported types: average illumination, average Earth visibility, surface temperature, local slope, height uncertainty, hazard, science value. The sampler reads the containing pixel at full resolution, applies scale/offset and keeps NoData missing. It does not treat map colour brightness as a measured physical variable.

Context values are not automatically substituted into equations or thresholds. A time-averaged illumination map does not become an hourly Sun track. A Diviner surface temperature does not become the panel temperature. A height RMS is not a calibrated success probability. Version 0.5.0 does not automatically propagate the 100 terrain clones into ensemble uncertainty.

## 6. Integrated local SPICE

SPICE is selectable in Mission Setup alongside Automatic and Horizons. Run the operating-system setup script, then use Data & Sources > SPICE made simple > Check setup. The managed installer selects compatible NASA files; the normal user does not need to assemble a meta-kernel.

Select NASA SPICE and click Prepare Sun & Earth data. This supplies real local geometry only when setup and date coverage succeed. It does not change the terrain. Explicit SPICE never silently switches to Horizons. The app can use the same tracks for visibility, energy and repair calculations.

An optional exporter remains for batch workflows:

```bash
.venv/bin/python tools/export_spice.py \
  --project exported_workspace.json --site SITE_1 \
  --start 2026-12-15T00:00:00Z --stop 2026-12-22T00:00:00Z \
  --step-min 60 --output site_tracks.csv
```

Omitting --meta-kernel uses the managed engine. Supplying it selects the advanced legacy custom-kernel route; see tools/export_spice.py. Those custom files are not used by the normal managed UI. Actual-kernel validation was not possible in the build environment. Run tools/verify_spice.py in the configured environment. See SPICE.md for conventions, pinned model and limitations.

## 7. A new competition dataset

First identify its physical meaning, provenance, frame, units, resolution, time coverage and NoData value. Then choose: terrain, ephemeris, context, or reference. Keep the raw file unchanged. Test a known pixel/location. Compare before and after using the same mission/hardware settings. Export both workspaces and reports. A changed number alone is not evidence that the newer dataset is more accurate.

## 8. Stop conditions

Do not use an answer when source coverage is incomplete, an import required guessing the frame/units, a terrain change has stale ephemerides, or output changes materially when the time/range step is refined. Do not label any result flight-certified, actual DSN access, or statistically calibrated confidence.
