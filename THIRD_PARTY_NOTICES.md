# Third-party notices

- `web/assets/vendor/three.module.js`, `three.core.js` and `OrbitControls.js`: Three.js, MIT license retained in `web/assets/vendor/THREE-LICENSE.txt`. The OrbitControls import specifier is changed from bare `three` to local `./three.module.js` for offline use; no library algorithms are changed.
- Moon appearance image: NASA Scientific Visualization Studio CGI Moon Kit, derived from LRO/LOLA/LROC data, NASA/GSFC/ASU. It is not a scientific terrain or operational illumination source.
- Prepared terrain: NASA LOLA/PGDA products 78 and 90, with the required Barker et al. references in `docs/DATA_SOURCES.md`.
- Ephemeris source: supplied JPL NAIF generic kernels; their original URLs and hashes are retained in `tools/kernel-manifest.json`. Kernel binaries and third-party paper PDFs are not redistributed in this app archive.

LunaShift is an independent application. Use of NASA data does not imply NASA approval, endorsement, certification, ground-station allocation or operational suitability. No third-party font files are included.


## Earth and Sun illustrations
Earth coastlines: Natural Earth 1:110m land polygons (public domain). https://www.naturalearthdata.com/about/terms-of-use/ . Continent colors, cloud texture, illumination and the Sun illustration were rendered for this application's explanatory display; they are not NASA photographs or time-specific observations.
