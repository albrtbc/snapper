// Check real X11 windows, without moving the cursor or clicking the game.
const { app, BrowserWindow } = require('electron'),
  fs = require('node:fs'),
  path = require('node:path');
const { InputRegion } = require('../src/services/input-region.cjs');
const profile = path.resolve('.cache/input-bounds-smoke');
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(
  path.join(profile, 'settings.json'),
  JSON.stringify({ scale: 1.15, layoutVersion: 2, positions: {} }),
);
app.setPath('userData', profile);
process.argv.push('--demo');
const source = process.argv.includes('--packaged-bounds')
  ? '../dist/linux-unpacked/resources/app.asar/src'
  : '../src';
require('../test/helpers/ui-fixtures.cjs').installUiFixtures(path.resolve(__dirname, source));
// Delayed content exercises both the loading tooltip and its larger final size.
require(source + '/services/card-info.cjs').CardInfo.prototype.get = async () => {
  await new Promise((resolve) => setTimeout(resolve, 350));
  return {
    language: 'en',
    text: 'On Reveal: Draw a card. ' + 'Give your other cards here +1 Power. '.repeat(12),
  };
};
require(source + '/main.cjs');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let inspector;
async function check(win) {
  await wait(180);
  const layout = await win.webContents.executeJavaScript(`(()=>{
  const panel=document.querySelector('#panel').getBoundingClientRect(),tip=document.querySelector('#card-tooltip');
  const bottom=Math.max(panel.bottom,tip.hidden?0:tip.getBoundingClientRect().bottom);
  return {bottom,limit:current.panelHeightLimit,tooltip:!tip.hidden};
 })()`);
  const bounds = win.getBounds(),
    zoom = win.webContents.getZoomFactor();
  if (Math.abs(zoom - 1.15) > 0.001) throw Error('Configured zoom was lost after loading');
  const expected = Math.min(Math.round(layout.limit * zoom), Math.ceil((layout.bottom + 3) * zoom));
  if (Math.abs(bounds.height - expected) > 1)
    throw Error('Invisible native area remains: ' + JSON.stringify({ bounds, layout, expected }));
  const rects = await inspector.request(win);
  // Every input rectangle must end within the visible content, not the old
  // fixed-height window. Allow two pixels for native coordinate rounding.
  if (rects.some(([x, y, w, h]) => y + h > Math.ceil(layout.bottom * zoom) + 2))
    throw Error(
      'Input shape extends below visible content: ' +
        JSON.stringify({ rects, layout, zoom, bounds }),
    );
  return bounds.height;
}
(async () => {
  await app.whenReady();
  await wait(1800);
  inspector = new InputRegion();
  const panels = BrowserWindow.getAllWindows().filter((w) =>
    w.webContents.getURL().includes('side='),
  );
  for (const win of panels) {
    win.setFocusable(false);
    const original = await check(win);
    if (original >= 970) throw Error('Panel still uses full fixed height');
    let hoverResizes = 0;
    const onResize = () => hoverResizes++;
    win.on('resize', onResize);
    await win.webContents.executeJavaScript(
      `document.querySelector('#content').scrollTop=0;Array.from(document.querySelectorAll('.card-row')).at(-1).dispatchEvent(new Event('pointerenter'));`,
    );
    if ((await check(win)) !== original)
      throw Error('Loading bottom-row tooltip resized the window');
    await wait(400);
    if ((await check(win)) !== original || hoverResizes)
      throw Error('Loaded bottom-row tooltip resized the window');
    const tooltipFits = await win.webContents.executeJavaScript(
      `(()=>{const tip=document.querySelector('#card-tooltip'),t=tip.getBoundingClientRect(),p=document.querySelector('#panel').getBoundingClientRect();return !tip.hidden&&t.top>=p.top&&t.bottom<=p.bottom;})()`,
    );
    if (!tooltipFits) throw Error('Bottom-row tooltip escaped the panel');
    fs.mkdirSync('artifacts', { recursive: true });
    fs.writeFileSync(
      'artifacts/bottom-row-tooltip-' +
        new URL(win.webContents.getURL()).searchParams.get('side') +
        '.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    await win.webContents.executeJavaScript(
      'document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape"}))',
    );
    if ((await check(win)) !== original || hoverResizes)
      throw Error('Dismissed card tooltip resized the window');
    win.removeListener('resize', onResize);
    await win.webContents.executeJavaScript('document.querySelector("#minimize").click()');
    const minimized = await check(win);
    if (minimized > 65) throw Error('Minimized native window is too tall');
    await win.webContents.executeJavaScript(
      'document.querySelector("#settings").dispatchEvent(new Event("pointerenter"))',
    );
    const tooltipHeight = await check(win);
    if (tooltipHeight <= minimized) throw Error('Tooltip cannot expand native window');
    await win.webContents.executeJavaScript(
      'document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape"}))',
    );
    if ((await check(win)) !== minimized)
      throw Error('Dismissed tooltip leaves invisible native area');
    await win.webContents.executeJavaScript('document.querySelector("#minimize").click()');
    if ((await check(win)) !== original) throw Error('Expanded panel did not restore height');
    await win.webContents.executeJavaScript('window.snapper.toggleLock()');
    await check(win);
    await win.webContents.executeJavaScript('window.snapper.toggleLock()');
    await check(win);
    await win.webContents.executeJavaScript(
      `const cards=document.querySelector('#cards');window.savedCards=cards.innerHTML;cards.replaceChildren(cards.firstElementChild);`,
    );
    const fewer = await check(win);
    if (fewer >= original) throw Error('Fewer cards did not shrink native surface');
    await win.webContents.executeJavaScript(
      `document.querySelector('#cards').innerHTML=window.savedCards;`,
    );
    if ((await check(win)) !== original) throw Error('More cards did not grow native surface');
  }
  console.log({
    nativeWindowsFitVisiblePanels: true,
    bottomRowHoverDoesNotResize: true,
    minimizedWindowsShrink: true,
    tooltipExpandsAndShrinks: true,
    cardUpdatesResize: true,
    clickThroughBelowPanels: true,
    scale: 1.15,
  });
  inspector.stop();
  app.quit();
})().catch((error) => {
  console.error(error);
  inspector?.stop();
  app.exit(1);
});
