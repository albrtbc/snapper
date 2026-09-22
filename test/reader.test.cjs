const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { StateReader } = require('../src/services/reader.cjs');
const matchRaw = (id) => ({
  RemoteGame: {
    ClientGameInfo: { LocalPlayerEntityId: 7 },
    GameState: {
      Id: id,
      Turn: 3,
      _players: [
        { EntityId: 7, Deck: { EntityId: 8 }, Hand: {} },
        { EntityId: 2, Deck: { EntityId: 3 }, Hand: {} },
      ],
      _entityIdToEntity: {
        21: {
          $type: 'CubeGame.Card, Logic',
          EntityId: 21,
          CardDefId: 'Morbius',
          Owner: { EntityId: 2 },
          _zone: { ZoneId: 'Graveyard' },
          _previousZone: { ZoneId: 'Hand' },
          StartedInDeckEntityId: 3,
          Revealed: true,
        },
      },
    },
  },
});
const publish = (reader, raw, lobby = false) => {
  reader.live = { ok: true, lobby, raw, updatedAt: Date.now() };
  reader.publishLive();
};
test('stopping during a file read prevents stale state from being published', async () => {
  const reader = new StateReader('/unused');
  let finish;
  reader.readCached = (name) =>
    name === 'GameState' ? new Promise((resolve) => (finish = resolve)) : Promise.resolve(null);
  let publications = 0;
  reader.on('state', () => publications++);
  const poll = reader.poll();
  reader.stop();
  finish({ data: { RemoteGame: {} }, changed: true, mtime: Date.now() });
  await poll;
  assert.equal(publications, 0);
  assert.equal(reader.state.match, null);
});
test('BOM, missing optional files, atomic replacement and retry of a partial JSON', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snapper-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'GameState.json');
  await fs.writeFile(file, '\uFEFF{"RemoteGame":{}}');
  const reader = new StateReader(dir);
  await reader.poll();
  assert.equal(reader.state.status, 'waiting');
  await fs.writeFile(file, '{"RemoteGame":');
  await reader.poll();
  assert.equal(reader.state.status, 'error');
  await fs.writeFile(file + '.tmp', '{"RemoteGame":{}}');
  await fs.rename(file + '.tmp', file);
  await reader.poll();
  assert.equal(reader.state.status, 'waiting');
});
test('fresh live lobby wins over old saved match and partial game writes', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snapper-live-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'GameState.json'), '{unfinished');
  const reader = new StateReader(dir);
  reader.live = { ok: true, lobby: true, raw: null, updatedAt: Date.now() };
  await reader.poll();
  assert.equal(reader.state.status, 'lobby');
  assert.equal(reader.state.match, null);
});
test('a fallback file cannot rewind a newer live read after disconnection', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snapper-live-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'GameState.json'), '{"RemoteGame":{}}');
  const reader = new StateReader(dir);
  reader.lastLiveAt = Date.now() + 1000;
  reader.state = { status: 'error', message: 'Lectura interrumpida', match: { turn: 6 } };
  await reader.poll();
  assert.equal(reader.state.match.turn, 6);
  assert.equal(reader.state.status, 'error');
});
test('second-match transition cannot crash the main thread and recovers on the next complete read', () => {
  const reader = new StateReader(null);
  const raw = (id) => ({
    RemoteGame: {
      ClientGameInfo: { LocalPlayerEntityId: 7 },
      GameState: {
        Id: id,
        Turn: 1,
        _players: [
          { EntityId: 7, Deck: { EntityId: 8 }, Hand: {} },
          { EntityId: 2, Deck: { EntityId: 3 }, Hand: {} },
        ],
        _entityIdToEntity: {},
      },
    },
  });
  const publish = (data) => {
    reader.live = { ok: true, lobby: false, raw: data, updatedAt: Date.now() };
    assert.doesNotThrow(() => reader.publishLive());
  };
  publish(raw('first'));
  assert.equal(reader.state.match.gameId, 'first');
  const firstTime = reader.state.updatedAt;
  const incomplete = raw('first');
  incomplete.RemoteGame.GameState._players[1] = { EntityId: 7 };
  publish(incomplete);
  assert.equal(reader.state.status, 'error');
  assert.equal(reader.state.match.gameId, 'first');
  assert.equal(reader.state.updatedAt, firstTime);
  const second = raw('second');
  second.RemoteGame.GameState._players[1] = { EntityId: 7 };
  publish(second);
  assert.equal(reader.state.match, null);
  publish(raw('second'));
  assert.equal(reader.state.status, 'live');
  assert.equal(reader.state.match.gameId, 'second');
  publish(null);
  assert.equal(reader.state.status, 'error');
  assert.equal(reader.state.match.gameId, 'second');
  publish(raw('second'));
  assert.equal(reader.state.status, 'live');
});
test('startup never displays an old saved opponent, including unfinished matches', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snapper-startup-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'GameState.json');
  const raw = matchRaw('previous');
  await fs.writeFile(file, JSON.stringify(raw));
  await fs.utimes(file, new Date(0), new Date(0));
  const reader = new StateReader(dir);
  await reader.poll();
  assert.equal(reader.state.match, null);
  assert.equal(reader.tracker.seen.size, 0);
  raw.RemoteGame.GameState.ClientResultMessage = { GameId: 'previous' };
  await fs.writeFile(file, JSON.stringify(raw));
  await reader.poll();
  assert.equal(reader.state.match, null);
  publish(reader, matchRaw('current'));
  assert.equal(reader.state.match.opponent.length, 1);
});
test('lobby clears cards and history even with retained raw data; delayed files cannot revive them', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snapper-lobby-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const reader = new StateReader(dir),
    raw = matchRaw('previous');
  raw.RemoteGame.GameState._entityIdToEntity[21]._zone.ZoneId = 'Hand';
  publish(reader, raw);
  raw.RemoteGame.GameState._entityIdToEntity[21]._zone.ZoneId = 'Graveyard';
  publish(reader, raw);
  assert.equal(reader.state.match.opponent.length, 1);
  assert.ok(reader.tracker.history.length);
  publish(reader, raw, true);
  assert.equal(reader.state.status, 'lobby');
  assert.equal(reader.state.match, null);
  assert.equal(reader.tracker.seen.size, 0);
  assert.deepEqual(reader.tracker.history, []);
  reader.live = { ok: false };
  await fs.writeFile(path.join(dir, 'GameState.json'), JSON.stringify(raw));
  const later = new Date(reader.lastLiveAt + 1000);
  await fs.utimes(path.join(dir, 'GameState.json'), later, later);
  await reader.poll();
  assert.equal(reader.state.match, null);
  publish(reader, raw);
  assert.equal(reader.state.match, null);
  const next = matchRaw('next');
  next.RemoteGame.GameState._entityIdToEntity = {};
  publish(reader, next);
  assert.equal(reader.state.match.gameId, 'next');
  assert.deepEqual(reader.state.match.opponent, []);
});
test('results retain cards and history through incomplete reads until returning to lobby', () => {
  const reader = new StateReader(null),
    raw = matchRaw('finished');
  raw.RemoteGame.GameState._entityIdToEntity[21]._zone.ZoneId = 'Hand';
  publish(reader, raw);
  raw.RemoteGame.GameState._entityIdToEntity[21]._zone.ZoneId = 'Graveyard';
  publish(reader, raw);
  const history = reader.state.match.history.slice();
  assert.ok(history.length);
  raw.RemoteGame.GameState.ClientResultMessage = { GameId: 'finished' };
  publish(reader, raw);
  assert.equal(reader.state.match.ended, true);
  assert.equal(reader.state.match.opponent.length, 1);
  assert.deepEqual(reader.state.match.history, history);
  publish(reader, null);
  assert.equal(reader.state.match.ended, true);
  assert.equal(reader.state.match.opponent.length, 1);
  const incomplete = structuredClone(raw);
  incomplete.RemoteGame.GameState._players = [];
  publish(reader, incomplete);
  assert.equal(reader.state.match.ended, true);
  assert.deepEqual(reader.state.match.history, history);
  publish(reader, raw);
  assert.equal(reader.state.status, 'live');
  assert.equal(reader.state.match.ended, true);
  publish(reader, raw, true);
  assert.equal(reader.state.match, null);
  assert.equal(reader.tracker.seen.size, 0);
  assert.deepEqual(reader.tracker.history, []);
  publish(reader, raw);
  assert.equal(reader.state.match, null);
  delete raw.RemoteGame.GameState.ClientResultMessage;
  publish(reader, raw);
  assert.equal(reader.state.match, null);
  publish(reader, matchRaw('next'));
  assert.equal(reader.state.match.gameId, 'next');
  publish(reader, raw);
  assert.equal(reader.state.match.gameId, 'next');
});
test(
  'saved fallback can update only the currently confirmed live match on Linux',
  { skip: process.platform !== 'linux' },
  async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snapper-fallback-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const reader = new StateReader(dir),
      raw = matchRaw('current');
    publish(reader, raw);
    reader.live = { ok: false };
    raw.RemoteGame.GameState.Turn = 4;
    const file = path.join(dir, 'GameState.json');
    await fs.writeFile(file, JSON.stringify(raw));
    const later = new Date(reader.lastLiveAt + 1000);
    await fs.utimes(file, later, later);
    await reader.poll();
    assert.equal(reader.state.match.turn, 4);
    await fs.writeFile(file, JSON.stringify(matchRaw('previous')));
    await fs.utimes(file, later, later);
    await reader.poll();
    assert.equal(reader.state.match.gameId, 'current');
    raw.RemoteGame.GameState.ClientResultMessage = { GameId: 'current' };
    await fs.writeFile(file, JSON.stringify(raw));
    await fs.utimes(file, new Date(later.getTime() + 1000), new Date(later.getTime() + 1000));
    await reader.poll();
    assert.equal(reader.state.match.ended, true);
    assert.equal(reader.state.match.opponent.length, 1);
  },
);
