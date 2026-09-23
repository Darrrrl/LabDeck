# M4 validation report

Date: 2026-09-23

## Milestone/task

M4.1–M4.4 — Sonarr then Radarr vertical slices.

## Completed acceptance criteria

- Added fixed-route API v3 transports for Sonarr and Radarr using `X-Api-Key`, GET-only methods, redirect rejection, five-second request deadlines, 2 MiB response limits, ten-page/1,000-record pagination and a 10 MiB group budget.
- Added independent connection, health, queue, catalog and history groups per provider. One provider or capability can fail while last-good state from both providers remains available.
- Normalized source-scoped queue entries, safe stages/warnings, nullable progress/remaining bytes/ETA, authoritative totals and visible truncation. Identical upstream IDs across providers remain separate entries.
- Added explicit monitored and monitored-missing totals, bounded fourteen-day upcoming projections, Sonarr episode-air dates and Radarr digital/physical/theatrical precedence with timezone normalization.
- Added baseline-safe import events with cursor and event writes in one transaction. Overlap/replay is idempotent and a forced event-write failure proves cursor rollback.
- Added cached `/api/v1/downloads`, Overview service summaries, Downloads navigation/page, recent imports, health evidence, browser-safe launch URLs and responsive mixed-provider failure behavior.
- Added separate Compose overrides, restricted key-file configuration, secret/deployment scanning and opt-in live-read checks for both providers. No command, search, grab, delete, refresh or test route is allowlisted.

## Files/contracts changed

- Downloads public contracts and Overview summaries in `packages/contracts`.
- Shared Arr transport/adapter/state/monitor modules in `apps/server/src/integrations/arr`.
- Server configuration, cached queries and `/api/v1/downloads` wiring.
- Downloads React feature, navigation, Overview cards and responsive styles.
- Synthetic Sonarr 4.0- and Radarr 5.0-shaped fixtures, Arr integration project and Downloads browser journey.
- Provider Compose overrides, live runner support, security checks and integration documentation.

## Commands actually run and results

- `npm run check` — passed typecheck, lint, documentation links and production builds.
- `npm run test:unit` — passed, 7 files / 17 tests.
- `npm run test:integration -- --project=arr` — passed, 1 file / 8 tests.
- `npm run test:integration` — passed, 14 files / 61 tests.
- `npm run test:security` — passed.
- `PLAYWRIGHT_BROWSERS_PATH=/tmp/labdeck-playwright npm run test:e2e -- --grep downloads` — passed, 1 Chromium journey at 390×844 with no page-level overflow.
- `PLAYWRIGHT_BROWSERS_PATH=/tmp/labdeck-playwright npm run test:e2e` — passed, all 7 Chromium journeys.
- Base + Sonarr and base + Radarr `docker compose ... config --quiet` checks — passed with non-secret placeholder paths.
- `npm run test:live -- --provider=sonarr` and `--provider=radarr` — correctly skipped without explicit opt-in and operator configuration.

## Live provider versions verified

None. No Sonarr/Radarr endpoint or credential was available. Fixture version labels describe synthetic schema shapes and are not compatibility claims.

## Fixture-only or untested cases

- Queue stages, safe warnings, unknown progress, source-scoped duplicate IDs, monitored/missing totals, Sonarr episode dates, Radarr timezone-aware digital releases, bounded pagination, import overlap/replay and cursor rollback are fixture-tested.
- Installed versions, exact history enums, wanted-filter defaults, real queue error variants, real calendar timezone behavior and provider key permissions remain pending.

## Security/permission changes

- Optional read-only mounts for Sonarr and Radarr key files. No new Linux privilege, socket, device, control endpoint or browser credential path was added.
- Provider error messages are not persisted or projected; safe typed warnings replace raw upstream detail.

## Known limitations/deviations

- M4 is fixture-validated, not live-validated.
- Queue totals mean provider queue entries, not unique downloads across services.
- Download-client adapters and actions remain out of scope.

## Next task

Run each opt-in live check using out-of-band key files and record sanitized installed-version evidence. Once reviewed or explicitly accepted as pending, begin M5 Prowlarr health.
