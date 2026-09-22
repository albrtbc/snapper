const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ProcessMemory, decodeGame } = require('../src/services/memory.cjs');
const { parseSnapshot } = require('../src/core/snapshot.cjs');
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
    i(a + 16, s.length);
    b.write(s, a - 65536 + 20, 'utf16le');
    return a;
  };
  const list = (items, ints = false) => {
    const a = alloc(),
      arr = alloc();
    q(a + 16, arr);
    i(a + 24, items.length);
    items.forEach((v, k) => (ints ? i(arr + 32 + k * 4, v) : q(arr + 32 + k * 8, v)));
    return a;
  };
  const klass = (name) => {
    const c = alloc(),
      s = alloc();
    b.write(name + '\0', s - 65536);
    q(c + 16, s);
    return c;
  };
  const manager = alloc(),
    managerClass = klass('GameManager');
  q(manager, managerClass);
  q(manager + 16, alloc());
  const scene = alloc();
  q(manager + 0xb0, scene);
  q(scene + 0x70, str('Game'));
  const mode = alloc();
  q(manager + 0x1d8, mode);
  i(mode + 16, 1);
  const state = alloc(),
    remote = alloc(),
    game = alloc(),
    info = alloc();
  q(manager + 0x58, state);
  q(state + 0x38, remote);
  q(remote + 0x20, game);
  q(remote + 16, info);
  i(info + 16, 7);
  q(game + 32, str('match-one'));
  i(game + 0x84, 2);
  i(game + 0x7c, 6);
  i(game + 0xa8, 1);
  const zone = (id, type, count = 0) => {
    const z = alloc();
    i(z + 16, id);
    i(z + 32, type);
    q(z + 0x38, list(Array(count).fill(0)));
    return z;
  };
  const own = alloc(),
    enemy = alloc();
  i(own + 16, 7);
  i(enemy + 16, 2);
  q(own + 0x78, zone(8, 1, 8));
  q(own + 0x80, zone(9, 2, 3));
  q(enemy + 0x78, zone(3, 1, 8));
  q(enemy + 0x80, zone(4, 2, 3));
  q(game + 0x160, list([enemy, own]));
  const cardClass = klass('Card');
  const card = (id, owner, z, previous, revealed, name) => {
    const c = alloc();
    q(c, cardClass);
    i(c + 16, id);
    q(c + 0x28, owner);
    q(c + 0x250, zone(50 + id, z));
    q(c + 0x248, zone(100 + id, previous));
    b[c + 0xa0 - 65536] = Number(revealed);
    q(c + 0x48, str(name));
    i(c + 0x1c0, owner === own ? 8 : 3);
    const cost = alloc(),
      power = alloc();
    q(c + 0x1a8, cost);
    q(c + 0x1b0, power);
    i(cost + 16, 0);
    i(power + 16, -2);
    return c;
  };
  const hidden = card(20, enemy, 2, 1, false, 'SecretCard'),
    staged = card(21, enemy, 3, 2, false, 'SecretStaged'),
    publicCard = card(22, enemy, 3, 2, true, 'Iceman'),
    discard = card(23, enemy, 4, 2, false, 'Blade');
  const entries = alloc(),
    dict = alloc();
  q(game + 0x188, dict);
  q(dict + 24, entries);
  i(dict + 32, 4);
  i(dict + 44, 4);
  [hidden, staged, publicCard, discard].forEach((c, k) => q(entries + 32 + k * 24 + 16, c));
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
    decode: () => decodeGame(mem, manager, managerClass),
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
  assert.ok(!f.reads.includes(f.hidden + 0x48));
  assert.ok(!f.reads.includes(f.staged + 0x48));
  assert.equal(s.cards.find((c) => c.entityId === 22).cardId, 'Iceman');
  assert.equal(s.cards.find((c) => c.entityId === 22).cost, 0);
  assert.equal(s.cards.find((c) => c.entityId === 22).power, -2);
  assert.equal(s.cards.find((c) => c.entityId === 23).status, 'discarded');
});
test('leaving to lobby clears retained game; returning follows the new game pointer', () => {
  const f = fixture();
  assert.equal(parseSnapshot(f.decode().raw).gameId, 'match-one');
  f.q(f.manager + 0xb0, 0);
  assert.deepEqual(f.decode(), { lobby: true, raw: null });
  f.q(f.manager + 0xb0, f.scene);
  f.q(f.scene + 0x70, f.str('Play'));
  assert.deepEqual(f.decode(), { lobby: true, raw: null });
  f.q(f.game + 32, f.str('match-two'));
  f.q(f.scene + 0x70, f.str('Game'));
  assert.equal(parseSnapshot(f.decode().raw).gameId, 'match-two');
});
test('destroyed Unity manager is rejected, not read as an old active match', () => {
  const f = fixture();
  f.q(f.manager + 16, 0);
  assert.throws(f.decode, /Game manager changed/);
});
test('uninitialized IL2CPP tokens and null parents cannot become a zero scan needle', () => {
  const { findManagerClass, PROFILE } = require('../src/services/memory.cjs');
  const base = 0x10000000;
  const mem = {
    ptr: (a) => (a === base + PROFILE.managerNestedTypes[0] ? 0x200227bb : 0),
    typeName: () => {
      throw Error('must not read type');
    },
  };
  assert.throws(() => findManagerClass(mem, base), /initialize/);
  const fallback = {
    ptr: (a) =>
      a === base + PROFILE.managerNestedTypes[0]
        ? 0x200227bb
        : a === base + PROFILE.managerNestedTypes[1]
          ? 0x30000000
          : a === 0x30000050
            ? 0x40000000
            : 0,
    typeName: () => 'GameManager',
  };
  assert.equal(findManagerClass(fallback, base), 0x40000000);
});
test('first match works before lazy scene dependency resolves; old game cannot be reused', () => {
  const f = fixture(),
    active = f.str('record');
  f.q(active + 16, f.str('match-one'));
  f.q(f.manager + 0x230, active);
  f.q(f.manager + 0xb0, 0);
  assert.equal(parseSnapshot(f.decode().raw).gameId, 'match-one');
  f.q(active + 16, f.str('next-match'));
  assert.deepEqual(f.decode(), { lobby: false, raw: null });
});
test('live variants are read only after card visibility is established', () => {
  const f = fixture();
  f.q(f.publicCard + 0x68, f.str('Iceman_05'));
  f.q(f.hidden + 0x68, f.str('SecretCard_03'));
  f.q(f.staged + 0x68, f.str('SecretStaged_07'));
  const state = parseSnapshot(f.decode().raw);
  assert.equal(state.cards.find((c) => c.entityId === 22).variantId, 'Iceman_05');
  assert.equal(state.cards.find((c) => c.entityId === 20).variantId, null);
  assert.ok(!f.reads.includes(f.hidden + 0x68));
  assert.ok(!f.reads.includes(f.staged + 0x68));
});
test('duplicate player IDs are transient and never emitted as a valid live snapshot', () => {
  const f = fixture(),
    list = f.mem.ptr(f.game + 0x160),
    items = f.mem.ptr(list + 16),
    local = f.mem.ptr(items + 40);
  f.q(items + 32, local);
  assert.throws(
    f.decode,
    (error) => error.code === 'SNAP_TRANSITION' && error.message === 'Players changing',
  );
});
