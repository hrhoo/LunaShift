@echo off
setlocal
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" goto install
where py >nul 2>nul
if not errorlevel 1 (
  py -3 -m venv .venv
) else (
  python -m venv .venv
)
if not exist ".venv\Scripts\python.exe" (
  echo Could not create the Python environment. Install Python 3.10 or newer first.
  pause
  exit /b 1
)
:install
".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto failed
".venv\Scripts\python.exe" -m pip install --only-binary=:all: -r requirements-spice.txt
if errorlevel 1 goto failed
".venv\Scripts\python.exe" tools\setup_spice.py
if errorlevel 1 echo NASA files are not ready. In the app use Data and Sources, then Download NASA files to retry.
".venv\Scripts\python.exe" run.py
pause
exit /b
:failed
echo Python support could not be installed. Check your connection and the message above, then run this file again.
pause
exit /b 1
