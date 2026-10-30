import json,time,threading,unittest,tempfile
from unittest.mock import patch
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer
from pathlib import Path
import run
from lunashift.data import demo_project

class HTTPV3(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.ws=run.Workspace();cls.http=ThreadingHTTPServer(('127.0.0.1',0),run.make_handler(cls.ws));cls.base='http://127.0.0.1:'+str(cls.http.server_port)
  cls.thread=threading.Thread(target=cls.http.serve_forever,daemon=True);cls.thread.start()
 @classmethod
 def tearDownClass(cls):cls.http.shutdown();cls.http.server_close();cls.thread.join()
 def setUp(self):self.ws.replace(demo_project())
 def req(self,path,body=None):
  with urlopen(Request(self.base+path,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json','X-LunaShift-Token':self.ws.token}),timeout=20) as r:return json.load(r)
 def waitjob(self,key):
  for _ in range(200):
   j=self.req('/api/job?id='+key)
   if j['status']!='running':return j
   time.sleep(.02)
  self.fail('Example job did not finish.')
 def test_sources_roles(self):
  d=self.req('/api/sources');self.assertEqual(len(d['sources']),15);self.assertTrue(any('External reference only'==s['status'] for s in d['sources']))
 def test_engineering_and_conservation(self):
  d=self.req('/api/engineering',{});self.assertEqual(len(d['results']),4);self.assertIn('Earth-centre',d['scope'])
 def test_hardware_repair(self):
  d=self.req('/api/mission_repair',{'site_id':'A'});self.assertEqual(d['tested'],36);self.assertIn('Not a global optimum',d['search_note'])
 def test_missing_real_inputs_are_unknown(self):
  self.req('/api/real_workspace',{'latitude_deg':-89,'longitude_deg':0});d=self.req('/api/engineering',{});self.assertEqual(d['results'][0]['status'],'unknown')
 def test_failed_nasa_job_retains_project(self):
  old=self.ws.snapshot()
  with patch.object(run,'build_real_example',side_effect=ValueError('External source unreachable')):
   key=self.req('/api/nasa_example',{})['job_id'];job=self.waitjob(key)
  self.assertEqual(job['status'],'failed');self.assertEqual(old,self.ws.snapshot())
 def test_successful_job_commits_validated_project(self):
  fixture=demo_project();fixture['name']='MOCK PIPELINE TEST, NOT NASA DATA'
  with patch.object(run,'build_real_example',return_value=fixture):
   key=self.req('/api/nasa_example',{})['job_id'];job=self.waitjob(key)
  self.assertEqual(job['status'],'complete');self.assertEqual(self.ws.snapshot()['name'],fixture['name'])
 def test_html_rejected_as_geotiff(self):
  with tempfile.TemporaryDirectory() as tmp,patch.object(run,'ROOT',Path(tmp)):
   req=Request(self.base+'/api/upload/terrain',data=b'<html>error</html>',headers={'X-LunaShift-Token':self.ws.token,'Content-Type':'application/octet-stream'})
   with self.assertRaises(HTTPError) as e:urlopen(req)
   self.assertEqual(e.exception.code,400);self.assertEqual(list(Path(tmp).rglob('*.tif')),[])
 def test_no_filesystem_key_traversal(self):
  with self.assertRaises(HTTPError) as e:self.req('/api/terrain',{'upload_key':'../../x','frame_confirmed':True,'source':'test'})
  self.assertEqual(e.exception.code,400)
 def test_hardware_survives_export(self):
  self.req('/api/settings',{'ui_state':{'hardware':{'panel_area_m2':9}}});self.assertEqual(self.req('/api/export')['ui_state']['hardware']['panel_area_m2'],9)
