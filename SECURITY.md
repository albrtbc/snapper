# Security

## Reporting a vulnerability

Use the repository's private vulnerability reporting form under **Security →
Report a vulnerability** when it is available. Do not include exploit details,
account identifiers, game JSON or memory dumps in a public issue. If private
reporting is unavailable, open an issue requesting a private contact without
including the vulnerability details.

This project has no guaranteed response time. Security fixes target the latest
development version; there are no maintained older release branches.

## Trust boundaries

- Renderers load bundled local pages with sandboxing and context isolation.
  Node integration is disabled. IPC accepts only registered top-level windows
  on their assigned document; settings changes require the settings window.
- Navigation, popup windows, embedded frames and permission requests are denied.
  Remote ability text becomes text nodes, never executable HTML.
- The main process fetches only HTTPS pages and images from `snap.fan` and
  `game-assets.snap.fan`. Redirects are rejected. HTML is capped at 2 MiB and
  images at 3,000,000 bytes while streaming, including decompressed responses.
  The card-list pages fall under the same HTML cap. They are parsed as data and
  never executed. Card ids must match the safe-id pattern. The only URLs taken
  from them are base image URLs on `game-assets.snap.fan` of the expected form,
  and those are downloaded. Name, cost, power, type and release date are stored
  in `card-pool.json` as plain data.
- The Linux reader opens game memory read-only, verifies supported binary hashes
  and filters hidden opponent identities before reading their values. Saved
  state files are local, limited to 64 MiB each and never uploaded.
- Download queues are bounded. Local settings and incoming UI values are checked
  before changing native windows or writing settings.

The application runs with the current user's filesystem permissions. It does
not defend against another program already able to edit its installed code or
the same user's files. Chromium image decoding and the Electron runtime remain
part of the trust boundary; keep dependencies current.

No account service, telemetry or automatic update service is included. Artwork
and ability requests disclose card identifiers and the user's network address
to their hosting services. Card-list requests are sent by the weekly startup
update and by Update card pool; they disclose only the network address. After a
successful check, cached art is re-checked at most every 7 days per image (6
hours for placeholders). While Snapper runs, a failed check is not retried for
10 minutes. The card pool update downloads new or changed base art for every
listed card; on a new install, the first update downloads all of it. Cached
assets and settings remain on disk after uninstalling the launcher.

## Release checks

Run `npm audit`, `npm test`, `npm run check` and the relevant UI checks for each
release. Inspect packaged files and retain Electron's bundled license notices.
An audit with no known advisories is not a proof that the application has no
vulnerabilities. See [the review record](docs/security-review.md) for the scope
and limits of the current review.
