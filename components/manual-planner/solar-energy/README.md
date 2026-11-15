# Planner solar energy map

Ported from the original LunaShift web energy map. The open panel appears immediately below the inspected plan result in Manual Planner. Generate a 3 × 3 km survey using the inspected plan’s location, UTC dates, height, area and panel orientation. Layer and display controls, keyboard/click inspection, progress, cancellation and PNG/CSV export are supported.

The survey uses its own module worker and the original direct/reflected numerical model. It does not adopt a site or change the existing mission model, worker or summary. The current mission summary uses direct solar power; the map additionally assumes terrain reflectance 0.12 when the inspected settings do not specify it. Values are gross electrical kWh/m² before battery storage and consumption. The node grid, time step and angular sampling are approximations over the prepared terrain, not a continuous landing-site assessment.

Changing the inspected plan invalidates the old map. Closing Manual Planner terminates survey work and disconnects its observer. In-app figures inherit the existing charcoal palette and cyan controls; PNG exports retain the original white scientific-figure background. No product-wide design changes.

Validation: `npm run lint`, `npm run build`, and `node --test tests/energy-map*.test.mjs tests/terrain-relief.test.mjs`.
