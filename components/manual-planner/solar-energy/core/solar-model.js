/**
 * LunaShift — pure, dependency-free browser solar / energy model.
 * The data and numerical boundaries are documented in docs/MODEL.md.
 * All source positions use the Moon-centred MOON_ME_DE421 frame, kilometres.
 * Terrain elevations and arc distances use metres. Azimuth is clockwise north.
 */
import {prepareScattering, scatteredIrradiance, validateScattering} from './scattered-light.js';
export const CONSTANTS = Object.freeze({
  lunarRadiusM: 1737400,
  solarRadiusKm: 695700,
  auKm: 149597870.7,
  irradianceAtAuWm2: 1361,
  solarDiscStrips: 65,
  maxSamples: 30000,
});

export const DEFAULT_SETTINGS = Object.freeze({
  durationHours: 120,
  stepMinutes: 30,
  heightM: 2,
  areaM2: 4,
  panelMode: 'vertical_tracking',
  tiltDeg: 90,
  azimuthDeg: 0,
  efficiency: 0.28,
  lossFactor: 0.9,
  terrainReflectance: 0,
  scatterResolution: 24,
  scatterTerrainStride: 4,
  scatterSunSamples: 7,
  loadW: 100,
  batteryKWh: 8,
  initialSocPct: 90,
  reservePct: 20,
  chargeEfficiency: 0.95,
  dischargeEfficiency: 0.95,
});

const DEG = Math.PI / 180;
const HOUR_MS = 3600000;
const EPS_WH = 1e-8;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const wrap = v => ((v % 360) + 360) % 360;
const finite = (v, label, lo = -Infinity, hi = Infinity) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) {
    throw new RangeError(`${label} must be a finite number between ${lo} and ${hi}.`);
  }
  return v;
};

function utcMillis(value, label = 'Time') {
  if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new RangeError(`${label} must be an ISO date and time with an explicit UTC offset.`);
  }
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.exec(value);
  const t = Date.parse(value);
  if (!parts || !Number.isFinite(t)) throw new RangeError(`${label} is not a valid date and time.`);
  const [, y, m, d, h, minute, second = '0'] = parts.map((v, i) => i ? Number(v) : v);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (m < 1 || m > 12 || d < 1 || d > days || h > 23 || minute > 59 || second > 59) {
    throw new RangeError(`${label} is not a valid calendar date and time.`);
  }
  return t;
}
const iso = millis => new Date(millis).toISOString();

function validateSite(site) {
  if (!site || typeof site !== 'object') throw new TypeError('A lunar site is required.');
  finite(site.latitude_deg, 'Site latitude', -90, 90);
  finite(site.longitude_deg, 'Site longitude', -360, 360);
  finite(site.ground_elevation_m, 'Site ground elevation', -100000, 100000);
}

function sortedNumbers(values, label, lower, upper, minimum = 1) {
  if (!Array.isArray(values) || values.length < minimum) {
    throw new TypeError(`${label} must contain at least ${minimum} samples.`);
  }
  values.forEach((v, i) => {
    finite(v, label, lower, upper);
    if (i && v <= values[i - 1]) throw new RangeError(`${label} must be strictly increasing.`);
  });
}

/** Periodic linear interpolation, including the 360/0 degree seam. */
export function interpolateHorizon(azimuths, elevations, azimuthDeg) {
  const n = azimuths.length;
  if (n === 1) return elevations[0];
  let x = wrap(azimuthDeg);
  let low = 0, high = n;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (azimuths[mid] <= x) low = mid + 1;
    else high = mid;
  }
  const a = (low + n - 1) % n, b = low % n;
  const xa = azimuths[a], xb = azimuths[b] + (b === 0 ? 360 : 0);
  if (low === 0) x += 360;
  const fraction = (x - xa) / (xb - xa);
  return elevations[a] + (elevations[b] - elevations[a]) * fraction;
}

function localAxes(site) {
  const lat = site.latitude_deg * DEG, lon = site.longitude_deg * DEG;
  const slat = Math.sin(lat), clat = Math.cos(lat), slon = Math.sin(lon), clon = Math.cos(lon);
  return {
    east: [-slon, clon, 0],
    north: [-slat * clon, -slat * slon, clat],
    up: [clat * clon, clat * slon, slat],
  };
}

// Cache absolute Moon-fixed positions, independent of equipment height and time.
// The packaged data contains site-centred geodesic rays, not a shared DEM raster.
// Preserve those samples and their coverage instead of treating a site's rays as
// adequate coverage for another observer. Weak keys release replaced datasets.
const terrainPositionCache = new WeakMap();
function terrainPositions(site, radius, axes) {
  const terrain = site.terrain, azimuth = terrain.azimuth_deg, distances = terrain.distances_m;
  sortedNumbers(distances, 'Terrain distances', Number.MIN_VALUE, radius * Math.PI / 2);
  if (!Array.isArray(terrain.elevations_m) || terrain.elevations_m.length !== azimuth.length) {
    throw new TypeError('Terrain elevation rows must match the azimuth samples.');
  }
  let cached = terrainPositionCache.get(terrain);
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  if (!cached || cached.latitude !== site.latitude_deg || cached.longitude !== site.longitude_deg ||
      cached.radius !== radius || !same(cached.azimuth, azimuth) || !same(cached.distances, distances)) {
    const count = azimuth.length * distances.length;
    cached = {latitude: site.latitude_deg, longitude: site.longitude_deg, radius,
      azimuth: azimuth.slice(), distances: distances.slice(),
      positions: new Float64Array(count * 3), elevations: new Float64Array(count).fill(NaN)};
    terrainPositionCache.set(terrain, cached);
  }
  const arcs = distances.map(d => [Math.sin(d / radius), Math.cos(d / radius)]);
  terrain.elevations_m.forEach((row, i) => {
    if (!Array.isArray(row) || row.length !== distances.length) {
      throw new TypeError(`Terrain ray ${i + 1} does not match the distance samples.`);
    }
    const a = azimuth[i] * DEG;
    const tangent = axes.east.map((v, k) => Math.sin(a) * v + Math.cos(a) * axes.north[k]);
    row.forEach((z, j) => {
      finite(z, 'Terrain elevation', -100000, 100000);
      const index = i * distances.length + j;
      if (cached.elevations[index] === z) return;
      // Great-circle destination in Cartesian form: P = (R + z) * unit(lat, lon).
      // This also remains well-defined at the poles, without inverse projection.
      const [sinArc, cosArc] = arcs[j];
      for (let k = 0; k < 3; k++) {
        cached.positions[index * 3 + k] = (radius + z) * (cosArc * axes.up[k] + sinArc * tangent[k]);
      }
      cached.elevations[index] = z;
    });
  });
  return cached.positions;
}

/** Rebuild the skyline from Moon-centred terrain positions and an observer in metres. */
export function horizonForSite(site, heightM = 0) {
  validateSite(site);
  finite(heightM, 'Collector height', 0, 1000);
  const terrain = site.terrain;
  if (!terrain || typeof terrain !== 'object') throw new TypeError(`${site.name || site.id || 'Site'} has no terrain rays.`);
  if (terrain.frame && terrain.frame !== 'MOON_ME_DE421') {
    throw new RangeError('Terrain positions must use the MOON_ME_DE421 lunar frame.');
  }
  const azimuth = terrain.azimuth_deg;
  sortedNumbers(azimuth, 'Terrain azimuths', 0, 360 - 1e-10, 2);
  const radius = terrain.radius_m ?? CONSTANTS.lunarRadiusM;
  finite(radius, 'Lunar reference radius', 1000000, 2000000);
  const groundRadius = radius + site.ground_elevation_m;
  let smoothHorizonDeg = null;
  let elevations, blockers, rangeLimitM;

  if (terrain.kind === 'horizon') {
    finite(terrain.observer_height_m, 'Imported horizon observer height', 0, 1000);
    if (Math.abs(heightM - terrain.observer_height_m) > 1e-8) {
      throw new RangeError('This imported skyline is fixed at one height; terrain rays are required to change height.');
    }
    if (!Array.isArray(terrain.horizon_deg) || terrain.horizon_deg.length !== azimuth.length) {
      throw new TypeError('Imported horizon elevations must match its azimuths.');
    }
    elevations = terrain.horizon_deg.map(v => finite(v, 'Horizon elevation', -90, 90));
    blockers = elevations.map(() => null);
    rangeLimitM = terrain.range_limit_m ?? null;
  } else if (terrain.kind === 'rays') {
    const distances = terrain.distances_m;
    const axes = localAxes(site);
    const positions = terrainPositions(site, radius, axes);
    rangeLimitM = distances[distances.length - 1];
    // Unmeasured far terrain is a reference-radius sphere ONLY beyond the last
    // measured ray. A sphere at the site's own altitude would manufacture a
    // surrounding ridge and erase real negative horizons at elevated sites.
    const observerRadius = groundRadius + heightM;
    const observer = axes.up.map(v => v * observerRadius);
    const tangentArc = observerRadius >= radius ? Math.acos(radius / observerRadius) : 0;
    const farArc = Math.max(rangeLimitM / radius, tangentArc);
    smoothHorizonDeg = Math.atan2(radius * Math.cos(farArc) - observerRadius, radius * Math.sin(farArc)) / DEG;
    blockers = [];
    elevations = terrain.elevations_m.map((row, i) => {
      let best = smoothHorizonDeg, bestIndex = -1;
      // Each packaged ray already samples a directional bin centre (0.5 degrees
      // in the real bundle). No rebinning or invented filling of empty bins.
      row.forEach((z, j) => {
        const index = (i * distances.length + j) * 3;
        const x = positions[index] - observer[0];
        const y = positions[index + 1] - observer[1];
        const zRelative = positions[index + 2] - observer[2];
        const east = x * axes.east[0] + y * axes.east[1] + zRelative * axes.east[2];
        const north = x * axes.north[0] + y * axes.north[1] + zRelative * axes.north[2];
        const up = x * axes.up[0] + y * axes.up[1] + zRelative * axes.up[2];
        const angle = Math.atan2(up, Math.hypot(east, north)) / DEG;
        if (angle > best) {
          best = angle;
          bestIndex = j;
        }
      });
      let blocker = null;
      if (bestIndex >= 0) {
        const index = (i * distances.length + bestIndex) * 3;
        const x = positions[index], y = positions[index + 1], z = positions[index + 2];
        blocker = {distanceM: distances[bestIndex], elevationM: row[bestIndex], azimuthDeg: azimuth[i], horizonDeg: best,
          latitudeDeg: Math.atan2(z, Math.hypot(x, y)) / DEG,
          longitudeDeg: wrap(Math.atan2(y, x) / DEG + 180) - 180};
      }
      blockers.push(blocker);
      return best;
    });
    rangeLimitM = distances[distances.length - 1];
  } else {
    throw new TypeError('Terrain must contain rays or a documented fixed-height horizon.');
  }
  const az = azimuth.slice();
  return {
    azimuthDeg: az, elevationDeg: elevations, heightM, rangeLimitM, smoothHorizonDeg, blockers,
    minDeg: Math.min(...elevations), maxDeg: Math.max(...elevations),
    beyondRangeAssumption: terrain.kind === 'rays' ? 'reference_radius_sphere' : 'supplied_fixed_horizon',
    method: terrain.kind === 'rays' ? 'moon_centered_vectors' : 'supplied_fixed_horizon',
    // Aliases keep the supplied v5 terrain convention useful to downstream views.
    azimuth_deg: az, horizon_deg: elevations, height_m: heightM, range_limit_m: rangeLimitM,
  };
}

function ephemerisInfo(bundle, checkAll = false) {
  const e = bundle?.ephemeris;
  const vectors = e?.sun_positions_km ?? e?.sun_position_km;
  if (!e || !Array.isArray(vectors) || vectors.length < 2) {
    throw new TypeError('At least two Moon-centred Sun ephemeris positions are required.');
  }
  if ((e.frame && e.frame !== 'MOON_ME_DE421') || (bundle.coordinate_frame && bundle.coordinate_frame !== 'MOON_ME_DE421')) {
    throw new RangeError('Terrain and Sun positions must use the MOON_ME_DE421 lunar frame.');
  }
  if (e.unit && e.unit !== 'km') throw new RangeError('Sun ephemeris positions must be in kilometres (km).');
  const start = utcMillis(e.start_utc, 'Ephemeris start');
  const step = finite(e.step_seconds, 'Ephemeris step', Number.MIN_VALUE) * 1000;
  const end = start + step * (vectors.length - 1);
  if (!Number.isFinite(end)) throw new RangeError('Ephemeris coverage is invalid.');
  if (checkAll) vectors.forEach(validatePosition);
  const earthVectors = e.earth_positions_km;
  if (earthVectors && (!Array.isArray(earthVectors) || earthVectors.length !== vectors.length)) {
    throw new TypeError('Earth positions must match the Sun ephemeris sampling.');
  }
  if (checkAll && earthVectors) earthVectors.forEach(v => {
    if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite) || Math.hypot(...v) <= 8000) {
      throw new TypeError('Earth positions must contain three finite kilometre coordinates outside the Moon.');
    }
  });
  return {start, end, step, vectors, earthVectors};
}

function validatePosition(vector) {
  if (!Array.isArray(vector) || vector.length !== 3 || !vector.every(Number.isFinite)) {
    throw new TypeError('Each Sun ephemeris position must contain three finite kilometre coordinates.');
  }
  if (Math.hypot(...vector) <= CONSTANTS.solarRadiusKm + 2000) {
    throw new RangeError('Sun ephemeris distances are not physically valid kilometre positions.');
  }
}

function geometryAt(info, site, time, heightM) {
  if (time < info.start || time > info.end) {
    throw new RangeError(`Time is outside the supplied ephemeris (${iso(info.start)} to ${iso(info.end)}).`);
  }
  const position = clamp((time - info.start) / info.step, 0, info.vectors.length - 1);
  const index = Math.min(Math.floor(position), info.vectors.length - 2);
  const fraction = position - index;
  const a = info.vectors[index], b = info.vectors[index + 1];
  validatePosition(a); validatePosition(b);
  const sun = a.map((v, i) => v + (b[i] - v) * fraction);
  const earthA = info.earthVectors?.[index], earthB = info.earthVectors?.[index + 1];
  const earthPositionKm = earthA && earthB ? earthA.map((v, i) => v + (earthB[i] - v) * fraction) : undefined;
  const lat = site.latitude_deg * DEG, lon = site.longitude_deg * DEG;
  const slat = Math.sin(lat), clat = Math.cos(lat), slon = Math.sin(lon), clon = Math.cos(lon);
  const radiusKm = ((site.terrain?.radius_m ?? CONSTANTS.lunarRadiusM) + site.ground_elevation_m + heightM) / 1000;
  const observer = [radiusKm * clat * clon, radiusKm * clat * slon, radiusKm * slat];
  const v = sun.map((coordinate, i) => coordinate - observer[i]);
  const east = -slon * v[0] + clon * v[1];
  const north = -slat * clon * v[0] - slat * slon * v[1] + clat * v[2];
  const up = clat * clon * v[0] + clat * slon * v[1] + slat * v[2];
  const distanceKm = Math.hypot(east, north, up);
  return {
    utc: iso(time), sunAzDeg: wrap(Math.atan2(east, north) / DEG),
    sunElDeg: Math.atan2(up, Math.hypot(east, north)) / DEG,
    distanceKm, angularRadiusDeg: Math.asin(CONSTANTS.solarRadiusKm / distanceKm) / DEG,
    irradianceWm2: CONSTANTS.irradianceAtAuWm2 * (CONSTANTS.auKm / distanceKm) ** 2,
    directionENU: [east / distanceKm, north / distanceKm, up / distanceKm],
    sunPositionKm: sun, observerPositionKm: observer, earthPositionKm,
  };
}

/** Observer-to-Sun geometry. The optional height raises the observer above ground. */
export function solarGeometry(bundle, site, isoTime, heightM = 0) {
  validateSite(site);
  finite(heightM, 'Collector height', 0, 1000);
  return geometryAt(ephemerisInfo(bundle), site, utcMillis(isoTime), heightM);
}

/** Uniform disc fraction above a locally flat horizon; useful analytical reference. */
export function discFraction(clearanceDeg, angularRadiusDeg) {
  finite(clearanceDeg, 'Solar clearance');
  finite(angularRadiusDeg, 'Solar angular radius', Number.MIN_VALUE, 90);
  const x = clearanceDeg / angularRadiusDeg;
  if (x >= 1) return 1;
  if (x <= -1) return 0;
  return (Math.acos(-x) + x * Math.sqrt(Math.max(0, 1 - x * x))) / Math.PI;
}

const DISC_STRIPS = Array.from({length: CONSTANTS.solarDiscStrips}, (_, i) => {
  const x = -1 + 2 * (i + 0.5) / CONSTANTS.solarDiscStrips;
  return {x, halfY: Math.sqrt(1 - x * x)};
});
const DISC_AREA = DISC_STRIPS.reduce((sum, strip) => sum + 2 * strip.halfY, 0);

function discVisibility(az, el, radius, horizon) {
  const at = angle => interpolateHorizon(horizon.azimuthDeg, horizon.elevationDeg, angle);
  const centreHorizon = at(az);
  const upperCentre = el + radius - centreHorizon;
  if (horizon.maxDeg - horizon.minDeg < 1e-12) {
    return {fraction: discFraction(el - centreHorizon, radius), upperClearanceDeg: upperCentre};
  }
  // These global bounds avoid integrating a disc that is certainly all visible/hidden.
  if (el - radius >= horizon.maxDeg) return {fraction: 1, upperClearanceDeg: upperCentre};
  if (el + radius <= horizon.minDeg) return {fraction: 0, upperClearanceDeg: upperCentre};
  const cosine = Math.max(Math.cos(el * DEG), 1e-6);
  let area = 0, upperClearance = -Infinity;
  for (const {x, halfY} of DISC_STRIPS) {
    const skyline = at(az + radius * x / cosine);
    const cutoff = (skyline - el) / radius;
    area += clamp(halfY - cutoff, 0, 2 * halfY);
    upperClearance = Math.max(upperClearance, el + radius * halfY - skyline);
  }
  return {fraction: clamp(area / DISC_AREA, 0, 1), upperClearanceDeg: upperClearance};
}

/** Disc quadrature across a varying skyline. Horizon is a horizonForSite result. */
export function solarDiscFraction(sunAzDeg, sunElDeg, angularRadiusDeg, horizon) {
  finite(sunAzDeg, 'Sun azimuth');
  finite(sunElDeg, 'Sun elevation', -90, 90);
  finite(angularRadiusDeg, 'Solar angular radius', Number.MIN_VALUE, 10);
  return discVisibility(sunAzDeg, sunElDeg, angularRadiusDeg, horizon).fraction;
}

/** Cosine projection of incident direct sunlight onto the panel normal. */
export function panelIncidence(sunAzDeg, sunElDeg, settings) {
  const el = sunElDeg * DEG;
  if (settings.panelMode === 'tracking') return 1;
  if (settings.panelMode === 'vertical_tracking') return Math.max(0, Math.cos(el));
  if (settings.panelMode === 'horizontal') return Math.max(0, Math.sin(el));
  if (settings.panelMode !== 'fixed') throw new RangeError('Unsupported panel mode.');
  const tilt = settings.tiltDeg * DEG, relativeAz = (sunAzDeg - settings.azimuthDeg) * DEG;
  return clamp(Math.cos(tilt) * Math.sin(el) + Math.sin(tilt) * Math.cos(el) * Math.cos(relativeAz), 0, 1);
}

function normalizeSettings(bundle, requested) {
  const settings = {...DEFAULT_SETTINGS, ...requested};
  validateScattering(settings);
  settings.siteId = requested.siteId ?? bundle.sites[0]?.id;
  settings.startUTC = requested.startUTC ?? bundle.ephemeris?.start_utc;
  settings.startUTC = iso(utcMillis(settings.startUTC, 'Scenario start'));
  finite(settings.durationHours, 'Duration', 1 / 3600, 24 * 366 * 20);
  finite(settings.stepMinutes, 'Time spacing', 1 / 60, 1440);
  finite(settings.heightM, 'Collector height', 0, 1000);
  finite(settings.areaM2, 'Collector area', 0, 1000000);
  finite(settings.tiltDeg, 'Panel tilt', 0, 180);
  finite(settings.azimuthDeg, 'Panel azimuth', 0, 360);
  settings.azimuthDeg = wrap(settings.azimuthDeg);
  finite(settings.efficiency, 'Collector efficiency', 0, 1);
  finite(settings.lossFactor, 'Electrical loss factor', 0, 1);
  finite(settings.loadW, 'Load', 0, 1e9);
  finite(settings.batteryKWh, 'Battery capacity', 0, 1e9);
  finite(settings.initialSocPct, 'Initial battery charge', 0, 100);
  finite(settings.reservePct, 'Reserve threshold', 0, 100);
  finite(settings.chargeEfficiency, 'Battery charge efficiency', Number.MIN_VALUE, 1);
  finite(settings.dischargeEfficiency, 'Battery discharge efficiency', Number.MIN_VALUE, 1);
  if (!['vertical_tracking', 'tracking', 'fixed', 'horizontal'].includes(settings.panelMode)) {
    throw new RangeError('Panel mode must be vertical_tracking, tracking, fixed, or horizontal.');
  }
  if (Math.ceil(settings.durationHours * 60 / settings.stepMinutes) + 1 > CONSTANTS.maxSamples) {
    throw new RangeError(`Choose a larger time spacing: this calculation allows ${CONSTANTS.maxSamples} samples.`);
  }
  return settings;
}

function addWindow(windows, start, end) {
  if (end - start <= 1e-12) return;
  const last = windows[windows.length - 1];
  if (last && start <= last[1] + 1e-10) last[1] = Math.max(last[1], end);
  else windows.push([start, end]);
}
const totalWindowHours = windows => windows.reduce((sum, [a, b]) => sum + b - a, 0);
const longestWindowHours = windows => windows.reduce((longest, [a, b]) => Math.max(longest, b - a), 0);

function negativeWindow(windows, t0, t1, a, b) {
  if (a <= 0 && b <= 0) addWindow(windows, t0, t1);
  else if (a > 0 && b > 0) return;
  else {
    const crossing = t0 + (t1 - t0) * -a / (b - a);
    if (a <= 0) addWindow(windows, t0, crossing);
    else addWindow(windows, crossing, t1);
  }
}

/** Invert the integral of a nonnegative, linearly varying power, stably. */
function integralTime(q0, q1, duration, targetWh) {
  if (targetWh <= 0) return 0;
  const total = (q0 + q1) * duration / 2;
  if (targetWh >= total) return duration;
  const slope = (q1 - q0) / duration;
  if (Math.abs(slope) < 1e-12) return clamp(targetWh / q0, 0, duration);
  const root = Math.sqrt(Math.max(0, q0 * q0 + 2 * slope * targetWh));
  return clamp(2 * targetWh / (q0 + root), 0, duration);
}

/**
 * Exact battery bookkeeping for the piecewise-linear power between samples.
 * This helper is also exported so energy/event tests need no astronomical fixture.
 */
export function integratePowerSeries(powerSamples, settings) {
  if (!Array.isArray(powerSamples) || powerSamples.length < 2) throw new TypeError('At least two power samples are required.');
  const capacity = finite(settings.batteryKWh, 'Battery capacity', 0) * 1000;
  const initialPct = finite(settings.initialSocPct, 'Initial battery charge', 0, 100);
  const reservePct = finite(settings.reservePct, 'Reserve threshold', 0, 100);
  const chargeEfficiency = finite(settings.chargeEfficiency, 'Battery charge efficiency', Number.MIN_VALUE, 1);
  const dischargeEfficiency = finite(settings.dischargeEfficiency, 'Battery discharge efficiency', Number.MIN_VALUE, 1);
  const load = finite(settings.loadW, 'Load', 0);
  powerSamples.forEach((s, i) => {
    finite(s.elapsedHours, 'Sample time', 0);
    finite(s.powerW, 'Generated power', 0);
    if (i && s.elapsedHours <= powerSamples[i - 1].elapsedHours) throw new RangeError('Power sample times must increase.');
  });
  if (powerSamples[0].elapsedHours !== 0) throw new RangeError('Power sample time must start at zero.');
  const reserve = capacity * reservePct / 100;
  const initialWh = capacity * initialPct / 100;
  let stored = initialWh, minWh = stored;
  let generatedWh = 0, loadWh = 0, unservedWh = 0, spilledWh = 0, chargeLossWh = 0, dischargeLossWh = 0;
  let firstReserveHour = capacity > 0 && stored < reserve - EPS_WH ? 0 : null;
  let firstEmptyHour = stored <= EPS_WH ? 0 : null;
  let peakUnservedW = 0;
  const shortfall = [], unserved = [], belowReserve = [];
  const sampleStates = [{socPct: capacity ? 100 * stored / capacity : 0, storedKWh: stored / 1000,
    unservedW: stored <= EPS_WH ? Math.max(0, load - powerSamples[0].powerW) : 0,
    intervalEnergyKWh: 0, intervalLoadKWh: 0, intervalUnservedKWh: 0, intervalSpilledKWh: 0}];

  for (let i = 1; i < powerSamples.length; i++) {
    const a = powerSamples[i - 1], b = powerSamples[i];
    const dt = b.elapsedHours - a.elapsedHours;
    const intervalGenerated = (a.powerW + b.powerW) * dt / 2;
    generatedWh += intervalGenerated; loadWh += load * dt;
    const unservedBefore = unservedWh, spilledBefore = spilledWh;
    const net0 = a.powerW - load, net1 = b.powerW - load;
    const fractions = [0];
    if (net0 * net1 < 0) fractions.push(-net0 / (net1 - net0));
    fractions.push(1);

    for (let j = 1; j < fractions.length; j++) {
      const f0 = fractions[j - 1], f1 = fractions[j];
      const start = a.elapsedHours + dt * f0, end = a.elapsedHours + dt * f1;
      const hours = end - start;
      const n0 = net0 + (net1 - net0) * f0, n1 = net0 + (net1 - net0) * f1;
      const before = stored;
      if ((n0 + n1) / 2 >= 0) {
        const q0 = Math.max(0, n0), q1 = Math.max(0, n1);
        const surplus = (q0 + q1) * hours / 2;
        const accepted = Math.min(surplus, Math.max(0, capacity - stored) / chargeEfficiency);
        const gained = accepted * chargeEfficiency;
        stored = Math.min(capacity, stored + gained);
        spilledWh += Math.max(0, surplus - accepted);
        chargeLossWh += accepted - gained;
        if (capacity > 0 && before < reserve - EPS_WH) {
          const until = stored >= reserve ? integralTime(q0, q1, hours, (reserve - before) / chargeEfficiency) : hours;
          addWindow(belowReserve, start, start + until);
        }
      } else {
        const q0 = Math.max(0, -n0), q1 = Math.max(0, -n1);
        const deficit = (q0 + q1) * hours / 2;
        addWindow(shortfall, start, end);
        const supplied = Math.min(deficit, Math.max(0, stored) * dischargeEfficiency);
        const withdrawn = supplied / dischargeEfficiency;
        stored = Math.max(0, stored - withdrawn);
        dischargeLossWh += withdrawn - supplied;
        const unmet = Math.max(0, deficit - supplied);
        unservedWh += unmet;
        if (capacity > 0 && stored < reserve - EPS_WH) {
          const until = before <= reserve ? 0 : integralTime(q0, q1, hours, (before - reserve) * dischargeEfficiency);
          const crossing = start + until;
          if (firstReserveHour === null) firstReserveHour = crossing;
          addWindow(belowReserve, crossing, end);
        }
        if (stored <= EPS_WH && firstEmptyHour === null) {
          firstEmptyHour = start + integralTime(q0, q1, hours, before * dischargeEfficiency);
        }
        if (unmet > EPS_WH) {
          const until = integralTime(q0, q1, hours, before * dischargeEfficiency);
          addWindow(unserved, start + until, end);
          const qAtEmpty = q0 + (q1 - q0) * until / hours;
          peakUnservedW = Math.max(peakUnservedW, qAtEmpty, q1);
        }
      }
      minWh = Math.min(minWh, stored);
    }
    sampleStates.push({socPct: capacity ? 100 * stored / capacity : 0, storedKWh: stored / 1000,
      unservedW: stored <= EPS_WH ? Math.max(0, load - b.powerW) : 0,
      intervalEnergyKWh: intervalGenerated / 1000, intervalLoadKWh: load * dt / 1000,
      intervalUnservedKWh: (unservedWh - unservedBefore) / 1000,
      intervalSpilledKWh: (spilledWh - spilledBefore) / 1000});
  }
  const servedWh = loadWh - unservedWh;
  return {sampleStates, metrics: {
    energyKWh: generatedWh / 1000, loadKWh: loadWh / 1000, servedLoadKWh: servedWh / 1000,
    unservedKWh: unservedWh / 1000, spilledKWh: spilledWh / 1000,
    chargeLossKWh: chargeLossWh / 1000, dischargeLossKWh: dischargeLossWh / 1000,
    initialBatteryKWh: initialWh / 1000, finalBatteryKWh: stored / 1000,
    minSocPct: capacity ? 100 * minWh / capacity : 0, finalSocPct: capacity ? 100 * stored / capacity : 0,
    longestShortfallHours: longestWindowHours(shortfall), longestUnservedHours: longestWindowHours(unserved),
    shortfallHours: totalWindowHours(shortfall), unservedHours: totalWindowHours(unserved),
    reserveBreachHours: totalWindowHours(belowReserve), peakUnservedW,
    firstReserveBreachHour: firstReserveHour, firstBatteryEmptyHour: firstEmptyHour,
    firstUnservedHour: unserved[0]?.[0] ?? null,
    energyBalanceErrorKWh: (generatedWh + initialWh - servedWh - stored - spilledWh - chargeLossWh - dischargeLossWh) / 1000,
  }, windows: {shortfall, unserved, belowReserve}};
}

/** Compute one site, time, collector and storage scenario without mutating inputs. */
export function computeScenario(bundle, requested = {}) {
  if (!bundle || !Array.isArray(bundle.sites) || !bundle.sites.length) throw new TypeError('The data bundle has no sites.');
  const settings = normalizeSettings(bundle, requested);
  const site = bundle.sites.find(s => s.id === settings.siteId);
  if (!site) throw new RangeError('The selected site is not in this terrain bundle.');
  validateSite(site);
  const info = ephemerisInfo(bundle, true);
  const start = utcMillis(settings.startUTC), end = start + settings.durationHours * HOUR_MS;
  if (start < info.start || end > info.end) {
    throw new RangeError(`Requested dates exceed the available ephemeris (${iso(info.start)} to ${iso(info.end)}).`);
  }
  const horizon = horizonForSite(site, settings.heightM);
  const scattering = prepareScattering(site, settings);
  const stepMs = settings.stepMinutes * 60000;
  const count = Math.ceil((end - start) / stepMs);
  const samples = [];
  const noSun = [];
  let visibleDiscHours = 0, peakPowerW = 0, directEnergyWh = 0, scatteredEnergyWh = 0;
  for (let i = 0; i <= count; i++) {
    const t = i === count ? end : start + i * stepMs;
    const geometry = geometryAt(info, site, t, settings.heightM);
    const horizonDeg = interpolateHorizon(horizon.azimuthDeg, horizon.elevationDeg, geometry.sunAzDeg);
    const disc = discVisibility(geometry.sunAzDeg, geometry.sunElDeg, geometry.angularRadiusDeg, horizon);
    const incidence = panelIncidence(geometry.sunAzDeg, geometry.sunElDeg, settings);
    const conversion = settings.areaM2 * settings.efficiency * settings.lossFactor;
    const directIrradianceWm2 = geometry.irradianceWm2 * disc.fraction * incidence;
    const scatteredIrradianceWm2 = scatteredIrradiance(scattering, geometry, settings);
    const directPowerW = directIrradianceWm2 * conversion, scatteredPowerW = scatteredIrradianceWm2 * conversion;
    const powerW = directPowerW + scatteredPowerW;
    peakPowerW = Math.max(peakPowerW, powerW);
    const sample = {
      utc: geometry.utc, elapsedHours: (t - start) / HOUR_MS,
      sunAzDeg: geometry.sunAzDeg, sunElDeg: geometry.sunElDeg, horizonDeg,
      sunFraction: disc.fraction, upperLimbClearanceDeg: disc.upperClearanceDeg,
      sunAngularRadiusDeg: geometry.angularRadiusDeg, irradianceWm2: geometry.irradianceWm2,
      incidence, powerW, directPowerW, scatteredPowerW, directIrradianceWm2, scatteredIrradianceWm2, loadW: settings.loadW,
    };
    const previous = samples[samples.length - 1];
    if (previous) {
      const hours = sample.elapsedHours - previous.elapsedHours;
      directEnergyWh += (sample.directPowerW + previous.directPowerW) * hours / 2;
      scatteredEnergyWh += (sample.scatteredPowerW + previous.scatteredPowerW) * hours / 2;
      visibleDiscHours += (sample.sunFraction + previous.sunFraction) * hours / 2;
      negativeWindow(noSun, previous.elapsedHours, sample.elapsedHours, previous.upperLimbClearanceDeg, sample.upperLimbClearanceDeg);
    }
    samples.push(sample);
  }
  const energy = integratePowerSeries(samples, settings);
  samples.forEach((sample, i) => Object.assign(sample, energy.sampleStates[i]));
  const timestamp = hour => hour === null ? null : iso(start + hour * HOUR_MS);
  const noSunHours = totalWindowHours(noSun);
  const metrics = {...energy.metrics,
    directEnergyKWh: directEnergyWh / 1000, scatteredEnergyKWh: scatteredEnergyWh / 1000,
    peakPowerW, averagePowerW: energy.metrics.energyKWh * 1000 / settings.durationHours,
    longestNoSunHours: longestWindowHours(noSun), noSunHours,
    sunlitHours: settings.durationHours - noSunHours,
    sunlitPct: 100 * (settings.durationHours - noSunHours) / settings.durationHours,
    averageSunFraction: visibleDiscHours / settings.durationHours,
    firstReserveBreachUTC: timestamp(energy.metrics.firstReserveBreachHour),
    firstBatteryEmptyUTC: timestamp(energy.metrics.firstBatteryEmptyHour),
    firstUnservedUTC: timestamp(energy.metrics.firstUnservedHour),
    sampleCount: samples.length, durationHours: settings.durationHours,
  };
  const assumptions = [
    `One collector point at ${settings.heightM} m above local ground; no finite-array or electrical partial-shading model.`,
    horizon.method === 'moon_centered_vectors'
      ? 'Terrain skyline uses Moon-centred 3D positions minus the observer, projected onto radial east/north/up axes; curvature is included in the positions.'
      : 'Terrain skyline is supplied at a fixed observer height.',
    `Curved lunar terrain rays extend ${(horizon.rangeLimitM ?? 0) / 1000} km; beyond them the declared lunar reference sphere is assumed. Distant terrain remains unresolved.`,
    'A uniform solar disc is integrated across the interpolated skyline; panel incidence uses its centre. Small-angle disc quadrature is used near the horizon.',
    'Moon-centred Sun vectors are interpolated in MOON_ME_DE421 and translated to the observer; dates outside the supplied ephemeris are rejected.',
    'Solar flux varies with Sun distance. Collector efficiency and the electrical loss factor are constant inputs; temperature, dust evolution and mechanics are not modelled.',
    settings.terrainReflectance > 0
      ? `Single-bounce Lambertian terrain reflection with assumed reflectance ${settings.terrainReflectance}; ${settings.scatterResolution * settings.scatterResolution * 2} panel directions, ${settings.scatterSunSamples} solar-disc samples and every ${settings.scatterTerrainStride}th terrain bearing. Sampled occlusion includes Earth eclipses where Earth vectors are supplied; unresolved terrain and multiple scattering are excluded.`
      : 'Terrain-reflected sunlight is disabled (zero terrain reflectance).',
    `Power is sampled every ${settings.stepMinutes} minutes and linear between samples. Shorter shadow events can be missed.`,
    'Battery energy includes charge/discharge losses and all unmet load. Reserve is a reporting threshold; discharge continues to zero. No charge/discharge power limit or temperature-dependent storage model.',
  ];
  return {samples, metrics, horizon, settings, site, assumptions,
    windows: {noSun, ...energy.windows},
    provenance: {ephemerisStartUTC: iso(info.start), ephemerisEndUTC: iso(info.end), frame: 'MOON_ME_DE421',
      sourceStepSeconds: info.step / 1000, terrainSkylineMethod: horizon.method,
      scattering: {model: 'single-bounce Lambertian solid-angle quadrature', reflectance: settings.terrainReflectance,
        resolution: settings.scatterResolution, terrainStride: settings.scatterTerrainStride, sunSamples: settings.scatterSunSamples,
        triangleCount: scattering?.triangleCount ?? 0, receiverCount: scattering?.receiverCount ?? 0,
        earthOccultation: Boolean(info.earthVectors)},
      model: 'LunaShift point-collector solar model 1.0'}};
}
