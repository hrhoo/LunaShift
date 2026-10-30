# Source links and roles

These are clickable references, not a claim that every resource has been downloaded into the workspace.

| Resource | Use in this release |
|---|---|
| [NASA NAIF generic kernels](https://naif.jpl.nasa.gov/naif/data_generic.html) | Managed compatible kernel downloads, on explicit setup |
| [Matching lunar frame file](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/satellites/moon_080317.tf) | Documents DE421/MOON_ME_DE421 pairing |
| [CSPICE constant-observer geometry](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/spkcpo_c.html) | Official routine used by the local engine |
| [SpiceyPy installation](https://spiceypy.readthedocs.io/en/stable/installation.html) | Python wrapper used for local calculations |
| [JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html) | Online geometry adapter and comparison |
| [JPL Horizons manual](https://ssd.jpl.nasa.gov/horizons/manual.html) | Coordinate and observation conventions |
| [PGDA high-resolution terrain](https://pgda.gsfc.nasa.gov/products/78) | Compatible elevation-grid preparation |
| [PGDA polar illumination](https://pgda.gsfc.nasa.gov/products/69) | Context/mean-availability layers, not date-specific power |
| [NASA Moon Trek](https://trek.nasa.gov/moon/) | Imagery/map context |
| [LROC QuickMap](https://quickmap.lroc.asu.edu/) | External inspection reference |
| [NASA south-pole animation](https://svs.gsfc.nasa.gov/5228/) | Reference animation, not the current site/time |
| [Python download](https://www.python.org/downloads/) | Local prerequisite |
| [Google Colab](https://colab.research.google.com/) | Optional temporary runtime |

The original project guide separates sky positions, terrain and the visible timeline. This release preserves that distinction. Map imagery is not elevation data. SPICE and Horizons do not supply actual spacecraft hardware or station schedules.
