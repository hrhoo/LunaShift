#!/usr/bin/env python3
"""Convert a compatible lunar DEM into a LunaShift terrain-ray project.

Optional dependencies: numpy, rasterio, pyproj.
Run from the project root. See docs/MANUAL.md, Lesson 6.
"""
from __future__ import annotations
import argparse
import csv
import json
import math
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from lunashift.core import R_MOON
from lunashift.data import validate_project


def convert(dem_path, sites_path, output, frame, source, radius_km=5.0,
            az_step=2.0, range_step=100.0, z_scale=1.0, value_mode='elevation'):
    try:
        import numpy as np
        import rasterio
        from rasterio.windows import Window
        from pyproj import CRS, Transformer
    except ImportError:
        raise ValueError('Install optional DEM packages: python -m pip install -r requirements-terrain.txt') from None
    if frame!='MOON_ME_DE421':
        raise ValueError('Only confirmed MOON_ME_DE421 data are accepted. A different lunar frame must be transformed first.')
    if not .1 <= radius_km <= 100 or not 0.5 <= az_step <= 10 or not 5 <= range_step <= 1000:
        raise ValueError('Use radius 0.1–100 km, azimuth step 0.5–10 degrees, range step 5–1000 m.')
    if abs(round(360/az_step)*az_step-360)>1e-7:
        raise ValueError('Azimuth step must divide 360 exactly.')
    if not source.strip():raise ValueError('Describe the dataset and version in --source.')
    with open(sites_path,newline='',encoding='utf-8-sig') as f:
        catalog=list(csv.DictReader(f))
    required={'site_id','name','latitude_deg','longitude_deg'}
    if not catalog or not required.issubset(catalog[0]):
        raise ValueError('Sites CSV columns: site_id,name,latitude_deg,longitude_deg. Optional: slope_deg.')
    if len(catalog)>30:raise ValueError('Use at most 30 sites for this prototype.')
    distances=np.arange(range_step,radius_km*1000+.01,range_step)
    if distances.size<2 or distances.size>2000:raise ValueError('Need 2–2000 distances per ray; adjust radius or range step.')
    azimuths=np.arange(0,360,az_step)
    sites=[]
    with rasterio.open(dem_path) as ds:
        if ds.crs is None:raise ValueError('DEM has no CRS. Do not guess or assign an Earth EPSG code.')
        crs=CRS.from_wkt(ds.crs.to_wkt())
        if abs(crs.ellipsoid.semi_major_metre-R_MOON)>1 or abs(crs.ellipsoid.semi_minor_metre-R_MOON)>1:
            raise ValueError('This converter requires a lunar sphere with radius 1,737,400 m. It rejects Earth and mismatched lunar reference surfaces.')
        if not crs.is_projected:
            raise ValueError('Version 1 converter requires a projected lunar raster (for example south-polar stereographic).')
        if any(abs(a.unit_conversion_factor-1)>1e-8 for a in crs.axis_info[:2]):
            raise ValueError('Projected horizontal units must be meters.')
        trans=Transformer.from_crs(crs.geodetic_crs,crs,always_xy=True)
        inverse=~ds.transform
        metadata_scale=float(ds.scales[0]);metadata_offset=float(ds.offsets[0])

        def read_latlon(lat,lon):
            xx,yy=trans.transform(lon,lat)
            col=inverse.a*np.asarray(xx)+inverse.b*np.asarray(yy)+inverse.c-.5
            row=inverse.d*np.asarray(xx)+inverse.e*np.asarray(yy)+inverse.f-.5
            c0=np.floor(col).astype(int);r0=np.floor(row).astype(int)
            if np.any(c0<0) or np.any(r0<0) or np.any(c0+1>=ds.width) or np.any(r0+1>=ds.height):
                raise ValueError('At least one ray leaves the raster. Use a larger DEM or reduce --radius-km. Outside coverage is never filled with zero.')
            ca,cb=int(c0.min()),int(c0.max())+2
            ra,rb=int(r0.min()),int(r0.max())+2
            if (cb-ca)*(rb-ra)>16_000_000:
                raise ValueError('The sampled window exceeds 16 million pixels. Use a smaller radius or a coarser source DEM for this learning tool.')
            arr=ds.read(1,window=Window(ca,ra,cb-ca,rb-ra),masked=True)
            r,c=r0-ra,c0-ca
            parts=[arr[r,c],arr[r,c+1],arr[r+1,c],arr[r+1,c+1]]
            if any(np.any(np.ma.getmaskarray(p)) for p in parts):
                raise ValueError('A terrain ray intersects NoData. Choose complete coverage; missing pixels are never assumed flat.')
            dc,dr=col-c0,row-r0
            out=(np.asarray(parts[0])*(1-dc)*(1-dr)+np.asarray(parts[1])*dc*(1-dr)+
                 np.asarray(parts[2])*(1-dc)*dr+np.asarray(parts[3])*dc*dr)
            out=(out*metadata_scale+metadata_offset)*z_scale
            if value_mode=='radius':out=out-R_MOON
            if not np.isfinite(out).all() or np.any(abs(out)>15000):
                raise ValueError('Invalid lunar elevation values. Check NoData, vertical units, metadata scales and --value-mode.')
            return out

        def dest(lat,lon,az,dist):
            p=np.deg2rad(lat);l=np.deg2rad(lon);a=np.deg2rad(az);d=np.asarray(dist)/R_MOON
            pp=np.arcsin(np.sin(p)*np.cos(d)+np.cos(p)*np.sin(d)*np.cos(a))
            ll=l+np.arctan2(np.sin(a)*np.sin(d)*np.cos(p),np.cos(d)-np.sin(p)*np.sin(pp))
            return np.rad2deg(pp),np.rad2deg(ll)%360

        for row in catalog:
            lat=float(row['latitude_deg']);lon=float(row['longitude_deg'])%360
            if not -89.999999<=lat<=89.999999:raise ValueError('Do not place the observer exactly at a pole; azimuth north is singular there.')
            ground=float(read_latlon(np.array([lat]),np.array([lon]))[0])
            lats,lons=dest(lat,lon,azimuths[:,None],distances[None,:])
            z=read_latlon(lats,lons)
            slope=row.get('slope_deg','').strip()
            slope_note='User-supplied point slope'
            if slope:slope=float(slope)
            else:
                delta=max(10.0,math.hypot(ds.transform.a,ds.transform.d))
                la,lo=dest(lat,lon,np.array([0,90,180,270]),delta)
                zz=read_latlon(la,lo)
                slope=math.degrees(math.atan(math.hypot((zz[0]-zz[2])/(2*delta),(zz[1]-zz[3])/(2*delta))))
                slope_note=f'Local finite-difference point slope over {2*delta:g} m; not footprint safety'
            sites.append({'id':row['site_id'],'name':row['name'],'latitude_deg':lat,'longitude_deg':lon,
                          'ground_elevation_m':ground,'slope_deg':slope,'slope_source':slope_note,
                          'track_mode':'none','track_source':'Not yet supplied',
                          'terrain':{'kind':'rays','azimuth_deg':azimuths.tolist(),'distances_m':distances.tolist(),
                                     'elevations_m':np.round(z,6).tolist(),'radius_m':R_MOON,
                                     'range_limit_m':float(distances[-1]),'synthetic':False,'source':source,
                                     'frame':frame,'input_file':Path(dem_path).name,'input_crs_wkt':crs.to_wkt(),
                                     'pixel_size_m':[math.hypot(ds.transform.a,ds.transform.d),math.hypot(ds.transform.b,ds.transform.e)],
                                     'vertical_conversion':{'metadata_scale':metadata_scale,'metadata_offset':metadata_offset,'extra_scale':z_scale,'mode':value_mode},
                                     'coverage_note':'Finite sampled radius; no protection against unsampled or farther terrain obstruction.'}})
    p={'schema_version':1,'name':'Imported lunar terrain','coordinate_frame':'MOON_ME_DE421','time_scale':'UTC',
       'description':'DEM-derived, range-limited profiles. Attach ephemerides before evaluation.',
       'map_center':{'latitude_deg':sites[0]['latitude_deg'],'longitude_deg':sites[0]['longitude_deg']},'sites':sites,'history':[]}
    p=validate_project(p)
    Path(output).write_text(json.dumps(p,separators=(',',':')),encoding='utf-8')
    return p


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--dem',required=True);p.add_argument('--sites',required=True);p.add_argument('--output',default='terrain_project.json')
    p.add_argument('--frame',required=True,choices=['MOON_ME_DE421'])
    p.add_argument('--source',required=True)
    p.add_argument('--radius-km',type=float,default=5)
    p.add_argument('--az-step-deg',type=float,default=2)
    p.add_argument('--range-step-m',type=float,default=100)
    p.add_argument('--z-scale',type=float,default=1)
    p.add_argument('--value-mode',choices=['elevation','radius'],default='elevation')
    a=p.parse_args()
    try:
        project=convert(a.dem,a.sites,a.output,a.frame,a.source,a.radius_km,a.az_step_deg,a.range_step_m,a.z_scale,a.value_mode)
        print(f'Wrote {a.output}: {len(project["sites"])} sites. Open it in Data lab, then attach Horizons tracks.')
        print('WARNING: finite-range / finite-step terrain only. Verify frame, units, coverage and convergence before interpretation.')
    except (ValueError,OSError,KeyError) as e:
        p.exit(1,'Conversion stopped: '+str(e)+'\n')
if __name__=='__main__':main()
