// Move a simulated game rectangle; verify real overlay windows and persistence.
// Never moves or sends input to Marvel Snap.
const { app, BrowserWindow, screen } = require('electron'),
  fs = require('node:fs'),
  path = require('node:path');
const { EventEmitter } = require('node:events');
const profile = path.resolve('.cache/follow-smoke');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
process.argv.push('--with-game');
let game = { x: 200, y: 100, width: 1400, height: 1000 },
  reader,
  avatar;
const offsets = { own: { x: 40, y: 80 }, opponent: { x: 920, y: 95 } };
const restore = process.argv.includes('--restore-follow');
app.on('ready', () => {
  const area = screen.getPrimaryDisplay().workArea;
  game = { ...game, x: area.x + 200, y: area.y + 100 };
  if (restore) {
    game.x += 150;
    game.y += 60;
  } else
    fs.writeFileSync(
      path.join(profile, 'settings.json'),
      JSON.stringify({
        scale: 1,
        layoutVersion: 2,
        positions: Object.fromEntries(
          Object.entries(offsets).map(([side, offset]) => [
            side,
            { x: game.x + offset.x, y: game.y + offset.y },
          ]),
        ),
      }),
    );
});
const source = process.argv.includes('--packaged-follow')
  ? '../dist/linux-unpacked/resources/app.asar/src'
  : '../src';
require('../test/helpers/ui-fixtures.cjs').installUiFixtures(path.resolve(__dirname, source));
const live = { ...require(source + '/demo.cjs').demoState(), status: 'live' };
require(source + '/services/reader.cjs').StateReader = class extends EventEmitter {
  constructor() {
    super();
    reader = this;
    this.directory = 'fixture';
  }
  start() {
    this.emit('state', live);
  }
  stop() {}
};
require(source + '/services/game.cjs').gameRunning = async () => true;
require(source + '/services/game.cjs').gameBounds = async () => ({ ...game });
require('node:worker_threads').Worker = class extends EventEmitter {
  constructor() {
    super();
    avatar = this;
  }
  postMessage() {}
  terminate() {}
};
require(source + '/main.cjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const saved = () =>
  JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')).positions;
(async () => {
  await app.whenReady();
  await wait(1500);
  const panels = BrowserWindow.getAllWindows().filter((w) =>
    w.webContents.getURL().includes('side='),
  );
  const check = () => {
    for (const win of panels) {
      const side = new URL(win.webContents.getURL()).searchParams.get('side'),
        b = win.getBounds(),
        position = saved()[side];
      if (
        position.relativeTo !== 'game' ||
        b.x !== game.x + position.x ||
        b.y !== game.y + position.y
      )
        throw Error(JSON.stringify({ side, game, b, position }));
    }
  };
  check();
  if (restore) {
    console.log({ restartAtNewGamePosition: true });
    app.quit();
    return;
  }
  for (const [side, offset] of Object.entries(offsets))
    if (saved()[side].x !== offset.x || saved()[side].y !== offset.y)
      throw Error('Migration changed chosen position');
  const before = JSON.stringify(saved());
  for (const [dx, dy] of [
    [50, 25],
    [-120, 60],
    [240, -50],
    [-70, -35],
  ]) {
    game.x += dx;
    game.y += dy;
    await wait(350);
    check();
  }
  game.width += 130;
  game.height -= 100;
  await wait(350);
  check();
  reader.emit('state', { ...live, status: 'lobby', match: null });
  await wait(100);
  game.x -= 60;
  game.y += 40;
  await wait(350);
  check();
  const own = panels.find((w) => w.webContents.getURL().includes('side=own')),
    opponent = panels.find((w) => w !== own);
  if (opponent.isVisible()) throw Error('Opponent visible in lobby');
  reader.emit('state', live);
  await wait(100);
  avatar.emit('message', { open: true, available: true });
  await wait(100);
  game.x += 25;
  await wait(350);
  check();
  if (panels.some((w) => w.isVisible())) throw Error('Avatar menu should hide panels');
  avatar.emit('message', { open: false, available: true });
  await wait(200);
  check();
  if (JSON.stringify(saved()) !== before)
    throw Error(
      'Following game overwrote chosen offsets: ' + JSON.stringify({ before, after: saved() }),
    );
  // A genuine panel reposition must update its offset, then follow from there.
  const b = own.getBounds();
  own.setPosition(b.x + 33, b.y + 17);
  await wait(300);
  if (saved().own.x !== offsets.own.x + 33 || saved().own.y !== offsets.own.y + 17)
    throw Error('Manual move did not update relative offset');
  game.x += 50;
  game.y += 25;
  await wait(350);
  check();
  console.log({
    legacyMigrated: true,
    followsGame: true,
    noOffsetDrift: true,
    hiddenPanelsFollow: true,
    manualMoveUpdatesOffset: true,
  });
  app.quit();
})().catch((error) => {
  console.error(error);
  app.exit(1);
});
