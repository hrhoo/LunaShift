#!/usr/bin/env python3
"""Optional offline NASA SPICE tracks for an existing LunaShift site.

Supply your own meta-kernel with DE421 SPK, matching lunar orientation binary
PCK, MOON_ME_DE421 frame kernel, leap seconds and planetary radii. The program
fails if these are missing. It never substitutes approximate celestial motion.
"""
from __future__ import annotations
import argparse,csv,json,math,sys
from pathlib import Path
from datetime import timedelta
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from lunashift.core import utc,iso
from lunashift.data import validate_project,validate_track


def local_angles(vector,latitude_deg,longitude_deg):
    lat,lon=math.radians(latitude_deg),math.radians(longitude_deg)
    x,y,z=map(float,vector[:3]);distance=math.sqrt(x*x+y*y+z*z)
    if not distance:raise ValueError('Zero-length target vector.')
    east=-math.sin(lon)*x+math.cos(lon)*y
    north=-math.sin(lat)*math.cos(lon)*x-math.sin(lat)*math.sin(lon)*y+math.cos(lat)*z
    up=math.cos(lat)*math.cos(lon)*x+math.cos(lat)*math.sin(lon)*y+math.sin(lat)*z
    return math.degrees(math.atan2(east,north))%360,math.degrees(math.atan2(up,math.hypot(east,north))),distance


def export(project_file,site_id,meta_kernel,start,stop,step_min,output):
    try:import spiceypy as sp
    except ImportError:raise ValueError('Install optional SPICE: python -m pip install -r requirements-spice.txt') from None
    project=validate_project(json.loads(Path(project_file).read_text()))
    site=next((s for s in project['sites'] if s['id']==site_id),None)
    if site is None:raise ValueError('Site ID not found in exported project.')
    begin,end=utc(start),utc(stop)
    if not (end>begin and 1<=step_min<=180):raise ValueError('End must follow start; step must be 1–180 minutes.')
    n=math.ceil((end-begin).total_seconds()/(step_min*60))
    if n>6000:raise ValueError('Use at most 6000 time intervals per export.')
    frame='MOON_ME_DE421';rows=[]
    lat,lon=map(math.radians,[site['latitude_deg'],site['longitude_deg']]);r=1737.4+site['ground_elevation_m']/1000
    observer=[r*math.cos(lat)*math.cos(lon),r*math.cos(lat)*math.sin(lon),r*math.sin(lat)]
    try:
        sp.furnsh(str(Path(meta_kernel).resolve()))
        if sp.namfrm(frame)==0:raise ValueError('The meta-kernel does not define MOON_ME_DE421.')
        for i in range(n+1):
            stamp=begin+timedelta(minutes=i*step_min);et=sp.str2et(iso(stamp));row={'time_utc':iso(stamp)}
            for body in ['SUN','EARTH']:
                # Target-relative-to-ground observer, output frame at observation time.
                state,lt=sp.spkcpo(body,et,frame,'OBSERVER','LT+S',observer,'MOON',frame)
                az,el,dist=local_angles(state,site['latitude_deg'],site['longitude_deg'])
                radii=sp.bodvrd(body,'RADII',3)[1];radius=float(sum(radii)/3)
                prefix=body.lower();row.update({prefix+'_azimuth_deg':az,prefix+'_elevation_deg':el,
                  prefix+'_distance_km':dist,prefix+'_angular_diameter_arcsec':2*math.degrees(math.asin(min(1,radius/dist)))*3600})
            rows.append(row)
        rows=validate_track(rows)
        out=Path(output);out.parent.mkdir(parents=True,exist_ok=True)
        with out.open('w',newline='') as f:
            writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
        metadata={'site_id':site_id,'frame':frame,'meta_kernel':str(Path(meta_kernel).resolve()),
          'observer':'Ground elevation on lunar sphere 1737.4 km; mast parallax neglected',
          'aberration':'LT+S, receiving observer at epoch; airless','time_scale':'UTC',
          'note':'Mean-radius angular disc approximation; not a real ground-station link. Independently compare against Horizons before scientific use.'}
        out.with_suffix('.metadata.json').write_text(json.dumps(metadata,indent=2))
        return len(rows)
    finally:sp.kclear()


def main():
    a=argparse.ArgumentParser(description=__doc__)
    a.add_argument('--project',required=True);a.add_argument('--site',required=True);a.add_argument('--meta-kernel',help='Advanced legacy mode; omit to use the managed in-app kernel set')
    a.add_argument('--start',required=True);a.add_argument('--stop',required=True);a.add_argument('--step-min',type=int,default=60);a.add_argument('--output',required=True)
    args=a.parse_args()
    try:
        if args.meta_kernel:
            n=export(args.project,args.site,args.meta_kernel,args.start,args.stop,args.step_min,args.output)
        else:
            from lunashift.spice_engine import fetch_tracks
            project=validate_project(json.loads(Path(args.project).read_text()))
            site=next((s for s in project['sites'] if s['id']==args.site),None)
            if site is None:raise ValueError('Site ID not found in this project.')
            rows,meta=fetch_tracks(site,args.start,args.stop,args.step_min,Path(__file__).resolve().parents[1],print)
            out=Path(args.output);out.parent.mkdir(parents=True,exist_ok=True)
            with out.open('w',newline='') as f:
                writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
            out.with_suffix('.metadata.json').write_text(json.dumps(meta,indent=2))
            n=len(rows)
    except Exception as e:a.exit(1,'SPICE export stopped: '+str(e)+'\nNo approximate replacement was created.\n')
    print(f'Exported {n} samples to {args.output}. Import as ephemeris CSV for the SAME site.')
if __name__=='__main__':main()
