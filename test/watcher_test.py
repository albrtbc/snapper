import importlib.util
from pathlib import Path
import signal
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('watcher', Path(__file__).parent.parent / 'src/services/watch-game.py')
watcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watcher)


class WatcherTest(unittest.TestCase):
    def test_once_per_game_and_respect_manual_quit(self):
        child = Mock(pid=123)
        child.poll.return_value = None
        launch = Mock(return_value=child)
        session = watcher.Session(launch)
        session.tick(False)
        launch.assert_not_called()
        session.tick(True)
        session.tick(True)
        launch.assert_called_once()
        child.poll.return_value = 0
        session.tick(True)
        launch.assert_called_once()
        session.tick(False)
        session.tick(True)
        self.assertEqual(launch.call_count, 2)

    def test_spawn_failure_can_retry(self):
        launch = Mock(side_effect=[OSError('missing'), Mock()])
        session = watcher.Session(launch)
        with self.assertRaises(OSError):
            session.tick(True)
        session.tick(True)
        self.assertEqual(launch.call_count, 2)

    @patch.object(watcher.os, 'killpg')
    def test_game_exit_stops_entire_appimage_process_group(self, killpg):
        child = Mock(pid=123)
        child.poll.return_value = None
        session = watcher.Session(lambda: child)
        session.tick(True)
        session.tick(False)
        killpg.assert_called_once_with(123, signal.SIGTERM)
        self.assertIsNone(session.child)

    def test_detects_only_snap_process_name(self):
        with tempfile.TemporaryDirectory() as directory:
            proc = Path(directory)
            (proc / '123').mkdir()
            comm = proc / '123/comm'
            comm.write_text('SNAP.exe helper\n')
            self.assertFalse(watcher.game_running(proc))
            comm.write_text('SNAP.exe\n')
            self.assertTrue(watcher.game_running(proc))


if __name__ == '__main__':
    unittest.main()
