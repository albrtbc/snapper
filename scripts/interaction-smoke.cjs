const { app, BrowserWindow } = require('electron'),
  path = require('node:path'),
  fs = require('node:fs');
const profile = path.resolve('.cache/interaction-smoke');
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(
  path.join(profile, 'settings.json'),
  JSON.stringify({ scale: 1, positions: {}, layoutVersion: 2 }),
);
process.argv.push('--demo');
app.setPath('userData', profile);
require('../test/helpers/ui-fixtures.cjs').installUiFixtures();
require('../src/main.cjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await app.whenReady();
  await wait(2200);
  const panels = BrowserWindow.getAllWindows(),
    own = panels.find((w) => w.webContents.getURL().includes('side=own'));
  for (const win of panels) win.setFocusable(false);
  const state = await own.webContents.executeJavaScript('window.snapper.getState()');
  if (state.locked) throw Error('Panels must start interactive');
  if (await own.webContents.executeJavaScript('document.querySelectorAll(".zone,.legend").length'))
    throw Error('State labels still visible');
  await own.webContents.executeJavaScript(
    "document.documentElement.style.setProperty('--panel-height-limit','444px')",
  );
  await wait(250);
  own.webContents.sendInputEvent({
    type: 'mouseWheel',
    x: 150,
    y: 230,
    deltaY: -230,
    deltaX: 0,
    canScroll: true,
  });
  await wait(400);
  if (
    (await own.webContents.executeJavaScript('document.querySelector("#content").scrollTop')) <= 0
  )
    throw Error('Native wheel did not scroll panel');
  await own.webContents.executeJavaScript('document.querySelector("#content").scrollTop=0');
  await wait(150);
  await own.webContents.executeJavaScript(
    'document.querySelector("#cards .card-row").dispatchEvent(new Event("pointerenter"))',
  );
  let text = '';
  for (let n = 0; n < 30; n++) {
    text = await own.webContents.executeJavaScript(
      'document.querySelector("#tooltip-ability").textContent',
    );
    if (text && !text.startsWith('Loading')) break;
    await wait(400);
  }
  if (!text || /Could not load|Loading/.test(text)) throw Error('Ability tooltip failed: ' + text);
  const rect = await own.webContents.executeJavaScript(
    'JSON.stringify(document.querySelector("#card-tooltip").getBoundingClientRect())',
  );
  const r = JSON.parse(rect);
  if (r.x < 0 || r.y < 0 || r.right > 416 || r.bottom > 450)
    throw Error('Tooltip outside panel viewport');
  fs.mkdirSync('artifacts', { recursive: true });
  fs.writeFileSync('artifacts/ability-tooltip.png', (await own.webContents.capturePage()).toPNG());
  fs.writeFileSync(
    'artifacts/clean-opponent.png',
    (await panels.find((w) => w !== own).webContents.capturePage()).toPNG(),
  );
  await own.webContents.executeJavaScript(
    'document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape"}))',
  );
  if (!(await own.webContents.executeJavaScript('document.querySelector("#card-tooltip").hidden')))
    throw Error('Escape did not hide tooltip');
  for (const win of panels) {
    for (const locked of [false, true]) {
      const current = await win.webContents.executeJavaScript('window.snapper.getState()');
      if (current.locked !== locked) {
        await win.webContents.executeJavaScript('window.snapper.toggleLock()');
        await wait(150);
      }
      for (const id of ['settings', 'lock', 'minimize']) {
        const result = await win.webContents.executeJavaScript(`(()=>{
     const button=document.getElementById(${JSON.stringify(id)});button.dispatchEvent(new Event('pointerenter'));
     const tip=document.getElementById('card-tooltip'),r=tip.getBoundingClientRect();
     return {visible:!tip.hidden,text:tip.textContent,onTop:tip.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),fits:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,native:button.closest('[title]')!==null};
    })()`);
        if (!result.visible || !result.onTop || !result.fits || result.native)
          throw Error('Control tooltip failed: ' + JSON.stringify({ id, locked, ...result }));
      }
    }
  }
  await own.webContents.executeJavaScript(
    'document.querySelector("#minimize").click();document.querySelector("#settings").dispatchEvent(new Event("pointerenter"))',
  );
  await wait(200);
  const minimizedTip = await own.webContents.executeJavaScript(
    '!document.querySelector("#card-tooltip").hidden&&document.querySelector("#content").hidden',
  );
  if (!minimizedTip) throw Error('Minimized panel tooltip failed');
  fs.writeFileSync(
    'artifacts/control-tooltip-minimized.png',
    (await own.webContents.capturePage()).toPNG(),
  );
  await own.webContents.executeJavaScript(
    'document.querySelector("#minimize").click();document.querySelector("#settings").dispatchEvent(new Event("pointerenter"))',
  );
  await wait(150);
  fs.writeFileSync('artifacts/control-tooltip.png', (await own.webContents.capturePage()).toPNG());
  console.log({
    wheelScroll: true,
    labelsRemoved: true,
    ability: text,
    tooltipWithinViewport: true,
    escapeDismiss: true,
    controlsAbovePanel: true,
    lockedControls: true,
    minimizedTooltip: true,
  });
  app.quit();
})().catch((error) => {
  console.error(error);
  app.exit(1);
});
