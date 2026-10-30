"""Source inventory. A reference link is deliberately NOT labeled an ingestion."""
SOURCES = [
 {'id':'horizons','name':'JPL Horizons','role':'Sun/Earth directions, apparent sizes and ranges','status':'API adapter + raw-response cache','kind':'calculation input','url':'https://ssd-api.jpl.nasa.gov/doc/horizons.html','note':'Connection must succeed. The app never replaces a failed request with synthetic tracks.'},
 {'id':'lola','name':'LOLA / PGDA elevation','role':'Site elevation, local slope and sampled terrain skyline','status':'GeoTIFF upload + converter','kind':'calculation input','url':'https://pgda.gsfc.nasa.gov/products/78','note':'Needs optional terrain packages. Limited to documented MOON_ME_DE421 lunar rasters; finite terrain range is disclosed.'},
 {'id':'trek','name':'NASA Moon Trek / LROC mosaic','role':'Zoomable imagery and map context','status':'WMTS capabilities + tile adapter','kind':'visual context','url':'https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon','note':'Tiles are historical images, not a live camera. Missing imagery is not replaced by synthetic lunar imagery.'},
 {'id':'quickmap','name':'LROC QuickMap','role':'Independent visual site inspection','status':'External reference only','kind':'reference','url':'https://quickmap.lroc.asu.edu/','note':'Not scraped and not claimed as an imported calculation dataset.'},
 {'id':'illumination','name':'PGDA polar illumination / Earth visibility','role':'Long-term regional context and screening','status':'GeoTIFF context-layer sampler','kind':'screening context','url':'https://pgda.gsfc.nasa.gov/products/69','note':'Long-term averages do not replace the selected-date time series. Some source download links may be unavailable.'},
 {'id':'spice','name':'NASA NAIF SPICE','role':'Local Sun/Earth directions, apparent sizes and distances','status':'Integrated geometry provider + managed NASA files','kind':'calculation input','url':'https://naif.jpl.nasa.gov/naif/','note':'Choose Automatic or NASA SPICE in Mission Setup. One-time setup needs SpiceyPy and the compatible DE421 file set. Date coverage is checked. Does not replace terrain.'},
 {'id':'shadowcam','name':'ShadowCam imagery','role':'Images of polar shadowed terrain','status':'External reference only','kind':'visual reference','url':'https://www.shadowcam.asu.edu/','note':'No new quantitative terrain is inferred from photographs.'},
 {'id':'clps','name':'NASA CLPS','role':'Mission and target-region background','status':'External reference only','kind':'mission reference','url':'https://www.nasa.gov/commercial-lunar-payload-services/','note':'No invented mission hardware is presented as a CLPS vehicle specification.'},
 {'id':'diviner','name':'LRO Diviner','role':'Measured lunar surface thermal context','status':'GeoTIFF context-layer sampler','kind':'thermal context','url':'https://pds-geosciences.wustl.edu/missions/lro/diviner.htm','note':'Surface temperature is NOT panel or battery temperature. No thermal balance or heater prediction is inferred.'},
 {'id':'power','name':'NASA Small Spacecraft power reference','role':'Engineering background for solar and battery models','status':'Reference + explicitly editable assumptions','kind':'engineering reference','url':'https://www.nasa.gov/smallsat-institute/sst-soa/power-subsystems/','note':'All included lander presets are illustrative, not a measured spacecraft.'},
 {'id':'dsn','name':'JPL DSN 810-005','role':'Authoritative radio design reference','status':'External reference; generic receiver settings','kind':'engineering reference','url':'https://deepspace.jpl.nasa.gov/dsndocs/810-005/','note':'No actual DSN antenna allocation, performance table or schedule is bundled. Current revisions must be checked for mission-specific parameters.'},
 {'id':'propagation','name':'NASA lunar surface propagation','role':'Limits of a free-space LOS radio calculation','status':'External reference only','kind':'model limitation','url':'https://www.nasa.gov/glenn/glenn-expertise-space-exploration/scan/lunar-surface-propagation/','note':'Multipath and fading are NOT simulated. A clearance warning is not a measured fading probability.'},
 {'id':'eyes','name':'NASA Eyes','role':'Interactive Earth–Moon–Sun overview','status':'Embedded external viewer + fallback link','kind':'external visualization','url':'https://eyes.nasa.gov/apps/solar-system/#/moon','note':'Independent NASA viewer. It is NOT synchronized with the mission timeline and is not a live camera.'},
 {'id':'svs','name':'NASA SVS illumination reference','role':'Reference animation of shadows, Sun and Earth','status':'External reference only','kind':'validation reference','url':'https://svs.gsfc.nasa.gov/5228/','note':'Precomputed visualization, not a numeric validation at arbitrary points.'},
 {'id':'texture','name':'NASA SVS CGI Moon Kit','role':'LROC-derived global colour texture','status':'Live image + optional local cache','kind':'visual context','url':'https://svs.gsfc.nasa.gov/4720/','note':'Processed imagery with polar inpainting; not a terrain elevation model and not used for power calculations.'},
]
MAP_LAYERS = {
 'imagery':{'name':'LROC global imagery','projection':'eq','url':'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/WMTSCapabilities.xml'},
 'illumination':{'name':'South-pole average illumination','projection':'sp','url':'https://trek.nasa.gov/tiles/Moon/SP/WAC_POLE_ILL_PCT_SOUTH_100M/1.0.0/WMTSCapabilities.xml'},
 'earth':{'name':'South-pole average Earth visibility','projection':'sp','url':'https://trek.nasa.gov/tiles/Moon/SP/AVGVISIB_85S_060M_201608_EARTH_SP/1.0.0/WMTSCapabilities.xml'},
}
MOON_TEXTURE='https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg'

def manifest(project):
    rows=[]
    for s in project['sites']:
        t=s.get('terrain') or {};tracks=s.get('ephemeris',[])
        rows.append({'site_id':s['id'],'name':s['name'],
          'terrain':'synthetic' if t.get('synthetic') else ('attached' if t else 'missing'),
          'ephemeris':'synthetic' if s.get('track_mode')=='synthetic' or s.get('track_synthetic') else ('attached' if tracks else 'missing'),
          'ranges':bool(tracks and all('sun_distance_km' in r and 'earth_distance_km' in r for r in tracks)),
          'coverage_km':t.get('range_limit_m',0)/1000 if t else None,
          'slope':s.get('slope_deg'),'layers':s.get('context_layers',[])})
    return {'sources':SOURCES,'sites':rows,'map_layers':MAP_LAYERS,
            'statement':'Not every linked source is an active input. Status is explicit; linked references are not counted as imported data.',
            'network_note':'Remote NASA requests require internet. Use the connection report to check this machine; success is never assumed from a source link alone.'}
