"""Generate reproducible Earth geometry from the user's verified DE421 kernels."""
from pathlib import Path
import json,datetime as dt,hashlib,sys
import numpy as np
from scipy.spatial.transform import Rotation
from de421_reader import LunarEphemeris
root=Path(__file__).resolve().parents[1]
kdir=Path(sys.argv[1])
manifest=json.loads((kdir/'manifest.json').read_text())
for entry in manifest['files']:
 p=kdir/entry['name']
 if hashlib.sha256(p.read_bytes()).hexdigest()!=entry['sha256']:raise ValueError('Kernel digest mismatch')
bundle=json.loads((root/'web/data/lunar-data.json').read_text())
ep=bundle['ephemeris'];model=LunarEphemeris(kdir)
start=dt.datetime.fromisoformat(ep['start_utc'].replace('Z','+00:00'))
earth=[];quats=[];maxerr=0
for i,ref in enumerate(ep['sun_positions_km']):
 utc=(start+dt.timedelta(seconds=i*ep['step_seconds'])).isoformat()
 sun,e,mat=model.state(utc)
 if i%73==0:
  err=np.degrees(np.arctan2(np.linalg.norm(np.cross(sun,ref)),np.dot(sun,ref)))
  maxerr=max(maxerr,float(err))
 earth.append(np.round(e,6).tolist());quats.append(Rotation.from_matrix(mat).as_quat().round(12).tolist())
 if i%4000==0:print('Earth samples',i,flush=True)
checks=[]
for i in np.linspace(0,len(earth)-2,200,dtype=int):
 _,actual,_=model.state((start+dt.timedelta(seconds=(int(i)+.5)*ep['step_seconds'])).isoformat())
 interp=(np.array(earth[i])+earth[i+1])*.5
 checks.append(float(np.degrees(np.arctan2(np.linalg.norm(np.cross(actual,interp)),np.dot(actual,interp)))))
ep['earth_positions_km']=earth;ep['earth_fixed_to_moon_quaternions']=quats
ep['earth_model']={'source':'Supplied DE421 SPK and lunar PCK kernels, evaluated using documented type-2 Chebyshev records','frame':'MOON_ME_DE421','earth_orientation':'IAU_EARTH from pck00011.tpc; not high-accuracy ITRF/EOP','quaternion_convention':'x,y,z,w; ECEF to MOON_ME_DE421; slerp between samples','aberration':'NONE','sun_reference_max_error_deg':maxerr,'earth_midpoint_interpolation_max_error_deg':max(checks),'checks':200,'limitations':'Geometric simultaneous positions; no light time, refraction, atmosphere model, station scheduling or Earth-orientation-parameter corrections. UTC conversion follows bundled naif0012.tls over 2026-2027.'}
bundle['schema_version']='lunashift-mission-7.0'
bundle['name']='LunaShift mission planner — Connecting Ridge'
(root/'web/data/lunar-data.json').write_text(json.dumps(bundle,separators=(',',':')))
print('CHECKS',ep['earth_model'])
(root/'docs/EPHEMERIS_CHECKS.json').write_text(json.dumps(ep['earth_model'],indent=2))
