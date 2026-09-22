const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyFocus, activeFocus } = require('../src/services/focus.cjs');

test('focus identifies Snap and our windows without trusting another app title', () => {
  assert.equal(classifyFocus({ class: 'steam_app_1997040', pid: 42 }), 'game');
  assert.equal(classifyFocus({ classes: ['SNAP.exe', 'steam_app_1997040'] }), 'game');
  assert.equal(classifyFocus({ pid: process.pid, class: 'snapper' }), 'snapper');
  assert.equal(classifyFocus({ class: 'browser', title: 'MARVEL SNAP' }), 'other');
  assert.equal(classifyFocus({ class: 'snapper', pid: 42 }), 'other');
  assert.equal(classifyFocus({}), 'other');
  for (const client of [null, undefined, [], 'bad']) assert.equal(classifyFocus(client), 'unknown');
});

test('X11 focus works without a compositor CLI and reports unavailable readers', async () => {
  assert.equal(await activeFocus(async () => ({ classes: ['SNAP.exe'] }), {}), 'game');
  assert.equal(await activeFocus(async () => ({}), {}), 'other');
  assert.equal(
    await activeFocus(async () => {
      throw Error('X11 disconnected');
    }, {}),
    'unknown',
  );
  assert.equal(await activeFocus(undefined, {}), 'unknown');
});

test('other Wayland desktops never treat a stale XWayland window as focused', async () => {
  let called = false;
  const result = await activeFocus(
    async () => {
      called = true;
      return { classes: ['SNAP.exe'] };
    },
    { WAYLAND_DISPLAY: 'wayland-1' },
  );
  assert.equal(result, 'unknown');
  assert.equal(called, false);
});
