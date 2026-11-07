# Reader profiles

The Linux live reader (`src/services/memory.cjs`) reads Marvel Snap's memory at
fixed offsets. Those offsets belong to one game build, so every entry in
`PROFILES` is pinned to the SHA-256 of that build's `GameAssembly.dll`, and
avatar detection also pins `UnityPlayer.dll`. When Snap updates, the hashes stop
matching. Live tracking then stops, and Snapper shows a warning on the overlay's
settings button, in settings and in the tray. Supporting the new build needs a
new, reviewed profile. Never relax the hash check to make an unknown build load.

## 1. Confirm the build changed

- The game version is in the `GameStartupController|Start|Version=v…` line of
  `Player.log`, under the Proton prefix:
  `steamapps/compatdata/1997040/pfx/drive_c/users/steamuser/AppData/LocalLow/Second Dinner/SNAP/Player.log`.
  `Player-prev.log` holds the previous session.
- `sha256sum "steamapps/common/MARVEL SNAP/GameAssembly.dll"` has no entry in
  `PROFILES`.
- The Unity version is the `Initialize engine version:` line of the same log.

## 2. Derive a candidate

1. Start Marvel Snap and play a match. Stay in it, or on its results screen.
2. Run `node scripts/derive-profile.cjs --dump` from the repository root.

The script only reads `/proc/<pid>/mem` and the game's files. It never
attaches, writes or injects code. It works in five steps:

1. Checks that `global-metadata.dat` is v31 and confirms the `Il2CppClass` and
   `FieldInfo` layouts against `System.String`.
2. Finds `GameManager` and `AvatarMenuPanel` through their names in the mapped
   metadata, then the live `GameManager`.
3. Follows the same objects the reader follows (scene manager, state game,
   RemoteGame, ClientGameInfo, Game, Player, Zone, Card, stat) and reads every
   field offset by name. It reads the `ZoneId` order and the `GameMode.Remote`
   value from the metadata enums.
4. Scans GameAssembly's `.data` for the metadata-usage slots that hold
   `GameManager`'s nested classes (`managerNestedTypes`), and `AvatarMenuPanel`'s
   methods or nested classes (`avatar.slots`).
5. Reads both UnityPlayer vtables from the live avatar panels.

It prints the candidate as JS with hex numbers and saves it to
`.cache/reader-profile-<version>.json`. `--dump` also saves the field tables to
`.cache/reader-classes-<version>.txt`. Both stay in the ignored `.cache/`
folder: never commit metadata, dumps or decompiled code.

Usage slots fill in lazily: they hold an odd encoded token until the game first
uses them. The reader skips those, so keep every slot the script finds. Run the
script after a match so most of them are filled in.

## 3. Review and apply

1. Compare the candidate with the previous entry. Expect shifted offsets, not
   renamed fields. If the script stops because a field is missing, the game
   renamed or removed it, and the reader's use of it needs review.
2. Add the entry to `PROFILES` in `src/services/memory.cjs`, keyed by its
   `sha256`.
3. Remove entries for builds the game no longer runs. Snap forces updates.
4. Update the supported version in `README.md`.

Fields the profile maps. The script reads them by these names:

| Profile key                          | Class.field                                                    |
| ------------------------------------ | -------------------------------------------------------------- |
| `manager.state`                      | `TStateManager<Game>._state` (GameManager base)                |
| `manager.sceneManager`               | `GameManager._sceneManager` (first word is `CubeSceneManager`) |
| `manager.currentGameMode`            | `GameManager.CurrentGameMode` (`ObservableProperty<GameMode>`) |
| `manager.activeRemoteGame`           | `GameManager._activeRemoteGameInfo`                            |
| `sceneManager.sceneName`             | `CubeSceneManager._nextPrimarySceneName`                       |
| `observable.value`                   | `ObservableProperty<T>._value`                                 |
| `activeRemoteGame.gameId`            | `GameManager.ActiveRemoteGameInfo.GameId`                      |
| `stateGame.remoteGame`               | `CubeUnity.App.State.Game.RemoteGame`                          |
| `remoteGame.clientGameInfo`          | `CommonGame.ClientGameInfo`                                    |
| `remoteGame.gameState`               | `CommonGame.GameState` (`CubeGame.Game`)                       |
| `clientGameInfo.localPlayerEntityId` | `ClientGameInfo.LocalPlayerEntityId`                           |
| `game.*`                             | `CubeGame.Game`: `Id`, `TotalTurns`, `Turn`, `CubeValue`,      |
|                                      | `ClientResultMessage`, `PlayerWithInitiativeEntityId`,         |
|                                      | `_players`, `_entityIdToEntity`                                |
| `entity.entityId`                    | `CubeGame.Entity.EntityId`                                     |
| `player.deck`, `player.hand`         | `CubeGame.Player.Deck`, `.Hand`                                |
| `zone.zoneId`, `zone.cards`          | `CubeGame.Zone.ZoneId`, `._cards`                              |
| `card.*`                             | `CubeGame.Card`: `Owner`, `CardDefId`, `ArtVariantDefId`,      |
|                                      | `TurnRevealed`, `Revealed`, `Cost`, `Power`,                   |
|                                      | `StartedInDeckEntityId`, `_visibleToPlayerEntityIds`,          |
|                                      | `_previousZone`, `_zone`                                       |
| `stat.value`                         | `OngoingStat<int>.Value`                                       |
| `avatar.panel.*`                     | `AvatarMenuPanel._CardsInHand`, `._SettingsObject`             |

The reader treats a match as active only while three conditions hold:

- The scene name is `Game`.
- `CurrentGameMode` equals `gameModeRemote`. Local tutorial games and replays
  are skipped.
- The active remote game's `GameId` equals `Game.Id`.

## 4. Verify

1. With the entry in place, run the script again. Its self-check decodes the
   live match through `decodeGame` with the new profile and prints:
   - the turn;
   - deck and hand counts per player;
   - card counts per side and zone, separating deck cards from generated ones.

   Compare them with the screen.

2. Run `npm test`. `test/memory.test.cjs` builds its synthetic memory from
   `PROFILE`.
3. Run `npm run pack`, then `npm run test:installed` with the game open.
4. Play a match with the packaged app and check the overlay against the game:
   - The Deck and Hand counters follow the game.
   - Drawn and played cards turn gray.
   - The discard and destroy piles fill.
   - Stolen cards appear under Added.
   - The opponent panel shows revealed cards.
   - The lobby clears both panels.
   - The avatar menu hides the panels.

## Unity upgrades

The `Il2CppClass`, `FieldInfo`, `List`, `Dictionary` and string layouts belong
to the Unity version, currently 6000.0 with metadata v31, not to the game
build. They live as constants in `memory.cjs` and in the script. When Snap moves
to a new Unity version, the script stops at the metadata version check or the
`System.String` layout check. Review those constants before trusting any
offset.

## History

| Build   | Changes                                                                                                                                                                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 57.17   | First profile. No derivation record.                                                                                                                                                                                                                    |
| 58.15.1 | `GameManager` fields after `_sceneManager` moved −0x10. `CubeGame.Game` fields after `Id` moved +0x8. `Card` fields from `TurnRevealed` on moved +0x8. `ZoneId` gained `Trinket`. All usage slots moved. UnityPlayer was re-signed only (same vtables). |
