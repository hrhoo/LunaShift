import unittest,math,tempfile,json
from unittest.mock import patch
from lunashift.remote import allowed_url,parse_capabilities,tile
from lunashift.horizons import parse_observer,build_query
from tools.export_spice import local_angles
XML=b'''<Capabilities xmlns="http://www.opengis.net/wmts/1.0" xmlns:ows="http://www.opengis.net/ows/1.1"><Contents><Layer><ows:Identifier>MoonTest</ows:Identifier><Style isDefault="true"><ows:Identifier>default</ows:Identifier></Style><TileMatrixSetLink><TileMatrixSet>moon</TileMatrixSet></TileMatrixSetLink><ResourceURL resourceType="tile" template="https://trek.nasa.gov/tiles/Moon/SP/test/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png"/></Layer><TileMatrixSet><ows:Identifier>moon</ows:Identifier><ows:SupportedCRS>MOON_TEST</ows:SupportedCRS><TileMatrix><ows:Identifier>L0</ows:Identifier><ScaleDenominator>1000000</ScaleDenominator><TopLeftCorner>-1000 1000</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>2</MatrixWidth><MatrixHeight>2</MatrixHeight></TileMatrix></TileMatrixSet></Contents></Capabilities>'''
class SourceTests(unittest.TestCase):
 def test_allowed(self):self.assertTrue(allowed_url('https://trek.nasa.gov/tiles/Moon/x'))
 def test_bad_urls(self):
  for u in ['http://trek.nasa.gov/tiles/x','https://evil.com/x','file:///etc/passwd','https://user@trek.nasa.gov/tiles/x','https://trek.nasa.gov/a','https://trek.nasa.gov/tiles/../x']:
   self.assertFalse(allowed_url(u),u)
 def test_capabilities(self):
  c=parse_capabilities(XML,'sp');self.assertEqual(c['matrices'][0]['id'],'L0');self.assertEqual(c['matrices'][0]['top_left'],[-1000,1000]);self.assertEqual(c['projection'],'sp')
 def test_reject_xml_entity(self):
  with self.assertRaises(ValueError):parse_capabilities(b'<!DOCTYPE test>'+XML)
 def test_reject_empty_xml(self):
  with self.assertRaises(ValueError):parse_capabilities(b'<Capabilities/>')
 def test_reject_tile_host(self):
  with self.assertRaises(ValueError):parse_capabilities(XML.replace(b'https://trek.nasa.gov',b'https://evil.com'))
 def test_matrix_bounds(self):
  with patch('lunashift.remote.capabilities',return_value=parse_capabilities(XML)):
   for args in [(0,3,0),(3,0,0),(0,0,-1)]:
    with self.assertRaises(ValueError):tile('imagery',*args,'unused')
 def test_extended_horizons(self):
  rows=parse_observer('$$SOE\n2026-Nov-01 00:00:00, , , 30, 5, 1900, 149000000, 0,\n2026-Nov-01 01:00:00, , ,31,6,1901,148000000,1,\n$$EOE')
  self.assertEqual(rows[0]['distance_km'],149000000);self.assertEqual(rows[1]['angular_diameter_arcsec'],1901)
 def test_old_horizons(self):
  rows=parse_observer('$$SOE\n2026-Nov-01 00:00, , ,30,5,\n2026-Nov-01 01:00, , ,31,6,\n$$EOE');self.assertNotIn('distance_km',rows[0])
 def test_local_north(self):
  az,el,d=local_angles([0,0,2],0,0);self.assertAlmostEqual(az,0);self.assertAlmostEqual(el,0);self.assertAlmostEqual(d,2)
 def test_local_east(self):self.assertAlmostEqual(local_angles([0,1,0],0,0)[0],90)
 def test_local_up(self):self.assertAlmostEqual(local_angles([1,0,0],0,0)[1],90)
 def test_zero_vector(self):
  with self.assertRaises(ValueError):local_angles([0,0,0],-89,0)
 def test_spice_south_pole_up(self):self.assertAlmostEqual(local_angles([0,0,-1],-90,37)[1],90)
