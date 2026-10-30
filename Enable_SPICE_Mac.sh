#!/bin/bash
# Run from Terminal: bash Enable_SPICE_Mac.sh
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Install Python 3.10 or newer from https://www.python.org/downloads/ first."; exit 1
fi
python3 -c 'import sys; assert sys.version_info >= (3,10), "Python 3.10 or newer is required"'
if [ ! -x .venv/bin/python ]; then python3 -m venv .venv; fi
PY=.venv/bin/python
"$PY" -m pip install --upgrade pip
"$PY" -m pip install --only-binary=:all: -r requirements-spice.txt
echo "Python SPICE support is installed. Downloading the compatible NASA files..."
if ! "$PY" tools/setup_spice.py; then
  echo "The files are not ready. The app will still open. Read Data & Sources > SPICE made simple, then retry Download NASA files."
fi
echo "Starting LunaShift Mission Planner 0.5.0. Keep this Terminal open."
exec "$PY" run.py "$@"
