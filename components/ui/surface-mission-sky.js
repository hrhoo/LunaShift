import {Plane} from 'three';

// Match the manual mission view's local frame: east +X, up +Y, north -Z.
// Distances and body sizes are compressed/enlarged for this explanatory scene;
// the directions come directly from the selected mission's topocentric sample.
const RAD = Math.PI / 180;
const SUN_DISPLAY_DISTANCE = 15870;
const EARTH_DISPLAY_DISTANCE = 9600;
export const SUN_DISPLAY_RADIUS = 530;

/** @param {number} radius @param {{opacity: number}} coronaMaterial */
export function createSunOcclusion(radius, coronaMaterial) {
  return {plane: new Plane(), radius, coronaMaterial, coronaOpacity: coronaMaterial.opacity};
}

// Invert the area of a unit circle above a horizontal cut. This represents the
// model's visible fraction on the enlarged disc without changing its bearing.
// It is an equivalent straight skyline, not a reconstruction of distant ridges
// or eclipse silhouettes (the numerical model already accounts for both).
function discCutHeight(fraction) {
  if (fraction <= 0) return 1;
  if (fraction >= 1) return -1;
  let lo = -1, hi = 1;
  for (let i = 0; i < 40; i++) {
    const cut = (lo + hi) / 2;
    const area = (Math.acos(cut) - cut * Math.sqrt(1 - cut * cut)) / Math.PI;
    if (area > fraction) lo = cut;
    else hi = cut;
  }
  return (lo + hi) / 2;
}

function updateSunOcclusion(occlusion, sun, direction, fraction) {
  if (!occlusion) return;
  const {plane, radius, coronaMaterial, coronaOpacity} = occlusion;
  // Local sky-up, perpendicular to the observer-to-Sun ray. Three.js clips the
  // negative half-space, leaving the upper cap of the solar disc visible.
  plane.normal.set(0, 1, 0).addScaledVector(direction, -direction.y);
  if (plane.normal.lengthSq() < 1e-12) plane.normal.set(0, 0, 1);
  plane.normal.normalize();
  plane.constant = -plane.normal.dot(sun.position) - radius * discCutHeight(fraction);
  coronaMaterial.opacity = coronaOpacity * fraction;
}

function setDirection(target, azimuthDeg, elevationDeg) {
  const az = azimuthDeg * RAD, el = elevationDeg * RAD;
  return target.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

/** Update the visible bodies and the directional light from one mission sample.
 * @param {{sun: import('three').Object3D, earth: import('three').Object3D,
 * light: import('three').DirectionalLight, sunDirection: import('three').Vector3,
 * sunOcclusion?: ReturnType<typeof createSunOcclusion> | null}} objects
 */
export function updateSurfaceMissionSky({sun, earth, light, sunDirection, sunOcclusion = null}, sample, observer) {
  if (!sample) {
    sun.visible = earth.visible = false;
    light.intensity = 0;
    if (sunOcclusion) sunOcclusion.coronaMaterial.opacity = 0;
    return;
  }
  setDirection(sunDirection, sample.sunAzDeg, sample.sunElDeg);
  sun.position.copy(sunDirection).multiplyScalar(SUN_DISPLAY_DISTANCE).add(observer);
  setDirection(earth.position, sample.earthAzDeg, sample.earthElDeg)
    .multiplyScalar(EARTH_DISPLAY_DISTANCE).add(observer);

  // Partial visibility must change the disc before it reaches zero; otherwise
  // the enlarged Sun looks fully exposed and then disappears in a single frame.
  const sunFraction = Math.max(0, Math.min(1, sample.sunFraction));
  updateSunOcclusion(sunOcclusion, sun, sunDirection, sunFraction);
  sun.visible = sunFraction > 1e-8;
  earth.visible = sample.earthFraction > 1e-8;
  light.target.position.copy(observer);
  light.position.copy(sunDirection).multiplyScalar(115).add(observer);
  light.intensity = 5.4 * sunFraction;
}
