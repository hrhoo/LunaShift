"""JPL Horizons online adapter: one site, two sequential airless AZ/EL queries.

No API key. Raw responses and query metadata are retained in cache/. Network
errors are shown to the user; synthetic data are NEVER substituted.
Live end-to-end access must be checked on the user's network.
"""
from __future__ import annotations
import csv
import hashlib
import json
from pathlib import Path
from datetime import datetime
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
from .core import utc, iso, number
from .data import validate_track
from .remote import tls_context

API='https://ssd.jpl.nasa.gov/api/horizons.api'


def parse_observer(text: str):
    if '$$SOE' not in text or '$$EOE' not in text:
        raise ValueError('Horizons did not return an ephemeris table. '+text[:500])
    body=text.split('$$SOE',1)[1].split('$$EOE',1)[0]
    out=[]
    for line in body.strip().splitlines():
        cells=[c.strip() for c in next(csv.reader([line]))]
        if not cells or not cells[0]:continue
        date_text=cells[0].replace('A.D.','').strip()
        stamp=None
        for fmt in ('%Y-%b-%d %H:%M:%S.%f','%Y-%b-%d %H:%M:%S','%Y-%b-%d %H:%M'):
            try:stamp=iso(utc(datetime.strptime(date_text,fmt)));break
            except ValueError:pass
        if not stamp:raise ValueError('Unrecognized Horizons time: '+date_text)
        # QUANTITIES=4,13,20 adds diameter and observer range; older AZ/EL-only imports remain supported.
        nums=[]
        for c in cells[1:]:
            if not c:continue
            try:nums.append(float(c))
            except ValueError:
                if c.lower() in ['n.a.','nan']:raise ValueError('Horizons returned unavailable AZ/EL.')
        if len(nums) not in (2,5):raise ValueError('Expected AZ/EL or AZ/EL, apparent diameter, range and range-rate; inspect the saved Horizons raw response.')
        az=number(nums[0],'Horizons azimuth',0,360)%360
        el=number(nums[1],'Horizons elevation',-90,90)
        row={'time_utc':stamp,'azimuth_deg':az,'elevation_deg':el}
        if len(nums)==5:
            row['angular_diameter_arcsec']=number(nums[2],'Angular diameter',0,100000)
            row['distance_km']=number(nums[3],'Observer range (km)',1,2e9)
        out.append(row)
    if len(out)<2:raise ValueError('Horizons returned fewer than two samples.')
    return out


def build_query(site, target, start, stop, step_min):
    params={'format':'json','COMMAND':str(target),'OBJ_DATA':'NO','MAKE_EPHEM':'YES','EPHEM_TYPE':'OBSERVER',
            'CENTER':'coord@301','COORD_TYPE':'GEODETIC',
            'SITE_COORD':f"{site['longitude_deg']:.10f},{site['latitude_deg']:.10f},{site['ground_elevation_m']/1000:.9f}",
            'START_TIME':utc(start).strftime('%Y-%m-%d %H:%M:%S'),
            'STOP_TIME':utc(stop).strftime('%Y-%m-%d %H:%M:%S'),
            'STEP_SIZE':f'{int(step_min)} m','QUANTITIES':'4,13,20','RANGE_UNITS':'KM','CSV_FORMAT':'YES',
            'ANG_FORMAT':'DEG','CAL_FORMAT':'CAL','TIME_DIGITS':'SECONDS','TIME_TYPE':'UT',
            'APPARENT':'AIRLESS','EXTRA_PREC':'YES'}
    return params


def fetch_one(site,target,start,stop,step_min,cache_dir):
    params=build_query(site,target,start,stop,step_min)
    query={k:v if k=='format' else "'"+v+"'" for k,v in params.items()}
    url=API+'?'+urlencode(query)
    key=hashlib.sha256(url.encode()).hexdigest()[:24]
    root=Path(cache_dir);root.mkdir(parents=True,exist_ok=True)
    path=root/(key+'.json')
    cached=False
    if path.exists():
        saved=json.loads(path.read_text(encoding='utf-8'))
        payload=saved['response'];cached=True
    else:
        try:
            req=Request(url,headers={'User-Agent':'LunaShift-learning-prototype/0.1 (local educational use)'})
            with urlopen(req,timeout=35,context=tls_context()) as response:
                raw=response.read(8_000_000)
            payload=json.loads(raw.decode('utf-8'))
        except (URLError,HTTPError,OSError,ValueError) as e:
            raise ValueError(f'Could not contact NASA JPL Horizons: {e}. Check internet, proxy, and certificates. You can import an ephemeris CSV instead. No synthetic replacement was used.') from None
        if payload.get('error'):raise ValueError('Horizons: '+str(payload['error']))
        text=payload.get('result','')
        parsed=parse_observer(text)  # Do not cache malformed/unavailable output.
        path.write_text(json.dumps({'url':url,'parameters':params,'response':payload},indent=2),encoding='utf-8')
    text=payload.get('result','')
    return parse_observer(text),{'target':target,'request_url':url,'cache_file':str(path.name),'from_cache':cached,'raw_header':text.split('$$SOE')[0][-3500:]}


def fetch_tracks(site,start,stop,step_min,cache_dir):
    start,stop=utc(start),utc(stop)
    step_min=int(number(step_min,'Horizons interval',1,180))
    if stop<=start:raise ValueError('End time must follow start time.')
    n=(stop-start).total_seconds()/(step_min*60)
    if n>6000:raise ValueError('Horizons query is too large; use at most 6000 time intervals.')
    # Requesting an aligned end guarantees coverage of the entire requested mission.
    from datetime import timedelta
    import math
    stop=start+timedelta(minutes=math.ceil(n)*step_min)
    sun,sm=fetch_one(site,10,start,stop,step_min,cache_dir)
    earth,em=fetch_one(site,399,start,stop,step_min,cache_dir)
    if [r['time_utc'] for r in sun]!=[r['time_utc'] for r in earth]:
        raise ValueError('Sun and Earth time grids differ; data were not attached.')
    rows=[]
    for s,e in zip(sun,earth):
        rows.append({'time_utc':s['time_utc'],'sun_azimuth_deg':s['azimuth_deg'],'sun_elevation_deg':s['elevation_deg'],
                     'earth_azimuth_deg':e['azimuth_deg'],'earth_elevation_deg':e['elevation_deg']})
    for row,s,e in zip(rows,sun,earth):
        for body,source in [('sun',s),('earth',e)]:
            for key in ('distance_km','angular_diameter_arcsec'):
                if key in source:row[body+'_'+key]=source[key]
    return validate_track(rows),{'sun':sm,'earth':em,
        'frame_note':'Lunar surface coordinates: MOON_ME of DE421; UTC; airless apparent body-centre AZ/EL. Observer altitude = supplied ground elevation; mast parallax is neglected.'}
