const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const home = os.homedir();
const { uninstall } = require('../src/services/linux-install.cjs');
(async () => {
  await uninstall();
  const config = path.join(home, '.config/hypr/hyprland.lua');
  if (fs.existsSync(config)) {
    const old = fs.readFileSync(config, 'utf8');
    const next = old.replace(
      /\n-- Snapper overlay: begin\n[\s\S]*?-- Snapper overlay: end\n/,
      '\n',
    );
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
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
