"""Geometry, time integration, and bounded mission-repair search.

Standard-library only. Inputs are explicitly either synthetic or user supplied.
Angles use local north-clockwise azimuth and radial-up elevation on a sphere.
This is a finite-resolution learning model, not a flight-certified planner.
"""
from __future__ import annotations
import bisect
import math
from datetime import datetime, timedelta, timezone
from typing import Any

R_MOON = 1_737_400.0
UTC = timezone.utc
MAX_SITES = 30
MAX_SAMPLES = 6000


def number(x: Any, name: str, lo: float | None = None, hi: float | None = None) -> float:
    try:
        value = float(x)
    except (ValueError, TypeError):
        raise ValueError(f"{name} must be a number.") from None
    if not math.isfinite(value) or (lo is not None and value < lo) or (hi is not None and value > hi):
        raise ValueError(f"{name} is outside its allowed range [{lo}, {hi}].")
    return value


def utc(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).strip().replace('Z', '+00:00'))
        except ValueError:
            raise ValueError('Use an ISO date, for example 2026-11-01T00:00:00Z.') from None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)  # UI explicitly labels all unzoned input as UTC.
    return dt.astimezone(UTC)


def iso(dt: datetime) -> str:
    return utc(dt).isoformat(timespec='seconds').replace('+00:00', 'Z')


def destination(lat: float, lon: float, azimuth: float, distance_m: float, radius: float = R_MOON):
    p, l, a = map(math.radians, (lat, lon, azimuth))
    d = distance_m / radius
    p2 = math.asin(max(-1, min(1, math.sin(p)*math.cos(d)+math.cos(p)*math.sin(d)*math.cos(a))))
    l2 = l + math.atan2(math.sin(a)*math.sin(d)*math.cos(p), math.cos(d)-math.sin(p)*math.sin(p2))
    return math.degrees(p2), math.degrees(l2) % 360


def distance_between(a: dict, b: dict) -> float:
    p1, p2 = map(math.radians, (a['latitude_deg'], b['latitude_deg']))
    dl = math.radians(b['longitude_deg'] - a['longitude_deg'])
    u = math.sin((p2-p1)/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R_MOON*math.asin(math.sqrt(min(1, max(0, u))))


def local_xy(lat: float, lon: float, center_lat: float, center_lon: float):
    """Azimuthal-equidistant coordinates on the reference sphere; km."""
    p0, p, dl = map(math.radians, (center_lat, lat, lon-center_lon))
    cc = max(-1, min(1, math.sin(p0)*math.sin(p)+math.cos(p0)*math.cos(p)*math.cos(dl)))
    c = math.acos(cc)
    if c < 1e-12:
        return 0.0, 0.0
    k = c / math.sin(c)
    return (R_MOON*k*math.cos(p)*math.sin(dl)/1000,
            R_MOON*k*(math.cos(p0)*math.sin(p)-math.sin(p0)*math.cos(p)*math.cos(dl))/1000)


def grid_times(start: datetime, duration_h: float, step_min: float):
    duration_h = number(duration_h, 'Mission duration (hours)', 1, 24*60)
    step_min = number(step_min, 'Time step (minutes)', 1, 180)
    n = math.ceil(duration_h*60/step_min)
    if n + 1 > MAX_SAMPLES:
        raise ValueError(f'Too many time samples. Increase the step; limit is {MAX_SAMPLES}.')
    end = start + timedelta(hours=duration_h)
    times = [start + timedelta(minutes=i*step_min) for i in range(n)]
    return times + [end]


def periodic_interp(azimuths: list, values: list, az: float) -> float:
    """Interpolate across 360/0 without an azimuth discontinuity."""
    x = az % 360
    i = bisect.bisect_right(azimuths, x)
    lo, hi = (i-1) % len(values), i % len(values)
    xa, xb = azimuths[lo], azimuths[hi]
    if hi == 0:
        xb += 360
    if i == 0:
        x += 360
    f = (x-xa)/(xb-xa)
    return values[lo]*(1-f)+values[hi]*f


def horizon(site: dict, mast_m: float) -> dict:
    terrain = site.get('terrain')
    if not terrain:
        raise ValueError(f"{site['name']}: no terrain profile. Import a horizon CSV or a DEM bundle.")
    mast_m = number(mast_m, 'Observer height', 0, 30)
    az = terrain['azimuth_deg']
    if terrain['kind'] == 'horizon':
        fixed = float(terrain['observer_height_m'])
        if abs(mast_m-fixed) > 1e-6:
            raise ValueError(f"{site['name']}: imported horizon is fixed at {fixed:g} m. Ray samples are needed to vary height.")
        return {'azimuth_deg': az, 'horizon_deg': terrain['horizon_deg'],
                'blockers': [None]*len(az), 'height_m': mast_m,
                'range_limit_m': terrain.get('range_limit_m')}
    radius = terrain.get('radius_m', R_MOON)
    z0 = site['ground_elevation_m']
    # Unmeasured terrain beyond the sampled radius is continued as a smooth sphere
    # at local ground elevation. This approximation is prominently disclosed.
    floor = -math.degrees(math.acos((radius+z0)/(radius+z0+mast_m))) if mast_m else 0.0
    result, blockers = [], []
    distances = terrain['distances_m']
    geom = [(math.sin(d/radius), math.cos(d/radius)) for d in distances]
    for ai, row in enumerate(terrain['elevations_m']):
        best, block = floor, None
        for j, z in enumerate(row):
            sn, cs = geom[j]
            horizontal = (radius+z)*sn
            vertical = (radius+z)*cs-(radius+z0+mast_m)
            angle = math.degrees(math.atan2(vertical, horizontal))
            if angle > best:
                best = angle
                block = {'distance_m': distances[j], 'elevation_m': z,
                         'azimuth_deg': az[ai], 'horizon_deg': angle}
        if block:
            lat, lon = destination(site['latitude_deg'], site['longitude_deg'], block['azimuth_deg'], block['distance_m'], radius)
            block.update(latitude_deg=lat, longitude_deg=lon)
        result.append(best)
        blockers.append(block)
    return {'azimuth_deg': az, 'horizon_deg': result, 'blockers': blockers,
            'height_m': mast_m, 'range_limit_m': terrain.get('range_limit_m', max(distances))}


def synthetic_track(site: dict, times: list[datetime]) -> list[dict]:
    """Invented training curves, NOT ephemerides; never used as a fallback."""
    epoch = datetime(2026, 11, 1, tzinfo=UTC)
    lat = site['latitude_deg']
    phase = math.radians(site['longitude_deg']-35)
    rows = []
    for dt in times:
        t = (dt-epoch).total_seconds()/3600
        sun_az = (58+360*t/708.7+math.degrees(phase)) % 360
        sun_el = 1.15+0.5*math.sin(2*math.pi*t/708.7)+0.10*(lat+89.5)
        earth_az = (24+7*math.sin(2*math.pi*t/655.7)+math.degrees(phase)) % 360
        earth_el = 2.25+1.5*math.sin(2*math.pi*t/655.7+0.8)
        rows.append(dict(time_utc=iso(dt), sun_azimuth_deg=sun_az,
                         sun_elevation_deg=sun_el, earth_azimuth_deg=earth_az,
                         earth_elevation_deg=earth_el))
    return rows


def track_at(site: dict, times: list[datetime]):
    if site.get('track_mode') == 'synthetic':
        return synthetic_track(site, times)
    rows = site.get('ephemeris', [])
    if len(rows) < 2:
        raise ValueError(f"{site['name']}: no Sun/Earth time series. Fetch Horizons or import an ephemeris CSV.")
    src = [utc(r['time_utc']).timestamp() for r in rows]
    if times[0].timestamp() < src[0]-1e-3 or times[-1].timestamp() > src[-1]+1e-3:
        raise ValueError(f"{site['name']}: requested dates exceed imported data ({rows[0]['time_utc']} to {rows[-1]['time_utc']}). No extrapolation was performed.")
    max_gap = float(site.get('track_max_gap_min', 180))*60
    output = []
    for dt in times:
        ts = dt.timestamp()
        i = min(len(src)-2, max(0, bisect.bisect_right(src, ts)-1))
        gap = src[i+1]-src[i]
        if gap > max_gap+1e-3:
            raise ValueError(f'{site["name"]}: a time-series gap exceeds {max_gap/60:g} minutes. Import a denser, complete series.')
        f = max(0, min(1, (ts-src[i])/gap))
        out = {'time_utc': iso(dt)}
        for key in ['sun_azimuth_deg', 'sun_elevation_deg', 'earth_azimuth_deg', 'earth_elevation_deg']:
            a, b = rows[i][key], rows[i+1][key]
            if 'azimuth' in key:
                out[key] = (a+f*((b-a+180)%360-180)) % 360
            else:
                out[key] = a+(b-a)*f
        for key in ['sun_distance_km','earth_distance_km','sun_angular_diameter_arcsec','earth_angular_diameter_arcsec']:
            if key in rows[i] and key in rows[i+1]:out[key]=rows[i][key]+f*(rows[i+1][key]-rows[i][key])
        output.append(out)
    return output


def positive_intervals(hours: list[float], clearance: list[float]):
    """Positive spans of the piecewise-linear sampled clearance, in hours."""
    spans = []
    for i in range(len(hours)-1):
        a, b, va, vb = hours[i], hours[i+1], clearance[i], clearance[i+1]
        if va <= 0 and vb <= 0:
            continue
        left, right = a, b
        if va <= 0 < vb:
            left = a+(b-a)*(-va)/(vb-va)
        elif vb <= 0 < va:
            right = a+(b-a)*va/(va-vb)
        if right-left < 1e-12:
            continue
        if spans and abs(spans[-1][1]-left) < 1e-9:
            spans[-1][1] = right
        else:
            spans.append([left, right])
    return spans


def complement(spans: list, duration: float):
    out, at = [], 0.0
    for a, b in spans:
        if a > at+1e-9:
            out.append([at, a])
        at = b
    if duration > at+1e-9:
        out.append([at, duration])
    return out


def intersection(a: list, b: list):
    result, i, j = [], 0, 0
    while i < len(a) and j < len(b):
        lo, hi = max(a[i][0], b[j][0]), min(a[i][1], b[j][1])
        if hi > lo:
            result.append([lo, hi])
        if a[i][1] < b[j][1]:
            i += 1
        else:
            j += 1
    return result


def validate_params(raw: dict):
    start = utc(raw.get('start_utc', '2026-11-01T00:00:00Z'))
    p = {
        'start_utc': iso(start),
        'duration_h': number(raw.get('duration_h', 120), 'Mission duration', 1, 1440),
        'step_min': number(raw.get('step_min', 60), 'Time step', 1, 180),
        'height_m': number(raw.get('height_m', 2), 'Observer height', 0, 30),
        'min_sun_pct': number(raw.get('min_sun_pct', 35), 'Minimum sunlight', 0, 100),
        'max_dark_h': number(raw.get('max_dark_h', 30), 'Maximum darkness', 0, 1440),
        'max_earth_gap_h': number(raw.get('max_earth_gap_h', 36), 'Maximum Earth-hidden gap', 0, 1440),
        'max_slope_deg': number(raw.get('max_slope_deg', 12), 'Maximum slope', 0, 90),
        'check_slope': bool(raw.get('check_slope', True)),
        'margin_deg': number(raw.get('margin_deg', 0.05), 'Clearance safety margin', 0, 5),
    }
    grid_times(start, p['duration_h'], p['step_min'])
    return p


def evaluate(site: dict, p: dict, profile: dict | None = None, detailed=True):
    start = utc(p['start_utc'])
    times = grid_times(start, p['duration_h'], p['step_min'])
    profile = profile or horizon(site, p['height_m'])
    tracks = track_at(site, times)
    hours = [(t-start).total_seconds()/3600 for t in times]
    curves = {}
    spans = {}
    for body in ['sun', 'earth']:
        skyline = [periodic_interp(profile['azimuth_deg'], profile['horizon_deg'], r[f'{body}_azimuth_deg']) for r in tracks]
        clear = [r[f'{body}_elevation_deg']-h-p['margin_deg'] for r, h in zip(tracks, skyline)]
        curves[body] = {'horizon_deg': skyline, 'clearance_deg': clear}
        spans[body] = positive_intervals(hours, clear)
    dark = complement(spans['sun'], p['duration_h'])
    earth_hidden = complement(spans['earth'], p['duration_h'])
    both = intersection(spans['sun'], spans['earth'])
    total = lambda seq: sum(b-a for a, b in seq)
    longest = lambda seq: max((b-a for a, b in seq), default=0)
    m = {'sunlight_pct': 100*total(spans['sun'])/p['duration_h'],
         'sunlight_h': total(spans['sun']), 'longest_dark_h': longest(dark),
         'earth_visible_pct': 100*total(spans['earth'])/p['duration_h'],
         'earth_visible_h': total(spans['earth']), 'longest_earth_gap_h': longest(earth_hidden),
         'both_visible_h': total(both), 'slope_deg': site.get('slope_deg')}
    fail, unknown = [], []
    if m['sunlight_pct']+1e-8 < p['min_sun_pct']:
        fail.append(f"Sunlight {m['sunlight_pct']:.1f}% is below {p['min_sun_pct']:g}%.")
    if m['longest_dark_h'] > p['max_dark_h']+1e-8:
        fail.append(f"Longest darkness {m['longest_dark_h']:.1f} h exceeds {p['max_dark_h']:g} h.")
    if m['longest_earth_gap_h'] > p['max_earth_gap_h']+1e-8:
        fail.append(f"Longest Earth-hidden gap {m['longest_earth_gap_h']:.1f} h exceeds {p['max_earth_gap_h']:g} h.")
    if p['check_slope']:
        if m['slope_deg'] is None:
            unknown.append('No slope value: disable the slope filter only for a visibility-only study, or supply a measured slope.')
        elif m['slope_deg'] > p['max_slope_deg']:
            fail.append(f"Slope {m['slope_deg']:.1f} degrees exceeds {p['max_slope_deg']:g} degrees.")
    status = 'fail' if fail else ('unknown' if unknown else 'pass')
    result = {'site_id': site['id'], 'site_name': site['name'], 'status': status,
              'metrics': m, 'reasons': fail+unknown, 'parameters': p,
              'synthetic_terrain': bool(site.get('terrain', {}).get('synthetic', False)),
              'synthetic_slope': bool(site.get('slope_synthetic',False)),
              'slope_source':site.get('slope_source','User supplied; not independently checked'),
              'synthetic_track': site.get('track_mode') == 'synthetic' or bool(site.get('track_synthetic',False)),
              'terrain_source': site.get('terrain', {}).get('source', 'Not supplied'),
              'track_source': site.get('track_source', 'Synthetic teaching curves' if site.get('track_mode') == 'synthetic' else 'Not supplied')}
    if detailed:
        result.update(hours=hours, tracks=tracks, curves=curves, profile=profile,
                      intervals={'sun': spans['sun'], 'earth': spans['earth'], 'both': both,
                                 'dark': dark, 'earth_hidden': earth_hidden})
    return result


def analyze(project: dict, raw: dict):
    p = validate_params(raw)
    rows = []
    for site in project['sites']:
        try:
            rows.append(evaluate(site, p))
        except ValueError as e:
            rows.append({'site_id': site['id'], 'site_name': site['name'], 'status': 'unknown', 'reasons': [str(e)], 'metrics': None})
    return {'parameters': p, 'results': rows,
            'model_note': 'Body-centre visibility; piecewise-linear crossings; finite terrain range. Not electrical power, a ground-station link, or certified landing safety.'}


def repair(project: dict, raw: dict):
    p = validate_params(raw)
    preferred = next((s for s in project['sites'] if s['id'] == raw.get('preferred_site_id')), project['sites'][0])
    max_delay = number(raw.get('max_delay_h', 72), 'Maximum delay', 0, 720)
    delay_step = number(raw.get('delay_step_h', 12), 'Delay increment', 1, 168)
    max_height = number(raw.get('max_height_m', 10), 'Maximum height', p['height_m'], 30)
    height_step = number(raw.get('height_step_m', 4), 'Height increment', 0.5, 30)
    weights = {k: number(raw.get(k, 1), k, 0, 100) for k in ('weight_move', 'weight_delay', 'weight_height')}
    delays = [round(i*delay_step, 9) for i in range(math.floor(max_delay/delay_step)+1)]
    heights = [round(p['height_m']+i*height_step, 9) for i in range(math.floor((max_height-p['height_m'])/height_step)+1)]
    if heights[-1] < max_height-1e-8:
        heights.append(max_height)
    sites = project['sites'] if raw.get('allow_relocation',True) else [preferred]
    if delays[-1] < max_delay-1e-8:
        delays.append(max_delay)
    count = len(sites)*len(delays)*len(heights)
    if count > 3000:
        raise ValueError(f'Search has {count} combinations; use coarser increments (limit 3000).')
    sample_work=count*(math.ceil(p['duration_h']*60/p['step_min'])+1)
    if sample_work>2000000:
        raise ValueError('This search exceeds 2 million time evaluations. Increase the time step or reduce the search range.')
    feasible, envelope, evaluated, missing = [], [], 0, 0
    failures = []
    for site in sites:
        move_km = distance_between(preferred, site)/1000
        for height in heights:
            try:
                profile = horizon(site, height)
            except ValueError as e:
                missing += len(delays)
                if height == heights[0]:
                    for delay in delays:
                        envelope.append({'site_id': site['id'], 'site_name': site['name'], 'delay_h': delay, 'status': 'unknown', 'reason': str(e)})
                continue
            for delay in delays:
                q = dict(p, start_utc=iso(utc(p['start_utc'])+timedelta(hours=delay)), height_m=height)
                try:
                    r = evaluate(site, q, profile=profile, detailed=False)
                    evaluated += 1
                except ValueError as e:
                    missing += 1
                    r = {'status': 'unknown', 'reasons': [str(e)], 'metrics': None}
                if height == heights[0]:
                    envelope.append({'site_id': site['id'], 'site_name': site['name'], 'delay_h': delay,
                                     'status': r['status'], 'reason': ' '.join(r['reasons']), 'metrics': r['metrics']})
                if r['status'] == 'pass':
                    cost = weights['weight_move']*move_km+weights['weight_delay']*delay/24+weights['weight_height']*(height-p['height_m'])/5
                    feasible.append({'site_id': site['id'], 'site_name': site['name'],
                                     'move_km': move_km, 'delay_h': delay, 'height_m': height,
                                     'height_increase_m': height-p['height_m'], 'cost': cost,
                                     'start_utc': q['start_utc'], 'metrics': r['metrics']})
                elif r['status'] == 'fail':
                    failures.extend(r['reasons'])
    feasible.sort(key=lambda r: (r['cost'], r['move_km'], r['delay_h'], r['height_m']))
    # Pareto over modification magnitudes, not over an invented universal utility.
    frontier = []
    for item in feasible:
        vec = (item['move_km'], item['delay_h'], item['height_increase_m'])
        dominated = any(all(x <= y+1e-9 for x,y in zip((a['move_km'],a['delay_h'],a['height_increase_m']), vec)) and
                        any(x < y-1e-9 for x,y in zip((a['move_km'],a['delay_h'],a['height_increase_m']), vec))
                        for a in feasible)
        if not dominated:
            frontier.append(item)
    return {'best': feasible[0] if feasible else None, 'alternatives': feasible[:20], 'pareto': frontier[:50],
            'envelope': envelope, 'tested_combinations': count, 'evaluated': evaluated,
            'missing_combinations': missing, 'passing_combinations': len(feasible),
            'delays_h': delays, 'heights_m': heights, 'preferred_site_id': preferred['id'],
            'cost_definition': 'weight_move * move_km + weight_delay * delay_h/24 + weight_height * height_increase_m/5',
            'scope': 'Minimum cost among the tested sites, delay grid, and height grid only. No continuous/global optimum or success probability is claimed.'}
