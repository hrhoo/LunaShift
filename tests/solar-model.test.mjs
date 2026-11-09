import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CONSTANTS, DEFAULT_SETTINGS, computeScenario, horizonForSite, solarGeometry,
  panelIncidence, discFraction, solarDiscFraction, interpolateHorizon, integratePowerSeries,
} from '../web/solar-model.js';

const close = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Number.isFinite(actual), `Expected finite result, got ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by more than ${tolerance}`);
};
const settings = overrides => ({...DEFAULT_SETTINGS, ...overrides});
const power = (values, hours = values.map((_, i) => i)) => values.map((powerW, i) => ({powerW, elapsedHours: hours[i]}));
const balanced = metrics => {
  close(metrics.energyKWh + metrics.initialBatteryKWh,
    metrics.servedLoadKWh + metrics.finalBatteryKWh + metrics.spilledKWh + metrics.chargeLossKWh + metrics.dischargeLossKWh, 2e-10);
  close(metrics.loadKWh, metrics.servedLoadKWh + metrics.unservedKWh, 2e-10);
  close(metrics.energyBalanceErrorKWh, 0, 2e-10);
};

// Controlled geometrical fixtures are deliberately used only in tests.
function fixture({el = 30, az = 90, hours = 24} = {}) {
  const site = {id: 'test', name: 'Controlled test site', latitude_deg: 0, longitude_deg: 0, ground_elevation_m: 0,
    terrain: {kind: 'rays', radius_m: CONSTANTS.lunarRadiusM, azimuth_deg: [0, 90, 180, 270],
      distances_m: [100, 1000], elevations_m: [[0, 0], [0, 0], [0, 0], [0, 0]]}};
  const d = Math.PI / 180, r = CONSTANTS.lunarRadiusM / 1000, distance = CONSTANTS.auKm;
  const v = [r + distance * Math.sin(el * d), distance * Math.cos(el * d) * Math.sin(az * d),
    distance * Math.cos(el * d) * Math.cos(az * d)];
  return {sites: [site], ephemeris: {start_utc: '2026-01-01T00:00:00Z', step_seconds: hours * 3600,
    frame: 'MOON_ME_DE421', sun_position_km: [v, v.slice()]}};
}

function flatHorizon(elevation = 0) {
  return {azimuthDeg: [0, 90, 180, 270], elevationDeg: [elevation, elevation, elevation, elevation], minDeg: elevation, maxDeg: elevation};
}

test('panel orientations use the expected cosine projection and reject a backwards panel', () => {
  close(panelIncidence(90, 30, settings({panelMode: 'horizontal'})), 0.5);
  close(panelIncidence(90, 30, settings({panelMode: 'vertical_tracking'})), Math.sqrt(3) / 2);
  close(panelIncidence(90, 30, settings({panelMode: 'fixed', tiltDeg: 90, azimuthDeg: 90})), Math.sqrt(3) / 2);
  close(panelIncidence(90, 30, settings({panelMode: 'fixed', tiltDeg: 60, azimuthDeg: 90})), 1);
  close(panelIncidence(90, 30, settings({panelMode: 'fixed', tiltDeg: 90, azimuthDeg: 270})), 0);
  close(panelIncidence(90, 30, settings({panelMode: 'tracking'})), 1);
});

test('supplied plural Sun-vector contract is accepted without changing its contents', () => {
  const bundle = fixture();
  bundle.ephemeris.sun_positions_km = bundle.ephemeris.sun_position_km;
  delete bundle.ephemeris.sun_position_km;
  const result = computeScenario(bundle, {durationHours: 1});
  assert.equal(result.samples.length, 3);
  assert.ok(result.metrics.energyKWh > 0);
});

test('observer subtraction and ENU geometry reproduce an independently constructed ray', () => {
  const bundle = fixture({el: 12, az: 231});
  const g = solarGeometry(bundle, bundle.sites[0], '2026-01-01T12:00:00Z');
  close(g.sunAzDeg, 231, 1e-10);
  close(g.sunElDeg, 12, 1e-10);
  close(g.distanceKm, CONSTANTS.auKm, 1e-6);
  close(g.irradianceWm2, 1361, 1e-9);
  close(Math.hypot(...g.directionENU), 1);
  assert.ok(g.angularRadiusDeg > 0.26 && g.angularRadiusDeg < 0.27);
});

test('flat-horizon disc has exact full, zero, half and quarter-radius geometry', () => {
  close(discFraction(0, 0.27), 0.5);
  close(discFraction(0.27, 0.27), 1);
  close(discFraction(-0.27, 0.27), 0);
  close(discFraction(-0.135, 0.27), 1 / 3 - Math.sqrt(3) / (4 * Math.PI));
  close(solarDiscFraction(120, 0, 0.27, flatHorizon()), 0.5);
  close(solarDiscFraction(120, -0.27, 0.27, flatHorizon()), 0);
});

test('disc integration detects neighbouring obstructions missed by the centre skyline', () => {
  const profile = {azimuthDeg: [0, 179.95, 180, 180.05, 359], elevationDeg: [1, 1, 0, 1, 1], minDeg: 0, maxDeg: 1};
  close(interpolateHorizon(profile.azimuthDeg, profile.elevationDeg, 180), 0);
  const fraction = solarDiscFraction(180, 0, 0.27, profile);
  assert.ok(fraction > 0 && fraction < 0.1, `Narrow valley should expose little of the disc, got ${fraction}`);
  assert.ok(fraction < discFraction(0, 0.27));
});

test('horizon interpolation crosses north without a discontinuity', () => {
  const az = [0, 90, 180, 270], el = [0, 1, 0, -1];
  close(interpolateHorizon(az, el, 359), -1 / 90);
  close(interpolateHorizon(az, el, 361), 1 / 90);
  close(interpolateHorizon(az, el, -1), -1 / 90);
});

test('terrain horizon includes lunar curvature and decreases when the observer rises', () => {
  const site = fixture().sites[0];
  site.terrain.elevations_m = site.terrain.azimuth_deg.map(() => [0, 100]);
  const low = horizonForSite(site, 0), high = horizonForSite(site, 10);
  // A 100 m ridge at a 1 km arc distance. Its curvature-free elevation is atan(0.1).
  const flatApprox = Math.atan(0.1) * 180 / Math.PI;
  assert.ok(low.elevationDeg.every(v => v < flatApprox));
  assert.ok(low.elevationDeg.every(v => Math.abs(v - flatApprox) < 0.03));
  high.elevationDeg.forEach((v, i) => assert.ok(v < low.elevationDeg[i]));
  assert.equal(high.rangeLimitM, 1000);
  assert.equal(high.blockers[0].distanceM, 1000);
  const smooth = horizonForSite(fixture().sites[0], 2);
  close(smooth.smoothHorizonDeg, -Math.acos(CONSTANTS.lunarRadiusM / (CONSTANTS.lunarRadiusM + 2)) * 180 / Math.PI);
});

test('an elevated ridge retains negative terrain horizons instead of inventing a same-altitude surrounding sphere', () => {
  const site = fixture().sites[0];
  site.ground_elevation_m = 2000;
  site.terrain.distances_m = [1000, 10000, 80000];
  site.terrain.elevations_m = site.terrain.azimuth_deg.map(() => [1900, 1000, 0]);
  const result = horizonForSite(site, 2);
  const referenceDip = -Math.acos(CONSTANTS.lunarRadiusM / (CONSTANTS.lunarRadiusM + 2002)) * 180 / Math.PI;
  close(result.smoothHorizonDeg, referenceDip, 1e-10);
  assert.ok(result.elevationDeg.every(v => v < -2));
  assert.equal(result.beyondRangeAssumption, 'reference_radius_sphere');
});

test('the reference-sphere fallback is restricted to unmeasured far distances', () => {
  const site = fixture().sites[0];
  site.terrain.distances_m = [100, 1000, 80000];
  site.terrain.elevations_m = site.terrain.azimuth_deg.map(() => [0, 0, 0]);
  const result = horizonForSite(site, 2);
  // The actual smooth-body tangent is about 2.6 km away, inside terrain coverage.
  // The far-field fallback must start at 80 km, rather than overriding measured rays.
  assert.ok(result.smoothHorizonDeg < -1);
  assert.ok(result.elevationDeg.every(v => v > result.smoothHorizonDeg));
});

test('fixed-height imported horizons cannot silently be reused at another height', () => {
  const site = fixture().sites[0];
  site.terrain = {kind: 'horizon', observer_height_m: 2, azimuth_deg: [0, 90, 180, 270], horizon_deg: [1, 2, 3, 2]};
  assert.equal(horizonForSite(site, 2).elevationDeg[1], 2);
  assert.throws(() => horizonForSite(site, 3), /fixed at one height/);
});

test('no battery: surplus is explicitly spilled and all demand is served', () => {
  const result = integratePowerSeries(power([500, 500], [0, 2]), settings({loadW: 100, batteryKWh: 0}));
  close(result.metrics.energyKWh, 1);
  close(result.metrics.loadKWh, 0.2);
  close(result.metrics.spilledKWh, 0.8);
  close(result.metrics.unservedKWh, 0);
  close(result.metrics.chargeLossKWh, 0);
  assert.equal(result.metrics.firstReserveBreachHour, null);
  balanced(result.metrics);
});

test('battery discharge crosses reserve then empties with explicit losses and unmet load', () => {
  const result = integratePowerSeries(power([0, 0], [0, 6]), settings({loadW: 100, batteryKWh: 1,
    initialSocPct: 50, reservePct: 20, dischargeEfficiency: 0.8}));
  close(result.metrics.servedLoadKWh, 0.4);
  close(result.metrics.unservedKWh, 0.2);
  close(result.metrics.dischargeLossKWh, 0.1);
  close(result.metrics.firstReserveBreachHour, 2.4);
  close(result.metrics.firstBatteryEmptyHour, 4);
  close(result.metrics.firstUnservedHour, 4);
  close(result.metrics.longestUnservedHours, 2);
  close(result.metrics.reserveBreachHours, 3.6);
  close(result.metrics.finalSocPct, 0);
  close(result.sampleStates[1].unservedW, 100);
  balanced(result.metrics);
});

test('charging a nearly full battery distinguishes accepted energy, loss and spill', () => {
  const result = integratePowerSeries(power([500, 500]), settings({loadW: 0, batteryKWh: 1,
    initialSocPct: 90, chargeEfficiency: 0.8}));
  close(result.metrics.finalBatteryKWh, 1);
  close(result.metrics.spilledKWh, 0.375);
  close(result.metrics.chargeLossKWh, 0.025);
  close(result.metrics.unservedKWh, 0);
  balanced(result.metrics);
});

test('a solar/load crossing within one interval preserves the interior battery minimum', () => {
  const result = integratePowerSeries(power([0, 200], [0, 2]), settings({loadW: 100, batteryKWh: 0.05,
    initialSocPct: 100, reservePct: 20, chargeEfficiency: 1, dischargeEfficiency: 1}));
  close(result.sampleStates[0].socPct, 100);
  close(result.sampleStates[1].socPct, 100);
  close(result.metrics.minSocPct, 0);
  close(result.metrics.firstReserveBreachHour, 1 - Math.sqrt(0.2));
  close(result.metrics.firstBatteryEmptyHour, 1);
  close(result.metrics.unservedKWh, 0);
  close(result.metrics.spilledKWh, 0);
  close(result.metrics.longestShortfallHours, 1);
  balanced(result.metrics);
});

test('full and empty crossings inside a varying-power interval are integrated analytically', () => {
  const result = integratePowerSeries(power([0, 200], [0, 2]), settings({loadW: 100, batteryKWh: 0.025,
    initialSocPct: 100, chargeEfficiency: 1, dischargeEfficiency: 1}));
  close(result.metrics.firstUnservedHour, 1 - Math.SQRT1_2);
  close(result.metrics.longestUnservedHours, Math.SQRT1_2);
  close(result.metrics.peakUnservedW, 100 * Math.SQRT1_2);
  close(result.metrics.unservedKWh, 0.025);
  close(result.metrics.spilledKWh, 0.025);
  close(result.metrics.finalBatteryKWh, 0.025);
  balanced(result.metrics);
});

test('an initially low battery is below reserve until its calculated recharge crossing', () => {
  const result = integratePowerSeries(power([100, 100], [0, 2]), settings({loadW: 0, batteryKWh: 1,
    initialSocPct: 10, reservePct: 20, chargeEfficiency: 0.8}));
  close(result.metrics.firstReserveBreachHour, 0);
  close(result.metrics.reserveBreachHours, 1.25);
  close(result.metrics.finalSocPct, 26);
  balanced(result.metrics);
});

test('zero reserve is never breached and an empty battery reports the full shortfall', () => {
  const result = integratePowerSeries(power([0, 0], [0, 0.75]), settings({loadW: 80, batteryKWh: 1,
    initialSocPct: 0, reservePct: 0}));
  assert.equal(result.metrics.firstReserveBreachHour, null);
  close(result.metrics.reserveBreachHours, 0);
  close(result.metrics.unservedKWh, 0.06);
  close(result.metrics.longestUnservedHours, 0.75);
  balanced(result.metrics);
});

test('mixed irregular intervals conserve energy through multiple charging and outage events', () => {
  const result = integratePowerSeries(power([0, 500, 0, 250, 0, 1000, 0], [0, 0.3, 1.7, 2, 4.2, 4.8, 7]),
    settings({loadW: 100, batteryKWh: 0.02, initialSocPct: 40, chargeEfficiency: 0.86, dischargeEfficiency: 0.81}));
  assert.ok(result.metrics.spilledKWh > 0);
  assert.ok(result.metrics.unservedKWh > 0);
  assert.ok(result.metrics.chargeLossKWh > 0 && result.metrics.dischargeLossKWh > 0);
  result.sampleStates.forEach(s => assert.ok(s.socPct >= 0 && s.socPct <= 100));
  balanced(result.metrics);
});

test('scenario retains a fractional final interval and does not mutate the bundle or settings', () => {
  const bundle = fixture(), before = structuredClone(bundle);
  const input = {durationHours: 2.25, stepMinutes: 60, heightM: 0, panelMode: 'tracking', areaM2: 1,
    efficiency: 1, lossFactor: 1, loadW: 100, batteryKWh: 0};
  const inputBefore = structuredClone(input);
  const result = computeScenario(bundle, input);
  assert.deepEqual(result.samples.map(s => s.elapsedHours), [0, 1, 2, 2.25]);
  close(result.metrics.energyKWh, 1361 * 2.25 / 1000, 1e-9);
  close(result.metrics.loadKWh, 0.225);
  close(result.metrics.sunlitPct, 100);
  close(result.metrics.averageSunFraction, 1);
  close(result.metrics.longestNoSunHours, 0);
  close(result.samples.at(-1).intervalLoadKWh, 0.025);
  assert.deepEqual(bundle, before);
  assert.deepEqual(input, inputBefore);
  balanced(result.metrics);
});

test('a fully shadowed interval has no solar generation and records unsupported load', () => {
  const result = computeScenario(fixture({el: -2}), {durationHours: 3, heightM: 0, loadW: 50, batteryKWh: 0});
  close(result.metrics.energyKWh, 0);
  close(result.metrics.sunlitPct, 0);
  close(result.metrics.longestNoSunHours, 3);
  close(result.metrics.unservedKWh, 0.15);
  close(result.metrics.longestUnservedHours, 3);
  assert.equal(result.metrics.firstUnservedUTC, '2026-01-01T00:00:00.000Z');
  balanced(result.metrics);
});

test('a raised point sees at least as much sunlight over the same local ridge', () => {
  const bundle = fixture({el: 0.2});
  bundle.sites[0].terrain.elevations_m = bundle.sites[0].terrain.azimuth_deg.map(() => [1, 0]);
  const common = {durationHours: 1, stepMinutes: 30, panelMode: 'vertical_tracking'};
  const low = computeScenario(bundle, {...common, heightM: 0});
  const high = computeScenario(bundle, {...common, heightM: 5});
  assert.ok(high.samples[0].sunFraction > low.samples[0].sunFraction);
  assert.ok(high.metrics.energyKWh > low.metrics.energyKWh);
});

test('invalid physical settings, malformed source data and unsupported dates are rejected', () => {
  const bundle = fixture();
  for (const bad of [{efficiency: 1.2}, {batteryKWh: -1}, {stepMinutes: 0}, {heightM: -1},
    {chargeEfficiency: 0}, {panelMode: 'magic'}, {areaM2: NaN}, {initialSocPct: 101}, {siteId: 'missing'}]) {
    assert.throws(() => computeScenario(bundle, {durationHours: 1, ...bad}));
  }
  assert.throws(() => computeScenario(bundle, {startUTC: '2025-12-31T23:00:00Z', durationHours: 1}), /exceed/);
  assert.throws(() => computeScenario(bundle, {durationHours: 25}), /exceed/);
  assert.throws(() => solarGeometry(bundle, bundle.sites[0], '2026-01-02T00:00:01Z'), /outside/);
  assert.throws(() => computeScenario(bundle, {startUTC: '2026-01-01', durationHours: 1}), /explicit UTC offset/);
  assert.throws(() => computeScenario(bundle, {startUTC: '2026-02-30T00:00:00Z', durationHours: 1}), /calendar date/);
  const badFrame = structuredClone(bundle); badFrame.ephemeris.frame = 'IAU_MOON';
  assert.throws(() => computeScenario(badFrame, {durationHours: 1}), /MOON_ME_DE421/);
  const badPosition = structuredClone(bundle); badPosition.ephemeris.sun_position_km[0][0] = NaN;
  assert.throws(() => computeScenario(badPosition, {durationHours: 1}), /finite kilometre/);
  const badTerrain = structuredClone(bundle); badTerrain.sites[0].terrain.elevations_m[0] = [0];
  assert.throws(() => computeScenario(badTerrain, {durationHours: 1}), /distance samples/);
  assert.throws(() => integratePowerSeries(power([0, 0], [0, 0]), settings({})), /must increase/);
});


test('the packaged real DEM and SPICE bundle supports every prepared site and conserves energy', () => {
  const bundle = JSON.parse(readFileSync(new URL('../web/data/lunar-data.json', import.meta.url), 'utf8'));
  assert.ok(bundle.sites.length >= 1);
  const results = bundle.sites.map(site => computeScenario(bundle, {siteId: site.id,
    startUTC: '2026-11-07T00:00:00Z', durationHours: 168, stepMinutes: 5, loadW: 80}));
  for (const result of results) {
    assert.equal(result.samples.length, 2017);
    assert.ok(result.horizon.rangeLimitM >= 5000);
    assert.equal(result.horizon.elevationDeg.length, result.site.terrain.azimuth_deg.length);
    for (const name of ['energyKWh', 'unservedKWh', 'sunlitPct', 'minSocPct', 'finalSocPct']) {
      assert.ok(Number.isFinite(result.metrics[name]), `${result.site.id} ${name} should be finite`);
    }
    assert.ok(result.metrics.sunlitPct >= 0 && result.metrics.sunlitPct <= 100);
    balanced(result.metrics);
  }
  assert.ok(results.some(r => r.metrics.energyKWh > 0), 'The study bundle should include an illuminated scenario.');
  assert.ok(results.some(r => r.metrics.longestNoSunHours > 0), 'The study bundle should include a terrain-shadowed scenario.');
});
