import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Vector3} from 'three';
import {MissionSiteSurface} from '../components/ui/mission-site-surface.js';

const bundle = JSON.parse(readFileSync(new URL('../public/data/lunar-data.json',import.meta.url),'utf8'));
const [crest,shoulder,low] = bundle.sites;
const near = (a,b,tol=1e-5) => assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);

test('selecting another landing site changes ground geometry and geographic placement; returning restores it', () => {
  const surface = new MissionSiteSurface(crest);
  try {
    surface.selectSite(crest);
    const original = surface.mesh.geometry.attributes.position.array.slice();
    const originalPosition = surface.mesh.position.clone();
    let disposed = false;
    surface.mesh.geometry.addEventListener('dispose',()=>disposed=true);
    assert.equal(surface.selectSite(crest),false);
    assert.equal(surface.selectSite(shoulder),true);
    assert.ok(disposed);
    assert.ok(surface.mesh.position.distanceTo(originalPosition)>100);
    assert.notDeepEqual(surface.mesh.geometry.attributes.position.array,original);
    surface.selectSite(low);
    assert.equal(surface.site.id,'ridge-low');
    surface.selectSite(crest);
    assert.deepEqual(surface.mesh.geometry.attributes.position.array,original);
    near(surface.mesh.position.distanceTo(originalPosition),0);
  } finally { surface.dispose(); }
});

test('rendered terrain retains the selected site DEM elevations and geographic row order', () => {
  const surface = new MissionSiteSurface(crest);
  try {
    for (const site of bundle.sites) {
      surface.selectSite(site);
      const m = site.mesh, p = surface.mesh.geometry.attributes.position;
      for (const [r,c] of [[75,75],[0,0],[90,80],[150,150]]) {
        const i = r*m.width+c;
        const e = m.origin_x_m+c*m.spacing_m, n = m.origin_y_m+r*m.spacing_m;
        near(p.getX(i),e); near(p.getZ(i),-n);
        near(p.getY(i),m.elevations_m[r][c]-site.ground_elevation_m-(e*e+n*n)/(2*1737400),1e-3);
        near(surface.sampleHeight(surface.mesh.position.x+e,surface.mesh.position.z-n),surface.mesh.position.y+p.getY(i),1e-3);
      }
    }
  } finally { surface.dispose(); }
});

test('lander feet and camera clearance sample the same selected surface', () => {
  const surface = new MissionSiteSurface(crest);
  try {
    for (const site of bundle.sites) {
      surface.selectSite(site);
      const {position,quaternion} = surface.groundPose(surface.mesh.position.x,surface.mesh.position.z,-.41,2.48);
      const gaps = [];
      for (let i=0;i<4;i++) {
        const a=Math.PI/4+i*Math.PI/2;
        const foot = new Vector3(Math.cos(a)*2.48,0,Math.sin(a)*2.48).applyQuaternion(quaternion).add(position);
        gaps.push(foot.y-surface.sampleHeight(foot.x,foot.z));
      }
      assert.ok(Math.min(...gaps)>=-1e-6);
      near(Math.min(...gaps),0);
      assert.ok(Number.isFinite(surface.sampleHeight(position.x+25,position.z+25)));
    }
  } finally { surface.dispose(); }
});

test('missing terrain coverage is not filled with invented heights', () => {
  const site=structuredClone(crest);
  site.mesh.elevations_m[75][75]=null;
  const surface = new MissionSiteSurface(crest);
  try {
    surface.selectSite(site);
    assert.equal(surface.sampleHeight(surface.mesh.position.x,surface.mesh.position.z),null);
    assert.equal(surface.sampleHeight(surface.mesh.position.x+2000,surface.mesh.position.z),null);
    assert.equal(surface.groundPose(surface.mesh.position.x,surface.mesh.position.z,0,2.48),null);
  } finally { surface.dispose(); }
});

test('the habitat rests on its actual skid pads instead of a generic circular footprint', () => {
  const feet = [-4.62,-3.84,-1.92,0,1.92,3.84,4.62].flatMap(z=>[-2.31,2.31].map(x=>[x,z]));
  const surface = new MissionSiteSurface(crest);
  try {
    for (const site of bundle.sites) {
      surface.selectSite(site);
      const {position,quaternion} = surface.groundPose(surface.mesh.position.x-15,surface.mesh.position.z-8,-.62,feet);
      const gaps = feet.map(([x,z]) => {
        const foot = new Vector3(x,0,z).applyQuaternion(quaternion).add(position);
        return foot.y-surface.sampleHeight(foot.x,foot.z);
      });
      assert.ok(Math.min(...gaps)>=-1e-6);
      near(Math.min(...gaps),0);
    }
  } finally { surface.dispose(); }
});
