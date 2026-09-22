"""Lightweight login watcher. Python is already required for X11 input regions."""
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time


def game_running(proc=Path('/proc')):
    for entry in proc.iterdir():
        if not entry.name.isdigit():
            continue
        try:
            if (entry / 'comm').read_text().strip().lower() == 'snap.exe':
                return True
        except (OSError, UnicodeError):
            pass
    return False


class Session:
    def __init__(self, launch):
        self.launch = launch
        self.child = None
        self.launched = False

    def tick(self, running):
        if self.child is not None and self.child.poll() is not None:
            self.child = None
        if not running:
            self.launched = False
            self.close()
        elif self.child is None and not self.launched:
            self.child = self.launch()
            self.launched = True

    def close(self):
        if self.child is not None:
            if self.child.poll() is None:
                try:
                    os.killpg(self.child.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    self.child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(self.child.pid, signal.SIGKILL)
                    self.child.wait()
            self.child = None


def stop(lock_path, directory):
    try:
        with lock_path.open('r+') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return
            except BlockingIOError:
                pass
            pid = int(lock.read())
            if pid <= 1:
                raise RuntimeError('Invalid watcher PID')
            args = Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0')
            if os.fsencode(directory / 'watch-game.py') not in args or os.fsencode(directory) not in args:
                raise RuntimeError('Watcher PID belongs to another process')
            os.kill(pid, signal.SIGTERM)
            deadline = time.monotonic() + 7
            while time.monotonic() < deadline:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    return
                except BlockingIOError:
                    time.sleep(0.05)
            raise RuntimeError('Watcher did not stop')
    except (FileNotFoundError, ProcessLookupError):
        pass


def main():
    directory = Path(sys.argv[1]).resolve()
    config = json.loads((directory / 'launcher.json').read_text())
    cache = Path(config['cache'])
    cache.mkdir(parents=True, exist_ok=True)
    lock_path = cache / 'watcher.lock'
    if '--stop' in sys.argv[2:]:
        stop(lock_path, directory)
        return
    with lock_path.open('a+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        lock.seek(0)
        lock.truncate()
        lock.write(str(os.getpid()))
        lock.flush()
        stopped = threading.Event()
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, lambda *_: stopped.set())

        def launch():
            environment = dict(os.environ)
            for key in ('ELECTRON_RUN_AS_NODE', 'APPIMAGE', 'APPDIR', 'ARGV0', 'OWD', 'LD_LIBRARY_PATH'):
                environment.pop(key, None)
            with (cache / 'launcher.log').open('w') as log:
                return subprocess.Popen(config['command'] + ['--with-game'], stdin=subprocess.DEVNULL, stdout=log, stderr=log, env=environment, start_new_session=True)

        session = Session(launch)
        try:
            while not stopped.is_set():
                try:
                    session.tick(game_running())
                except OSError as error:
                    print(f'Cannot start Snapper: {error}', file=sys.stderr, flush=True)
                stopped.wait(2)
        finally:
            session.close()


if __name__ == '__main__':
    main()
