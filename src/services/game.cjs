const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
async function gameRunning() {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await run(
        'tasklist',
        ['/FI', 'IMAGENAME eq SNAP.exe', '/FO', 'CSV', '/NH'],
        { timeout: 2000 },
      );
      return /^"SNAP\.exe"/im.test(stdout);
    } catch {
      return false;
    }
  }
  try {
    const pids = (await fs.readdir('/proc')).filter((p) => /^\d+$/.test(p));
    const checks = await Promise.all(
      pids.map(async (pid) => {
        try {
          const name = (await fs.readFile(`/proc/${pid}/comm`, 'utf8')).trim();
          return name.toLowerCase() === 'snap.exe';
        } catch {
          return false;
        }
      }),
    );
    return checks.some(Boolean);
  } catch {
    return false;
  }
}
async function gameBounds() {
  if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) return null;
  try {
    const { stdout } = await run('hyprctl', ['clients', '-j'], { timeout: 1500 });
    const client = JSON.parse(stdout).find(
      (w) => w.mapped && (w.class === 'steam_app_1997040' || /^marvel snap$/i.test(w.title)),
    );
    if (!client) return null;
    return {
      x: client.at[0],
      y: client.at[1],
      width: client.size[0],
      height: client.size[1],
      workspace: client.workspace.id,
    };
  } catch {
    return null;
  }
}
module.exports = { gameRunning, gameBounds };
