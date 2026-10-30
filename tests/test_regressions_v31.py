"""Regression tests for the screenshots reported by the user.
XML and image payloads here are deliberately synthetic test fixtures, not NASA data.
"""
import json,unittest,tempfile,threading
from pathlib import Path
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor
from urllib.error import URLError
from urllib.request import Request,urlopen
from http.server import ThreadingHTTPServer
from lunashift.remote import integer_dimension,parse_capabilities,get_bytes,tile,atomic_write
from test_sources_v3 import XML
import run

class MapRegressionTests(unittest.TestCase):
    def test_decimal_matrix_width_and_height(self):
        raw=XML.replace(b'<MatrixWidth>2<',b'<MatrixWidth>2.0<').replace(b'<MatrixHeight>2<',b'<MatrixHeight>2.0<')
        c=parse_capabilities(raw,'sp');self.assertEqual(c['matrices'][0]['width'],2);self.assertIsInstance(c['matrices'][0]['height'],int)
    def test_decimal_tile_dimensions(self):
        raw=XML.replace(b'>256<',b'>256.0<')
        self.assertEqual(parse_capabilities(raw)['matrices'][0]['tile_width'],256)
    def test_exponential_whole_dimensions(self):self.assertEqual(integer_dimension('2E3','width'),2000)
    def test_fraction_not_truncated(self):
        with self.assertRaisesRegex(ValueError,'positive whole'):integer_dimension('2.9','width')
    def test_zero_not_accepted(self):
        with self.assertRaises(ValueError):integer_dimension('0','width')
    def test_negative_not_accepted(self):
        with self.assertRaises(ValueError):integer_dimension('-1','width')
    def test_nonfinite_not_accepted(self):
        for value in ['NaN','Infinity','-Infinity']:
            with self.assertRaises(ValueError):integer_dimension(value,'width')
    def test_missing_dimension_has_human_error(self):
        with self.assertRaisesRegex(ValueError,'WMTS'):integer_dimension(None,'TileWidth')
    def test_huge_dimension_not_accepted(self):
        with self.assertRaises(ValueError):integer_dimension('1e300','width')
    def test_matrix_id_is_preserved(self):
        c=parse_capabilities(XML.replace(b'>L0<',b'>0.0<'))
        self.assertEqual(c['matrices'][0]['id'],'0.0')
    def test_matrix_id_used_in_tile_url(self):
        c=parse_capabilities(XML.replace(b'>L0<',b'>0.0<'))
        with patch('lunashift.remote.capabilities',return_value=c),patch('lunashift.remote.get_bytes',return_value=(b'PNG-FIXTURE','image/png')) as get:
            tile('imagery',0,1,1,'unused')
        self.assertIn('/0.0/1/1.png',get.call_args.args[0])
    def test_scale_must_be_finite(self):
        with self.assertRaises(ValueError):parse_capabilities(XML.replace(b'>1000000<',b'>NaN<'))
    def test_default_style_is_selected(self):
        raw=XML.replace(b'<Style isDefault="true">',b'<Style><ows:Identifier>not-default</ows:Identifier></Style><Style isDefault="true">')
        self.assertEqual(parse_capabilities(raw)['style'],'default')
    def test_oversize_tile_height_rejected(self):
        with self.assertRaises(ValueError):parse_capabilities(XML.replace(b'<TileHeight>256<',b'<TileHeight>5000<'))
    def test_map_failure_is_not_fabricated_data(self):
        with tempfile.TemporaryDirectory() as t,patch('lunashift.remote.urlopen',side_effect=URLError('test network offline')):
            with self.assertRaisesRegex(ValueError,'No replacement data'):get_bytes('https://trek.nasa.gov/tiles/test',t)
            self.assertEqual(list(Path(t).glob('*.bin')),[])
    def test_concurrent_cache_writes_are_atomic(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'a.bin';values=[b'A'*100000,b'B'*100000]*8
            with ThreadPoolExecutor(max_workers=4) as executor:list(executor.map(lambda value:atomic_write(p,value),values))
            self.assertIn(p.read_bytes(),values);self.assertEqual(list(Path(d).glob('*.tmp')),[])
    def test_corrupted_cache_metadata_does_not_crash(self):
        import hashlib
        url='https://trek.nasa.gov/tiles/test';key=hashlib.sha256(url.encode()).hexdigest()
        with tempfile.TemporaryDirectory() as d:
            (Path(d)/(key+'.bin')).write_bytes(b'old');(Path(d)/(key+'.json')).write_text('{invalid')
            with patch('lunashift.remote.urlopen',side_effect=URLError('offline')):
                with self.assertRaisesRegex(ValueError,'NASA source'):get_bytes(url,d)

class HTTPReliabilityTests(unittest.TestCase):
    def setUp(self):
        self.ws=run.Workspace();self.server=ThreadingHTTPServer(('127.0.0.1',0),run.make_handler(self.ws));self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start();self.url='http://127.0.0.1:'+str(self.server.server_port)
    def tearDown(self):self.server.shutdown();self.server.server_close();self.thread.join()
    def test_latest_health_version(self):
        with urlopen(self.url+'/api/health') as response:self.assertEqual(json.load(response)['version'],'0.5.0')
    def test_sky_assets_served(self):
        for name in ['sky.js','sky.css','v4.js','v4.css']:
            with urlopen(self.url+'/'+name) as response:self.assertEqual(response.status,200)
    def test_reference_video_permitted_by_csp(self):
        with urlopen(self.url) as r:self.assertIn("media-src 'self' https://svs.gsfc.nasa.gov",r.headers['Content-Security-Policy'])
    def test_diagnostics_do_not_mutate_workspace(self):
        before=self.ws.snapshot()
        with patch.object(run,'connection_report',return_value={'checks':[{'error':'fixture offline'}]}):
            with urlopen(self.url+'/api/diagnostics') as response:self.assertIn('error',json.load(response)['checks'][0])
        self.assertEqual(self.ws.snapshot(),before)
