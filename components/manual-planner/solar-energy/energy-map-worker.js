import {computeEnergyMap} from './core/energy-map.js';

// Dedicated to the spatial survey so cancelling never interrupts mission work.
let bundle = null;
self.onmessage = async ({data}) => {
  const {id, type} = data;
  try {
    if (type === 'init') {
      bundle = data.bundle;
      self.postMessage({id, ok: true});
    } else if (type === 'energyMap') {
      if (!bundle) throw new Error('Terrain data is not ready. Reload and try again.');
      const result = await computeEnergyMap(bundle, data.settings, data.options,
        detail => self.postMessage({id, progress: detail.fraction, detail}));
      self.postMessage({id, ok: true, result});
    } else {
      throw new Error('Unsupported energy-map request.');
    }
  } catch (error) {
    self.postMessage({id, ok: false, error: error.message});
  }
};
