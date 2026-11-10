const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs/promises'),
  os = require('node:os'),
  path = require('node:path');
const crypto = require('node:crypto');
const { CardArt, isPlaceholder, KNOWN_PLACEHOLDERS } = require('../src/services/art.cjs');
test('base and variant assets are separate, missing variants fall back, invalid IDs cannot become paths', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'snapper-art-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const requests = [];
  const bytes = Buffer.from('RIFF0000WEBPfixture');
  t.mock.method(global, 'fetch', async (url) => {
    requests.push(url);
    if (url.endsWith('/Venom_99/')) return new Response('', { status: 404 });
    if (url.endsWith('.webp'))
      return new Response(bytes, { headers: { 'content-type': 'image/webp' } });
    const key = url.endsWith('/Venom_02/') ? 'Venom_02' : 'Venom';
    return new Response(
      `<img src="https://game-assets.snap.fan/card_variant_images/${key}-abcdef.webp">`,
      { headers: { 'content-type': 'text/html' } },
    );
  });
  const art = new CardArt(directory, { placeholderBytes: 0 }),
    base = await art.get('Venom'),
    variant = await art.get('Venom', 'Venom_02');
  assert.match(base, /\/Venom\.webp\?v=abcdef$/);
  assert.match(variant, /\/Venom_02\.webp\?v=abcdef$/);
  assert.notEqual(base, variant);
  assert.equal(await art.get('Venom'), base);
  assert.equal(await art.get('Venom', 'Venom_99'), base);
  assert.equal(await art.get('../escape', 'Venom_02'), null);
  const count = requests.length;
  assert.equal(await art.get('Venom', '../../escape'), base);
  assert.equal(await art.get('Venom', 'Other_01'), base);
  assert.equal(requests.length, count);
  const offline = new CardArt(directory, { placeholderBytes: 0 });
  assert.equal(await offline.get('Venom', 'Venom_02'), variant);
  assert.equal(requests.length, count);
});

const HOUR = 3600 * 1000,
  DAY = 24 * HOUR;
const ASSETS = 'https://game-assets.snap.fan/card_variant_images/';
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const webp = (size, tag = 'x') => {
  const bytes = Buffer.alloc(size, tag);
  bytes.write('RIFF', 0, 'ascii');
  bytes.write('WEBP', 8, 'ascii');
  return bytes;
};
const REAL = 30000,
  SMALL = 18000;
// A fake snap.fan: card pages and images can change between calls, and it can go offline.
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'snapper-art-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const site = { pages: new Map(), images: new Map(), requests: [], offline: false };
  site.card = (key, hex, bytes, id = key.split('_')[0]) => {
    site.pages.set(
      `https://snap.fan/cards/${id}/${key === id ? '' : key + '/'}`,
      `<img src="${ASSETS}${key}-${hex}.webp">`,
    );
    site.images.set(`${ASSETS}${key}-${hex}.webp`, bytes);
  };
  site.count = (kind) =>
    site.requests.filter((url) => (kind === 'image') === url.endsWith('.webp')).length;
  t.mock.method(global, 'fetch', async (url) => {
    site.requests.push(url);
    if (site.gate) await site.gate;
    if (site.offline) throw new TypeError('fetch failed');
    const image = url.endsWith('.webp'),
      body = (image ? site.images : site.pages).get(url);
    if (body === undefined) return new Response('', { status: 404 });
    return new Response(body, { headers: { 'content-type': image ? 'image/webp' : 'text/html' } });
  });
  let time = Date.parse('2026-11-10T12:00:00.000Z');
  site.advance = (ms) => (time += ms);
  site.art = new CardArt(directory, { now: () => time, ...options });
  site.record = async (key) =>
    JSON.parse(await fs.readFile(path.join(directory, key + '.source.json'), 'utf8'));
  site.directory = directory;
  return site;
}

test('isPlaceholder flags small images and known hashes only', () => {
  assert.equal(isPlaceholder(webp(SMALL)), true);
  assert.equal(isPlaceholder(webp(REAL)), false);
  assert.equal(isPlaceholder(webp(24000)), false);
  assert.equal(
    isPlaceholder(webp(REAL), { placeholderHashes: new Set([sha256(webp(REAL))]) }),
    true,
  );
  assert.equal(isPlaceholder(webp(100), { placeholderBytes: 0 }), false);
  assert.equal(
    KNOWN_PLACEHOLDERS.has('3d389018dc5376ac3a1b8439770c42006f8c6609bed2953c4477eb076a1e59e8'),
    true,
  );
});

test('placeholder art is recorded and never returned, and a variant placeholder falls back to the base', async (t) => {
  const bigGrey = webp(REAL, 'g');
  const site = await fixture(t, { placeholderHashes: new Set([sha256(bigGrey)]) });
  site.card('Mordred', 'aaaaaaaaaaaaaaaa', webp(SMALL));
  assert.equal(await site.art.get('Mordred'), null);
  const record = await site.record('Mordred');
  assert.equal(record.placeholder, true);
  assert.equal(record.checked, '2026-11-10T12:00:00.000Z');
  assert.equal(record.source, ASSETS + 'Mordred-aaaaaaaaaaaaaaaa.webp');
  assert.equal(record.page, 'https://snap.fan/cards/Mordred/');
  assert.equal(typeof record.retrieved, 'string');
  assert.ok(record.rights);
  await fs.access(path.join(site.directory, 'Mordred.webp'));
  // A known hash is a placeholder whatever its size.
  site.card('Toad', 'bbbbbbbbbbbbbbbb', bigGrey);
  assert.equal(await site.art.get('Toad'), null);
  assert.equal((await site.record('Toad')).placeholder, true);
  // The variant is a placeholder, so the base art is used.
  site.card('Venom', 'cccccccccccccccc', webp(REAL));
  site.card('Venom_02', 'dddddddddddddddd', webp(SMALL, 'v'));
  const base = await site.art.get('Venom'),
    variant = await site.art.get('Venom', 'Venom_02');
  assert.match(base, /\/Venom\.webp\?v=cccccccccccc$/);
  assert.equal(variant, base);
  assert.equal((await site.record('Venom')).placeholder, false);
  assert.equal((await site.record('Venom_02')).placeholder, true);
});

test('legacy cached files are classified locally and the result is written back', async (t) => {
  const site = await fixture(t);
  const small = webp(SMALL),
    real = webp(REAL, 'r'),
    recorded = webp(SMALL, 's');
  await fs.writeFile(path.join(site.directory, 'Mordred.webp'), small);
  await fs.writeFile(path.join(site.directory, 'Merlin.webp'), real);
  await fs.writeFile(path.join(site.directory, 'Toad.webp'), recorded);
  const legacy = {
    source: ASSETS + 'Toad-eeeeeeeeeeeeeeee.webp',
    page: 'https://snap.fan/cards/Toad/',
    retrieved: '2026-01-01T00:00:00.000Z',
    rights: 'Marvel / Second Dinner; served by Snap.fan',
  };
  await fs.writeFile(path.join(site.directory, 'Toad.source.json'), JSON.stringify(legacy));
  const mordred = await site.art.inspect('Mordred'),
    merlin = await site.art.inspect('Merlin'),
    toad = await site.art.inspect('Toad');
  assert.equal(site.requests.length, 0);
  assert.equal(mordred.placeholder, true);
  assert.equal(merlin.placeholder, false);
  assert.equal(merlin.version, sha256(real).slice(0, 12));
  assert.equal(toad.placeholder, true);
  assert.equal(toad.version, 'eeeeeeeeeeee');
  assert.equal((await site.record('Mordred')).placeholder, true);
  assert.equal((await site.record('Merlin')).placeholder, false);
  assert.deepEqual(await site.record('Toad'), { ...legacy, placeholder: true });
  // They count as due, but the placeholders are never returned, even with the site down.
  site.offline = true;
  assert.equal(await site.art.get('Mordred'), null);
  assert.equal(await site.art.get('Toad'), null);
  assert.equal(site.count('image'), 0);
  assert.match(
    await site.art.get('Merlin'),
    new RegExp(`/Merlin\\.webp\\?v=${sha256(real).slice(0, 12)}$`),
  );
});

test('nothing is fetched while a record is fresh', async (t) => {
  const site = await fixture(t);
  site.card('Venom', 'aaaaaaaaaaaaaaaa', webp(REAL));
  site.card('Mordred', 'bbbbbbbbbbbbbbbb', webp(SMALL));
  const venom = await site.art.get('Venom');
  assert.equal(await site.art.get('Mordred'), null);
  assert.equal(site.requests.length, 4);
  // A placeholder is fresh for 6 hours, real art for 7 days.
  site.advance(5 * HOUR);
  assert.equal(await site.art.get('Mordred'), null);
  site.advance(6 * DAY);
  assert.equal(await site.art.get('Venom'), venom);
  assert.equal(site.requests.length, 4);
});

test('after the TTL an unchanged URL only updates checked', async (t) => {
  const site = await fixture(t);
  site.card('Venom', 'aaaaaaaaaaaaaaaa', webp(REAL));
  site.card('Mordred', 'bbbbbbbbbbbbbbbb', webp(SMALL));
  const venom = await site.art.get('Venom');
  await site.art.get('Mordred');
  const first = await site.record('Venom');
  site.requests.length = 0;
  site.advance(8 * DAY);
  assert.equal(await site.art.get('Venom'), venom);
  assert.equal(site.count('page'), 1);
  assert.equal(site.count('image'), 0);
  const second = await site.record('Venom');
  assert.equal(second.checked, '2026-11-18T12:00:00.000Z');
  assert.notEqual(second.checked, first.checked);
  assert.equal(second.retrieved, first.retrieved);
  assert.equal(await site.art.get('Mordred'), null);
  assert.equal(site.count('page'), 2);
  assert.equal(site.count('image'), 0);
  assert.equal((await site.record('Mordred')).placeholder, true);
});

test('after the TTL a changed URL is downloaded, and a former placeholder becomes art', async (t) => {
  const site = await fixture(t);
  site.card('Mordred', 'bbbbbbbbbbbbbbbb', webp(SMALL));
  site.card('Venom', 'aaaaaaaaaaaaaaaa', webp(REAL));
  assert.equal(await site.art.get('Mordred'), null);
  const venom = await site.art.get('Venom');
  site.advance(7 * HOUR);
  site.card('Mordred', 'cafecafecafecafecafe', webp(REAL, 'm'));
  const mordred = await site.art.get('Mordred');
  assert.match(mordred, /\/Mordred\.webp\?v=cafecafecafe$/);
  const record = await site.record('Mordred');
  assert.equal(record.placeholder, false);
  assert.equal(record.source, ASSETS + 'Mordred-cafecafecafecafecafe.webp');
  assert.equal(record.checked, record.retrieved);
  assert.deepEqual(await fs.readFile(path.join(site.directory, 'Mordred.webp')), webp(REAL, 'm'));
  // Real art that changes gets a new URL, so the renderer reloads it.
  assert.equal(await site.art.get('Venom'), venom);
  site.advance(8 * DAY);
  site.card('Venom', '0123456789abcdef', webp(REAL, 'n'));
  const updated = await site.art.get('Venom');
  assert.match(updated, /\/Venom\.webp\?v=0123456789ab$/);
  assert.notEqual(updated, venom);
});

test('a failed re-check keeps serving real cached art and never throws', async (t) => {
  const site = await fixture(t);
  site.card('Venom', 'aaaaaaaaaaaaaaaa', webp(REAL));
  site.card('Mordred', 'bbbbbbbbbbbbbbbb', webp(SMALL));
  const venom = await site.art.get('Venom');
  await site.art.get('Mordred');
  site.advance(8 * DAY);
  site.offline = true;
  assert.equal(await site.art.get('Venom'), venom);
  assert.equal(await site.art.get('Mordred'), null);
  assert.equal(await site.art.get('Nothing'), null);
  // The page loses its art, or the new image is broken: same outcome.
  site.offline = false;
  site.advance(11 * 60 * 1000);
  site.pages.set('https://snap.fan/cards/Venom/', '<p>no art</p>');
  assert.equal(await site.art.get('Venom'), venom);
  site.advance(11 * 60 * 1000);
  site.pages.set(
    'https://snap.fan/cards/Venom/',
    `<img src="${ASSETS}Venom-ffffffffffffffff.webp">`,
  );
  site.images.set(ASSETS + 'Venom-ffffffffffffffff.webp', Buffer.from('not a webp'.repeat(5000)));
  assert.equal(await site.art.get('Venom'), venom);
  assert.deepEqual(await fs.readFile(path.join(site.directory, 'Venom.webp')), webp(REAL));
  assert.equal((await site.record('Venom')).source, ASSETS + 'Venom-aaaaaaaaaaaaaaaa.webp');
});

test('refresh validates its input and reports unchanged, downloaded and placeholder', async (t) => {
  const site = await fixture(t);
  const url = (key, hex) => `${ASSETS}${key}-${hex}.webp`;
  site.images.set(url('Venom', 'aaaaaaaaaaaaaaaa'), webp(REAL));
  site.images.set(url('Mordred', 'bbbbbbbbbbbbbbbb'), webp(SMALL));
  const failed = { status: 'failed' };
  for (const [key, image] of [
    ['../escape', url('Venom', 'aaaaaaaaaaaaaaaa')],
    ['Venom', url('Other', 'aaaaaaaaaaaaaaaa')],
    ['Venom', 'https://evil.example/card_variant_images/Venom-aaaa.webp'],
    ['Venom', 'http://game-assets.snap.fan/card_variant_images/Venom-aaaa.webp'],
    ['Venom', url('Venom', 'aaaa') + '?x=1'],
    ['Venom', url('Venom', 'AAAA')],
    ['Venom', ASSETS + 'Venom-aaaa.png'],
    ['Venom', url('Venom_02', 'aaaa')],
    ['Venom', null],
    [null, url('Venom', 'aaaa')],
  ])
    assert.deepEqual(await site.art.refresh(key, image), failed);
  assert.equal(site.requests.length, 0);
  assert.deepEqual(await site.art.refresh('Venom', url('Venom', 'aaaaaaaaaaaaaaaa')), {
    status: 'downloaded',
  });
  assert.deepEqual(await site.art.refresh('Mordred', url('Mordred', 'bbbbbbbbbbbbbbbb')), {
    status: 'placeholder',
  });
  assert.equal(site.requests.length, 2);
  assert.equal((await site.record('Venom')).page, 'https://snap.fan/cards/Venom/');
  assert.equal((await site.record('Mordred')).placeholder, true);
  site.advance(DAY);
  assert.deepEqual(await site.art.refresh('Venom', url('Venom', 'aaaaaaaaaaaaaaaa')), {
    status: 'unchanged',
    placeholder: false,
  });
  assert.deepEqual(await site.art.refresh('Mordred', url('Mordred', 'bbbbbbbbbbbbbbbb')), {
    status: 'unchanged',
    placeholder: true,
  });
  assert.equal(site.requests.length, 2);
  assert.equal((await site.record('Venom')).checked, '2026-11-11T12:00:00.000Z');
  // The fresh image is served by get() without a fetch.
  assert.match(await site.art.get('Venom'), /\/Venom\.webp\?v=aaaaaaaaaaaa$/);
  assert.equal(await site.art.get('Mordred'), null);
  assert.equal(site.requests.length, 2);
  // A changed URL downloads again, a fetch error fails without throwing.
  site.images.set(url('Mordred', 'cccccccccccccccc'), webp(REAL, 'm'));
  assert.deepEqual(await site.art.refresh('Mordred', url('Mordred', 'cccccccccccccccc')), {
    status: 'downloaded',
  });
  assert.match(await site.art.get('Mordred'), /\/Mordred\.webp\?v=cccccccccccc$/);
  assert.deepEqual(await site.art.refresh('Toad', url('Toad', 'dddddddddddddddd')), failed);
  site.offline = true;
  assert.deepEqual(await site.art.refresh('Toad', url('Toad', 'eeeeeeeeeeeeeeee')), failed);
});

test('a concurrent get and refresh for the same key download once', async (t) => {
  const site = await fixture(t);
  site.card('Venom', 'aaaaaaaaaaaaaaaa', webp(REAL));
  const [src, result, again] = await Promise.all([
    site.art.get('Venom'),
    site.art.refresh('Venom', ASSETS + 'Venom-aaaaaaaaaaaaaaaa.webp'),
    site.art.refresh('Venom', ASSETS + 'Venom-aaaaaaaaaaaaaaaa.webp'),
  ]);
  assert.match(src, /\/Venom\.webp\?v=aaaaaaaaaaaa$/);
  assert.deepEqual(result, { status: 'unchanged', placeholder: false });
  assert.deepEqual(again, result);
  assert.equal(site.count('image'), 1);
});

test('a rule change reaches cached images when the URL is unchanged', async (t) => {
  const site = await fixture(t);
  const bytes = webp(REAL, 'k');
  site.card('Venom', 'aaaaaaaaaaaaaaaa', bytes);
  site.card('Toad', 'bbbbbbbbbbbbbbbb', bytes);
  assert.match(await site.art.get('Venom'), /\/Venom\.webp\?v=aaaaaaaaaaaa$/);
  await site.art.get('Toad');
  assert.equal((await site.record('Venom')).placeholder, false);
  // The same bytes become a known placeholder later.
  const stricter = new CardArt(site.directory, {
    now: () => site.advance(0),
    placeholderHashes: new Set([sha256(bytes)]),
  });
  site.advance(8 * DAY);
  site.requests.length = 0;
  assert.equal(await stricter.get('Venom'), null);
  assert.equal(site.count('page'), 1);
  assert.equal(site.count('image'), 0);
  const record = await site.record('Venom');
  assert.equal(record.placeholder, true);
  assert.equal(record.checked, '2026-11-18T12:00:00.000Z');
  assert.deepEqual(await stricter.refresh('Toad', ASSETS + 'Toad-bbbbbbbbbbbbbbbb.webp'), {
    status: 'unchanged',
    placeholder: true,
  });
  assert.equal(site.count('image'), 0);
  // A missing file with an unchanged URL is downloaded again.
  await fs.rm(path.join(site.directory, 'Toad.webp'));
  assert.deepEqual(await site.art.refresh('Toad', ASSETS + 'Toad-bbbbbbbbbbbbbbbb.webp'), {
    status: 'downloaded',
  });
  assert.equal(site.count('image'), 1);
});

test('refresh followed at once by get downloads the image once and scrapes no page', async (t) => {
  const site = await fixture(t);
  site.card('Venom', 'aaaaaaaaaaaaaaaa', webp(REAL));
  const [result, src] = await Promise.all([
    site.art.refresh('Venom', ASSETS + 'Venom-aaaaaaaaaaaaaaaa.webp'),
    site.art.get('Venom'),
  ]);
  assert.deepEqual(result, { status: 'downloaded' });
  assert.match(src, /\/Venom\.webp\?v=aaaaaaaaaaaa$/);
  assert.equal(site.count('image'), 1);
  assert.equal(site.count('page'), 0);
});

test('atomic writes leave no temporary files', async (t) => {
  const site = await fixture(t);
  site.card('Venom', 'aaaaaaaaaaaaaaaa', webp(REAL));
  await site.art.get('Venom');
  const names = await fs.readdir(site.directory);
  assert.deepEqual(names.sort(), ['Venom.source.json', 'Venom.webp']);
});

const MINUTE = 60 * 1000;

test('a failed check backs off: no further fetches until retryDelay, and cached real art is served', async (t) => {
  const site = await fixture(t);
  site.card('Venom', 'aaaaaaaaaaaaaaaa', webp(REAL));
  site.card('Mordred', 'bbbbbbbbbbbbbbbb', webp(SMALL));
  const venom = await site.art.get('Venom');
  await site.art.get('Mordred');
  site.advance(8 * DAY);
  site.offline = true;
  site.requests.length = 0;
  assert.equal(await site.art.get('Venom'), venom);
  assert.equal(await site.art.get('Mordred'), null);
  assert.equal(site.requests.length, 2);
  for (let i = 0; i < 5; i++) {
    site.advance(MINUTE);
    assert.equal(await site.art.get('Venom'), venom);
    assert.equal(await site.art.get('Mordred'), null);
  }
  assert.equal(site.requests.length, 2);
  // After retryDelay the next get() tries again, and a failure restarts the backoff.
  site.advance(5 * MINUTE);
  assert.equal(await site.art.get('Venom'), venom);
  assert.equal(site.requests.length, 3);
  assert.equal(await site.art.get('Venom'), venom);
  assert.equal(site.requests.length, 3);
  // A success clears the backoff: the page is back and the art changed.
  site.offline = false;
  site.advance(11 * MINUTE);
  site.card('Venom', '0123456789abcdef', webp(REAL, 'n'));
  assert.match(await site.art.get('Venom'), /\/Venom\.webp\?v=0123456789ab$/);
  assert.equal(site.art.failedAt.has('Venom'), false);
});

test('a card with no file and a failing page makes one fetch, not one per get', async (t) => {
  const site = await fixture(t);
  for (let i = 0; i < 4; i++) assert.equal(await site.art.get('Nothing'), null);
  assert.equal(site.requests.length, 1);
  site.advance(10 * MINUTE);
  assert.equal(await site.art.get('Nothing'), null);
  assert.equal(site.requests.length, 2);
  // The page works again after the backoff, and a success clears it.
  site.advance(10 * MINUTE);
  site.card('Nothing', 'aaaaaaaaaaaaaaaa', webp(REAL));
  assert.match(await site.art.get('Nothing'), /\/Nothing\.webp\?v=aaaaaaaaaaaa$/);
  assert.equal(site.art.failedAt.has('Nothing'), false);
});

test('a failed variant backs off its own key only, and the base still loads', async (t) => {
  const site = await fixture(t);
  site.card('Venom', 'aaaaaaaaaaaaaaaa', webp(REAL));
  const base = await site.art.get('Venom');
  assert.equal(await site.art.get('Venom', 'Venom_99'), base);
  assert.equal(site.art.failedAt.has('Venom_99'), true);
  assert.equal(site.art.failedAt.has('Venom'), false);
  const count = site.requests.length;
  assert.equal(await site.art.get('Venom', 'Venom_99'), base);
  assert.equal(site.requests.length, count);
});

test('refresh makes no fetch during a backoff, and an unchanged URL clears it', async (t) => {
  const site = await fixture(t);
  const url = ASSETS + 'Venom-aaaaaaaaaaaaaaaa.webp';
  site.images.set(url, webp(REAL));
  // A failed get() (no page) starts the backoff for this key.
  assert.equal(await site.art.get('Venom'), null);
  site.requests.length = 0;
  assert.deepEqual(await site.art.refresh('Venom', url), { status: 'failed' });
  assert.equal(site.requests.length, 0);
  site.advance(10 * MINUTE);
  assert.deepEqual(await site.art.refresh('Venom', url), { status: 'downloaded' });
  assert.equal(site.requests.length, 1);
  // A failed refresh starts the backoff too, and get() then skips the network.
  site.advance(DAY * 8);
  site.offline = true;
  const other = ASSETS + 'Venom-bbbbbbbbbbbbbbbb.webp';
  assert.deepEqual(await site.art.refresh('Venom', other), { status: 'failed' });
  assert.equal(site.requests.length, 2);
  assert.deepEqual(await site.art.refresh('Venom', other), { status: 'failed' });
  assert.match(await site.art.get('Venom'), /\/Venom\.webp\?v=aaaaaaaaaaaa$/);
  assert.equal(site.requests.length, 2);
  // The unchanged URL needs no network and clears the backoff.
  assert.deepEqual(await site.art.refresh('Venom', url), {
    status: 'unchanged',
    placeholder: false,
  });
  assert.equal(site.art.failedAt.has('Venom'), false);
});

test('the backoff map is bounded', async (t) => {
  const site = await fixture(t);
  site.offline = true;
  for (let i = 0; i < 600; i++) assert.equal(await site.art.get('Card' + i), null);
  assert.equal(site.art.failedAt.size, 512);
  assert.equal(site.art.failedAt.has('Card0'), false);
  assert.equal(site.art.failedAt.has('Card599'), true);
  // Expired entries go first when the map is full.
  site.advance(11 * MINUTE);
  assert.equal(await site.art.get('Later'), null);
  assert.deepEqual([...site.art.failedAt.keys()], ['Later']);
});

test('a backward clock step does not lengthen the backoff or hide a due check', async (t) => {
  const site = await fixture(t);
  site.offline = true;
  assert.equal(await site.art.get('Nothing'), null);
  assert.equal(site.requests.length, 1);
  site.advance(-HOUR);
  assert.equal(await site.art.get('Nothing'), null);
  assert.equal(site.requests.length, 2);
  // A record checked in the future is due.
  site.offline = false;
  site.card('Venom', 'aaaaaaaaaaaaaaaa', webp(REAL));
  const venom = await site.art.get('Venom');
  site.requests.length = 0;
  assert.equal(await site.art.get('Venom'), venom);
  assert.equal(site.requests.length, 0);
  site.advance(-DAY);
  assert.equal(await site.art.get('Venom'), venom);
  assert.equal(site.count('page'), 1);
  assert.equal((await site.record('Venom')).checked, '2026-11-09T11:00:00.000Z');
});

test('jobs rejected by a full queue are not backed off', async (t) => {
  const site = await fixture(t);
  let release;
  site.gate = new Promise((resolve) => (release = resolve));
  site.offline = true;
  const keys = Array.from({ length: 70 }, (_, i) => 'Card' + i);
  let settled = 0;
  const results = Promise.all(keys.map((key) => site.art.get(key).finally(() => settled++)));
  // Release only once every call reached the queue: 64 waiting behind the gate and the
  // 3 rejections already settled. Releasing earlier lets late calls in, which made this flaky.
  while (settled < 3 || site.art.queue.waiting.length < 64)
    await new Promise((resolve) => setImmediate(resolve));
  release();
  assert.deepEqual(await results, Array(70).fill(null));
  // 3 running and 64 waiting were accepted and failed; the other 3 were rejected.
  assert.equal(site.requests.length, 67);
  const rejected = keys.filter((key) => !site.art.failedAt.has(key));
  assert.equal(rejected.length, 3);
  site.gate = null;
  assert.equal(await site.art.get(rejected[0]), null);
  assert.equal(site.requests.length, 68);
});
