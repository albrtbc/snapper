const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { createSecureIpc } = require('../src/services/ipc-security.cjs');
const { readSettings, preferences } = require('../src/services/settings.cjs');
const { fetchBytes } = require('../src/services/http.cjs');
const { TaskQueue } = require('../src/services/task-queue.cjs');

test('IPC rejects foreign windows, subframes, navigated pages and incorrect roles', () => {
  const handlers = new Map(),
    events = new Map();
  const ipc = createSecureIpc({
    handle: (key, fn) => handlers.set(key, fn),
    on: (key, fn) => events.set(key, fn),
  });
  const contents = new EventEmitter();
  let requestPermission, checkPermission;
  contents.session = {
    setPermissionRequestHandler: (fn) => (requestPermission = fn),
    setPermissionCheckHandler: (fn) => (checkPermission = fn),
  };
  contents.setWindowOpenHandler = (fn) => (contents.openWindow = fn);
  const file = path.resolve('src/ui/overlay.html');
  contents.mainFrame = { url: pathToFileURL(file).href + '?side=own' };
  ipc.registerWindow({ webContents: contents }, file, 'overlay');
  ipc.handle('read', () => 42);
  ipc.handle('save', () => true, ['settings']);
  let drags = 0;
  ipc.on('drag', () => drags++);
  const event = { sender: contents, senderFrame: contents.mainFrame };
  assert.equal(handlers.get('read')(event), 42);
  for (const invalid of [
    { ...event, sender: {} },
    { ...event, senderFrame: null },
    { ...event, senderFrame: { ...contents.mainFrame } },
  ]) {
    assert.throws(() => handlers.get('read')(invalid), /Untrusted/);
    events.get('drag')(invalid);
  }
  assert.equal(drags, 0);
  events.get('drag')(event);
  assert.equal(drags, 1);
  assert.throws(() => handlers.get('save')(event), /Untrusted/);
  for (const url of [
    'https://example.com',
    pathToFileURL(path.resolve('src/ui/settings.html')).href,
    'about:blank',
  ]) {
    contents.mainFrame.url = url;
    assert.throws(() => handlers.get('read')(event), /Untrusted/);
  }
  assert.equal(checkPermission(), false);
  requestPermission(null, 'media', (allowed) => assert.equal(allowed, false));
  assert.deepEqual(contents.openWindow(), { action: 'deny' });
  let prevented = 0;
  contents.emit('will-frame-navigate', { preventDefault: () => prevented++ });
  assert.equal(prevented, 1);
  contents.mainFrame.url = pathToFileURL(file).href;
  contents.emit('destroyed');
  assert.throws(() => handlers.get('read')(event), /Untrusted/);
});

test('settings accept only known fields with valid types and bounded values', () => {
  for (const input of [null, [], false, 'bad']) assert.deepEqual(preferences(input), {});
  const settings = readSettings({
    scale: 100,
    opacity: -1,
    images: 'false',
    hideWhenUnfocused: 'true',
    statesPath: '../../private',
    positions: {
      own: { x: Infinity, y: 0 },
      opponent: { x: 5, y: 10, relativeTo: 'game', extra: 'ignored' },
    },
    unexpected: 'ignored',
  });
  assert.equal(settings.scale, 1.4);
  assert.equal(settings.opacity, 0.65);
  assert.equal(settings.images, true);
  assert.equal(settings.hideWhenUnfocused, false);
  assert.equal(readSettings({ hideWhenUnfocused: true }).hideWhenUnfocused, true);
  assert.equal(settings.statesPath, '');
  assert.deepEqual(settings.positions, { opponent: { x: 5, y: 10, relativeTo: 'game' } });
  assert.ok(!('unexpected' in settings));
  assert.deepEqual(
    preferences({ scale: NaN, opacity: Infinity, positions: {}, statesPath: '/tmp' }),
    {},
  );
  const a = readSettings(null),
    b = readSettings(null);
  a.positions.own = { x: 1, y: 1 };
  assert.deepEqual(b.positions, {});
});

test('downloads reject foreign URLs, redirects, wrong types and oversized streaming bodies', async (t) => {
  const options = { maxBytes: 8, contentType: /^image\/webp$/ };
  let calls = 0;
  t.mock.method(global, 'fetch', async (_url, init) => {
    calls++;
    assert.equal(init.redirect, 'error');
    return new Response('RIFF', { headers: { 'content-type': 'image/webp' } });
  });
  for (const url of [
    'http://snap.fan/a',
    'https://snap.fan.evil.test/a',
    'https://user@snap.fan/a',
    'https://snap.fan:8080/a',
    'file:///tmp/x',
  ])
    await assert.rejects(fetchBytes(url, options), /Untrusted/);
  assert.equal(calls, 0);
  assert.equal((await fetchBytes('https://game-assets.snap.fan/a', options)).toString(), 'RIFF');
  t.mock.method(
    global,
    'fetch',
    async () => new Response('x', { status: 302, headers: { location: 'https://evil.test' } }),
  );
  await assert.rejects(fetchBytes('https://snap.fan/a', options), /unavailable/);
  t.mock.method(
    global,
    'fetch',
    async () => new Response('x', { headers: { 'content-type': 'text/html' } }),
  );
  await assert.rejects(fetchBytes('https://snap.fan/a', options), /content type/);
  let cancelled = false;
  t.mock.method(
    global,
    'fetch',
    async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(new Uint8Array(5));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { 'content-type': 'image/webp', 'content-length': '1' } },
      ),
  );
  await assert.rejects(fetchBytes('https://snap.fan/a', options), /too large/);
  assert.equal(cancelled, true);
});

test('download queue bounds pending work and recovers after a failed request', async () => {
  const queue = new TaskQueue(1, 1);
  let release;
  const first = queue.run(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await Promise.resolve();
  const second = queue.run(() => {
    throw new Error('offline');
  });
  const failure = assert.rejects(second, /offline/);
  await assert.rejects(
    queue.run(() => null),
    /queue full/,
  );
  release('done');
  assert.equal(await first, 'done');
  await failure;
  assert.equal(await queue.run(() => 42), 42);
});
