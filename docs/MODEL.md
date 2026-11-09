# LunaShift v7 model definition

This is the implementation contract, not a flight qualification report. Numerical functions live in `web/solar-model.js` and `web/mission-model.js` and are tested independently of the interface.

## 1. Geometry and frames

Coordinates are planetocentric latitude and east-positive longitude in `MOON_ME_DE421`. Heights are radial metres above a 1,737,400 m reference sphere. A site observer is located at the site ground elevation plus the selected point height. Local north/east/up are constructed from that site's coordinates.

For a terrain sample at reference-sphere arc distance d and absolute elevation z, with observer radius r0 and lunar reference radius R, its local elevation angle is:

    atan2((R+z) cos(d/R) - r0, (R+z) sin(d/R))

The maximum over each sampled azimuth is the skyline. This uses spherical curvature rather than a flat map. Azimuth interpolation is periodic through north. Beyond the last measured terrain range, the assumed surface is the reference-radius sphere, only outside that range. It is not a sphere inflated to the site's altitude. Unmeasured distant mountains and between-ray obstructions remain a limitation.

Terrain imported as a fixed-height skyline can only be evaluated at that height; changing height requires radial terrain samples. Source frames must be declared. A clicked global coordinate does not create a skyline.

## 2. Ephemeris

The original v6 Sun vectors are retained. Earth vectors are computed from the same supplied, hash-verified DE421 SPK and lunar PCK/FK set. The restricted reader evaluates the documented little-endian type-2 Chebyshev segments; it is not a general SPICE replacement. Its lunar frame agrees with the existing SPICE Sun vectors at the tested sample times (see EPHEMERIS_CHECKS.json).

Hourly geometric Cartesian vectors are linearly interpolated. Observer position is subtracted before converting to local azimuth and elevation. No aberration, light-time or atmospheric refraction corrections are applied. UTC conversion follows the bundled naif0012 leap-second table, within the packaged 2026–2027 interval. No extrapolation is allowed.

Earth-fixed to Moon-fixed rotations are stored as unit quaternions (x,y,z,w), interpolated by shortest-path SLERP. Earth orientation is **IAU_EARTH from pck00011**, not high-accuracy ITRF/EOP. A more precise station-tracking deployment should replace this Earth orientation and perform independent ephemeris checks.

## 3. Solar visibility and electrical generation

The finite, uniform solar disc is integrated across the local terrain skyline using 65 strips in the original solar core. The Sun's angular radius and irradiance vary with distance. The adopted irradiance reference is 1361 W/m² at one astronomical unit. Moon terrain has no atmospheric-refraction correction.

When Earth's geometric disc overlaps the Sun, 101-strip quadrature calculates the intersection of the unocculted solar disc and the visible-above-terrain region. Earth's atmosphere and refracted eclipse light are omitted.

    Psolar = irradiance × area × efficiency × declared_loss_factor
             × visible_solar_disc_fraction × max(0, panel_normal · sun_direction)

Presets are horizontal, fixed tilt/azimuth, vertical with azimuth tracking, and ideal two-axis tracking. Efficiency and losses are user assumptions, not a modeled thermal or dust forecast. Tracking has no mechanical limit or motor load. Collectors are represented at one reference point: finite panel footprints, self-shadowing, cell strings, bypass diodes, nonlinear partial-shading loss, deployment feasibility and temperature dependence are not modeled. The displayed panel symbol is not to physical scale.

Raw harvested energy is the time integral of panel output. It is distinct from stored task energy and from energy delivered to loads.

## 4. Storage, loads and task readiness

Base demand plus a single optional scheduled payload is served first. The scheduled start/end and mission deadlines split the calculation intervals. Geometry and generation are approximated at the midpoint of each piece, using the sampled values.

Surplus energy charges the battery with eta_charge until its capacity is reached; further energy is recorded as curtailed. A power deficit discharges the battery with eta_discharge; demand remaining after battery depletion is unserved energy. Each case retains separate charging loss, discharging loss and curtailment.

The conservation identity is:

    generated + initial battery = served demand + final battery
                                  + curtailed + charge loss + discharge loss

Task-ready time is the first time that:

    stored energy >= battery capacity × reserve fraction + task_energy

Initial battery energy counts. The task target is **not executed or deducted** by this readiness check. The optional scheduled payload is a separate actual load. The UI states this distinction. A target exceeding storage capacity above reserve is rejected as infeasible, not described as available because gross generation is large.

Charge and reserve threshold crossings use physical charge/discharge rates, including when the battery fills or empties before an interval ends. Raw harvest-target time is reported separately.

## 5. Earth visibility and a ground-station link

Earth-centre visibility means its centre ray clears the antenna skyline. The illustrative Earth-disc percentage uses a locally horizontal cutoff at the centre azimuth; it is not a full rough-skyline Earth-disc integration. **The station link uses the actual station ray, not this disc percentage.**

Station ECEF positions for the DSS 14, 43 and 63 reference locations are from the official RISE raw-data SIS documentation. Custom coordinates use a WGS84 geodetic conversion. The chosen station vector is rotated into the lunar frame and added to Earth-centre position. A link requires BOTH:

1. The station direction clears lunar terrain plus the user's angular clearance.
2. The lander lies above the user's elevation mask at the Earth station.

Reference station names do not imply DSN availability, scheduling, or actual receiver performance. G/T and antenna assumptions remain editable generic model inputs.

## 6. Preliminary radio budget and energy coupling

All log terms below are in decibels; power is dBW, G/T is dB/K, frequency in Hz, range in metres, and rate in bit/s.

    FSPL = 20 log10(4 pi range frequency / c)
    C/N0 = 10 log10(Ptx_W) + Gtx + G/T - FSPL - other_losses + 228.599167
    Rbudget = 10^((C/N0 - required_EbN0 - fade_margin)/10)
    payload_rate = protocol_efficiency × min(Rbudget, user_max_rate)

This is ideal continuous adaptive-rate operation, not a specific flight modem. Discrete coding/rate tables, minimum acquisition rate, Doppler acquisition, detailed antenna patterns, atmospheric weather, interference, retransmission and receiver PLL behavior are omitted.

Radio electrical power while transmitting is:

    Ptx_W / power_amplifier_efficiency + radio_overhead_W

All data is assumed available at landing. Transmission proceeds when two-sided geometry is open and energy permits, then stops at the data target. Base/payload load has priority. Radio duration is curtailed to protect the battery reserve; a battery already below reserve must recover before a subsequent sample can transmit. Receiver/sleep consumption belongs in the user's base load. Once data is delivered, the radio draws no modeled transmission power.

Data delivered by the selected deadline is evaluated separately from data delivered later. Output radio rate and demand at sample endpoints represent the preceding calculation interval's average; azimuth/elevation represent the instant itself. At landing no interval has elapsed, so recorded transmission is zero.

The communication paper motivates low-elevation caution and a declared fade margin. Its Rician K=10 dB case, Doppler parameters, PLL, interleaving, BER and FER simulations are **not reproduced** or used as universal constants.

## 7. Passing checks and comparison

The energy check requires task energy reached by its deadline, no unserved electrical demand during the full selected interval, and battery reserve maintained throughout. The communication check requires the target data delivered by its deadline. “Meets selected checks” means these checks pass under these assumptions, not that landing or a complete flight mission has been certified.

Joint readiness is the first instant when the battery can hold the task energy above reserve and the requested data has already been delivered. The search evaluates the loaded sites at delays of 0, 7 and 14 days. Passing cases sort first, followed by earliest joint readiness; failed cases are retained for inspection. There is no hidden weighted cost and no global optimum claim.

## 8. Event times and visualization

Earth and link windows interpolate signed geometry-clearance crossings between samples. Sun-contact events use interpolated visibility samples and are estimates at the selected time resolution. Eclipse contacts, sub-grid ridges and short events can be missed. Transmitting intervals are recorded from actual model dispatch, rather than inferred from Earth-centre visibility.

An event absent from the selected interval is labeled “No rise/set in interval,” never “always.” The views and plots share one selected site and UTC cursor. Global globe lighting is an appearance/reference view, not a calculated global day/night product. Local relief shading is not a full terrain-shadow solver. Arrows describe calculated directions, not scaled body distances. The horizon plot remains the precise graphical reference for this sampled geometry.

## References and division of responsibility

- Pappa et al., **Solar Power for Lunar Pole Missions**, NASA, Space Power Workshop, 3 April 2019. Supplied presentation. Pages 6–11 motivate low solar angles, terrain sensitivity and array configurations; pages 17 and 31 identify engineering considerations. It is not a complete arbitrary-panel numerical model.
- Divsalar, Sanchez Net and Cheung, **Acquisition and tracking for communications between Lunar South Pole and Earth**, IEEE Aerospace Conference, 2019. Supplied paper. Its line-of-sight assumption and low-elevation fading study motivate geometric checks plus cautious radio assumptions; the receiver study is not reproduced here.
- NASA PGDA terrain: https://pgda.gsfc.nasa.gov/products/78 and https://pgda.gsfc.nasa.gov/products/90
- NASA CGI Moon Kit: https://svs.gsfc.nasa.gov/4720/
- NAIF DAF: https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/daf.html
- NAIF SPK: https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/spk.html
- NAIF PCK: https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/pck.html
- NAIF rotation conventions: https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/rotation.html
- JPL Horizons reference: https://ssd.jpl.nasa.gov/horizons/manual.html
- NASA PDS RISE station positions: https://pds-geosciences.wustl.edu/insight/urn-nasa-pds-insight_documents/document_rise/RISE_InSight_SIS_Raw.htm

Equations, dispatch logic, UI, definitions and tests are this application's implementation. The two uploaded papers are contextual scientific sources, not an endorsement or proof that the implementation is operationally validated.
