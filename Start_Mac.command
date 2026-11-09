#!/bin/bash
cd "$(dirname "$0")"
if command -v python3 >/dev/null 2>&1; then
 python3 run.py
else
 echo "Python 3 is required. Install Python 3 from python.org, then reopen this launcher."
 read -r -p "Press Enter to close."
fi
