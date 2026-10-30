#!/usr/bin/env sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [ -x .venv/bin/python ]; then exec .venv/bin/python run.py "$@"; fi
exec python3 run.py "$@"
