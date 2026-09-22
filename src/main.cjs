const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  Menu,
  Tray,
  nativeImage,
  dialog,
  screen,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { StateReader } = require('./services/reader.cjs');
const { discoverStates } = require('./services/paths.cjs');
const { gameRunning, gameBounds } = require('./services/game.cjs');
const { CardArt } = require('./services/art.cjs');
const { demoState } = require('./demo.cjs');
const { InputRegion } = require('./services/input-region.cjs');
const { CardInfo } = require('./services/card-info.cjs');
const {
  relativePosition,
  absolutePosition,
  validPosition,
} = require('./services/panel-position.cjs');
const { createSecureIpc } = require('./services/ipc-security.cjs');
const { readSettings, preferences } = require('./services/settings.cjs');
const ipc = createSecureIpc(ipcMain);

// Ozone selects its backend before application JS runs. appendSwitch here is
// too late: it can leave the browser on Wayland and child processes on X11,
// producing rendered but invisible windows. Relaunch direct AppImage starts;
// the launchers and tests pass this switch on the initial command line.
if (process.platform === 'linux' && app.commandLine.getSwitchValue('ozone-platform') !== 'x11') {
  app.relaunch({ args: [...process.argv.slice(1), '--ozone-platform=x11'] });
  app.exit(0);
}
// These small panels need no GPU effects. Software rendering also avoids
// competing with the game and NVIDIA/GBM initialization failures on Linux.
app.disableHardwareAcceleration();
app.setName('Snapper');
const demo = process.argv.includes('--demo');
const withGame = process.argv.includes('--with-game');
let settings,
  configFile,
  reader,
  art,
  tray,
  settingsWindow,
  timer,
  pointerTimer,
  boundsTimer,
  inputRegion,
  cardInfo,
  avatarWorker;
let quitting = false;
let avatarMenuOpen = false,
  avatarMenuAvailable = false,
  lastMatchId = null;
const panelRects = new Map(),
  headerRects = new Map(),
  mouseModes = new Map(),
  expectedPositions = new Map(),
  moveTimers = new Map();
let windows = [],
  state = { status: 'waiting', message: 'Looking for Marvel Snap…', match: null, decks: [] };
let running = false,
  hidden = false,
  locked = false,
  hadGame = false,
  shortcuts = [],
  gameRect = null;
let drag = null;
const serialize = () => ({
  ...state,
  running,
  demo,
  locked,
  settings,
  shortcuts,
  avatarMenuOpen,
  avatarMenuAvailable,
  gameBounds: gameRect,
  panelHeightLimit: panelHeightLimit() / settings.scale,
  statesPath: reader?.directory,
});
function broadcast() {
  for (const win of BrowserWindow.getAllWindows())
    if (!win.isDestroyed()) win.webContents.send('state', serialize());
}
function save() {
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile + '.tmp', JSON.stringify(settings, null, 2));
  fs.renameSync(configFile + '.tmp', configFile);
}
// Keep the native surface as small as the visible panel and tooltip. XWayland
// compositors may focus the full surface even when its X11 input shape is smaller.
function panelHeightLimit() {
  const area = gameRect || screen.getPrimaryDisplay().workArea;
  return Math.max(160, Math.min(Math.round(850 * settings.scale), area.height - 40));
}
function fittedHeight(win, limit = panelHeightLimit()) {
  const layout = panelRects.get(win.id);
  if (!layout) return limit;
  const bottom = Math.max(
    layout.panel.y + layout.panel.height,
    layout.tooltipCanExpand && layout.tooltip ? layout.tooltip.y + layout.tooltip.height : 0,
  );
  return Math.max(1, Math.min(limit, Math.ceil((bottom + 3) * win.webContents.getZoomFactor())));
}
function fitPanel(win) {
  const bounds = win.getBounds(),
    height = fittedHeight(win);
  if (bounds.height !== height) {
    const position = expectedPositions.get(win.id) || bounds;
    win.setBounds({ x: position.x, y: position.y, width: bounds.width, height });
  }
}
function updatePointer() {
  if (inputRegion) {
    for (const win of windows) {
      if (win.isDestroyed()) continue;
      const rect = headerRects.get(win.id) || { x: 4, y: 4, width: 408, height: 42 };
      const factor = screen.getDisplayMatching(win.getBounds()).scaleFactor;
      const zoom = win.webContents.getZoomFactor() * factor;
      const bounds = win.getBounds();
      const layout = panelRects.get(win.id);
      const rects = locked
        ? [rect]
        : [
            layout?.panel || {
              x: 0,
              y: 0,
              width: bounds.width / win.webContents.getZoomFactor(),
              height: bounds.height / win.webContents.getZoomFactor(),
            },
          ];
      if (layout?.tooltip) rects.push(layout.tooltip);
      const region = rects.map((r) => [
        Math.floor(r.x * zoom),
        Math.floor(r.y * zoom),
        Math.ceil(r.width * zoom),
        Math.ceil(r.height * zoom),
      ]);
      const signature = JSON.stringify(region);
      if (mouseModes.get(win.id) === signature) continue;
      mouseModes.set(win.id, signature);
      inputRegion.request(win, region).catch((error) => {
        if (quitting || win.isDestroyed()) return;
        console.error('[input-region]', error.message);
        // A failed helper must never leave the header inaccessible. The lock
        // shortcut remains available, and the panel stays interactive.
        mouseModes.delete(win.id);
        win.setIgnoreMouseEvents(false);
      });
    }
    return;
  }
  const point = screen.getCursorScreenPoint();
  for (const win of windows) {
    if (win.isDestroyed()) continue;
    const bounds = win.getBounds(),
      rect = headerRects.get(win.id) || { x: 4, y: 4, width: 408, height: 42 };
    const scale = win.webContents.getZoomFactor();
    const overHeader =
      win.isVisible() &&
      point.x >= bounds.x + rect.x * scale &&
      point.x < bounds.x + (rect.x + rect.width) * scale &&
      point.y >= bounds.y + rect.y * scale &&
      point.y < bounds.y + (rect.y + rect.height) * scale;
    const ignore = locked && !overHeader && drag?.win !== win;
    if (mouseModes.get(win.id) !== ignore) {
      mouseModes.set(win.id, ignore);
      win.setIgnoreMouseEvents(ignore);
      win.setFocusable(!ignore);
    }
  }
}
function finishDrag() {
  if (!drag) return;
  const { win } = drag;
  drag = null;
  if (!win.isDestroyed()) {
    const side = windows.indexOf(win) === 0 ? 'own' : 'opponent';
    clearTimeout(moveTimers.get(win.id));
    moveTimers.delete(win.id);
    settings.positions[side] = relativePosition(win.getBounds(), gameRect);
    save();
  }
  updatePointer();
}
function lock(value) {
  locked = value;
  updatePointer();
  broadcast();
  menu();
}
function placeWindow(win, bounds) {
  clearTimeout(moveTimers.get(win.id));
  moveTimers.delete(win.id);
  expectedPositions.set(win.id, { x: bounds.x, y: bounds.y });
  win.setBounds(bounds);
}
function visibility() {
  const inMatch = !!state.match && state.status !== 'lobby';
  for (const [index, win] of windows.entries()) {
    const visible = (running || demo) && !hidden && !avatarMenuOpen && (index === 0 || inMatch);
    if (visible) {
      if (!win.isVisible()) win.showInactive();
    } else if (win.isVisible()) win.hide();
  }
}
function toggle() {
  finishDrag();
  hidden = !hidden;
  visibility();
  menu();
}
function menu() {
  if (tray)
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: running ? 'Marvel Snap detected' : 'Waiting for Marvel Snap', enabled: false },
        { label: hidden ? 'Show panels' : 'Hide panels', click: toggle },
        {
          label: locked ? 'Unlock panels' : 'Lock and pass clicks through',
          click: () => lock(!locked),
        },
        { label: 'Settings', click: openSettings },
        { type: 'separator' },
        { label: 'Quit Snapper', click: () => app.quit() },
      ]),
    );
}
function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 650,
    height: 740,
    minWidth: 480,
    minHeight: 580,
    title: 'Snapper · Settings',
    backgroundColor: '#101824',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  ipc.registerWindow(settingsWindow, path.join(__dirname, 'ui/settings.html'), 'settings');
  settingsWindow.loadFile(path.join(__dirname, 'ui/settings.html'));
}
function startReader() {
  reader?.removeAllListeners('state');
  reader?.stop();
  if (demo) {
    state = demoState();
    broadcast();
    return;
  }
  reader = new StateReader(discoverStates(settings.statesPath));
  reader.on('state', (next) => {
    state = next;
    const id = next.match?.gameId || null;
    if (id !== lastMatchId) {
      lastMatchId = id;
      avatarWorker?.postMessage({ reset: true });
    }
    if (next.status === 'lobby') avatarMenuOpen = false;
    visibility();
    broadcast();
  });
  if (!reader.directory) {
    state = {
      status: 'waiting',
      message: 'Snap folder not found. Select it in Settings.',
      match: null,
      decks: [],
    };
    broadcast();
  }
  reader.start();
}
function resetPositions(bounds) {
  if (bounds) {
    gameRect = bounds;
    // Upgrade existing screen coordinates once, without moving the panels.
    let migrated = false;
    for (const [side, position] of Object.entries(settings.positions)) {
      if (validPosition(position) && position.relativeTo !== 'game') {
        settings.positions[side] = relativePosition(position, bounds);
        migrated = true;
      }
    }
    if (migrated) save();
  }
  const rect = gameRect || screen.getPrimaryDisplay().workArea;
  const width = Math.round(416 * settings.scale);
  windows.forEach((win, i) => {
    if (drag?.win === win) return;
    const height = fittedHeight(win);
    const saved = settings.positions[i === 0 ? 'own' : 'opponent'];
    const position = absolutePosition(saved, rect, {
      x: i === 0 ? rect.x + 18 : rect.x + rect.width - width - 18,
      y: rect.y + 24,
    });
    placeWindow(win, { ...position, width, height });
  });
  updatePointer();
  broadcast();
}
async function followGame() {
  try {
    if (running || demo) {
      const bounds = await gameBounds();
      if (
        !quitting &&
        bounds &&
        (!gameRect || ['x', 'y', 'width', 'height'].some((key) => bounds[key] !== gameRect[key]))
      )
        resetPositions(bounds);
    }
  } finally {
    if (!quitting) boundsTimer = setTimeout(followGame, 100);
  }
}
async function monitor() {
  running = await gameRunning();
  if (quitting) return;
  if (running) hadGame = true;
  if (withGame && hadGame && !running) {
    app.quit();
    return;
  }
  visibility();
  broadcast();
  menu();
  if (!reader?.directory && !demo) startReader();
  timer = setTimeout(monitor, 2000);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => openSettings());
  app
    .whenReady()
    .then(async () => {
      configFile = path.join(app.getPath('userData'), 'settings.json');
      try {
        settings = readSettings(JSON.parse(fs.readFileSync(configFile, 'utf8')));
      } catch {
        settings = readSettings(null);
      }
      art = new CardArt(path.join(app.getPath('userData'), 'card-art'));
      cardInfo = new CardInfo(path.join(app.getPath('userData'), 'card-info'));
      if (process.platform === 'linux') inputRegion = new InputRegion();
      for (const side of ['own', 'opponent']) {
        const win = new BrowserWindow({
          width: 416,
          height: 850,
          frame: false,
          transparent: true,
          backgroundColor: '#00000000',
          show: false,
          alwaysOnTop: true,
          skipTaskbar: true,
          resizable: false,
          focusable: true,
          hasShadow: false,
          title: `Snapper Overlay ${side}`,
          webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        });
        ipc.registerWindow(win, path.join(__dirname, 'ui/overlay.html'), 'overlay');
        win.setAlwaysOnTop(true, 'screen-saver');
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        win.setIgnoreMouseEvents(!inputRegion);
        win.webContents.setZoomFactor(settings.scale);
        win.setOpacity(settings.opacity);
        win.loadFile(path.join(__dirname, 'ui/overlay.html'), { query: { side } });
        win.webContents.on('did-finish-load', async () => {
          win.webContents.setZoomFactor(settings.scale);
          const rect = await win.webContents.executeJavaScript(
            'JSON.stringify(document.querySelector(".panel-header").getBoundingClientRect())',
          );
          if (!win.isDestroyed()) {
            headerRects.set(win.id, JSON.parse(rect));
            updatePointer();
          }
        });
        // `move` works on Linux too. `moved` is only documented on macOS/Windows.
        win.on('move', () => {
          const b = win.getBounds(),
            expected = expectedPositions.get(win.id);
          clearTimeout(moveTimers.get(win.id));
          moveTimers.delete(win.id);
          if (expected && b.x === expected.x && b.y === expected.y) return;
          expectedPositions.delete(win.id);
          clearTimeout(moveTimers.get(win.id));
          moveTimers.set(
            win.id,
            setTimeout(() => {
              if (!win.isDestroyed()) {
                settings.positions[side] = relativePosition(win.getBounds(), gameRect);
                save();
              }
              moveTimers.delete(win.id);
            }, 150),
          );
        });
        for (const event of ['show', 'resize'])
          win.on(event, () => {
            mouseModes.delete(win.id);
            updatePointer();
          });
        windows.push(win);
      }
      resetPositions(await gameBounds());
      // Linux uses a persistent native input region, independent of cursor/focus.
      // Other backends retain cursor-based hit testing.
      updatePointer();
      if (!inputRegion) pointerTimer = setInterval(updatePointer, 16);
      const icon = nativeImage.createFromPath(path.join(__dirname, '../assets/tray.png'));
      tray = new Tray(icon);
      tray.setToolTip('Snapper · Marvel Snap');
      tray.on('double-click', openSettings);
      menu();
      for (const [key, fn] of [
        ['CommandOrControl+Shift+O', toggle],
        ['CommandOrControl+Shift+L', () => lock(!locked)],
        ['CommandOrControl+Shift+,', openSettings],
      ]) {
        shortcuts.push({ key, registered: globalShortcut.register(key, fn) });
      }
      ipc.handle('get-state', () => serialize());
      const validPoint = (point) =>
        point &&
        Number.isFinite(point.x) &&
        Number.isFinite(point.y) &&
        Math.abs(point.x) < 100000 &&
        Math.abs(point.y) < 100000;
      ipc.on('input-layout', (event, layout) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!windows.includes(win) || !layout) return;
        const validRect = (r) =>
          r &&
          ['x', 'y', 'width', 'height'].every(
            (key) => Number.isFinite(r[key]) && r[key] >= 0 && r[key] < 20000,
          );
        if (!validRect(layout.header) || !validRect(layout.panel)) return;
        headerRects.set(win.id, layout.header);
        panelRects.set(win.id, {
          panel: layout.panel,
          tooltip: validRect(layout.tooltip) ? layout.tooltip : null,
          tooltipCanExpand: layout.tooltipCanExpand === true,
        });
        fitPanel(win);
        updatePointer();
      });
      ipc.on('drag-start', (event, point) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!windows.includes(win) || !win.isVisible() || !validPoint(point)) return;
        drag = { win, point, bounds: win.getBounds() };
        updatePointer();
      });
      ipc.on('drag-move', (event, point) => {
        if (drag?.win.webContents !== event.sender || !validPoint(point)) return;
        drag.win.setPosition(
          Math.round(drag.bounds.x + point.x - drag.point.x),
          Math.round(drag.bounds.y + point.y - drag.point.y),
        );
      });
      ipc.on('drag-end', (event) => {
        if (drag?.win.webContents === event.sender) finishDrag();
      });
      ipc.handle('card-info', (_event, id) => cardInfo.get(id));
      ipc.handle('art', (_e, id, variantId) =>
        settings.images && typeof id === 'string'
          ? art.get(id, settings.gameArt ? variantId : null)
          : null,
      );
      ipc.handle('settings-open', openSettings);
      ipc.handle('lock', () => lock(!locked));
      ipc.handle(
        'reset-position',
        async () => {
          settings.positions = {};
          save();
          resetPositions(await gameBounds());
        },
        ['settings'],
      );
      ipc.handle(
        'settings-save',
        async (event, input) => {
          Object.assign(settings, preferences(input));
          save();
          for (const win of windows) {
            win.setOpacity(settings.opacity);
            win.webContents.setZoomFactor(settings.scale);
          }
          resetPositions(await gameBounds());
          broadcast();
        },
        ['settings'],
      );
      ipc.handle(
        'choose-path',
        async (event) => {
          const result = await dialog.showOpenDialog(settingsWindow, {
            title: 'Select SNAP/Standalone/States/nvprod',
            properties: ['openDirectory'],
          });
          if (result.canceled) return;
          const selected = result.filePaths[0];
          if (!fs.existsSync(path.join(selected, 'GameState.json')))
            return { error: 'This folder does not contain GameState.json.' };
          settings.statesPath = selected;
          save();
          startReader();
          broadcast();
          return { ok: true };
        },
        ['settings'],
      );
      ipc.handle(
        'auto-path',
        () => {
          settings.statesPath = '';
          save();
          startReader();
          broadcast();
        },
        ['settings'],
      );
      if (process.platform === 'linux' && !demo) {
        const workerPath = path
          .join(__dirname, 'services/avatar-worker.cjs')
          .replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
        avatarWorker = new Worker(workerPath);
        avatarWorker.on('message', (result) => {
          avatarMenuAvailable = !!result.available;
          const open = result.open && state.status !== 'lobby';
          if (open !== avatarMenuOpen) {
            avatarMenuOpen = open;
            if (open) finishDrag();
            visibility();
          }
        });
        avatarWorker.on('error', (error) => {
          console.error('[avatar-menu]', error.message);
          avatarMenuOpen = false;
          visibility();
        });
      }
      startReader();
      await monitor();
      followGame();
      if (!withGame && !demo) openSettings();
      if (demo) {
        running = true;
        visibility();
      }
    })
    .catch((error) => {
      console.error(error);
      app.quit();
    });
}
app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  quitting = true;
  finishDrag();
  clearTimeout(timer);
  clearTimeout(boundsTimer);
  clearInterval(pointerTimer);
  inputRegion?.stop();
  avatarWorker?.terminate();
  for (const t of moveTimers.values()) clearTimeout(t);
  reader?.stop();
  globalShortcut.unregisterAll();
});
