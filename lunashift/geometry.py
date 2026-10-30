"""Explicit source selection, atomic workspace preparation, and comparison.

Automatic prefers healthy local SPICE, otherwise uses Horizons with a reason.
An explicitly selected provider is never silently replaced by another provider.
"""
from __future__ import annotations
import copy
import math
from datetime import datetime, timedelta, timezone
from .core import utc, iso, number
from . import spice_engine, horizons

SOURCES=('automatic','horizons','spice')
LABELS={'spice':'NASA SPICE (local/offline)','horizons':'NASA JPL Horizons (online or cached)'}

def source_name(value):
    if value not in SOURCES:raise ValueError('Choose Automatic, JPL Horizons or NASA SPICE.')
    return value


def fetch_geometry(site,start,stop,step_min,root,source='automatic',progress=lambda text:None):
    source=source_name(source)
    grid=spice_engine.time_grid(start,stop,step_min)
    fallback=None
    selected=source
    if source=='automatic':
        progress('Checking whether local SPICE is ready for your dates…')
        check=spice_engine.status(root,grid[0],grid[-1])
        if check['ready']:selected='spice'
        else:selected='horizons';fallback=check['message']
    if selected=='spice':
        progress('Using NASA SPICE on this computer…')
        # A computation failure after a successful readiness check is not hidden.
        rows,meta=spice_engine.fetch_tracks(site,grid[0],grid[-1],step_min,root,progress)
    else:
        progress('Requesting NASA JPL Horizons (or its exact cached response)…')
        rows,meta=horizons.fetch_tracks(site,grid[0],grid[-1],step_min,__import__('pathlib').Path(root)/'cache/horizons')
        meta.update(engine='horizons',start_utc=iso(grid[0]),stop_utc=iso(grid[-1]),step_min=int(step_min),
            observer={k:site[k] for k in ('latitude_deg','longitude_deg','ground_elevation_m')})
    meta.update(requested_source=source,actual_source=selected,selection_reason=fallback or ('Local SPICE passed the date and file checks.' if selected=='spice' else 'Horizons was explicitly selected.'))
    return rows,meta


def prepare_project(project,raw,root,progress=lambda text:None):
    p=copy.deepcopy(project)
    source=source_name(raw.get('geometry_source','automatic'))
    ids=raw.get('site_ids') or [raw.get('site_id')]
    if not isinstance(ids,list) or not ids or len(ids)>40 or len(ids)!=len(set(ids)):
        raise ValueError('Choose one or more saved locations without duplicates (at most 40).')
    sites=[s for s in p['sites'] if s['id'] in ids]
    if len(sites)!=len(ids):raise ValueError('One of the selected locations is no longer in this workspace.')
    start=utc(raw.get('start_utc'));hours=number(raw.get('duration_h',168),'Geometry coverage',1,1440)
    step=number(raw.get('step_min',60),'Sample spacing',1,180)
    grid=spice_engine.time_grid(start,start+timedelta(hours=hours),step)
    if len(grid)*len(sites)>60000:raise ValueError('This batch is too large. Prepare fewer locations or increase the sample spacing.')
    details=[]
    for i,site in enumerate(sites,1):
        progress(f'Location {i}/{len(sites)}: {site["name"]}')
        rows,meta=fetch_geometry(site,start,start+timedelta(hours=hours),step,root,source,progress)
        site.update(ephemeris=rows,track_mode='imported',track_synthetic=False,
            track_source=LABELS[meta['actual_source']]+', airless apparent Sun/Earth geometry',
            track_metadata=meta,track_max_gap_min=step)
        details.append({'site_id':site['id'],'engine':meta['actual_source'],'samples':len(rows),
            'start_utc':rows[0]['time_utc'],'stop_utc':rows[-1]['time_utc'],
            'reason':meta['selection_reason'],'mixed_terrain':bool((site.get('terrain') or {}).get('synthetic'))})
    p.setdefault('history',[]).append({'change':'Prepared Sun/Earth geometry for '+', '.join(ids),
        'source':source,'details':details,'time_utc':iso(datetime.now(timezone.utc))})
    p.setdefault('ui_state',{}).update(geometry_source=source)
    return p,details


def angle_difference(a,b):return (float(a)-float(b)+180)%360-180

def compare_rows(a,b):
    if [x['time_utc'] for x in a]!=[x['time_utc'] for x in b]:raise ValueError('Source time grids differ. No comparison was made.')
    result={}
    for body in ('sun','earth'):
        ds=[];els=[];azs=[]
        for x,y in zip(a,b):
            aa,ea=map(math.radians,[x[body+'_azimuth_deg'],x[body+'_elevation_deg']])
            ab,eb=map(math.radians,[y[body+'_azimuth_deg'],y[body+'_elevation_deg']])
            ua=(math.cos(ea)*math.sin(aa),math.cos(ea)*math.cos(aa),math.sin(ea))
            ub=(math.cos(eb)*math.sin(ab),math.cos(eb)*math.cos(ab),math.sin(eb))
            # atan2 is stable for very small angular separations.
            cross=(ua[1]*ub[2]-ua[2]*ub[1],ua[2]*ub[0]-ua[0]*ub[2],ua[0]*ub[1]-ua[1]*ub[0])
            ds.append(math.degrees(math.atan2(math.sqrt(sum(v*v for v in cross)),sum(v*w for v,w in zip(ua,ub)))))
            els.append(abs(x[body+'_elevation_deg']-y[body+'_elevation_deg']))
            if abs(x[body+'_elevation_deg'])<89.9 and abs(y[body+'_elevation_deg'])<89.9:
                azs.append(abs(angle_difference(x[body+'_azimuth_deg'],y[body+'_azimuth_deg'])))
        result[body]={'max_direction_difference_deg':max(ds),'rms_direction_difference_deg':math.sqrt(sum(d*d for d in ds)/len(ds)),
            'max_elevation_difference_deg':max(els),'max_azimuth_difference_deg':max(azs) if azs else None}
    return result


def compare_sources(project,raw,root,progress=lambda text:None):
    site=next((s for s in project['sites'] if s['id']==raw.get('site_id')),None)
    if site is None:raise ValueError('Select a saved location first.')
    start=utc(raw.get('start_utc'));hours=number(raw.get('duration_h',24),'Comparison hours',1,168)
    step=number(raw.get('step_min',60),'Comparison sample spacing',15,180)
    stop=start+timedelta(hours=hours)
    a,ma=fetch_geometry(site,start,stop,step,root,'spice',progress)
    b,mb=fetch_geometry(site,start,stop,step,root,'horizons',progress)
    return {'site_id':site['id'],'samples':len(a),'differences':compare_rows(a,b),
        'metadata':{'spice':ma,'horizons':mb},'workspace_changed':False,
        'note':'Diagnostic comparison, not a certification or automatic pass/fail. DE421 and the current Horizons solution can differ; also check aberration, frame, radii and epoch conventions. Azimuth near zenith is excluded.'}
