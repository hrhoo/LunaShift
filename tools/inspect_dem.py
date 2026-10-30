#!/usr/bin/env python3
"""Inspect a lunar GeoTIFF and optionally write a candidate at its raster center."""
import argparse
import csv
from pathlib import Path

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--dem',required=True)
    p.add_argument('--write-sites',help='Optional output CSV containing the raster-center test point')
    a=p.parse_args()
    try:
        import rasterio
        from pyproj import CRS,Transformer
    except ImportError:
        p.exit(1,'Install optional dependencies: python -m pip install -r requirements-terrain.txt\n')
    with rasterio.open(a.dem) as ds:
        if ds.crs is None:p.exit(1,'The file has no CRS. Stop; do not guess its coordinate system.\n')
        crs=CRS.from_wkt(ds.crs.to_wkt())
        print('File:',Path(a.dem).name)
        print('Dimensions:',ds.width,'x',ds.height,'pixels; bands:',ds.count)
        print('Data types:',ds.dtypes,'NoData:',ds.nodata)
        print('Bounds:',ds.bounds,'Pixel resolution:',ds.res)
        print('Scale factors:',ds.scales,'Offsets:',ds.offsets)
        print('Reference ellipsoid:',crs.ellipsoid.name)
        print('Semi-major/minor radii:',crs.ellipsoid.semi_major_metre,crs.ellipsoid.semi_minor_metre,'m')
        print('CRS:',crs.to_wkt())
        if abs(crs.ellipsoid.semi_major_metre-1737400)>1:
            p.exit(1,'Not the required lunar reference radius. Do not use the v1 converter without a proper transformation.\n')
        tx=Transformer.from_crs(crs,crs.geodetic_crs,always_xy=True)
        x,y=ds.xy(ds.height//2,ds.width//2)
        lon,lat=tx.transform(x,y)
        print(f'Raster-center test point: latitude {lat:.9f}, east longitude {lon%360:.9f}')
        print('Check the source README for MOON_ME_DE421 and vertical units. CRS alone may not establish the lunar frame.')
        print('The raster center is a convenience sample, NOT a safe or recommended landing point.')
        if a.write_sites:
            with open(a.write_sites,'w',newline='',encoding='utf-8') as f:
                w=csv.writer(f);w.writerow(['site_id','name','latitude_deg','longitude_deg','slope_deg'])
                w.writerow(['REAL1','DEM center test point',f'{lat:.10f}',f'{lon%360:.10f}',''])
            print('Wrote',a.write_sites)
if __name__=='__main__':main()
