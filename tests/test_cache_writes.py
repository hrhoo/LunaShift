"""Check Windows file-lock retries and failure cleanup on any platform."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from lunashift.remote import atomic_write, _REPLACE_DELAYS


def windows_error(code):
    error = PermissionError('Windows file lock')
    error.winerror = code
    return error


class CacheWriteTests(unittest.TestCase):
    def test_transient_windows_lock_retries_and_writes_complete_data(self):
        from os import replace
        for code in (5, 32, 33):
            with self.subTest(code=code), tempfile.TemporaryDirectory() as folder:
                path = Path(folder) / 'cache.bin'
                path.write_bytes(b'original')
                attempts = []

                def replace_after_lock(source, destination):
                    attempts.append(1)
                    if len(attempts) == 1:
                        raise windows_error(code)
                    replace(source, destination)

                with patch('lunashift.remote.os.replace', side_effect=replace_after_lock), patch('lunashift.remote.time.sleep') as sleep:
                    atomic_write(path, b'complete replacement')
                self.assertEqual(path.read_bytes(), b'complete replacement')
                self.assertEqual(len(attempts), 2)
                sleep.assert_called_once_with(_REPLACE_DELAYS[0])
                self.assertEqual(list(Path(folder).glob('*.tmp')), [])

    def test_persistent_lock_preserves_original_and_cleans_temporary_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'cache.bin'
            path.write_bytes(b'original')
            with patch('lunashift.remote.os.replace', side_effect=windows_error(5)) as replace, patch('lunashift.remote.time.sleep') as sleep:
                with self.assertRaises(PermissionError):
                    atomic_write(path, b'replacement')
            self.assertEqual(replace.call_count, len(_REPLACE_DELAYS) + 1)
            self.assertEqual(sleep.call_count, len(_REPLACE_DELAYS))
            self.assertEqual(path.read_bytes(), b'original')
            self.assertEqual(list(Path(folder).glob('*.tmp')), [])

    def test_failed_replace_preserves_original_and_releases_lock(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'cache.bin'
            path.write_bytes(b'original')
            with patch('lunashift.remote.os.replace', side_effect=PermissionError('access denied')) as replace:
                with self.assertRaises(PermissionError):
                    atomic_write(path, b'replacement')
            replace.assert_called_once()
            self.assertEqual(path.read_bytes(), b'original')
            self.assertEqual(list(Path(folder).glob('*.tmp')), [])

            atomic_write(path, b'next write')
            self.assertEqual(path.read_bytes(), b'next write')


if __name__ == '__main__':
    unittest.main()
