# Contributing

Snapper accepts fixes and features under [PolyForm Noncommercial 1.0.0](LICENSE.md).
By submitting changes, you confirm that you have the right to contribute them
under that license. Commercial use is not granted by this project.

## Local development

Use Node.js 22.12 or newer. Linux with Python 3, X11 or XWayland, libX11 and
libXext is required for native UI tests. The core tests do not require the game.

```sh
npm ci
npm run check
npm test
npm run format:check
```

Use `npm run format` before sending changes. Follow the existing CommonJS
modules and keep game parsing independent of Electron and the network. Add
tests for changed tracking behavior, security boundaries and failure handling.
Avoid frameworks, base classes and abstractions without a second concrete use.

UI checks use synthetic data and the original Snapper icon as placeholder art.
They do not contact Snap.fan or depend on a developer's caches:

```sh
npm run test:visibility
npm run test:interaction
npm run test:deck-layout
npm run test:input-bounds
```

Use `npm run demo` to inspect actual artwork. Live tracking and packaged worker
checks require the supported Marvel Snap build. Do not change game memory, inject
code, disable the Electron sandbox or expose hidden opponent cards.

## Pull requests

Describe the problem, the resulting behavior and the checks you ran. Use
Conventional Commits, such as `fix: retain cards on the results screen`. Keep
unrelated behavior changes separate. Include screenshots for visible UI changes,
using demo data rather than player names or account information.

Never submit game JSON, memory dumps, decompiled game binaries or metadata,
downloaded card artwork, personal settings, credentials or cached account data.
The ignored `.cache/`, `artifacts/` and `dist/` folders are not source material.

Report sensitive security issues as described in [SECURITY.md](SECURITY.md).
