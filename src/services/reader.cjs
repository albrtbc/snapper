const fs = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Worker } = require('node:worker_threads');
const { parseSnapshot, readDecks } = require('../core/snapshot.cjs');
const { Tracker } = require('../core/tracker.cjs');
const UNSUPPORTED_MESSAGE =
  'Unsupported Marvel Snap build. Live tracking is off until Snapper is updated.';
const BLOCKED = ['unsupported', 'denied'];
const readJson = async (file) =>
  JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
class StateReader extends EventEmitter {
  constructor(directory, interval = 500) {
    super();
    this.directory = directory;
    this.interval = interval;
    this.tracker = new Tracker();
    this.cache = new Map();
    this.stopped = true;
    this.startedAt = Date.now();
    this.retiredGames = new Set();
    this.runId = 0;
    // Last report from the live worker: null until the first message and on
    // platforms without a live reader.
    this.liveStatus = null;
    this.baseMessage = directory
      ? 'Waiting for Marvel Snap files'
      : 'Snap folder not found. Select it in Settings.';
    this.state = {
      status: 'waiting',
      message: this.baseMessage,
      match: null,
      decks: [],
      live: null,
    };
  }
  // Unsupported builds and denied access are not transient. A blocked live
  // reader is the most actionable reason, so its message replaces the file
  // messages (and file errors) instead of staying silent.
  liveMessage() {
    const live = this.liveStatus;
    return live?.ok === false && BLOCKED.includes(live.code) ? live.message : null;
  }
  emitState(next) {
    this.baseMessage = next.message;
    this.state = {
      ...next,
      message: this.liveMessage() ?? next.message,
      live: this.liveStatus,
    };
    this.emit('state', this.state);
  }
  setLiveStatus(result) {
    const old = this.liveStatus;
    // The message is display-ready. Transient codes carry text that nothing
    // shows, so only a blocked reader's message counts as a change.
    this.liveStatus = result.ok
      ? { ok: true }
      : {
          ok: false,
          code: result.code,
          message: result.code === 'unsupported' ? UNSUPPORTED_MESSAGE : result.message,
        };
    return (
      old?.ok !== this.liveStatus.ok ||
      old?.code !== this.liveStatus.code ||
      (BLOCKED.includes(this.liveStatus.code) && old?.message !== this.liveStatus.message)
    );
  }
  async readCached(name) {
    const file = path.join(this.directory, name + '.json');
    const stat = await fs.stat(file);
    if (stat.size > 64 * 1024 * 1024) throw new Error('State file exceeds 64 MiB');
    const signature = `${stat.mtimeMs}:${stat.size}`;
    const old = this.cache.get(name);
    if (old?.signature === signature) return { ...old, changed: false };
    const data = await readJson(file);
    // Do not cache partial writes or snapshots changed during the read.
    const after = await fs.stat(file);
    if (after.mtimeMs !== stat.mtimeMs || after.size !== stat.size)
      throw new Error('File is being updated');
    const entry = { signature, data, mtime: stat.mtimeMs };
    this.cache.set(name, entry);
    return { ...entry, changed: true };
  }
  async poll(runId = this.runId) {
    if (!this.directory) return;
    try {
      const [game, collection, play] = await Promise.all([
        this.readCached('GameState').catch((error) => ({ error })),
        this.readCached('CollectionState').catch(() => null),
        this.readCached('PlayState').catch(() => null),
      ]);
      if (runId !== this.runId) return;
      const decks = collection ? readDecks(collection.data) : [];
      const selected = decks.find((d) => d.id === play?.data.SerializedSelectedDeckId) || null;
      this.decks = decks;
      this.selected = selected;
      if (this.live?.ok && Date.now() - this.live.updatedAt < 2000) {
        this.publishLive();
        return;
      }
      if (game.error) throw game.error;
      // A file saved before the latest live read must never rewind the match.
      if (this.lastLiveAt && game.mtime < this.lastLiveAt) return;
      if (game.changed || collection?.changed || play?.changed || this.state.status === 'error') {
        const parsed = parseSnapshot(game.data, selected);
        // Saved files can outlive the game process and be rewritten in the
        // lobby. On Linux only live memory can establish an active match;
        // files may supplement that same match, never start or revive one.
        const eligible =
          parsed &&
          !this.retiredGames.has(parsed.gameId) &&
          (process.platform === 'linux'
            ? parsed.gameId === this.state.match?.gameId
            : game.mtime >= this.startedAt);
        const match = eligible ? this.updateMatch(parsed) : this.state.match;
        this.emitState({
          status: match ? 'snapshot' : 'waiting',
          message: match ? 'Latest state saved by Snap' : 'Waiting for a match',
          updatedAt: game.mtime,
          match,
          decks,
          selectedDeck: selected,
        });
      }
    } catch (error) {
      if (runId !== this.runId) return;
      this.emitState({
        ...this.state,
        status: 'error',
        message:
          error.code === 'ENOENT'
            ? 'GameState.json not found. Check the folder.'
            : 'Snap is writing data or the file is invalid. Retrying.',
      });
    }
  }
  updateMatch(parsed) {
    if (parsed && this.retiredGames.has(parsed.gameId)) return this.state.match;
    // Results still belong to the game screen. Only leaving that screen
    // clears the cards, so they remain available while collecting rewards.
    if (!parsed) {
      if (this.tracker.gameId) this.retiredGames.add(this.tracker.gameId);
      return this.tracker.update(null);
    }
    return this.tracker.update(parsed);
  }
  publishLive() {
    if (!this.live?.ok) return;
    this.lastLiveAt = this.live.updatedAt;
    let match;
    try {
      const parsed =
        !this.live.lobby && this.live.raw ? parseSnapshot(this.live.raw, this.selected) : null;
      if (!this.live.lobby && !parsed) throw Error('Incomplete live snapshot');
      match = this.updateMatch(parsed);
    } catch {
      // A torn read must not escape the worker message handler or erase known
      // cards from this match. Do clear them when the next match is starting.
      const gameId = this.live.raw?.RemoteGame?.GameState?.Id;
      const changingMatch = gameId && gameId !== this.state.match?.gameId;
      if (changingMatch) this.tracker.reset();
      this.emitState({
        ...this.state,
        status: 'error',
        message: 'Syncing match. Retrying…',
        match: changingMatch ? null : this.state.match,
      });
      return;
    }
    this.emitState({
      status: this.live.lobby ? 'lobby' : 'live',
      message: this.live.lobby ? 'In the lobby' : match ? 'Live game data' : 'Waiting for a match',
      updatedAt: this.live.updatedAt,
      match,
      decks: this.decks || [],
      selectedDeck: this.selected || null,
    });
  }
  handleLive(result) {
    this.live = result;
    const changed = this.setLiveStatus(result);
    if (result.ok) this.publishLive();
    else if (['live', 'lobby'].includes(this.state.status))
      this.emitState({
        ...this.state,
        status: 'error',
        message: 'Reading interrupted. Retrying.',
      });
    else if (changed) this.emitState({ ...this.state, message: this.baseMessage });
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    const runId = ++this.runId;
    if (process.platform === 'linux') {
      // Worker bootstrap uses Node's filesystem and cannot enter Electron's
      // virtual ASAR archive. Ship this entry and its module unpacked.
      const workerPath = path
        .join(__dirname, 'live-worker.cjs')
        .replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
      this.worker = new Worker(workerPath);
      this.worker.on('message', (result) => {
        if (runId === this.runId) this.handleLive(result);
      });
      this.worker.on('error', () => {
        if (runId !== this.runId) return;
        this.live = null;
        this.setLiveStatus({
          ok: false,
          code: 'retrying',
          message: 'Live reading unavailable. Waiting to reconnect.',
        });
        this.emitState({
          ...this.state,
          status: 'error',
          message: this.liveStatus.message,
        });
      });
    }
    const tick = async () => {
      await this.poll(runId);
      if (!this.stopped && runId === this.runId) this.timer = setTimeout(tick, this.interval);
    };
    tick();
  }
  stop() {
    this.stopped = true;
    this.runId++;
    clearTimeout(this.timer);
    this.worker?.terminate();
    this.worker = null;
  }
}
module.exports = { StateReader, readJson };
