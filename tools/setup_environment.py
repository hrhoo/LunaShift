#!/usr/bin/env python3
"""Prepare dependencies in the private environment before launching LunaShift."""
import hashlib
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REQUIREMENTS = ('requirements-spice.txt', 'requirements-terrain.txt')
IMPORT_CHECK = 'import spiceypy, certifi, numpy, rasterio, pyproj, PIL'


def prepare(root=ROOT):
    fingerprint = hashlib.sha256()
    fingerprint.update(sys.version.encode())
    for name in REQUIREMENTS:
        fingerprint.update(name.encode())
        fingerprint.update((root / name).read_bytes())
    expected = fingerprint.hexdigest()
    marker = root / '.venv' / '.lunashift-dependencies'
    saved = marker.read_text().strip() if marker.exists() else ''
    imports_ready = subprocess.run(
        [sys.executable, '-c', IMPORT_CHECK],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    ).returncode == 0
    if saved != expected or not imports_ready:
        print('Installing LunaShift dependencies. First setup needs internet.', flush=True)
        command = [sys.executable, '-m', 'pip', 'install']
        for name in REQUIREMENTS:
            command.extend(['-r', str(root / name)])
        subprocess.run(command, check=True)
        subprocess.run([sys.executable, '-m', 'pip', 'check'], check=True)
        subprocess.run([sys.executable, '-c', IMPORT_CHECK], check=True)
        marker.write_text(expected + '\n')

    kernel_command = [sys.executable, str(root / 'tools' / 'setup_spice.py')]
    ready = subprocess.run(
        kernel_command + ['--check'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    ).returncode == 0
    if not ready:
        print('Preparing NASA kernels. First setup needs internet.', flush=True)
        if subprocess.run(kernel_command).returncode:
            print('NASA kernels are not ready. You can retry using Download NASA files in the app.', flush=True)
    return 0


if __name__ == '__main__':
    if Path(sys.prefix).resolve() != (ROOT / '.venv').resolve():
        print('Run Start_Windows.bat to prepare the private .venv environment.', file=sys.stderr)
        sys.exit(1)
    try:
        sys.exit(prepare())
    except (OSError, subprocess.CalledProcessError) as exc:
        print('Setup failed. Check your internet connection and rerun Start_Windows.bat.\n' + str(exc), file=sys.stderr)
        sys.exit(1)
