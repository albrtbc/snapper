const { app, dialog } = require('electron');
const path = require('node:path');
const { install, uninstall, locations } = require('./services/linux-install.cjs');
const args = process.argv;
const appImage = process.env.APPIMAGE;
const offerInstall =
  appImage &&
  path.resolve(appImage) !== locations().image &&
  !['--with-game', '--demo', '--portable'].some((flag) => args.includes(flag));

// Install before acquiring the overlay lock, so an update works while it runs.
if (args.includes('--install') || args.includes('--uninstall') || offerInstall) {
  app.disableHardwareAcceleration();
  app.setName('Snapper');
  app
    .whenReady()
    .then(async () => {
      if (args.includes('--uninstall')) {
        await uninstall();
        console.log('Snapper removed. Settings and cached artwork were preserved.');
        app.quit();
        return;
      }
      if (!appImage)
        throw Error('Run --install from the AppImage, or use npm run install:linux from source.');
      if (!args.includes('--install')) {
        const { response } = await dialog.showMessageBox({
          type: 'question',
          title: 'Install Snapper',
          message: 'Start Snapper automatically with Marvel Snap?',
          detail:
            'Install or update Snapper for your user and add it to the application menu. A small background watcher opens the overlay with the game and closes it when the game exits. No administrator access is needed.',
          buttons: ['Install', 'Run once', 'Cancel'],
          defaultId: 0,
          cancelId: 2,
        });
        if (response === 1) {
          args.push('--portable');
          require('./main.cjs');
          return;
        }
        if (response === 2) {
          app.quit();
          return;
        }
      }
      const paths = await install({ appImage, start: !args.includes('--no-start') });
      console.log('Installed Snapper:', paths.image);
      console.log('Automatic startup with Marvel Snap is enabled.');
      if (!args.includes('--install'))
        await dialog.showMessageBox({
          type: 'info',
          title: 'Snapper installed',
          message: 'Snapper will open with Marvel Snap.',
          detail: 'You can also open Snapper from the application menu.',
        });
      app.quit();
    })
    .catch((error) => {
      console.error(error.message);
      if (!args.includes('--no-start'))
        dialog.showErrorBox('Snapper installation failed', error.message);
      app.exit(1);
    });
} else {
  require('./main.cjs');
}
