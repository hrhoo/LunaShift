#!/usr/bin/env python3
"""Start LunaShift. Core teaching mode is standard-library only; SPICE/terrain are optional."""
from __future__ import annotations
import sys
if sys.version_info < (3,10):
    raise SystemExit('LunaShift requires Python 3.10 or newer. Python 3.12 or 3.13 is recommended.')
import argparse
import copy
import json
import mimetypes
import os
from pathlib import Path
import secrets
import threading
import time
import traceback
import webbrowser
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse, parse_qs
from lunashift.core import analyze, repair, number, utc, iso
from lunashift.data import demo_project, validate_project, project_summary, apply_csv
from lunashift.horizons import fetch_tracks
from lunashift.mission import mission_analyze, mission_repair, DEFAULT_HARDWARE
from lunashift.resources import manifest, MOON_TEXTURE
from lunashift.remote import capabilities, tile, get_bytes
from lunashift.raster import convert_for_site, sample_context
import uuid, hashlib
from lunashift.bootstrap import build_real_example
from lunashift.diagnostics import connection_report
from lunashift import spice_engine
from lunashift.geometry import prepare_project, compare_sources

ROOT=Path(__file__).resolve().parent
MAX_BODY=32_000_000

class Workspace:
    """One local workspace. Atomic autosave is optional (off in unit tests)."""
    def __init__(self, state_path=None, ephemeral=False):
        self.lock=threading.RLock()
        self.state_path=Path(state_path) if state_path else None
        self.ephemeral=ephemeral
        self.warning=None
        self.jobs={}
        self.project=demo_project()
        self.token=secrets.token_urlsafe(32)
        if self.state_path and self.state_path.exists():
            try:
                self.project=validate_project(json.loads(self.state_path.read_text(encoding='utf-8')))
            except (ValueError, OSError, TypeError, KeyError) as error:
                self.warning=('The autosaved file could not be opened. The example is active. '
                              'The unreadable file was left untouched; export a copy before troubleshooting. '+str(error))
                # Never overwrite the user's unreadable file automatically.
                self.state_path=None

    def snapshot(self):
        with self.lock:
            return copy.deepcopy(self.project)

    def storage_info(self):
        return {'persistent':bool(self.state_path and not self.ephemeral),
                'autosave_enabled':bool(self.state_path), 'temporary_runtime':self.ephemeral,
                'warning':self.warning}

    def _commit(self, project):
        if self.state_path:
            self.state_path.parent.mkdir(parents=True, exist_ok=True)
            temporary=self.state_path.with_suffix('.tmp')
            try:
                temporary.write_text(json.dumps(project,ensure_ascii=False,allow_nan=False), encoding='utf-8')
                temporary.replace(self.state_path)
            finally:
                temporary.unlink(missing_ok=True)
        self.project=project

    def replace(self, project):
        validated=validate_project(project)
        with self.lock:
            self._commit(validated)

    def save_ui(self, state):
        from lunashift.data import validate_ui_state
        with self.lock:
            project=copy.deepcopy(self.project)
            project['ui_state']=validate_ui_state(state,project['sites'])
            self._commit(project)


def make_handler(ws, allow_proxy=False):
    class Handler(BaseHTTPRequestHandler):
        server_version='LunaShift/0.5.0'
        def log_message(self,fmt,*args):
            if '/api/' in self.path or '404' in str(args):
                super().log_message(fmt,*args)
        def send(self,data,status=200,ctype='application/json; charset=utf-8'):
            raw=json.dumps(data,allow_nan=False).encode('utf-8') if 'application/json' in ctype else data
            self.send_response(status)
            self.send_header('Content-Type',ctype)
            self.send_header('Content-Length',str(len(raw)))
            self.send_header('Cache-Control','no-store')
            self.send_header('X-Content-Type-Options','nosniff')
            self.send_header('Referrer-Policy','no-referrer')
            if not allow_proxy:
                self.send_header('X-Frame-Options','DENY')
                self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://svs.gsfc.nasa.gov https://trek.nasa.gov; connect-src 'self' https://trek.nasa.gov; frame-src https://eyes.nasa.gov; media-src 'self' https://svs.gsfc.nasa.gov;  object-src 'none'; frame-ancestors 'none'")
            else:
                # Colab displays the app inside its own authenticated notebook iframe.
                self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://svs.gsfc.nasa.gov https://trek.nasa.gov; connect-src 'self' https://trek.nasa.gov; frame-src https://eyes.nasa.gov; media-src 'self' https://svs.gsfc.nasa.gov;  object-src 'none'")
            self.end_headers();self.wfile.write(raw)
        def safe_host(self):
            if allow_proxy:
                return True
            return self.headers.get('Host','').split(':')[0] in ('localhost','127.0.0.1')
        def do_GET(self):
            if not self.safe_host():return self.send({'error':'Local access only.'},403)
            path=unquote(urlparse(self.path).path)
            try:
                if path=='/api/job':
                    key=parse_qs(urlparse(self.path).query).get('id',[''])[0]
                    with ws.lock:result=copy.deepcopy(ws.jobs.get(key))
                    if result is None:return self.send({'error':'Job not found'},404)
                    return self.send(result)
                if path=='/api/geometry/status':
                    q=parse_qs(urlparse(self.path).query)
                    start=q.get('start_utc',[None])[0];stop=q.get('stop_utc',[None])[0]
                    return self.send(spice_engine.status(ROOT,start,stop))
                if path=='/api/sources':return self.send(manifest(ws.snapshot()))
                if path=='/api/diagnostics':return self.send(connection_report(ROOT/'cache/maps'))
                if path=='/api/hardware_defaults':return self.send(DEFAULT_HARDWARE)
                query=parse_qs(urlparse(self.path).query)
                if path=='/api/map':
                    return self.send(capabilities(query.get('layer',['imagery'])[0],ROOT/'cache/maps'))
                if path=='/api/tile':
                    data,ctype=tile(query.get('layer',['imagery'])[0],int(query.get('z',['0'])[0]),int(query.get('row',['0'])[0]),int(query.get('col',['0'])[0]),ROOT/'cache/maps')
                    return self.send(data,ctype=ctype)
                if path=='/api/texture':
                    data,ctype=get_bytes(MOON_TEXTURE,ROOT/'cache/maps')
                    return self.send(data,ctype=ctype)
            except (ValueError,OSError,KeyError) as e:return self.send({'error':str(e)},503)
            if path=='/api/state':return self.send({'project':project_summary(ws.snapshot()),'token':ws.token,'version':'0.5.0','storage':ws.storage_info()})
            if path=='/api/export':return self.send(ws.snapshot())
            if path=='/api/health':return self.send({'ok':True,'version':'0.5.0'})
            if path.startswith('/docs/'):
                base=ROOT/'docs';rel=path[len('/docs/'):]
            elif path.startswith('/samples/'):
                base=ROOT/'data';rel=path[len('/samples/'):]
            else:
                base=ROOT/'web';rel='index.html' if path=='/' else path.lstrip('/')
            target=(base/rel).resolve()
            try:target.relative_to(base.resolve())
            except ValueError:return self.send({'error':'Not found'},404)
            if not target.is_file():return self.send({'error':'Not found'},404)
            ctype=mimetypes.guess_type(str(target))[0] or 'application/octet-stream'
            if ctype.startswith('text/') or ctype=='application/javascript':ctype+='; charset=utf-8'
            return self.send(target.read_bytes(),ctype=ctype)
        def do_POST(self):
            if not self.safe_host() or self.headers.get('X-LunaShift-Token')!=ws.token:
                return self.send({'error':'Refresh the page and retry (local session token missing).'},403)
            if urlparse(self.path).path=='/api/upload/terrain':
                try:
                    n=int(self.headers.get('Content-Length','0'))
                    if not 0<n<=512*1024*1024:raise ValueError('Upload a GeoTIFF between 1 byte and 512 MiB. Larger rasters can be processed with the included CLI converter.')
                    folder=ROOT/'cache/uploads';folder.mkdir(parents=True,exist_ok=True)
                    key=uuid.uuid4().hex;target=folder/(key+'.tif');digest=hashlib.sha256();left=n
                    try:
                        with target.open('wb') as f:
                            while left:
                                part=self.rfile.read(min(left,1024*1024))
                                if not part:raise ValueError('Upload was interrupted.')
                                f.write(part);digest.update(part);left-=len(part)
                        with target.open('rb') as check_file:
                            head=check_file.read(4)
                        if head not in (b'II*\x00',b'MM\x00*',b'II+\x00',b'MM\x00+'):
                            raise ValueError('Not a TIFF/BigTIFF file. A web page or image screenshot is not an elevation raster.')
                    except Exception:
                        target.unlink(missing_ok=True);raise
                    return self.send({'upload_key':key,'bytes':n,'sha256':digest.hexdigest()})
                except (ValueError,OSError) as e:return self.send({'error':str(e)},400)
            try:
                n=int(self.headers.get('Content-Length','0'))
                if not 0<n<=MAX_BODY:raise ValueError('Request is empty or exceeds the 32 MB limit.')
                raw=json.loads(self.rfile.read(n))
                if not isinstance(raw,dict):raise ValueError('Expected a JSON object.')
                path=urlparse(self.path).path
                begin=time.perf_counter()
                if path in ('/api/spice/install','/api/geometry','/api/geometry/compare'):
                    if path=='/api/spice/install' and raw.get('consent') is not True:
                        raise ValueError('Confirm the NASA file download first.')
                    with ws.lock:
                        if any(x.get('status')=='running' for x in ws.jobs.values()):
                            raise ValueError('Another preparation is running. Let it finish before starting a new one.')
                        key=uuid.uuid4().hex
                        original=ws.snapshot()
                        ws.jobs[key]={'status':'running','message':'Starting your request…','kind':path}
                    def task():
                        def progress(message):
                            with ws.lock:ws.jobs[key]['message']=message
                        try:
                            if path=='/api/spice/install':
                                report=spice_engine.install(ROOT,progress)
                                out={'spice_status':report,'message':report['message']}
                            elif path=='/api/geometry/compare':
                                report=compare_sources(original,raw,ROOT,progress)
                                out={'comparison':report,'message':'Comparison complete. Your workspace data were not replaced.'}
                            else:
                                prepared,details=prepare_project(original,raw,ROOT,progress)
                                with ws.lock:
                                    current=ws.snapshot()
                                    if current['sites']!=original['sites'] or current['coordinate_frame']!=original['coordinate_frame']:
                                        raise ValueError('The workspace changed during preparation. Nothing was replaced. Please retry.')
                                    # Do not discard edits to UI settings made while a job ran.
                                    if current.get('ui_state'):prepared['ui_state']=current['ui_state']
                                    ws.replace(prepared)
                                actual=', '.join(sorted({x['engine'].upper() for x in details}))
                                mixed=any(x['mixed_terrain'] for x in details)
                                message=f'Sun/Earth data prepared for {len(details)} location(s), using {actual}. Terrain was not changed.'
                                if mixed:message+=' Synthetic terrain is still attached: this is a mixed learning scenario, not a real landing forecast.'
                                out={'project':project_summary(ws.snapshot()),'details':details,'message':message}
                            with ws.lock:ws.jobs[key]={'status':'complete',**out}
                        except Exception as error:
                            with ws.lock:ws.jobs[key]={'status':'failed','message':str(error)}
                    threading.Thread(target=task,daemon=True).start()
                    result={'job_id':key}
                elif path=='/api/nasa_example':
                    with ws.lock:
                        if any(x.get('status')=='running' for x in ws.jobs.values()):raise ValueError('A NASA example is already being prepared.')
                        key=uuid.uuid4().hex
                        ws.jobs[key]={'status':'running','message':'Checking optional dependencies…'}
                        original_sites=copy.deepcopy(ws.project['sites'])
                    def prepare():
                        def progress(message):
                            with ws.lock:ws.jobs[key]['message']=message
                        try:
                            project=build_real_example(ROOT,raw,progress)
                            with ws.lock:
                                if ws.project['sites']!=original_sites:raise ValueError('The workspace changed while loading. Nothing was replaced; retry from the intended workspace.')
                                ws.replace(project)
                                ws.jobs[key]={'status':'complete','message':'Real NASA terrain and ephemerides attached. Check the finite-range and hardware assumptions before interpretation.','project':project_summary(ws.snapshot())}
                        except Exception as error:
                            with ws.lock:ws.jobs[key]={'status':'failed','message':str(error)}
                    threading.Thread(target=prepare,daemon=True).start()
                    result={'job_id':key}
                elif path=='/api/engineering':
                    result=mission_analyze(ws.snapshot(),raw);result['runtime_s']=time.perf_counter()-begin
                elif path=='/api/mission_repair':
                    result=mission_repair(ws.snapshot(),raw);result['runtime_s']=time.perf_counter()-begin
                elif path in ['/api/terrain','/api/context']:
                    key=str(raw.get('upload_key',''))
                    if len(key)!=32 or any(x not in '0123456789abcdef' for x in key):raise ValueError('Upload a raster first.')
                    uploaded=ROOT/'cache/uploads'/(key+'.tif')
                    if not uploaded.is_file():raise ValueError('The uploaded raster is no longer available. Upload again.')
                    if raw.get('frame_confirmed') is not True:raise ValueError('Confirm the documented lunar coordinate frame before processing.')
                    source=str(raw.get('source','')).strip()
                    if not source:raise ValueError('Enter the original data source and version.')
                    project=ws.snapshot()
                    if path=='/api/terrain':
                        site=next((x for x in project['sites'] if x['id']==raw.get('site_id')),None)
                        if site is None:raise ValueError('Choose a saved candidate location.')
                        replacement=convert_for_site(uploaded,site,source,raw.get('radius_km',5),raw.get('az_step',2),raw.get('range_step',100))
                        # Conversion changes the observer altitude. Old tracks are not silently reused.
                        project['sites']=[replacement if x['id']==site['id'] else x for x in project['sites']]
                        project.pop('preview',None)
                        message='Real terrain attached. Fetch Sun/Earth tracks again using the updated ground elevation. This is a finite-range terrain model, not a complete landing-safety assessment.'
                    else:
                        samples=sample_context(uploaded,project['sites'],raw.get('kind'),str(raw.get('unit','')),source)
                        for x in project['sites']:
                            entry=next(r for r in samples if r['site_id']==x['id'])
                            x['context_layers']=[r for r in x.get('context_layers',[]) if r.get('kind')!=entry['kind']]+[entry]
                        message='Context values attached. They are NOT automatically substituted into energy or radio calculations.'
                    project.setdefault('history',[]).append({'change':message,'source':source,'time_utc':iso(datetime.now(timezone.utc))})
                    ws.replace(project);result={'project':project_summary(ws.snapshot()),'message':message}
                elif path=='/api/real_workspace':
                    site={'id':'SITE_1','name':str(raw.get('name','My lunar location')),'latitude_deg':raw.get('latitude_deg',-89.5),'longitude_deg':raw.get('longitude_deg',0),'ground_elevation_m':0,'slope_deg':None,'track_mode':'none','terrain':None}
                    project={'schema_version':1,'name':'Real-data mission workspace','description':'Start with a real imagery location. Terrain and ephemerides must be attached before numerical evaluation.','coordinate_frame':'MOON_ME_DE421','time_scale':'UTC','sites':[site],'history':[]}
                    ws.replace(project);result={'project':project_summary(ws.snapshot()),'message':'Real-data workspace created. No synthetic numerical inputs are active. Add terrain, then request ephemerides.'}
                elif path=='/api/analyze':
                    result=analyze(ws.snapshot(),raw);result['runtime_s']=time.perf_counter()-begin
                elif path=='/api/settings':
                    ws.save_ui(raw.get('ui_state',{}));result={'ok':True,'storage':ws.storage_info()}
                elif path=='/api/repair':
                    result=repair(ws.snapshot(),raw);result['runtime_s']=time.perf_counter()-begin
                elif path=='/api/import':
                    if raw.get('kind')=='project':
                        p=validate_project(raw['project'])
                    else:
                        p=apply_csv(ws.snapshot(),str(raw.get('site_id','')),raw.get('kind'),str(raw.get('text','')),str(raw.get('source','')),raw.get('metadata'))
                    ws.replace(p);result={'project':project_summary(p),'message':'Data imported and validated. Re-run analysis to inspect the impact.'}
                elif path=='/api/add_site':
                    p=ws.snapshot()
                    s={'id':str(raw.get('id','')).strip(),'name':str(raw.get('name','Custom site')).strip(),
                       'latitude_deg':raw.get('latitude_deg'),'longitude_deg':raw.get('longitude_deg'),
                       'ground_elevation_m':raw.get('ground_elevation_m',0),
                       'slope_deg':raw.get('slope_deg'),'track_mode':'none','terrain':None}
                    p['sites'].append(s);ws.replace(p)
                    result={'project':project_summary(ws.snapshot()),'message':'Location added. It needs both terrain and Sun/Earth tracks before analysis.'}
                elif path=='/api/horizons':
                    p=ws.snapshot();sid=raw.get('site_id')
                    site=next((s for s in p['sites'] if s['id']==sid),None)
                    if not site:raise ValueError('Select an existing site.')
                    start=utc(raw.get('start_utc'))
                    hours=number(raw.get('duration_h',168),'Download duration',1,1440)
                    rows,meta=fetch_tracks(site,start,start+timedelta(hours=hours),raw.get('step_min',60),ROOT/'cache')
                    # Copy under lock only once complete; a failed request changes nothing.
                    current=ws.snapshot()
                    target=next((s for s in current['sites'] if s['id']==sid),None)
                    if target is None:raise ValueError('The project changed while the request was running. Retry.')
                    if any(target[k]!=site[k] for k in ['latitude_deg','longitude_deg','ground_elevation_m']):
                        raise ValueError('Site coordinates changed during the request. Retry.')
                    meta.update(engine='horizons',actual_source='horizons',requested_source='horizons',selection_reason='Legacy Horizons endpoint explicitly selected.')
                    target.update(ephemeris=rows,track_mode='imported',track_synthetic=False,track_source='NASA JPL Horizons, airless apparent AZ/EL',track_metadata=meta,track_max_gap_min=raw.get('step_min',60))
                    current.setdefault('history',[]).append({'change':'Fetched Horizons for '+sid,'source':'NASA JPL Horizons','time_utc':iso(datetime.now(timezone.utc))})
                    ws.replace(current)
                    result={'project':project_summary(current),'message':f'Attached {len(rows)} Sun/Earth samples to {sid}. Terrain was not changed.','metadata':meta}
                elif path=='/api/reset':
                    ws.replace(demo_project());result={'project':project_summary(ws.snapshot()),'message':'Synthetic learning project restored.'}
                else:return self.send({'error':'Unknown endpoint'},404)
                return self.send(result)
            except (ValueError,KeyError,TypeError) as e:
                return self.send({'error':str(e)},400)
            except Exception:
                traceback.print_exc()
                return self.send({'error':'Unexpected server error. Read the terminal details; the existing project remains available.'},500)
    return Handler


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,default=8765)
    parser.add_argument('--no-browser',action='store_true')
    parser.add_argument('--no-autosave',action='store_true',help='Keep the workspace only in memory')
    parser.add_argument('--state-file',type=Path,help='Custom local autosave JSON path')
    parser.add_argument('--project',type=Path,help='Optional previously exported LunaShift project JSON')
    parser.add_argument('--colab',action='store_true',help='Allow the authenticated Google Colab notebook proxy and iframe display')
    args=parser.parse_args()
    if not 1024<=args.port<=65535:parser.error('Choose a port between 1024 and 65535.')
    state_path=None if args.no_autosave else (args.state_file or ROOT/'.workspace'/'current_project.json')
    ws=Workspace(state_path, ephemeral=args.colab)
    if args.project:
        try:ws.replace(json.loads(args.project.read_text(encoding='utf-8')))
        except Exception as e:parser.error('Cannot load project: '+str(e))
    bind_host='127.0.0.1'
    try:server=ThreadingHTTPServer((bind_host,args.port),make_handler(ws, allow_proxy=args.colab))
    except OSError as e:
        raise SystemExit(f'Could not start on port {args.port}: {e}\nTry: python run.py --port {args.port+1}')
    url=f'http://127.0.0.1:{args.port}'
    print('\nLunaShift 0.5.0 - Mission Planner\n'+url+'\n')
    print('Keep this terminal open. Press Ctrl+C to stop. Core teaching mode needs no GPU or extra packages; SPICE and terrain support are optional.')
    if args.colab:
        print('Colab mode is active. Display this port with google.colab.output.serve_kernel_port_as_iframe().')
    print('Default data are synthetic. This is a learning platform, not flight planning software.')
    if ws.state_path:
        print('Autosave:',ws.state_path)
    if args.colab:
        print('Colab storage is temporary. Download your project before disconnecting.')
    if ws.warning:
        print('WARNING:',ws.warning)
    if not args.no_browser:
        threading.Timer(.7,lambda:webbrowser.open(url)).start()
    try:server.serve_forever()
    except KeyboardInterrupt:print('\nStopped.')
    finally:server.server_close()

if __name__=='__main__':main()
