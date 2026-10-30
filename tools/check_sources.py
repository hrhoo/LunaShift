#!/usr/bin/env python3
"""Probe real external integrations on YOUR network. Does not fetch full DEMs."""
import json,sys,time
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.parse import urlencode
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from lunashift.remote import capabilities,get_bytes
from lunashift.resources import MAP_LAYERS,MOON_TEXTURE
from lunashift.horizons import fetch_tracks
from lunashift.bootstrap import DEMO_DEM
ROOT=Path(__file__).resolve().parents[1];results=[]
def check(name,action):
    started=time.monotonic()
    try:detail=action();ok=True
    except Exception as e:detail=str(e);ok=False
    results.append({'source':name,'ok':ok,'detail':detail,'seconds':round(time.monotonic()-started,2)})
    print(('PASS ' if ok else 'FAIL ')+name+': '+str(detail))
for layer in MAP_LAYERS:
    check('WMTS '+layer,lambda l=layer:capabilities(l,ROOT/'cache/source-check')['identifier'])
check('NASA texture',lambda:len(get_bytes(MOON_TEXTURE,ROOT/'cache/source-check',limit=6000000)[0]))
site={'latitude_deg':-89.0,'longitude_deg':0.0,'ground_elevation_m':0.0}
check('Horizons short airless track',lambda:len(fetch_tracks(site,'2026-11-01T00:00:00Z','2026-11-01T02:00:00Z',60,ROOT/'cache')[0]))
def dem_head():
    with urlopen(Request(DEMO_DEM,method='HEAD'),timeout=30) as r:
        return {'status':r.status,'type':r.headers.get('Content-Type'),'bytes':r.headers.get('Content-Length')}
check('PGDA example DEM headers',dem_head)
out=ROOT/'source_check.json';out.write_text(json.dumps(results,indent=2));print('Report:',out)
print('A failed endpoint is not proof of bad scientific data. Check connectivity, certificates or the current official product page.')
