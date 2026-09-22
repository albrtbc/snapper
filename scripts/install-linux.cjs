const fs = require('node:fs');
const path = require('node:path');
const { install } = require('../src/services/linux-install.cjs');
const root = path.resolve(__dirname, '..');
const packaged = path.join(root, 'dist/linux-unpacked/snapper');
const command = fs.existsSync(packaged) ? [packaged] : [require('electron'), root];
install({ command: [...command, '--ozone-platform=x11'] })
  .then((paths) => {
    console.log('Installed:', paths.launcher);
    console.log('Automatic startup with Marvel Snap is enabled.');
    console.log('Keep this source checkout at its current path.');
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
