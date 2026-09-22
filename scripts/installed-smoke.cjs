// Run after packing, while Snap is open. Tests the worker from the installed
// ASAR layout, which the demo UI test cannot exercise. Uses an isolated profile.
const { app, BrowserWindow } = require('electron'),
  path = require('node:path');
app.setPath('userData', path.resolve('.cache/installed-smoke'));
process.argv.push('--with-game');
require('../dist/linux-unpacked/resources/app.asar/src/main.cjs');
app
  .whenReady()
  .then(async () => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const panels = BrowserWindow.getAllWindows();
      if (panels.length !== 2) continue;
      const state = await panels[0].webContents.executeJavaScript('window.snapper.getState()');
      // Avatar-menu objects need not exist before the first match starts.
      if (state.status === 'lobby' || (state.status === 'live' && state.avatarMenuAvailable)) {
        for (const win of panels)
          if (win.getNativeWindowHandle().readUInt32LE() < 256) throw Error('No X11 window');
        console.log({
          status: state.status,
          turn: state.match?.turn,
          opponentCount: state.match?.opponent.length,
          packagedWorker: true,
          avatarMenuReader: state.avatarMenuAvailable,
        });
        app.quit();
        return;
      }
    }
    throw Error('Packaged live reader unavailable. Start the supported Snap build, then retry.');
  })
  .catch((error) => {
    console.error(error.message);
    app.exit(1);
  });
