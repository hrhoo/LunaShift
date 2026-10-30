"""Bounded, allowlisted NASA reads. No arbitrary URL proxy or local file exposure."""
from urllib.request import Request,urlopen
from urllib.parse import urlparse,urljoin
from urllib.error import URLError
import hashlib,json,xml.etree.ElementTree as ET,threading,math,ssl,os,uuid
import time
from decimal import Decimal,InvalidOperation
from pathlib import Path
from .resources import MAP_LAYERS,MOON_TEXTURE
_ALLOWED={'trek.nasa.gov':('/tiles/',),'svs.gsfc.nasa.gov':('/vis/',),
          'pgda.gsfc.nasa.gov':('/data/',),'core2.gsfc.nasa.gov':('/PGDA/',)}
_GATE=threading.BoundedSemaphore(4)
# Bounded lock stripes coordinate writers without retaining one lock per cached tile.
_WRITE_LOCKS=tuple(threading.Lock() for _ in range(64))
_REPLACE_DELAYS=(0.025,0.05,0.1,0.2,0.4)

def tls_context():
    """Keep verification enabled. Use certifi when installed (helpful on macOS)."""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()

def integer_dimension(text, label):
    """NASA grids may encode integer dimensions as 2.0 or 2E0. Never truncate."""
    try:
        value=Decimal(str(text).strip())
        if not value.is_finite() or not 1<=value<=2**31 or value!=value.to_integral_value():
            raise ValueError()
        return int(value)
    except (InvalidOperation,ValueError,TypeError):
        raise ValueError(f'Invalid WMTS {label}: expected a positive whole number, got {text!r}.') from None

def atomic_write(path,data):
    key=os.path.normcase(str(path.resolve()))
    with _WRITE_LOCKS[hash(key)%len(_WRITE_LOCKS)]:
        temp=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
        try:
            temp.write_bytes(data)
            for attempt in range(len(_REPLACE_DELAYS)+1):
                try:
                    os.replace(temp,path)
                    break
                except OSError as exc:
                    # Other processes can briefly hold Windows file locks. Keep
                    # retries bounded and propagate unrelated or persistent errors.
                    if getattr(exc,'winerror',None) not in (5,32,33) or attempt==len(_REPLACE_DELAYS):
                        raise
                    time.sleep(_REPLACE_DELAYS[attempt])
        finally:
            temp.unlink(missing_ok=True)


def allowed_url(url):
    p=urlparse(url)
    return p.scheme=='https' and p.port in (None,443) and not p.username and not p.password and p.hostname in _ALLOWED and any(p.path.startswith(x) for x in _ALLOWED[p.hostname]) and '..' not in p.path

def get_bytes(url,cache_dir,limit=3000000,timeout=18):
    if not allowed_url(url):raise ValueError('Only the documented NASA resource hosts and paths are allowed.')
    folder=Path(cache_dir);folder.mkdir(parents=True,exist_ok=True)
    key=hashlib.sha256(url.encode()).hexdigest();path=folder/(key+'.bin');meta=folder/(key+'.json')
    if path.is_file() and meta.is_file():
        try:
            m=json.loads(meta.read_text());cached=path.read_bytes()
            if cached and len(cached)<=limit:return cached,m['content_type']
        except (OSError,ValueError,KeyError):
            pass  # Incomplete cache entry: fetch again; never crash on a race.
    try:
        with _GATE:
            with urlopen(Request(url,headers={'User-Agent':'LunaShift/0.5.0 educational local prototype'}),timeout=timeout,context=tls_context()) as r:
                if not allowed_url(r.url):raise ValueError('Unexpected redirect outside the allowed source hosts.')
                data=r.read(limit+1);ctype=r.headers.get('Content-Type','application/octet-stream').split(';')[0]
        if len(data)>limit:raise ValueError('Remote response exceeds the configured size limit.')
        if 'text/html' in ctype:raise ValueError('Source returned a web page instead of the requested data (possibly an unavailable product).')
    except (OSError,URLError) as e:
        raise ValueError('NASA source could not be reached: '+str(e)+'. No replacement data were invented.') from None
    atomic_write(path,data);atomic_write(meta,json.dumps({'url':url,'content_type':ctype}).encode())
    return data,ctype

def parse_capabilities(raw,projection='eq'):
    if b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():raise ValueError('XML entities are not supported.')
    try:root=ET.fromstring(raw)
    except ET.ParseError:raise ValueError('Map service did not return valid WMTS capabilities.') from None
    ns={'w':'http://www.opengis.net/wmts/1.0','o':'http://www.opengis.net/ows/1.1'}
    contents=root.find('w:Contents',ns)
    if contents is None:raise ValueError('WMTS Contents missing.')
    layer=contents.find('w:Layer',ns)
    if layer is None:raise ValueError('No WMTS layer available.')
    identifier=layer.findtext('o:Identifier',namespaces=ns)
    styles=layer.findall('w:Style',ns);style=next((v for v in styles if v.get('isDefault','').lower() in ('true','1')), styles[0] if styles else None)
    style_name=style.findtext('o:Identifier',namespaces=ns) if style is not None else 'default'
    resource=next((x for x in layer.findall('w:ResourceURL',ns) if x.attrib.get('resourceType')=='tile'),None)
    if resource is None:raise ValueError('WMTS has no REST tile template.')
    template=resource.attrib.get('template','').replace('http://trek.nasa.gov/','https://trek.nasa.gov/')
    if not allowed_url(template):raise ValueError('WMTS tile host is not allowed.')
    setid=layer.findtext('w:TileMatrixSetLink/w:TileMatrixSet',namespaces=ns)
    matrixset=next((x for x in contents.findall('w:TileMatrixSet',ns) if x.findtext('o:Identifier',namespaces=ns)==setid),None)
    if matrixset is None:raise ValueError('WMTS grid description missing.')
    matrices=[]
    for x in matrixset.findall('w:TileMatrix',ns):
        get=lambda k:x.findtext('w:'+k,namespaces=ns)
        matrices.append({'id':x.findtext('o:Identifier',namespaces=ns),'scale':float(get('ScaleDenominator')),
          'top_left':[float(a) for a in get('TopLeftCorner').split()],
          'tile_width':integer_dimension(get('TileWidth'),'TileWidth'),'tile_height':integer_dimension(get('TileHeight'),'TileHeight'),
          'width':integer_dimension(get('MatrixWidth'),'MatrixWidth'),'height':integer_dimension(get('MatrixHeight'),'MatrixHeight')})
    if not matrices:raise ValueError('WMTS contains no matrix levels.')
    if any(not math.isfinite(m['scale']) or m['scale']<=0 or len(m['top_left'])!=2 or not all(math.isfinite(v) for v in m['top_left']) for m in matrices):
        raise ValueError('Invalid WMTS scale or grid origin.')
    matrices.sort(key=lambda x:-x['scale'])
    if any(x['width']<1 or x['height']<1 or not 1<=x['tile_width']<=4096 or not 1<=x['tile_height']<=4096 for x in matrices):raise ValueError('Unsupported WMTS matrix dimensions.')
    return {'identifier':identifier,'style':style_name,'template':template,'matrix_set':setid,'matrices':matrices,
       'projection':projection,'supported_crs':matrixset.findtext('o:SupportedCRS',namespaces=ns),
       'attribution':'NASA / GSFC / Arizona State University / LROC / JPL Moon Trek'}

def capabilities(layer,cache_dir):
    if layer not in MAP_LAYERS:raise ValueError('Unknown map layer.')
    src=MAP_LAYERS[layer];raw,_=get_bytes(src['url'],cache_dir,timeout=12)
    out=parse_capabilities(raw,src['projection']);out.update(name=src['name'],source_url=src['url'],description=src.get('description',''),coverage=src.get('coverage'));return out

def tile(layer,z,row,col,cache_dir):
    cap=capabilities(layer,cache_dir)
    if not 0<=z<len(cap['matrices']):raise ValueError('Zoom level outside WMTS limits.')
    m=cap['matrices'][z]
    if not 0<=row<m['height'] or not 0<=col<m['width']:raise ValueError('Tile outside layer coverage.')
    url=cap['template']
    for k,v in {'Style':cap['style'],'TileMatrixSet':cap['matrix_set'],'TileMatrix':m['id'],'TileRow':row,'TileCol':col}.items():url=url.replace('{'+k+'}',str(v))
    data,ctype=get_bytes(url,cache_dir)
    if not ctype.startswith('image/'):raise ValueError('Tile response was not an image.')
    return data,ctype
