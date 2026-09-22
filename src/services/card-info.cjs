const fs = require('node:fs/promises');
const path = require('node:path');
const { fetchPage } = require('./http.cjs');
const { TaskQueue } = require('./task-queue.cjs');
const SAFE_ID = /^[A-Za-z0-9_]{1,100}$/;
function abilityFromPage(html) {
  // Current ability block, before the historical balance-change table.
  const raw = html.match(
    /<p\b[^>]*class="[^"]*leading-relaxed\s+text-snap-gray-100[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
  )?.[1];
  if (raw === undefined) return null;
  const text = raw
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => {
      const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return n <= 0x10ffff ? String.fromCodePoint(n) : '';
    })
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp);/g,
      (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[name],
    )
    .replace(/[ \t]+/g, ' ')
    .trim();
  return text && text.length < 4000 ? text : null;
}
function costFromPage(html) {
  const value = html.match(/<dt\b[^>]*>\s*Cost\s*<\/dt>\s*<dd\b[^>]*>\s*(\d+)\s*<\/dd>/i)?.[1];
  return value === undefined ? null : Number(value);
}
class CardInfo {
  constructor(directory) {
    this.directory = directory;
    this.pending = new Map();
    this.queue = new TaskQueue();
  }
  get(id) {
    if (typeof id !== 'string' || !SAFE_ID.test(id)) return Promise.resolve(null);
    if (this.pending.has(id)) return this.pending.get(id);
    const task = this.load(id)
      .catch(() => null)
      .finally(() => this.pending.delete(id));
    this.pending.set(id, task);
    return task;
  }
  async load(id) {
    const file = path.join(this.directory, id + '.json');
    let cached;
    try {
      cached = JSON.parse(await fs.readFile(file, 'utf8'));
      if (
        typeof cached.text === 'string' &&
        Number.isFinite(cached.baseCost) &&
        Date.now() - cached.retrievedAt < 86400000
      )
        return cached;
    } catch {}
    try {
      return await this.queue.run(async () => {
        const source = `https://snap.fan/cards/${encodeURIComponent(id)}/`;
        const html = await fetchPage(source),
          text = abilityFromPage(html),
          baseCost = costFromPage(html);
        if (!text) throw Error('Ability text unavailable');
        const info = { text, baseCost, source, language: 'en', retrievedAt: Date.now() };
        await fs.mkdir(this.directory, { recursive: true });
        await fs.writeFile(file + '.tmp', JSON.stringify(info));
        await fs.rename(file + '.tmp', file);
        return info;
      });
    } catch {
      return typeof cached?.text === 'string' && cached.text.length < 4000 ? cached : null;
    }
  }
}
module.exports = { CardInfo, abilityFromPage, costFromPage };
