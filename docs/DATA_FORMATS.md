# Data contracts — version 1

## Global conventions

Coordinates are lunar MOON_ME of DE421. Latitude is south-negative; longitude is east-positive. Site elevation and ray elevations are metres above a 1,737,400 m sphere. Azimuth is clockwise from north. Angles are degrees. Time is UTC. The exact poles are excluded because local north/azimuth is singular there.

These are the platform's accepted conventions, not automatic guesses about an uploaded dataset. A different frame, body or reference surface must be transformed correctly before import.

## Ephemeris CSV

```csv
time_utc,sun_azimuth_deg,sun_elevation_deg,earth_azimuth_deg,earth_elevation_deg
2026-11-01T00:00:00Z,58.0,1.15,24.0,3.3
2026-11-01T01:00:00Z,58.5,1.16,24.1,3.3
```

The two rows above illustrate the format; they are not NASA ephemerides. Each file belongs to one site. Rows must be strictly chronological and finite. The app validates azimuth and elevation ranges. Select the target site, record the source and set the largest allowed interpolation gap. The time series must cover the entire mission and proposed delays. No extrapolation is performed.

Both objects must be available on the same time grid. A table of average illumination percentages cannot be converted into this format without genuinely time-resolved data.

## Fixed-height horizon CSV

```csv
azimuth_deg,horizon_deg
0,1.1
2,1.2
4,1.4
```

This is only a header example; import requires a full circular skyline. Provide sorted, unique azimuths in [0,360), with no gap over 30 degrees. A repeated 360-degree endpoint is accepted only if it matches the 0-degree value. A fine step is normally needed; passing validation does not establish adequate resolution.

Specify the observer height and source during import. The platform cannot change this height because a skyline alone does not preserve all terrain samples. The repair search skips incompatible height candidates. Range is optional metadata, not a guarantee of completeness.

## Slope CSV

```csv
site_id,slope_deg
A,0.8
B,0.2
```

IDs must already exist. Slopes are degrees, not percent grade. This input updates a local slope filter only; it is not a hazard raster or a landing-footprint analysis. Retain the source and measurement baseline.

## Sites CSV for the optional converter

```csv
site_id,name,latitude_deg,longitude_deg,slope_deg
REAL1,My DEM test point,-89.5,35,
```

Replace coordinates with points actually inside your DEM. A blank slope causes the converter to estimate a local finite-difference slope. The example coordinates are not guaranteed to fall inside any downloaded tile.

## Project JSON

The easiest valid template is `data/demo_project_SYNTHETIC.json` or an exported workspace. A project has these top-level fields:

```json
{
  "schema_version": 1,
  "name": "My project",
  "coordinate_frame": "MOON_ME_DE421",
  "time_scale": "UTC",
  "sites": [],
  "history": []
}
```

A real file must contain 1–30 validated sites. Each site has `id`, `name`, `latitude_deg`, `longitude_deg`, `ground_elevation_m`, `slope_deg` (number or null), and `track_mode` (`none`, `imported`, or `synthetic`). Imported tracks are a list of dictionaries matching the CSV fields. Do not set `synthetic` mode for a real site merely to fill a missing time series.

A ray-based terrain object has:

- `kind: "rays"`
- `azimuth_deg`: complete, sorted circular angular grid.
- `distances_m`: positive, strictly increasing surface distances shared by all rays.
- `elevations_m`: one row per azimuth, one column per distance; values are radial terrain elevations, not relative height above the observer.
- `radius_m: 1737400.0`
- `range_limit_m`, `source`, `frame: "MOON_ME_DE421"`, and `synthetic`.

At each requested observer height the engine recomputes every angle and selects the maximum. Keeping only the previously highest point would be wrong when another point becomes the limiting obstruction.

Limits are 32 MB per request, 30 sites, 1.5 million terrain samples total, 720 azimuths per profile, 2,000 distances per ray and 25,000 imported track rows per site. These are prototype safeguards, not scientific resolution recommendations.

## New adapter checklist

1. Read source metadata; record provider, version, units, frame, grid, coverage and missing values.
2. Transform and normalize explicitly into an existing contract, or add a new documented contract.
3. Test one known point and reject missing or invalid coverage.
4. Add unit tests and a small reproducible example.
5. Keep provenance and synthetic/real flags intact.
6. Re-run the same mission and compare before/after metrics.

Only the formats described here are implemented. Automatic support for arbitrary NASA resources is future work.
