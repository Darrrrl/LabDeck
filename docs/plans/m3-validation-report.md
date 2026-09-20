# M3 validation report

Date: 2026-09-20

## Milestone/task

M3.1–M3.3 — Jellyfin and first usable release.

## Completed acceptance criteria

- Added fixed-route, GET-only Jellyfin transport for system info, sessions, item counts and a bounded twelve-item recent query. Requests use header authentication, retain configured API path prefixes, reject redirects, time out after five seconds and reject bodies over 2 MiB.
- Added independent connection (30s), playback (10s) and library (5m) groups. A library failure cannot remove playback, and any group failure retains its last-good normalized data and original observation time.
- Normalized media-bearing sessions only, including user, title/subtitle, paused state, progress, direct-play/direct-stream/transcode/unknown mode and optional bitrate with its evidence source.
- Added baseline-safe playback observations. Initial sessions do not create start events; newly observed session/media pairs create one minimal typed event and replay does not duplicate it.
- Added cached `/api/v1/media`, overview summary/Currently Watching, Media page, counts, recent additions, explicit stale/auth/unreachable states and a separately configured browser launch URL.
- Added deployment override and read-only live runner. The key is read only from a restricted server-side file and is absent from public contracts, browser bundles, URLs, normalized persistence and event payloads.

## Files/contracts changed

- Public media/session/overview/settings contracts in `packages/contracts`.
- Shared bounded read-only transport plus Jellyfin adapter, monitor and state persistence in `apps/server`.
- Media query/API and React page, overview summary, navigation and responsive styles.
- Synthetic 10.10.7-shaped fixtures, Jellyfin integration tests, responsive browser journey and Compose configuration.
- Migration 003 adds per-poll-group attempt/error evidence to `poll_state`.

## Commands actually run and results

- `npm run test:unit` — passed, 7 files / 16 tests.
- `npm run test:integration -- --project=jellyfin` — passed, 1 file / 10 tests.
- `npm run check` — passed typecheck, lint, documentation links and production builds.
- `npm run test:integration` — passed, 13 files / 49 tests.
- `npm run test:security` — passed build and secret/deployment boundary scan.
- `PLAYWRIGHT_BROWSERS_PATH=/tmp/labdeck-playwright npm run test:e2e -- --grep 'media|overview'` — passed, 1 Chromium journey; checks mixed playback/library failure and no page overflow at 390×844, 768×1024 and 1440×900.
- `PLAYWRIGHT_BROWSERS_PATH=/tmp/labdeck-playwright npm run test:e2e` — passed, all 6 Chromium journeys.
- Combined base + Jellyfin `docker compose ... config --quiet` with non-secret placeholder paths — passed.
- `npm run test:live -- --provider=jellyfin` — correctly skipped because `LABDECK_LIVE_TEST=true` and operator configuration were not supplied.
- The first sandboxed E2E attempt could not bind loopback; the first permitted attempt found Chromium absent. After installing Chromium into `/tmp/labdeck-playwright`, the journey ran and passed. Neither setup failure is counted as application evidence.

## Live provider/hardware versions verified

None. No Jellyfin endpoint or credential was available in this workspace. The fixture version describes its schema shape; it is not a live compatibility claim.

## Fixture-only or untested cases

- Playback, counts/recent additions, auth failure, timeout, response limit, malformed data, unsupported route, replay-safe events and mixed UI state are fixture-tested.
- Installed Jellyfin version, key permissions, real path-prefix routing, multiple real users/devices and real recent-item filtering remain pending.
- Automated responsive checks passed. Temporary full-page captures at 390×844, 768×1024 and 1440×900 were manually inspected for hierarchy, status text, readability and clipping; no layout issue was found. Broader manual focus, contrast and reduced-motion review across every application state remains pending for M9.

## Security/permission changes

- Optional read-only mount for one Jellyfin key file. No app privilege, socket, device, host mount, control endpoint or browser credential editor was added.
- The application can make bounded outbound reads only to the operator-configured Jellyfin origin and fixed paths.

## Known limitations/deviations

- The first usable release is fixture-validated, not live-validated.
- Jellyfin item counts are provider-reported item counts; no media byte size or folder scan is claimed.
- Artwork remains intentionally absent.

## Next task

Run `LABDECK_LIVE_TEST=true npm run test:live -- --provider=jellyfin` with an out-of-band key file on the target installation, record the installed version and sanitized compatibility evidence, then begin M4 only after that result is reviewed or explicitly accepted as pending.
