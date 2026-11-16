import * as THREE from 'three';

const RADIUS = 1737400;
const RAD = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);

// Place each isolated, locally north-aligned patch relative to a fixed lunar
// reference. The camera travels with the patch; patches are not stitched.
function siteOffset(site, reference) {
  const lat = site.latitude_deg * RAD, lon = site.longitude_deg * RAD;
  const refLat = reference.latitude_deg * RAD, refLon = reference.longitude_deg * RAD;
  const radius = RADIUS + site.ground_elevation_m;
  const deltaLon = lon - refLon;
  return new THREE.Vector3(
    radius * Math.cos(lat) * Math.sin(deltaLon),
    radius * (Math.sin(lat) * Math.sin(refLat) + Math.cos(lat) * Math.cos(refLat) * Math.cos(deltaLon))
      - (RADIUS + reference.ground_elevation_m),
    -radius * (Math.sin(lat) * Math.cos(refLat) - Math.cos(lat) * Math.sin(refLat) * Math.cos(deltaLon)),
  );
}

/** Selected site's packaged LOLA mesh, shared by rendering and ground contact. */
export class MissionSiteSurface {
  constructor(reference) {
    this.reference = reference;
    this.site = null;
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({
      color: 0x9e9fa3, roughness: 1, metalness: 0, envMapIntensity: 0,
      side: THREE.DoubleSide,
    }));
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.mesh.visible = false;
  }

  selectSite(site) {
    if (this.site === site) return false;
    const m = site.mesh;
    if (!m || m.width < 2 || m.height < 2 || !(m.spacing_m > 0)
      || !['south_to_north', 'north_to_south'].includes(m.row_order)) {
      throw new Error('Selected site has no prepared terrain mesh.');
    }
    const sign = m.row_order === 'south_to_north' ? 1 : -1;
    const positions = [], indices = [], valid = [];
    for (let r = 0; r < m.height; r++) for (let c = 0; c < m.width; c++) {
      const e = m.origin_x_m + c * m.spacing_m;
      const n = m.origin_y_m + sign * r * m.spacing_m;
      const elevation = m.elevations_m[r]?.[c];
      valid.push(Number.isFinite(elevation));
      positions.push(e, Number.isFinite(elevation)
        ? elevation - site.ground_elevation_m - (e * e + n * n) / (2 * RADIUS) : 0, -n);
    }
    for (let r = 0; r < m.height - 1; r++) for (let c = 0; c < m.width - 1; c++) {
      const a = r * m.width + c, b = a + 1, d = a + m.width, e = d + 1;
      for (const triangle of [[a,b,d],[b,e,d]]) {
        if (triangle.every(i => valid[i])) indices.push(...(sign > 0 ? triangle : triangle.reverse()));
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    this.mesh.geometry.dispose();
    this.mesh.geometry = geometry;
    this.mesh.position.copy(siteOffset(site, this.reference));
    this.mesh.visible = true;
    this.site = site;
    this.valid = valid;
    return true;
  }

  sampleHeight(x, z) {
    if (!this.site) return null;
    const m = this.site.mesh, p = this.mesh.geometry.attributes.position;
    const sign = m.row_order === 'south_to_north' ? 1 : -1;
    const col = (x - this.mesh.position.x - m.origin_x_m) / m.spacing_m;
    const row = (-(z - this.mesh.position.z) - m.origin_y_m) / (sign * m.spacing_m);
    if (col < 0 || row < 0 || col > m.width - 1 || row > m.height - 1) return null;
    const c = Math.min(m.width - 2, Math.floor(col)), r = Math.min(m.height - 2, Math.floor(row));
    const u = col - c, v = row - r, a = r * m.width + c, b = a + 1, d = a + m.width, e = d + 1;
    const triangle = u + v <= 1 ? [[a,1-u-v],[b,u],[d,v]] : [[b,1-v],[e,u+v-1],[d,1-u]];
    if (triangle.some(([i]) => !this.valid[i])) return null;
    return this.mesh.position.y + triangle.reduce((h,[i,w]) => h + p.getY(i) * w, 0);
  }

  /** @param {number | Array<[number, number]>} footprint Four-foot radius or actual local contact points. */
  groundPose(x, z, heading, footprint) {
    const feet = typeof footprint === 'number'
      ? Array.from({length:4}, (_,i) => [Math.cos(Math.PI/4+i*Math.PI/2)*footprint, Math.sin(Math.PI/4+i*Math.PI/2)*footprint])
      : footprint;
    const radius = Math.max(...feet.map(([x,z]) => Math.hypot(x,z)));
    const h = this.sampleHeight(x,z), left = this.sampleHeight(x-radius,z), right = this.sampleHeight(x+radius,z);
    const north = this.sampleHeight(x,z-radius), south = this.sampleHeight(x,z+radius);
    if ([h,left,right,north,south].some(v => v === null)) return null;
    const normal = new THREE.Vector3((left-right)/(2*radius),1,(north-south)/(2*radius)).normalize();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(UP,normal)
      .multiply(new THREE.Quaternion().setFromAxisAngle(UP,heading));
    let y = -Infinity;
    for (const [footX,footZ] of feet) {
      const foot = new THREE.Vector3(footX,0,footZ).applyQuaternion(quaternion);
      const height = this.sampleHeight(x+foot.x,z+foot.z);
      if (height === null) return null;
      y = Math.max(y,height-foot.y);
    }
    return {position:new THREE.Vector3(x,y,z),quaternion};
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
