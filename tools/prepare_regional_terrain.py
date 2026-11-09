#!/usr/bin/env python3
"""Prepare display-only regional terrain without regenerating mission data.

Install numpy, rasterio and pyproj, then pass the original Site01 GeoTIFF:
  python tools/prepare_regional_terrain.py --dem /path/to/Site01.tif
The source must match the SHA-256 in web/data/provenance.json.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pyproj
import rasterio

from prepare_data import DEM, FRAME, RADIUS_M, digest, local_lonlat, normal_basis

ROOT = Path(__file__).resolve().parents[1]
SPACING_M = 40
PADDING_M = 1600


def build_region(dem_path, bundle, provenance):
    source = next(s for s in provenance['source_metadata']['sources'] if s['id'] == 'lola-site01')
    if digest(dem_path) != source['sha256']:
        raise ValueError('Site01 SHA-256 does not match the recorded NASA source.')
    fine = DEM(dem_path)
    sites = [s for s in bundle['sites'] if s.get('metadata', {}).get('prepared_site')]
    reference = next(s for s in sites if s['id'] == 'ridge-shoulder')
    fields = ('id', 'latitude_deg', 'longitude_deg', 'ground_elevation_m')
    ref = {key: reference[key] for key in fields}
    east, north, up = normal_basis(ref['longitude_deg'], ref['latitude_deg'])
    origin = up * (RADIUS_M + ref['ground_elevation_m'])
    offsets = []
    for site in sites:
        _, _, direction = normal_basis(site['longitude_deg'], site['latitude_deg'])
        delta = direction * (RADIUS_M + site['ground_elevation_m']) - origin
        offsets.append([float(delta @ east), float(delta @ north)])
        height = float(fine.lonlat(site['longitude_deg'], site['latitude_deg']))
        if abs(height - site['ground_elevation_m']) > .01:
            raise ValueError('Source elevation does not agree with prepared site: ' + site['id'])
    offsets = np.array(offsets)
    lo = np.floor((offsets.min(axis=0) - PADDING_M) / SPACING_M) * SPACING_M
    hi = np.ceil((offsets.max(axis=0) + PADDING_M) / SPACING_M) * SPACING_M
    x, y = np.meshgrid(np.arange(lo[0], hi[0] + 1, SPACING_M), np.arange(lo[1], hi[1] + 1, SPACING_M))
    heights = np.full(x.shape, ref['ground_elevation_m'])
    # Match the existing site meshes' radial-height and local-ENU convention.
    for _ in range(5):
        lon, lat = local_lonlat(x, y, ref['longitude_deg'], ref['latitude_deg'], heights)
        heights = fine.lonlat(lon, lat)
        if not np.isfinite(heights).all():
            raise ValueError('Regional crop leaves valid source coverage; refusing to fill terrain.')
    return {
        'schema_version': 'lunashift-regional-terrain-1',
        'id': 'connecting-ridge-region',
        'name': 'Connecting Ridge regional terrain',
        'coordinate_frame': FRAME,
        'reference': ref,
        'sites': [{key: site[key] for key in fields} for site in sites],
        'mesh': {
            'width': x.shape[1], 'height': x.shape[0], 'spacing_m': SPACING_M,
            'origin_x_m': float(lo[0]), 'origin_y_m': float(lo[1]),
            'row_order': 'south_to_north',
            'height_datum': 'radial metres above 1737400 m sphere',
            'elevations_m': np.round(heights, 1).tolist(),
        },
        'metadata': {
            'source_url': source['url'], 'source_sha256': source['sha256'],
            'source_resolution_m': source['native_resolution_m'],
            'source_citation': source['source_citation'],
            'source_bounds_projected_m': list(fine.bounds),
            'bounds_local_m': [*lo.tolist(), *hi.tolist()],
            'padding_m': PADDING_M, 'display_resolution_m': SPACING_M,
            'elevation_rounding_m': .1, 'vertical_exaggeration': 1,
            'sampling': 'Bilinear source pixels at pixel centres; iterated local ENU / radial-height projection.',
            'coverage': 'One continuous NASA Site01 crop covering all three prepared sites and the terrain between them.',
            'role': 'Display only. Numerical horizon, illumination, energy and radio inputs are unchanged.',
            'limitations': 'Published LOLA surface includes interpolation; pixel spacing is not measurement accuracy. No additional gap filling.',
            'tool_versions': {'numpy': np.__version__, 'rasterio': rasterio.__version__, 'pyproj': pyproj.__version__},
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dem', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'web/data/regional-terrain.json')
    args = parser.parse_args()
    bundle = json.loads((ROOT / 'web/data/lunar-data.json').read_text())
    provenance = json.loads((ROOT / 'web/data/provenance.json').read_text())
    region = build_region(args.dem, bundle, provenance)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    tmp = args.output.with_suffix('.tmp')
    tmp.write_text(json.dumps(region, separators=(',', ':'), allow_nan=False) + '\n')
    tmp.replace(args.output)
    print(f"Prepared {region['mesh']['width']} × {region['mesh']['height']} regional mesh: {args.output.stat().st_size:,} bytes")


if __name__ == '__main__':
    main()
