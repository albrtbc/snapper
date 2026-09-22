const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

function classifyFocus(client, ownPid = process.pid) {
  if (!client || typeof client !== 'object' || Array.isArray(client)) return 'unknown';
  // Permit our own windows so clicking or dragging an overlay does not hide it.
  if (client.pid === ownPid) return 'snapper';
  const classes = Array.isArray(client.classes) ? client.classes : [client.class];
  if (
    classes.some(
      (name) => typeof name === 'string' && /^(steam_app_1997040|snap\.exe)$/i.test(name),
    )
  )
    return 'game';
  return 'other';
}

async function activeFocus(nativeFocus, env = process.env) {
  try {
    if (env.HYPRLAND_INSTANCE_SIGNATURE) {
      const { stdout } = await run('hyprctl', ['activewindow', '-j'], { timeout: 800 });
      return classifyFocus(JSON.parse(stdout));
    }
    // XWayland can retain a stale X11 active window when a native Wayland app
    // has focus. Do not interpret that as the game being active.
    if (env.WAYLAND_DISPLAY || process.platform !== 'linux') return 'unknown';
    return classifyFocus(await nativeFocus?.());
  } catch {
    return 'unknown';
  }
}
module.exports = { activeFocus, classifyFocus };
