const { parentPort } = require('node:worker_threads');
const { gamePid } = require('./memory.cjs');
const { AvatarMenus } = require('./avatar-menu.cjs');
let reader,
  pid,
  lastPidCheck = 0,
  nextDiscovery = 0;
parentPort.on('message', (message) => {
  if (message.reset) {
    if (reader) reader.objects = [];
    nextDiscovery = 0;
  }
});
function tick() {
  try {
    if (Date.now() - lastPidCheck > 1000) {
      lastPidCheck = Date.now();
      const current = gamePid();
      if (current !== pid) {
        reader?.close();
        reader = null;
        pid = current;
        nextDiscovery = 0;
      }
    }
    if (!pid) {
      parentPort.postMessage({ open: false, available: false });
      return;
    }
    if (!reader && Date.now() >= nextDiscovery) {
      nextDiscovery = Date.now() + 5000;
      reader = new AvatarMenus(pid);
      nextDiscovery = 0;
    }
    if (!reader) return;
    if (reader.objects.length < 2 && Date.now() >= nextDiscovery) {
      nextDiscovery = Date.now() + 2000;
      reader.discover();
    }
    parentPort.postMessage(reader.read());
  } catch {
    parentPort.postMessage({ open: false, available: false });
  } finally {
    setTimeout(tick, 100);
  }
}
tick();
