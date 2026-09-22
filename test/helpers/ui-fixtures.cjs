const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Offline UI fixtures use the project's own icon, never private game data or
// third-party card art. Cache file names still distinguish base and variant IDs.
function installUiFixtures(source = path.resolve(__dirname, '../../src')) {
  require(path.join(source, 'services/art.cjs')).CardArt.prototype.get = async function (
    id,
    variantId,
  ) {
    const file = path.join(this.directory, (variantId || id) + '.png');
    await fs.mkdir(this.directory, { recursive: true });
    await fs.copyFile(path.resolve(__dirname, '../../assets/icon.png'), file);
    return pathToFileURL(file).href;
  };
  require(path.join(source, 'services/card-info.cjs')).CardInfo.prototype.get = async () => ({
    text: 'On Reveal: Fixture ability.\nOngoing: Fixture effect.',
    baseCost: 3,
    language: 'en',
  });
}
module.exports = { installUiFixtures };
