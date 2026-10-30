"""Transparent sampled solar/battery/RF engineering screening. No trained model.

Geometry comes from the existing terrain+ephemeris engine. Hardware values are
explicit assumptions, NOT measured lander specifications. RF is an Earth-centre
line-of-sight screening model, NOT access to an allocated ground station.
"""
from __future__ import annotations
import math, copy
from .core import number, evaluate, validate_params, horizon, distance_between, utc, iso
from datetime import timedelta

DEFAULT_HARDWARE = {
 'panel_area_m2':4.0, 'panel_efficiency':0.28, 'panel_mode':'tracking',
 'panel_tilt_deg':90.0,'panel_azimuth_deg':0.0,'solar_irradiance_wm2':1361.0,
 'electrical_efficiency':0.90,'contamination_factor':0.95,
 'panel_temperature_k':298.15,'temperature_coefficient_per_k':-0.002,
 'battery_kwh':8.0,'initial_soc_pct':90.0,'reserve_soc_pct':20.0,
 'charge_efficiency':0.95,'discharge_efficiency':0.95,
 'max_charge_w':5000.0,'max_discharge_w':5000.0,
 'base_load_w':60.0,'heater_load_w':20.0,'science_load_w':15.0,
 'science_rate_kbps':8.0,'initial_data_gb':0.0,'storage_gb':10.0,'required_data_gb':0.05,
 'frequency_ghz':8.4,'transmit_power_w':10.0,'amplifier_efficiency':0.35,
 'radio_electronics_w':15.0,'tx_diameter_m':0.30,'tx_aperture_efficiency':0.55,
 'rx_diameter_m':12.0,'rx_aperture_efficiency':0.55,'system_temperature_k':80.0,
 'other_losses_db':3.0,'required_ebn0_db':6.0,'design_margin_db':3.0,
 'requested_rate_mbps':1.0,'bandwidth_mhz':1.0,'spectral_efficiency':1.0,
 'earth_clearance_deg':0.25,'fallback_range_km':384400.0,
}
RANGES={
 'panel_area_m2':(0,1000),'panel_efficiency':(.01,1),'panel_tilt_deg':(0,180),'panel_azimuth_deg':(0,360),
 'solar_irradiance_wm2':(1000,1500),'electrical_efficiency':(.01,1),'contamination_factor':(0,1),
 'panel_temperature_k':(100,500),'temperature_coefficient_per_k':(-.02,.005),
 'battery_kwh':(.001,10000),'initial_soc_pct':(0,100),'reserve_soc_pct':(0,100),
 'charge_efficiency':(.01,1),'discharge_efficiency':(.01,1),'max_charge_w':(0,1e7),'max_discharge_w':(0,1e7),
 'base_load_w':(0,1e6),'heater_load_w':(0,1e6),'science_load_w':(0,1e6),
 'science_rate_kbps':(0,1e7),'initial_data_gb':(0,1e7),'storage_gb':(.000001,1e7),'required_data_gb':(0,1e7),
 'frequency_ghz':(.1,100),'transmit_power_w':(.01,1e6),'amplifier_efficiency':(.01,1),
 'radio_electronics_w':(0,1e6),'tx_diameter_m':(.01,100),'tx_aperture_efficiency':(.01,1),
 'rx_diameter_m':(.01,100),'rx_aperture_efficiency':(.01,1),'system_temperature_k':(1,10000),
 'other_losses_db':(0,100),'required_ebn0_db':(-10,50),'design_margin_db':(0,30),
 'requested_rate_mbps':(.000001,10000),'bandwidth_mhz':(.000001,10000),'spectral_efficiency':(.01,10),
 'earth_clearance_deg':(0,10),'fallback_range_km':(300000,450000),
}
AU_KM=149597870.7

def hardware(raw=None):
    if raw is not None and not isinstance(raw,dict):raise ValueError('Hardware settings must be an object.')
    h=copy.deepcopy(DEFAULT_HARDWARE)
    for k,v in (raw or {}).items():
        if k in RANGES:h[k]=number(v,k,*RANGES[k])
        elif k=='panel_mode':
            if v not in ['tracking','fixed','horizontal','vertical_tracking']:raise ValueError('Choose a supported panel mode.')
            h[k]=v
    if min(h['tx_diameter_m'],h['rx_diameter_m']) < 2*.299792458/h['frequency_ghz']:
        raise ValueError('This aperture-gain model requires dish diameters at least two wavelengths. Use another antenna model for electrically small antennas.')
    if h['initial_data_gb']>h['storage_gb']:raise ValueError('Initial stored data exceed storage capacity.')
    return h

def disc_fraction(clearance_deg,radius_deg=.2666):
    """Uniform solar-disc fraction above a straight local skyline (approximation)."""
    r=max(1e-6,radius_deg);x=clearance_deg/r
    if x>=1:return 1.0
    if x<=-1:return 0.0
    return (math.acos(-x)+x*math.sqrt(max(0,1-x*x)))/math.pi

def incidence(az,el,h):
    a,e=math.radians(az),math.radians(el)
    if h['panel_mode']=='tracking':return 1.0
    if h['panel_mode']=='horizontal':return max(0,math.sin(e))
    if h['panel_mode']=='vertical_tracking':return max(0,math.cos(e))
    tilt,pa=math.radians(h['panel_tilt_deg']),math.radians(h['panel_azimuth_deg'])
    return max(0,math.cos(tilt)*math.sin(e)+math.sin(tilt)*math.cos(e)*math.cos(a-pa))

def solar_sample(track,skyline,h,smooth_horizon=0.0):
    distance=track.get('sun_distance_km')
    flux=h['solar_irradiance_wm2']*((AU_KM/distance)**2 if distance else 1)
    radius=track.get('sun_angular_diameter_arcsec',1919.3)/7200
    fraction=disc_fraction(track['sun_elevation_deg']-skyline,radius)
    temp=max(0,min(1.5,1+h['temperature_coefficient_per_k']*(h['panel_temperature_k']-298.15)))
    clear_power=flux*h['panel_area_m2']*h['panel_efficiency']*h['electrical_efficiency']*h['contamination_factor']*temp*incidence(track['sun_azimuth_deg'],track['sun_elevation_deg'],h)
    return clear_power*fraction,clear_power*disc_fraction(track['sun_elevation_deg']-smooth_horizon,radius),fraction

def radio_sample(track,skyline,h):
    r=track.get('earth_distance_km',h['fallback_range_km']);lam=.299792458/h['frequency_ghz']
    tx=10*math.log10(h['tx_aperture_efficiency']*(math.pi*h['tx_diameter_m']/lam)**2)
    rx=10*math.log10(h['rx_aperture_efficiency']*(math.pi*h['rx_diameter_m']/lam)**2)
    fspl=20*math.log10(4*math.pi*r*1000/lam)
    pr=10*math.log10(h['transmit_power_w'])+tx+rx-fspl-h['other_losses_db']
    cn0=pr-10*math.log10(1.380649e-23*h['system_temperature_k'])
    threshold=h['required_ebn0_db']+h['design_margin_db']
    requested=h['requested_rate_mbps']*1e6
    max_rate=min(h['bandwidth_mhz']*1e6*h['spectral_efficiency'],10**min(18,(cn0-threshold)/10))
    visible=track['earth_elevation_deg']-skyline>h['earth_clearance_deg']
    rate=min(requested,max_rate) if visible else 0.0
    return {'range_km':r,'fspl_db':fspl,'received_dbw':pr,'cn0_dbhz':cn0,
            'requested_margin_db':cn0-10*math.log10(requested)-threshold,
            'rate_bps':rate,'visible':visible,'tx_gain_dbi':tx,'rx_gain_dbi':rx}

def simulate(site,p,h=None,geometry=None,detailed=True):
    h=hardware(h);g=geometry or evaluate(site,p,detailed=True)
    hours=g['hours'];tr=g['tracks'];n=len(hours)
    r0=1737400+site['ground_elevation_m']
    smooth=-math.degrees(math.acos(r0/(r0+p['height_m']))) if p['height_m'] else 0.0
    sun=[solar_sample(t,sky,h,smooth) for t,sky in zip(tr,g['curves']['sun']['horizon_deg'])]
    rf=[radio_sample(t,sky,h) for t,sky in zip(tr,g['curves']['earth']['horizon_deg'])]
    battery=h['battery_kwh'];energy=battery*h['initial_soc_pct']/100;reserve=battery*h['reserve_soc_pct']/100
    buf=h['initial_data_gb']*8e9;capacity=h['storage_gb']*8e9
    total_harvest=lost_terrain=spill=unmet=total_load=returned=generated=overflow=comm_energy=usable=charge_loss=discharge_loss=0.0
    soc=[100*energy/battery];buffers=[buf/8e9];loads=[];txrates=[];actual_radio=[]
    # Transparent policy: serve survival loads, run science if power permits,
    # transmit stored data only while preserving the configured battery reserve.
    for i in range(n-1):
        dt=hours[i+1]-hours[i];sec=dt*3600
        gen=(sun[i][0]+sun[i+1][0])/2
        clear=(sun[i][1]+sun[i+1][1])/2
        total_harvest+=gen*dt/1000;lost_terrain+=max(0,clear-gen)*dt/1000
        available_discharge=min(h['max_discharge_w'],energy*h['discharge_efficiency']*1000/dt)
        available=gen+available_discharge
        survival=h['base_load_w']+h['heater_load_w']
        base_served=min(survival,available)
        science_fraction=1.0 if h['science_load_w']==0 and available>=survival else min(1,max(0,(available-survival)/max(1e-12,h['science_load_w'])))
        science=h['science_load_w']*science_fraction
        made=h['science_rate_kbps']*1000*sec*science_fraction
        generated+=made;buf+=made
        # Mean endpoint rate; sampled geometry, not a ground-station schedule.
        rate=(rf[i]['rate_bps']+rf[i+1]['rate_bps'])/2
        if rate>0:usable+=dt
        radio_w=h['transmit_power_w']/h['amplifier_efficiency']+h['radio_electronics_w']
        after=base_served+science
        reserve_discharge=min(h['max_discharge_w'],max(0,energy-reserve)*h['discharge_efficiency']*1000/dt)
        radio_budget=max(0,gen+reserve_discharge-after)
        duty=min(1,radio_budget/radio_w,buf/(rate*sec)) if rate>0 and buf>0 else 0.0
        bits=min(buf,rate*sec*duty);buf-=bits;returned+=bits
        excess=max(0,buf-capacity);overflow+=excess;buf=min(buf,capacity)
        radio_load=radio_w*duty;used=after+radio_load
        comm_energy+=radio_load*dt/1000;total_load+=used*dt/1000
        unmet+=max(0,survival-base_served)*dt/1000
        balance=gen-used
        if balance>=0:
            charging=min(balance,h['max_charge_w']);gain=charging*dt/1000*h['charge_efficiency']
            stored=min(gain,battery-energy);energy+=stored
            spill+=max(0,balance*dt/1000-stored/h['charge_efficiency'])
            charge_loss+=stored*(1/h['charge_efficiency']-1)
        else:
            energy=max(0,energy+balance*dt/1000/h['discharge_efficiency'])
            discharge_loss+=(-balance*dt/1000)*(1/h['discharge_efficiency']-1)
        soc.append(100*energy/battery);buffers.append(buf/8e9);loads.append(used);txrates.append(bits/sec/1e6);actual_radio.append(radio_load)
    for a in (loads,txrates,actual_radio):a.append(a[-1] if a else 0)
    reasons=[]
    if min(soc)+1e-7<h['reserve_soc_pct']:reasons.append(f'Battery falls to {min(soc):.1f}%, below the {h["reserve_soc_pct"]:g}% reserve.')
    if unmet>1e-8:reasons.append(f'{unmet:.3f} kWh of survival demand cannot be supplied.')
    if returned/8e9+1e-9<h['required_data_gb']:reasons.append(f'Modelled return {returned/8e9:.3f} GB is below {h["required_data_gb"]:g} GB.')
    if overflow>0:reasons.append(f'{overflow/8e9:.3f} GB exceeds the storage limit and is lost in this model.')
    metrics={'harvested_kwh':total_harvest,'terrain_loss_kwh':lost_terrain,'load_served_kwh':total_load,
             'spilled_kwh':spill,'charging_loss_kwh':charge_loss,'discharging_loss_kwh':discharge_loss,'unmet_survival_kwh':unmet,'min_soc_pct':min(soc),'final_soc_pct':soc[-1],
             'returned_gb':returned/8e9,'generated_gb':generated/8e9,'remaining_gb':buf/8e9,'overflow_gb':overflow/8e9,
             'radio_energy_kwh':comm_energy,'link_opportunity_h':usable,'best_margin_db':max((r['requested_margin_db'] for r in rf if r['visible']),default=None),
             'peak_solar_w':max(s[0] for s in sun),'minimum_margin_db':min((r['requested_margin_db'] for r in rf if r['visible']),default=None)}
    missing_distance=not all('sun_distance_km' in t and 'earth_distance_km' in t for t in tr)
    out={'site_id':site['id'],'site_name':site['name'],'hardware':h,'status':'fail' if reasons else 'pass','reasons':reasons,'metrics':metrics,
         'provenance':{'synthetic_environment':bool(g['synthetic_terrain'] or g['synthetic_track']),
                       'terrain':g['terrain_source'],'ephemeris':g['track_source'],
                       'distances':'Reference 1 AU / user range where missing' if missing_distance else 'Ephemeris ranges',
                       'hardware':'User assumptions / illustrative preset',
                       'radio_geometry':'Earth-centre LOS proxy; no specific station, availability or Earth-side elevation constraint',
                       'temperature':'Fixed user-selected panel temperature; NOT the Diviner surface temperature'},
         'limitations':['Engineering screening, not a flight-qualified survival or communications forecast.',
          'Solar-disc fraction uses a straight local skyline; arbitrary skyline crossings and panel self-shadow are not resolved.',
          'Ideal tracking mode has no mechanical limits or tracker-power model.',
          'No thermal dynamics, actual station schedule, coding-error curve, fading or terrain multipath simulation.',
          'Finite terrain range and sampling can miss distant obstructions; repeat at finer resolutions.',
          'Data return assumes the stated reserve-first scheduling rule and receiver availability whenever the Earth-centre proxy clears terrain.']}
    if detailed:
        out['curves']={'hours':hours,'solar_w':[s[0] for s in sun],'clear_solar_w':[s[1] for s in sun],
            'sun_fraction':[s[2] for s in sun],'load_w':loads,'soc_pct':soc,'buffer_gb':buffers,
            'link_margin_db':[r['requested_margin_db'] for r in rf],
            'link_visible':[r['visible'] for r in rf],'potential_rate_mbps':[r['rate_bps']/1e6 for r in rf],
            'transmitted_rate_mbps':txrates,'radio_load_w':actual_radio,'received_dbw':[r['received_dbw'] for r in rf],
            'cn0_dbhz':[r['cn0_dbhz'] for r in rf],'range_km':[r['range_km'] for r in rf]}
    return out

def mission_analyze(project,raw):
    p=validate_params(raw);h=hardware(raw.get('hardware'));rows=[]
    for site in project['sites']:
        try:rows.append(simulate(site,p,h))
        except ValueError as e:rows.append({'site_id':site['id'],'site_name':site['name'],'status':'unknown','metrics':None,'reasons':[str(e)]})
    return {'parameters':p,'hardware':h,'results':rows,'scope':'energy and Earth-centre RF screening'}

def mission_repair(project,raw):
    p=validate_params(raw);h=hardware(raw.get('hardware'));sid=raw.get('site_id',project['sites'][0]['id'])
    base=next((s for s in project['sites'] if s['id']==sid),None)
    if not base:raise ValueError('Choose an existing reference location.')
    sites=project['sites'] if raw.get('allow_move',True) else [base]
    factors=[1,1.5,2] if raw.get('allow_panel',True) else [1]
    bats=[1,1.5,2] if raw.get('allow_battery',True) else [1]
    delays=[0,12,24] if raw.get('allow_delay',False) else [0]
    weights={k:number(raw.get(k,1),k,0,100) for k in ['weight_move','weight_panel','weight_battery','weight_delay']}
    rows=[];unknown=0;tested=0
    if len(sites)*len(factors)*len(bats)*len(delays)>1000:raise ValueError('Search is too large; choose fewer sites or changes.')
    for s in sites:
      for delay in delays:
        pp=dict(p,start_utc=iso(utc(p['start_utc'])+timedelta(hours=delay)))
        try:g=evaluate(s,pp)
        except ValueError:unknown+=len(factors)*len(bats);continue
        for fa in factors:
          for fb in bats:
            hh=dict(h,panel_area_m2=h['panel_area_m2']*fa,battery_kwh=h['battery_kwh']*fb)
            if hh['panel_area_m2']>1000 or hh['battery_kwh']>10000:unknown+=1;continue
            r=simulate(s,pp,hh,g,False);tested+=1
            # Keep visibility constraints and slope checks enabled, rather than hiding them.
            if r['status']=='pass' and g['status']=='pass':
                km=distance_between(base,s)/1000
                cost=weights['weight_move']*km+weights['weight_panel']*(fa-1)+weights['weight_battery']*(fb-1)+weights['weight_delay']*delay/24
                rows.append({'site_id':s['id'],'site_name':s['name'],'cost':cost,'move_km':km,'delay_h':delay,
                    'panel_area_m2':hh['panel_area_m2'],'battery_kwh':hh['battery_kwh'], 'metrics':r['metrics'],
                    'parameters':pp,'hardware':hh,'provenance':r['provenance']})
    rows.sort(key=lambda x:(x['cost'],-x['metrics']['min_soc_pct']))
    return {'options':rows[:12],'tested':tested,'unknown':unknown,'passing':len(rows),
            'search_note':'Lowest normalized change among the enumerated sites, 0/12/24 h delays and panel/battery factors 1/1.5/2. Not a global optimum or a monetary cost.'}
