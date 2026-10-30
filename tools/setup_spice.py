#!/usr/bin/env python3
"""Install the pinned NASA kernel set, or inspect it without changing anything."""
import argparse,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from lunashift.spice_engine import install,status

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check',action='store_true',help='Do not download; report local readiness')
    parser.add_argument('--start',default='2026-12-15T00:00:00Z')
    parser.add_argument('--stop',default='2026-12-22T00:00:00Z')
    args=parser.parse_args()
    try:
        if not args.check:install(ROOT,lambda x:print(x,flush=True))
        result=status(ROOT,args.start,args.stop)
        print(json.dumps(result,indent=2))
        return 0 if result['ready'] else 1
    except Exception as exc:
        print('SPICE setup stopped: '+str(exc),file=sys.stderr)
        return 1
if __name__=='__main__':raise SystemExit(main())
