const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const {
  install,
  uninstall,
  locations,
  desktopQuote,
} = require('../src/services/linux-install.cjs');
const run = promisify(execFile);

test('installation copies AppImage, quotes launcher arguments, upgrades and preserves user files', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'snapper-install-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const home = path.join(root, "a user's % home");
  const paths = locations(home, {});
  const image = path.join(root, 'download.AppImage');
  await fs.writeFile(image, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
  await install({ appImage: image, paths, start: false });
  assert.equal(await fs.readFile(paths.image, 'utf8'), await fs.readFile(image, 'utf8'));
  const arg = 'literal $(false); space';
  const { stdout } = await run(paths.launcher, [arg]);
  assert.deepEqual(stdout.trim().split('\n'), [
    '--appimage-extract-and-run',
    '--ozone-platform=x11',
    arg,
  ]);
  const desktop = await fs.readFile(paths.desktop, 'utf8');
  assert.ok(desktop.includes('Exec=' + desktopQuote(paths.launcher)));
  assert.ok(desktop.includes('%%'));
  const config = JSON.parse(await fs.readFile(path.join(paths.directory, 'launcher.json')));
  assert.equal(config.command[0], paths.image);
  assert.ok(!(await fs.readFile(paths.autostart, 'utf8')).includes('node'));
  await fs.writeFile(image, '#!/bin/sh\nexit 0\n');
  await install({ appImage: image, paths, start: false });
  assert.equal(await fs.readFile(paths.image, 'utf8'), '#!/bin/sh\nexit 0\n');
  const sentinel = path.join(paths.directory, 'my-notes.txt');
  await fs.writeFile(sentinel, 'keep');
  await uninstall({ paths });
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'keep');
  for (const file of [paths.image, paths.launcher, paths.desktop, paths.autostart])
    await assert.rejects(fs.access(file), { code: 'ENOENT' });
  await uninstall({ paths });
});

test('installation respects absolute XDG directories and rejects newline paths', () => {
  const paths = locations('/tmp/home', { XDG_DATA_HOME: '/tmp/data', XDG_CONFIG_HOME: 'relative' });
  assert.equal(paths.image, '/tmp/data/snapper/Snapper.AppImage');
  assert.equal(paths.autostart, '/tmp/home/.config/autostart/snapper-watcher.desktop');
  assert.throws(() => locations('/tmp/bad\npath', {}), /Unsupported/);
});
