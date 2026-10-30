"""Managed offline Sun/Earth geometry using NASA CSPICE through SpiceyPy.

The bundled configuration pins DE421 to the app's MOON_ME_DE421 coordinates.
Kernels are downloaded only on explicit request. No synthetic substitute exists.
CSPICE's global kernel pool is serialized across the threaded web server.
"""
from __future__ import annotations
import hashlib
import importlib
import json
import math
import os
import shutil
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import urlparse
from .core import utc, iso, number
from .data import validate_track
from .remote import tls_context

FRAME = 'MOON_ME_DE421'
MODEL = 'DE421 + MOON_ME_DE421'
ABCORR = 'CN+S'
RADIUS_KM = 1737.4
SET_ID = 'lunashift-de421-me421-v1'
NAIF = 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/'
# This is a compatible, versioned set, not a claim to use the newest ephemeris.
KERNELS = (
    dict(name='naif0012.tls', path='lsk/naif0012.tls', role='UTC time conversion', signature=b'KPL/LSK', limit=100_000),
    dict(name='pck00011.tpc', path='pck/pck00011.tpc', role='Body sizes', signature=b'KPL/PCK', limit=1_000_000),
    dict(name='de421.bsp', path='spk/planets/a_old_versions/de421.bsp', role='Sun, Earth and Moon positions', signature=b'DAF/SPK', limit=24_000_000,
         md5='25814bb3622904d0c444c52a4051eaf7'),
    dict(name='moon_pa_de421_1900-2050.bpc', path='pck/moon_pa_de421_1900-2050.bpc', role='Moon orientation', signature=b'DAF/PCK', limit=4_000_000),
    dict(name='moon_080317.tf', path='fk/satellites/moon_080317.tf', role='Matching lunar frame', signature=b'KPL/FK', limit=100_000),
)
_SPICE_LOCK = threading.RLock()
_SETUP_LOCK = threading.Lock()


class SpiceUnavailable(ValueError):
    """Actionable setup, date-coverage or geometry error."""


def library():
    try:
        return importlib.import_module('spiceypy')
    except Exception as exc:
        raise SpiceUnavailable('SPICE support is not ready in this Python environment. Run Enable_SPICE_Mac.sh on Mac/Linux or Enable_SPICE_Windows.bat on Windows, then restart with the normal launcher. In Colab, enable SPICE in the launcher cell. Details: '+str(exc)) from None


def kernel_folder(root):
    return Path(root) / 'kernels' / SET_ID


def file_facts(path, item):
    """Reject HTML, empty/truncated files and a wrong pinned planetary SPK."""
    path = Path(path)
    size = path.stat().st_size
    if not 100 <= size <= item['limit']:
        raise SpiceUnavailable('The NASA file '+item['name']+' has an unexpected size. Download the set again.')
    sha, md5 = hashlib.sha256(), hashlib.md5()
    with path.open('rb') as f:
        head = f.read(16)
        if not head.lstrip().startswith(item['signature']):
            raise SpiceUnavailable(item['name']+' is not the expected SPICE file. A web page or incomplete download may have been saved instead.')
        f.seek(0)
        for chunk in iter(lambda:f.read(1024*1024), b''):
            sha.update(chunk); md5.update(chunk)
    if item.get('md5') and md5.hexdigest() != item['md5']:
        raise SpiceUnavailable('The checksum of '+item['name']+' differs from the published NASA file. It will not be loaded.')
    return {'name': item['name'], 'role': item['role'], 'url': NAIF+item['path'],
            'bytes': size, 'sha256': sha.hexdigest()}


def check_files(folder):
    folder = Path(folder)
    missing = [k['name'] for k in KERNELS if not (folder/k['name']).is_file()]
    if missing:
        raise SpiceUnavailable('NASA files are not ready. Select Download NASA files in Data & Sources. Missing: '+', '.join(missing))
    facts = [file_facts(folder/k['name'], k) for k in KERNELS]
    manifest = folder/'manifest.json'
    if manifest.exists():
        try:
            saved = json.loads(manifest.read_text(encoding='utf-8'))
            expected = {f['name']:f['sha256'] for f in saved['files']}
        except (ValueError, KeyError, TypeError):
            raise SpiceUnavailable('The SPICE manifest is damaged. Download the managed set again.') from None
        if saved.get('set_id') != SET_ID or any(expected.get(f['name']) != f['sha256'] for f in facts):
            raise SpiceUnavailable('A SPICE file changed since installation. Download the managed set again before calculating.')
    return facts


@contextmanager
def loaded(folder):
    sp = library()
    # One kernel pool belongs to this application. Never load in parallel.
    with _SPICE_LOCK:
        sp.kclear()
        try:
            for item in KERNELS:
                sp.furnsh(str((Path(folder)/item['name']).resolve()))
            if not sp.namfrm(FRAME):
                raise SpiceUnavailable('The loaded files do not define '+FRAME+'. Do not substitute IAU_MOON.')
            yield sp
        finally:
            sp.kclear()


def local_angles(vector, latitude_deg, longitude_deg):
    """Spherical north/east/up: azimuth clockwise from north, elevation up."""
    lat, lon = map(math.radians, (latitude_deg, longitude_deg))
    x,y,z = map(float,vector[:3])
    distance = math.sqrt(x*x+y*y+z*z)
    if not math.isfinite(distance) or distance <= 0:
        raise ValueError('SPICE returned a nonfinite or zero-length target vector.')
    east = -math.sin(lon)*x + math.cos(lon)*y
    north = -math.sin(lat)*math.cos(lon)*x-math.sin(lat)*math.sin(lon)*y+math.cos(lat)*z
    up = math.cos(lat)*math.cos(lon)*x+math.cos(lat)*math.sin(lon)*y+math.sin(lat)*z
    return math.degrees(math.atan2(east,north))%360, math.degrees(math.atan2(up,math.hypot(east,north))), distance


def observer_position(site):
    lat = math.radians(number(site['latitude_deg'],'Latitude',-89.999999,89.999999))
    lon = math.radians(number(site['longitude_deg'],'Longitude',-360,360))
    r = RADIUS_KM+number(site['ground_elevation_m'],'Ground elevation',-15000,15000)/1000
    return [r*math.cos(lat)*math.cos(lon), r*math.cos(lat)*math.sin(lon), r*math.sin(lat)]


def time_grid(start, stop, step_min):
    start, stop = utc(start), utc(stop)
    value=number(step_min,'Geometry sample spacing',1,180)
    if value != int(value):
        raise ValueError('Geometry sample spacing must be a whole number of minutes.')
    step=int(value)
    if start>=stop or (stop-start).total_seconds()>1440*3600:
        raise ValueError('Choose a positive geometry interval of at most 60 days, including any landing delay.')
    n=math.ceil((stop-start).total_seconds()/(60*step))
    if n>6000:
        raise ValueError('Use a coarser sample spacing: at most 6000 geometry intervals per request.')
    return [start+timedelta(minutes=i*step) for i in range(n+1)]


def _coverage(sp, folder):
    """Intersect every required SPK chain and lunar rotation coverage window."""
    intervals=[(-1e30,1e30)]
    windows=[sp.spkcov(str(Path(folder)/'de421.bsp'), body) for body in (10,3,399,301)]
    windows.append(sp.pckcov(str(Path(folder)/'moon_pa_de421_1900-2050.bpc'),31006))
    for window in windows:
        part=[sp.wnfetd(window,i) for i in range(sp.wncard(window))]
        intervals=[(max(a,c),min(b,d)) for a,b in intervals for c,d in part if max(a,c)<min(b,d)]
    if not intervals:
        raise SpiceUnavailable('The loaded SPK and lunar orientation files have no common coverage.')
    # Reception-time geometry can need earlier states; keep one hour at both edges.
    return [(float(a)+3600,float(b)-3600) for a,b in intervals if b-a>7200]


def _check_dates(sp,folder,start,stop):
    a,b=sp.str2et(iso(start)),sp.str2et(iso(stop))
    windows=_coverage(sp,folder)
    if not any(lo<=a<=b<=hi for lo,hi in windows):
        raise SpiceUnavailable('The local SPICE files do not cover the complete requested interval. Choose a covered date or select JPL Horizons. No approximate sky was generated.')
    # Check both bodies and the complete transform chain before marking ready.
    obs=observer_position({'latitude_deg':-89.5,'longitude_deg':0,'ground_elevation_m':0})
    for et in (a,(a+b)/2,b):
        for body in ('SUN','EARTH'):
            sp.spkcpo(body,et,FRAME,'OBSERVER',ABCORR,obs,'MOON',FRAME)
    return windows


def status(root, start=None, stop=None):
    folder=kernel_folder(root)
    result={'ready':False,'library_available':False,'files_ready':False,'coverage_ok':False,
        'set_id':SET_ID,'model':MODEL,'frame':FRAME,'aberration':ABCORR,'folder':str(folder.resolve()),
        'approx_download_mb':19,'files':[{'name':k['name'],'role':k['role'],'url':NAIF+k['path'],'present':(folder/k['name']).is_file()} for k in KERNELS],
        'message':'SPICE is not set up yet.', 'requested_date_checked':bool(start and stop)}
    try:
        sp=library();result['library_available']=True;result['library_version']=str(getattr(sp,'__version__','unknown'))
    except SpiceUnavailable as exc:
        result['message']=str(exc)
        return result
    try:
        facts=check_files(folder);result['files_ready']=True;result['files']=facts
        with loaded(folder) as sp:
            windows=_check_dates(sp,folder,utc(start or '2026-12-15T00:00:00Z'),utc(stop or '2026-12-16T00:00:00Z'))
            result['coverage']=[{'start_utc':sp.et2utc(a,'ISOC',3)+'Z','stop_utc':sp.et2utc(b,'ISOC',3)+'Z'} for a,b in windows]
            result['toolkit']=sp.tkvrsn('TOOLKIT')
        result.update(ready=True,coverage_ok=True,message='SPICE is ready for the selected dates.' if start else 'SPICE is ready. The complete requested date interval is checked again before every calculation.')
    except Exception as exc:
        result['message']='SPICE check did not pass: '+str(exc)
    return result


def install(root, progress=lambda text:None):
    """Explicit, bounded, all-or-nothing download. No pip subprocess from HTTP."""
    if not _SETUP_LOCK.acquire(blocking=False):
        raise SpiceUnavailable('A SPICE download is already running. Wait for that operation to finish.')
    folder=kernel_folder(root);stage=folder.parent/('.download-'+uuid.uuid4().hex)
    old=folder.parent/('.previous-'+uuid.uuid4().hex)
    try:
        library()  # Fail early with setup instructions rather than download unusable files.
        stage.mkdir(parents=True,exist_ok=False)
        for index,item in enumerate(KERNELS,1):
            progress(f'Downloading NASA file {index}/{len(KERNELS)}: {item["name"]}')
            req=Request(NAIF+item['path'],headers={'User-Agent':'LunaShift/0.5.0 educational local geometry'})
            path=stage/item['name'];total=0
            with urlopen(req,timeout=60,context=tls_context()) as response, path.open('wb') as out:
                final=urlparse(response.url)
                if final.scheme!='https' or final.hostname!='naif.jpl.nasa.gov' or not final.path.startswith('/pub/naif/generic_kernels/'):
                    raise SpiceUnavailable('NASA download redirected outside the approved kernel archive.')
                while True:
                    chunk=response.read(256*1024)
                    if not chunk:break
                    total+=len(chunk)
                    if total>item['limit']:raise SpiceUnavailable('The NASA file exceeds its expected size limit.')
                    out.write(chunk)
            file_facts(path,item)
        progress('Checking the complete file set, lunar frame and date coverage…')
        facts=check_files(stage)
        with loaded(stage) as sp:
            windows=_check_dates(sp,stage,utc('2026-12-15T00:00:00Z'),utc('2026-12-16T00:00:00Z'))
            # Native example from moon_080317.tf is not treated as a validation of the application.
            toolkit=sp.tkvrsn('TOOLKIT')
        (stage/'manifest.json').write_text(json.dumps({'set_id':SET_ID,'installed_utc':iso(datetime.now(timezone.utc)),
            'files':facts,'toolkit':toolkit,'frame':FRAME,'note':'SHA256 records local integrity; the de421 SPK also uses the published NAIF MD5. This setup check is not independent scientific validation.'},indent=2),encoding='utf-8')
        with _SPICE_LOCK:
            if folder.exists():folder.rename(old)
            try:stage.rename(folder)
            except Exception:
                if old.exists():old.rename(folder)
                raise
        if old.exists():shutil.rmtree(old)
        progress('NASA SPICE files are installed. Geometry can now run offline.')
        return status(root)
    except SpiceUnavailable:
        raise
    except Exception as exc:
        raise SpiceUnavailable('SPICE setup did not complete: '+str(exc)+'. The previous kernel set and your workspace were left unchanged. Check your connection and try again.') from None
    finally:
        if stage.exists():shutil.rmtree(stage,ignore_errors=True)
        _SETUP_LOCK.release()


def fetch_tracks(site,start,stop,step_min,root,progress=lambda text:None):
    grid=time_grid(start,stop,step_min)
    library()  # Give the most actionable first-time setup error before inspecting files.
    folder=kernel_folder(root)
    with _SPICE_LOCK:
        facts=check_files(folder)
        signature=hashlib.sha256(json.dumps(facts,sort_keys=True).encode()).hexdigest()
        metadata={'engine':'spice','model':MODEL,'frame':FRAME,'aberration':ABCORR,
          'observer':{k:site[k] for k in ('latitude_deg','longitude_deg','ground_elevation_m')},
          'observer_radius_km':RADIUS_KM,'observer_height_note':'Tracks use the ground point; mast parallax is neglected, as in the Horizons path. Terrain skyline height is applied separately.',
          'time_scale':'UTC converted by LSK to TDB internally','files':facts,'kernel_signature':signature,
          'start_utc':iso(grid[0]),'stop_utc':iso(grid[-1]),'step_min':int(step_min),
          'disc_model':'Mean-radius spherical Sun/Earth discs; Earth centre is not a ground station.',
          'frame_note':'DE421 native Mean-Earth frame; source is pinned for reproducibility, not the newest planetary solution. Future UTC uses the installed leap-second table.'}
        key=hashlib.sha256(json.dumps(metadata,sort_keys=True).encode()).hexdigest()
        cache=Path(root)/'cache/spice';cache.mkdir(parents=True,exist_ok=True);path=cache/(key+'.json')
        with loaded(folder) as sp:
            _check_dates(sp,folder,grid[0],grid[-1])
            if path.exists():
                try:
                    saved=json.loads(path.read_text());rows=validate_track(saved['rows'])
                    if rows[0]['time_utc']!=iso(grid[0]) or rows[-1]['time_utc']!=iso(grid[-1]):raise ValueError('Cache time mismatch')
                    metadata.update(from_cache=True,toolkit=sp.tkvrsn('TOOLKIT'));return rows,metadata
                except (ValueError,KeyError,TypeError):pass
            obs=observer_position(site);radii={body:float(sum(sp.bodvrd(body,'RADII',3)[1])/3) for body in ('SUN','EARTH')}
            rows=[]
            try:
                for i,stamp in enumerate(grid):
                    if i%100==0:progress(f'Calculating locally with SPICE: {i+1}/{len(grid)} times')
                    et=sp.str2et(iso(stamp));row={'time_utc':iso(stamp)}
                    for body in ('SUN','EARTH'):
                        state,lt=sp.spkcpo(body,et,FRAME,'OBSERVER',ABCORR,obs,'MOON',FRAME)
                        az,el,dist=local_angles(state,site['latitude_deg'],site['longitude_deg'])
                        prefix=body.lower();row.update({prefix+'_azimuth_deg':az,prefix+'_elevation_deg':el,
                            prefix+'_distance_km':dist,prefix+'_angular_diameter_arcsec':2*math.degrees(math.asin(min(1,radii[body]/dist)))*3600})
                    rows.append(row)
            except Exception as exc:
                raise SpiceUnavailable('SPICE could not calculate this interval: '+str(exc)+'. No partial or synthetic tracks were attached.') from None
            metadata.update(from_cache=False,toolkit=sp.tkvrsn('TOOLKIT'))
        rows=validate_track(rows)
        temp=path.with_suffix('.'+uuid.uuid4().hex+'.tmp')
        try:
            temp.write_text(json.dumps({'rows':rows,'metadata':metadata},allow_nan=False));os.replace(temp,path)
        finally:temp.unlink(missing_ok=True)
        return rows,metadata
