// Derive a candidate reader profile from a running Marvel Snap build.
//
// Development tool, not packaged. It only reads /proc/<pid>/mem and the game's
// own files: no ptrace attach, no writes, no injected code. Run it while the
// game is open and after at least one match has loaded (during a match or on
// its results screen), then review the output and copy the profile into
// src/services/memory.cjs. See docs/reader-profile.md.
//
//   node scripts/derive-profile.cjs [--dump]
//
// Writes .cache/reader-profile-<version>.json (and, with --dump, the field
// tables of every class it used to .cache/reader-classes-<version>.txt). Both
// stay in the ignored .cache/ folder: never commit metadata or memory dumps.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  ProcessMemory,
  gamePid,
  decodeGame,
  PROFILE,
  PROFILES,
} = require('../src/services/memory.cjs');

// IL2CPP runtime layouts for metadata v31 (Unity 6000.0). These belong to the
// Unity version, not to the game build; the String check below confirms them.
const CLASS = {
  name: 0x10,
  namespace: 0x18,
  declaringType: 0x50,
  parent: 0x58,
  self: 0x78,
  fields: 0x80,
  methods: 0x98,
  nestedTypes: 0xa0,
  methodCount: 0x120,
  fieldCount: 0x124,
  nestedTypeCount: 0x128,
};
const FIELD_INFO_SIZE = 32; // { name, type, parent, offset:int32, token }
const TYPE_DEFINITION_SIZE = 88; // Il2CppTypeDefinition, metadata v31
const METHOD_INFO_CLASS = 0x20;

const pid = gamePid();
if (!pid) fail('Marvel Snap is not running.');
const maps = fs
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
const module_ = (name) => maps.find((m) => m.offset === 0 && m.file.endsWith('/' + name));
const assembly = module_('GameAssembly.dll'),
  unity = module_('UnityPlayer.dll'),
  metadataMap = maps.find((m) => m.file.endsWith('/global-metadata.dat'));
if (!assembly || !unity || !metadataMap) fail('Wait for Marvel Snap to finish loading.');
const mem = new ProcessMemory(pid);
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function readRange(start, end) {
  const parts = [];
  for (let a = start; a < end; a += 4 * 1024 * 1024)
    parts.push(mem.read(a, Math.min(4 * 1024 * 1024, end - a)));
  return Buffer.concat(parts);
}
function cstring(address, max = 256) {
  const b = mem.read(address, max);
  const end = b.indexOf(0);
  return b.subarray(0, end < 0 ? max : end).toString();
}
function fail(message) {
  console.error(message);
  process.exit(1);
}

// ---- Metadata: version check, string table, enums -------------------------
const metadata = readRange(metadataMap.start, metadataMap.end);
if (metadata.readUInt32LE(0) !== 0xfab11baf) fail('Unexpected global-metadata.dat header.');
if (metadata.readInt32LE(4) !== 31)
  fail(`Metadata v${metadata.readInt32LE(4)}: review the IL2CPP layouts in this script first.`);
const header = (offset) => metadata.readInt32LE(offset);
const stringTable = header(0x18);
function metadataString(index) {
  const start = stringTable + index;
  return metadata.subarray(start, metadata.indexOf(0, start)).toString();
}
function compressedInt32(offset) {
  const b = metadata[offset];
  let u;
  if ((b & 0x80) === 0) u = b;
  else if ((b & 0xc0) === 0x80) u = ((b & 0x3f) << 8) | metadata[offset + 1];
  else throw Error('Unsupported enum value encoding');
  return u & 1 ? -(u >>> 1) - 1 : u >>> 1;
}
// Enum names ordered by value, from an Il2CppTypeDefinition in the mapping.
function enumMembers(typeDefinition) {
  const td = typeDefinition - metadataMap.start;
  if ((td - header(0xa0)) % TYPE_DEFINITION_SIZE) throw Error('Not a type definition');
  const fieldStart = metadata.readInt32LE(td + 0x20),
    fieldCount = metadata.readUInt16LE(td + 0x44);
  const defaults = new Map();
  for (let o = header(0x40); o < header(0x40) + header(0x44); o += 12)
    defaults.set(metadata.readInt32LE(o), metadata.readInt32LE(o + 8));
  const members = [];
  for (let i = 1; i < fieldCount; i++) {
    const field = fieldStart + i;
    const name = metadataString(metadata.readInt32LE(header(0x60) + 12 * field));
    members.push([compressedInt32(header(0x48) + defaults.get(field)), name]);
  }
  return members.sort((a, b) => a[0] - b[0]);
}

// ---- Runtime classes ------------------------------------------------------
const anonymous = maps.filter((m) => m.permissions === 'rw-p' && !m.file);
function scan(values, regions = anonymous) {
  const needles = values.map((v) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(v));
    return [v, b];
  });
  const hits = [];
  for (const region of regions)
    for (let start = region.start; start < region.end; start += 4 * 1024 * 1024) {
      let bytes;
      try {
        bytes = mem.read(start, Math.min(4 * 1024 * 1024, region.end - start));
      } catch {
        continue;
      }
      for (const [value, needle] of needles)
        for (let i = bytes.indexOf(needle); i >= 0; i = bytes.indexOf(needle, i + 1))
          if ((start + i) % 8 === 0) hits.push({ address: start + i, value });
    }
  return hits;
}
// Class names point into the mapped metadata, so find "\0Name\0" there and
// then the Il2CppClass whose name field points at it and whose klass field
// points at itself.
function findClasses(wanted) {
  const byString = new Map();
  for (const [namespace, name] of wanted) {
    const needle = Buffer.from('\0' + name + '\0');
    for (let i = metadata.indexOf(needle); i >= 0; i = metadata.indexOf(needle, i + 1))
      byString.set(metadataMap.start + i + 1, name);
  }
  const found = {};
  for (const { address, value } of scan([...byString.keys()])) {
    const klass = address - CLASS.name;
    try {
      if (mem.ptr(klass + CLASS.self) !== klass) continue;
      const namespace = cstring(mem.ptr(klass + CLASS.namespace));
      const name = byString.get(value);
      if (wanted.some(([n, c]) => n === namespace && c === name))
        found[namespace + '.' + name] = klass;
    } catch {}
  }
  for (const [namespace, name] of wanted)
    if (!found[namespace + '.' + name]) fail(`Class ${namespace}.${name} not found.`);
  return found;
}
const className = (klass) =>
  cstring(mem.ptr(klass + CLASS.namespace)) + '.' + cstring(mem.ptr(klass + CLASS.name));
const objectClass = (object) => mem.ptr(object);
const u16 = (address) => mem.read(address, 2).readUInt16LE(0);
function ownFields(klass) {
  const array = mem.ptr(klass + CLASS.fields),
    count = u16(klass + CLASS.fieldCount);
  return Array.from({ length: count }, (_, i) => {
    const info = array + FIELD_INFO_SIZE * i;
    return { name: cstring(mem.ptr(info)), type: mem.ptr(info + 8), offset: mem.int(info + 24) };
  });
}
function field(klass, name) {
  for (let c = klass; c; c = mem.ptr(c + CLASS.parent)) {
    const match = ownFields(c).find(
      (f) => f.name === name || f.name === `<${name}>k__BackingField`,
    );
    if (match) return match;
  }
  throw Error(`${className(klass)} has no field ${name}`);
}
const offset = (klass, name) => field(klass, name).offset;
const list = (klass, start, count) =>
  Array.from({ length: u16(klass + count) }, (_, i) => mem.ptr(mem.ptr(klass + start) + 8 * i));

// System.String confirms the class and field layouts used above.
const classes = findClasses([
  ['System', 'String'],
  ['CubeUnity.App.State', 'GameManager'],
  ['CubeUnity.App.Game', 'AvatarMenuPanel'],
]);
const stringClass = classes['System.String'];
if (offset(stringClass, '_stringLength') !== 0x10 || offset(stringClass, '_firstChar') !== 0x14)
  fail('Il2CppClass layout check failed on System.String.');
const managerClass = classes['CubeUnity.App.State.GameManager'],
  panelClass = classes['CubeUnity.App.Game.AvatarMenuPanel'];

// ---- Live objects: follow the same path the reader follows -----------------
const f = {};
f.manager = {
  state: offset(managerClass, '_state'),
  sceneManager: offset(managerClass, '_sceneManager'),
  currentGameMode: offset(managerClass, 'CurrentGameMode'),
  activeRemoteGame: offset(managerClass, '_activeRemoteGameInfo'),
};
const managers = scan([managerClass])
  .map((h) => h.address)
  .filter((a) => {
    try {
      return (
        mem.ptr(a + 0x10) && className(objectClass(mem.ptr(a + f.manager.state))).endsWith('.Game')
      );
    } catch {
      return false;
    }
  });
if (managers.length !== 1) fail(`Expected one GameManager instance, found ${managers.length}.`);
const manager = managers[0];
const live = (object, what) => {
  if (!object)
    fail(`${what} is empty. Play a match, then run this again during it or on its results.`);
  return object;
};
const sceneManager = live(mem.ptr(manager + f.manager.sceneManager), 'The scene manager');
const gameMode = live(mem.ptr(manager + f.manager.currentGameMode), 'CurrentGameMode');
const stateGame = live(mem.ptr(manager + f.manager.state), 'The state game');
f.sceneManager = { sceneName: offset(objectClass(sceneManager), '_nextPrimarySceneName') };
f.observable = { value: offset(objectClass(gameMode), '_value') };
f.activeRemoteGame = {
  gameId: offset(
    list(managerClass, CLASS.nestedTypes, CLASS.nestedTypeCount).find(
      (k) => cstring(mem.ptr(k + CLASS.name)) === 'ActiveRemoteGameInfo',
    ),
    'GameId',
  ),
};
f.stateGame = { remoteGame: offset(objectClass(stateGame), 'RemoteGame') };
const remote = live(mem.ptr(stateGame + f.stateGame.remoteGame), 'RemoteGame');
f.remoteGame = {
  clientGameInfo: offset(objectClass(remote), 'ClientGameInfo'),
  gameState: offset(objectClass(remote), 'GameState'),
};
const info = live(mem.ptr(remote + f.remoteGame.clientGameInfo), 'ClientGameInfo');
const game = live(mem.ptr(remote + f.remoteGame.gameState), 'GameState');
const gameClass = objectClass(game);
f.clientGameInfo = { localPlayerEntityId: offset(objectClass(info), 'LocalPlayerEntityId') };
f.game = {
  id: offset(gameClass, 'Id'),
  totalTurns: offset(gameClass, 'TotalTurns'),
  turn: offset(gameClass, 'Turn'),
  cubeValue: offset(gameClass, 'CubeValue'),
  clientResultMessage: offset(gameClass, 'ClientResultMessage'),
  playerWithInitiativeEntityId: offset(gameClass, 'PlayerWithInitiativeEntityId'),
  players: offset(gameClass, '_players'),
  entities: offset(gameClass, '_entityIdToEntity'),
};
const players = mem.list(mem.ptr(game + f.game.players));
if (players.length !== 2) fail('The game has no players yet. Run this during a match.');
const playerClass = objectClass(players[0]);
f.entity = { entityId: offset(playerClass, 'EntityId') };
f.player = { deck: offset(playerClass, 'Deck'), hand: offset(playerClass, 'Hand') };
const hand = mem.ptr(players[0] + f.player.hand);
f.zone = {
  zoneId: offset(objectClass(hand), 'ZoneId'),
  cards: offset(objectClass(hand), '_cards'),
};
const card = [...players]
  .flatMap((p) => [p + f.player.hand, p + f.player.deck])
  .flatMap((z) => mem.list(mem.ptr(mem.ptr(z) + f.zone.cards)))[0];
const cardClass = objectClass(live(card, 'A card'));
f.card = {
  owner: offset(cardClass, 'Owner'),
  cardDefId: offset(cardClass, 'CardDefId'),
  artVariantDefId: offset(cardClass, 'ArtVariantDefId'),
  turnRevealed: offset(cardClass, 'TurnRevealed'),
  revealed: offset(cardClass, 'Revealed'),
  cost: offset(cardClass, 'Cost'),
  power: offset(cardClass, 'Power'),
  startedInDeckEntityId: offset(cardClass, 'StartedInDeckEntityId'),
  visibleToPlayerEntityIds: offset(cardClass, '_visibleToPlayerEntityIds'),
  previousZone: offset(cardClass, '_previousZone'),
  zone: offset(cardClass, '_zone'),
};
f.stat = { value: offset(objectClass(mem.ptr(card + f.card.cost)), 'Value') };

const zoneEnum = enumMembers(mem.ptr(field(objectClass(hand), 'ZoneId').type));
const zones = [];
for (const [value, name] of zoneEnum) zones[value] = name;
if (zones.some((z) => z === undefined)) fail('ZoneId values are not contiguous.');
// ObservableProperty<GameMode>: generic_class -> context.class_inst -> argv[0].
const genericClass = mem.ptr(objectClass(gameMode) + 0x60);
const gameModeType = mem.ptr(mem.ptr(mem.ptr(genericClass + 8) + 8));
const remoteMode = enumMembers(mem.ptr(gameModeType)).find(([, name]) => name === 'Remote');
if (!remoteMode) fail('GameMode has no Remote member.');

// ---- TypeInfo and MethodInfo slots in GameAssembly's .data -----------------
const dataSection = maps.filter(
  (m) =>
    m.permissions === 'rw-p' &&
    !m.file &&
    m.start >= assembly.start &&
    m.start < assembly.start + 0x10000000,
);
const managerNested = list(managerClass, CLASS.nestedTypes, CLASS.nestedTypeCount);
const panelNested = list(panelClass, CLASS.nestedTypes, CLASS.nestedTypeCount);
const panelMethods = list(panelClass, CLASS.methods, CLASS.methodCount);
const slotHits = scan([...managerNested, ...panelNested, ...panelMethods], dataSection).sort(
  (a, b) => a.address - b.address,
);
const rva = (h) => h.address - assembly.start;
const managerNestedTypes = slotHits.filter((h) => managerNested.includes(h.value)).map(rva);
const avatarSlots = [
  ...slotHits.filter((h) => panelMethods.includes(h.value)).map((h) => [rva(h), METHOD_INFO_CLASS]),
  ...slotHits
    .filter((h) => panelNested.includes(h.value))
    .map((h) => [rva(h), CLASS.declaringType]),
];
if (!managerNestedTypes.length) fail('No initialized GameManager TypeInfo slot found yet.');
if (!avatarSlots.length) fail('No initialized AvatarMenuPanel slot found yet. Open a match first.');

// ---- Avatar panels and UnityPlayer vtables ----------------------------------
const panel = {
  cardsInHand: offset(panelClass, '_CardsInHand'),
  settingsObject: offset(panelClass, '_SettingsObject'),
};
const unityLayout = { nativeGameObject: 0x20, activeInHierarchy: 0x47 };
const vtables = scan([panelClass])
  .map((h) => h.address)
  .flatMap((object) => {
    try {
      const named = (at) => className(objectClass(mem.ptr(object + at)));
      if (!named(panel.settingsObject).endsWith('.GameObject')) return [];
      if (!named(panel.cardsInHand).includes('TextMeshPro')) return [];
      const native = mem.ptr(object + 0x10);
      const gameObject = mem.ptr(native + unityLayout.nativeGameObject);
      const active = mem.read(gameObject + unityLayout.activeInHierarchy, 1)[0];
      if (!native || active > 1) return [];
      return [[mem.ptr(native) - unity.start, mem.ptr(gameObject) - unity.start]];
    } catch {
      return [];
    }
  });
const distinct = [...new Set(vtables.map((v) => v.join()))];
if (distinct.length !== 1) fail(`Expected one native vtable pair, found ${distinct.length}.`);
const [monoBehaviourVtable, gameObjectVtable] = vtables[0];

// ---- Result ------------------------------------------------------------------
function gameVersion() {
  const steamapps = path.resolve(path.dirname(assembly.file), '..', '..');
  const log = path.join(
    steamapps,
    'compatdata/1997040/pfx/drive_c/users/steamuser/AppData/LocalLow/Second Dinner/SNAP/Player.log',
  );
  try {
    return fs.readFileSync(log, 'utf8').match(/GameStartupController\|Start\|Version=v([\d.]+)/)[1];
  } catch {
    return 'unknown';
  }
}
const profile = {
  version: gameVersion(),
  sha256: sha256(assembly.file),
  unitySha256: sha256(unity.file),
  managerNestedTypes,
  gameModeRemote: remoteMode[0],
  zones,
  fields: f,
  avatar: {
    slots: avatarSlots,
    panel,
    unity: { monoBehaviourVtable, gameObjectVtable, ...unityLayout },
  },
};
const hex = (value) =>
  JSON.stringify(value, (_, v) => (typeof v === 'number' ? `0x${v.toString(16)}` : v), 2).replace(
    /"(0x[\da-f]+)"/g,
    '$1',
  );
fs.mkdirSync('.cache', { recursive: true });
const out = path.join('.cache', `reader-profile-${profile.version}.json`);
fs.writeFileSync(out, JSON.stringify(profile, null, 2) + '\n');
console.log(hex(profile));
console.log(`\nSaved ${out}`);
if (process.argv.includes('--dump')) {
  const dumped = [managerClass, panelClass, objectClass(sceneManager), objectClass(stateGame)];
  dumped.push(objectClass(remote), objectClass(info), gameClass, playerClass, cardClass);
  const lines = [];
  for (const klass of dumped)
    for (let c = klass; c; c = mem.ptr(c + CLASS.parent)) {
      lines.push('== ' + className(c));
      for (const x of ownFields(c)) lines.push(`  0x${x.offset.toString(16)} ${x.name}`);
    }
  const dump = path.join('.cache', `reader-classes-${profile.version}.txt`);
  fs.writeFileSync(dump, lines.join('\n') + '\n');
  console.log(`Saved ${dump}`);
}

// ---- Self-check: decode with the candidate profile ----------------------------
if (!PROFILES) {
  console.log('\nThis memory.cjs does not take a profile yet; skipping the decode check.');
} else {
  const managerType = mem.ptr(manager);
  const result = decodeGame(mem, manager, managerType, profile);
  if (result.lobby || !result.raw)
    console.log('\nSelf-check: in the lobby. Run it during a match.');
  else {
    const state = result.raw.RemoteGame.GameState;
    const local = result.raw.RemoteGame.ClientGameInfo.LocalPlayerEntityId;
    const counts = {};
    for (const e of Object.values(state._entityIdToEntity)) {
      const side = e.Owner.EntityId === local ? 'own' : 'opponent';
      const origin = e.StartedInDeckEntityId ? 'deck' : 'generated';
      const key = `${side} ${e._zone.ZoneId} (${origin})`;
      counts[key] = (counts[key] || 0) + 1;
    }
    console.log(`\nSelf-check: turn ${state.Turn}/${state.TotalTurns}, game ${state.Id}`);
    for (const p of state._players)
      console.log(
        `  player ${p.EntityId}${p.EntityId === local ? ' (you)' : ''}: deck ${p.Deck._cards.length}, hand ${p.Hand._cards.length}`,
      );
    for (const [key, n] of Object.entries(counts).sort()) console.log(`  ${key}: ${n}`);
  }
}
if (PROFILES?.[profile.sha256] || profile.sha256 === PROFILE.sha256)
  console.log('\nThis build already has a profile.');
mem.close();
