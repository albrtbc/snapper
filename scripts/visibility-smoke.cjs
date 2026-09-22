// Inject game/UI state transitions; check real native window visibility.
const { app, BrowserWindow } = require('electron');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { demoState } = require('../src/demo.cjs');
app.setPath('userData', path.resolve('.cache/visibility-smoke'));
process.argv.push('--with-game');
let reader, avatar;
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
  console.log({
    startupOwnOnly: true,
    resultsKeepCards: true,
    lobbyOwnOnly: true,
    lobbyClearsCards: true,
    matchBothPanels: true,
    avatarMenuHidesBoth: true,
    closeRestoresBoth: true,
    lobbyClearsMenu: true,
  });
  app.quit();
})().catch((error) => {
  console.error(error);
  app.exit(1);
});
