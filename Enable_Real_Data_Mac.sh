#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Install Python 3.10+ from python.org first."; exit 1
fi
python3 -c 'import sys; assert sys.version_info >= (3,10), "Python 3.10 or newer is required"'
echo "Creating a private Python environment in this folder…"
if [ ! -x .venv/bin/python ]; then python3 -m venv .venv; fi
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install --only-binary=:all: -r requirements-terrain.txt
echo "Real-raster tools ready. Starting LunaShift v0.5.0."
exec .venv/bin/python run.py "$@"
