"""Optional converter tests on generated rasters, NOT on a downloaded LOLA tile."""
import csv
import tempfile
import unittest
from pathlib import Path
try:
    import numpy as np
    import rasterio
    from rasterio.transform import from_origin
    from pyproj import Transformer,CRS
    OPTIONAL=True
except ImportError:OPTIONAL=False
from tools.convert_geotiff import convert

@unittest.skipUnless(OPTIONAL,'Optional DEM packages not installed; core app does not need them.')
class TerrainConverterTests(unittest.TestCase):
    def setup_files(self,root,earth=False,nodata=False):
        crs=CRS.from_proj4('+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +a=1737400 +b=1737400 +units=m +no_defs') if not earth else CRS.from_epsg(3031)
        tx=Transformer.from_crs(crs.geodetic_crs,crs,always_xy=True)
        x,y=tx.transform(35,-89.5)
        a=np.full((200,200),1200,dtype='float32')
        if nodata:a[:]=-9999
        path=root/'test.tif'
        with rasterio.open(path,'w',driver='GTiff',height=200,width=200,count=1,dtype='float32',crs=crs.to_wkt(),transform=from_origin(x-10000,y+10000,100,100),nodata=-9999) as ds:ds.write(a,1)
        sites=root/'sites.csv';sites.write_text('site_id,name,latitude_deg,longitude_deg\nX,Test,-89.5,35\n')
        return path,sites
    def test_lunar_raster_conversion(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);dem,sites=self.setup_files(root)
            p=convert(dem,sites,root/'result.json','MOON_ME_DE421','Generated test raster',1,10,100)
            self.assertAlmostEqual(p['sites'][0]['ground_elevation_m'],1200)
            self.assertEqual(len(p['sites'][0]['terrain']['azimuth_deg']),36)
            self.assertEqual(p['sites'][0]['track_mode'],'none')
    def test_earth_crs_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);dem,sites=self.setup_files(root,earth=True)
            with self.assertRaises(ValueError):convert(dem,sites,root/'out.json','MOON_ME_DE421','Test',1,10,100)
    def test_nodata_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);dem,sites=self.setup_files(root,nodata=True)
            with self.assertRaises(ValueError):convert(dem,sites,root/'out.json','MOON_ME_DE421','Test',1,10,100)
    def test_coverage_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);dem,sites=self.setup_files(root)
            with self.assertRaises(ValueError):convert(dem,sites,root/'out.json','MOON_ME_DE421','Test',20,10,100)
