#!/usr/bin/env python3
"""Download and verify the original LunaShift DE421 kernel set.

Uses only Python's standard library and normal verified HTTPS. The supplied
kernel-manifest.json is copied unchanged to the output directory after every
kernel passes its expected size and SHA-256 checks. No kernels are bundled.

Validate the manifest without network requests or file writes:
  python tools/download_kernels.py --check-manifest

Fetch the preparation inputs:
  python tools/download_kernels.py --output /path/to/lunashift-de421-me421-v1
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys
import tempfile
import urllib.parse
import urllib.request

MANIFEST_PATH = Path(__file__).resolve().with_name('kernel-manifest.json')
EXPECTED_FILES = {
    'naif0012.tls', 'pck00011.tpc', 'de421.bsp',
    'moon_pa_de421_1900-2050.bpc', 'moon_080317.tf',
}


def load_manifest(path: Path) -> tuple[dict, bytes]:
    """Validate names, source URLs, byte counts, and digests without fetching."""
    raw = path.read_bytes()
    manifest = json.loads(raw.decode('utf-8'))
    if manifest.get('set_id') != 'lunashift-de421-me421-v1':
        raise ValueError('Unexpected kernel set identifier.')
    if manifest.get('frame') != 'MOON_ME_DE421':
        raise ValueError('The kernel set must use the MOON_ME_DE421 frame.')
    entries = manifest.get('files')
    if not isinstance(entries, list) or len(entries) != len(EXPECTED_FILES):
        raise ValueError('The manifest must contain the five original kernels.')
    names = set()
    for entry in entries:
        name = entry.get('name')
        if name not in EXPECTED_FILES or name in names:
            raise ValueError(f'Unexpected or repeated kernel name: {name!r}')
        names.add(name)
        source = urllib.parse.urlsplit(entry.get('url', ''))
        if (source.scheme != 'https' or source.hostname != 'naif.jpl.nasa.gov'
                or source.username or source.password or source.port not in (None, 443)
                or source.query or source.fragment
                or not source.path.startswith('/pub/naif/generic_kernels/')
                or source.path.rsplit('/', 1)[-1] != name):
            raise ValueError(f'{name}: expected its official NAIF HTTPS URL.')
        if not isinstance(entry.get('bytes'), int) or entry['bytes'] <= 0:
            raise ValueError(f'{name}: expected a positive byte count.')
        if not re.fullmatch(r'[0-9a-f]{64}', entry.get('sha256', '')):
            raise ValueError(f'{name}: invalid SHA-256 digest.')
    return manifest, raw


def verified(path: Path, entry: dict) -> bool:
    if not path.is_file() or path.stat().st_size != entry['bytes']:
        return False
    checksum = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            checksum.update(block)
    return checksum.hexdigest() == entry['sha256']


def fetch_kernel(entry: dict, output: Path) -> None:
    destination = output / entry['name']
    if verified(destination, entry):
        print(f"Verified cached {entry['name']}")
        return
    print(f"Downloading {entry['name']} ({entry['bytes']:,} bytes)", flush=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=output, prefix=entry['name'] + '.',
                                         suffix='.part', delete=False) as target:
            temporary = Path(target.name)
            # No custom SSL context: urllib uses the normal certificate checks.
            with urllib.request.urlopen(entry['url'], timeout=90) as response:
                if urllib.parse.urlsplit(response.geturl()).scheme != 'https':
                    raise ValueError(f"{entry['name']}: source redirected away from HTTPS.")
                shutil.copyfileobj(response, target)
        if not verified(temporary, entry):
            raise ValueError(f"{entry['name']}: downloaded size or SHA-256 does not match the manifest.")
        temporary.replace(destination)
        print(f"Verified {entry['name']}")
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--output', type=Path, help='Directory for the verified kernels and manifest.json.')
    parser.add_argument('--check-manifest', action='store_true',
                        help='Check the five source URL/hash records; do not download or write anything.')
    args = parser.parse_args()
    manifest, manifest_bytes = load_manifest(MANIFEST_PATH)
    if args.check_manifest:
        print(f"Valid manifest: {manifest['set_id']} · {len(manifest['files'])} kernels")
        for entry in manifest['files']:
            print(f"{entry['name']}: {entry['url']}")
        return
    if args.output is None:
        parser.error('--output is required unless --check-manifest is used.')
    args.output.mkdir(parents=True, exist_ok=True)
    for entry in manifest['files']:
        fetch_kernel(entry, args.output)
    (args.output / 'manifest.json').write_bytes(manifest_bytes)
    print(f'All kernels verified. Manifest saved to {args.output / "manifest.json"}')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError) as error:
        sys.exit(f'Kernel preparation failed: {error}')
