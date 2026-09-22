# Snapper

A Marvel Snap card overlay for Linux, inspired by LTD2 Smart Overlay, Untapped and Marvel Snap Zone. Source available for noncommercial use under [PolyForm Noncommercial 1.0.0](LICENSE.md). Electron runs natively on Linux while the game runs through Steam/Proton. All app text is in English.

## Setup

Requires Node.js 22.12 or newer, Python 3, X11 or XWayland, libX11 and libXext. Hyprland integration is optional.

```bash
npm ci
npm run setup
npm start
```

`setup` downloads Electron if the package manager has not installed it. `npm run demo` opens sample panels without the game.

To start Snapper automatically with Marvel Snap:

```bash
npm run install:linux
```

This installs `~/.local/bin/snapper`, an application menu entry and `~/.config/autostart/snapper-watcher.desktop`. A small Node process checks for `SNAP.exe` every two seconds. Electron opens with the game and closes when it exits. Quitting Snapper from the tray prevents another launch until the next game session. Keep this project at its installed path, or run the installer again after moving it.

For Omarchy / Hyprland 0.55 or newer with Lua configuration:

```bash
npm run install:hyprland
```

The installer adds floating window rules, preserves a backup and checks `hyprctl configerrors`, reverting invalid changes. Panels use XWayland for positioning and click-through. Other Wayland compositors may need their own rules, especially over fullscreen games. Borderless windowed mode offers the broadest compatibility.

Launchers pass `--ozone-platform=x11` before Electron loads application JavaScript. Setting this switch later can produce invisible windows. Linux input handling requires Python 3 and libX11/libXext.

## Controls

| Action               | Shortcut         |
| -------------------- | ---------------- |
| Show or hide panels  | Ctrl + Shift + O |
| Toggle click-through | Ctrl + Shift + L |
| Open settings        | Ctrl + Shift + , |

Drag a panel header to move it. Positions are saved as offsets from the game window and follow its movement. Existing absolute positions migrate automatically. Panels start interactive: scroll with the wheel, expand piles and hover over cards for abilities. The header lock enables click-through over the cards; header controls remain accessible. Native windows shrink to the visible panel, leaving the space below available to the game. Card tooltips stay within the panel and open upward near its bottom without resizing the window. Only header tooltips on a minimized panel can temporarily expand the native window.

Only your deck appears in the lobby. The opponent panel appears during a match and remains visible on the results screen until you return to the lobby. Opening either avatar menu hides both panels until that menu closes. Manual visibility settings are preserved.

## Cards and artwork

- Always show the complete selected deck, without filter tabs. Both deck panels sort cards by ascending current cost, falling back to base cost for unseen cards.
- Show observed cards from the opponent’s original deck, including remembered cards returned to hand and cards you steal. Stolen cards also appear in your Added section; piles follow current ownership. Generated cards and cards taken from your deck are excluded from the opponent grid, piles and history.
- Use four columns of full card art with closely spaced rows. Compact mode uses five columns.
- Keep remaining own-deck cards in color and gray out drawn, played and other cards outside your deck. Cards returned to your deck regain color. Opponent styling is unchanged. Omit per-card status labels and check marks.
- Display deck and hand counts, added cards and observed movement history. Discarded, Destroyed and Banished piles sit side by side in one row. Omit deck names, turn, cubes and the overlay status footer.
- Show only the English ability description on hover or keyboard focus, with labels such as **On Reveal:** and **When Discarded:** in bold. Cache descriptions for 24 hours and reuse them offline.
- Optionally use each card's equipped variant through **Use in-game variants**, disabled by default. Unavailable variants fall back to base art. Finishes, borders and animations are not reproduced.

Art comes from Snap.fan and is cached locally. Missing images retain a text fallback. Button tooltips render inside the overlay so native window stacking cannot hide them behind the panel.

An unobserved own-deck card stays in color, but is not guaranteed to remain in the deck. It may have been stolen, transformed or removed without public information. Counts come from game zones; hidden identities are not inferred. The opponent's full result deck is never used.

History records transitions between observed states, rather than every effect. Several discards and revivals between reads cannot be reconstructed. Graveyard classification uses the previous zone: hand means discarded; board or deck means destroyed. Unknown causes remain unknown.

## Live data and saved states

On supported Linux/Proton builds, a worker reads match state every 350 ms from `/proc/<pid>/mem`, opened read-only. It finds the active game manager and follows its references without injecting code, capturing traffic, changing focus or modifying the game. A separate worker checks avatar menu visibility every 100 ms.

The included reader profile targets Snap 57.17 and verifies `GameAssembly.dll` against its SHA-256 profile before using offsets. Avatar detection also verifies `UnityPlayer.dll`. Unsupported builds or process-reading restrictions disable live reading. On Linux, local JSON files can supplement a match confirmed by live reading, but cannot activate the opponent panel on their own. They may take minutes to change. Connection status is available in settings. Cards and history remain available on the results screen and clear when entering the lobby. Delayed data cannot restore a cleared match.

Steam installations, Flatpak and additional libraries in `libraryfolders.vdf` are detected automatically. You can also choose the state folder in settings:

```text
steamapps/compatdata/1997040/pfx/drive_c/users/steamuser/AppData/LocalLow/Second Dinner/SNAP/Standalone/States/nvprod
```

Snapper reads `GameState.json`, `CollectionState.json` and `PlayState.json`, resolving Newtonsoft `$id` and `$ref` references. Settings and cached assets normally live in `~/.config/Snapper/`.

Only artwork and ability retrieval contact `snap.fan` and `game-assets.snap.fan`, using card identifiers. Accounts, matches and collections are not uploaded. Hidden opponent identities and stats are filtered before reading. Session history stays in memory. Do not publish raw game JSON: it contains account identifiers and other personal data. Tests use synthetic fixtures. See [SECURITY.md](SECURITY.md) for trust boundaries and reporting instructions.

## Development

```bash
npm run check
npm test
npm run diagnose          # local diagnosis without account data
npm run test:ui           # native windows, cards, images and settings
npm run test:interaction  # scrolling and card/control tooltips
npm run test:drag         # repeated dragging and X11 input regions
npm run test:input-bounds # native windows fit visible panels and tooltips
npm run test:deck-layout  # pile layout, original opponent cards and cost sorting
npm run test:follow       # game-relative positions
npm run test:variants     # base/variant switching and persistence
npm run pack              # dist/linux-unpacked/snapper
npm run test:installed    # packaged live reader; game must be open
npm run dist              # Linux AppImage
```

UI tests need a graphical session and temporarily open windows with isolated settings and offline fixtures. They use the original project icon as placeholder art and do not download card art or require a private cache. Screenshots go into `artifacts/`. Tests cover hidden cards, staged plays, invalid references, match transitions, variant identity and saved-state fallback. Demo screenshots verify presentation; they do not prove live tracking.

```text
src/core/       Snapshot normalization and card tracking
src/services/   Readers, Steam/process detection and asset caches
src/ui/         Overlay panels and settings
src/main.cjs    Windows, tray, shortcuts and IPC
scripts/        Installation, diagnostics and UI checks
integrations/   Hyprland rules
test/           Reader and tracker fixtures
```

The core and windows account for Windows, but this release is built and tested on Linux. Windows autostart installation and live reading are not implemented.

## Uninstall

```bash
npm run uninstall:linux
```

Removes the launcher, watcher and Hyprland rule block. Settings, cached artwork and backups are preserved.

## References

The original LTD2 overlay in `../ltd2-smart-overlay` informed the architecture. Snapper uses independent native windows.

- [Marvel Snap Tracker state reader](https://github.com/Razviar/marvelsnaptracker/blob/master/src/app/log-parser/log_parser.ts)
- [Helper for Marvel Snap](https://github.com/johnvictorfs/helper-for-marvel-snap)
- [Electron custom window interactions](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions)
- [Hyprland window rules](https://wiki.hypr.land/Configuring/Basics/Window-Rules/)
- [Snap.fan card artwork](https://snap.fan/cards/)

Independent project, unaffiliated with Marvel, Second Dinner, Untapped or Snap.fan. Artwork belongs to its respective owners. The Snapper icon is an original project vector.

## Contributing and licensing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks and pull requests, and
[the architecture guide](docs/architecture.md) for extension points. Run
`npm run format:check` alongside syntax and behavior checks. CI runs core checks
on Node.js 22 and 24, plus offline Electron smoke checks on Linux.

You may use, modify and distribute Snapper for the noncommercial purposes
permitted by [PolyForm Noncommercial 1.0.0](LICENSE.md). Commercial use is not
granted. This restriction means the project is source-available rather than
OSI-approved open source. See [third-party notices](THIRD_PARTY_NOTICES.md) for
artwork, trademarks and bundled dependency licenses.

The [review record](docs/security-review.md) lists addressed issues and remaining
limits. Publish reviewed source through version control; do not upload this
whole working directory, which may contain ignored personal and game data.

`npm run source:archive` creates a source-only archive under `dist/` from an
explicit list of source directories. It excludes caches, screenshots, binaries
and dependencies, and rejects symlinks and known private state files. Review its
contents before sharing it.
