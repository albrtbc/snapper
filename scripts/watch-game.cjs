// A small Node process remains idle; Chromium only starts while SNAP is running.
const { gameRunning } = require('../src/services/game.cjs');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
let child = null,
  stopped = false,
  failures = 0,
  launchedThisSession = false;
const dir = path.join(os.homedir(), '.cache/snapper');
fs.mkdirSync(dir, { recursive: true });
const pidfile = path.join(dir, 'watcher.pid');
try {
  const pid = Number(fs.readFileSync(pidfile, 'utf8'));
  const command = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
  if (command.includes(__filename)) process.exit(0);
} catch {}
fs.writeFileSync(pidfile, String(process.pid));
function cleanup() {
  stopped = true;
  try {
    fs.unlinkSync(pidfile);
  } catch {}
  child?.kill();
}
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});
process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});
async function tick() {
  try {
    const running = await gameRunning();
    if (running && !child && !launchedThisSession) {
      const executable = fs.existsSync(path.join(root, 'dist/linux-unpacked/snapper'))
        ? path.join(root, 'dist/linux-unpacked/snapper')
        : require('electron');
      const args = executable.includes('linux-unpacked')
        ? ['--ozone-platform=x11', '--with-game']
        : [root, '--ozone-platform=x11', '--with-game'];
      const environment = { ...process.env };
      delete environment.ELECTRON_RUN_AS_NODE;
      const logfile = fs.openSync(path.join(dir, 'launcher.log'), 'w');
      try {
        child = spawn(executable, args, {
          cwd: root,
          stdio: ['ignore', logfile, logfile],
          env: environment,
        });
      } finally {
        fs.closeSync(logfile);
      }
      launchedThisSession = true;
      child.once('error', () => {
        child = null;
        failures++;
      });
      child.once('exit', () => {
        child = null;
        failures++;
      });
    }
    if (!running) {
      failures = 0;
      launchedThisSession = false;
      if (child) child.kill();
    }
  } catch {
    failures++;
  }
  if (!stopped) setTimeout(tick, Math.min(30000, 2000 + failures * 2000));
}
tick();
