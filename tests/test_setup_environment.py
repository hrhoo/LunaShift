"""Check first-run setup and retries without installing or downloading anything."""
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools.setup_environment import prepare


class SetupEnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        (self.root / '.venv').mkdir()
        for name in ('requirements-spice.txt', 'requirements-terrain.txt'):
            (self.root / name).write_text('example>=1\n')
        self.marker = self.root / '.venv' / '.lunashift-dependencies'

    @patch('tools.setup_environment.subprocess.run')
    def test_first_launch_installs_and_later_launch_skips(self, run):
        run.return_value = subprocess.CompletedProcess([], 0)
        prepare(self.root)
        install = run.call_args_list[1].args[0]
        self.assertEqual(install[1:4], ['-m', 'pip', 'install'])
        self.assertIn(str(self.root / 'requirements-spice.txt'), install)
        self.assertIn(str(self.root / 'requirements-terrain.txt'), install)
        self.assertTrue(self.marker.exists())
        run.reset_mock()
        prepare(self.root)
        self.assertEqual(run.call_count, 2)
        self.assertEqual(run.call_args_list[-1].args[0][-1], '--check')

    @patch('tools.setup_environment.subprocess.run')
    def test_changed_requirements_trigger_install(self, run):
        run.return_value = subprocess.CompletedProcess([], 0)
        prepare(self.root)
        original = self.marker.read_text()
        (self.root / 'requirements-terrain.txt').write_text('example>=2\n')
        run.reset_mock()
        prepare(self.root)
        self.assertEqual(run.call_count, 5)
        self.assertNotEqual(self.marker.read_text(), original)

    @patch('tools.setup_environment.subprocess.run')
    def test_failed_install_does_not_mark_setup_complete(self, run):
        run.side_effect = [subprocess.CompletedProcess([], 0), subprocess.CalledProcessError(1, 'pip')]
        with self.assertRaises(subprocess.CalledProcessError):
            prepare(self.root)
        self.assertFalse(self.marker.exists())

    @patch('tools.setup_environment.subprocess.run')
    def test_missing_package_reinstalls_and_failed_kernel_download_allows_launch(self, run):
        run.return_value = subprocess.CompletedProcess([], 0)
        prepare(self.root)
        run.reset_mock()
        run.side_effect = [subprocess.CompletedProcess([], code) for code in (1, 0, 0, 0, 1, 1)]
        self.assertEqual(prepare(self.root), 0)
        self.assertEqual(run.call_count, 6)
        self.assertTrue(run.call_args_list[-2].args[0][-1] == '--check')
        self.assertTrue(run.call_args_list[-1].args[0][-1].endswith('setup_spice.py'))


if __name__ == '__main__':
    unittest.main()
