# Architecture

Snapper is a local Electron application. It has no server, account system or
database. Keep that arrangement unless a feature needs a concrete new component.

## Data flow

The Linux live worker reads a hash-pinned game build and redacts hidden card
identities. `snapshot.cjs` normalizes live or saved JSON into the same model.
`tracker.cjs` preserves observed identities, original-deck membership and movement
history. `reader.cjs` selects fresh input and owns match/lobby transitions.

The main process composes these services, owns native windows and sends normalized
state through the preload bridge. Renderers display that state and send narrowly
scoped requests. They never read game files or memory themselves.

Card artwork and ability text have separate disk caches. Both use the same
bounded HTTP reader and queue implementation. No game-state data is sent to
these hosts.

## Boundaries

| Module                                | Responsibility                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| `src/core/`                           | Snapshot normalization and tracking, without Electron or network dependencies |
| `services/memory.cjs`                 | Read-only process access and a versioned binary profile                       |
| `services/reader.cjs`                 | Input freshness, worker lifecycle and match state                             |
| `services/ipc-security.cjs`           | Authorized windows, roles, navigation and permissions                         |
| `services/settings.cjs`               | Allowed preferences and persisted setting validation                          |
| `services/http.cjs`, `task-queue.cjs` | Download limits and concurrency                                               |
| `src/main.cjs`                        | Electron lifecycle, window interaction and service composition                |
| `src/preload.cjs`                     | Explicit renderer API with no generic IPC access                              |
| `src/ui/`                             | Rendering, tooltips and local interaction                                     |

Use functions for transformations and small stateful classes for services that
own a cache, connection or lifecycle. Prefer explicit dependencies and focused
tests over inheritance or a dependency-injection framework. `main.cjs` still
owns several native-window concerns; split a concern when it changes separately,
not merely to meet a line-count rule.

## Extending behavior

- Card origins and current owners are separate. A stolen opponent card belongs
  in both the rival's known deck and our Added section. Piles follow the current
  owner. Generated cards do not become evidence about an original deck.
- The game ending does not leave its results screen. Only entering the lobby
  clears tracked cards. Old files cannot establish a live Linux match.
- Add an IPC route through the secure router, specify its roles and validate its
  payload. Do not expose arbitrary channel names through the preload bridge.
- A game update requires a reviewed reader profile and matching binary hash.
  Do not relax the hash check to make an unknown build load.
- Keep ability emphasis as text nodes with inline elements. Never render remote
  HTML, even when the source is a known card site.

`npm test` uses synthetic inputs. Native smoke checks patch services with offline
fixtures in `test/helpers/`; these hooks are not part of the packaged app.

## Linux distribution

`entry.cjs` routes AppImage installation and removal before loading the overlay.
`linux-install.cjs` installs a stable per-user executable, launcher and desktop
entries. Source installs reuse the same integration. `watch-game.py` holds an
exclusive process lock and launches at most once per observed game session. It
uses system Python, not a source checkout or Node installation, and terminates
the AppImage process group when the game exits.
