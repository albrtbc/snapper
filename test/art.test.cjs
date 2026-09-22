const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs/promises'),
  os = require('node:os'),
  path = require('node:path');
const { CardArt } = require('../src/services/art.cjs');
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
  const art = new CardArt(directory),
    base = await art.get('Venom'),
    variant = await art.get('Venom', 'Venom_02');
  assert.match(base, /\/Venom\.webp$/);
  assert.match(variant, /\/Venom_02\.webp$/);
  assert.notEqual(base, variant);
  assert.equal(await art.get('Venom'), base);
  assert.equal(await art.get('Venom', 'Venom_99'), base);
  assert.equal(await art.get('../escape', 'Venom_02'), null);
  const count = requests.length;
  assert.equal(await art.get('Venom', '../../escape'), base);
  assert.equal(await art.get('Venom', 'Other_01'), base);
  assert.equal(requests.length, count);
  const offline = new CardArt(directory);
  assert.equal(await offline.get('Venom', 'Venom_02'), variant);
  assert.equal(requests.length, count);
});
