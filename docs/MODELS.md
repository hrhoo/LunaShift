# Geometry-source note for v0.5.0

SPICE and Horizons supply the same validated Sun/Earth track schema. Managed SPICE uses DE421/MOON_ME_DE421 with CN+S reception corrections and spherical local north/east/up. Terrain, energy and radio models below are unchanged. SPICE does not add measured hardware, global shadow maps or real ground-station scheduling. Read SPICE.md for provenance and numerical-verification limits.

# Model reference · v0.3

All times are UTC. Distances and elevations are explicit. Energy is in kWh, power in W, storage in decimal GB (1 GB = 8e9 bits), and radio carrier power in dBW. Hardware presets are illustrative, not measured CLPS landers.

## Geometry

The inherited engine computes terrain elevation angles on a 1,737,400 m spherical Moon using finite sampled rays. The highest sample per azimuth defines the skyline; interpolation evaluates it at the Sun/Earth direction. The visibility engine uses body-centre thresholds. A fixed imported horizon can only be used at its declared observer height. A ray dataset can be recomputed for other heights.

## Solar power

`P = irradiance × area × cell_efficiency × electrical_efficiency × contamination_factor × temperature_factor × incidence × visible_solar_disc_fraction`.

Irradiance scales with the ephemeris Sun distance when available; otherwise the stated 1-AU reference is used. Incidence is the nonnegative panel-normal dot Sun-direction. Tracking mode is ideal two-axis tracking, vertical tracking is an ideal vertical normal that follows azimuth, horizontal mode uses the local upward normal, and fixed mode uses entered tilt/azimuth.

The solar disc is uniform and intersected by a straight local skyline. It is not a detailed integration over an irregular skyline, limb darkening, panel shadow or Sun-reflected terrain radiation. Temperature is a fixed user assumption with a linear coefficient, not Diviner-derived cell temperature. Tracker mechanical limits and power are not included.

Power is integrated using mean endpoint values over each time interval. Shadow energy loss compares the actual skyline with smooth-sphere visibility at the same height and radius; ordinary lunar night is not charged as terrain loss. Partial-disc power can differ from the centre-based visibility percentage, by design.

## Battery and operations

Serve base and heater demand first. Run science with remaining power. Transmit stored science only with sufficient energy above reserve. Transmission costs `RF power / amplifier efficiency + electronics power`, scaled by duty cycle. Battery charge/discharge efficiencies and W limits are enforced. Unsupplied survival demand is recorded before energy is clamped at zero. Overflow from the data buffer is recorded, not silently removed from accounting.

The module records harvested energy, served load, stored energy change, spilled energy, charging loss and discharge loss. Automated tests close this balance. Data generation, returned bits, remaining storage and overflow also balance. The scheduling rule is deterministic and explicit, not optimized RL. Sampled-average dispatch can obscure events inside a long interval; refine the time grid.

## Radio screening

`antenna_gain = 10 log10[efficiency × (pi × diameter / wavelength)^2]`

`FSPL = 20 log10[4 pi × range / wavelength]`

`received_dBW = transmit_dBW + transmit_gain + receive_gain - FSPL - other_losses`

`C/N0 = received_dBW - 10 log10(k × system_noise_temperature)`

`requested_margin = C/N0 - 10 log10(requested_bit_rate) - required_Eb/N0 - design_margin`

The modeled adaptive rate is capped by requested rate, bandwidth × specified spectral efficiency, and the user-defined required Eb/N0. Requested-rate margin may be negative while a reduced modeled rate remains available. A zero requested-rate margin includes the added design margin. Electrically small dishes (less than two wavelengths) are rejected because this aperture model is unsuitable for them.

Earth-centre terrain clearance gates the link proxy. A particular station can be below its Earth-side horizon or hidden on Earth's disc even when this proxy passes. **No DSN antenna schedule, station coordinates, atmospheric model, coding-error curve, interference, surface multipath, fading probability or receiver outage is included.** The generic receiver is assumed available. Earth visibility and predicted link budget are never a promised communication contact.

## Mission and repair status

Energy/data pass: reserve respected, survival demand met, requested data returned and no storage overflow. The combined verdict also respects enabled visibility/slope constraints. Hardware repairs retain those same visibility limits: increasing panel area does not override a separately specified minimum sunlight percentage.

The finite search tries saved sites, optional 0/12/24-hour shifts, and panel/battery factors of 1, 1.5 and 2. The cost sums normalized relocation, relative area/capacity changes and normalized delay. It is not a global optimum, total mass, real currency or launch feasibility. The earlier site/date/height repair remains available on its original page.

## Missing information

Missing terrain/track coverage returns unknown, not a favourable forecast. Synthetic environments remain labelled. Fallback range/reference irradiance are explicit. There is no calibrated uncertainty probability. Uncertainty rasters and averages are context only until a validated propagation method is added.
