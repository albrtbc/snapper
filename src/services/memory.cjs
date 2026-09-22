// External, read-only IL2CPP reader for the explicitly supported game build.
// No ptrace attach, injected code, network hooks or writes to the game process.
const fs = require('node:fs');
const crypto = require('node:crypto');
const PROFILE = Object.freeze({
  version: '57.17',
  sha256: '87ff5d4159ef85980d23a3015096fcac43543761ac59fe88af5c774de4205749',
  managerNestedTypes: [0x5d7dd58, 0x5d7fe80, 0x5d80338],
});
const transition = (message) => Object.assign(new Error(message), { code: 'SNAP_TRANSITION' });
const zones = ['Invalid', 'Deck', 'Hand', 'Location', 'Graveyard', 'SetAside', 'Banished'];
class ProcessMemory {
  constructor(pid) {
    this.pid = pid;
    this.fd = fs.openSync(`/proc/${pid}/mem`, 'r');
  }
  close() {
    if (this.fd !== null) fs.closeSync(this.fd);
    this.fd = null;
  }
  read(address, length) {
    if (!Number.isSafeInteger(address) || address < 65536 || length < 0 || length > 8 * 1024 * 1024)
      throw Error('Invalid memory range');
    const b = Buffer.allocUnsafe(length);
    if (fs.readSync(this.fd, b, 0, length, address) !== length) throw Error('Partial memory read');
    return b;
  }
  ptr(a) {
    const p = Number(this.read(a, 8).readBigUInt64LE());
    if (!Number.isSafeInteger(p)) throw Error('Invalid pointer');
    return p;
  }
  int(a) {
    return this.read(a, 4).readInt32LE();
  }
  bool(a) {
    return this.read(a, 1)[0] !== 0;
  }
  string(a) {
    if (!a) return null;
    const n = this.int(a + 16);
    if (n < 0 || n > 256) throw Error('Invalid string');
    return this.read(a + 20, n * 2).toString('utf16le');
  }
  typeName(a) {
    const b = this.read(this.ptr(a + 16), 96);
    const end = b.indexOf(0);
    if (end < 0) throw Error('Invalid type name');
    return b.subarray(0, end).toString();
  }
  className(a) {
    return this.typeName(this.ptr(a));
  }
  list(a, ints = false) {
    if (!a) return [];
    const count = this.int(a + 24);
    if (count < 0 || count > 2048) throw Error('Invalid list');
    const items = this.ptr(a + 16);
    if (!count) return [];
    return Array.from({ length: count }, (_, i) =>
      ints ? this.int(items + 32 + 4 * i) : this.ptr(items + 32 + 8 * i),
    );
  }
}
function gamePid() {
  for (const p of fs.readdirSync('/proc'))
    if (/^\d+$/.test(p)) {
      try {
        if (fs.readFileSync(`/proc/${p}/comm`, 'utf8').trim().toLowerCase() === 'snap.exe')
          return Number(p);
      } catch {}
    }
  return null;
}
function mappings(pid) {
  return fs
    .readFileSync(`/proc/${pid}/maps`, 'utf8')
    .trim()
    .split('\n')
    .map((line) => {
      const m = line.match(/^([\da-f]+)-([\da-f]+) (\S+) (\S+) \S+ \d+\s*(.*)$/);
      return {
        start: parseInt(m[1], 16),
        end: parseInt(m[2], 16),
        permissions: m[3],
        offset: parseInt(m[4], 16),
        file: m[5],
      };
    });
}
function findManagerClass(mem, base) {
  for (const rva of PROFILE.managerNestedTypes) {
    try {
      const nested = mem.ptr(base + rva);
      // Before IL2CPP initializes a TypeInfo slot it holds an encoded, odd
      // metadata token. Never interpret that token (or zero) as a class.
      if (nested < 65536 || nested % 8) continue;
      const parent = mem.ptr(nested + 0x50);
      if (parent >= 65536 && parent % 8 === 0 && mem.typeName(parent) === 'GameManager')
        return parent;
    } catch {}
  }
  throw Error('Waiting for Snap to initialize the match manager');
}
function attach(pid) {
  const maps = mappings(pid),
    assembly = maps.find((m) => m.file.endsWith('/GameAssembly.dll') && m.offset === 0);
  if (!assembly) throw Error('Waiting for Snap to load');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(assembly.file)).digest('hex');
  if (hash !== PROFILE.sha256) throw Error('This Snap version requires a new reader profile');
  const mem = new ProcessMemory(pid);
  try {
    // Several nested types lead to the same declaring GameManager class.
    // The startup coroutine is initialized before the first match; the enum
    // may still be an encoded token on a fresh launch in the lobby.
    const managerClass = findManagerClass(mem, assembly.start);
    const needle = Buffer.alloc(8);
    needle.writeBigUInt64LE(BigInt(managerClass));
    let manager = 0;
    const deadline = Date.now() + 8000;
    for (const map of maps) {
      if (map.permissions !== 'rw-p' || map.file) continue;
      for (let start = map.start; start < map.end; start += 4 * 1024 * 1024) {
        if (Date.now() > deadline) throw Error('Match search timed out; retrying');
        let bytes;
        try {
          bytes = mem.read(start, Math.min(4 * 1024 * 1024, map.end - start));
        } catch {
          continue;
        }
        for (let i = bytes.indexOf(needle); i >= 0; i = bytes.indexOf(needle, i + 8)) {
          const candidate = start + i;
          if (candidate % 8) continue;
          try {
            if (
              mem.ptr(candidate + 16) &&
              mem.className(candidate) === 'GameManager' &&
              mem.className(mem.ptr(candidate + 0x58)) === 'Game'
            ) {
              if (manager && manager !== candidate) throw Error('Ambiguous game manager');
              manager = candidate;
            }
          } catch (error) {
            if (error.message === 'Ambiguous game manager') throw error;
          }
        }
      }
    }
    if (!manager) throw Error('Waiting for Snap state');
    return { mem, manager, managerClass };
  } catch (error) {
    mem.close();
    throw error;
  }
}
function decodeGame(mem, manager, managerClass) {
  if (mem.ptr(manager) !== managerClass || !mem.ptr(manager + 16))
    throw Error('Game manager changed');
  const scene = mem.ptr(manager + 0xb0);
  const active = mem.ptr(manager + 0x230);
  // This lazy scene dependency may stay empty during the FIRST match. In
  // that case use the manager's active remote game record, not its retained
  // serialized snapshot. Once resolved, the scene also identifies the lobby.
  const sceneName = scene ? mem.string(mem.ptr(scene + 0x70)) : null;
  // The scene request is stored after loading too. Clear old match panels
  // when leaving Game; a retained managed object is not an active match.
  if ((sceneName && sceneName !== 'Game') || (!sceneName && !active))
    return { lobby: true, raw: null };
  if (mem.int(mem.ptr(manager + 0x1d8) + 16) !== 1) return { lobby: true, raw: null };
  const state = mem.ptr(manager + 0x58),
    remote = mem.ptr(state + 0x38);
  if (!remote) return { lobby: false, raw: null };
  const game = mem.ptr(remote + 0x20),
    info = mem.ptr(remote + 16);
  if (!game || !info) return { lobby: false, raw: null };
  const turn = mem.int(game + 0x84),
    localId = mem.int(info + 16);
  const players = mem.list(mem.ptr(game + 0x160));
  if (players.length !== 2 || turn < 0 || turn > 100) throw transition('Game changing');
  const entityId = (p) => mem.int(p + 16);
  const playerIds = players.map(entityId);
  if (
    localId <= 0 ||
    playerIds.some((id) => id <= 0) ||
    new Set(playerIds).size !== 2 ||
    !playerIds.includes(localId)
  )
    throw transition('Players changing');
  const playerData = players.map((p, index) => {
    const deck = mem.ptr(p + 0x78),
      hand = mem.ptr(p + 0x80);
    if (!deck || !hand) throw transition('Player zones changing');
    return {
      EntityId: playerIds[index],
      Deck: { EntityId: entityId(deck), _cards: mem.list(mem.ptr(deck + 0x38)).map(() => ({})) },
      Hand: { _cards: mem.list(mem.ptr(hand + 0x38)).map(() => ({})) },
    };
  });
  const dictionary = mem.ptr(game + 0x188),
    entries = mem.ptr(dictionary + 24),
    count = mem.int(dictionary + 32),
    version = mem.int(dictionary + 44);
  if (count < 0 || count > 2048) throw Error('Invalid entity count');
  const entities = {};
  for (let i = 0; i < count; i++) {
    const entry = entries + 32 + i * 24;
    if (mem.int(entry) < 0) continue;
    const card = mem.ptr(entry + 16);
    if (!card || mem.className(card) !== 'Card') continue;
    const owner = entityId(mem.ptr(card + 0x28));
    const zonePtr = mem.ptr(card + 0x250),
      previousPtr = mem.ptr(card + 0x248);
    const zone = zonePtr ? zones[mem.int(zonePtr + 32)] : 'Invalid',
      previous = previousPtr ? zones[mem.int(previousPtr + 32)] : 'Invalid';
    const revealed = mem.bool(card + 0xa0),
      visibleIds = mem.list(mem.ptr(card + 0x1f0), true);
    const visible =
      owner === localId ||
      revealed ||
      ['Graveyard', 'Banished'].includes(zone) ||
      visibleIds.includes(localId) ||
      (zone === 'Hand' && previous === 'Graveyard');
    // Apply visibility BEFORE reading identities or stats. Hidden enemy hand
    // and deck definitions never leave this reader, even if locally present.
    const id = entityId(card);
    entities[id] = {
      $type: 'CubeGame.Card, CubeGame',
      EntityId: id,
      Owner: { EntityId: owner },
      _zone: { ZoneId: zone },
      _previousZone: { ZoneId: previous },
      Revealed: revealed,
      TurnRevealed: mem.int(card + 0x9c),
      StartedInDeckEntityId: mem.int(card + 0x1c0),
      _visibleToPlayerEntityIds: visibleIds,
    };
    if (visible) {
      entities[id].CardDefId = mem.string(mem.ptr(card + 0x48));
      entities[id].ArtVariantDefId = mem.string(mem.ptr(card + 0x68));
      for (const [key, offset] of [
        ['Cost', 0x1a8],
        ['Power', 0x1b0],
      ]) {
        const stat = mem.ptr(card + offset);
        if (stat) entities[id][key] = { Value: mem.int(stat + 16) };
      }
    }
  }
  const id = mem.string(mem.ptr(game + 32));
  if (active && mem.string(mem.ptr(active + 16)) !== id) return { lobby: false, raw: null };
  const finalPlayers = mem.list(mem.ptr(game + 0x160));
  if (
    !id ||
    mem.ptr(remote + 0x20) !== game ||
    mem.ptr(remote + 16) !== info ||
    mem.int(info + 16) !== localId ||
    mem.int(game + 0x84) !== turn ||
    mem.int(dictionary + 44) !== version ||
    finalPlayers.length !== 2 ||
    finalPlayers.some((p, index) => p !== players[index] || entityId(p) !== playerIds[index])
  )
    throw transition('Game changed during read');
  return {
    lobby: false,
    raw: {
      RemoteGame: {
        ClientGameInfo: { LocalPlayerEntityId: localId },
        GameState: {
          Id: id,
          Turn: turn,
          TotalTurns: mem.int(game + 0x7c),
          CubeValue: mem.int(game + 0xa8),
          PlayerWithInitiativeEntityId: mem.int(game + 0xd8),
          ClientResultMessage: mem.ptr(game + 0xb8) ? { GameId: id } : null,
          _players: playerData,
          _entityIdToEntity: entities,
        },
      },
    },
  };
}
module.exports = { ProcessMemory, attach, decodeGame, gamePid, PROFILE, findManagerClass };
