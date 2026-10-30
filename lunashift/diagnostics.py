"""Read-only, bounded service checks. Does not modify the mission workspace."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timezone
from urllib.request import Request,urlopen
from urllib.parse import urlencode
import importlib.util,platform,time,json
from .remote import get_bytes,parse_capabilities,tls_context
from .resources import MAP_LAYERS
from .horizons import build_query,parse_observer,API

def connection_report(cache_dir):
    def check_map(item):
        key,src=item;t=time.perf_counter();row={'source':key,'url':src['url'],'metadata':'not checked','sample_tile':'not checked'}
        try:
            data,_=get_bytes(src['url'],cache_dir,timeout=10)
            cap=parse_capabilities(data,src['projection']);row['metadata']='valid';row['levels']=len(cap['matrices'])
            m=cap['matrices'][0];url=cap['template']
            for k,v in {'Style':cap['style'],'TileMatrixSet':cap['matrix_set'],'TileMatrix':m['id'],'TileRow':m['height']//2,'TileCol':m['width']//2}.items():url=url.replace('{'+k+'}',str(v))
            data,ctype=get_bytes(url,cache_dir,timeout=8)
            row['sample_tile']='image received' if ctype.startswith('image/') else 'not an image';row['sample_tile_url']=url;row['bytes']=len(data)
        except Exception as e:row['error']=str(e)
        row['elapsed_s']=round(time.perf_counter()-t,2);return row
    def check_horizons():
        t=time.perf_counter();row={'source':'horizons','ephemeris':'not checked'}
        try:
            params=build_query({'latitude_deg':-89.5,'longitude_deg':0,'ground_elevation_m':0},10,'2026-11-01T00:00:00Z','2026-11-01T02:00:00Z',60)
            url=API+'?'+urlencode({k:v if k=='format' else "'"+v+"'" for k,v in params.items()});row['url']=url
            with urlopen(Request(url,headers={'User-Agent':'LunaShift/0.5.0 diagnostic'}),timeout=10,context=tls_context()) as r:
                payload=json.loads(r.read(1000000))
            if payload.get('error'):raise ValueError(payload['error'])
            tracks=parse_observer(payload.get('result',''));row.update(ephemeris='valid Sun track received',samples=len(tracks))
        except Exception as e:row['error']=str(e)
        row['elapsed_s']=round(time.perf_counter()-t,2);return row
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures=[executor.submit(check_map,x) for x in MAP_LAYERS.items()]+[executor.submit(check_horizons)]
        checks=[f.result() for f in futures]
    return {'version':'0.5.0','time_utc':datetime.now(timezone.utc).isoformat(),'python':platform.python_version(),
      'optional_packages':{x:bool(importlib.util.find_spec(x)) for x in ['numpy','rasterio','pyproj','PIL','certifi']},
      'checks':checks,'note':'These checks describe this server and its network only. A valid map description is not proof that every tile exists. Browser fallback may succeed when the server cannot connect. No workspace data were changed.'}
