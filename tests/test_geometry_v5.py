"""Offline logic tests. Mocks here are not scientific SPICE validation."""
import copy, json, math, tempfile, threading, time, unittest
from pathlib import Path
from unittest.mock import patch, MagicMock
from contextlib import contextmanager
from datetime import timedelta
from http.server import ThreadingHTTPServer
from urllib.request import urlopen, Request
from urllib.error import HTTPError
import run
from lunashift import geometry as g, spice_engine as sp
from lunashift.data import demo_project, validate_project, validate_ui_state, project_summary
from lunashift.core import utc,iso

START='2026-12-15T00:00:00Z'
STOP='2026-12-15T02:00:00Z'
def rows():
    return [dict(time_utc=iso(utc(START)+timedelta(hours=i)),sun_azimuth_deg=30+i,sun_elevation_deg=2.,earth_azimuth_deg=180.,earth_elevation_deg=3.,sun_distance_km=149600000.,earth_distance_km=384400.) for i in range(3)]
def fixture_provider(*a,**k):return rows(),{'engine':'spice','actual_source':'spice','model':sp.MODEL,'selection_reason':'Test fixture, not an ephemeris validation.'}

class GeometryTests(unittest.TestCase):
    def test_source_validation(self):
        for s in g.SOURCES:self.assertEqual(g.source_name(s),s)
        for s in ('auto','unknown',None,True):
            with self.assertRaises(ValueError):g.source_name(s)
    def test_local_cardinal_angles(self):
        for vec,az,el in [([0,0,1],0,0),([0,1,0],90,0),([0,0,-1],180,0),([0,-1,0],270,0),([1,0,0],0,90)]:
            a,e,d=sp.local_angles(vec,0,0);self.assertAlmostEqual(a,az);self.assertAlmostEqual(e,el);self.assertEqual(d,1)
    def test_local_near_south_pole(self):
        a,e,d=sp.local_angles([1,0,0],-89.5,0);self.assertAlmostEqual(a,0);self.assertAlmostEqual(e,.5)
    def test_zero_or_nan_vector_rejected(self):
        for v in ([0,0,0],[float('nan'),0,0]):
            with self.assertRaises(ValueError):sp.local_angles(v,0,0)
    def test_observer_altitude_m_to_km(self):
        v=sp.observer_position({'latitude_deg':0,'longitude_deg':0,'ground_elevation_m':1000})
        self.assertEqual(v,[1738.4,0,0])
    def test_time_grid_extends_endpoint(self):
        t=sp.time_grid(START,'2026-12-15T02:01:00Z',60);self.assertEqual(len(t),4);self.assertEqual(iso(t[-1]),'2026-12-15T03:00:00Z')
    def test_time_grid_limits(self):
        for a,b,step in [(START,START,60),(STOP,START,60),(START,STOP,0),(START,STOP,60.5),(START,'2027-12-15T00:00:00Z',60),(START,'2027-01-15T00:00:00Z',1)]:
            with self.assertRaises(ValueError):sp.time_grid(a,b,step)
    def test_automatic_prefers_ready_spice(self):
        with patch.object(sp,'status',return_value={'ready':True}),patch.object(sp,'fetch_tracks',side_effect=fixture_provider) as calc,patch.object(g.horizons,'fetch_tracks') as online:
            r,m=g.fetch_geometry({},START,STOP,60,'.','automatic');self.assertEqual(m['actual_source'],'spice');online.assert_not_called();calc.assert_called_once()
    def test_automatic_explains_horizons_fallback(self):
        with patch.object(sp,'status',return_value={'ready':False,'message':'Files missing'}),patch.object(g.horizons,'fetch_tracks',return_value=(rows(),{})) as online:
            _,m=g.fetch_geometry({'latitude_deg':0,'longitude_deg':0,'ground_elevation_m':0},START,STOP,60,'.','automatic');self.assertEqual(m['actual_source'],'horizons');self.assertEqual(m['selection_reason'],'Files missing')
    def test_explicit_spice_never_falls_back(self):
        with patch.object(sp,'fetch_tracks',side_effect=sp.SpiceUnavailable('No files')),patch.object(g.horizons,'fetch_tracks') as online:
            with self.assertRaisesRegex(ValueError,'No files'):g.fetch_geometry({},START,STOP,60,'.','spice')
            online.assert_not_called()
    def test_explicit_horizons_never_calls_spice(self):
        site={'latitude_deg':0,'longitude_deg':0,'ground_elevation_m':0}
        with patch.object(sp,'fetch_tracks') as local,patch.object(g.horizons,'fetch_tracks',return_value=(rows(),{})):
            _,m=g.fetch_geometry(site,START,STOP,60,'.','horizons');self.assertEqual(m['actual_source'],'horizons');local.assert_not_called()
    def test_explicit_horizons_failure_not_hidden(self):
        with patch.object(g.horizons,'fetch_tracks',side_effect=ValueError('No connection')),patch.object(sp,'fetch_tracks') as local:
            with self.assertRaises(ValueError):g.fetch_geometry({},START,STOP,60,'.','horizons')
            local.assert_not_called()
    def test_automatic_computation_failure_not_silently_switched(self):
        with patch.object(sp,'status',return_value={'ready':True}),patch.object(sp,'fetch_tracks',side_effect=ValueError('bad geometry')),patch.object(g.horizons,'fetch_tracks') as online:
            with self.assertRaises(ValueError):g.fetch_geometry({},START,STOP,60,'.','automatic')
            online.assert_not_called()
    def test_prepare_copies_does_not_mutate(self):
        original=demo_project();saved=copy.deepcopy(original)
        with patch.object(g,'fetch_geometry',side_effect=fixture_provider):
            p,d=g.prepare_project(original,{'site_id':'A','start_utc':START,'duration_h':2},'.')
        self.assertEqual(original,saved);self.assertEqual(p['sites'][0]['track_mode'],'imported');self.assertFalse(p['sites'][0]['track_synthetic']);self.assertTrue(p['sites'][0]['terrain']['synthetic']);self.assertTrue(d[0]['mixed_terrain'])
        validate_project(p)
    def test_prepare_batch_failure_preserves_original(self):
        original=demo_project();saved=copy.deepcopy(original)
        with patch.object(g,'fetch_geometry',side_effect=[fixture_provider(),ValueError('second site failed')]):
            with self.assertRaises(ValueError):g.prepare_project(original,{'site_ids':['A','B'],'start_utc':START,'duration_h':2},'.')
        self.assertEqual(original,saved)
    def test_prepare_bad_ids(self):
        for ids in (['Z'],['A','A']):
            with self.assertRaises(ValueError):g.prepare_project(demo_project(),{'site_ids':ids,'start_utc':START,'duration_h':2},'.')
    def test_ui_source_persistence(self):
        p=demo_project();p['ui_state']={'selected_site_id':'A','fields':{},'geometry_source':'spice'}
        self.assertEqual(validate_project(p)['ui_state']['geometry_source'],'spice')
    def test_old_ui_state_stays_compatible(self):
        p=demo_project();s={'selected_site_id':'A','fields':{}}
        self.assertEqual(validate_ui_state(s,p['sites']),s)
    def test_bad_ui_source_rejected(self):
        with self.assertRaises(ValueError):validate_ui_state({'geometry_source':'other'},demo_project()['sites'])
    def test_summary_exposes_actual_source(self):
        p=demo_project();p['sites'][0]['track_metadata']={'actual_source':'spice','requested_source':'automatic','model':sp.MODEL}
        self.assertEqual(project_summary(p)['sites'][0]['geometry_engine'],'spice')
    def test_new_external_csv_clears_previous_provider(self):
        from lunashift.data import apply_csv
        import csv, io
        p=demo_project();p['sites'][0]['track_metadata']={'actual_source':'spice','model':sp.MODEL}
        buf=io.StringIO();writer=csv.DictWriter(buf,fieldnames=list(rows()[0]));writer.writeheader();writer.writerows(rows())
        out=apply_csv(p,'A','ephemeris',buf.getvalue(),'External user table')
        self.assertNotIn('track_metadata',out['sites'][0])
        self.assertIsNone(project_summary(out)['sites'][0]['geometry_engine'])
        self.assertEqual(p['sites'][0]['track_metadata']['actual_source'],'spice')
    def test_wraparound_difference(self):self.assertEqual(g.angle_difference(359,1),-2)
    def test_compare_identical(self):
        r=g.compare_rows(rows(),rows());self.assertAlmostEqual(r['sun']['max_direction_difference_deg'],0)
    def test_compare_known_elevation(self):
        a=rows();b=rows()
        for x in b:x['sun_elevation_deg']+=1
        r=g.compare_rows(a,b);self.assertAlmostEqual(r['sun']['max_direction_difference_deg'],1)
    def test_compare_rejects_misaligned_times(self):
        a=rows();b=rows();b[0]['time_utc']=STOP
        with self.assertRaises(ValueError):g.compare_rows(a,b)
    def test_status_missing_library(self):
        with tempfile.TemporaryDirectory() as root,patch.object(sp,'library',side_effect=sp.SpiceUnavailable('Install support')):
            s=sp.status(root);self.assertFalse(s['ready']);self.assertFalse(s['library_available']);self.assertIn('Install',s['message'])
    def test_missing_files_is_explicit(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaisesRegex(ValueError,'Missing'):sp.check_files(d)
    def test_reject_html_kernel(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'bad';p.write_bytes(b'<html>'+b'x'*200)
            with self.assertRaises(ValueError):sp.file_facts(p,sp.KERNELS[0])
    def test_reject_truncated_kernel(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'bad';p.write_bytes(b'KPL/LSK')
            with self.assertRaises(ValueError):sp.file_facts(p,sp.KERNELS[0])
    def test_reject_wrong_planetary_checksum(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'bad';p.write_bytes(b'DAF/SPK'+b'x'*1000)
            with self.assertRaisesRegex(ValueError,'checksum'):sp.file_facts(p,sp.KERNELS[2])
    def test_file_sha_recorded(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'test';p.write_bytes(b'KPL/LSK\n'+b'x'*1000)
            result=sp.file_facts(p,sp.KERNELS[0]);self.assertEqual(len(result['sha256']),64)
    def test_cleanup_after_geometry_error(self):
        fake=MagicMock();fake.furnsh.side_effect=RuntimeError('bad file')
        with patch.object(sp,'library',return_value=fake):
            with self.assertRaises(RuntimeError):
                with sp.loaded('.'):pass
        self.assertEqual(fake.kclear.call_count,2)
    def test_installer_missing_library_never_downloads(self):
        with tempfile.TemporaryDirectory() as d,patch.object(sp,'library',side_effect=sp.SpiceUnavailable('not installed')),patch.object(sp,'urlopen') as remote:
            with self.assertRaises(ValueError):sp.install(d)
            remote.assert_not_called()
    def test_failed_install_preserves_old_folder(self):
        with tempfile.TemporaryDirectory() as d:
            folder=sp.kernel_folder(d);folder.mkdir(parents=True);(folder/'keep.txt').write_text('old')
            with patch.object(sp,'library',return_value=MagicMock()),patch.object(sp,'urlopen',side_effect=OSError('blocked')):
                with self.assertRaises(ValueError):sp.install(d)
            self.assertEqual((folder/'keep.txt').read_text(),'old');self.assertFalse(list(folder.parent.glob('.download-*')))

class FakeSpice:
    """Deterministic test double exercises the plumbing, not celestial accuracy."""
    __version__='test-double'
    def __init__(self):self.calls=[];self.clears=0
    def kclear(self):self.clears+=1
    def furnsh(self,path):self.calls.append(path)
    def namfrm(self,frame):return 31007
    def str2et(self,stamp):return (utc(stamp)-utc('2000-01-01T00:00:00Z')).total_seconds()
    def tkvrsn(self,k):return 'TEST-ONLY'
    def bodvrd(self,body,field,n):return 3,[696000]*3 if body=='SUN' else [6371]*3
    def spkcpo(self,body,et,frame,refloc,abcorr,obs,center,obsref):
        self.calls.append((body,frame,refloc,abcorr,center,obsref))
        d=149600000 if body=='SUN' else 384400
        return [d,.02*d,.01*d,0,0,0],d/299792.458

class SpicePipelineTests(unittest.TestCase):
    def test_local_pipeline_and_cache_without_network(self):
        fake=FakeSpice();site=demo_project()['sites'][0]
        with tempfile.TemporaryDirectory() as root,patch.object(sp,'library',return_value=fake),patch.object(sp,'check_files',return_value=[{'name':'test','sha256':'abc'}]),patch.object(sp,'_check_dates',return_value=[]),patch.object(sp,'urlopen') as remote:
            a,ma=sp.fetch_tracks(site,START,STOP,60,root);b,mb=sp.fetch_tracks(site,START,STOP,60,root)
        self.assertEqual(a,b);self.assertFalse(ma['from_cache']);self.assertTrue(mb['from_cache']);remote.assert_not_called();self.assertEqual(fake.clears,4)
        self.assertTrue(any(isinstance(c,tuple) and c[3]=='CN+S' and c[2]=='OBSERVER' for c in fake.calls))
    def test_failed_calculation_does_not_cache(self):
        fake=FakeSpice();fake.spkcpo=MagicMock(side_effect=RuntimeError('no coverage'))
        with tempfile.TemporaryDirectory() as root,patch.object(sp,'library',return_value=fake),patch.object(sp,'check_files',return_value=[]),patch.object(sp,'_check_dates',return_value=[]):
            with self.assertRaises(ValueError):sp.fetch_tracks(demo_project()['sites'][0],START,STOP,60,root)
            self.assertEqual(list((Path(root)/'cache/spice').glob('*.json')),[])

class GeometryHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ws=run.Workspace();cls.server=ThreadingHTTPServer(('127.0.0.1',0),run.make_handler(cls.ws));cls.base='http://127.0.0.1:'+str(cls.server.server_port)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
    @classmethod
    def tearDownClass(cls):cls.server.shutdown();cls.server.server_close()
    def setUp(self):self.ws.replace(demo_project())
    def req(self,path,data=None,token=True):
        h={'Content-Type':'application/json'}
        if token:h['X-LunaShift-Token']=self.ws.token
        with urlopen(Request(self.base+path,data=json.dumps(data).encode() if data is not None else None,headers=h),timeout=10) as r:return json.load(r)
    def wait(self,job):
        for _ in range(100):
            r=self.req('/api/job?id='+job)
            if r['status']!='running':return r
            time.sleep(.01)
        self.fail('job did not finish')
    def test_status_is_read_only(self):
        before=self.ws.snapshot()
        with patch.object(sp,'status',return_value={'ready':False,'message':'fixture'}):self.assertFalse(self.req('/api/geometry/status')['ready'])
        self.assertEqual(before,self.ws.snapshot())
    def test_install_requires_consent(self):
        with self.assertRaises(HTTPError) as e:self.req('/api/spice/install',{})
        self.assertEqual(e.exception.code,400)
    def test_geometry_requires_token(self):
        with self.assertRaises(HTTPError) as e:self.req('/api/geometry',{},False)
        self.assertEqual(e.exception.code,403)
    def test_preparation_attaches_actual_provider(self):
        with patch.object(g,'fetch_geometry',side_effect=fixture_provider):
            j=self.req('/api/geometry',{'site_id':'A','start_utc':START,'duration_h':2,'geometry_source':'spice'});r=self.wait(j['job_id'])
        self.assertEqual(r['status'],'complete');self.assertEqual(r['details'][0]['engine'],'spice');self.assertEqual(self.ws.snapshot()['sites'][0]['track_metadata']['actual_source'],'spice')
    def test_failed_job_keeps_workspace(self):
        old=self.ws.snapshot()
        with patch.object(g,'fetch_geometry',side_effect=ValueError('offline files missing')):
            j=self.req('/api/geometry',{'site_id':'A','start_utc':START,'duration_h':2,'geometry_source':'spice'});r=self.wait(j['job_id'])
        self.assertEqual(r['status'],'failed');self.assertEqual(old,self.ws.snapshot())
    def test_compare_does_not_replace_data(self):
        old=self.ws.snapshot()
        with patch.object(run,'compare_sources',return_value={'workspace_changed':False}):
            r=self.wait(self.req('/api/geometry/compare',{'site_id':'A','start_utc':START})['job_id'])
        self.assertEqual(r['status'],'complete');self.assertEqual(old,self.ws.snapshot())
    def test_install_endpoint_job_result(self):
        old=self.ws.snapshot()
        with patch.object(sp,'install',return_value={'ready':True,'message':'test setup complete'}):
            r=self.wait(self.req('/api/spice/install',{'consent':True})['job_id'])
        self.assertEqual(r['status'],'complete');self.assertEqual(old,self.ws.snapshot())
    def test_changed_workspace_not_overwritten(self):
        gate=threading.Event();started=threading.Event();original=self.ws.snapshot()
        def slow(*a):started.set();gate.wait(3);return original,[{'engine':'spice','mixed_terrain':False}]
        with patch.object(run,'prepare_project',side_effect=slow):
            j=self.req('/api/geometry',{'site_id':'A','start_utc':START});started.wait(1)
            p=self.ws.snapshot();p['sites'][0]['name']='Changed while working';self.ws.replace(p);gate.set();r=self.wait(j['job_id'])
        self.assertEqual(r['status'],'failed');self.assertEqual(self.ws.snapshot()['sites'][0]['name'],'Changed while working')

if __name__=='__main__':unittest.main()
