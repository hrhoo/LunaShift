import unittest,copy,math,json
from datetime import timedelta
from lunashift.mission import *
from lunashift.core import utc,iso
from lunashift.data import demo_project,validate_track,validate_ui_state

def site(sun=30,earth=5,duration=24,step=60,sky=0):
    start=utc('2026-11-01T00:00:00Z')
    return {'id':'T','name':'Analytic test fixture, not Moon data','latitude_deg':-89,'longitude_deg':0,
      'ground_elevation_m':0,'slope_deg':0,'track_mode':'imported','track_max_gap_min':step,'track_synthetic':True,
      'terrain':{'kind':'horizon','azimuth_deg':list(range(0,360,10)),'horizon_deg':[sky]*36,'observer_height_m':2,'synthetic':True,'source':'Test fixture'},
      'ephemeris':[{'time_utc':iso(start+timedelta(minutes=i*step)),'sun_azimuth_deg':90,'sun_elevation_deg':sun,
      'earth_azimuth_deg':0,'earth_elevation_deg':earth,'sun_distance_km':AU_KM,'earth_distance_km':384400} for i in range(int(duration*60/step)+1)]}

def settings(duration=24,step=60):return validate_params({'duration_h':duration,'step_min':step,'height_m':2,'min_sun_pct':0,'max_dark_h':1440,'max_earth_gap_h':1440})
def zero_load(**kw):return hardware(dict(base_load_w=0,heater_load_w=0,science_load_w=0,science_rate_kbps=0,required_data_gb=0,**kw))

class Solar(unittest.TestCase):
 def test_half_disc(self):self.assertAlmostEqual(disc_fraction(0),.5)
 def test_full_disc(self):self.assertEqual(disc_fraction(1),1)
 def test_hidden_disc(self):self.assertEqual(disc_fraction(-1),0)
 def test_disc_symmetry(self):self.assertAlmostEqual(disc_fraction(.1)+disc_fraction(-.1),1)
 def test_horizontal_cosine(self):self.assertAlmostEqual(incidence(90,30,hardware({'panel_mode':'horizontal'})),.5)
 def test_vertical_normal(self):self.assertAlmostEqual(incidence(90,0,hardware({'panel_mode':'fixed','panel_tilt_deg':90,'panel_azimuth_deg':90})),1)
 def test_fixed_backside(self):self.assertEqual(incidence(270,0,hardware({'panel_mode':'fixed','panel_tilt_deg':90,'panel_azimuth_deg':90})),0)
 def test_area_doubles_power(self):
  t=site()['ephemeris'][0];a=solar_sample(t,0,hardware())[0];b=solar_sample(t,0,hardware({'panel_area_m2':8}))[0];self.assertAlmostEqual(b,2*a)
 def test_inverse_square(self):
  t=site()['ephemeris'][0];a=solar_sample(t,0,hardware())[0];t['sun_distance_km']*=2;self.assertAlmostEqual(solar_sample(t,0,hardware())[0],a/4)
 def test_energy_integration(self):
  s=site();h=zero_load();r=simulate(s,settings(),h);expected=1361*4*.28*.9*.95*24/1000;self.assertAlmostEqual(r['metrics']['harvested_kwh'],expected)
 def test_shade_no_sun(self):self.assertEqual(simulate(site(sun=-5),settings(),zero_load())['metrics']['harvested_kwh'],0)
 def test_smooth_night_not_terrain_loss(self):self.assertEqual(simulate(site(sun=-5),settings(),zero_load())['metrics']['terrain_loss_kwh'],0)
 def test_actual_terrain_loss(self):self.assertGreater(simulate(site(sun=2,sky=5),settings(),zero_load())['metrics']['terrain_loss_kwh'],20)

class Battery(unittest.TestCase):
 def test_night_discharge(self):
  r=simulate(site(sun=-5),settings(),zero_load(base_load_w=100) if False else hardware({'base_load_w':100,'heater_load_w':0,'science_load_w':0,'science_rate_kbps':0,'required_data_gb':0,'battery_kwh':10,'initial_soc_pct':100,'discharge_efficiency':1}))
  self.assertAlmostEqual(r['metrics']['final_soc_pct'],76)
 def test_discharge_efficiency(self):
  r=simulate(site(sun=-5),settings(),hardware({'base_load_w':100,'heater_load_w':0,'science_load_w':0,'science_rate_kbps':0,'required_data_gb':0,'battery_kwh':10,'initial_soc_pct':100,'discharge_efficiency':.8}))
  self.assertAlmostEqual(r['metrics']['final_soc_pct'],70)
 def test_no_negative_charge(self):
  r=simulate(site(sun=-5),settings(),hardware({'battery_kwh':.1,'base_load_w':1000}));self.assertGreaterEqual(r['metrics']['min_soc_pct'],0);self.assertGreater(r['metrics']['unmet_survival_kwh'],0)
 def test_no_overcharge(self):self.assertLessEqual(simulate(site(),settings(),zero_load())['metrics']['final_soc_pct'],100)
 def test_energy_conservation_day(self):
  h=hardware();r=simulate(site(),settings(),h)['metrics'];a=h['battery_kwh']*h['initial_soc_pct']/100+r['harvested_kwh'];b=h['battery_kwh']*r['final_soc_pct']/100+r['load_served_kwh']+r['spilled_kwh']+r['charging_loss_kwh']+r['discharging_loss_kwh'];self.assertAlmostEqual(a,b,9)
 def test_energy_conservation_night(self):
  h=hardware();r=simulate(site(sun=-5),settings(),h)['metrics'];a=h['battery_kwh']*h['initial_soc_pct']/100+r['harvested_kwh'];b=h['battery_kwh']*r['final_soc_pct']/100+r['load_served_kwh']+r['spilled_kwh']+r['charging_loss_kwh']+r['discharging_loss_kwh'];self.assertAlmostEqual(a,b,9)
 def test_total_storage_accounting(self):
  h=hardware();r=simulate(site(),settings(),h)['metrics'];self.assertAlmostEqual(h['initial_data_gb']+r['generated_gb'],r['remaining_gb']+r['returned_gb']+r['overflow_gb'],10)
 def test_charge_power_limit(self):
  h=zero_load(initial_soc_pct=0,max_charge_w=100);r=simulate(site(),settings(),h)['metrics'];self.assertAlmostEqual(r['final_soc_pct'],100*(.1*24*.95)/8)
 def test_discharge_limit_unserved(self):
  h=hardware({'max_discharge_w':1});r=simulate(site(sun=-5),settings(),h)['metrics'];self.assertGreater(r['unmet_survival_kwh'],1)
 def test_no_energy_no_downlink(self):
  h=hardware({'initial_soc_pct':0,'initial_data_gb':1});r=simulate(site(sun=-5),settings(),h);self.assertEqual(r['metrics']['returned_gb'],0)

class Radio(unittest.TestCase):
 def test_fspl_known(self):
  r=radio_sample(site()['ephemeris'][0],0,hardware());expect=20*math.log10(4*math.pi*384400e3/(299792458/8.4e9));self.assertAlmostEqual(r['fspl_db'],expect)
 def test_power_doubling_3db(self):
  t=site()['ephemeris'][0];a=radio_sample(t,0,hardware());b=radio_sample(t,0,hardware({'transmit_power_w':20}));self.assertAlmostEqual(b['requested_margin_db']-a['requested_margin_db'],10*math.log10(2))
 def test_range_doubling_6db(self):
  t=site()['ephemeris'][0];a=radio_sample(t,0,hardware());t['earth_distance_km']*=2;b=radio_sample(t,0,hardware());self.assertAlmostEqual(a['requested_margin_db']-b['requested_margin_db'],20*math.log10(2))
 def test_noise_doubling_3db(self):
  t=site()['ephemeris'][0];a=radio_sample(t,0,hardware());b=radio_sample(t,0,hardware({'system_temperature_k':160}));self.assertAlmostEqual(a['cn0_dbhz']-b['cn0_dbhz'],10*math.log10(2))
 def test_blocked_rate_zero(self):self.assertEqual(radio_sample(site(earth=-1)['ephemeris'][0],0,hardware())['rate_bps'],0)
 def test_bandwidth_cap(self):self.assertLessEqual(radio_sample(site()['ephemeris'][0],0,hardware({'bandwidth_mhz':.1}))['rate_bps'],1e5)
 def test_no_station_claim(self):self.assertIn('no specific station',simulate(site(),settings())['provenance']['radio_geometry'])
 def test_no_visible_margin(self):self.assertIsNone(simulate(site(earth=-10),settings())['metrics']['best_margin_db'])
 def test_reserve_protected_by_transmission(self):
  h=hardware({'initial_soc_pct':20,'base_load_w':0,'heater_load_w':0,'science_load_w':0,'initial_data_gb':1});r=simulate(site(sun=-5),settings(),h);self.assertEqual(r['metrics']['returned_gb'],0);self.assertAlmostEqual(r['metrics']['min_soc_pct'],20)

class Validation(unittest.TestCase):
 def test_bad_efficiency(self):
  with self.assertRaises(ValueError):hardware({'charge_efficiency':0})
 def test_no_nan(self):
  with self.assertRaises(ValueError):hardware({'battery_kwh':float('nan')})
 def test_bad_mode(self):
  with self.assertRaises(ValueError):hardware({'panel_mode':'magic'})
 def test_electrically_small_dish_rejected(self):
  with self.assertRaises(ValueError):hardware({'frequency_ghz':.1,'tx_diameter_m':.01})
 def test_missing_data_stays_unknown(self):
  p=demo_project();p['sites'][0]['terrain']=None;r=mission_analyze(p,{});self.assertEqual(r['results'][0]['status'],'unknown')
 def test_hardware_saved(self):
  p=demo_project();s=validate_ui_state({'hardware':{'panel_area_m2':10}},p['sites']);self.assertEqual(s['hardware']['panel_area_m2'],10)
 def test_optional_ranges_survive(self):
  r=validate_track(site()['ephemeris']);self.assertEqual(r[0]['earth_distance_km'],384400)
 def test_model_outputs_json_safe(self):json.dumps(simulate(site(),settings()),allow_nan=False)
 def test_real_ranges_labelled(self):self.assertEqual(simulate(site(),settings())['provenance']['distances'],'Ephemeris ranges')
 def test_synthetic_flag_preserved(self):self.assertTrue(simulate(site(),settings())['provenance']['synthetic_environment'])
 def test_repair_has_no_global_optimum_claim(self):
  p=demo_project();r=mission_repair(p,{'duration_h':24,'step_min':60,'allow_move':False,'allow_panel':False,'allow_battery':False,'allow_delay':False});self.assertEqual(r['tested'],1);self.assertIn('Not a global optimum',r['search_note'])

if __name__=='__main__':unittest.main()
