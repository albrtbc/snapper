// Inject game/UI state transitions; check real native window visibility.
const { app, BrowserWindow, globalShortcut } = require('electron');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { demoState } = require('../src/demo.cjs');
app.setPath('userData', path.resolve('.cache/visibility-smoke'));
process.argv.push('--with-game');
let reader, avatar;
let focus = 'game',
  togglePanels;
const registerShortcut = globalShortcut.register.bind(globalShortcut);
globalShortcut.register = (key, callback) => {
  if (key === 'CommandOrControl+Shift+O') togglePanels = callback;
  return registerShortcut(key, callback);
};
require('../src/services/focus.cjs').activeFocus = async () => focus;
const live = { ...demoState(), status: 'live' };
require('../src/services/reader.cjs').StateReader = class extends EventEmitter {
  constructor() {
    super();
    reader = this;
    this.directory = 'fixture';
  }
  start() {
    this.emit('state', { ...live, status: 'waiting', match: null });
  }
  stop() {}
};
require('../src/services/game.cjs').gameRunning = async () => true;
require('../src/services/game.cjs').gameBounds = async () => null;
require('node:worker_threads').Worker = class extends EventEmitter {
  constructor() {
    super();
    avatar = this;
  }
  postMessage() {}
  terminate() {}
};
require('../test/helpers/ui-fixtures.cjs').installUiFixtures();
require('../src/main.cjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await app.whenReady();
  await wait(1600);
  const panels = BrowserWindow.getAllWindows();
  const own = panels.find((w) => w.webContents.getURL().includes('side=own')),
    rival = panels.find((w) => w !== own);
  const check = (a, b) => {
    if (own.isVisible() !== a || rival.isVisible() !== b)
      throw Error(`Visibility expected ${a},${b}, got ${own.isVisible()},${rival.isVisible()}`);
  };
  check(true, false);
  reader.emit('state', live);
  await wait(100);
  check(true, true);
  reader.emit('state', { ...live, match: { ...live.match, ended: true } });
  await wait(100);
  check(true, true);
  const resultCards = await rival.webContents.executeJavaScript(
    'document.querySelectorAll("#cards .card-row").length',
  );
  if (!resultCards) throw Error('Opponent cards missing on results screen');
  reader.emit('state', { ...live, status: 'lobby', match: null });
  await wait(100);
  check(true, false);
  const oldCards = await rival.webContents.executeJavaScript(
    'document.querySelectorAll(".card-row").length',
  );
  if (oldCards) throw Error('Opponent cards retained in lobby renderer');
  reader.emit('state', live);
  await wait(100);
  check(true, true);
  for (let i = 0; i < 2; i++) {
    avatar.emit('message', { open: true, available: true });
    await wait(100);
    check(false, false);
    avatar.emit('message', { open: false, available: true });
    await wait(100);
    check(true, true);
  }
  avatar.emit('message', { open: true, available: true });
  await wait(100);
  check(false, false);
  reader.emit('state', { ...live, status: 'lobby', match: null });
  await wait(100);
  check(true, false);
  await own.webContents.executeJavaScript('window.snapper.openSettings()');
  await wait(700);
  const settings = BrowserWindow.getAllWindows().find((win) =>
    win.webContents.getURL().includes('settings.html'),
  );
  await settings.webContents.executeJavaScript(
    'window.snapper.saveSettings({ hideWhenUnfocused: true })',
  );
  await wait(350);
  check(true, false);
  focus = 'other';
  await wait(350);
  check(false, false);
  reader.emit('state', live);
  await wait(100);
  check(false, false);
  focus = 'game';
  await wait(350);
  check(true, true);
  focus = 'snapper';
  await wait(350);
  check(true, true);
  togglePanels();
  focus = 'other';
  await wait(350);
  focus = 'game';
  await wait(350);
  check(false, false);
  togglePanels();
  check(true, true);
  focus = 'unknown';
  await wait(350);
  check(false, false);
  await settings.webContents.executeJavaScript(
    'window.snapper.saveSettings({ hideWhenUnfocused: false })',
  );
  check(true, true);
  reader.emit('state', { ...live, status: 'lobby', match: null });
  check(true, false);
  console.log({
    startupOwnOnly: true,
    resultsKeepCards: true,
    lobbyOwnOnly: true,
    lobbyClearsCards: true,
    matchBothPanels: true,
    avatarMenuHidesBoth: true,
    closeRestoresBoth: true,
    lobbyClearsMenu: true,
    focusHidesAndRestores: true,
    ownWindowsStayInteractive: true,
    manualHidePreserved: true,
    focusOptionCanBeDisabled: true,
  });
  app.quit();
})().catch((error) => {
  console.error(error);
  app.exit(1);
});
