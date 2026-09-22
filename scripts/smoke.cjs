// Exercise the actual renderer and native Electron windows, with an
// isolated profile. No game state or user settings are written by this test.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
process.argv.push('--demo');
app.setPath('userData', path.resolve('.cache/smoke-profile'));
require('../test/helpers/ui-fixtures.cjs').installUiFixtures();
require('../src/main.cjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await app.whenReady();
  await wait(2500);
  const windows = BrowserWindow.getAllWindows();
  if (windows.length !== 2) throw new Error(`Expected two panels, got ${windows.length}`);
  fs.mkdirSync('artifacts', { recursive: true });
  for (const win of windows) {
    // A captured renderer can look correct while no native window exists.
    // X11 resource IDs must be allocated by XWayland, not tiny Wayland IDs.
    if (process.platform === 'linux' && win.getNativeWindowHandle().readUInt32LE() < 256)
      throw new Error('No real X11 window: pass --ozone-platform=x11 before Electron starts');
    await win.webContents.executeJavaScript('window.snapper.toggleLock()');
    const result = await win.webContents.executeJavaScript(
      `({title:document.querySelector('#title').textContent,rows:document.querySelectorAll('#cards .card-row').length,scrollWidth:document.documentElement.scrollWidth,width:innerWidth})`,
    );
    if (result.rows < 5 || result.scrollWidth > result.width)
      throw new Error(JSON.stringify(result));
    const headerCounts = await win.webContents.executeJavaScript(`({
      inHeader: document.querySelector('.panel-header #title')?.children.length === 2,
      duplicateRow: !!document.querySelector('#content .counters'),
      accessibleName: document.querySelector('#panel').getAttribute('aria-label')
    })`);
    if (!headerCounts.inHeader || headerCounts.duplicateRow || !headerCounts.accessibleName)
      throw new Error('Header counts missing or duplicated');
    console.log(result);
  }
  await wait(300);
  for (const [index, win] of windows.entries()) {
    const image = await win.webContents.capturePage();
    fs.writeFileSync(`artifacts/panel-${index}.png`, image.toPNG());
    console.log(
      'images',
      await win.webContents.executeJavaScript('document.querySelectorAll(".portrait img").length'),
    );
  }
  const own = windows.find((w) => w.webContents.getURL().includes('side=own'));
  const count = await own.webContents.executeJavaScript(
    'document.querySelectorAll("#cards .card-row").length',
  );
  if (count !== 12) throw new Error('Expected complete deck: ' + count);
  await own.webContents.executeJavaScript('document.querySelector("#settings").click()');
  await wait(1000);
  const settings = BrowserWindow.getAllWindows().find((w) =>
    w.webContents.getURL().includes('settings.html'),
  );
  if (!settings) throw new Error('Settings not opened');
  await settings.webContents.executeJavaScript(
    'document.querySelector("#hideWhenUnfocused").checked = true; document.querySelector("#save").click()',
  );
  await wait(400);
  const saved = await settings.webContents.executeJavaScript(
    'document.querySelector("#saved").textContent',
  );
  if (!saved.includes('saved')) throw new Error('Settings not saved');
  const settingsState = await settings.webContents.executeJavaScript('window.snapper.getState()');
  if (!settingsState.settings.hideWhenUnfocused) throw new Error('Focus preference was not saved');
  fs.writeFileSync('artifacts/settings.png', (await settings.webContents.capturePage()).toPNG());
  console.log('Native overlay smoke test passed.');
  app.quit();
})().catch((error) => {
  console.error(error);
  app.exit(1);
});
