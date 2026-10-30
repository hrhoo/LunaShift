# LunaShift Mission Planner v0.5.0

Explore a site. Test a mission. Find a better plan.

## Start here
Open **LunaShift_v5_Simple_Guide.pdf** for screenshots and short instructions.
Python 3.10 or newer is required for local use. Download Python from https://www.python.org/downloads/ when needed.
Export your old workspace, stop the previous server, and extract this version into a **new folder**. Open saved JSON from **Data & Sources**. Do not copy a `.venv` between computers.

## Mac: first-time SPICE setup
Extract `LunaShift_v5.zip` into Downloads, open Terminal, and run:

```bash
cd "$HOME/Downloads/LunaShift_v5"
bash Enable_SPICE_Mac.sh
```

The script creates a private `.venv`, installs SpiceyPy and downloads a compatible NASA kernel set (about 19 MB). First setup needs internet. If the files fail to download, the app still opens and tells you how to retry.

Later, start with:

```bash
cd "$HOME/Downloads/LunaShift_v5"
.venv/bin/python run.py
```

Open `http://127.0.0.1:8765`. Keep Terminal open; Control+C stops the server.
To install optional terrain reading as well, run `bash Enable_Real_Data_Mac.sh` from the same folder. It uses the same `.venv`.

## Windows: first-time SPICE setup
After cloning the repository or extracting the ZIP completely, double-click **Start_Windows.bat**. Install Python 3.10 or newer first. The launcher automatically creates a private `.venv`, installs the SPICE and terrain packages, and downloads NASA kernels when needed. First setup requires internet access. Keep its command window open.

Later launches reuse the installed environment. Dependency installation runs again when a requirements file or Python version changes, or a required package cannot be imported. Failed package setup stops the launch with a retry message. Failed NASA downloads allow the app to open; use **Download NASA files** in the app to retry.

Commit the launcher, `tools/setup_environment.py`, and both `requirements-*.txt` files with the application. `.venv`, downloaded kernels, caches, and local workspace state remain excluded by `.gitignore`; each clone recreates its own copies. Cloning alone does not run setup: start the launcher on each computer.

## Google Colab
Upload `LunaShift_v5_Colab.ipynb` into Colab. Run **Upload and launch**, then upload **LunaShift_v5.zip**. Leave the three setup flags True. Use a CPU runtime. SPICE is installed in the temporary Google runtime, not on your laptop. Download your workspace before disconnecting.

## Try the teaching example without installing packages
From the extracted folder run `python3 run.py` on Mac/Linux, or `py -3 run.py` on Windows. This runs the standard-library application. It does not enable SPICE by itself.

## Choose your geometry source
In **Mission Setup**:
- **Automatic — recommended:** uses ready SPICE for covered dates, otherwise Horizons. It records the reason.
- **JPL Horizons — online:** uses Horizons only. Network failures are shown, not silently changed to SPICE.
- **NASA SPICE — local/offline:** uses local SPICE only. Missing files or unsupported dates produce a setup message, not another source.

Choose a site and date, then press **Prepare Sun & Earth data**. Real NASA sky data do not magically change synthetic terrain. Attach real terrain separately. The teaching workspace is never overwritten merely by selecting a radio option.

The **actual attached source** appears separately from your selected preference. Existing imported CSV can remain in use under Automatic; explicitly prepare to replace it. Real-data calculations refresh missing dates or changed explicit sources when required.

## First exercise
Keep the supplied teaching date and Site A. Check the plan. Play the Sunlight & Earth timeline. Change panel area under Power & Communications. Compare options, then try Optimize Mission. The example numbers are invented for learning, not a real landing recommendation.

## SPICE detail and verification
Read `docs/SPICE.md`. Managed files use DE421 and MOON_ME_DE421, with CN+S reception geometry. This is a deliberate compatible set, not a latest-ephemeris claim. SPICE does not supply terrain or map imagery.
Run `tools/verify_spice.py` with your SPICE-enabled Python for an actual-kernel check. Add `--online` for short Horizons comparisons. The UI also includes **Compare SPICE with Horizons**. Differences are reported, not labelled certified or perfect.

## What was and was not tested
See `docs/TEST_REPORT.md`. Logic and interface tests include simulated provider responses. Actual CSPICE kernels, native Mac/Windows launch, live NASA services, and a signed-in Colab runtime could not be exercised in the build environment. Do not treat the number of tests as an astronomical accuracy certificate.

## Save and share
Export your JSON workspace. It includes calculated tracks, sampled terrain and settings, not the original huge raster files, installed packages or kernel binaries. Your teammates use their own app copy and import the JSON. The localhost address is not a public website.
