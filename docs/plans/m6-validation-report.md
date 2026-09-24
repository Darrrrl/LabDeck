# M6 validation report

Date: 2026-09-24

## Milestone/tasks

M6.1–M6.3 — optional Docker host observation.

## Implemented acceptance criteria

- Optional collector-only Docker Unix-socket module with API negotiation, fixed GET routes, bounded two-worker per-container reads, five-second request/ten-second cycle deadlines, 2 MiB response limits and 100-container inventory cap.
- Safe projected snapshot with identity, state, healthcheck, restarts, nullable CPU/memory and per-container stats timestamp. No env, commands, labels, mounts or health logs cross the boundary. Application Compose still has no Docker socket or group.
- Cached inventory and Overview summary, read-only detail, expected-running warnings, unknown/no-healthcheck distinction and mobile layout. Stopped optional containers remain neutral.
- Baseline-safe restart/recreation observations by ID; duplicate samples and partial inventories cannot fabricate events. Last-good state survives failures.
- Explicit opt-in systemd Docker group drop-in and permission-risk documentation.

## Validation actually run

- `go -C collector test ./...` and `go -C collector vet ./...` passed using a local Go 1.27.1 toolchain (the shell has no `go` on PATH).
- `npm run check`, `npm run test:unit` (18 tests), `npm run test:integration` (86 tests), and `npm run test:security` passed.
- Targeted Chromium `storage|disk|containers` checks passed (3 tests); the full Chromium E2E suite passed (10 tests), including the 50-container fixture.
- `git diff --check` passed. `npm run test:live -- --provider=docker` was run and skipped without the explicit live opt-in; no live Docker claim is made.

## Fixture versus live evidence

Synthetic fake-Engine and browser fixtures only. No live Docker daemon was accessed. Installed API version, socket permissions, cgroup memory variant and 50-container host timing remain pending. The opt-in live runner reads only a sanitized collector snapshot.

## Limitations and next task

- Container stats are current-only; per-container trend history is off by default. A missing stats sample keeps its original timestamp.
- A partial inventory is explicitly marked and does not create removal events. Lifecycle observations are approximate, not a Docker audit stream.
- Verify against a reviewed Ubuntu Docker installation and a real 50-container mixed-state load before live acceptance. M7 fixture work has proceeded independently; M6 live acceptance remains open.
