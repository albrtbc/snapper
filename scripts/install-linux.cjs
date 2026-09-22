const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..'),
  home = os.homedir();
const bin = path.join(home, '.local/bin');
const applications = path.join(home, '.local/share/applications');
const autostart = path.join(home, '.config/autostart');
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
for (const dir of [bin, applications, autostart]) fs.mkdirSync(dir, { recursive: true });
const launcher = path.join(bin, 'snapper');
const packaged = path.join(root, 'dist/linux-unpacked/snapper');
const command = fs.existsSync(packaged)
  ? quote(packaged)
  : `${quote(path.join(root, 'node_modules/electron/dist/electron'))} ${quote(root)}`;
fs.writeFileSync(launcher, `#!/bin/sh\nexec ${command} --ozone-platform=x11 "$@"\n`, {
  mode: 0o755,
});
const desktopQuote = (s) => '"' + s.replace(/["\\`$]/g, '\\$&') + '"';
fs.writeFileSync(
  path.join(applications, 'snapper.desktop'),
  `[Desktop Entry]\nType=Application\nName=Snapper\nComment=Card overlay for Marvel Snap\nExec=${desktopQuote(launcher)}\nIcon=${root}/assets/icon.svg\nCategories=Game;\nTerminal=false\n`,
);
fs.writeFileSync(
  path.join(autostart, 'snapper-watcher.desktop'),
  `[Desktop Entry]\nType=Application\nName=Snapper · detect Marvel Snap\nExec=${desktopQuote(process.execPath)} ${desktopQuote(path.join(root, 'scripts/watch-game.cjs'))}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`,
);
const child = spawn(process.execPath, [path.join(root, 'scripts/watch-game.cjs')], {
  detached: true,
  stdio: 'ignore',
});
child.unref();
console.log('Installed:', launcher);
console.log('Autostart:', path.join(autostart, 'snapper-watcher.desktop'));
console.log('Keep this project at its current path.');
