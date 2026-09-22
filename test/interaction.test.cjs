const { test } = require('node:test'),
  assert = require('node:assert/strict');
const { abilityFromPage, CardInfo, costFromPage } = require('../src/services/card-info.cjs');
const { visibleMenu } = require('../src/services/avatar-menu.cjs');
test('ability parser reads the current block, strips markup and decodes entities', () => {
  const html =
    '<p class="leading-relaxed text-snap-gray-100"><b>On Reveal:</b> A &amp; B<br>Power &#43;2.</p><table><p>Old ability</p></table>';
  assert.equal(abilityFromPage(html), 'On Reveal: A & B\nPower +2.');
  assert.equal(
    abilityFromPage('<meta content="description"><table>Only historical text</table>'),
    null,
  );
});
test('card metadata rejects paths and invalid IDs before any IO', async () => {
  const info = new CardInfo('/unreachable');
  for (const id of ['../settings', 'https://example.com', null, {}, 'A'.repeat(101)])
    assert.equal(await info.get(id), null);
});
test('avatar menu reads the active hierarchy flag and rejects stale native objects', () => {
  const values = new Map([
    [100, 200],
    [116, 300],
    [300, 1000 + 0x1b697f8],
    [332, 400],
    [400, 1000 + 0x1b267f0],
  ]);
  let active = 0;
  const mem = { ptr: (a) => values.get(a) || 0, read: () => Buffer.from([active]) };
  assert.equal(visibleMenu(mem, 100, 200, 1000), false);
  active = 1;
  assert.equal(visibleMenu(mem, 100, 200, 1000), true);
  active = 255;
  assert.equal(visibleMenu(mem, 100, 200, 1000), null);
  active = 1;
  values.set(116, 0);
  assert.equal(visibleMenu(mem, 100, 200, 1000), null);
});

test('base cost reads the current definition, including zero, without reading historical costs', () => {
  assert.equal(
    costFromPage(
      '<dt class="label">Cost</dt><dd class="value">5</dd><table><th>Cost</th><td>6</td></table>',
    ),
    5,
  );
  assert.equal(costFromPage('<dt>Cost</dt><dd>0</dd>'), 0);
  assert.equal(costFromPage('<table><th>Cost</th><td>6</td></table>'), null);
});
