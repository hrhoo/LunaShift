> Internal solar-core reference, retained from v6. The delivered v7 application replaces its stand-alone storage summary with the coupled model in `MODEL.md`. Earth geometry, geometric eclipse masking, radio consumption, scheduled demand and task readiness are defined there.

# Solar model contract

Browser ESM, no dependencies. `web/solar-model.js` exports `computeScenario(bundle, settings)`, `horizonForSite(site, heightM)`, and `solarGeometry(bundle, site, isoTime, heightM = 0)`. The optional fourth argument raises the observer radially above the site's ground elevation. Additional pure helpers are exported for numerical verification.

## Data

The shared contract is `bundle.sites[]` with `id`, `name`, `latitude_deg`, `longitude_deg`, `ground_elevation_m`, and `terrain: {kind: "rays", azimuth_deg: number[], distances_m: number[], elevations_m: number[][], radius_m: number}`. Elevation rows correspond to azimuths, columns to distances. Distances are lunar surface arc distances; elevations are metres above the declared spherical lunar radius. Azimuths increase clockwise from north and are sorted in [0, 360); distances are strictly increasing and positive. Additional provenance metadata is preserved.

`bundle.ephemeris = {start_utc, step_seconds, sun_positions_km: [[x,y,z], ...] (the singular sun_position_km alias is also accepted), frame: "MOON_ME_DE421"}`. Positions are Moon-centred body-fixed Cartesian kilometres, equally spaced. Coverage includes both end samples. The model linearly interpolates Cartesian positions and never extrapolates. Curated terrain and ephemeris must use the same lunar reference frame. Supplied Moon-centred SPICE vectors retain their supplied aberration convention; subtracting the site's position is a topocentric geometric translation, not a new SPICE light-time solution.

## Settings and outputs

Settings use the camelCase names in the implementation's exported `DEFAULT_SETTINGS`. Fractions (`efficiency`, `lossFactor`, charge/discharge efficiencies) use 0–1; state-of-charge and reserve use 0–100 percent. Panel tilt is measured from horizontal; azimuth is clockwise from north. `vertical_tracking` follows solar azimuth with a vertical panel; `tracking` follows both solar angles; `horizontal` has a radial-up normal; `fixed` uses the entered tilt and azimuth.

`horizonForSite` returns `azimuthDeg`, `elevationDeg`, `heightM`, `rangeLimitM`, `blockers`, `smoothHorizonDeg`, and legacy snake_case aliases. `solarGeometry` returns `sunAzDeg`, `sunElDeg`, `distanceKm`, `angularRadiusDeg`, `irradianceWm2`, `directionENU`, `sunPositionKm`, `observerPositionKm`, and `utc`.

`computeScenario` returns inclusive endpoint `samples`, `metrics`, `horizon`, normalized `settings`, the selected `site`, and a compact `assumptions` string array. Samples include `utc`, `elapsedHours`, `sunAzDeg`, `sunElDeg`, `horizonDeg`, `sunFraction`, `powerW`, `loadW`, `socPct`, and `unservedW`. Interval energy fields on each sample describe the preceding interval; the first sample has zero interval energy.

`energyKWh` means electrical energy generated after the entered collector efficiency and loss factor. `loadKWh` is total demanded energy; `unservedKWh` records any demand the generator and battery cannot supply. `longestShortfallHours` describes solar generation below load, whereas `longestUnservedHours` describes unmet load after storage. `sunlitPct` is the fraction of the sampled period with any visible Sun disc, and `averageSunFraction` is the time average visible disc fraction. The reserve is a reporting threshold, not a battery cutoff.

## Scientific boundaries

- Curved lunar ray geometry and observer height are included. Beyond the finite ray radius, the model continues a smooth sphere at the declared lunar reference radius (1737400 m in the supplied bundle). The fallback is limited to distances beyond the measured rays: it uses the tangent to that reference sphere when the tangent lies beyond coverage, or the reference surface at the outer range boundary otherwise. It does not raise the global sphere to an elevated site's local ground level. `smoothHorizonDeg` reports this far-field fallback, not a replacement for measured terrain. Missing distant terrain and finite ray spacing can change the horizon; source resolution is not result accuracy.
- The collector is represented by one elevated point. A uniformly bright solar disc is integrated across the azimuth-varying skyline in a small-angle tangent plane. This is optical disc visibility, not a finite array shadow, string/mismatch, bypass-diode, or electrical partial-shading model. Panel incidence is evaluated at the disc centre.
- Irradiance scales from 1361 W/m² at one astronomical unit using observer-to-Sun distance. The apparent disc radius uses a solar radius of 695700 km. Efficiencies and the loss factor are constant, explicit inputs. No temperature, dust accumulation, thermal, structural, deployment, mass, or financial model is implied.
- Electrical power is sampled at the requested time spacing. Between samples it is piecewise linear. Energy is integrated exactly for that interpolation, splitting solar/load crossings and battery full/empty events; short shadow events between samples remain unresolved. Event times are model interpolations, not additional terrain/ephemeris evaluations.
- Battery storage has constant charge/discharge efficiencies, fixed usable capacity, and no power-rate limit, self-discharge, ageing, or temperature dependence. Loads may discharge below reserve to zero; unmet energy is then reported explicitly.
- Conservation is reported as generated + initial stored = served load + final stored + spilled generation + charge losses + discharge losses. No extrapolation, fictitious terrain, synthetic ephemeris, or silently substituted defaults for missing source data.
