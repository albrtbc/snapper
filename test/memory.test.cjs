const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  ProcessMemory,
  attach,
  decodeGame,
  findManagerClass,
  profileFor,
  LAYOUT,
  PROFILE,
} = require('../src/services/memory.cjs');
const { parseSnapshot } = require('../src/core/snapshot.cjs');
const F = PROFILE.fields,
  D = LAYOUT.dictionary,
  zoneId = (name) => PROFILE.zones.indexOf(name);
function fixture() {
  const b = Buffer.alloc(200000);
  let cursor = 65536;
  const reads = [];
  const alloc = () => {
    const a = cursor;
    cursor += 1024;
    return a;
  };
  const q = (a, v) => b.writeBigUInt64LE(BigInt(v), a - 65536),
    i = (a, v) => b.writeInt32LE(v, a - 65536);
  const str = (s) => {
    const a = alloc();
    i(a + LAYOUT.string.length, s.length);
    b.write(s, a - 65536 + LAYOUT.string.chars, 'utf16le');
    return a;
  };
  const list = (items, ints = false) => {
    const a = alloc(),
      arr = alloc();
    q(a + LAYOUT.list.items, arr);
    i(a + LAYOUT.list.size, items.length);
    items.forEach((v, k) =>
      ints ? i(arr + LAYOUT.arrayData + k * 4, v) : q(arr + LAYOUT.arrayData + k * 8, v),
    );
    return a;
  };
  const klass = (name) => {
    const c = alloc(),
      s = alloc();
    b.write(name + '\0', s - 65536);
    q(c + LAYOUT.klass.name, s);
    return c;
  };
  const manager = alloc(),
    managerClass = klass('GameManager');
  q(manager, managerClass);
  q(manager + LAYOUT.unityObject.cachedPtr, alloc());
  const scene = alloc();
  q(manager + F.manager.sceneManager, scene);
  q(scene + F.sceneManager.sceneName, str('Game'));
  const mode = alloc();
  q(manager + F.manager.currentGameMode, mode);
  i(mode + F.observable.value, PROFILE.gameModeRemote);
  const state = alloc(),
    remote = alloc(),
    game = alloc(),
    info = alloc();
  q(manager + F.manager.state, state);
  q(state + F.stateGame.remoteGame, remote);
  q(remote + F.remoteGame.gameState, game);
  q(remote + F.remoteGame.clientGameInfo, info);
  i(info + F.clientGameInfo.localPlayerEntityId, 7);
  q(game + F.game.id, str('match-one'));
  i(game + F.game.turn, 2);
  i(game + F.game.totalTurns, 6);
  i(game + F.game.cubeValue, 1);
  const zone = (id, type, count = 0) => {
    const z = alloc();
    i(z + F.entity.entityId, id);
    i(z + F.zone.zoneId, type);
    q(z + F.zone.cards, list(Array(count).fill(0)));
    return z;
  };
  const own = alloc(),
    enemy = alloc();
  i(own + F.entity.entityId, 7);
  i(enemy + F.entity.entityId, 2);
  q(own + F.player.deck, zone(8, zoneId('Deck'), 8));
  q(own + F.player.hand, zone(9, zoneId('Hand'), 3));
  q(enemy + F.player.deck, zone(3, zoneId('Deck'), 8));
  q(enemy + F.player.hand, zone(4, zoneId('Hand'), 3));
  q(game + F.game.players, list([enemy, own]));
  const cardClass = klass('Card');
  const card = (id, owner, z, previous, revealed, name) => {
    const c = alloc();
    q(c, cardClass);
    i(c + F.entity.entityId, id);
    q(c + F.card.owner, owner);
    q(c + F.card.zone, zone(50 + id, z));
    q(c + F.card.previousZone, zone(100 + id, previous));
    b[c + F.card.revealed - 65536] = Number(revealed);
    q(c + F.card.cardDefId, str(name));
    i(c + F.card.startedInDeckEntityId, owner === own ? 8 : 3);
    const cost = alloc(),
      power = alloc();
    q(c + F.card.cost, cost);
    q(c + F.card.power, power);
    i(cost + F.stat.value, 0);
    i(power + F.stat.value, -2);
    return c;
  };
  const [deck, hand, location, graveyard] = ['Deck', 'Hand', 'Location', 'Graveyard'].map(zoneId);
  const hidden = card(20, enemy, hand, deck, false, 'SecretCard'),
    staged = card(21, enemy, location, hand, false, 'SecretStaged'),
    publicCard = card(22, enemy, location, hand, true, 'Iceman'),
    discard = card(23, enemy, graveyard, hand, false, 'Blade');
  const entries = alloc(),
    dict = alloc();
  q(game + F.game.entities, dict);
  q(dict + D.entries, entries);
  i(dict + D.count, 4);
  i(dict + D.version, 4);
  [hidden, staged, publicCard, discard].forEach((c, k) =>
    q(entries + LAYOUT.arrayData + k * D.entryStride + D.entryValue, c),
  );
  const mem = Object.create(ProcessMemory.prototype);
  mem.read = (a, n) => {
    reads.push(a);
    if (a < 65536 || a + n > 65536 + b.length) throw Error('Invalid range');
    return b.subarray(a - 65536, a - 65536 + n);
  };
  return {
    mem,
    manager,
    managerClass,
    scene,
    game,
    q,
    str,
    reads,
    hidden,
    staged,
    publicCard,
    decode: () => decodeGame(mem, manager, managerClass, PROFILE),
  };
}
test('live reader redacts hidden identities before reading and resolves public cards/stats', () => {
  const f = fixture(),
    raw = f.decode().raw,
    s = parseSnapshot(raw);
  assert.equal(s.turn, 2);
  assert.equal(s.players.own.deckCount, 8);
  assert.equal(s.cards.find((c) => c.entityId === 20).cardId, null);
  assert.equal(s.cards.find((c) => c.entityId === 21).cardId, null);
  assert.ok(!f.reads.includes(f.hidden + F.card.cardDefId));
  assert.ok(!f.reads.includes(f.staged + F.card.cardDefId));
  assert.equal(s.cards.find((c) => c.entityId === 22).cardId, 'Iceman');
  assert.equal(s.cards.find((c) => c.entityId === 22).cost, 0);
  assert.equal(s.cards.find((c) => c.entityId === 22).power, -2);
  assert.equal(s.cards.find((c) => c.entityId === 23).status, 'discarded');
});
test('leaving to lobby clears retained game; returning follows the new game pointer', () => {
  const f = fixture();
  assert.equal(parseSnapshot(f.decode().raw).gameId, 'match-one');
  f.q(f.manager + F.manager.sceneManager, 0);
  assert.deepEqual(f.decode(), { lobby: true, raw: null });
  f.q(f.manager + F.manager.sceneManager, f.scene);
  f.q(f.scene + F.sceneManager.sceneName, f.str('Play'));
  assert.deepEqual(f.decode(), { lobby: true, raw: null });
  f.q(f.game + F.game.id, f.str('match-two'));
  f.q(f.scene + F.sceneManager.sceneName, f.str('Game'));
  assert.equal(parseSnapshot(f.decode().raw).gameId, 'match-two');
});
test('destroyed Unity manager is rejected, not read as an old active match', () => {
  const f = fixture();
  f.q(f.manager + LAYOUT.unityObject.cachedPtr, 0);
  assert.throws(f.decode, /Game manager changed/);
});
test('uninitialized IL2CPP tokens and null parents cannot become a zero scan needle', () => {
  const base = 0x10000000;
  const mem = {
    ptr: (a) => (a === base + PROFILE.managerNestedTypes[0] ? 0x200227bb : 0),
    typeName: () => {
      throw Error('must not read type');
    },
  };
  assert.throws(() => findManagerClass(mem, base, PROFILE), /initialize/);
  const fallback = {
    ptr: (a) =>
      a === base + PROFILE.managerNestedTypes[0]
        ? 0x200227bb
        : a === base + PROFILE.managerNestedTypes[1]
          ? 0x30000000
          : a === 0x30000000 + LAYOUT.klass.declaringType
            ? 0x40000000
            : 0,
    typeName: () => 'GameManager',
  };
  assert.equal(findManagerClass(fallback, base, PROFILE), 0x40000000);
});
test('first match works before lazy scene dependency resolves; old game cannot be reused', () => {
  const f = fixture(),
    active = f.str('record');
  f.q(active + F.activeRemoteGame.gameId, f.str('match-one'));
  f.q(f.manager + F.manager.activeRemoteGame, active);
  f.q(f.manager + F.manager.sceneManager, 0);
  assert.equal(parseSnapshot(f.decode().raw).gameId, 'match-one');
  f.q(active + F.activeRemoteGame.gameId, f.str('next-match'));
  assert.deepEqual(f.decode(), { lobby: false, raw: null });
});
test('live variants are read only after card visibility is established', () => {
  const f = fixture();
  f.q(f.publicCard + F.card.artVariantDefId, f.str('Iceman_05'));
  f.q(f.hidden + F.card.artVariantDefId, f.str('SecretCard_03'));
  f.q(f.staged + F.card.artVariantDefId, f.str('SecretStaged_07'));
  const state = parseSnapshot(f.decode().raw);
  assert.equal(state.cards.find((c) => c.entityId === 22).variantId, 'Iceman_05');
  assert.equal(state.cards.find((c) => c.entityId === 20).variantId, null);
  assert.ok(!f.reads.includes(f.hidden + F.card.artVariantDefId));
  assert.ok(!f.reads.includes(f.staged + F.card.artVariantDefId));
});
test('duplicate player IDs are transient and never emitted as a valid live snapshot', () => {
  const f = fixture(),
    list = f.mem.ptr(f.game + F.game.players),
    items = f.mem.ptr(list + LAYOUT.list.items),
    local = f.mem.ptr(items + LAYOUT.arrayData + 8);
  f.q(items + LAYOUT.arrayData, local);
  assert.throws(
    f.decode,
    (error) => error.code === 'SNAP_TRANSITION' && error.message === 'Players changing',
  );
});
test('profiles are keyed by GameAssembly hash and unknown builds are unsupported', () => {
  assert.equal(profileFor(PROFILE.sha256), PROFILE);
  assert.throws(
    () => profileFor('0'.repeat(64)),
    (error) =>
      error.code === 'SNAP_UNSUPPORTED' &&
      error.message === 'Unsupported Marvel Snap build' &&
      error.sha256 === '0'.repeat(64),
  );
  assert.throws(() => profileFor('__proto__'), { code: 'SNAP_UNSUPPORTED' });
  assert.ok(Object.isFrozen(PROFILE.fields.card) && Object.isFrozen(PROFILE.avatar.slots[0]));
});
test('attach rejects an unknown build before opening process memory', (t) => {
  const readFileSync = fs.readFileSync;
  const maps = '7f0000000000-7f0000100000 r--p 00000000 00:00 0 /games/snap/GameAssembly.dll\n';
  t.mock.method(fs, 'readFileSync', (file, ...rest) =>
    file === '/proc/4242/maps'
      ? maps
      : file === '/games/snap/GameAssembly.dll'
        ? Buffer.from('not the supported build')
        : readFileSync(file, ...rest),
  );
  const openSync = t.mock.method(fs, 'openSync', () => {
    throw Error('process memory must not be opened');
  });
  assert.throws(
    () => attach(4242),
    (error) => error.code === 'SNAP_UNSUPPORTED' && /^[\da-f]{64}$/.test(error.sha256),
  );
  assert.equal(openSync.mock.callCount(), 0);
});
