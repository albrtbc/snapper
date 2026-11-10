const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { decodeEntities } = require('./card-info.cjs');
const { fetchPage: defaultFetchPage } = require('./http.cjs');
const SAFE_ID = /^[A-Za-z0-9_]{1,100}$/;
const RELEASED_PAGE = 'https://snap.fan/cards/';
const UPCOMING_PAGE = 'https://snap.fan/cards/upcoming/';
// End of the tag that starts at `from`: a '>' inside a quoted attribute value (the
// data-card-search text holds <b>) does not close it.
function tagEnd(html, from) {
  let quote = '';
  for (let i = from; i < html.length; i++) {
    const c = html[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i;
  }
  return html.length;
}
function attributes(tag) {
  const result = new Map();
  for (const m of tag.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g))
    if (!result.has(m[1])) result.set(m[1], m[2] ?? m[3] ?? m[4] ?? '');
  return result;
}
const integer = (value) => (/^-?\d+$/.test(value ?? '') ? Number(value) : null);
const text = (value) => decodeEntities(value ?? '').trim() || null;
// Reads Snap.fan's card list markup as data: nothing in the page is executed or followed.
function parseCardList(html) {
  const cells = [];
  // Resume after each tag, so every character is scanned once even in hostile markup.
  let next = 0;
  for (let start = html.indexOf('<div'); start !== -1; start = html.indexOf('<div', next)) {
    const end = tagEnd(html, start);
    next = end + 1;
    const attrs = attributes(html.slice(start + 4, end));
    if (!/(^|\s)card-grid__cell(\s|$)/.test(attrs.get('class') ?? '')) continue;
    cells.push({ attrs, start, end });
  }
  const cards = [];
  const seen = new Set();
  cells.forEach(({ attrs, end }, index) => {
    const key = attrs.get('data-card-key') ?? '';
    if (!SAFE_ID.test(key) || seen.has(key)) return;
    seen.add(key);
    const block = html.slice(end, index + 1 < cells.length ? cells[index + 1].start : undefined);
    const release = attrs.get('data-card-release');
    cards.push({
      key,
      name: text(attrs.get('data-card-name')) ?? key,
      cost: integer(attrs.get('data-card-cost')),
      power: integer(attrs.get('data-card-power')),
      type: text(attrs.get('data-card-type')),
      release: /^\d{4}-\d{2}-\d{2}$/.test(release ?? '') ? release : null,
      image:
        block.match(
          new RegExp(
            `https://game-assets\\.snap\\.fan/card_variant_images/${key}-[a-f0-9]+\\.webp`,
          ),
        )?.[0] ?? null,
    });
  });
  return cards;
}
// The card list plus its base art. Snap.fan lists every card on two public pages, so a
// full update is two page requests plus the images that are new or changed.
class CardPool {
  constructor(file, art, { fetchPage = defaultFetchPage, now = Date.now, batchSize = 32 } = {}) {
    this.file = file;
    this.art = art;
    this.fetchPage = fetchPage;
    this.now = now;
    this.batchSize = batchSize;
    this.running = null;
  }
  update({ onProgress } = {}) {
    this.running ||= this.run(onProgress).finally(() => {
      this.running = null;
    });
    return this.running;
  }
  async run(onProgress) {
    // Both pages or nothing: a failure leaves the previous card-pool.json untouched.
    const [released, upcoming] = await Promise.all(
      [RELEASED_PAGE, UPCOMING_PAGE].map(async (page) => parseCardList(await this.fetchPage(page))),
    );
    if (!released.length) throw new Error('No cards found on the Snap.fan card list');
    const merged = new Map();
    for (const card of [...upcoming, ...released]) merged.set(card.key, card);
    const cards = [...merged.values()];
    await this.write({ retrievedAt: this.now(), cards });
    const withImage = cards.filter((card) => card.image);
    const summary = {
      cards,
      downloaded: 0,
      unchanged: 0,
      placeholders: [],
      failed: [],
      noImage: cards.length - withImage.length,
    };
    for (let i = 0; i < withImage.length; i += this.batchSize) {
      const batch = withImage.slice(i, i + this.batchSize);
      const results = await Promise.all(
        batch.map((card) =>
          this.art.refresh(card.key, card.image).catch(() => ({ status: 'failed' })),
        ),
      );
      results.forEach((result, n) => {
        const key = batch[n].key;
        if (result?.status === 'downloaded') summary.downloaded++;
        else if (result?.status === 'unchanged' && !result.placeholder) summary.unchanged++;
        else if (result?.status === 'unchanged' || result?.status === 'placeholder')
          summary.placeholders.push(key);
        else summary.failed.push(key);
      });
      try {
        onProgress?.({ done: i + batch.length, total: withImage.length });
      } catch {}
    }
    return summary;
  }
  async write(data) {
    const tmp = `${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      await fs.writeFile(tmp, JSON.stringify(data));
      await fs.rename(tmp, this.file);
    } catch (error) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw error;
    }
  }
  async isDue(maxAge = 7 * 24 * 3600 * 1000) {
    try {
      const { retrievedAt } = JSON.parse(await fs.readFile(this.file, 'utf8'));
      return !(this.now() - retrievedAt < maxAge);
    } catch {
      return true;
    }
  }
}
module.exports = { CardPool, parseCardList };
