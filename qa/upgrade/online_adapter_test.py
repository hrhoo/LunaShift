from pathlib import Path
import sys,unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
import online_horizons as h
class AdapterTests(unittest.TestCase):
 def test_equipment_heights(self):
  calls=[]
  def query(site,target,start,stop,step):
   calls.append((target,site['ground_elevation_m']))
   return ([{'time_utc':'2026-11-08T00:00:00Z','azimuth_deg':10,'elevation_deg':2},{'time_utc':'2026-11-08T01:00:00Z','azimuth_deg':11,'elevation_deg':3}],'https://ssd.jpl.nasa.gov/test')
  with patch.object(h,'_query',query):
   rows,meta=h.fetch_tracks({'latitude_deg':-89,'longitude_deg':20,'ground_elevation_m':123},'2026-11-08T00:00:00Z',collector_height_m=10,antenna_height_m=3)
  self.assertEqual(calls,[(10,133),(399,126)]);self.assertEqual(len(rows),2);self.assertEqual(meta['collector_height_m'],10)
 def test_invalid_coordinate(self):
  with self.assertRaises(ValueError):h.fetch_tracks({'latitude_deg':-100,'longitude_deg':20},'2026-11-08T00:00:00Z')
 def test_nonfinite(self):
  with self.assertRaises(ValueError):h.fetch_tracks({'latitude_deg':float('nan'),'longitude_deg':20},'2026-11-08T00:00:00Z')
 def test_invalid_height(self):
  with self.assertRaises(ValueError):h.fetch_tracks({'latitude_deg':-89,'longitude_deg':20},'2026-11-08T00:00:00Z',collector_height_m=-1)
 def test_naive_timestamp_is_utc(self):self.assertEqual(h._iso(h._utc('2026-11-08T00:00:00')),'2026-11-08T00:00:00Z')
 def test_parser_rejects_nonfinite(self):
  with self.assertRaises(ValueError):h._parse('$$SOE\n2026-Nov-08 00:00:00,inf,2\n2026-Nov-08 01:00:00,1,2\n$$EOE')
 def test_parser_real_format(self):
  rows=h._parse('$$SOE\n2026-Nov-08 00:00:00, , , 122.4, -3.5,\n2026-Nov-08 01:00:00, , ,123.1,-3.6,\n$$EOE')
  self.assertEqual(rows[0]['azimuth_deg'],122.4);self.assertEqual(rows[1]['elevation_deg'],-3.6)
if __name__=='__main__':unittest.main()
