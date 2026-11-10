const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs/promises'),
  os = require('node:os'),
  path = require('node:path');
const { CardPool, parseCardList } = require('../src/services/card-pool.cjs');
const IMAGES = 'https://game-assets.snap.fan/card_variant_images/';
const image = (key, hash = 'a1b2c3') => `${IMAGES}${key}-${hash}.webp`;
// Same markup as the real list pages, shortened. `attributes` are written as given, so a
// value-less attribute is possible.
function cell(key, attributes = '', { src = image(key), search = '' } = {}) {
  const inner = src ? `<img class="game-card-image__img" src="${src}" alt="" loading="lazy">` : '';
  return (
    `<div class="card-grid__cell" data-card-key="${key}" ${attributes} data-card-search="${search}">` +
    `<div class="card-grid__cell-card"><a href="/cards/${key}/"><div class="game-card-image">` +
    `<div class="game-card-image__inner">${inner}</div></div></a></div>` +
    `<div class="card-grid__cell-content"><div class="card-grid__cell-name">${key}</div></div></div>`
  );
}
const page = (...cells) =>
  `<html><body><div class="card-grid">${cells.join('\n')}</div></body></html>`;
const named = (key, extra = '') =>
  cell(key, `data-card-name="${key}" data-card-cost="1" data-card-power="2" ${extra}`);
async function directory(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snapper-pool-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
// A fake art cache: `statuses` maps key to a result, everything else is downloaded.
function fakeArt(statuses = {}) {
  const art = {
    calls: [],
    active: 0,
    peak: 0,
    async refresh(key, url) {
      art.calls.push([key, url]);
      art.peak = Math.max(art.peak, ++art.active);
      await new Promise((resolve) => setImmediate(resolve));
      art.active--;
      return statuses[key] ?? { status: 'downloaded' };
    },
  };
  return art;
}
const pages =
  (released, upcoming = page()) =>
  async (url) => {
    if (url === 'https://snap.fan/cards/') return released;
    if (url === 'https://snap.fan/cards/upcoming/') return upcoming;
    throw new Error('Unexpected page ' + url);
  };

test('parseCardList reads every field, value-less attributes, tags in attributes and entities', () => {
  const html = page(
    cell(
      'DragonLord',
      'data-card-name="Dragon Lord" data-card-cost="5" data-card-power="5" data-card-series="Series 4" ' +
        'data-card-source data-card-type="CHARACTER" data-card-abilities data-card-release="2026-01-12"',
      { search: 'dragon lord <b>on reveal:</b> put a card from your hand here.' },
    ),
    cell(
      'SamWilsonNightcrawlerDoomsday',
      'data-card-name="Sam Wilson &amp; Nightcrawler Doomsday" data-card-cost="3" data-card-power="-1" ' +
        'data-card-type="CHARACTER" data-card-release',
    ),
    cell('MBaku', `data-card-name="M&#39;Baku" data-card-cost="x" data-card-type="CHARACTER"`),
  );
  assert.deepEqual(parseCardList(html), [
    {
      key: 'DragonLord',
      name: 'Dragon Lord',
      cost: 5,
      power: 5,
      type: 'CHARACTER',
      release: '2026-01-12',
      image: image('DragonLord'),
    },
    {
      key: 'SamWilsonNightcrawlerDoomsday',
      name: 'Sam Wilson & Nightcrawler Doomsday',
      cost: 3,
      power: -1,
      type: 'CHARACTER',
      release: null,
      image: image('SamWilsonNightcrawlerDoomsday'),
    },
    {
      key: 'MBaku',
      name: "M'Baku",
      cost: null,
      power: null,
      type: 'CHARACTER',
      release: null,
      image: image('MBaku'),
    },
  ]);
});

test('parseCardList keeps cells without an image and skips invalid or repeated keys', () => {
  const html = page(
    cell(
      'Spell06Agamotto',
      'data-card-name="Images of Ikonn" data-card-cost="5" data-card-power="0" data-card-type="SPELL"',
      {
        src: '',
      },
    ),
    cell('../escape', 'data-card-name="Bad"'),
    cell('Has Space', 'data-card-name="Bad"'),
    cell('', 'data-card-name="Bad"'),
    cell('Venom', 'data-card-name="Venom"', { src: image('Other') }),
    cell('Wasp', 'data-card-name="Wasp"', {
      src: 'https://evil.example/card_variant_images/Wasp-abc.webp',
    }),
    cell('Hulk', 'data-card-name="Hulk"', { src: IMAGES + 'Hulk-ZZZ.webp' }),
    cell('Thor', 'data-card-name="Thor"', { src: IMAGES + 'Thor_01-abc.webp' }),
    cell('Zabu', 'data-card-name="First Zabu"'),
    cell('Zabu', 'data-card-name="Second Zabu"'),
  );
  assert.deepEqual(
    parseCardList(html).map(({ key, name, image: url }) => [key, name, url]),
    [
      ['Spell06Agamotto', 'Images of Ikonn', null],
      ['Venom', 'Venom', null],
      ['Wasp', 'Wasp', null],
      ['Hulk', 'Hulk', null],
      ['Thor', 'Thor', null],
      ['Zabu', 'First Zabu', image('Zabu')],
    ],
  );
  assert.deepEqual(parseCardList('<html>nothing here</html>'), []);
  assert.deepEqual(parseCardList(''), []);
});

test('parseCardList stays linear on hostile markup', () => {
  // node:test timeouts cannot interrupt synchronous work, so time the parses.
  // A quadratic scan needs seconds for about 64 KiB of these shapes; a linear
  // one needs milliseconds.
  const started = performance.now();
  assert.deepEqual(parseCardList('<div '.repeat(13000)), []);
  assert.deepEqual(parseCardList('<div a="' + '<div '.repeat(13000)), []);
  assert.deepEqual(
    parseCardList("<div class='card-grid__cell' data-card-key=\"" + '<div '.repeat(13000)),
    [],
  );
  assert.deepEqual(parseCardList('<div a=b '.repeat(8000)), []);
  const cells = '<div class="card-grid__cell" data-card-key="Venom_1"> '.repeat(1300);
  assert.equal(parseCardList(cells).length, 1);
  assert.ok(performance.now() - started < 1000, 'hostile markup took too long to parse');
});

test('update merges both lists, released cards win, and writes the pool atomically', async (t) => {
  const dir = await directory(t);
  const file = path.join(dir, 'nested', 'card-pool.json');
  const released = page(
    cell(
      'Mordred',
      'data-card-name="Mordred" data-card-cost="3" data-card-power="4" data-card-release="2026-11-05"',
    ),
    cell('Venom', 'data-card-name="Venom"'),
  );
  const upcoming = page(
    cell('Mordred', 'data-card-name="Mordred (upcoming)" data-card-cost="9"', {
      src: image('Mordred', 'ffff'),
    }),
    cell('Future', 'data-card-name="Future" data-card-release="2099-01-01"'),
  );
  const art = fakeArt();
  const pool = new CardPool(file, art, { fetchPage: pages(released, upcoming), now: () => 1234 });
  const summary = await pool.update();
  const stored = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(stored.retrievedAt, 1234);
  assert.deepEqual(stored.cards, summary.cards);
  assert.deepEqual(stored.cards.map((c) => c.key).sort(), ['Future', 'Mordred', 'Venom']);
  const mordred = stored.cards.find((c) => c.key === 'Mordred');
  assert.equal(mordred.name, 'Mordred');
  assert.equal(mordred.cost, 3);
  assert.equal(mordred.image, image('Mordred'));
  assert.deepEqual(art.calls.map(([key]) => key).sort(), ['Future', 'Mordred', 'Venom']);
  assert.deepEqual(
    art.calls.find(([key]) => key === 'Mordred'),
    ['Mordred', image('Mordred')],
  );
  assert.deepEqual(await fs.readdir(path.dirname(file)), ['card-pool.json']);
});

test('update refreshes art in batches of at most 32 and reports progress', async (t) => {
  const dir = await directory(t);
  const keys = Array.from({ length: 100 }, (_, i) => 'Card' + i);
  const art = fakeArt();
  const progress = [];
  const pool = new CardPool(path.join(dir, 'card-pool.json'), art, {
    fetchPage: pages(page(...keys.map((key) => named(key)))),
  });
  const summary = await pool.update({ onProgress: (p) => progress.push(p) });
  assert.equal(art.calls.length, 100);
  assert.ok(art.peak > 1 && art.peak <= 32, `peak ${art.peak}`);
  assert.equal(summary.downloaded, 100);
  assert.deepEqual(progress, [
    { done: 32, total: 100 },
    { done: 64, total: 100 },
    { done: 96, total: 100 },
    { done: 100, total: 100 },
  ]);
});

test('the batch size is configurable and a failing progress callback does not stop the update', async (t) => {
  const dir = await directory(t);
  const art = fakeArt();
  const pool = new CardPool(path.join(dir, 'card-pool.json'), art, {
    fetchPage: pages(page(...['A', 'B', 'C', 'D', 'E'].map((key) => named(key)))),
    batchSize: 2,
  });
  const summary = await pool.update({
    onProgress: () => {
      throw new Error('listener bug');
    },
  });
  assert.equal(art.peak, 2);
  assert.equal(summary.downloaded, 5);
});

test('the summary counts downloads, unchanged art, placeholders, failures and cards without an image', async (t) => {
  const dir = await directory(t);
  const art = fakeArt({
    Real: { status: 'unchanged', placeholder: false },
    Mordred: { status: 'unchanged', placeholder: true },
    Toad: { status: 'placeholder' },
    Broken: { status: 'failed' },
  });
  const refresh = art.refresh;
  art.refresh = (key, url) =>
    key === 'Thrown' ? Promise.reject(new Error('bug')) : refresh.call(art, key, url);
  const released = page(
    named('Fresh'),
    named('Real'),
    named('Mordred'),
    named('Toad'),
    named('Broken'),
    named('Thrown'),
    cell('NoArt', 'data-card-name="No Art"', { src: '' }),
  );
  const pool = new CardPool(path.join(dir, 'card-pool.json'), art, {
    fetchPage: pages(released),
  });
  const summary = await pool.update();
  assert.equal(summary.cards.length, 7);
  assert.equal(summary.downloaded, 1);
  assert.equal(summary.unchanged, 1);
  assert.deepEqual(summary.placeholders.sort(), ['Mordred', 'Toad']);
  assert.deepEqual(summary.failed.sort(), ['Broken', 'Thrown']);
  assert.equal(summary.noImage, 1);
  assert.equal(
    art.calls.some(([key]) => key === 'NoArt'),
    false,
  );
  const stored = JSON.parse(await fs.readFile(path.join(dir, 'card-pool.json'), 'utf8'));
  assert.equal(stored.cards.find((c) => c.key === 'NoArt').image, null);
});

test('a failed list page rejects and leaves the previous card pool byte-identical', async (t) => {
  const dir = await directory(t);
  const file = path.join(dir, 'card-pool.json');
  const previous = JSON.stringify({ retrievedAt: 1, cards: [{ key: 'Old' }] }, null, 2);
  await fs.writeFile(file, previous);
  const good = page(named('Venom'));
  for (const fetchPage of [
    async (url) => {
      if (url.endsWith('/upcoming/')) throw new Error('Download unavailable');
      return good;
    },
    async (url) => {
      if (!url.endsWith('/upcoming/')) throw new Error('Download unavailable');
      return good;
    },
    pages('<html>markup changed</html>', good),
  ]) {
    const art = fakeArt();
    await assert.rejects(new CardPool(file, art, { fetchPage }).update());
    assert.equal(await fs.readFile(file, 'utf8'), previous);
    assert.equal(art.calls.length, 0);
    assert.deepEqual(await fs.readdir(dir), ['card-pool.json']);
  }
});

test('a pool update can run again after a failure', async (t) => {
  const dir = await directory(t);
  let fail = true;
  const pool = new CardPool(path.join(dir, 'card-pool.json'), fakeArt(), {
    fetchPage: async (url) => {
      if (fail) throw new Error('offline');
      return pages(page(named('Venom')))(url);
    },
  });
  await assert.rejects(pool.update(), /offline/);
  fail = false;
  assert.equal((await pool.update()).cards.length, 1);
});

test('concurrent updates share one run', async (t) => {
  const dir = await directory(t);
  const requests = [];
  const art = fakeArt();
  const pool = new CardPool(path.join(dir, 'card-pool.json'), art, {
    fetchPage: async (url) => {
      requests.push(url);
      await new Promise((resolve) => setImmediate(resolve));
      return pages(page(named('Venom')))(url);
    },
  });
  const first = pool.update(),
    second = pool.update();
  assert.equal(first, second);
  assert.equal(await first, await second);
  assert.equal(requests.length, 2);
  assert.equal(art.calls.length, 1);
  const third = pool.update();
  assert.notEqual(third, first);
  await third;
  assert.equal(requests.length, 4);
});

test('isDue is true for a missing, unreadable or old pool and false for a fresh one', async (t) => {
  const dir = await directory(t);
  const file = path.join(dir, 'card-pool.json');
  let clock = 1_000_000;
  const pool = new CardPool(file, fakeArt(), { now: () => clock });
  const day = 24 * 3600 * 1000;
  assert.equal(await pool.isDue(), true);
  await fs.writeFile(file, '{not json');
  assert.equal(await pool.isDue(), true);
  await fs.writeFile(file, JSON.stringify({ cards: [] }));
  assert.equal(await pool.isDue(), true);
  await fs.writeFile(file, JSON.stringify({ retrievedAt: clock, cards: [] }));
  assert.equal(await pool.isDue(), false);
  clock += 6 * day;
  assert.equal(await pool.isDue(), false);
  clock += 2 * day;
  assert.equal(await pool.isDue(), true);
  assert.equal(await pool.isDue(30 * day), false);
});
