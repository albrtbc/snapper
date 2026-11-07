// Read only the visible avatar-menu flag from the supported Unity build.
// This reader runs separately from card tracking, so discovery never stalls it.
const fs = require('node:fs'),
  crypto = require('node:crypto');
const { ProcessMemory, PROFILE, profileFor, LAYOUT } = require('./memory.cjs');
const sha256File = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function mapsFor(pid) {
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
function visibleMenu(mem, object, klass, unity, profile = PROFILE) {
  const u = profile.avatar.unity;
  if (mem.ptr(object) !== klass) return null;
  const native = mem.ptr(object + LAYOUT.unityObject.cachedPtr);
  if (!native) return null;
  // Concrete native MonoBehaviour and GameObject vtables, hash pinned in the profile.
  if (mem.ptr(native) !== unity + u.monoBehaviourVtable) return null;
  const gameObject = mem.ptr(native + u.nativeGameObject);
  if (!gameObject || mem.ptr(gameObject) !== unity + u.gameObjectVtable) return null;
  // AvatarMenuPanel.IsVisible -> gameObject.activeInHierarchy. Unity's getter
  // reads this byte. 0xff is an uncomputed cache; do not call the getter or write it.
  const active = mem.read(gameObject + u.activeInHierarchy, 1)[0];
  return active === 0 ? false : active === 1 ? true : null;
}
class AvatarMenus {
  constructor(pid) {
    this.pid = pid;
    this.objects = [];
    const maps = mapsFor(pid);
    const assembly = maps.find((m) => m.offset === 0 && m.file.endsWith('/GameAssembly.dll'));
    const unity = maps.find((m) => m.offset === 0 && m.file.endsWith('/UnityPlayer.dll'));
    if (!assembly || !unity) throw Error('Waiting for game modules');
    let profile;
    try {
      profile = profileFor(sha256File(assembly.file));
    } catch (error) {
      if (error.code !== 'SNAP_UNSUPPORTED') throw error;
      throw Error('Unsupported avatar-menu build');
    }
    if (sha256File(unity.file) !== profile.unitySha256)
      throw Error('Unsupported avatar-menu build');
    this.profile = profile;
    this.base = assembly.start;
    this.unity = unity.start;
    this.mem = new ProcessMemory(pid);
  }
  discover() {
    const mem = this.mem,
      panel = this.profile.avatar.panel;
    let klass = 0;
    // Init resolves these callback MethodInfos before either menu is opened.
    // The nested type fallback may only initialize when graveyard counts load.
    for (const [slot, offset] of this.profile.avatar.slots) {
      try {
        const metadata = mem.ptr(this.base + slot);
        if (metadata < 65536 || metadata % 8) continue;
        const candidate = mem.ptr(metadata + offset);
        if (
          candidate >= 65536 &&
          candidate % 8 === 0 &&
          mem.typeName(candidate) === 'AvatarMenuPanel'
        ) {
          klass = candidate;
          break;
        }
      } catch {}
    }
    if (!klass) return false;
    this.klass = klass;
    const needle = Buffer.alloc(8);
    needle.writeBigUInt64LE(BigInt(klass));
    const found = [],
      deadline = Date.now() + 4000;
    for (const map of mapsFor(this.pid)) {
      if (map.permissions !== 'rw-p' || map.file) continue;
      for (let start = map.start; start < map.end; start += 4 * 1024 * 1024) {
        if (Date.now() > deadline) {
          this.objects = found;
          return found.length > 0;
        }
        let bytes;
        try {
          bytes = mem.read(start, Math.min(4 * 1024 * 1024, map.end - start));
        } catch {
          continue;
        }
        for (let i = bytes.indexOf(needle); i >= 0; i = bytes.indexOf(needle, i + 8)) {
          const object = start + i;
          if (object % 8) continue;
          try {
            if (visibleMenu(mem, object, klass, this.unity, this.profile) === null) continue;
            if (
              mem.className(mem.ptr(object + panel.settingsObject)) !== 'GameObject' ||
              !mem.className(mem.ptr(object + panel.cardsInHand)).includes('TextMeshPro')
            )
              continue;
            found.push(object);
          } catch {}
        }
      }
    }
    this.objects = found;
    return found.length > 0;
  }
  read() {
    const values = this.objects.map((object) => {
      try {
        return visibleMenu(this.mem, object, this.klass, this.unity, this.profile);
      } catch {
        return null;
      }
    });
    this.objects = this.objects.filter((_, i) => values[i] !== null);
    return { open: values.includes(true), available: this.objects.length >= 2 };
  }
  close() {
    this.mem.close();
  }
}
module.exports = { AvatarMenus, visibleMenu };
