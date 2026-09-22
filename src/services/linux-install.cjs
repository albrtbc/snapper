const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const desktopQuote = (value) =>
  '"' +
  value
    .replace(/[\\"`$]/g, '\\$&')
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '%%') +
  '"';

function locations(home = os.homedir(), env = process.env) {
  const xdg = (key, fallback) =>
    path.isAbsolute(env[key] || '') ? env[key] : path.join(home, fallback);
  const data = xdg('XDG_DATA_HOME', '.local/share');
  const directory = path.join(data, 'snapper');
  const paths = {
    directory,
    image: path.join(directory, 'Snapper.AppImage'),
    launcher: path.join(home, '.local/bin/snapper'),
    desktop: path.join(data, 'applications/snapper.desktop'),
    autostart: path.join(xdg('XDG_CONFIG_HOME', '.config'), 'autostart/snapper-watcher.desktop'),
    cache: path.join(xdg('XDG_CACHE_HOME', '.cache'), 'snapper'),
  };
  if (Object.values(paths).some((value) => /[\r\n\0]/.test(value)))
    throw Error('Unsupported installation path');
  return paths;
}
async function prerequisites() {
  try {
    const { stdout } = await run('python3', [
      '-c',
      'import sys, ctypes; ctypes.CDLL("libX11.so.6"); ctypes.CDLL("libXext.so.6"); print(sys.executable)',
    ]);
    return stdout.trim();
  } catch {
    throw Error(
      'Snapper needs Python 3, libX11 and libXext. Install these using your distribution package manager, then retry.',
    );
  }
}
async function stopWatcher(paths, python) {
  const watcher = path.join(paths.directory, 'watch-game.py');
  try {
    await fs.access(watcher);
  } catch {
    return;
  }
  await run(python, [watcher, paths.directory, '--stop'], { timeout: 8000 });
}
async function stopLegacyWatcher() {
  try {
    const pid = Number(
      await fs.readFile(path.join(os.homedir(), '.cache/snapper/watcher.pid'), 'utf8'),
    );
    if (!Number.isInteger(pid) || pid <= 1) return;
    const args = (await fs.readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0');
    const script = args[1];
    if (!script || path.basename(script) !== 'watch-game.cjs') return;
    const metadata = JSON.parse(
      await fs.readFile(path.join(path.dirname(script), '../package.json'), 'utf8'),
    );
    if (metadata.name === 'snapper') {
      process.kill(pid, 'SIGTERM');
      for (let attempt = 0; attempt < 40; attempt++) {
        const current = await fs.readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '');
        if (!current) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  } catch {}
}
async function install({ appImage, command, paths = locations(), start = true } = {}) {
  if (process.platform !== 'linux') throw Error('Automatic installation is available on Linux.');
  const python = await prerequisites();
  if (!appImage && (!Array.isArray(command) || !command.length))
    throw Error('No application to install');
  if (command?.some((value) => typeof value !== 'string' || /[\r\n\0]/.test(value)))
    throw Error('Invalid launcher command');
  await fs.mkdir(paths.directory, { recursive: true });
  if (appImage && path.resolve(appImage) !== paths.image) {
    const temporary = paths.image + `.tmp-${process.pid}`;
    try {
      await fs.copyFile(appImage, temporary);
      await fs.chmod(temporary, 0o755);
      await fs.rename(temporary, paths.image);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
  if (appImage) command = [paths.image, '--appimage-extract-and-run', '--ozone-platform=x11'];
  await stopWatcher(paths, python);
  if (start) await stopLegacyWatcher();
  const watcher = path.join(paths.directory, 'watch-game.py');
  await fs.copyFile(path.join(__dirname, 'watch-game.py'), watcher);
  await fs.copyFile(
    path.join(__dirname, '../../assets/icon.png'),
    path.join(paths.directory, 'icon.png'),
  );
  await fs.writeFile(
    path.join(paths.directory, 'launcher.json'),
    JSON.stringify({ command, cache: paths.cache }),
  );
  for (const file of [paths.launcher, paths.desktop, paths.autostart])
    await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    paths.launcher,
    '#!/bin/sh\nunset ELECTRON_RUN_AS_NODE\nexec ' + command.map(shellQuote).join(' ') + ' "$@"\n',
    { mode: 0o755 },
  );
  await fs.chmod(paths.launcher, 0o755);
  await fs.writeFile(
    paths.desktop,
    `[Desktop Entry]\nType=Application\nName=Snapper\nComment=Card overlay for Marvel Snap\nExec=${desktopQuote(paths.launcher)}\nIcon=${path.join(paths.directory, 'icon.png')}\nCategories=Game;\nTerminal=false\n`,
  );
  await fs.writeFile(
    paths.autostart,
    `[Desktop Entry]\nType=Application\nName=Snapper · detect Marvel Snap\nExec=${[python, watcher, paths.directory].map(desktopQuote).join(' ')}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`,
  );
  if (start) {
    await fs.mkdir(paths.cache, { recursive: true });
    const log = await fs.open(path.join(paths.cache, 'watcher.log'), 'a');
    try {
      const environment = { ...process.env };
      for (const key of [
        'APPIMAGE',
        'APPDIR',
        'ARGV0',
        'OWD',
        'LD_LIBRARY_PATH',
        'ELECTRON_RUN_AS_NODE',
      ])
        delete environment[key];
      const child = spawn(python, [watcher, paths.directory], {
        detached: true,
        stdio: ['ignore', log.fd, log.fd],
        env: environment,
      });
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      child.unref();
    } finally {
      await log.close();
    }
  }
  return paths;
}
async function uninstall({ paths = locations() } = {}) {
  await stopWatcher(paths, 'python3');
  for (const file of [
    paths.launcher,
    paths.desktop,
    paths.autostart,
    ...['Snapper.AppImage', 'watch-game.py', 'launcher.json', 'icon.png'].map((name) =>
      path.join(paths.directory, name),
    ),
  ])
    await fs.rm(file, { force: true });
  // Preserve unknown files, settings and caches.
  await fs.rmdir(paths.directory).catch((error) => {
    if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error;
  });
}
module.exports = { locations, install, uninstall, desktopQuote };
