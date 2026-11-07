// External, read-only IL2CPP reader for the explicitly supported game build.
// No ptrace attach, injected code, network hooks or writes to the game process.
const fs = require('node:fs');
const crypto = require('node:crypto');
const deepFreeze = (value) => {
  for (const child of Object.values(value))
    if (child && typeof child === 'object') deepFreeze(child);
  return Object.freeze(value);
};
// Game-build offsets, pinned to the SHA-256 of GameAssembly.dll. A new build
// needs a reviewed entry; see docs/reader-profile.md. Never relax the hash check.
const SNAP_58_15_1 = deepFreeze({
  version: '58.15.1',
  sha256: '62470eab01b9b3ddf8d7c2f5dd83a276fb1f40e9a5b0c26fd52b682359f4c19b',
  unitySha256: 'a968a3ca5c1c30b400b81669e77b92f1f98186ca1f1aab310f172e94f0c01732',
  managerNestedTypes: [
    0x5fb3360, 0x5fb36a0, 0x5fb3b80, 0x5fb3d20, 0x5fb3ec0, 0x5fb4060, 0x5fb4200, 0x5fb43a0,
    0x5fb4540, 0x5fb46e0, 0x5fb4880, 0x5fb4bc0, 0x5fb4f00, 0x5fb50a0, 0x5fb5240, 0x5fb53e0,
    0x5fb5580, 0x5fb5720, 0x5fb58c0, 0x5fb5a60, 0x5fb5c00, 0x5fb5da0,
  ],
  gameModeRemote: 1,
  zones: ['Invalid', 'Deck', 'Hand', 'Location', 'Graveyard', 'SetAside', 'Banished', 'Trinket'],
  fields: {
    manager: { state: 0x58, sceneManager: 0xb0, currentGameMode: 0x1c8, activeRemoteGame: 0x220 },
    sceneManager: { sceneName: 0x70 },
    observable: { value: 0x10 },
    activeRemoteGame: { gameId: 0x10 },
    stateGame: { remoteGame: 0x38 },
    remoteGame: { clientGameInfo: 0x10, gameState: 0x20 },
    clientGameInfo: { localPlayerEntityId: 0x10 },
    game: {
      id: 0x20,
      totalTurns: 0x84,
      turn: 0x8c,
      cubeValue: 0xb0,
      clientResultMessage: 0xc0,
      playerWithInitiativeEntityId: 0xe0,
      players: 0x168,
      entities: 0x190,
    },
    entity: { entityId: 0x10 },
    player: { deck: 0x78, hand: 0x80 },
    zone: { zoneId: 0x20, cards: 0x38 },
    card: {
      owner: 0x28,
      cardDefId: 0x48,
      artVariantDefId: 0x68,
      turnRevealed: 0xa4,
      revealed: 0xa8,
      cost: 0x1b0,
      power: 0x1b8,
      startedInDeckEntityId: 0x1c8,
      visibleToPlayerEntityIds: 0x1f8,
      previousZone: 0x250,
      zone: 0x258,
    },
    stat: { value: 0x10 },
  },
  avatar: {
    // [RVA of a metadata-usage slot, offset of the AvatarMenuPanel class inside it]
    slots: [
      [0x5fb6218, 0x20],
      [0x5fb63b8, 0x20],
      [0x5fb6558, 0x20],
      [0x5fb66f8, 0x20],
      [0x5fb6898, 0x20],
      [0x5ecd538, 0x50],
    ],
    panel: { cardsInHand: 0xd8, settingsObject: 0x138 },
    // RVAs inside UnityPlayer.dll, pinned by unitySha256.
    unity: {
      monoBehaviourVtable: 0x1b697f8,
      gameObjectVtable: 0x1b267f0,
      nativeGameObject: 0x20,
      activeInHierarchy: 0x47,
    },
  },
});
const PROFILE = SNAP_58_15_1;
const PROFILES = deepFreeze({ [SNAP_58_15_1.sha256]: SNAP_58_15_1 });
function profileFor(sha256) {
  const profile = Object.hasOwn(PROFILES, sha256) ? PROFILES[sha256] : null;
  if (!profile)
    throw Object.assign(new Error('Unsupported Marvel Snap build'), {
      code: 'SNAP_UNSUPPORTED',
      sha256,
    });
  return profile;
}
// IL2CPP and .NET runtime layouts belong to the Unity version (6000.0, metadata
// v31), not to the game build, so they are not part of a profile.
const LAYOUT = Object.freeze({
  string: Object.freeze({ length: 0x10, chars: 0x14 }),
  klass: Object.freeze({ name: 0x10, declaringType: 0x50 }),
  list: Object.freeze({ items: 0x10, size: 0x18 }),
  arrayData: 0x20,
  unityObject: Object.freeze({ cachedPtr: 0x10 }),
  dictionary: Object.freeze({
    entries: 0x18,
    count: 0x20,
    version: 0x2c,
    entryStride: 24,
    entryHash: 0x0,
    entryValue: 0x10,
  }),
});
const transition = (message) => Object.assign(new Error(message), { code: 'SNAP_TRANSITION' });
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
    const n = this.int(a + LAYOUT.string.length);
    if (n < 0 || n > 256) throw Error('Invalid string');
    return this.read(a + LAYOUT.string.chars, n * 2).toString('utf16le');
  }
  typeName(a) {
    const b = this.read(this.ptr(a + LAYOUT.klass.name), 96);
    const end = b.indexOf(0);
    if (end < 0) throw Error('Invalid type name');
    return b.subarray(0, end).toString();
  }
  className(a) {
    return this.typeName(this.ptr(a));
  }
  list(a, ints = false) {
    if (!a) return [];
    const count = this.int(a + LAYOUT.list.size);
    if (count < 0 || count > 2048) throw Error('Invalid list');
    const items = this.ptr(a + LAYOUT.list.items);
    if (!count) return [];
    return Array.from({ length: count }, (_, i) =>
      ints
        ? this.int(items + LAYOUT.arrayData + 4 * i)
        : this.ptr(items + LAYOUT.arrayData + 8 * i),
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
function findManagerClass(mem, base, profile = PROFILE) {
  for (const rva of profile.managerNestedTypes) {
    try {
      const nested = mem.ptr(base + rva);
      // Before IL2CPP initializes a TypeInfo slot it holds an encoded, odd
      // metadata token. Never interpret that token (or zero) as a class.
      if (nested < 65536 || nested % 8) continue;
      const declaring = mem.ptr(nested + LAYOUT.klass.declaringType);
      if (declaring >= 65536 && declaring % 8 === 0 && mem.typeName(declaring) === 'GameManager')
        return declaring;
    } catch {}
  }
  throw Error('Waiting for Snap to initialize the match manager');
}
function attach(pid) {
  const maps = mappings(pid),
    assembly = maps.find((m) => m.file.endsWith('/GameAssembly.dll') && m.offset === 0);
  if (!assembly) throw Error('Waiting for Snap to load');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(assembly.file)).digest('hex');
  const profile = profileFor(hash);
  const mem = new ProcessMemory(pid);
  try {
    // Several nested types lead to the same declaring GameManager class.
    // The startup coroutine is initialized before the first match; the enum
    // may still be an encoded token on a fresh launch in the lobby.
    const managerClass = findManagerClass(mem, assembly.start, profile);
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
              mem.ptr(candidate + LAYOUT.unityObject.cachedPtr) &&
              mem.className(candidate) === 'GameManager' &&
              mem.className(mem.ptr(candidate + profile.fields.manager.state)) === 'Game'
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
    return { mem, manager, managerClass, profile };
  } catch (error) {
    mem.close();
    throw error;
  }
}
function decodeGame(mem, manager, managerClass, profile = PROFILE) {
  const { fields: f, zones } = profile;
  if (mem.ptr(manager) !== managerClass || !mem.ptr(manager + LAYOUT.unityObject.cachedPtr))
    throw Error('Game manager changed');
  const scene = mem.ptr(manager + f.manager.sceneManager);
  const active = mem.ptr(manager + f.manager.activeRemoteGame);
  // This lazy scene dependency may stay empty during the FIRST match. In
  // that case use the manager's active remote game record, not its retained
  // serialized snapshot. Once resolved, the scene also identifies the lobby.
  const sceneName = scene ? mem.string(mem.ptr(scene + f.sceneManager.sceneName)) : null;
  // The scene request is stored after loading too. Clear old match panels
  // when leaving Game; a retained managed object is not an active match.
  if ((sceneName && sceneName !== 'Game') || (!sceneName && !active))
    return { lobby: true, raw: null };
  const gameMode = mem.int(mem.ptr(manager + f.manager.currentGameMode) + f.observable.value);
  if (gameMode !== profile.gameModeRemote) return { lobby: true, raw: null };
  const state = mem.ptr(manager + f.manager.state),
    remote = mem.ptr(state + f.stateGame.remoteGame);
  if (!remote) return { lobby: false, raw: null };
  const game = mem.ptr(remote + f.remoteGame.gameState),
    info = mem.ptr(remote + f.remoteGame.clientGameInfo);
  if (!game || !info) return { lobby: false, raw: null };
  const turn = mem.int(game + f.game.turn),
    localId = mem.int(info + f.clientGameInfo.localPlayerEntityId);
  const players = mem.list(mem.ptr(game + f.game.players));
  if (players.length !== 2 || turn < 0 || turn > 100) throw transition('Game changing');
  const entityId = (p) => mem.int(p + f.entity.entityId);
  const playerIds = players.map(entityId);
  if (
    localId <= 0 ||
    playerIds.some((id) => id <= 0) ||
    new Set(playerIds).size !== 2 ||
    !playerIds.includes(localId)
  )
    throw transition('Players changing');
  const playerData = players.map((p, index) => {
    const deck = mem.ptr(p + f.player.deck),
      hand = mem.ptr(p + f.player.hand);
    if (!deck || !hand) throw transition('Player zones changing');
    return {
      EntityId: playerIds[index],
      Deck: {
        EntityId: entityId(deck),
        _cards: mem.list(mem.ptr(deck + f.zone.cards)).map(() => ({})),
      },
      Hand: { _cards: mem.list(mem.ptr(hand + f.zone.cards)).map(() => ({})) },
    };
  });
  const D = LAYOUT.dictionary;
  const dictionary = mem.ptr(game + f.game.entities),
    entries = mem.ptr(dictionary + D.entries),
    count = mem.int(dictionary + D.count),
    version = mem.int(dictionary + D.version);
  if (count < 0 || count > 2048) throw Error('Invalid entity count');
  const entities = {};
  for (let i = 0; i < count; i++) {
    const entry = entries + LAYOUT.arrayData + i * D.entryStride;
    if (mem.int(entry + D.entryHash) < 0) continue;
    const card = mem.ptr(entry + D.entryValue);
    if (!card || mem.className(card) !== 'Card') continue;
    const owner = entityId(mem.ptr(card + f.card.owner));
    const zonePtr = mem.ptr(card + f.card.zone),
      previousPtr = mem.ptr(card + f.card.previousZone);
    const zone = zonePtr ? zones[mem.int(zonePtr + f.zone.zoneId)] : 'Invalid',
      previous = previousPtr ? zones[mem.int(previousPtr + f.zone.zoneId)] : 'Invalid';
    const revealed = mem.bool(card + f.card.revealed),
      visibleIds = mem.list(mem.ptr(card + f.card.visibleToPlayerEntityIds), true);
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
      TurnRevealed: mem.int(card + f.card.turnRevealed),
      StartedInDeckEntityId: mem.int(card + f.card.startedInDeckEntityId),
      _visibleToPlayerEntityIds: visibleIds,
    };
    if (visible) {
      entities[id].CardDefId = mem.string(mem.ptr(card + f.card.cardDefId));
      entities[id].ArtVariantDefId = mem.string(mem.ptr(card + f.card.artVariantDefId));
      for (const [key, offset] of [
        ['Cost', f.card.cost],
        ['Power', f.card.power],
      ]) {
        const stat = mem.ptr(card + offset);
        if (stat) entities[id][key] = { Value: mem.int(stat + f.stat.value) };
      }
    }
  }
  const id = mem.string(mem.ptr(game + f.game.id));
  if (active && mem.string(mem.ptr(active + f.activeRemoteGame.gameId)) !== id)
    return { lobby: false, raw: null };
  const finalPlayers = mem.list(mem.ptr(game + f.game.players));
  if (
    !id ||
    mem.ptr(remote + f.remoteGame.gameState) !== game ||
    mem.ptr(remote + f.remoteGame.clientGameInfo) !== info ||
    mem.int(info + f.clientGameInfo.localPlayerEntityId) !== localId ||
    mem.int(game + f.game.turn) !== turn ||
    mem.int(dictionary + D.version) !== version ||
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
          TotalTurns: mem.int(game + f.game.totalTurns),
          CubeValue: mem.int(game + f.game.cubeValue),
          PlayerWithInitiativeEntityId: mem.int(game + f.game.playerWithInitiativeEntityId),
          ClientResultMessage: mem.ptr(game + f.game.clientResultMessage) ? { GameId: id } : null,
          _players: playerData,
          _entityIdToEntity: entities,
        },
      },
    },
  };
}
module.exports = {
  ProcessMemory,
  attach,
  decodeGame,
  gamePid,
  PROFILE,
  PROFILES,
  profileFor,
  findManagerClass,
  LAYOUT,
};
