const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Offline UI fixtures use the project's own icon, never private game data or
// third-party card art. Cache file names still distinguish base and variant IDs.
// FixtureNoArt stands for a card Snap.fan has no art for yet: its tile must fall back to text.
function installUiFixtures(source = path.resolve(__dirname, '../../src')) {
  require(path.join(source, 'services/art.cjs')).CardArt.prototype.get = async function (
    id,
    variantId,
  ) {
    if ((variantId || id) === 'FixtureNoArt') return null;
    const file = path.join(this.directory, (variantId || id) + '.png');
    await fs.mkdir(this.directory, { recursive: true });
    await fs.copyFile(path.resolve(__dirname, '../../assets/icon.png'), file);
    return pathToFileURL(file).href;
  };
  // The card pool never contacts Snap.fan in UI checks: no startup update and a fixed summary.
  const { CardPool } = require(path.join(source, 'services/card-pool.cjs'));
  CardPool.prototype.isDue = async () => false;
  CardPool.prototype.update = async () => ({
    cards: [{ key: 'FixtureNoArt' }, { key: 'Venom' }],
    downloaded: 1,
    unchanged: 0,
    placeholders: ['FixtureNoArt'],
    failed: [],
    noImage: 0,
  });
  require(path.join(source, 'services/card-info.cjs')).CardInfo.prototype.get = async () => ({
    text: 'On Reveal: Fixture ability.\nOngoing: Fixture effect.',
    baseCost: 3,
    language: 'en',
  });
}
module.exports = { installUiFixtures };
