const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fetchBytes, fetchPage } = require('./http.cjs');
const { TaskQueue } = require('./task-queue.cjs');
const SAFE_ID = /^[A-Za-z0-9_]{1,100}$/;
// Snap.fan hashes image filenames. Resolve the requested art from its public
// card page, cache locally, and never send game/account data.
class CardArt {
  constructor(directory) {
    this.directory = directory;
    this.pending = new Map();
    this.queue = new TaskQueue();
  }
  async get(id, variantId = null) {
    if (typeof id !== 'string' || !SAFE_ID.test(id)) return null;
    const key =
      typeof variantId === 'string' && SAFE_ID.test(variantId) && variantId.startsWith(id + '_')
        ? variantId
        : id;
    if (this.pending.has(key)) return this.pending.get(key);
    const task = this.load(id, key)
      .catch(() => null)
      .then((src) => src || (key !== id ? this.get(id) : null))
      .finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }
  async load(id, key) {
    const target = path.join(this.directory, key + '.webp');
    try {
      await fs.access(target);
      return pathToFileURL(target).href;
    } catch {}
    return this.queue.run(async () => {
      const page = `https://snap.fan/cards/${encodeURIComponent(id)}/${key === id ? '' : encodeURIComponent(key) + '/'}`;
      const html = await fetchPage(page);
      const match = html.match(
        new RegExp(`https://game-assets\\.snap\\.fan/card_variant_images/${key}-[a-f0-9]+\\.webp`),
      );
      if (!match) return null;
      const bytes = await fetchBytes(match[0], { maxBytes: 3000000, contentType: /^image\/webp$/ });
      if (
        bytes.length > 3000000 ||
        bytes.toString('ascii', 0, 4) !== 'RIFF' ||
        bytes.toString('ascii', 8, 12) !== 'WEBP'
      )
        return null;
      await fs.mkdir(this.directory, { recursive: true });
      await fs.writeFile(target + '.tmp', bytes);
      await fs.rename(target + '.tmp', target);
      await fs.writeFile(
        path.join(this.directory, key + '.source.json'),
        JSON.stringify(
          {
            source: match[0],
            page,
            retrieved: new Date().toISOString(),
            rights: 'Marvel / Second Dinner; served by Snap.fan',
          },
          null,
          2,
        ),
      );
      return pathToFileURL(target).href;
    });
  }
}
module.exports = { CardArt };
