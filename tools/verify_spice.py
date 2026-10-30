#!/usr/bin/env python3
"""Run actual local-kernel calculations; optionally compare against live Horizons.

Not included in offline unit tests. No synthetic ephemerides are used here.
A comparison report is diagnostic, not a mission-accuracy certificate.
"""
import argparse,json,sys,math
from pathlib import Path
from datetime import timedelta
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from lunashift import spice_engine
from lunashift.geometry import compare_sources
from lunashift.core import utc,iso

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--online',action='store_true');args=parser.parse_args()
    output={'kind':'actual managed kernels; no mocks','online_comparison_requested':args.online,'checks':[]}
    try:
        for index,(lat,lon,date) in enumerate([(-89.5,35,'2026-12-15'),(-88.0,180,'2026-11-15'),(-85,0,'2027-01-15')]):
            site={'id':f'V{index}','name':'Verification location','latitude_deg':lat,'longitude_deg':lon,'ground_elevation_m':0}
            a=utc(date+'T00:00:00Z');b=a+timedelta(hours=24)
            rows,meta=spice_engine.fetch_tracks(site,a,b,60,ROOT,print)
            assert len(rows)==25 and all(300000<r['earth_distance_km']<450000 for r in rows)
            assert all(1.3e8<r['sun_distance_km']<1.7e8 for r in rows)
            entry={'site':site,'start':iso(a),'samples':len(rows),'metadata':meta,'sanity_checks':'finite directions and broad ranges passed (not accuracy validation)'}
            if args.online:entry['comparison']=compare_sources({'sites':[site]},{'site_id':site['id'],'start_utc':iso(a),'duration_h':24,'step_min':60},ROOT,print)
            output['checks'].append(entry)
        output['completed']=True
    except Exception as exc:
        output.update(completed=False,error=str(exc))
    path=ROOT/'verification/live_spice_report.json';path.parent.mkdir(exist_ok=True);path.write_text(json.dumps(output,indent=2))
    print(json.dumps(output,indent=2));print('Report:',path)
    return 0 if output.get('completed') else 1
if __name__=='__main__':raise SystemExit(main())
