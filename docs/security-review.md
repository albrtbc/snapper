# Source and security review

Review date: 2026-09-22. This is a source review and regression check, not an
independent penetration test or certification.

## Findings addressed

| Finding                                                                     | Change                                                                                                         |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Several IPC routes accepted any sender; others checked only the window      | Every route uses one router checking registered window, top-level frame, exact local document and allowed role |
| Electron permission requests had no deny policy                             | Permission checks and requests are explicitly denied; frame navigation and webview attachment are blocked      |
| Download limits were checked after buffering or only through Content-Length | Bodies are capped while streaming; MIME types, HTTPS hosts and redirect policy are checked                     |
| Download queues and completed artwork promises could accumulate             | Queues have a pending-work bound; fulfilled and failed artwork requests leave the in-flight map                |
| Persisted settings were spread into the runtime object without validation   | Only supported keys and bounded values are accepted, with independent defaults for each load                   |
| A stopped reader could still emit an in-flight file result                  | Reader generations invalidate callbacks and pending polls after stop/restart                                   |
| Some UI checks required another test's cache and contacted artwork servers  | Smoke checks now install explicit offline fixtures using original project art                                  |
| Compressed one-line source made review and maintenance difficult            | A pinned formatter and format check establish a consistent readable style                                      |
| Publication had no license, contribution guidance or automated checks       | License, notices, security policy, contribution guide and CI configuration are included                        |

The original implementation already used sandboxed, isolated renderers, no Node
integration, text-node rendering, read-only process access, build hash checks,
public-card filtering and synthetic unit fixtures. Those protections remain.

## Validation and limits

The automated checks cover IPC authorization, malformed settings, download
validation, oversized streaming responses, queue saturation, reader shutdown and
existing card privacy/tracking behavior. Native UI checks exercise real Electron
windows and the preload API with offline fixtures. Audit and test results are
reported with the change, rather than treated as a permanent guarantee.

Known limits:

- Only the supported Linux/Proton game build is covered by live-reading offsets.
  Windows packaging is present but its live reader and autostart are not shipped.
- Local `file:` pages and cached artwork remain in use. Exact document checks,
  restricted CSP and a narrow preload API limit exposure. Moving to a dedicated
  application protocol would be further hardening, not something this review
  claims to have done.
- Distribution signing and automatic updates are not configured. Re-audit
  dependencies and inspect release contents before publishing each binary.
- The initial remote CI run passed on GitHub. Release tags now run separate
  build, installer and UI checks before publishing assets. Private vulnerability
  reporting must be enabled separately in repository settings.
- The current packaging toolchain includes deprecated transitive packages
  (`glob`, `inflight`, `rimraf` and `boolean`). They are development dependencies;
  no known advisories were reported in this review. Track upstream updates rather
  than forcing incompatible transitive versions.
- The project folder contains ignored local caches, screenshots and reverse
  engineering files. Never publish the entire working directory as a ZIP. Share
  only reviewed source files; `.gitignore` is not a general archive filter.

## Licensing

The requested noncommercial restriction is implemented with the unmodified
[PolyForm Noncommercial 1.0.0 license](../LICENSE.md). This is source-available,
not OSI-approved open source, because commercial use is restricted. Third-party
artwork and game assets are not relicensed by this project.

References: [Electron security recommendations](https://www.electronjs.org/docs/latest/tutorial/security),
[PolyForm Noncommercial](https://polyformproject.org/licenses/noncommercial/1.0.0),
[Open Source Definition](https://opensource.org/osd).

## Checks completed in this review

- 47 automated core/security/installation tests and four watcher tests passed.
- Syntax and formatting checks passed.
- Eight native UI suites passed: visibility, interaction, deck layout, variants,
  input bounds, dragging, game-window following and general smoke checks.
- A real HTTPS artwork and ability request succeeded with the bounded downloader.
- `npm audit` reported zero known advisories, including development dependencies.
- The source archive was extracted into a fresh directory; dependency installation,
  core tests, syntax, formatting and native interaction checks passed there.
- Packaged sources and license notices match the reviewed files. No private
  state files, caches or test helpers appear in the application archive.
- The packaged variant/settings smoke check also passed using offline fixtures.

The initial CI run passed on GitHub. The AppImage installer and singleton watcher
checks passed from the extracted package. The packaged live-reader check also
passed with Marvel Snap open in the lobby.
