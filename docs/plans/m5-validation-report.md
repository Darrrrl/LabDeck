# M5 validation report

Date: 2026-09-24

## Milestone/task

M5.1–M5.2 — Prowlarr health vertical slice.

## Completed acceptance criteria

- Fixed read-only API v1 routes with `X-Api-Key`, request timeout/body limits, no redirects, and no active tests or queries.
- Projected indexer configuration immediately to ID, name and enable state. Nested fields, provider messages and raw health text are not persisted or exposed.
- Current future-dated `disabledTill` on enabled indexers counts as failing; disabled indexers and expired failures do not. No status row is not proof of health. Application connectivity remains unknown.
- Persisted last-good health with evidence time and safe error code, independent connection/health polling, baseline-safe indexer transitions and connection events.
- Added cached Overview/Downloads/Settings state, visible freshness and disabled/failing details, plus restricted-key Compose override and opt-in live checker.

## Fixture and live evidence

- Synthetic API v1 fixture, not collected from an installed server. Schema source: [Prowlarr development OpenAPI](https://raw.githubusercontent.com/Prowlarr/Prowlarr/develop/src/Prowlarr.Api.V1/openapi.json), checked 2026-09-24.
- Installed version, authentication behavior, response variants and retry-window semantics remain unverified. The live gate is open.

## Commands actually run

- `npm run check` — passed typecheck, lint, local documentation links and production builds.
- `npm run test:unit` — passed, 7 files / 18 tests.
- `npm run test:integration -- --project=prowlarr` — passed, 1 file / 5 tests.
- `npm run test:integration` — passed, 16 files / 72 tests.
- `npm run test:security` — passed.
- `PLAYWRIGHT_BROWSERS_PATH=/tmp/labdeck-playwright npm run test:e2e -- --grep indexers` — passed, 1 Chromium journey at 390×844. A first attempt without the browser path could not locate Chromium; a sandboxed retry could not start the local test server, so the successful browser run used the approved outside-sandbox execution.
- `PLAYWRIGHT_BROWSERS_PATH=/tmp/labdeck-playwright npm run test:e2e` — passed, all 8 Chromium journeys.
- Base + Prowlarr `docker compose ... config --quiet` using non-secret placeholders — passed.
- `npm run test:live -- --provider=prowlarr` — correctly skipped without opt-in and operator configuration; no live service was accessed.
- `git diff --check` — passed.

## Security and limitations

- No new privilege, socket/device mount, mutation endpoint, or browser credential path. The optional Compose override mounts one restricted key file read-only.
- Generic health severity does not identify specific application warning messages. Application connectivity remains unknown; no active tests are made. Indexer configuration names are owner-visible, but nested provider fields are discarded.

## Next task

Run the opt-in Prowlarr live check against the installed service and record sanitized compatibility evidence; then M6 Docker observation can begin.
