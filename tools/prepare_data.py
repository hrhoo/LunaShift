#!/usr/bin/env python3
"""Prepare LunaShift's authentic, bounded lunar demonstration data.

Requires Python 3.12 or newer. Install tools/requirements-data.txt and run
tools/download_kernels.py first, then:
  python tools/prepare_data.py --cache /path/to/download-cache --kernels /path/to/kernels
The kernels directory must contain the five files recorded in manifest.json.
Nothing is fetched or calculated by the published site at runtime.
"""
from __future__ import annotations
import argparse, datetime as dt, hashlib, json, math, pathlib, shutil, ssl, urllib.request
import numpy as np
import rasterio
import pyproj
import spiceypy as spice

RADIUS_M = 1737400.0
FRAME = 'MOON_ME_DE421'
FINE_URL = 'https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site01/Site01_final_adj_5mpp_surf.tif'
COARSE_URL = 'https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF'
COLOR_URL = 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg'
KERNELS = ['naif0012.tls','pck00011.tpc','de421.bsp','moon_pa_de421_1900-2050.bpc','moon_080317.tf']
CANDIDATES = [
 ('ridge-crest', 'Connecting Ridge · Crest', -11572.5, -12472.5, 'A high point in the prepared Connecting Ridge terrain patch. This descriptive sample label is not an approved landing site.'),
 ('ridge-shoulder', 'Connecting Ridge · Shoulder', -12002.5, -14002.5, 'A nearby shoulder roughly 1.6 km from the crest, selected to explore terrain and height trade-offs.'),
 ('ridge-low', 'Connecting Ridge · Lower ground', -14002.5, -10502.5, 'Lower ground roughly 3.1 km from the crest, selected to make surrounding terrain obstruction visible.'),
]

def digest(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''): h.update(block)
    return h.hexdigest()

def download(url, dest):
    if not dest.exists():
        print('Downloading',url,flush=True)
        tmp=dest.with_suffix(dest.suffix+'.part')
        with urllib.request.urlopen(url,timeout=90) as response, open(tmp,'wb') as out:
            shutil.copyfileobj(response,out)
        tmp.replace(dest)
    return dest

class DEM:
    def __init__(self,path):
        with rasterio.open(path) as ds:
            self.a=ds.read(1).astype(np.float64)
            self.transform=ds.transform
            self.crs=ds.crs
            self.bounds=tuple(ds.bounds)
            self.project=pyproj.Transformer.from_crs(ds.crs.geodetic_crs,ds.crs,always_xy=True)
            self.unproject=pyproj.Transformer.from_crs(ds.crs,ds.crs.geodetic_crs,always_xy=True)
            self.spacing_m=abs(ds.transform.a)
    def xy(self,x,y):
        # Affine maps pixel corners. Source grid heights are at pixel centres.
        cols=(np.asarray(x)-self.transform.c)/self.transform.a-0.5
        rows=(np.asarray(y)-self.transform.f)/self.transform.e-0.5
        i=np.floor(cols).astype(int);j=np.floor(rows).astype(int)
        valid=(i>=0)&(j>=0)&(i+1<self.a.shape[1])&(j+1<self.a.shape[0])
        ii=np.clip(i,0,self.a.shape[1]-2);jj=np.clip(j,0,self.a.shape[0]-2)
        dx=cols-i;dy=rows-j
        v=(self.a[jj,ii]*(1-dx)*(1-dy)+self.a[jj,ii+1]*dx*(1-dy)+self.a[jj+1,ii]*(1-dx)*dy+self.a[jj+1,ii+1]*dx*dy)
        return np.where(valid,v,np.nan)
    def lonlat(self,lon,lat):
        return self.xy(*self.project.transform(lon,lat))

def coarse_crop(cache):
    dest=cache/'polar_80m_crop.tif'
    if dest.exists(): return dest
    # Read a bounded COG window with ordinary HTTPS and standard certificate trust.
    # Never disable TLS checks. Some packaged GDAL builds need the Python CA path.
    regional_file=cache/'LDEM_80S_80MPP_ADJ.TIF'
    if not regional_file.exists():
        # urllib uses the host's normal verified certificate store. A full raw
        # download also makes the upstream byte hash reproducible.
        download(COARSE_URL,regional_file)
    with rasterio.Env():
        with rasterio.open(regional_file) as ds:
            window=rasterio.windows.from_bounds(-100000,-100000,100000,100000,ds.transform).round_offsets().round_lengths()
            a=ds.read(1,window=window)
            profile=ds.profile.copy();profile.update(width=a.shape[1],height=a.shape[0],transform=ds.window_transform(window),compress='deflate')
            with rasterio.open(dest,'w',**profile) as out: out.write(a,1)
            (cache/'coarse_source.json').write_text(json.dumps({'url':COARSE_URL,'source_profile':{k:str(v) for k,v in ds.profile.items()},'window':list(window.flatten()),'crop_bounds':list(rasterio.windows.bounds(window,ds.transform))},indent=2))
    return dest

def normal_basis(lon_deg,lat_deg):
    lon,lat=np.radians([lon_deg,lat_deg])
    up=np.array([np.cos(lat)*np.cos(lon),np.cos(lat)*np.sin(lon),np.sin(lat)])
    east=np.array([-np.sin(lon),np.cos(lon),0.])
    north=np.cross(up,east)
    return east,north,up

def local_lonlat(x,y,lon,lat,h):
    e,n,u=normal_basis(lon,lat)
    r=RADIUS_M+np.asarray(h)
    vertical=np.sqrt(r*r-np.asarray(x)**2-np.asarray(y)**2)
    p=np.asarray(x)[...,None]*e+np.asarray(y)[...,None]*n+vertical[...,None]*u
    return np.degrees(np.arctan2(p[...,1],p[...,0])),np.degrees(np.arctan2(p[...,2],np.hypot(p[...,0],p[...,1])))

def local_grid(fine,lon,lat,h,axis):
    x,y=np.meshgrid(axis,axis)
    values=np.full(x.shape,h)
    for _ in range(3):
        ll=local_lonlat(x,y,lon,lat,values)
        values=fine.lonlat(*ll)
    if not np.all(np.isfinite(values)): raise RuntimeError('Local mesh includes missing source pixels; refusing to fill terrain.')
    return x,y,values

def build_sites(fine,coarse):
    geod=pyproj.Geod(a=RADIUS_M,b=RADIUS_M)
    az=np.arange(0,360,.5)
    distances=np.unique(np.concatenate([np.arange(5,501,5),np.arange(520,2001,20),np.arange(2040,8001,40),np.arange(8240,80001,240),[80000.]])).astype(float)
    a,d=np.meshgrid(az,distances,indexing='ij')
    sites=[]
    for sid,name,x0,y0,note in CANDIDATES:
        lon,lat=fine.unproject.transform(x0,y0)
        h=float(fine.xy(x0,y0))
        lons,lats,_=geod.fwd(np.full(a.shape,lon),np.full(a.shape,lat),a,d)
        zfine=fine.lonlat(lons,lats);zcoarse=coarse.lonlat(lons,lats)
        fine_mask=np.isfinite(zfine)
        z=np.where(fine_mask,zfine,zcoarse)
        if not np.all(np.isfinite(z)): raise RuntimeError('Missing ray terrain: refusing to fabricate or silently truncate.')
        # Fixed local ENU horizontal grid. Elevation remains radial height above R.
        axis=np.arange(-1500,1500.1,20.)
        xx,yy,m=local_grid(fine,lon,lat,h,axis)
        px,py,pz=local_grid(fine,lon,lat,h,np.arange(-25,25.1,5.))
        coeff=np.linalg.lstsq(np.column_stack([px.ravel(),py.ravel(),np.ones(px.size)]),pz.ravel(),rcond=None)[0]
        slope=math.degrees(math.atan(math.hypot(*coeff[:2])))
        mesh={'width':len(axis),'height':len(axis),'spacing_m':20,'origin_x_m':-1500,'origin_y_m':-1500,'row_order':'south_to_north','height_datum':'radial metres above 1737400 m sphere','elevations_m':np.round(m,1).tolist(),'metadata':{'note':'Real LOLA Site01 5 m DEM, bilinear display grid at 20 m. Horizontal positions are local east/north; elevations are radial, absolute metres. No vertical exaggeration in stored data.','source_resolution_m':5,'display_resolution_m':20,'extent_m':3000,'source_url':FINE_URL}}
        terrain={'kind':'rays','azimuth_deg':az.tolist(),'distances_m':distances.tolist(),'elevations_m':np.round(z,1).tolist(),'radius_m':RADIUS_M,'range_limit_m':80000,'synthetic':False,'source':'NASA LOLA PGDA Site01 5 m DEM inside its footprint; PGDA adjusted south-polar 80 m DEM elsewhere','frame':FRAME,'coverage_note':'All 720 azimuths sampled to 80 km. Radial spacing: 5 m to 500 m, 20 m to 2 km, 40 m to 8 km, 240 m beyond. Elevations bilinearly sampled; sub-grid blockers and terrain beyond 80 km are unresolved.','source_resolution_m':{'near':5,'regional':80},'azimuth_spacing_deg':.5,'fine_source_sample_fraction':round(float(np.mean(fine_mask)),6),'source_urls':[FINE_URL,COARSE_URL],'sampling_interpolation':'bilinear source raster; spherical geodesic bearings and arc distances','elevation_rounding_m':.1}
        site={'id':sid,'name':name,'latitude_deg':float(lat),'longitude_deg':float(lon),'ground_elevation_m':round(h,3),'radius_m':RADIUS_M,'slope_deg':round(slope,3),'slope_synthetic':False,'slope_source':'Least-squares plane on a 50 m square of the 5 m LOLA DEM in local ENU; exploratory terrain gradient, not lander safety certification.','track_mode':'spice','track_source':'DE421 Sun + MOON_ME_DE421 orientation, geometric Moon-centred hourly vectors','terrain':terrain,'mesh':mesh,'metadata':{'note':note,'prepared_site':True,'data_kind':'observational_dem','projection_xy_m':[x0,y0],'coordinate_frame':FRAME,'coverage':'3 km display mesh; 80 km sampled terrain horizon.','no_landing_safety_claim':True}}
        print('Prepared',sid,'lat/lon/h',lat,lon,h,'slope',slope,'fine fraction',np.mean(fine_mask),flush=True)
        sites.append(site)
    return sites

def build_ephemeris(kernels):
    manifest=json.loads((kernels/'manifest.json').read_text())
    entries={x['name']:x for x in manifest['files']}
    used=[]
    for fn in KERNELS:
        p=kernels/fn;sha=digest(p)
        if sha!=entries[fn]['sha256']: raise RuntimeError('Kernel integrity mismatch: '+fn)
        spice.furnsh(str(p));used.append({**entries[fn],'sha256_verified':True})
    begin=dt.datetime(2026,1,1,tzinfo=dt.timezone.utc);end=dt.datetime(2028,1,1,tzinfo=dt.timezone.utc)
    count=int((end-begin).total_seconds()/3600)+1
    sun=[]
    for i in range(count):
        stamp=(begin+dt.timedelta(hours=i)).strftime('%Y-%m-%dT%H:%M:%SZ')
        et=spice.str2et(stamp)
        s,_=spice.spkpos('SUN',et,FRAME,'NONE','MOON')
        sun.append(np.round(s,3).tolist())
    # Sample midpoint angular interpolation errors against direct SPICE. This is
    # a numerical interpolation check, not independent astronomical validation.
    checks={}
    for name,arr in [('SUN',sun)]:
        errors=[]
        for i in np.linspace(0,count-2,200,dtype=int):
            stamp=(begin+dt.timedelta(hours=int(i),minutes=30)).strftime('%Y-%m-%dT%H:%M:%SZ')
            actual,_=spice.spkpos(name,spice.str2et(stamp),FRAME,'NONE','MOON')
            interp=(np.array(arr[i])+np.array(arr[i+1]))*.5
            errors.append(math.degrees(math.atan2(np.linalg.norm(np.cross(actual,interp)),np.dot(actual,interp))))
        checks[name.lower()+'_max_sampled_midpoint_angular_error_deg']=max(errors)
    ep={'start_utc':begin.strftime('%Y-%m-%dT%H:%M:%SZ'),'end_utc':end.strftime('%Y-%m-%dT%H:%M:%SZ'),'step_seconds':3600,'sample_count':count,'frame':FRAME,'observer':'MOON','aberration_correction':'NONE','geometry':'instantaneous geometric Moon-centred Cartesian Sun positions','unit':'km','sun_positions_km':sun,'interpolation':'linear Cartesian interpolation; no extrapolation permitted','metadata':{'source':'JPL NAIF SPICE kernels supplied with LunaShift_v5','toolkit':spice.tkvrsn('TOOLKIT'),'spiceypy_version':spice.__version__,'time_conversion':'UTC passed through naif0012.tls to ephemeris time; hourly UTC grid','kernel_set_id':manifest['set_id'],'kernels':used,'validation':{'midpoints_checked':200,**checks},'limitations':'Geometric positions omit light-time and stellar aberration. Body-centred positions must be translated to the selected surface observer before local angles are computed. One-hour interpolation is an approximation; event times also depend on browser sampling and DEM resolution.'}}
    print('Prepared',count,'ephemeris samples',checks,flush=True)
    spice.kclear()
    return ep

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--cache',type=pathlib.Path,required=True);parser.add_argument('--kernels',type=pathlib.Path,required=True);parser.add_argument('--output',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parents[1]/'web'/'data'/'lunar-data.json');args=parser.parse_args()
    args.cache.mkdir(parents=True,exist_ok=True);args.output.parent.mkdir(parents=True,exist_ok=True)
    finepath=download(FINE_URL,args.cache/'Site01_final_adj_5mpp_surf.tif')
    coarsepath=coarse_crop(args.cache)
    colorpath=download(COLOR_URL,args.cache/'moon-color-2k.jpg')
    assetdir=args.output.parents[1]/'assets';assetdir.mkdir(exist_ok=True);shutil.copy2(colorpath,assetdir/'moon-color.jpg')
    fine=DEM(finepath);coarse=DEM(coarsepath)
    metadata={'title':'Connecting Ridge observational terrain demonstration','prepared_at_utc':dt.datetime.now(dt.timezone.utc).isoformat(),'coordinate_frame':FRAME,'reference_radius_m':RADIUS_M,'elevation_units':'metres above reference sphere','latitude_convention':'planetocentric north positive','longitude_convention':'east positive, signed -180 to180 degrees','sources':[
        {'id':'lola-site01','title':'LOLA 5 m Connecting Ridge DEM','url':FINE_URL,'product_page':'https://pgda.gsfc.nasa.gov/products/78','sha256':digest(finepath),'byte_size':finepath.stat().st_size,'native_resolution_m':5,'projection':'South polar stereographic, lon0=0, lat0=-90, spherical radius1737400m','bounds_projected_m':list(fine.bounds),'source_citation':'Barker et al. (2021), Planetary and Space Science203,105119, doi:10.1016/j.pss.2020.105119','note':'Published source surface already interpolates empty LOLA pixels; no additional missing pixel filling is performed by this pipeline.'},
        {'id':'lola-regional','title':'Adjusted LOLA south-polar 80 m DEM','url':COARSE_URL,'product_page':'https://pgda.gsfc.nasa.gov/products/90','sha256':digest(args.cache/'LDEM_80S_80MPP_ADJ.TIF') if (args.cache/'LDEM_80S_80MPP_ADJ.TIF').exists() else None,'derived_crop_sha256':digest(coarsepath),'derived_crop_byte_size':coarsepath.stat().st_size,'native_resolution_m':80,'crop_bounds_projected_m':list(coarse.bounds),'source_citation':'Barker et al. (2023), Planetary Science Journal4,183, doi:10.3847/PSJ/acf3e1; data doi:10.60903/gsfcpgda-lola-spole','note':'Full upstream GeoTIFF downloaded with verified HTTPS; crop covers200km square around the pole. Both raw source and derived crop hashes recorded.'},
        {'id':'moon-color','title':'NASA CGI Moon Kit LROC colour map','url':COLOR_URL,'product_page':'https://svs.gsfc.nasa.gov/4720/','sha256':digest(colorpath),'byte_size':colorpath.stat().st_size,'dimensions':[2048,1024],'role':'Appearance only; never used to calculate surface heights or illumination. NASA map includes inpainting/polar synthesis described on the source page.'}],
        'limitations':['Only three prepared Connecting Ridge points have the packaged terrain profiles. A globe pin outside these points has coordinates, not a new validated terrain analysis.','The 5 m surface is an interpolated LOLA product; 5 m pixel spacing is not 5 m accuracy or a guarantee of obstacle detection.','Numerical horizon coverage is finite:0.5 degree azimuth and up to80km with distance-dependent radial sampling; far terrain has80m native pixels.','At the 5m/80m footprint seam the two independently adjusted products can disagree; no blending is used to hide that difference.','3D display mesh is decimated to20m spacing. Numerical profiles use separately sampled source terrain.','These calculated scenarios are educational engineering estimates. They are not certified landing, safety, or flight products.']}
    for source in metadata['sources']:
        source['retrieved_at_utc']=metadata['prepared_at_utc']
        with urllib.request.urlopen(urllib.request.Request(source['url'],method='HEAD'),timeout=30) as response:
            source['upstream_last_modified']=response.headers.get('Last-Modified')
            source['upstream_etag']=response.headers.get('ETag')
    bundle={'schema_version':6,'name':'LunaShift · Connecting Ridge','coordinate_frame':FRAME,'time_scale':'UTC','metadata':metadata,'sites':build_sites(fine,coarse),'ephemeris':build_ephemeris(args.kernels)}
    tmp=args.output.with_suffix('.tmp');tmp.write_text(json.dumps(bundle,separators=(',',':'),allow_nan=False));tmp.replace(args.output)
    manifest={'bundle':args.output.name,'sha256':digest(args.output),'bytes':args.output.stat().st_size,'source_metadata':metadata,'ephemeris_metadata':bundle['ephemeris']['metadata'],'site_summary':[{k:v for k,v in s.items() if k not in ['terrain','mesh']} for s in bundle['sites']]}
    (args.output.parent/'provenance.json').write_text(json.dumps(manifest,indent=2))
    print('Saved',args.output,args.output.stat().st_size,'bytes',flush=True)
if __name__=='__main__':main()
