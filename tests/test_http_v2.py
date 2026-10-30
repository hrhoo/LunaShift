import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from run import Workspace,make_handler

class HTTPV2Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ws=Workspace();cls.http=ThreadingHTTPServer(('127.0.0.1',0),make_handler(cls.ws))
        cls.thread=threading.Thread(target=cls.http.serve_forever,daemon=True);cls.thread.start()
        cls.base='http://127.0.0.1:'+str(cls.http.server_port)
    @classmethod
    def tearDownClass(cls):cls.http.shutdown();cls.http.server_close();cls.thread.join()
    def request(self,path,body=None):
        return urlopen(Request(self.base+path,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json','X-LunaShift-Token':self.ws.token}),timeout=10)
    def test_health_identifies_version(self):
        with self.request('/api/health') as r:self.assertEqual(json.load(r)['version'],'0.5.0')
    def test_state_exposes_storage_scope(self):
        with self.request('/api/state') as r:self.assertIn('temporary_runtime',json.load(r)['storage'])
    def test_settings_persist_in_export(self):
        with self.request('/api/settings',{'ui_state':{'selected_site_id':'C','fields':{'duration':'48'}}}) as r:self.assertTrue(json.load(r)['ok'])
        with self.request('/api/export') as r:self.assertEqual(json.load(r)['ui_state']['fields']['duration'],'48')
    def test_static_assets_have_correct_types(self):
        for path,mime in [('/styles.css','text/css'),('/app.js','javascript')]:
            with self.request(path) as r:self.assertIn(mime,r.headers['Content-Type'])
    def test_manual_and_guides_load(self):
        for path in ['/docs/manual.html','/docs/TEAM_GUIDE.md','/docs/DATA_FORMATS.md']:
            with self.request(path) as r:self.assertEqual(r.status,200)
    def test_local_server_denies_embedding(self):
        with self.request('/') as r:self.assertEqual(r.headers['X-Frame-Options'],'DENY')
    def test_colab_server_allows_proxy_host_and_embedding(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),make_handler(Workspace(),allow_proxy=True))
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            req=Request('http://127.0.0.1:'+str(server.server_port)+'/api/health',headers={'Host':'example.colab.googleusercontent.com'})
            with urlopen(req,timeout=10) as r:
                self.assertEqual(r.status,200);self.assertIsNone(r.headers.get('X-Frame-Options'))
                self.assertNotIn("frame-ancestors 'none'",r.headers['Content-Security-Policy'])
        finally:server.shutdown();server.server_close();thread.join()
