"""Small JPL Horizons adapter used only for an optional online cross-check.

The prepared LunaShift mission data remain the calculation source. This module
never substitutes synthetic data and never silently replaces the packaged data.
"""
from __future__ import annotations
import csv
import json
import math
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen

API = "https://ssd.jpl.nasa.gov/api/horizons.api"


def _utc(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _parse(text: str):
    if "$$SOE" not in text or "$$EOE" not in text:
        raise ValueError("Horizons did not return an ephemeris table.")
    body = text.split("$$SOE", 1)[1].split("$$EOE", 1)[0]
    rows = []
    for line in body.strip().splitlines():
        cells = [c.strip() for c in next(csv.reader([line]))]
        if not cells or not cells[0]:
            continue
        stamp = None
        date_text = cells[0].replace("A.D.", "").strip()
        for fmt in ("%Y-%b-%d %H:%M:%S.%f", "%Y-%b-%d %H:%M:%S", "%Y-%b-%d %H:%M"):
            try:
                stamp = datetime.strptime(date_text, fmt).replace(tzinfo=timezone.utc)
                break
            except ValueError:
                pass
        if stamp is None:
            raise ValueError(f"Unrecognized Horizons time: {date_text}")
        nums = []
        for cell in cells[1:]:
            if not cell:
                continue
            try:
                nums.append(float(cell))
            except ValueError:
                if cell.lower() in {"n.a.", "nan"}:
                    raise ValueError("Horizons returned unavailable azimuth/elevation values.")
        if len(nums) < 2 or not all(math.isfinite(v) for v in nums[:2]):
            raise ValueError("Horizons response did not contain azimuth and elevation.")
        rows.append({"time_utc": _iso(stamp), "azimuth_deg": nums[0] % 360, "elevation_deg": nums[1]})
    if len(rows) < 2:
        raise ValueError("Horizons returned fewer than two samples.")
    return rows


def _query(site: dict, target: int, start: datetime, stop: datetime, step_min: int):
    params = {
        "format": "json", "COMMAND": str(target), "OBJ_DATA": "NO", "MAKE_EPHEM": "YES",
        "EPHEM_TYPE": "OBSERVER", "CENTER": "coord@301", "COORD_TYPE": "GEODETIC",
        "SITE_COORD": f"{float(site['longitude_deg']):.10f},{float(site['latitude_deg']):.10f},{float(site.get('ground_elevation_m', 0.0))/1000:.9f}",
        "START_TIME": start.strftime("%Y-%m-%d %H:%M:%S"),
        "STOP_TIME": stop.strftime("%Y-%m-%d %H:%M:%S"),
        "STEP_SIZE": f"{step_min} m", "QUANTITIES": "4", "CSV_FORMAT": "YES",
        "ANG_FORMAT": "DEG", "CAL_FORMAT": "CAL", "TIME_DIGITS": "SECONDS",
        "TIME_TYPE": "UT", "APPARENT": "AIRLESS", "EXTRA_PREC": "YES",
    }
    encoded = {k: v if k == "format" else f"'{v}'" for k, v in params.items()}
    url = API + "?" + urlencode(encoded)
    req = Request(url, headers={"User-Agent": "LunaShift/1.0 local mission-planning prototype"})
    with urlopen(req, timeout=40) as response:
        payload = json.loads(response.read(8_000_000).decode("utf-8"))
    if payload.get("error"):
        raise ValueError("JPL Horizons: " + str(payload["error"]))
    return _parse(payload.get("result", "")), url


def fetch_tracks(site: dict, start_utc: str, hours: float = 2, step_min: int = 60,
                 collector_height_m: float = 0, antenna_height_m: float = 0):
    lat, lon = float(site['latitude_deg']), float(site['longitude_deg'])
    ground = float(site.get('ground_elevation_m', 0))
    collector_height_m, antenna_height_m = float(collector_height_m), float(antenna_height_m)
    if not all(math.isfinite(v) for v in (lat, lon, ground, collector_height_m, antenna_height_m, float(hours), float(step_min))):
        raise ValueError('Coordinates, heights and sampling must be finite numbers.')
    if not -90 <= lat <= 90 or not -180 <= lon <= 180:
        raise ValueError('Latitude or longitude is outside its supported range.')
    if not 0 <= collector_height_m <= 1000 or not 0 <= antenna_height_m <= 1000:
        raise ValueError('Equipment height must be from 0 to 1000 metres.')
    start = _utc(start_utc)
    step_min = max(1, min(180, int(step_min)))
    hours = max(1.0, min(240.0, float(hours)))
    intervals = math.ceil(hours * 60 / step_min)
    stop = start + timedelta(minutes=max(2, intervals) * step_min)
    sun_site = {**site, 'ground_elevation_m': ground + collector_height_m}
    earth_site = {**site, 'ground_elevation_m': ground + antenna_height_m}
    sun, sun_url = _query(sun_site, 10, start, stop, step_min)
    earth, earth_url = _query(earth_site, 399, start, stop, step_min)
    if [r["time_utc"] for r in sun] != [r["time_utc"] for r in earth]:
        raise ValueError("Sun and Earth time grids from Horizons do not match.")
    rows = [{
        "time_utc": s["time_utc"],
        "sun_azimuth_deg": s["azimuth_deg"], "sun_elevation_deg": s["elevation_deg"],
        "earth_azimuth_deg": e["azimuth_deg"], "earth_elevation_deg": e["elevation_deg"],
    } for s, e in zip(sun, earth)]
    return rows, {"source": "JPL Horizons", "airless": True, "collector_height_m": collector_height_m, "antenna_height_m": antenna_height_m, "sun_request": sun_url, "earth_request": earth_url}
