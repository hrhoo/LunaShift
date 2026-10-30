"""Synthetic fixtures and strict, documented interchange formats."""
from __future__ import annotations
import copy
import csv
import io
import math
import re
from .core import R_MOON, number, utc, iso, destination, local_xy, MAX_SITES

TRACK_FIELDS = ['time_utc', 'sun_azimuth_deg', 'sun_elevation_deg', 'earth_azimuth_deg', 'earth_elevation_deg']


def terrain_function(x_m, y_m):
    """An invented landscape; values are not observations of the Moon."""
    x, y = x_m/1000, y_m/1000
    ridge = 48*math.exp(-((x-0.65)/0.48)**2-((y-1.05)/1.5)**2)
    rim = 30*math.exp(-((math.hypot(x+1.3, y-1.1)-1.1)/0.24)**2)
    hill = 62*math.exp(-((x-2.4)/0.8)**2-((y+0.5)/1.2)**2)
    return 1200+ridge+rim+hill+5*math.sin(1.2*x)*math.cos(0.9*y)


def demo_project():
    sites=[]
    for sid,name,x,y in [('A','A · Preferred science point',-150,-300),
                         ('B','B · Raised shoulder',650,950),
                         ('C','C · West alternative',-1500,-600),
                         ('D','D · Eastern alternative',2200,-400)]:
        bearing = math.degrees(math.atan2(x,y)) % 360
        lat, lon = destination(-89.5,35,bearing,math.hypot(x,y))
        z=terrain_function(x,y)
        gx=(terrain_function(x+5,y)-terrain_function(x-5,y))/10
        gy=(terrain_function(x,y+5)-terrain_function(x,y-5))/10
        azs=list(range(0,360,2))
        ds=[50+100*i for i in range(60)]
        zs=[]
        for az in azs:
            a=math.radians(az)
            zs.append([round(terrain_function(x+d*math.sin(a), y+d*math.cos(a)),5) for d in ds])
        sites.append(dict(id=sid,name=name,latitude_deg=lat,longitude_deg=lon,
                          ground_elevation_m=z,slope_deg=math.degrees(math.atan(math.hypot(gx,gy))),
                          slope_synthetic=True,slope_source='Analytic synthetic landscape slope',
                          track_mode='synthetic',track_source='Invented learning curves, not JPL ephemerides',
                          terrain=dict(kind='rays',azimuth_deg=azs,distances_m=ds,elevations_m=zs,
                                       radius_m=R_MOON,range_limit_m=max(ds),synthetic=True,
                                       source='Analytic synthetic landscape; not LOLA',
                                       frame='MOON_ME_DE421',coverage_note='Sampled to 5.95 km; smooth continuation beyond.')))
    coords=[-4+8*i/64 for i in range(65)]
    return dict(schema_version=1,name='Synthetic training landscape',
                description='All default terrain and Sun/Earth tracks are invented teaching inputs. Not real landing advice.',
                coordinate_frame='MOON_ME_DE421',time_scale='UTC',
                map_center={'latitude_deg':-89.5,'longitude_deg':35},sites=sites,
                preview={'kind':'synthetic','x_km':coords,'y_km':coords,
                         'elevations_m':[[terrain_function(x*1000,y*1000) for x in coords] for y in coords]},
                history=[])


def angles(values, label):
    if not isinstance(values,list) or not 4 <= len(values) <= 720:
        raise ValueError(f'{label}: provide 4 to 720 azimuth samples.')
    aa=[number(x,label,0,359.999999) for x in values]
    if any(b<=a for a,b in zip(aa,aa[1:])):
        raise ValueError(f'{label}: azimuths must be sorted, unique, and in [0,360).')
    gaps=[b-a for a,b in zip(aa,aa[1:])]+[aa[0]+360-aa[-1]]
    if max(gaps)>30.000001:
        raise ValueError(f'{label}: a gap exceeds 30 degrees. A complete 360-degree horizon is required.')
    return aa


def validate_track(rows):
    if not isinstance(rows,list) or not 2 <= len(rows) <= 25000:
        raise ValueError('An ephemeris needs 2 to 25,000 rows.')
    out=[]
    for row in rows:
        if not all(k in row for k in TRACK_FIELDS):
            raise ValueError('Ephemeris columns: '+', '.join(TRACK_FIELDS))
        d={'time_utc':iso(utc(row['time_utc']))}
        for k in TRACK_FIELDS[1:]:
            d[k]=number(row[k],k,0 if 'azimuth' in k else -90,360 if 'azimuth' in k else 90)
            if 'azimuth' in k:d[k]%=360
        for k in ['sun_distance_km','earth_distance_km','sun_angular_diameter_arcsec','earth_angular_diameter_arcsec']:
            if row.get(k) not in (None,''):
                d[k]=number(row[k],k,0.000001,2e9 if 'distance' in k else 100000)
        out.append(d)
    times=[utc(r['time_utc']) for r in out]
    if any(b<=a for a,b in zip(times,times[1:])):
        raise ValueError('Ephemeris times must be strictly increasing, with no duplicate rows.')
    return out


def validate_ui_state(raw, sites):
    """Whitelist small UI preferences; never execute or trust imported settings."""
    if not isinstance(raw,dict):
        raise ValueError('UI settings must be an object.')
    allowed={'start','duration','step','height','minSun','maxDark','maxGap','maxSlope','margin','slopeCheck',
             'allowMove','allowDelay','allowHeight','maxDelay','maxHeight','delayStep','heightStep',
             'wMove','wDelay','wHeight','preference'}
    fields=raw.get('fields',{})
    if not isinstance(fields,dict):
        raise ValueError('UI settings fields must be an object.')
    cleaned={}
    for key,value in fields.items():
        if key not in allowed:
            continue
        if not isinstance(value,(str,int,float,bool)) or len(str(value))>100:
            raise ValueError('Invalid UI setting: '+key)
        if isinstance(value,float) and not math.isfinite(value):
            raise ValueError('Nonfinite UI setting: '+key)
        cleaned[key]=value
    sid=raw.get('selected_site_id',sites[0]['id'])
    if sid not in [site['id'] for site in sites]:
        sid=sites[0]['id']
    source=raw.get('geometry_source','automatic')
    if source not in ('automatic','horizons','spice'):
        raise ValueError('Geometry source must be automatic, horizons or spice.')
    result={'selected_site_id':sid,'fields':cleaned}
    if 'geometry_source' in raw: result['geometry_source']=source
    if 'hardware' in raw:
        from .mission import hardware
        result['hardware']=hardware(raw['hardware'])
    return result


def validate_project(raw):
    if not isinstance(raw,dict) or raw.get('schema_version')!=1:
        raise ValueError('This file is not a LunaShift schema_version 1 project.')
    p=copy.deepcopy(raw)
    if p.get('coordinate_frame')!='MOON_ME_DE421' or p.get('time_scale')!='UTC':
        raise ValueError('Version 1 accepts MOON_ME_DE421 site coordinates and UTC times only. Transform other frames first.')
    if not isinstance(p.get('sites'),list) or not 1<=len(p['sites'])<=MAX_SITES:
        raise ValueError(f'A project needs 1 to {MAX_SITES} sites.')
    ids=set()
    terrain_cells=0
    for s in p['sites']:
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,40}',str(s.get('id',''))):
            raise ValueError('Site IDs must use 1 to 40 letters, numbers, underscores, or hyphens.')
        if s['id'] in ids:raise ValueError('Duplicate site ID: '+s['id'])
        ids.add(s['id'])
        s['name']=str(s.get('name',s['id']))[:120]
        s['latitude_deg']=number(s.get('latitude_deg'),'Latitude',-89.999999,89.999999)
        s['longitude_deg']=number(s.get('longitude_deg'),'East longitude',-360,360)%360
        s['ground_elevation_m']=number(s.get('ground_elevation_m',0),'Ground elevation (m)',-15000,15000)
        if s.get('slope_deg') is not None:
            s['slope_deg']=number(s['slope_deg'],'Slope',0,90)
        if s.get('track_mode') not in ['synthetic','imported','none']:
            raise ValueError('track_mode must be synthetic, imported, or none.')
        if s.get('ephemeris'):
            s['ephemeris']=validate_track(s['ephemeris'])
        if s.get('terrain'):
            t=s['terrain'];t['azimuth_deg']=angles(t.get('azimuth_deg'),'Terrain azimuth')
            t['source']=str(t.get('source','User supplied; source not described'))[:1000]
            t['synthetic']=bool(t.get('synthetic',False))
            if t.get('frame','MOON_ME_DE421')!='MOON_ME_DE421':
                raise ValueError('Terrain frame must match the project MOON_ME_DE421 frame.')
            if t.get('range_limit_m') is not None:
                t['range_limit_m']=number(t['range_limit_m'],'Terrain range limit',0,300000)
            if t['kind']=='horizon':
                t['observer_height_m']=number(t.get('observer_height_m'),'Fixed horizon height',0,30)
                if len(t.get('horizon_deg',[]))!=len(t['azimuth_deg']):raise ValueError('Horizon array lengths differ.')
                t['horizon_deg']=[number(x,'Horizon elevation',-90,90) for x in t['horizon_deg']]
            elif t['kind']=='rays':
                rr=number(t.get('radius_m',R_MOON),'Lunar reference radius',R_MOON-1,R_MOON+1)
                t['radius_m']=rr
                ds=t.get('distances_m',[])
                if not isinstance(ds,list) or not 2<=len(ds)<=2000:raise ValueError('Terrain needs 2 to 2000 range samples per azimuth.')
                ds=[number(x,'Terrain range (m)',0.1,300000) for x in ds]
                if any(b<=a for a,b in zip(ds,ds[1:])):raise ValueError('Terrain distances must increase strictly.')
                t['distances_m']=ds
                zs=t.get('elevations_m',[])
                if len(zs)!=len(t['azimuth_deg']):raise ValueError('One elevation row is needed per azimuth.')
                for row in zs:
                    if len(row)!=len(ds):raise ValueError('Each elevation row must match distances_m.')
                    for j,z in enumerate(row):row[j]=number(z,'Terrain elevation (m)',-15000,15000)
                terrain_cells+=len(zs)*len(ds)
                if terrain_cells>1500000:raise ValueError('Project exceeds the learning prototype limit of 1.5 million terrain samples.')
            else:raise ValueError('Unsupported terrain kind. Use rays or horizon.')
    p['name']=str(p.get('name','Imported project'))[:160]
    p['history']=p.get('history',[])[-50:]
    if not p.get('map_center'):
        p['map_center']={k:p['sites'][0][k] for k in ['latitude_deg','longitude_deg']}
    center=p['map_center']
    center['latitude_deg']=number(center.get('latitude_deg'),'Map center latitude',-89.999999,89.999999)
    center['longitude_deg']=number(center.get('longitude_deg'),'Map center longitude',-360,360)%360
    if p.get('preview'):
        v=p['preview']
        if v.get('kind')!='synthetic':
            raise ValueError('Only a labeled synthetic raster preview is supported in v1. Real sites use the coordinate view.')
        xs,ys=v.get('x_km',[]),v.get('y_km',[])
        if not 2<=len(xs)<=256 or not 2<=len(ys)<=256:
            raise ValueError('Preview dimensions must be between 2 and 256.')
        v['x_km']=[number(x,'Preview x',-1000,1000) for x in xs]
        v['y_km']=[number(y,'Preview y',-1000,1000) for y in ys]
        if any(b<=a for a,b in zip(xs,xs[1:])) or any(b<=a for a,b in zip(ys,ys[1:])):
            raise ValueError('Preview coordinates must increase.')
        zz=v.get('elevations_m',[])
        if len(zz)!=len(ys) or any(len(row)!=len(xs) for row in zz):
            raise ValueError('Preview grid dimensions do not match.')
        v['elevations_m']=[[number(z,'Preview elevation',-15000,15000) for z in row] for row in zz]
    if 'ui_state' in p:
        p['ui_state']=validate_ui_state(p['ui_state'],p['sites'])
    return p


def project_summary(p):
    center=p.get('map_center') or p['sites'][0]
    sites=[]
    for s in p['sites']:
        t=s.get('terrain') or {}
        x,y=local_xy(s['latitude_deg'],s['longitude_deg'],center['latitude_deg'],center['longitude_deg'])
        sites.append({k:s.get(k) for k in ['id','name','latitude_deg','longitude_deg','ground_elevation_m','slope_deg','slope_source','slope_synthetic','track_mode','track_source','track_synthetic']} | {
            'x_km':x,'y_km':y,'terrain_kind':t.get('kind'),'terrain_source':t.get('source','Not supplied'),
            'synthetic_terrain':t.get('synthetic',False),'terrain_radius_km':t.get('range_limit_m',0)/1000 if t.get('range_limit_m') else None,
            'geometry_engine':s.get('track_metadata',{}).get('actual_source',s.get('track_metadata',{}).get('engine')),
            'geometry_requested':s.get('track_metadata',{}).get('requested_source'),
            'geometry_reason':s.get('track_metadata',{}).get('selection_reason'),
            'geometry_model':s.get('track_metadata',{}).get('model'),
            'track_max_gap_min':s.get('track_max_gap_min'),
            'fixed_height_m':t.get('observer_height_m'),'track_start':s.get('ephemeris',[{}])[0].get('time_utc') if s.get('ephemeris') else None,
            'track_end':s.get('ephemeris',[{}])[-1].get('time_utc') if s.get('ephemeris') else None})
    return {'name':p['name'],'description':p.get('description',''),'sites':sites,'preview':p.get('preview'),
            'map_center':center,'history':p.get('history',[]),'coordinate_frame':p['coordinate_frame'],'ui_state':p.get('ui_state',{})}


def read_csv_text(text):
    return list(csv.DictReader(io.StringIO(text.lstrip('\ufeff'))))


def apply_csv(p, site_id, kind, text, source, metadata=None):
    p=copy.deepcopy(p);meta=metadata or {}
    source=str(source).strip()
    if not source:raise ValueError('Describe the data source before importing.')
    site=next((s for s in p['sites'] if s['id']==site_id),None)
    if site is None:raise ValueError('Unknown target site.')
    rows=read_csv_text(text)
    if not rows:raise ValueError('CSV is empty.')
    if kind=='ephemeris':
        site.pop('track_metadata',None)  # A new external CSV must not inherit a SPICE/Horizons provenance badge.
        site['ephemeris']=validate_track(rows)
        site['track_mode']='imported';site['track_source']=source;site['track_synthetic']=bool(meta.get('synthetic',False))
        site['track_max_gap_min']=number(meta.get('max_gap_min',180),'Maximum gap',1,1440)
    elif kind=='horizon':
        need={'azimuth_deg','horizon_deg'}
        if not need.issubset(rows[0]):raise ValueError('Horizon CSV columns must be azimuth_deg,horizon_deg.')
        pairs=sorted((number(r['azimuth_deg'],'Azimuth',0,360),number(r['horizon_deg'],'Horizon',-90,90)) for r in rows)
        if pairs[-1][0]==360:
            if pairs[0][0]!=0 or abs(pairs[-1][1]-pairs[0][1])>1e-6:raise ValueError('A 360-degree endpoint must match the 0-degree endpoint.')
            pairs.pop()
        site['terrain']={'kind':'horizon','azimuth_deg':[a for a,b in pairs], 'horizon_deg':[b for a,b in pairs],
                         'observer_height_m':number(meta.get('observer_height_m',2),'CSV observer height',0,30),
                         'source':source,'synthetic':bool(meta.get('synthetic',False)),
                         'range_limit_m':number(meta.get('range_limit_m',0),'Range limit',0,300000) or None}
    elif kind=='attributes':
        if not {'site_id','slope_deg'}.issubset(rows[0]):raise ValueError('Attribute CSV needs site_id,slope_deg.')
        for row in rows:
            target=next((s for s in p['sites'] if s['id']==row['site_id']),None)
            if target is None:raise ValueError('Unknown site in attributes CSV: '+row['site_id'])
            target['slope_deg']=number(row['slope_deg'],'Slope',0,90)
            target['slope_source']=source
            target['slope_synthetic']=bool(meta.get('synthetic',False))
    else:raise ValueError('Choose ephemeris, horizon, or attributes.')
    p.setdefault('history',[]).append({'change':f'Imported {kind} for {site_id}', 'source':source})
    return validate_project(p)
