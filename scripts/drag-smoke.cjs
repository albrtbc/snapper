// Real native windows and X11 input regions; injected renderer pointer events.
// No cursor mocks or clicks sent to the game. Both panels must remain draggable
// after multiple moves, a focus change, lock toggles and a zoom change.
const { app, BrowserWindow } = require('electron'),
  path = require('node:path'),
  fs = require('node:fs');
const { InputRegion } = require('../src/services/input-region.cjs');
const profile = path.resolve('.cache/drag-smoke'),
  restore = process.argv.includes('--restore-drag');
fs.mkdirSync(profile, { recursive: true });
if (!restore)
  fs.writeFileSync(
    path.join(profile, 'settings.json'),
    JSON.stringify({ scale: 1, positions: {}, layoutVersion: 2 }),
  );
process.argv.push('--demo');
app.setPath('userData', profile);
require('../test/helpers/ui-fixtures.cjs').installUiFixtures(
  path.resolve(
    __dirname,
    process.argv.includes('--packaged-drag')
      ? '../dist/linux-unpacked/resources/app.asar/src'
      : '../src',
  ),
);
require(
  process.argv.includes('--packaged-drag')
    ? '../dist/linux-unpacked/resources/app.asar/src/main.cjs'
    : '../src/main.cjs',
);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let inspector;
async function checkRegion(win, locked = true) {
  const rects = await inspector.request(win);
  const contains = (x, y) =>
    rects.some(([a, b, w, h]) => x >= a && x < a + w && y >= b && y < b + h);
  if (!contains(100, 22)) throw Error('Header excluded from native X11 input region');
  if (contains(100, 150) === locked)
    throw Error('Native card click-through region incorrect: ' + JSON.stringify(rects));
}
async function dragPanel(win, dx, dy) {
  await checkRegion(win);
  const a = win.getBounds();
  await win.webContents.executeJavaScript(
    "window.dragTrace=[];if(!window.tracing){window.tracing=true;for(const name of ['pointerdown','pointerup','pointermove','lostpointercapture','gotpointercapture','blur','focus'])window.addEventListener(name,e=>window.dragTrace.push({type:e.type,id:e.pointerId,x:e.screenX,y:e.screenY,target:e.target.tagName}),true)}",
  );
  await win.webContents.executeJavaScript(
    "document.addEventListener('pointerdown',e=>window.testPointerId=e.pointerId,{capture:true,once:true})",
  );
  win.focus();
  await wait(100);
  win.webContents.sendInputEvent({
    type: 'mouseDown',
    x: 100,
    y: 22,
    button: 'left',
    clickCount: 1,
  });
  await wait(100);
  // Electron synthetic native events use zero for screen coordinates.
  await win.webContents.executeJavaScript(
    `document.querySelector('.panel-header').dispatchEvent(new PointerEvent('pointermove',{pointerId:window.testPointerId,screenX:${dx},screenY:${dy},buttons:1,bubbles:true}))`,
  );
  await wait(120);
  win.webContents.sendInputEvent({ type: 'mouseUp', x: 100, y: 22, button: 'left', clickCount: 1 });
  await wait(220);
  const b = win.getBounds();
  if (b.x - a.x !== dx || b.y - a.y !== dy)
    throw Error(
      `Drag did not move native panel: ${JSON.stringify({ a, b, dx, dy, trace: await win.webContents.executeJavaScript('window.dragTrace') })}`,
    );
  const side = new URL(win.webContents.getURL()).searchParams.get('side');
  const saved = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')).positions[
    side
  ];
  const origin = (await win.webContents.executeJavaScript('window.snapper.getState()')).gameBounds;
  if (
    saved.x + (saved.relativeTo === 'game' ? origin.x : 0) !== b.x ||
    saved.y + (saved.relativeTo === 'game' ? origin.y : 0) !== b.y
  )
    throw Error('Position was not persisted');
  await checkRegion(win);
}
(async () => {
  await app.whenReady();
  await wait(1800);
  inspector = new InputRegion();
  const panels = BrowserWindow.getAllWindows().filter((w) =>
    w.webContents.getURL().includes('side='),
  );
  if (panels.length !== 2) throw Error('Expected both panels');
  for (const win of panels) {
    await checkRegion(win, false);
  }
  await panels[0].webContents.executeJavaScript('window.snapper.toggleLock()');
  await wait(100);
  if (restore) {
    const saved = JSON.parse(
      fs.readFileSync(path.join(profile, 'settings.json'), 'utf8'),
    ).positions;
    for (const win of panels) {
      const side = new URL(win.webContents.getURL()).searchParams.get('side'),
        b = win.getBounds();
      const origin = (await win.webContents.executeJavaScript('window.snapper.getState()'))
        .gameBounds;
      if (
        b.x !== saved[side].x + (saved[side].relativeTo === 'game' ? origin.x : 0) ||
        b.y !== saved[side].y + (saved[side].relativeTo === 'game' ? origin.y : 0)
      )
        throw Error('Position not restored');
      await checkRegion(win);
    }
    console.log('Saved positions and native input regions restored');
    inspector.stop();
    app.quit();
    return;
  }
  for (let n = 0; n < 3; n++) for (const win of panels) await dragPanel(win, 20, 12);
  await panels[0].webContents.executeJavaScript('window.snapper.openSettings()');
  await wait(400);
  const settingsWindow = BrowserWindow.getAllWindows().find((w) =>
    w.webContents.getURL().includes('settings.html'),
  );
  settingsWindow.setFocusable(false);
  settingsWindow.hide();
  for (const win of panels)
    await win.webContents.executeJavaScript("window.dispatchEvent(new Event('blur'))");
  await wait(150);
  for (const win of panels) await dragPanel(win, -20, -12);
  await panels[0].webContents.executeJavaScript('window.snapper.toggleLock()');
  await wait(100);
  for (const win of panels) await checkRegion(win, false);
  await panels[0].webContents.executeJavaScript('window.snapper.toggleLock()');
  await wait(100);
  const before = panels.map((w) => w.getBounds());
  await settingsWindow.webContents.executeJavaScript('window.snapper.saveSettings({scale:1.1})');
  await wait(300);
  for (const [i, win] of panels.entries()) {
    const resized = win.getBounds();
    if (resized.x !== before[i].x || resized.y !== before[i].y || resized.width !== 458)
      throw Error('Scale change lost position');
    await dragPanel(win, 20, 12);
  }
  console.log({
    consecutiveDrags: 10,
    bothPanels: true,
    nativeHeaderRegion: true,
    nativeCardClickThrough: true,
    blurRecovery: true,
    lockToggle: true,
    scalePreservesPosition: true,
  });
  inspector.stop();
  app.quit();
})().catch((error) => {
  console.error(error);
  inspector?.stop();
  app.exit(1);
});
