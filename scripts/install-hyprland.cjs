const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const config = path.join(os.homedir(), '.config/hypr/hyprland.lua');
if (!fs.existsSync(config))
  throw new Error('Hyprland 0.55 or newer with Lua configuration is required.');
const source = path.resolve(__dirname, '../integrations/hyprland.lua');
const start = '-- Snapper overlay: begin',
  end = '-- Snapper overlay: end';
const old = fs.readFileSync(config, 'utf8');
if (!old.includes(start)) {
  fs.copyFileSync(config, config + `.snapper-backup-${Date.now()}`);
  fs.writeFileSync(config, old + `\n${start}\ndofile(${JSON.stringify(source)})\n${end}\n`);
  try {
    execFileSync('hyprctl', ['reload'], { stdio: 'pipe' });
    const errors = execFileSync('hyprctl', ['configerrors'], { encoding: 'utf8' }).trim();
    if (errors) throw new Error(errors);
  } catch (error) {
    fs.writeFileSync(config, old);
    execFileSync('hyprctl', ['reload']);
    throw error;
  }
}
console.log('Snapper rules installed; Hyprland configuration is valid.');
