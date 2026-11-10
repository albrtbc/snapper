const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fetchBytes, fetchPage } = require('./http.cjs');
const { TaskQueue } = require('./task-queue.cjs');
const SAFE_ID = /^[A-Za-z0-9_]{1,100}$/;
const MAX_BYTES = 3000000;
// Snap.fan serves the generic grey 0/0 SNAP back (18,248 B) for cards without art.
const KNOWN_PLACEHOLDERS = new Set([
  '3d389018dc5376ac3a1b8439770c42006f8c6609bed2953c4477eb076a1e59e8',
]);
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
// Heuristic: the unfinished tiles are small, and every real image is much larger.
function isPlaceholder(
  bytes,
  { placeholderBytes = 24000, placeholderHashes = KNOWN_PLACEHOLDERS } = {},
) {
  return bytes.length < placeholderBytes || placeholderHashes.has(sha256(bytes));
}
const sourceVersion = (source) =>
  typeof source === 'string' ? source.match(/-([a-f0-9]+)\.webp$/)?.[1].slice(0, 12) : undefined;
// Snap.fan hashes image filenames. Resolve the requested art from its public
// card page, cache locally, and never send game/account data.
class CardArt {
  constructor(
    directory,
    {
      placeholderBytes = 24000,
      placeholderHashes = KNOWN_PLACEHOLDERS,
      realTtl = 7 * 24 * 3600 * 1000,
      placeholderTtl = 6 * 3600 * 1000,
      now = Date.now,
    } = {},
  ) {
    this.directory = directory;
    this.rules = { placeholderBytes, placeholderHashes };
    this.realTtl = realTtl;
    this.placeholderTtl = placeholderTtl;
    this.now = now;
    this.pending = new Map();
    this.refreshing = new Map();
    this.queue = new TaskQueue();
    this.bulkQueue = new TaskQueue(2);
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
  timestamp() {
    return new Date(this.now()).toISOString();
  }
  imageUrl(key, version) {
    return pathToFileURL(path.join(this.directory, key + '.webp')).href + '?v=' + version;
  }
  // Unique temporary names: the card pool CLI may write to the live cache while the app runs.
  async writeAtomic(file, data) {
    const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.mkdir(this.directory, { recursive: true });
    try {
      await fs.writeFile(tmp, data);
      await fs.rename(tmp, file);
    } catch (error) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw error;
    }
  }
  writeRecord(key, record) {
    return this.writeAtomic(
      path.join(this.directory, key + '.source.json'),
      JSON.stringify(record, null, 2),
    );
  }
  // The source URL is unchanged: classify the cached bytes again, so a changed rule reaches
  // images already cached, and record the check. Returns null when the file is gone.
  async recheck(key, cached) {
    let bytes;
    try {
      bytes = await fs.readFile(path.join(this.directory, key + '.webp'));
    } catch {
      return null;
    }
    const placeholder = isPlaceholder(bytes, this.rules);
    await this.writeRecord(key, { ...cached.record, placeholder, checked: this.timestamp() });
    return { placeholder, version: cached.version };
  }
  // Reads the cached image's record. Legacy records, and files without a record, are
  // classified from the cached bytes: no network. Returns null when no image is cached.
  async inspect(key) {
    const target = path.join(this.directory, key + '.webp');
    let record = null;
    try {
      const parsed = JSON.parse(
        await fs.readFile(path.join(this.directory, key + '.source.json'), 'utf8'),
      );
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) record = parsed;
    } catch {}
    const known = typeof record?.placeholder === 'boolean';
    let version = sourceVersion(record?.source);
    let bytes = null;
    try {
      if (known && version) await fs.access(target);
      else bytes = await fs.readFile(target);
    } catch {
      return null;
    }
    if (!known) {
      record = {
        ...record,
        rights: record?.rights ?? 'Marvel / Second Dinner; served by Snap.fan',
        placeholder: isPlaceholder(bytes, this.rules),
      };
      await this.writeRecord(key, record).catch(() => {});
    }
    version ||= sha256(bytes).slice(0, 12);
    return { record, version, placeholder: record.placeholder };
  }
  due(cached) {
    const age = this.now() - Date.parse(cached.record.checked);
    return !(age < (cached.placeholder ? this.placeholderTtl : this.realTtl));
  }
  // Downloads and validates one image, then stores it and its record atomically.
  async download(key, source, page) {
    const bytes = await fetchBytes(source, {
      maxBytes: MAX_BYTES,
      contentType: /^image\/webp$/,
    });
    if (
      bytes.length > MAX_BYTES ||
      bytes.toString('ascii', 0, 4) !== 'RIFF' ||
      bytes.toString('ascii', 8, 12) !== 'WEBP'
    )
      throw new Error('Unexpected image');
    const placeholder = isPlaceholder(bytes, this.rules);
    await this.writeAtomic(path.join(this.directory, key + '.webp'), bytes);
    const stamp = this.timestamp();
    await this.writeRecord(key, {
      source,
      page,
      retrieved: stamp,
      rights: 'Marvel / Second Dinner; served by Snap.fan',
      placeholder,
      checked: stamp,
    });
    return { placeholder, version: sourceVersion(source) };
  }
  async load(id, key) {
    await this.refreshing.get(key)?.catch(() => {});
    const cached = await this.inspect(key);
    if (cached && !this.due(cached))
      return cached.placeholder ? null : this.imageUrl(key, cached.version);
    // Offline reuse applies to real images only; a placeholder is never served.
    const fallback = cached && !cached.placeholder ? this.imageUrl(key, cached.version) : null;
    try {
      return await this.queue.run(async () => {
        const page = `https://snap.fan/cards/${encodeURIComponent(id)}/${key === id ? '' : encodeURIComponent(key) + '/'}`;
        const html = await fetchPage(page);
        const match = html.match(
          new RegExp(
            `https://game-assets\\.snap\\.fan/card_variant_images/${key}-[a-f0-9]+\\.webp`,
          ),
        );
        if (!match) throw new Error('No art on the card page');
        const same = cached?.record.source === match[0] && (await this.recheck(key, cached));
        if (same) return same.placeholder ? null : this.imageUrl(key, same.version);
        const result = await this.download(key, match[0], page);
        return result.placeholder ? null : this.imageUrl(key, result.version);
      });
    } catch {
      return fallback;
    }
  }
  // Used by the card pool: the list page already gives the base image URL, so the card
  // page is not scraped. Never throws.
  refresh(key, imageUrl) {
    if (
      typeof key !== 'string' ||
      !SAFE_ID.test(key) ||
      typeof imageUrl !== 'string' ||
      !new RegExp(
        `^https://game-assets\\.snap\\.fan/card_variant_images/${key}-[a-f0-9]+\\.webp$`,
      ).test(imageUrl)
    )
      return Promise.resolve({ status: 'failed' });
    if (this.refreshing.has(key)) return this.refreshing.get(key);
    const job = (async () => {
      // Let a concurrent get() for this key finish first, so it is not downloaded twice.
      await this.pending.get(key)?.catch(() => {});
      try {
        const cached = await this.inspect(key);
        const same = cached?.record.source === imageUrl && (await this.recheck(key, cached));
        if (same) return { status: 'unchanged', placeholder: same.placeholder };
        // Its own queue: a bulk update must not delay on-screen art behind its queued jobs.
        const result = await this.bulkQueue.run(() =>
          this.download(key, imageUrl, `https://snap.fan/cards/${key}/`),
        );
        return { status: result.placeholder ? 'placeholder' : 'downloaded' };
      } catch {
        return { status: 'failed' };
      }
    })().finally(() => this.refreshing.delete(key));
    this.refreshing.set(key, job);
    return job;
  }
}
module.exports = { CardArt, isPlaceholder, KNOWN_PLACEHOLDERS };
