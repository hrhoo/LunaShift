"""Acquire one real NASA terrain+ephemeris example without fabricating inputs.
The chosen candidate is the centre of the downloaded raster, NOT an approved
landing point. Local finite-range terrain is deliberately labelled as such.
"""
from pathlib import Path
from datetime import timedelta,datetime,timezone
import math
from .remote import get_bytes
from .raster import dependencies,inspect,convert_for_site
from .geometry import fetch_geometry, LABELS
from .core import utc,iso,number

DEMO_DEM='https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site04/Site04_final_adj_5mpp_surf.tif'

def build_real_example(root,raw,progress=lambda x:None):
    dependencies()
    import rasterio
    from pyproj import CRS,Transformer
    root=Path(root)
    progress('Downloading the official PGDA Site04 elevation raster (up to 256 MiB)…')
    data,ctype=get_bytes(DEMO_DEM,root/'cache/nasa-example',limit=256*1024*1024,timeout=90)
    if data[:4] not in (b'II*\x00',b'MM\x00*',b'II+\x00',b'MM\x00+'):
        raise ValueError('The PGDA URL did not return a TIFF. The original workspace is unchanged. Download a compatible DEM from the source page and use the manual upload route.')
    path=root/'cache/nasa-example/site04_elevation.tif';path.write_bytes(data);del data
    progress('Checking the actual raster projection and selecting its centre…');meta=inspect(path)
    with rasterio.open(path) as ds:
        c=CRS.from_wkt(ds.crs.to_wkt());inv=Transformer.from_crs(c,c.geodetic_crs,always_xy=True)
        x=(ds.bounds.left+ds.bounds.right)/2;y=(ds.bounds.bottom+ds.bounds.top)/2
        lon,lat=inv.transform(x,y)
        # Stay inside this tile. This is NOT a claim that the chosen radius captures all relevant terrain.
        radius=min(5.0,.20*min(ds.bounds.right-ds.bounds.left,ds.bounds.top-ds.bounds.bottom)/1000)
        if radius<.2:raise ValueError('The example raster is too small for the preset sampling radius.')
    site={'id':'PGDA04','name':'PGDA Site04 raster centre (candidate, not approved)','latitude_deg':lat,'longitude_deg':lon%360,'ground_elevation_m':0,'track_mode':'none','slope_deg':None,'terrain':None}
    progress(f'Building a real, finite-range terrain skyline ({radius:.2f} km radius)…')
    s=convert_for_site(path,site,DEMO_DEM+' | PGDA product 78, Site04, 5 m/pixel',radius,2,100)
    start=utc(raw.get('start_utc','2026-11-01T00:00:00Z'))
    hours=number(raw.get('duration_h',120),'Duration',1,1440);step=number(raw.get('step_min',60),'Step',1,180)
    progress('Preparing Sun/Earth data using your selected geometry source…')
    rows,trackmeta=fetch_geometry(s,start,start+timedelta(hours=hours),step,root,raw.get('geometry_source','automatic'),progress)
    s.update(ephemeris=rows,track_mode='imported',track_synthetic=False,track_source=LABELS[trackmeta['actual_source']]+' airless apparent AZ/EL, size and range',track_metadata=trackmeta,track_max_gap_min=step)
    progress('Preparing the real workspace and preserving all source metadata…')
    return {'schema_version':1,'name':'Real NASA Site04 learning workspace','coordinate_frame':'MOON_ME_DE421','time_scale':'UTC',
      'description':'Actual PGDA elevation + selected NASA geometry tracks. Candidate is the raster centre, not a safe or approved landing site. Terrain is only sampled within this tile.',
      'sites':[s],'map_center':{'latitude_deg':lat,'longitude_deg':lon%360},
      'history':[{'change':'Downloaded PGDA Site04 and prepared NASA geometry; no synthetic environmental data','source':DEMO_DEM,'time_utc':iso(datetime.now(timezone.utc))}],
      'ui_state':{'selected_site_id':s['id'],'fields':{'start':iso(start)[:16],'duration':str(hours),'step':str(step),'height':'2','minSun':'35','maxDark':'30','maxGap':'36','maxSlope':'12','margin':'0.05','slopeCheck':True}}}
