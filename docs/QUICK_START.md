# Working with the new Planner

## What is preserved

The Overview and Planner introduction remain as approved. Use the two navigation items to move between them. There is no additional main-page tab or blocking tutorial. The main technical controls are kept under the compact settings disclosure.

## 1. Define the mission

Choose the prepared site, UTC landing time and mission duration in the existing top bar. Click **Mission requirements & hardware** to reveal energy/data requirements, solar configuration, storage/demand, radio and advanced assumptions. Change only what is relevant; collapse the settings to recover space.

**Evaluate current plan** updates the original blue scenario. Editing an input marks previous results stale and clears the prior alternative. A stale result must not be interpreted as recalculated.

The energy requirement is usable stored energy above reserve. For a 5 kWh battery with a 20% reserve and 2 kWh task, the battery needs 3 kWh stored. Its initial charge counts toward that threshold. A scheduled extra payload consumes power; the task-readiness threshold itself does not execute a task.

## 2. Read the current result

Four checks are independent: task energy on time, battery reserve throughout, load supplied, and data delivered on time. All must pass for the selected model requirements to pass. They do not certify landing safety or flight operations.

The default Shoulder case reaches its early task-energy threshold and supplies the modeled load, but later violates reserve and does not deliver the data requirement.

## 3. Understand the scene

The 3D surface, map and local horizon refer to the same inspected scenario and elapsed time. Expand one pane using its corner control, then restore the linked layout. After finding B, the camera frames both landers. Blue remains A and gold remains B. The map reports the same great-circle separation as the result card.

Sun/Earth markers are enlarged and placed along calculated direction rays; they are not physical-distance objects on the terrain. Amber moving particles illustrate incident solar energy only when the collector sees sunlight. Moving binary symbols illustrate powered data transmission, not a live modem bit stream. Battery and power labels are available only during the computed mission.

The compact sentence below the scene connects Sun elevation, skyline clearance, visible solar fraction and modeled electrical power. The **Inspect geometry** action expands the analytical horizon. A finite portion of the Sun can remain visible even when its centre is slightly below the skyline.

The terrain image is a display mesh. Distant obstructions in the numerical skyline need not be present in the local display footprint. Panel strings, detailed temperature and mechanical deployment are not resolved.

## 4. Control time

Mission mode aligns A and B by elapsed time after their own landings. If B lands three days later, the same mission hour corresponds to different UTC dates. The clock displays the inspected scenario's actual UTC.

30-day sky is geometry exploration only. It does not extend mission battery or transmitted-data results. Now uses computer UTC within the included ephemeris range. It is not a live image feed.

One shared slider and plot cursor control the scene. Use **First shadow**, **Lowest battery**, **Data transmission**, or the existing Sun/Earth overlap shortcuts to reach useful events. Play at one simulated hour per second for a detailed explanation, or one day per second for a long sky cycle.

## 5. Search an alternative

Choose **Location**, **Date**, or **Both** and the allowed delay/spacing. Hardware, duration and mission requirements stay fixed. Choose the ranking priority and start the search. The recommendation is the preferred tested passing case, not a continuous/global optimization.

The gain panel compares solar generation (kWh), minimum battery (percentage points), longest no-sun period (hours), station access (hours), and data delivered by deadline (GB). It reports deterioration too. A manually selected failing case is explicitly described as still missing requirements.

Changing the priority clears the old preferred label; run the search again to establish a recommendation under the new preference.

## 6. Explore the site-by-date matrix

Each row is a loaded numerical location; each column is a tested landing date. The cells contain:

- Check mark: all four selected checks pass.
- E: at least one task-energy, battery-reserve or load-supply check fails.
- D: the data deadline fails.
- E+D: both groups fail.
- Dash: unsupported/unavailable case; not treated as feasible.

Blue outline marks the original; gold outline marks the inspected alternative. Hover or keyboard focus reveals exact numerical details. Click a valid case to calculate and inspect it as B. A is retained. No interpolation between tested cells is implied.

A run of passing sampled dates is useful evidence of schedule flexibility. It is not a guarantee that every moment between those dates passes; reduce the search step or evaluate specific dates for a finer test.

## 7. Is the improvement caused by location, date, or both?

The four comparison cards test the original, a location-only change, a date-only change, and the combined change. Each uses the same hardware and requirements. The cards use calculations from the actual search; when an isolated case was not tested, the interface does not manufacture a result.

For the included example:

| Case | Checks passing | Generated energy | Lowest battery | Data by deadline |
|---|---:|---:|---:|---:|
| Shoulder, 7 Nov 2026 | 2 / 4 | 55.1 kWh | 10.7% | 0.00 GB |
| Crest, 7 Nov 2026 | 3 / 4 | 70.8 kWh | 30.0% | 0.00 GB |
| Shoulder, 10 Nov 2026 | 1 / 4 | 24.7 kWh | 0.0% | 0.00 GB |
| Crest, 10 Nov 2026 | 4 / 4 | 70.8 kWh | 30.0% | 1.00 GB |

Here a location change improves energy continuity, but does not by itself restore the data requirement. The date change alone is insufficient too. The combined choice restores all four selected checks. This conclusion belongs to this mission and these tested cases, not all south-pole missions.

**Use this alternative** adopts B's site/date in the editable inputs. **Keep current plan** returns to A. Neither action destroys the displayed comparison.

## 8. Energy and link quality

The energy ledger balances generated electricity plus initial battery energy against supplied loads, final stored energy, storage losses and unused surplus. It prevents a high illumination percentage or generated kWh total from being mistaken for usable stored energy.

The two clocks are deliberately distinct:

- Gross harvest target: cumulative panel electricity reaches the requested energy amount.
- Task stored above reserve: the battery reaches task energy plus reserve after loads and losses; initial charge counts.

The link readout distinguishes three gates: local terrain clearance toward the station, station visibility above its own mask, and powered transmission. It displays C/N0, margin at the configured rate cap, model-rate ceiling and actual transmitted rate. A negative cap margin reduces the adaptive rate; it does not automatically mean zero radio access.

The source-based details contain an optional uncoded coherent-BPSK Rician BER reference with K=10 dB and perfect synchronization. The reference uses the paper's 60-degree residual-carrier example, leaving 75% of received power for data. It is conditional on a usable path and does not simulate the paper's PLL, tracking or LDPC code. It does not change delivered GB.

## 9. Offline, online and import

Offline calculation is fully packaged. The online Horizons cross-check requires the local Python launcher plus internet and compares the inspected scenario at the actual collector/antenna heights. A successful response is a geometry comparison, not a replacement for numerical terrain or a flight-quality certification. The data drawer remains readable and clickable above its backdrop.

A site import must supply numerical terrain or a numerical skyline plus compatible metadata. A photograph or free globe pin does not supply missing elevations. Export CSV includes generation, station clearance, C/N0 and cap margin as well as battery/data time histories.

## A concise presentation sequence

1. Explain that terrain determines what the collector and antenna can see.
2. Show the blue plan's failed battery/data checks.
3. Search Both, keeping hardware fixed.
4. Use the site/date grid to show that most tested options fail.
5. Explain the four controlled comparisons: site alone helps but is insufficient; both changes pass.
6. Show the measured changes in generated energy, reserve and contact time.
7. Inspect B's transmission event in the linked scene and horizon.
8. State the domain honestly: prepared points, declared engineering model, tested scenarios.

The defensible product claim is **explainable, coupled mission comparison**, not a new ephemeris, a global best landing site, or guaranteed mission success.
