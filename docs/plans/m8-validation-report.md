# M8 validation report

Date: 2026-09-25

## Milestone/tasks

M8.1 local Tailscale status projection; M8.2 long-range history/retention hardening; M8.3 verified SQLite backup/restore and pressure diagnostics. Fixture implementation complete. Installed-client and operational gates remain open.

## Implemented acceptance criteria

- Optional ordinary host collector executes only `/usr/bin/tailscale status --json` with a deadline and output cap, publishes safe local status and at most 250 peers, and never exposes user profiles, keys or raw output to the app. Missing LastSeen is unknown; a partial list cannot erase previously complete cached peers.
- Authenticated Network page and Overview summary read cached state. Offline peers are informational; client failure is isolated from other host data.
- Long-range 1h/24h/7d/30d/400d history queries remain bounded, preserve sample-count coverage and gaps, and store independent slower Jellyfin library-count samples. Filesystem and library history controls are visible.
- Event dedupe keys survive 90-day feed pruning. Series admission is capped at 400. SQLite+WAL/free-space/series/event diagnostics are visible; pressure trims or pauses telemetry writes.
- Packaged [online backup/restore command](../operations/backup-restore.md) creates only new verified files and clears old sessions in a restored copy. It never replaces a live database automatically.

## Validation actually run

- `npm run check`: passed (typecheck, lint, 34 Markdown files' links, production build including the maintenance CLI).
- `npm run test:unit`: 18 passed; `npm run test:integration`: 97 passed; `npm run test:resilience`: 8 passed.
- `npm run test:security`: passed; Chromium `npm run test:e2e -- --project=chromium`: 11 passed, including the 390px Network layout.
- Go `test ./...` and `vet ./...`: passed with the pinned Go binary and temporary build cache.
- `npm run test:live -- --provider=tailscale`: skipped as designed without opt-in/live client.

The integration test was also run once concurrently with a security-check build and hit a transient missing `web/dist` during that build; it passed when rerun independently. Fixture tests do not constitute installed-client or operational evidence.

## Fixture versus live evidence

Synthetic Tailscale JSON, accelerated 400-day metric samples, and temporary SQLite/browser fixtures only. A temporary SQLite max-page-count write failure and corrupt-backup rejection were tested, but no Ubuntu client/version/permission check, real peer-policy comparison, full-filesystem drill, production-volume restore, or measured DB+WAL growth has been run here. The opt-in live runner reads only the sanitized snapshot. M8 live acceptance remains pending.

## Limitations and next task

- Tailscale status is the server's local view, not a full tailnet inventory or peer-service reachability test.
- Pressure thresholds are conservative guardrails; exact disk growth/latency and a full-disk recovery drill need the reference server.
- The restore command creates a verified replacement candidate; the operator must stop the app and replace the active database deliberately.
- No asynchronous write queue exists in this single-writer design; bounded admission and pressure tests replace the planned queue-overflow test. See [decision 003](../decisions/003-synchronous-sqlite-telemetry.md).
