const os = require('node:os');
const path = require('node:path');
const { CardArt } = require('../src/services/art.cjs');
const { CardPool } = require('../src/services/card-pool.cjs');
// Same folder as Electron's userData for Snapper.
function defaultDirectory() {
  if (process.platform === 'win32')
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData/Roaming'), 'Snapper');
  if (process.platform === 'darwin')
    return path.join(os.homedir(), 'Library/Application Support/Snapper');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Snapper');
}
function directoryFromArguments(args) {
  if (!args.length) return defaultDirectory();
  if (args[0] === '--dir' && args.length === 2 && args[1]) return path.resolve(args[1]);
  if (args.length === 1 && args[0].startsWith('--dir=') && args[0].length > 6)
    return path.resolve(args[0].slice(6));
  return null;
}
(async () => {
  const directory = directoryFromArguments(process.argv.slice(2));
  if (!directory) {
    console.error('Usage: update-cards.cjs [--dir <userData>]');
    process.exitCode = 1;
    return;
  }
  console.log('Folder:', directory);
  const pool = new CardPool(
    path.join(directory, 'card-pool.json'),
    new CardArt(path.join(directory, 'card-art')),
  );
  const summary = await pool.update({
    onProgress: ({ done, total }) => console.log(`Images ${done}/${total}`),
  });
  const { cards, downloaded, unchanged, placeholders, failed, noImage } = summary;
  console.log(`Cards: ${cards.length}`);
  console.log(`Images downloaded: ${downloaded}`);
  console.log(`Images unchanged: ${unchanged}`);
  console.log(`Placeholders: ${placeholders.length}`);
  console.log(`Failed: ${failed.length}`);
  console.log(`Without image on Snap.fan: ${noImage}`);
  const missing = [
    ...placeholders.map((key) => [key, 'placeholder']),
    ...failed.map((key) => [key, 'failed']),
    ...cards.filter((card) => !card.image).map((card) => [card.key, 'no image']),
  ].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  console.log(`Still without real art: ${missing.length}`);
  for (const [key, reason] of missing) console.log(`  ${key} (${reason})`);
})().catch((e) => {
  console.error('Card update failed:', e.message);
  process.exitCode = 1;
});
