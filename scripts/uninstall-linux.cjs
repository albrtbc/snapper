const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const home = os.homedir();
for (const file of [
  '.local/bin/snapper',
  '.local/share/applications/snapper.desktop',
  '.config/autostart/snapper-watcher.desktop',
]) {
  fs.rmSync(path.join(home, file), { force: true });
}
const pidfile = path.join(home, '.cache/snapper/watcher.pid');
try {
  const pid = Number(fs.readFileSync(pidfile, 'utf8'));
  const command = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
  if (command.includes(path.resolve(__dirname, 'watch-game.cjs'))) process.kill(pid, 'SIGTERM');
} catch {}
const config = path.join(home, '.config/hypr/hyprland.lua');
if (fs.existsSync(config)) {
  const old = fs.readFileSync(config, 'utf8');
  const next = old.replace(/\n-- Snapper overlay: begin\n[\s\S]*?-- Snapper overlay: end\n/, '\n');
  if (next !== old) {
    fs.copyFileSync(config, config + `.snapper-uninstall-${Date.now()}`);
    fs.writeFileSync(config, next);
    try {
      execFileSync('hyprctl', ['reload']);
      const errors = execFileSync('hyprctl', ['configerrors'], { encoding: 'utf8' }).trim();
      if (errors) throw new Error(errors);
    } catch (error) {
      fs.writeFileSync(config, old);
      execFileSync('hyprctl', ['reload']);
      throw error;
    }
  }
}
console.log('Autostart and launcher removed. Settings and images were preserved.');
