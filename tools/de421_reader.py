"""Restricted NAIF DAF type-2 reader for the supplied DE421 SPK/PCK kernels.

This is NOT a replacement for the general SPICE toolkit. It evaluates only the
little-endian type-2 segments used by the packaged manifest. Numerical reference
checks against the independently prepared SPICE Sun vectors are required.
References: NAIF DAF, SPK and PCK Required Reading (URLs in docs/MODEL.md).
"""
from pathlib import Path
import struct, math, datetime as dt
import numpy as np

class Type2Kernel:
    def __init__(self,path):
        self.path=Path(path); self.raw=self.path.read_bytes()
        if self.raw[88:96] != b'LTL-IEEE': raise ValueError('Only little endian DAF supported')
        nd,ni=struct.unpack_from('<ii',self.raw,8)
        f=struct.unpack_from('<i',self.raw,76)[0]
        self.segments={}
        while f:
            off=(f-1)*1024; nxt,_,n=struct.unpack_from('<ddd',self.raw,off)
            size=8*(nd+(ni+1)//2)
            for i in range(int(n)):
                vals=struct.unpack_from('<'+'d'*nd+'i'*ni,self.raw,off+24+i*size)
                ints=vals[nd:]; target=ints[0]; typ=ints[-3]
                if typ!=2: raise ValueError('Only type-2 segments supported')
                start,end=ints[-2:]
                data=np.frombuffer(self.raw,dtype='<f8',count=end-start+1,offset=(start-1)*8)
                initial,interval,record_size,records=data[-4:]
                self.segments[target]=(vals[:2],data,float(initial),float(interval),int(record_size),int(records),ints)
            f=int(nxt)
    def evaluate(self,target,t):
        bounds,data,init,interval,size,count,_=self.segments[target]
        if not bounds[0] <= t <= bounds[1]: raise ValueError('Outside kernel coverage')
        ix=min(count-1,int((t-init)//interval)); record=data[ix*size:(ix+1)*size]
        x=(t-record[0])/record[1]; n=(size-2)//3
        return np.array([np.polynomial.chebyshev.chebval(x,record[2+i*n:2+(i+1)*n]) for i in range(3)])

def utc_to_et(stamp):
    """naif0012.tls 2026-2028 UTC -> TDB. Uses its 37s TAI-UTC and DELTET model."""
    t=dt.datetime.fromisoformat(stamp.replace('Z','+00:00'))
    if not dt.datetime(2026,1,1,tzinfo=dt.timezone.utc) <= t <= dt.datetime(2028,1,1,tzinfo=dt.timezone.utc):
        raise ValueError('Leap-second table evaluated only over 2026-2027')
    naive=(t-dt.datetime(2000,1,1,12,tzinfo=dt.timezone.utc)).total_seconds()
    tt=naive+69.184
    et=tt
    for _ in range(3):
        m=6.239996+1.99096871e-7*et
        et=tt+1.657e-3*math.sin(m+1.671e-2*math.sin(m))
    return et

def rot(a,axis):
    c,s=math.cos(a),math.sin(a)
    if axis==1:return np.array([[1,0,0],[0,c,s],[0,-s,c]])
    if axis==2:return np.array([[c,0,-s],[0,1,0],[s,0,c]])
    return np.array([[c,s,0],[-s,c,0],[0,0,1]])

class LunarEphemeris:
    def __init__(self,kernel_dir):
        root=Path(kernel_dir)
        self.spk=Type2Kernel(root/'de421.bsp'); self.pck=Type2Kernel(root/'moon_pa_de421_1900-2050.bpc')
        sec=math.pi/(180*3600)
        # FK ANGLES describe ME -> PA; transpose for PA -> ME.
        self.pa_to_me=(rot(67.92*sec,3)@rot(78.56*sec,2)@rot(.30*sec,1)).T
    def state(self,utc):
        et=utc_to_et(utc)
        a,b,c=self.pck.evaluate(31006,et)
        j2000_to_me=self.pa_to_me@rot(c,3)@rot(b,1)@rot(a,3)
        moon=self.spk.evaluate(301,et)
        earth=self.spk.evaluate(399,et)-moon
        sun=self.spk.evaluate(10,et)-self.spk.evaluate(3,et)-moon
        # IAU_EARTH orientation from pck00011, NOT ITRF/EOP tracking geometry.
        T=et/(86400*36525); d=et/86400; rad=math.pi/180
        ra=-.641*T*rad; dec=(90-.557*T)*rad; w=(190.147+360.9856235*d)*rad
        j2000_to_earth=rot(w,3)@rot(math.pi/2-dec,1)@rot(ra+math.pi/2,3)
        fixed_earth_to_me=j2000_to_me@j2000_to_earth.T
        return j2000_to_me@sun,j2000_to_me@earth,fixed_earth_to_me
