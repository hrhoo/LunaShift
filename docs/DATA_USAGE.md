# Source use register · v0.5.0

A source link is not the same as an imported dataset. This register states the actual role of every resource. No source is claimed to be fully downloaded or automatically consumed.

## JPL Horizons
**API adapter + raw-response cache** — Sun/Earth directions, apparent sizes and ranges

Source: https://ssd-api.jpl.nasa.gov/doc/horizons.html

Connection must succeed. The app never replaces a failed request with synthetic tracks.

## LOLA / PGDA elevation
**GeoTIFF upload + converter** — Site elevation, local slope and sampled terrain skyline

Source: https://pgda.gsfc.nasa.gov/products/78

Needs optional terrain packages. Limited to documented MOON_ME_DE421 lunar rasters; finite terrain range is disclosed.

## NASA Moon Trek / LROC mosaic
**WMTS capabilities + tile adapter** — Zoomable imagery and map context

Source: https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon

Tiles are historical images, not a live camera. Missing imagery is not replaced by synthetic lunar imagery.

## LROC QuickMap
**External reference only** — Independent visual site inspection

Source: https://quickmap.lroc.asu.edu/

Not scraped and not claimed as an imported calculation dataset.

## PGDA polar illumination / Earth visibility
**GeoTIFF context-layer sampler** — Long-term regional context and screening

Source: https://pgda.gsfc.nasa.gov/products/69

Long-term averages do not replace the selected-date time series. Some source download links may be unavailable.

## NASA NAIF SPICE
**Integrated local engine + managed kernel setup** — Sun/Earth geometry from the normal interface

Source: https://naif.jpl.nasa.gov/naif/

Select Automatic, Horizons or SPICE in Mission Setup. The guided installer supplies SpiceyPy and a compatible pinned DE421/MOON_ME_DE421 kernel set. Actual source and file hashes are recorded. The teaching example remains invented until you explicitly prepare real data. See SPICE.md for implementation and unverified live-kernel limits.

## ShadowCam imagery
**External reference only** — Images of polar shadowed terrain

Source: https://www.shadowcam.asu.edu/

No new quantitative terrain is inferred from photographs.

## NASA CLPS
**External reference only** — Mission and target-region background

Source: https://www.nasa.gov/commercial-lunar-payload-services/

No invented mission hardware is presented as a CLPS vehicle specification.

## LRO Diviner
**GeoTIFF context-layer sampler** — Measured lunar surface thermal context

Source: https://pds-geosciences.wustl.edu/missions/lro/diviner.htm

Surface temperature is NOT panel or battery temperature. No thermal balance or heater prediction is inferred.

## NASA Small Spacecraft power reference
**Reference + explicitly editable assumptions** — Engineering background for solar and battery models

Source: https://www.nasa.gov/smallsat-institute/sst-soa/power-subsystems/

All included lander presets are illustrative, not a measured spacecraft.

## JPL DSN 810-005
**External reference; generic receiver settings** — Authoritative radio design reference

Source: https://deepspace.jpl.nasa.gov/dsndocs/810-005/

No actual DSN antenna allocation, performance table or schedule is bundled. Current revisions must be checked for mission-specific parameters.

## NASA lunar surface propagation
**External reference only** — Limits of a free-space LOS radio calculation

Source: https://www.nasa.gov/glenn/glenn-expertise-space-exploration/scan/lunar-surface-propagation/

Multipath and fading are NOT simulated. A clearance warning is not a measured fading probability.

## NASA Eyes
**Embedded external viewer + fallback link** — Interactive Earth–Moon–Sun overview

Source: https://eyes.nasa.gov/apps/solar-system/#/moon

Independent NASA viewer. It is NOT synchronized with the mission timeline and is not a live camera.

## NASA SVS illumination reference
**External reference only** — Reference animation of shadows, Sun and Earth

Source: https://svs.gsfc.nasa.gov/5228/

Precomputed visualization, not a numeric validation at arbitrary points.

## NASA SVS CGI Moon Kit
**Live image + optional local cache** — LROC-derived global colour texture

Source: https://svs.gsfc.nasa.gov/4720/

Processed imagery with polar inpainting; not a terrain elevation model and not used for power calculations.
