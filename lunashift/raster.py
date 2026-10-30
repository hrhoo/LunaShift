"""Optional local raster ingress; elevation and context are never conflated."""
from pathlib import Path
import tempfile,csv,json,math
from .core import number,R_MOON

def dependencies():
    try:import rasterio,numpy,pyproj,PIL
    except ImportError as e:raise ValueError('Install optional real-terrain tools first: python3 -m pip install -r requirements-terrain.txt. Then retry. '+str(e)) from None

def inspect(path):
    dependencies()
    import rasterio
    from pyproj import CRS
    with rasterio.open(path) as ds:
        if ds.crs is None:raise ValueError('The raster has no coordinate reference system; nothing was guessed.')
        c=CRS.from_wkt(ds.crs.to_wkt())
        if abs(c.ellipsoid.semi_major_metre-R_MOON)>1 or abs(c.ellipsoid.semi_minor_metre-R_MOON)>1:
            raise ValueError('Expected lunar reference sphere 1,737,400 m, not an Earth projection.')
        return {'width':ds.width,'height':ds.height,'pixel_size':list(ds.res),'bounds':list(ds.bounds),
                'crs':ds.crs.to_wkt(),'dtype':ds.dtypes[0],'scale':ds.scales[0],'offset':ds.offsets[0],'nodata':str(ds.nodata)}

def convert_for_site(path,site,source,radius_km=5,az_step=2,range_step=100):
    dependencies()
    from tools.convert_geotiff import convert
    with tempfile.TemporaryDirectory() as tmp:
        catalog=Path(tmp)/'site.csv';out=Path(tmp)/'project.json'
        with catalog.open('w',newline='') as f:
            w=csv.DictWriter(f,fieldnames=['site_id','name','latitude_deg','longitude_deg']);w.writeheader()
            w.writerow({'site_id':site['id'],'name':site['name'],'latitude_deg':site['latitude_deg'],'longitude_deg':site['longitude_deg']})
        result=convert(str(path),str(catalog),str(out),'MOON_ME_DE421',source,
            number(radius_km,'Radius km',.1,100),number(az_step,'Azimuth step',.5,10),number(range_step,'Range step',5,1000),1,'elevation')
    return result['sites'][0]

def sample_context(path,sites,kind,unit,source):
    dependencies();inspect(path)
    import rasterio,numpy as np
    from pyproj import CRS,Transformer
    kinds={'surface_temperature','average_illumination','average_earth_visibility','slope','height_uncertainty','science_value','hazard'}
    if kind not in kinds:raise ValueError('Unsupported context variable.')
    if not unit.strip() or not source.strip():raise ValueError('Declare units and source; the app does not infer them from pixel brightness.')
    out=[]
    with rasterio.open(path) as ds:
        c=CRS.from_wkt(ds.crs.to_wkt());tf=Transformer.from_crs(c.geodetic_crs,c,always_xy=True)
        for s in sites:
            x,y=tf.transform(s['longitude_deg'],s['latitude_deg']);row,col=ds.index(x,y)
            value=None
            if 0<=row<ds.height and 0<=col<ds.width:
                a=ds.read(1,window=rasterio.windows.Window(col,row,1,1),masked=True)
                if not np.ma.is_masked(a[0,0]):
                    v=float(a[0,0])*ds.scales[0]+ds.offsets[0]
                    if math.isfinite(v):value=v
            out.append({'site_id':s['id'],'kind':kind,'unit':unit[:40],'value':value,'source':source[:1000],
                        'resolution':list(ds.res),'method':'Full-resolution containing-pixel sample; no overview averaging',
                        'used_for':'Context only; NOT automatically applied to mission physics or constraints'})
    return out
