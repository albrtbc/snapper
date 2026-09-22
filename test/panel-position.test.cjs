const { test } = require('node:test'),
  assert = require('node:assert/strict');
const { relativePosition, absolutePosition } = require('../src/services/panel-position.cjs');
test('chosen offset follows a game moving across monitor origins', () => {
  const game = { x: 2500, y: 30 },
    panel = { x: 2460, y: 335 },
    saved = relativePosition(panel, game);
  assert.deepEqual(saved, { relativeTo: 'game', x: -40, y: 305 });
  assert.deepEqual(absolutePosition(saved, { x: -1920, y: 100 }, {}), { x: -1960, y: 405 });
  assert.deepEqual(absolutePosition(saved, game, {}), panel);
});
test('legacy positions remain absolute until a real game rectangle is available', () => {
  const saved = relativePosition({ x: 80, y: 100 }, null);
  assert.deepEqual(absolutePosition(saved, { x: 500, y: 500 }, {}), { x: 80, y: 100 });
  assert.deepEqual(absolutePosition(null, { x: 500, y: 500 }, { x: 518, y: 524 }), {
    x: 518,
    y: 524,
  });
});
