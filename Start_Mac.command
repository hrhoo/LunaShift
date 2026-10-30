#!/bin/bash
cd "$(dirname "$0")" || exit 1
PY=python3
if [ -x .venv/bin/python ]; then PY=.venv/bin/python; fi
"$PY" run.py
code=$?
if [ "$code" -ne 0 ]; then
 echo "Read the error above. Stop the older server with Control+C, or use another port."
 echo 'Terminal fallback: cd "$HOME/Downloads/LunaShift_v5"; python3 run.py'
 read -r -p "Press Enter to close. "
fi
exit "$code"
