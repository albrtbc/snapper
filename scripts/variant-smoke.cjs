const { app, BrowserWindow } = require('electron'),
  fs = require('node:fs'),
  path = require('node:path');
const profile = path.resolve('.cache/variant-smoke'),
  restore = process.argv.includes('--restore-variants');
fs.mkdirSync(profile, { recursive: true });
if (!restore)
  fs.writeFileSync(
    path.join(profile, 'settings.json'),
    JSON.stringify({ layoutVersion: 2, scale: 1, positions: {} }),
  );
app.setPath('userData', profile);
process.argv.push('--demo');
const source = process.argv.includes('--packaged-variants')
  ? '../dist/linux-unpacked/resources/app.asar/src'
  : '../src';
require('../test/helpers/ui-fixtures.cjs').installUiFixtures(path.resolve(__dirname, source));
const demo = require(source + '/demo.cjs'),
  original = demo.demoState;
demo.demoState = () => {
  const state = original();
  state.match.deckRows[0].variantId = 'Deadpool_03';
  state.match.opponent[0].variantId = 'Blade_02';
  return state;
};
require(source + '/main.cjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function imageIs(win, filename) {
  for (let n = 0; n < 60; n++) {
    const src = await win.webContents.executeJavaScript(
      'document.querySelector("#cards .portrait img")?.getAttribute("src")',
    );
    if (src?.endsWith('/' + filename + '.png')) return;
    await wait(250);
  }
  throw Error('Expected image ' + filename);
}
(async () => {
  await app.whenReady();
  await wait(1800);
  const panels = BrowserWindow.getAllWindows(),
    own = panels.find((w) => w.webContents.getURL().includes('side=own')),
    rival = panels.find((w) => w !== own);
  if (restore) {
    if (!(await own.webContents.executeJavaScript('window.snapper.getState()')).settings.gameArt)
      throw Error('Variant option not restored');
    await imageIs(own, 'Deadpool_03');
    await imageIs(rival, 'Blade_02');
    console.log({ variantPreferenceRestored: true });
    app.quit();
    return;
  }
  if (
    (await own.webContents.executeJavaScript('window.snapper.getState()')).settings.gameArt !==
    false
  )
    throw Error('Must default to base art');
  await imageIs(own, 'Deadpool');
  await imageIs(rival, 'Blade');
  await own.webContents.executeJavaScript('window.snapper.openSettings()');
  await wait(350);
  const settings = BrowserWindow.getAllWindows().find((w) =>
    w.webContents.getURL().includes('settings.html'),
  );
  if (await settings.webContents.executeJavaScript('document.querySelector("#gameArt").checked'))
    throw Error('Checkbox checked by default');
  await settings.webContents.executeJavaScript(
    'document.querySelector("#gameArt").click();document.querySelector("#save").click()',
  );
  await imageIs(own, 'Deadpool_03');
  await imageIs(rival, 'Blade_02');
  fs.mkdirSync('artifacts', { recursive: true });
  fs.writeFileSync(
    'artifacts/variant-settings.png',
    (await settings.webContents.capturePage()).toPNG(),
  );
  fs.writeFileSync('artifacts/variant-own.png', (await own.webContents.capturePage()).toPNG());
  await settings.webContents.executeJavaScript(
    'document.querySelector("#gameArt").click();document.querySelector("#save").click()',
  );
  await imageIs(own, 'Deadpool');
  await imageIs(rival, 'Blade');
  await settings.webContents.executeJavaScript(
    'document.querySelector("#gameArt").click();document.querySelector("#save").click()',
  );
  await wait(200);
  if (!JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')).gameArt)
    throw Error('Preference not saved');
  console.log({
    defaultBaseArt: true,
    ownVariant: true,
    opponentVariant: true,
    toggleBackToBase: true,
    preferenceSaved: true,
  });
  app.quit();
})().catch((error) => {
  console.error(error);
  app.exit(1);
});
