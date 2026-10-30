import copy
import math
import unittest
from datetime import timedelta
from lunashift.core import *
from lunashift.data import demo_project, validate_project, apply_csv, validate_track
from lunashift.horizons import parse_observer, build_query

class GeometryTests(unittest.TestCase):
    def test_destination_distance(self):
        a={'latitude_deg':-89.5,'longitude_deg':35}
        lat,lon=destination(-89.5,35,117,1234)
        self.assertAlmostEqual(distance_between(a,{'latitude_deg':lat,'longitude_deg':lon}),1234,places=4)
    def test_zero_local_projection(self):
        x,y=local_xy(-89.5,35,-89.5,35)
        self.assertAlmostEqual(x,0,places=5);self.assertAlmostEqual(y,0,places=5)
    def test_azimuth_wrap(self):
        self.assertAlmostEqual(periodic_interp([0,90,180,270],[0,10,20,10],315),5)
        self.assertAlmostEqual(periodic_interp([10,100,190,280],[0,10,20,10],355),1.6666666667)
    def test_raise_height_lowers_or_preserves_horizon(self):
        s=demo_project()['sites'][0]
        a=horizon(s,1);b=horizon(s,10)
        self.assertTrue(all(x>=y-1e-12 for x,y in zip(a['horizon_deg'],b['horizon_deg'])))
    def test_curvature_formula(self):
        d=1000;z=100;h=2;rad=R_MOON
        s={'id':'X','name':'test','latitude_deg':-89,'longitude_deg':0,'ground_elevation_m':0,
           'terrain':{'kind':'rays','azimuth_deg':[0,90,180,270],'distances_m':[d],
                      'elevations_m':[[z]]*4,'radius_m':rad}}
        expected=math.degrees(math.atan2((rad+z)*math.cos(d/rad)-(rad+h),(rad+z)*math.sin(d/rad)))
        self.assertAlmostEqual(horizon(s,h)['horizon_deg'][0],expected)
    def test_recompute_all_blockers_after_height_change(self):
        s={'id':'X','name':'test','latitude_deg':-89,'longitude_deg':0,'ground_elevation_m':0,
           'terrain':{'kind':'rays','azimuth_deg':[0,90,180,270],'distances_m':[100,1000],
                      'elevations_m':[[4,30]]*4}}
        self.assertEqual(horizon(s,0)['blockers'][0]['distance_m'],100)
        self.assertEqual(horizon(s,5)['blockers'][0]['distance_m'],1000)
    def test_fixed_horizon_height_not_silently_changed(self):
        s={'id':'X','name':'test','terrain':{'kind':'horizon','azimuth_deg':[0,90,180,270],
             'horizon_deg':[0,0,0,0],'observer_height_m':2}}
        with self.assertRaises(ValueError):horizon(s,5)
    def test_nonfinite_number_rejected(self):
        for x in [float('nan'),float('inf'),'x']:
            with self.assertRaises(ValueError):number(x,'test')

class TimeTests(unittest.TestCase):
    def test_time_zone(self):
        self.assertEqual(iso(utc('2026-11-01T03:00:00+03:00')),'2026-11-01T00:00:00Z')
    def test_exact_endpoint_no_double_count(self):
        ts=grid_times(utc('2026-11-01'),1.25,60)
        self.assertEqual(len(ts),3)
        self.assertEqual((ts[-1]-ts[0]).total_seconds(),4500)
    def test_interpolated_rise(self):
        self.assertEqual(positive_intervals([0,1],[-1,1]),[[.5,1]])
    def test_interpolated_set(self):
        self.assertEqual(positive_intervals([0,1],[1,-1]),[[0,.5]])
    def test_all_positive_merge(self):
        self.assertEqual(positive_intervals([0,1,2],[1,1,1]),[[0,2]])
    def test_no_endpoint_duration(self):
        self.assertEqual(positive_intervals([0,1,2],[0,0,0]),[])
    def test_complement(self):
        self.assertEqual(complement([[1,2],[3,4]],5),[[0,1],[2,3],[4,5]])
    def test_intersection(self):
        self.assertEqual(intersection([[0,3],[5,8]],[[2,6]]),[[2,3],[5,6]])
    def test_no_ephemeris_extrapolation(self):
        s={'name':'x','track_mode':'imported','ephemeris':[
            {'time_utc':'2026-11-01T00:00:00Z','sun_azimuth_deg':0,'sun_elevation_deg':1,'earth_azimuth_deg':0,'earth_elevation_deg':1},
            {'time_utc':'2026-11-01T01:00:00Z','sun_azimuth_deg':0,'sun_elevation_deg':1,'earth_azimuth_deg':0,'earth_elevation_deg':1}]}
        with self.assertRaises(ValueError):track_at(s,[utc('2026-10-31')])
    def test_ephemeris_circular_interpolation(self):
        s={'name':'x','track_mode':'imported','ephemeris':[
            {'time_utc':'2026-11-01T00:00:00Z','sun_azimuth_deg':359,'sun_elevation_deg':1,'earth_azimuth_deg':359,'earth_elevation_deg':1},
            {'time_utc':'2026-11-01T01:00:00Z','sun_azimuth_deg':1,'sun_elevation_deg':3,'earth_azimuth_deg':1,'earth_elevation_deg':3}]}
        row=track_at(s,[utc('2026-11-01T00:30:00Z')])[0]
        self.assertAlmostEqual(row['sun_azimuth_deg'],0);self.assertEqual(row['sun_elevation_deg'],2)
    def test_gap_rejection(self):
        s={'name':'x','track_mode':'imported','track_max_gap_min':30,'ephemeris':[
            {'time_utc':'2026-11-01T00:00:00Z'},{'time_utc':'2026-11-01T01:00:00Z'}]}
        with self.assertRaises(ValueError):track_at(s,[utc('2026-11-01T00:30:00Z')])

class ProjectTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.p=demo_project()
    def test_demo_validates(self):self.assertEqual(len(validate_project(self.p)['sites']),4)
    def test_frame_rejection(self):
        p=copy.deepcopy(self.p);p['coordinate_frame']='WGS84'
        with self.assertRaises(ValueError):validate_project(p)
    def test_duplicate_ids_rejected(self):
        p=copy.deepcopy(self.p);p['sites'][1]['id']='A'
        with self.assertRaises(ValueError):validate_project(p)
    def test_initial_demo_has_fail_and_pass(self):
        r=analyze(self.p,{})['results'];self.assertEqual(r[0]['status'],'fail');self.assertEqual(r[1]['status'],'pass')
    def test_unknown_terrain(self):
        p=copy.deepcopy(self.p);p['sites'][0]['terrain']=None
        self.assertEqual(analyze(p,{})['results'][0]['status'],'unknown')
    def test_unknown_slope(self):
        p=copy.deepcopy(self.p);p['sites'][1]['slope_deg']=None
        self.assertEqual(analyze(p,{})['results'][1]['status'],'unknown')
    def test_disable_slope_is_explicit(self):
        p=copy.deepcopy(self.p);p['sites'][1]['slope_deg']=None
        self.assertEqual(analyze(p,{'check_slope':False})['results'][1]['status'],'pass')
    def test_slope_layer_changes_decision(self):
        p=apply_csv(self.p,'B','attributes','site_id,slope_deg\nB,80\n','Synthetic slope test')
        self.assertEqual(analyze(p,{})['results'][1]['status'],'fail')
    def test_repair_enumeration(self):
        r=repair(self.p,{'preferred_site_id':'A'})
        self.assertEqual(r['tested_combinations'],4*7*3)
        self.assertIsNotNone(r['best']);self.assertGreater(r['best']['cost'],0)
        self.assertEqual(r['best']['cost'],min(x['cost'] for x in r['alternatives']))
    def test_zero_cost_when_start_passes(self):
        r=repair(self.p,{'preferred_site_id':'B'})
        self.assertEqual(r['best']['cost'],0)
    def test_impossible_constraints_no_fake_repair(self):
        r=repair(self.p,{'preferred_site_id':'A','max_slope_deg':0})
        self.assertIsNone(r['best'])
    def test_bad_horizon_leaves_original_unchanged(self):
        with self.assertRaises(ValueError):apply_csv(self.p,'A','horizon','wrong,x\n1,2\n','test')
        self.assertEqual(self.p['sites'][0]['terrain']['kind'],'rays')
    def test_duplicate_times_rejected(self):
        r={'time_utc':'2026-11-01T00:00:00Z','sun_azimuth_deg':0,'sun_elevation_deg':0,'earth_azimuth_deg':0,'earth_elevation_deg':0}
        with self.assertRaises(ValueError):validate_track([r,r])

class HorizonsTests(unittest.TestCase):
    # Constructed fixtures; deliberately NOT presented as a live NASA download.
    def test_parse_quantity4(self):
        text='Header\n$$SOE\n 2026-Nov-01 00:00:00, , , 12.300000, -1.200000,\n 2026-Nov-01 01:00:00,*,i,13.00000, 0.500000,\n$$EOE'
        r=parse_observer(text)
        self.assertEqual(r[0]['azimuth_deg'],12.3)
        self.assertEqual(r[0]['time_utc'],'2026-11-01T00:00:00Z')
    def test_api_error_rejected(self):
        with self.assertRaises(ValueError):parse_observer('No ephemeris available')
    def test_unavailable_angle_rejected(self):
        with self.assertRaises(ValueError):parse_observer('$$SOE\n2026-Nov-01 00:00:00,,, n.a., n.a.,\n$$EOE')
    def test_query_units_and_ids(self):
        site={'longitude_deg':35,'latitude_deg':-89.5,'ground_elevation_m':1200}
        q=build_query(site,10,'2026-11-01','2026-11-02',60)
        self.assertEqual(q['CENTER'],'coord@301');self.assertTrue(q['SITE_COORD'].endswith('1.200000000'))
        self.assertEqual(q['APPARENT'],'AIRLESS');self.assertEqual(q['TIME_TYPE'],'UT')

if __name__=='__main__':unittest.main()
