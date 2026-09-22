// Exercise the shipped archive and installer without touching the user's profile.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function inside(image, root) {
  const archive = path.join(root, 'squashfs-root/resources/app.asar');
  const { locations, install, uninstall } = require(
    path.join(archive, 'src/services/linux-install.cjs'),
  );
  const paths = locations(path.join(root, 'isolated user'), {});
  await install({ appImage: image, paths, start: false });
  assert.equal((await fs.stat(paths.image)).size, (await fs.stat(image)).size);
  const configPath = path.join(paths.directory, 'launcher.json');
  const config = JSON.parse(await fs.readFile(configPath));
  assert.equal(config.command[0], paths.image);
  assert.ok((await fs.readFile(paths.launcher, 'utf8')).includes('--appimage-extract-and-run'));
  // A harmless command keeps this check safe even if the real game is open.
  await fs.writeFile(configPath, JSON.stringify({ ...config, command: ['/bin/true'] }));
  const watcher = path.join(paths.directory, 'watch-game.py');
  const child = spawn('python3', [watcher, paths.directory], { stdio: 'inherit' });
  const exit = new Promise((resolve) => child.once('exit', resolve));
  try {
    const lock = path.join(paths.cache, 'watcher.lock');
    let pid;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        pid = Number(await fs.readFile(lock, 'utf8'));
      } catch {}
      if (pid === child.pid) break;
      await wait(50);
    }
    assert.equal(pid, child.pid);
    await run('python3', [watcher, paths.directory], { timeout: 2000 });
    assert.equal(Number(await fs.readFile(lock, 'utf8')), child.pid);
    await uninstall({ paths });
    assert.equal(await exit, 0);
    await assert.rejects(fs.access(paths.autostart), { code: 'ENOENT' });
    console.log('AppImage install, independent launcher, singleton watcher and uninstall passed.');
  } finally {
    if (child.exitCode === null) child.kill();
  }
}
async function main() {
  if (process.argv[2] === '--inside') return inside(process.argv[3], process.argv[4]);
  const { version } = require('../package.json');
  const image = path.resolve(`dist/Snapper-${version}-linux-x86_64.AppImage`);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'snapper-appimage-'));
  try {
    await run(image, ['--appimage-extract'], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
    const result = await run(
      path.join(root, 'squashfs-root/snapper'),
      [__filename, '--inside', image, root],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 30000 },
    );
    process.stdout.write(result.stdout);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
