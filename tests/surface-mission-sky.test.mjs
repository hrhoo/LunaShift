import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {evaluate, DEFAULTS, sampleAt} from '../components/manual-planner/core/rehearsal.js';
import {updateSurfaceMissionSky, createSunOcclusion, SUN_DISPLAY_RADIUS} from '../components/ui/surface-mission-sky.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
function objects() {
  return {sun: new THREE.Group(), earth: new THREE.Group(),
    light: new THREE.DirectionalLight(), sunDirection: new THREE.Vector3()};
}
const origin = new THREE.Vector3(40, 12, -25);
function sample(sunAzDeg, sunElDeg, earthAzDeg = sunAzDeg, earthElDeg = sunElDeg) {
  return {sunAzDeg, sunElDeg, earthAzDeg, earthElDeg, sunFraction: 1, earthFraction: 1};
}
function direction(body) { return body.position.clone().sub(origin).normalize(); }

function displayedSunFraction(sky) {
  const cut = Math.max(-1,Math.min(1,-sky.sunOcclusion.plane.distanceToPoint(sky.sun.position)/SUN_DISPLAY_RADIUS));
  return (Math.acos(cut)-cut*Math.sqrt(1-cut*cut))/Math.PI;
}

test('Lower ground November 26 shows a shrinking solar sliver instead of a full Sun switching off', () => {
  const bundle = JSON.parse(readFileSync(new URL('../public/data/lunar-data.json',import.meta.url),'utf8'));
  const result = evaluate(bundle,{...DEFAULTS,siteId:'ridge-low',startUTC:'2026-11-26T00:00:00Z'});
  const sky = objects();
  const glow = new THREE.SpriteMaterial({opacity:.8});
  sky.sunOcclusion = createSunOcclusion(SUN_DISPLAY_RADIUS,glow);
  let previous = 1;
  for (const minutes of [0,1,2,5,6,8,9,10]) {
    const s = sampleAt(result,minutes/60);
    updateSurfaceMissionSky(sky,s,origin);
    assert.ok(s.sunFraction<.01);
    near(displayedSunFraction(sky),s.sunFraction);
    near(glow.opacity,.8*s.sunFraction);
    assert.ok(displayedSunFraction(sky)<=previous);
    previous=displayedSunFraction(sky);
  }
  assert.equal(sky.sun.visible,false);
  assert.equal(glow.opacity,0);
  // Scrubbing backwards restores the correct partial disc immediately.
  const start = sampleAt(result,0);
  updateSurfaceMissionSky(sky,start,origin);
  near(displayedSunFraction(sky),start.sunFraction);
  assert.equal(sky.sun.visible,true);
  glow.dispose();
});

test('solar clipping preserves the upper disc and restores full visibility without altering the light model', () => {
  const sky = objects();
  const glow = new THREE.SpriteMaterial();
  sky.sunOcclusion = createSunOcclusion(SUN_DISPLAY_RADIUS,glow);
  for (const fraction of [1,.75,.5,.1,.001,0,1]) {
    updateSurfaceMissionSky(sky,{...sample(110,2),sunFraction:fraction},origin);
    near(displayedSunFraction(sky),fraction);
    near(sky.light.intensity,5.4*fraction);
  }
  updateSurfaceMissionSky(sky,{...sample(110,2),sunFraction:.5},origin);
  const up = sky.sunOcclusion.plane.normal;
  near(up.dot(sky.sunDirection),0);
  assert.ok(sky.sunOcclusion.plane.distanceToPoint(sky.sun.position.clone().addScaledVector(up,SUN_DISPLAY_RADIUS))>0);
  assert.ok(sky.sunOcclusion.plane.distanceToPoint(sky.sun.position.clone().addScaledVector(up,-SUN_DISPLAY_RADIUS))<0);
  updateSurfaceMissionSky(sky,null,origin);
  assert.equal(glow.opacity,0);
  glow.dispose();
});

test('sky bearings use local east +X, up +Y and north -Z from the lander', () => {
  const sky = objects();
  for (const [az, expected] of [[0,[0,0,-1]], [90,[1,0,0]], [180,[0,0,1]], [270,[-1,0,0]]]) {
    updateSurfaceMissionSky(sky, sample(az,0), origin);
    direction(sky.sun).toArray().forEach((n,i) => near(n,expected[i]));
    direction(sky.earth).toArray().forEach((n,i) => near(n,expected[i]));
  }
  updateSurfaceMissionSky(sky, sample(0,90,0,-30), origin);
  near(direction(sky.sun).y,1);
  near(direction(sky.earth).y,-.5);
});

test('light and shadows follow the Sun; fully obstructed bodies disappear', () => {
  const sky = objects();
  updateSurfaceMissionSky(sky, {...sample(123,8,250,-3), sunFraction:.4, earthFraction:0}, origin);
  near(sky.light.position.clone().sub(sky.light.target.position).normalize().distanceTo(direction(sky.sun)),0);
  near(sky.light.intensity,5.4*.4);
  assert.equal(sky.sun.visible,true);
  assert.equal(sky.earth.visible,false);
  updateSurfaceMissionSky(sky, {...sample(123,-8),sunFraction:0}, origin);
  assert.equal(sky.sun.visible,false);
  assert.equal(sky.light.intensity,0);
});

test('unavailable sky data hides stale display positions and direct sunlight', () => {
  const sky = objects();
  updateSurfaceMissionSky(sky,sample(45,10),origin);
  updateSurfaceMissionSky(sky,null,origin);
  assert.equal(sky.sun.visible,false);
  assert.equal(sky.earth.visible,false);
  assert.equal(sky.light.intensity,0);
});

test('mission date, site, playback, rewind and north-crossing use planner samples', () => {
  const bundle = JSON.parse(readFileSync(new URL('../public/data/lunar-data.json',import.meta.url),'utf8'));
  const a = evaluate(bundle,DEFAULTS);
  const movedSite = evaluate(bundle,{...DEFAULTS, siteId:'ridge-shoulder'});
  const laterDate = evaluate(bundle,{...DEFAULTS, startUTC:'2026-11-20T00:00:00Z'});
  const sky = objects();
  const seen = [];
  for (const [result,hour] of [[a,0],[a,12],[movedSite,12],[laterDate,12],[a,0]]) {
    const s = sampleAt(result,hour);
    updateSurfaceMissionSky(sky,s,origin);
    for (const [body,az,el] of [[sky.sun,s.sunAzDeg,s.sunElDeg],[sky.earth,s.earthAzDeg,s.earthElDeg]]) {
      const d = direction(body);
      near((Math.atan2(d.x,-d.z)*180/Math.PI+360)%360,az);
      near(Math.asin(d.y)*180/Math.PI,el);
    }
    seen.push({sun:sky.sun.position.clone(),earth:sky.earth.position.clone()});
  }
  for (const body of ['sun','earth']) {
    assert.ok(seen[0][body].distanceTo(seen[1][body])>1);
    assert.ok(seen[1][body].distanceTo(seen[2][body])>1);
    assert.ok(seen[1][body].distanceTo(seen[3][body])>1);
    near(seen[0][body].distanceTo(seen[4][body]),0);
  }
  const crossing = {...a, samples:[
    {...a.samples[0],elapsedHours:0,sunAzDeg:359,earthAzDeg:359},
    {...a.samples[0],elapsedHours:1,sunAzDeg:1,earthAzDeg:1},
  ]};
  updateSurfaceMissionSky(sky,sampleAt(crossing,.5),origin);
  near(direction(sky.sun).x,0);
  assert.ok(direction(sky.sun).z<0);
});
