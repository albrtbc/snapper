const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const path = require('node:path');
// Persistent X11 connection. Input regions stay valid when the pointer leaves,
// the game regains focus, or the panel moves: coordinates are window-local.
class InputRegion {
  constructor() {
    this.next = 0;
    this.pending = new Map();
    this.closed = false;
    const helper = path
      .join(__dirname, 'input-region.py')
      .replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
    this.child = spawn('python3', ['-u', helper], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.on('data', (data) => console.error('[input-region]', String(data).trim()));
    this.child.on('error', (error) => this.fail(error));
    this.child.stdin.on('error', (error) => this.fail(error));
    this.child.on('exit', () => this.fail(new Error('X11 input region helper stopped')));
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      try {
        const message = JSON.parse(line),
          pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error));
        else pending.resolve('focus' in message ? message.focus : message.rects);
      } catch (error) {
        this.fail(error);
      }
    });
  }
  request(win, rects) {
    const handle = win.getNativeWindowHandle();
    const window = handle.length >= 8 ? Number(handle.readBigUInt64LE()) : handle.readUInt32LE();
    return this.send({ window, ...(rects === undefined ? {} : { rects }) });
  }
  activeWindow() {
    return this.send({ action: 'active-window' });
  }
  send(payload) {
    if (this.closed) return Promise.reject(new Error('X11 input region unavailable'));
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('X11 input region timed out'));
      }, 2000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, ...payload }) + '\n');
    });
  }
  fail(error) {
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }
  stop() {
    this.fail(new Error('Input region stopped'));
    this.child.stdin.end();
  }
}
module.exports = { InputRegion };
