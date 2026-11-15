import React, { memo } from 'react';
import '../manual-planner/solar-energy/energy-map.css';

// The existing planner controller owns the calculated values inside this shell.
export const SolarEnergyPanel = memo(function SolarEnergyPanel() {
  return (
    <details id="energyMapSection" className="energy-map" open>
      <summary>
        <span data-icon="sun" />
        Solar energy map
        <small>Direct + terrain-reflected sunlight</small>
        <span className="energy-map-chevron" data-icon="down" />
      </summary>
      <div className="energy-map-inner">
        <p id="energyMapContext" className="energy-map-context">Loading the inspected plan’s site, dates and panel settings.</p>
        <div className="energy-map-toolbar">
          <label>Energy layer<select id="energyMapLayer" defaultValue="total"><option value="total">Direct + reflected</option><option value="direct">Direct only</option><option value="reflected">Reflected only</option></select></label>
          <label>Sample spacing<select id="energyMapGrid" defaultValue="21"><option value="11">300 m · quick</option><option value="21">150 m · standard</option><option value="31">100 m · finer</option><option value="41">75 m · detailed</option></select></label>
          <label>Display<select id="energyMapDisplay" defaultValue="smooth"><option value="smooth">Smooth</option><option value="cells">Sample cells</option></select></label>
          <label>Map view<select id="energyMapSurface" defaultValue="relief"><option value="relief">Energy + relief</option><option value="energy">Energy only</option><option value="terrain">Terrain only</option></select></label>
          <label>Time step<select id="energyMapStep" defaultValue="30"><option value="60">60 minutes</option><option value="30">30 minutes</option><option value="15">15 minutes</option><option value="5">5 minutes</option></select></label>
          <button id="generateEnergyMap" className="primary" type="button" disabled><span data-icon="sun" />Generate energy map</button>
          <button id="cancelEnergyMap" className="secondary" type="button" hidden>Cancel</button>
        </div>
        <div className="energy-map-status-row">
          <span id="energyMapStatus" role="status">Ready to calculate a 3 × 3 km terrain survey.</span>
          <progress id="energyMapProgress" max={1} value={0} aria-label="Energy map calculation progress" hidden />
        </div>
        <div id="energyMapEmpty" className="energy-map-empty">
          <h3>See where the Sun delivers energy.</h3>
          <p>Generate a map to compare the same solar panel at points around your site, including terrain shadows and reflected sunlight over the inspected plan’s dates.</p>
        </div>
        <div id="energyMapBody" className="energy-map-body" hidden>
          <figure className="energy-map-figure">
            <span id="energyMapRange" />
            <canvas id="energyMapCanvas" tabIndex={0} role="img" aria-label="Solar energy and terrain relief map. Click a point or use arrow keys to inspect its energy." aria-describedby="energyMapHelp energyMapTerrainNote" />
            <figcaption id="energyMapHelp">Click or use the arrow keys to inspect the nearest calculated sample. Smooth display interpolates between energy samples. Orange marks the plan site; dashed lines mark zero east/north.</figcaption>
            <p id="energyMapTerrainNote" className="energy-map-terrain-note" />
          </figure>
          <aside className="energy-map-sample" aria-label="Selected map point">
            <h3>Total electrical energy</h3>
            <p id="energyMapSelected" aria-live="polite" />
            <div className="energy-map-value"><strong id="energyMapTotal">—</strong><span>kWh/m²</span></div>
            <dl>
              <div><dt>Direct sunlight</dt><dd id="energyMapDirect">—</dd></div>
              <div><dt>Terrain-reflected sunlight</dt><dd id="energyMapReflected">—</dd></div>
              <div><dt>Your panel’s gross energy</dt><dd id="energyMapPanel">—</dd></div>
            </dl>
            <p id="energyMapCoordinates" />
            <p id="energyMapAssumptions" />
          </aside>
        </div>
        <div className="energy-map-downloads">
          <button id="energyMapPNG" className="secondary" type="button" disabled><span data-icon="download" />Save map PNG</button>
          <button id="energyMapCSV" className="secondary" type="button" disabled><span data-icon="download" />Download data CSV</button>
        </div>
        <p className="energy-map-footnote">Gross electrical energy before storage and consumption. This map includes terrain reflection (assumed reflectance 0.12); the mission summary above uses direct sunlight only. Map sampling differs from the single-site mission. Generating or inspecting a map does not change your plan.</p>
        <p className="energy-map-footnote">Coverage is limited to the prepared LOLA terrain. Finer sampling can change results; this survey does not assess landing safety. <a href="https://pgda.gsfc.nasa.gov/products/78" target="_blank" rel="noopener noreferrer">NASA terrain source</a></p>
      </div>
    </details>
  );
});
