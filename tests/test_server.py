import json
import threading
import unittest
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer
from run import Workspace,make_handler

class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ws=Workspace();cls.server=ThreadingHTTPServer(('127.0.0.1',0),make_handler(cls.ws))
        cls.base='http://127.0.0.1:'+str(cls.server.server_port)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
    @classmethod
    def tearDownClass(cls):cls.server.shutdown();cls.server.server_close();cls.thread.join()
    def request(self,path,body=None,token=True):
        headers={'Content-Type':'application/json'}
        if token:headers['X-LunaShift-Token']=self.ws.token
        req=Request(self.base+path,data=None if body is None else json.dumps(body).encode(),headers=headers)
        return urlopen(req,timeout=10)
    def test_home_loads(self):
        with self.request('/') as r:self.assertIn(b'LunaShift',r.read())
    def test_state_and_token(self):
        with self.request('/api/state') as r:self.assertEqual(json.load(r)['token'],self.ws.token)
    def test_analyze_endpoint(self):
        with self.request('/api/analyze',{}) as r:self.assertEqual(len(json.load(r)['results']),4)
    def test_repair_endpoint(self):
        with self.request('/api/repair',{'preferred_site_id':'A'}) as r:self.assertIsNotNone(json.load(r)['best'])
    def test_missing_token_rejected(self):
        with self.assertRaises(HTTPError) as ctx:self.request('/api/reset',{},token=False)
        self.assertEqual(ctx.exception.code,403)
    def test_invalid_import_is_atomic(self):
        with self.assertRaises(HTTPError):self.request('/api/import',{'kind':'project','project':{}})
        self.assertEqual(len(self.ws.snapshot()['sites']),4)
    def test_export(self):
        with self.request('/api/export') as r:self.assertEqual(json.load(r)['schema_version'],1)
    def test_path_traversal_rejected(self):
        with self.assertRaises(HTTPError):self.request('/docs/../../run.py')

if __name__=='__main__':unittest.main()
