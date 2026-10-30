#!/usr/bin/env python3
"""Run reproducible learning exercises without third-party packages or internet."""
import csv
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from lunashift.data import demo_project
from lunashift.core import analyze,repair,horizon,validate_params

root=Path(__file__).resolve().parents[1]
out=root/'learning_output';out.mkdir(exist_ok=True)
p=demo_project()
print('\nLESSON 1 - Data shapes (ALL SYNTHETIC)')
s=p['sites'][0]
print('Sites:',len(p['sites']),'Azimuth rays:',len(s['terrain']['azimuth_deg']),
      'Range samples/ray:',len(s['terrain']['distances_m']))
print('\nLESSON 2 - Local skyline')
h=horizon(s,2)
with (out/'horizon_A.csv').open('w',newline='') as f:
    w=csv.writer(f);w.writerow(['azimuth_deg','horizon_deg']);w.writerows(zip(h['azimuth_deg'],h['horizon_deg']))
print('Wrote learning_output/horizon_A.csv. This is fixed at 2 m.')
print('\nLESSON 3 - Mission visibility')
a=analyze(p,{})
for r in a['results']:
    m=r['metrics']
    print(f"{r['site_id']}: {r['status']}; sunlight={m['sunlight_pct']:.2f}%; longest darkness={m['longest_dark_h']:.2f} h")
(out/'analysis.json').write_text(json.dumps(a,indent=2),encoding='utf-8')
print('\nLESSON 4 - Repair the initial plan')
r=repair(p,{'preferred_site_id':'A'})
print(json.dumps(r['best'],indent=2))
print('Try altering max_delay_h, max_height_m, or weight_move in this script.')
print('\nLESSON 5 - Data-driven change')
p['sites'][2]['slope_deg']=25
r2=repair(p,{'preferred_site_id':'A'})
print('After a SYNTHETIC slope update at C, best option:')
print(json.dumps(r2['best'],indent=2))
print('\nThese exercises test the software workflow, not real lunar sites. See docs/MANUAL.md for real-data integration.')
