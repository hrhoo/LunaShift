@echo off
setlocal
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" goto prepare
where py >nul 2>nul
if not errorlevel 1 (
  py -3 -m venv .venv
  goto check_environment
)
where python >nul 2>nul
if not errorlevel 1 (
  python -m venv .venv
  goto check_environment
)
echo Install Python 3.10 or newer from python.org, then run this file again.
pause
exit /b 1
:check_environment
if not exist ".venv\Scripts\python.exe" (
  echo Could not create .venv. Install Python 3.10 or newer and try again.
  pause
  exit /b 1
)
:prepare
".venv\Scripts\python.exe" tools\setup_environment.py
if errorlevel 1 (
  pause
  exit /b 1
)
".venv\Scripts\python.exe" run.py
set "lunashift_exit=%errorlevel%"
pause
exit /b %lunashift_exit%
