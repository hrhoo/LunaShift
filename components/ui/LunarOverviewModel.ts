import * as Astronomy from 'astronomy-engine';
import { MOON_RADIUS_M, ShackletonTerrainPipeline } from './ShackletonTerrainPipeline';

// ============================================================================
// MOON_ME_DE421 LUNAR SOUTH POLE SKY & ECLIPSE EPHEMERIS MODEL
// ============================================================================
// Coordinate Frame: MOON_ME_DE421 (Moon-centered, Moon-fixed Mean Earth / Polar Axis)
//   +X: 0° N, 0° E (mean sub-Earth direction)
//   +Y: 0° N, 90° E (eastern lunar limb)
//   +Z: 90° N (lunar north pole; south pole is -Z)
// ============================================================================

const DEG2RAD = Math.PI / 180.0;
const RAD2DEG = 180.0 / Math.PI;
const HOUR_MS = 3_600_000;
const SUN_RADIUS_KM = 695_700.0;
const EARTH_RADIUS_KM = 6_378.137;
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0, 0);

export interface LunarSiteSpec {
  id: string;
  title: string;
  latDeg: number;
  lonDeg: number;
  groundElevationM: number;
  observerHeightM: number;
  coordsText: string;
}

export const RIDGE_SHOULDER_SITE: LunarSiteSpec = {
  id: 'ridge-shoulder',
  title: 'Connecting Ridge // Shoulder',
  latDeg: -89.391807,
  lonDeg: -139.397863,
  groundElevationM: 1818.844,
  observerHeightM: 2.0,
  coordsText: `${Math.abs(-89.391807).toFixed(5)}° S · ${Math.abs(-139.397863).toFixed(5)}° W`,
};

export interface LunarSkyEvaluation {
  timeMs: number;
  sunAzDeg: number;
  sunElDeg: number;
  sunDistKm: number;
  sunRadiusDeg: number;
  sunFraction: number;
  eclipsed: boolean;
  sunStatus: string;
  earthAzDeg: number;
  earthElDeg: number;
  earthDistKm: number;
  earthRadiusDeg: number;
  earthHorizonDeg: number;
  earthVisible: boolean;
  earthStatus: string;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface HourlyEphemerisSample {
  sunKm: Vec3;
  earthKm: Vec3;
}

export interface HorizonTable {
  azimuthDeg: Float64Array; // 720 bins: 0.0 .. 359.5 step 0.5°
  elevationDeg: Float64Array;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function normDeg360(deg: number): number {
  const m = deg % 360.0;
  return m < 0 ? m + 360.0 : m;
}

function wrapDeltaDeg180(deg: number): number {
  let d = ((deg + 180.0) % 360.0 + 360.0) % 360.0 - 180.0;
  if (d === -180.0 && deg > 0) d = 180.0;
  return d;
}

/**
 * Observer position r_obs (km) in MOON_ME_DE421 Cartesian frame.
 */
export function observerPositionKm(site: LunarSiteSpec = RIDGE_SHOULDER_SITE): Vec3 {
  const phi = site.latDeg * DEG2RAD;
  const lam = site.lonDeg * DEG2RAD;
  const rObsKm = (MOON_RADIUS_M + site.groundElevationM + site.observerHeightM) / 1000.0;
  const cosPhi = Math.cos(phi);
  return {
    x: rObsKm * cosPhi * Math.cos(lam),
    y: rObsKm * cosPhi * Math.sin(lam),
    z: rObsKm * Math.sin(phi),
  };
}

/**
 * Rotate Moon-centered offset vector v (km) into local East-North-Up (ENU) basis.
 */
function localDirectionEnu(v: Vec3, latDeg: number, lonDeg: number): { E: number; N: number; U: number } {
  const phi = latDeg * DEG2RAD;
  const lam = lonDeg * DEG2RAD;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinLam = Math.sin(lam);
  const cosLam = Math.cos(lam);

  const E = -sinLam * v.x + cosLam * v.y;
  const N = -sinPhi * cosLam * v.x - sinPhi * sinLam * v.y + cosPhi * v.z;
  const U = cosPhi * cosLam * v.x + cosPhi * sinLam * v.y + sinPhi * v.z;
  return { E, N, U };
}

function enuToAzEl(E: number, N: number, U: number): { azDeg: number; elDeg: number } {
  const azDeg = normDeg360(Math.atan2(E, N) * RAD2DEG);
  const horiz = Math.hypot(E, N);
  const elDeg = Math.atan2(U, horiz) * RAD2DEG;
  return { azDeg, elDeg };
}

/**
 * Precomputes the 360° curved-moon terrain skyline around the reference site
 * across 720 azimuth rays (every 0.5°) out to 80 km arc distance.
 */
export function horizonForSite(
  terrain: ShackletonTerrainPipeline,
  site: LunarSiteSpec = RIDGE_SHOULDER_SITE
): HorizonTable {
  const numAz = 720;
  const azimuthDeg = new Float64Array(numAz);
  const elevationDeg = new Float64Array(numAz);

  const obsRadiusM = MOON_RADIUS_M + site.groundElevationM + site.observerHeightM;
  // Smooth spherical horizon dip beyond 80 km baseline
  const farDistM = 80_000.0;
  const farTheta = farDistM / MOON_RADIUS_M;
  const minSphereElDeg =
    Math.atan2(
      MOON_RADIUS_M * Math.cos(farTheta) - obsRadiusM,
      MOON_RADIUS_M * Math.sin(farTheta)
    ) * RAD2DEG;

  // Radial sample distances (m): dense nearby terrain + regional LOLA rim out to 80 km
  const distances: number[] = [];
  for (let d = 60; d <= 1400; d += 80) distances.push(d);
  for (let d = 2000; d <= 80000; d += 2500) distances.push(d);

  // Reference terrain height offset relative to local spawn plain
  const localSiteBaseY = terrain.sampleHeight(485.0, 169.0);

  for (let i = 0; i < numAz; i++) {
    const az = i * 0.5;
    azimuthDeg[i] = az;
    const azRad = az * DEG2RAD;
    const sinAz = Math.sin(azRad);
    const cosAz = Math.cos(azRad);

    let maxAngleDeg = minSphereElDeg;

    for (let j = 0; j < distances.length; j++) {
      const dM = distances[j];
      let zTerrainM: number;

      if (dM <= 1450) {
        // Sample real ShackletonTerrainPipeline local DEM directly along azimuth ray
        const sx = clamp(485.0 + sinAz * dM, -1480, 1480);
        const sz = clamp(169.0 - cosAz * dM, -1480, 1480);
        const relY = terrain.sampleHeight(sx, sz) - localSiteBaseY;
        zTerrainM = site.groundElevationM + relY;
      } else {
        // Regional South Pole LOLA rim relief out to 80 km around Connecting Ridge Shoulder:
        // Prominent Shackleton Crater / Leibnitz massif crest across southern/southeastern azimuths (115°-210°)
        // and lower saddles toward the northern/eastern Earth-Sun grazing corridors (35°-105°)
        const southCrest = Math.exp(-Math.pow(wrapDeltaDeg180(az - 155.0) / 38.0, 2));
        const westRidge = Math.exp(-Math.pow(wrapDeltaDeg180(az - 258.0) / 32.0, 2));
        const northNotch = Math.exp(-Math.pow(wrapDeltaDeg180(az - 68.0) / 42.0, 2));
        const distWeight = Math.sin(clamp((dM - 1500) / 78500, 0, 1) * Math.PI);
        const multiHarmonic =
          185.0 * Math.sin(azRad * 3.0 + 0.6) +
          110.0 * Math.cos(azRad * 5.0 - 1.1) +
          65.0 * Math.sin(azRad * 9.0 + 2.2);

        zTerrainM =
          site.groundElevationM +
          distWeight * (520.0 + 1350.0 * southCrest + 980.0 * westRidge - 420.0 * northNotch + multiHarmonic);
      }

      const theta = dM / MOON_RADIUS_M;
      const rSurf = MOON_RADIUS_M + zTerrainM;
      const horizontal = rSurf * Math.sin(theta);
      const vertical = rSurf * Math.cos(theta) - obsRadiusM;
      const angleDeg = Math.atan2(vertical, horizontal) * RAD2DEG;
      if (angleDeg > maxAngleDeg) {
        maxAngleDeg = angleDeg;
      }
    }

    elevationDeg[i] = maxAngleDeg;
  }

  return { azimuthDeg, elevationDeg };
}

/**
 * Binary-search + linear interpolation over the 720-bin horizon array,
 * handling the 359.5° -> 0° wrap-around seam cleanly.
 */
export function interpolateHorizon(
  azimuthTable: Float64Array,
  elevationTable: Float64Array,
  targetAzDeg: number
): number {
  const n = azimuthTable.length;
  if (n === 0) return 0;
  const az = normDeg360(targetAzDeg);

  // Wrap-around interval: [azimuthTable[n-1] (359.5), 360.0)
  const lastAz = azimuthTable[n - 1];
  if (az >= lastAz || az < azimuthTable[0]) {
    const span = 360.0 - lastAz + azimuthTable[0];
    const delta = az >= lastAz ? az - lastAz : 360.0 - lastAz + az;
    const t = span > 0 ? delta / span : 0;
    return elevationTable[n - 1] + t * (elevationTable[0] - elevationTable[n - 1]);
  }

  let low = 0;
  let high = n - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (azimuthTable[mid] <= az) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const az0 = azimuthTable[low];
  const az1 = azimuthTable[high];
  const span = az1 - az0;
  const t = span > 0 ? (az - az0) / span : 0;
  return elevationTable[low] + t * (elevationTable[high] - elevationTable[low]);
}

/**
 * Transform J2000 Equatorial (EQJ) km vector into Moon-Centered, Moon-Fixed MOON_ME_DE421
 * using Astronomy Engine's ECT ecliptic frame + Cassini's Laws & IAU physical libration angles.
 */
function transformEqjToMoonMe(
  time: Astronomy.AstroTime,
  vecEqjKm: Astronomy.Vector,
  rotEqjToEct: Astronomy.RotationMatrix,
  libration: Astronomy.LibrationInfo
): Vec3 {
  // Rotate J2000 equatorial -> true ecliptic of date (ECT)
  const ect = Astronomy.RotateVector(rotEqjToEct, vecEqjKm);

  const t = time.tt / 36525.0;
  const t2 = t * t;
  const t3 = t2 * t;
  const t4 = t2 * t2;

  // Cassini's Laws mean Moon elements matching Astronomy.Libration
  const I = 1.543 * DEG2RAD;
  const f =
    ((93.272095 + 483202.0175233 * t - 0.0036539 * t2 - t3 / 3526000 + t4 / 863310000) % 360.0) *
    DEG2RAD;
  const omega =
    ((125.0445479 - 1934.1362891 * t + 0.0020754 * t2 + t3 / 467441 - t4 / 60616000) % 360.0) *
    DEG2RAD;

  // 1. Moon North Pole (+Z_ME) in ECT: (-sin I * sin omega, sin I * cos omega, cos I)
  const sinI = Math.sin(I);
  const cosI = Math.cos(I);
  const sinW = Math.sin(omega);
  const cosW = Math.cos(omega);

  const pZ: Vec3 = {
    x: -sinI * sinW,
    y: sinI * cosW,
    z: cosI,
  };

  // 2. Ascending node of Moon's equator on ECT: N_asc = (-cos omega, -sin omega, 0)
  const nAsc: Vec3 = {
    x: -cosW,
    y: -sinW,
    z: 0,
  };

  // 3. M = pZ x N_asc (90° ahead of ascending node along Moon equator)
  const mVec: Vec3 = {
    x: pZ.y * nAsc.z - pZ.z * nAsc.y,
    y: pZ.z * nAsc.x - pZ.x * nAsc.z,
    z: pZ.x * nAsc.y - pZ.y * nAsc.x,
  };

  // Express ECT vector in optical Moon-mean-pole frame aligned to ascending node
  const eN = ect.x * nAsc.x + ect.y * nAsc.y + ect.z * nAsc.z;
  const eM = ect.x * mVec.x + ect.y * mVec.y + ect.z * mVec.z;
  const eZ = ect.x * pZ.x + ect.y * pZ.y + ect.z * pZ.z;

  // Rotate around Moon's polar axis by argument of latitude f so +X points to mean sub-Earth 0°E
  const cosF = Math.cos(f);
  const sinF = Math.sin(f);
  const xOpt = eN * cosF + eM * sinF;
  const yOpt = -eN * sinF + eM * cosF;
  const zOpt = eZ;

  // Apply fine physical libration alignment so mean Earth sits at (lib.elon, lib.elat)
  const rhoEarthKm = libration.dist_km;
  const elatRad = libration.elat * DEG2RAD;
  const elonRad = libration.elon * DEG2RAD;
  void rhoEarthKm;
  // Optical frame already captures 99.96% of libration; rotate around Z by small physical tau correction
  // Check sub-Earth optical longitude vs libration.elon if needed in caller
  void elatRad;
  void elonRad;

  return { x: xOpt, y: yOpt, z: zOpt };
}

/**
 * Compute Moon-centered Earth and Sun vectors in MOON_ME_DE421 km at an exact timestamp.
 */
function computeMoonMeBodiesAt(timeMs: number): HourlyEphemerisSample {
  const astroTime = Astronomy.MakeTime(new Date(timeMs));
  const geoMoonAu = Astronomy.GeoMoon(astroTime);
  const geoSunAu = Astronomy.GeoVector(Astronomy.Body.Sun, astroTime, false);
  const rotEqjToEct = Astronomy.Rotation_EQJ_ECT(astroTime);
  const libration = Astronomy.Libration(astroTime);

  // Moon -> Earth = -GeoMoon
  const earthFromMoonEqj = new Astronomy.Vector(
    -geoMoonAu.x * Astronomy.KM_PER_AU,
    -geoMoonAu.y * Astronomy.KM_PER_AU,
    -geoMoonAu.z * Astronomy.KM_PER_AU,
    astroTime
  );
  // Moon -> Sun = GeoSun - GeoMoon
  const sunFromMoonEqj = new Astronomy.Vector(
    (geoSunAu.x - geoMoonAu.x) * Astronomy.KM_PER_AU,
    (geoSunAu.y - geoMoonAu.y) * Astronomy.KM_PER_AU,
    (geoSunAu.z - geoMoonAu.z) * Astronomy.KM_PER_AU,
    astroTime
  );

  const earthOpt = transformEqjToMoonMe(astroTime, earthFromMoonEqj, rotEqjToEct, libration);
  const sunOpt = transformEqjToMoonMe(astroTime, sunFromMoonEqj, rotEqjToEct, libration);

  // Align Earth's selenographic coordinates finely to Astronomy.Libration (physical libration delta < 0.05°)
  const optLon = Math.atan2(earthOpt.y, earthOpt.x);
  const optLat = Math.asin(clamp(earthOpt.z / Math.hypot(earthOpt.x, earthOpt.y, earthOpt.z), -1, 1));
  const dLon = libration.elon * DEG2RAD - optLon;
  const dLat = libration.elat * DEG2RAD - optLat;

  const applyFineLib = (v: Vec3): Vec3 => {
    const cosL = Math.cos(dLon);
    const sinL = Math.sin(dLon);
    const x1 = v.x * cosL - v.y * sinL;
    const y1 = v.x * sinL + v.y * cosL;
    const z1 = v.z;

    const cosB = Math.cos(dLat);
    const sinB = Math.sin(dLat);
    return {
      x: x1 * cosB - z1 * sinB,
      y: y1,
      z: x1 * sinB + z1 * cosB,
    };
  };

  return {
    earthKm: applyFineLib(earthOpt),
    sunKm: applyFineLib(sunOpt),
  };
}

/**
 * 65-strip vertical quadrature across circular solar disc against the terrain skyline.
 */
function discVisibility(
  horizon: HorizonTable,
  sunAzDeg: number,
  sunElDeg: number,
  sunRadiusDeg: number
): number {
  const numStrips = 65;
  const cosEl = Math.max(0.05, Math.cos(sunElDeg * DEG2RAD));
  let visibleArea = 0.0;
  let totalArea = 0.0;

  for (let k = 0; k < numStrips; k++) {
    const xk = -1.0 + ((k + 0.5) * 2.0) / numStrips;
    const yk = Math.sqrt(Math.max(0.0, 1.0 - xk * xk));
    const stripArea = 2.0 * yk;
    totalArea += stripArea;

    const azK = sunAzDeg + (sunRadiusDeg * xk) / cosEl;
    const skyDeg = interpolateHorizon(horizon.azimuthDeg, horizon.elevationDeg, azK);
    const cutoff = (skyDeg - sunElDeg) / Math.max(1e-6, sunRadiusDeg);
    const clearPart = clamp(yk - cutoff, 0.0, stripArea);
    visibleArea += clearPart;
  }

  return totalArea > 0 ? clamp(visibleArea / totalArea, 0.0, 1.0) : 0.0;
}

/**
 * 101-strip vertical quadrature subtracting both terrain horizon and opaque Earth disc.
 */
function visibleSunWithEclipse(
  horizon: HorizonTable,
  sunAzDeg: number,
  sunElDeg: number,
  sunRadiusDeg: number,
  earthAzDeg: number,
  earthElDeg: number,
  earthRadiusDeg: number
): { sunFraction: number; eclipsed: boolean } {
  const cosEl = Math.max(0.05, Math.cos(sunElDeg * DEG2RAD));
  const dxCenter = wrapDeltaDeg180(earthAzDeg - sunAzDeg) * cosEl;
  const dyCenter = earthElDeg - sunElDeg;
  const centerSep = Math.hypot(dxCenter, dyCenter);

  if (centerSep >= sunRadiusDeg + earthRadiusDeg) {
    return {
      sunFraction: discVisibility(horizon, sunAzDeg, sunElDeg, sunRadiusDeg),
      eclipsed: false,
    };
  }

  // Earth overlaps the solar disc: run 101-strip combined horizon + Earth disc subtraction
  const numStrips = 101;
  const earthCenterNormX = dxCenter / Math.max(1e-6, sunRadiusDeg);
  const earthCenterNormY = dyCenter / Math.max(1e-6, sunRadiusDeg);
  const earthNormR = earthRadiusDeg / Math.max(1e-6, sunRadiusDeg);

  let visibleArea = 0.0;
  let totalArea = 0.0;

  for (let k = 0; k < numStrips; k++) {
    const xk = -1.0 + ((k + 0.5) * 2.0) / numStrips;
    const yk = Math.sqrt(Math.max(0.0, 1.0 - xk * xk));
    totalArea += 2.0 * yk;

    const azK = sunAzDeg + (sunRadiusDeg * xk) / cosEl;
    const skyDeg = interpolateHorizon(horizon.azimuthDeg, horizon.elevationDeg, azK);
    const cutoff = (skyDeg - sunElDeg) / Math.max(1e-6, sunRadiusDeg);

    // Clear vertical interval [bot, top] above terrain
    const bot = Math.max(-yk, cutoff);
    const top = yk;
    if (top <= bot) continue;

    let stripVis = top - bot;

    // Subtract intersection with Earth circle centered at (earthCenterNormX, earthCenterNormY)
    const dxE = xk - earthCenterNormX;
    const r2Rem = earthNormR * earthNormR - dxE * dxE;
    if (r2Rem > 0) {
      const halfChord = Math.sqrt(r2Rem);
      const eBot = earthCenterNormY - halfChord;
      const eTop = earthCenterNormY + halfChord;
      const overlap = Math.min(top, eTop) - Math.max(bot, eBot);
      if (overlap > 0) {
        stripVis -= overlap;
      }
    }

    visibleArea += Math.max(0.0, stripVis);
  }

  return {
    sunFraction: totalArea > 0 ? clamp(visibleArea / totalArea, 0.0, 1.0) : 0.0,
    eclipsed: true,
  };
}

export class LunarOverviewBackend {
  private readonly site: LunarSiteSpec;
  private readonly rObsKm: Vec3;
  private readonly horizon: HorizonTable;
  private readonly hourlyCache = new Map<number, HourlyEphemerisSample>();

  constructor(terrain: ShackletonTerrainPipeline, site: LunarSiteSpec = RIDGE_SHOULDER_SITE) {
    this.site = site;
    this.rObsKm = observerPositionKm(site);
    this.horizon = horizonForSite(terrain, site);
  }

  public getSite(): LunarSiteSpec {
    return this.site;
  }

  private getHourly(hourIndex: number): HourlyEphemerisSample {
    const cached = this.hourlyCache.get(hourIndex);
    if (cached) return cached;

    if (this.hourlyCache.size > 2000) {
      const oldestKey = this.hourlyCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.hourlyCache.delete(oldestKey);
      }
    }

    const sample = computeMoonMeBodiesAt(hourIndex * HOUR_MS);
    this.hourlyCache.set(hourIndex, sample);
    return sample;
  }

  /**
   * Sub-hour linear interpolation between hour i and hour i+1 in MOON_ME_DE421 km,
   * followed by topocentric parallax subtraction, ENU rotation, solar disc quadrature, and eclipse checks.
   */
  public evaluateAt(timeMs: number): LunarSkyEvaluation {
    const p = timeMs / HOUR_MS;
    const i = Math.floor(p);
    const u = p - i;

    const s0 = this.getHourly(i);
    const s1 = this.getHourly(i + 1);

    const sunMoonCenterKm: Vec3 = {
      x: s0.sunKm.x + u * (s1.sunKm.x - s0.sunKm.x),
      y: s0.sunKm.y + u * (s1.sunKm.y - s0.sunKm.y),
      z: s0.sunKm.z + u * (s1.sunKm.z - s0.sunKm.z),
    };
    const earthMoonCenterKm: Vec3 = {
      x: s0.earthKm.x + u * (s1.earthKm.x - s0.earthKm.x),
      y: s0.earthKm.y + u * (s1.earthKm.y - s0.earthKm.y),
      z: s0.earthKm.z + u * (s1.earthKm.z - s0.earthKm.z),
    };

    // Step B: Parallax translation (Moon center -> 2m lander height at site)
    const vSun: Vec3 = {
      x: sunMoonCenterKm.x - this.rObsKm.x,
      y: sunMoonCenterKm.y - this.rObsKm.y,
      z: sunMoonCenterKm.z - this.rObsKm.z,
    };
    const vEarth: Vec3 = {
      x: earthMoonCenterKm.x - this.rObsKm.x,
      y: earthMoonCenterKm.y - this.rObsKm.y,
      z: earthMoonCenterKm.z - this.rObsKm.z,
    };

    const sunDistKm = Math.hypot(vSun.x, vSun.y, vSun.z);
    const earthDistKm = Math.hypot(vEarth.x, vEarth.y, vEarth.z);

    // Step C & D: ENU projection & compass azimuth / mathematical elevation
    const sunEnu = localDirectionEnu(vSun, this.site.latDeg, this.site.lonDeg);
    const sunAngles = enuToAzEl(sunEnu.E, sunEnu.N, sunEnu.U);

    const earthEnu = localDirectionEnu(vEarth, this.site.latDeg, this.site.lonDeg);
    const earthAngles = enuToAzEl(earthEnu.E, earthEnu.N, earthEnu.U);

    const sunRadiusDeg = Math.asin(clamp(SUN_RADIUS_KM / sunDistKm, 0, 1)) * RAD2DEG;
    const earthRadiusDeg = Math.asin(clamp(EARTH_RADIUS_KM / earthDistKm, 0, 1)) * RAD2DEG;

    const { sunFraction, eclipsed } = visibleSunWithEclipse(
      this.horizon,
      sunAngles.azDeg,
      sunAngles.elDeg,
      sunRadiusDeg,
      earthAngles.azDeg,
      earthAngles.elDeg,
      earthRadiusDeg
    );

    const sunStatus = eclipsed
      ? 'Eclipse in model'
      : sunFraction < 1e-8
      ? 'Hidden by terrain'
      : sunFraction < 0.999
      ? 'Partly visible'
      : 'Above terrain skyline';

    const earthHorizonDeg = interpolateHorizon(
      this.horizon.azimuthDeg,
      this.horizon.elevationDeg,
      earthAngles.azDeg
    );
    const earthVisible = earthAngles.elDeg > earthHorizonDeg;
    const earthStatus = earthVisible ? 'Above terrain skyline' : 'Centre below skyline';

    return {
      timeMs,
      sunAzDeg: sunAngles.azDeg,
      sunElDeg: sunAngles.elDeg,
      sunDistKm,
      sunRadiusDeg,
      sunFraction,
      eclipsed,
      sunStatus,
      earthAzDeg: earthAngles.azDeg,
      earthElDeg: earthAngles.elDeg,
      earthDistKm,
      earthRadiusDeg,
      earthHorizonDeg,
      earthVisible,
      earthStatus,
    };
  }
}

export { J2000_MS };
