# Scientific sources and implementation boundaries

## Solar source supplied by the user

**Pappa, Rose, Paddock, Lepsch, McNatt and Fincannon. Solar Power for Lunar Pole Missions. Space Power Workshop, 3 April 2019. NASA NTRS 20200000285.**

Public record: https://ntrs.nasa.gov/citations/20200000285

- Page 6 explains low polar Sun paths, seasonal excursion and slow angular motion.
- Pages 7 and 9 explain rugged terrain and changing solar/Earth visibility.
- Pages 10, 24 and 25 give aggregate illumination examples at a stated 240 m grid spacing and different averaging periods.
- Page 11 distinguishes body-mounted, rotating rigid and lightweight deployable arrays.
- Pages 17 and 31 identify dust, thermal, shadowing and photovoltaic-environment challenges.

These are physical motivation and design context, not a complete numerical recipe for arbitrary terrain/panel/battery missions. The app's reference-point illumination, panel incidence, fixed loss/efficiency settings, battery balance and task-readiness criteria are explicit engineering models supplied by the application. No claim is made to reproduce the paper's quarter-year or annual map values with a seven-day local run.

The retained engine calculates finite-disc terrain visibility and a geometric eclipse mask, then electrical output from irradiance × panel area × efficiency × retained output × visible fraction × incidence. It integrates that output and accounts for base/payload/radio loads, storage losses, reserve and curtailment. Panel-string bypass behavior, cell-level shading, thermal dynamics, dust evolution, deployment structure and landing safety are not predicted.

## Communication source supplied by the user

**Dariush Divsalar, Marc Sanchez Net and Kar-Ming Cheung. Acquisition and tracking for communications between Lunar South Pole and Earth. 2019 IEEE Aerospace Conference.**

The supplied paper discusses low-elevation lunar-surface multipath (pp. 1–2), assumes line of sight before its Rician analysis (p. 2), and supplies normalized Rician amplitude statistics and ideal uncoded BPSK error expressions (p. 3, Eqs. 7, 9–11). It uses K=10 dB for its studied example, not a universally measured constant for every site. Pages 4–7 describe assumed Doppler spreading, PLL tracking, modulation and coding simulations.

The main app keeps the existing two-sided geometric station access and preliminary link budget with an explicitly selected fade margin. Geometry blockage is checked before a usable link is claimed. Actual radio operation is coupled to electrical supply, reserve, overhead and remaining data.

### New optional ideal reference

The optional diagnostic evaluates the paper's average uncoded coherent-BPSK error probability under normalized Rician fading and perfect synchronization. An equivalent Craig-integral/Laplace-transform quadrature is used:

BER = (1/pi) ∫[0,pi/2] q/(q+gamma) × exp[-K*gamma/(q+gamma)] dtheta,
where q=(1+K)*sin(theta)^2 and gamma is the mean data-bit Eb/N0.

The readout uses K=10 dB and the paper's beta=60-degree example (p. 7): 75% of received power is allocated to data. Thus at the configured rate cap,
Eb/N0[dB] = C/N0[dBHz] + 10 log10(0.75) - 10 log10(rate[bps]).

Numerical values were checked against independent SciPy quadrature and the Rayleigh limiting expression. The diagnostic is not the paper's carrier-acquisition, Doppler tracking, phase-error, interleaver or LDPC simulation. It is not an operational error-rate prediction and does not alter the delivered-data or adaptive-rate model.

## Existing data, not invented coverage

The prepared bundle retains the source elevations/rays and JPL DE421/MOON_ME geometry already supplied in the accepted build. Its three sample Connecting Ridge sites are descriptive study points, not NASA-approved landing coordinates. Terrain pixel spacing is not terrain certainty. The local display mesh is not identical to the larger numerical horizon footprint. See DATA_SOURCES.md for provenance and sampling.

The optional online API requests airless observer azimuth/elevation from JPL Horizons. This update adds the actual collector and antenna heights separately and compares the inspected A/B plan. It does not force Horizons and packaged DE421 to use identical solution/frame conventions. Discrepancies are exposed, with a UI warning above 0.1 degree, rather than silently reconciled. That threshold is a disclosure threshold, not a mission accuracy certification.

Official API documentation: https://ssd-api.jpl.nasa.gov/doc/horizons.html
NASA terrain product: https://pgda.gsfc.nasa.gov/products/78
NASA CGI Moon appearance assets: https://svs.gsfc.nasa.gov/4720/

## Defensible contribution

This implementation couples illumination, stored energy, powered data delivery and deadline checks in an interactive site-by-date decision matrix. Controlled site-only/date-only/combined comparisons make the improvement attributable to specific tested changes. Visible units, energy accounting, explicit failed checks and sampled-date scope prevent an unexplained score from being mistaken for evidence.

This is an implementation contribution and presentation proposition—not a claim that no previous lunar tool performs any related analysis. Existing lunar tools already offer terrain, 3D and lighting facilities. No competition award, global optimum or real mission success is guaranteed.
