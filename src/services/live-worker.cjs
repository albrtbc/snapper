const { parentPort } = require('node:worker_threads');
const { attach, decodeGame, gamePid } = require('./memory.cjs');
let connection,
  pid,
  nextAttach = 0,
  failures = 0;
function disconnect() {
  connection?.mem.close();
  connection = null;
}
function tick() {
  try {
    const current = gamePid();
    if (current !== pid) {
      disconnect();
      pid = current;
      nextAttach = 0;
    }
    if (!pid) {
      parentPort.postMessage({ ok: false, message: 'Waiting for Marvel Snap' });
      return;
    }
    if (!connection) {
      if (Date.now() < nextAttach) return;
      nextAttach = Date.now() + 15000;
      connection = attach(pid);
    }
    const result = decodeGame(connection.mem, connection.manager, connection.managerClass);
    failures = 0;
    parentPort.postMessage({ ok: true, ...result, updatedAt: Date.now() });
  } catch (error) {
    // A scene can mutate while reading. Retry briefly, then re-discover a
    // replaced manager. Never label the last successful read as fresh.
    if (error.code === 'SNAP_TRANSITION') failures = 0;
    else if (++failures >= 4) {
      disconnect();
      failures = 0;
    }
    parentPort.postMessage({
      ok: false,
      message: error.code === 'EACCES' ? 'Linux does not allow reading Snap state' : error.message,
    });
  } finally {
    setTimeout(tick, 350);
  }
}
tick();
