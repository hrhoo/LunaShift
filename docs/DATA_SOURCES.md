> v7 provenance note: the terrain, display meshes, appearance image and original Sun vectors are reused from the supplied v6 archive. Their upstream preparation record is retained below. They were not re-downloaded during this build. New Earth vectors and Earth orientation were generated from the hash-verified kernels supplied in v5.

# LunaShift v6 data sources and preparation

The browser package contains real NASA LOLA terrain and real JPL NAIF ephemerides. It is a bounded, reproducible engineering demonstration, not a certified landing or flight-planning system. A plausible-looking Moon texture is never used as elevation data. A free globe pin does not create missing terrain data.

## Packaged files

- `web/data/lunar-data.json`: three prepared candidate points, numerical terrain rays, local display meshes, and hourly Sun vectors.
- `web/data/regional-terrain.json`: one continuous Connecting Ridge display mesh, sampled from the same hash-verified Site01 source; independent of the numerical mission inputs.
- `web/data/provenance.json`: source URLs, SHA-256 digests, generation metadata, and site summaries.
- `web/assets/moon-color.jpg`: authentic NASA CGI Moon Kit colour map, 2048 × 1024 pixels, used only for appearance.
- `tools/prepare_data.py`: reproducible source-data preparation. No Python service is needed by the published application.
- `tools/requirements-data.txt`: the pinned Python package versions used for preparation.
- `tools/kernel-manifest.json` and `tools/download_kernels.py`: the original kernel manifest and a standard-library downloader that verifies every kernel's size and SHA-256 digest.

## Near terrain: Connecting Ridge

Source: [NASA PGDA product 78](https://pgda.gsfc.nasa.gov/products/78), [source README](https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/README), and [Site01_final_adj_5mpp_surf.tif](https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site01/Site01_final_adj_5mpp_surf.tif).

The complete original GeoTIFF is 3,200 × 3,200 pixels with 5 m grid spacing. Its projected bounds are x = −19,000 to −3,000 m and y = −20,000 to −4,000 m. Heights are metres above a 1,737,400 m lunar reference sphere. The coordinate system is south polar stereographic, central meridian 0°, origin −90°, in the mean Earth/polar axis frame associated with DE421 (`MOON_ME_DE421`). Pixel values are located at pixel centres, not corners.

This is a published interpolated surface derived from LOLA observations, not one laser measurement per pixel. The source README explicitly says empty pixels have been interpolated. There are no missing pixels in the downloaded Site01 surface; the LunaShift pipeline performs no additional missing-value filling. Pixel spacing is not a claim of equal positional accuracy or an assurance that small obstacles are represented.

Required citation: Barker et al. (2021), “Improved LOLA Elevation Maps for South Pole Landing Sites: Error Estimates and Their Impact on Illumination Conditions,” *Planetary and Space Science* 203, 105119. [DOI: 10.1016/j.pss.2020.105119](https://doi.org/10.1016/j.pss.2020.105119).

The three candidate labels—Crest, Shoulder, and Lower ground—are descriptive sample labels selected from this terrain patch. They are not NASA-approved landing coordinates. Their exact positions, reference elevations, and sampling metadata are in the bundle. Local slopes are least-squares plane fits over 50 m squares, sampled every 5 m, for comparing scenarios rather than certifying lander safety.

## Regional terrain: surrounding horizon

Source: [NASA PGDA product 90](https://pgda.gsfc.nasa.gov/products/90) and [LDEM_80S_80MPP_ADJ.TIF](https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF).

The full 189,158,392-byte upstream GeoTIFF was downloaded using ordinary verified HTTPS. A 200 km square around the south pole is cropped locally for preparation. This regional surface has 80 m native grid spacing and shares the documented DE421 mean Earth frame, south polar stereographic projection, metre units, and 1,737,400 m reference radius. The raw source and derived crop each have a recorded SHA-256 digest.

The fine 5 m surface is used wherever the requested coordinate lies inside its valid pixel-centre footprint. The 80 m regional surface is used outside that footprint, up to the 80 km sampling limit. Both are actual published LOLA-derived products. Stored profiles contain no fabricated elevations or seam blending. The independently adjusted surfaces can disagree at their seam; that limitation is retained explicitly. The calculation engine's separate assumption beyond the sampled profiles is described below.

Required citation: Barker et al. (2023), *The Planetary Science Journal* 4, 183. [Paper DOI: 10.3847/PSJ/acf3e1](https://doi.org/10.3847/PSJ/acf3e1). [Data DOI: 10.60903/gsfcpgda-lola-spole](https://doi.org/10.60903/gsfcpgda-lola-spole).

## Numerical terrain profiles

Each prepared point has 720 radial terrain profiles, spaced by 0.5° in azimuth. Azimuth is clockwise from local north: 0° north, 90° east. Distances are spherical geodesic arc distances on the stated lunar reference sphere. Stored heights are absolute radial elevations in metres above that sphere, rounded to 0.1 m for compact storage.

The radial samples are:

| Distance from observer | Sample spacing |
|---|---:|
| 5–500 m | 5 m |
| 520–2,000 m | 20 m |
| 2,040–8,000 m | 40 m |
| 8,240–80,000 m | 240 m, with a final 80 km point |

Elevations are bilinearly sampled from the appropriate source grid. Every radial sample is checked for finite source coverage; generation fails instead of filling or silently truncating missing terrain. Source resolution and ray spacing are distinct: taking more samples cannot recover terrain finer than a DEM's native resolution.

A horizon must be computed from these profiles using the observer's reference elevation and selected height, including lunar curvature. Beyond the 80 km sampled range, the calculation engine assumes the unrepresented Moon follows the 1,737,400 m reference-radius sphere; it does not extend the site's ground elevation around the Moon. This is an explicit geometric assumption, not measured distant topography and not an addition to the stored DEM profiles. Distant mountains, peaks between azimuth rays, and features between radial samples can be missed. This package does not claim numerical convergence, full global obstruction coverage, or independent validation against operational illumination products.

## Continuous regional display terrain

The Planner's 3D and overhead views use one fixed 7.0 × 4.68 km crop covering all three prepared sites, with at least 1.6 km of surrounding context. The 176 × 118 grid is sampled at 40 m from the original 5 m Site01 GeoTIFF. The source SHA-256 is checked against `provenance.json` before sampling; this is a fresh crop of the published surface, not an interpolation between the old display tiles. Every sample must fall inside finite source coverage. The packaged asset is about 148 KB.

The mesh uses a fixed east/north tangent frame at the Shoulder site and absolute radial elevations above the 1,737,400 m reference sphere. Projection uses the existing preparation conventions, including pixel-centre sampling and iterative radial-height positioning. Rendering includes lunar curvature and uses true vertical scale. Craft are enlarged for readability. The A/B distance connector denotes geographic separation, not a traversable route or a visibility calculation.

Changing sites or dates retains the same surrounding terrain. The regional asset records the exact supported site coordinates and elevations; other imported sites fall back to their supplied display meshes. An imported horizon alone does not generate terrain. The regional display asset does not modify terrain rays, site elevations, ephemerides, or mission calculations, and it is embedded in the standalone HTML for offline use.

Regenerate only this display asset, without ephemeris kernels or SpiceyPy:

```sh
python -m pip install numpy rasterio pyproj
curl -fL https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site01/Site01_final_adj_5mpp_surf.tif -o /path/to/Site01.tif
python tools/prepare_regional_terrain.py --dem /path/to/Site01.tif
python tools/build_standalone.py
```

Use an isolated environment. Replace the placeholder source path with a local cache path. Sampling details, source hash, citation and library versions are retained in the regional asset's metadata. The 40 m display grid and the source's 5 m pixel spacing are not accuracy claims. The larger 80 m regional product remains an input to the existing horizon profiles; it is not needed for this display crop.

## Local 3D display meshes (legacy and import fallback)

Each site also contains a 151 × 151 local grid spanning 3 km at 20 m spacing, sampled separately from the 5 m source. This is deliberate display decimation; the numerical terrain profiles are not derived from the decimated mesh.

The mesh contract is:

- x increases east; y increases north in the selected site's local frame.
- `origin_x_m = origin_y_m = -1500`, `spacing_m = 20`.
- Rows run south to north; columns run west to east.
- `elevations_m[row][column]` is absolute radial height above the 1,737,400 m sphere. Subtract the site's `ground_elevation_m` for a local display height. If the renderer needs exact local tangent-frame vertical coordinates, apply spherical curvature; absolute radial heights are not pre-corrected tangent-plane heights.
- Stored height values have no vertical exaggeration. If the viewer exaggerates them, it must label that display choice.

The local horizontal grid is constructed in an east/north basis around the observer, and its lunar longitude/latitude is iteratively solved using the sampled surface radius. Geographic coordinates for interpolation therefore use the same Moon-fixed frame as the scientific terrain profiles.

## Sun ephemeris

Five original kernel files were extracted from the user-supplied `LunaShift_v5.zip` kernel set `lunashift-de421-me421-v1`. Each file was verified against the supplied manifest's SHA-256 digest before loading into CSPICE:

| Kernel | Role |
|---|---|
| `naif0012.tls` | UTC to ephemeris-time conversion |
| `de421.bsp` | Sun, Earth, and Moon positions |
| `pck00011.tpc` | Planetary body constants |
| `moon_pa_de421_1900-2050.bpc` | DE421 lunar orientation |
| `moon_080317.tf` | Matching lunar mean Earth frame |

The bundle contains 17,521 Sun vector samples from **2026-01-01T00:00:00Z through 2028-01-01T00:00:00Z**, inclusive, one sample per hour. Its field names are `start_utc`, `end_utc`, `step_seconds`, and `sun_positions_km`. In v7, Earth vectors and Earth-fixed-to-Moon rotation quaternions are added at the same time samples. See the added Earth section below.

Vectors come from `spkpos('SUN', et, 'MOON_ME_DE421', 'NONE', 'MOON')`. They are instantaneous **geometric**, Moon-centred Cartesian Sun positions in kilometres. They omit light-time and stellar-aberration corrections. The browser must subtract the selected observer's Moon-centred position before converting a vector to local azimuth/elevation.

Between samples the browser may linearly interpolate Cartesian vectors. Extrapolation outside the packaged date range is not allowed. Two hundred Sun midpoint checks against direct SPICE evaluation gave a maximum angular difference of approximately 0.0000155°. These check interpolation only; they do not independently validate the ephemeris model, terrain, event finding, or system as a whole. Hourly vector sampling does not imply hourly mission-result resolution: the browser's event/result sampling is an additional disclosed choice.

All kernel source URLs, exact digests, toolkit and wrapper versions, and numerical interpolation checks are in `provenance.json`. Source repository: [JPL NAIF generic kernels](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/).

## Global Moon colour map

Source: [NASA SVS CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/) and its [2K colour map](https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg). NASA describes how the appearance map combines source imagery and polar/inpainted treatments. The texture communicates location and appearance; it supplies no numerical topography and no illumination result. No generative lunar imagery is used.

## Reproduce

Use **Python 3.12 or newer** in an isolated environment. The original Sun/terrain preparation uses NumPy, Rasterio, PyProj and SpiceyPy. The additional Earth preparation uses NumPy and SciPy. `tools/requirements-data.txt` lists these optional preparation dependencies; it is not a runtime installation requirement. These dependencies are needed only to regenerate the data. The shipped browser application uses the already prepared bundle.

From the project root, with that environment active:

```sh
python -m pip install -r tools/requirements-data.txt
python tools/download_kernels.py --check-manifest
python tools/download_kernels.py --output /path/to/lunashift-de421-me421-v1
python tools/prepare_data.py --cache /path/to/source-cache --kernels /path/to/lunashift-de421-me421-v1
python tools/add_earth_data.py /path/to/lunashift-de421-me421-v1
python tools/build_worker.py
python tools/build_standalone.py
```

Replace the two `/path/to/...` arguments with directories on your computer. The downloader needs only Python's standard library. `--check-manifest` validates the five source records without making network requests or writing files. The download command fetches about 19 MB directly from the official NAIF HTTPS URLs recorded in the original manifest, verifies size and SHA-256 for every file, reuses valid cached files, and writes the original manifest as `manifest.json` inside the kernel directory. A mismatching download is rejected. No credentials are needed, and the source ZIP does not contain kernel binaries.

`tools/kernel-manifest.json` was copied unchanged from the supplied v5 kernel set. Its original `installed_utc` field records that earlier installation, not the date of a new download.

The preparation script verifies the kernel hashes again, downloads the original NASA raster assets, crops regional terrain, computes profiles/meshes, calculates the Sun ephemeris, rejects missing terrain, and writes `web/data/lunar-data.json` plus provenance. Its default paths are relative to the script's project directory; no workspace-specific path is embedded. Original rasters require approximately 231 MB of source downloads in addition to the kernels, plus space for the crop and temporary calculations. These are preparation inputs, not runtime browser downloads. HTTPS certificate validation remains enabled.

## Earth and Earth-station geometry added in v7

`earth_positions_km` is geometric Moon-centred Earth position in MOON_ME_DE421. `earth_fixed_to_moon_quaternions` gives ECEF to lunar-frame rotations (x,y,z,w) using the IAU_EARTH constants in the supplied pck00011, not precise ITRF/EOP. The original SPK/PCK files are hash checked against `tools/kernel-manifest.json`. The restricted type-2 DAF reader is in `tools/de421_reader.py`; `add_earth_data.py` records its numerical consistency checks.

The v7 Earth preparation ran with Python 3.13.5, NumPy 2.3.5 and SciPy 1.17.0 in this environment. These describe this execution, not a minimum or a guarantee for other versions. Source arrays are precomputed; application users need none of these packages.

Ground-station ECEF reference positions: official NASA PDS RISE raw-data SIS, https://pds-geosciences.wustl.edu/insight/urn-nasa-pds-insight_documents/document_rise/RISE_InSight_SIS_Raw.htm . Radio gain/noise/performance values are user assumptions, not performance promises associated with the station names.
