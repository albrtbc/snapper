const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const APP_ID = '1997040';
function steamLibraries(home = os.homedir()) {
  const roots =
    process.platform === 'win32'
      ? [path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Steam')]
      : [
          path.join(home, '.local/share/Steam'),
          path.join(home, '.steam/steam'),
          path.join(home, '.var/app/com.valvesoftware.Steam/data/Steam'),
        ];
  const libraries = new Set(roots);
  for (const root of roots) {
    try {
      const vdf = fs.readFileSync(path.join(root, 'steamapps/libraryfolders.vdf'), 'utf8');
      for (const match of vdf.matchAll(/"path"\s+"((?:\\.|[^"\\])*)"/g))
        libraries.add(match[1].replace(/\\\\/g, '\\'));
    } catch {}
  }
  return [...libraries];
}
function discoverStates(override) {
  if (override) return path.resolve(override);
  const relative = 'AppData/LocalLow/Second Dinner/SNAP/Standalone/States/nvprod';
  const candidates = [path.join(os.homedir(), relative)];
  for (const library of steamLibraries()) {
    const users = path.join(library, `steamapps/compatdata/${APP_ID}/pfx/drive_c/users`);
    try {
      for (const user of fs.readdirSync(users)) candidates.push(path.join(users, user, relative));
    } catch {}
  }
  return (
    candidates
      .filter((p) => fs.existsSync(path.join(p, 'GameState.json')))
      .sort(
        (a, b) =>
          fs.statSync(path.join(b, 'GameState.json')).mtimeMs -
          fs.statSync(path.join(a, 'GameState.json')).mtimeMs,
      )[0] || null
  );
}
module.exports = { APP_ID, steamLibraries, discoverStates };
