# Validation protocol

## Current state

This repository contains planning documents only. No package scripts, collector, Docker image, or tests exist yet. M0 validation checks document structure and links. All commands in PLAN.md describe the interface future milestones must provide.

## Planned command contract

| Command | Purpose / introduced |
| --- | --- |
| `npm run check` | Typecheck, lint, build and internal-doc-link validation; M1 |
| `npm run test:unit` | Vitest deterministic pure/core/UI tests; M1 |
| `npm run test:integration -- --project=<name>` | Named Vitest projects for in-process app, fake upstreams and temporary SQLite; foundation M1, names added per slice |
| `npm run test:e2e -- --grep <pattern>` | Playwright tagged browser journeys; M1 onward |
| `npm run test:security` | Secret canaries, API authorization, outbound route/method assertions, deployment privilege checks; M1 onward |
| `go -C collector test ./...` / `vet ./...` | Host parsers, protocol, collector behavior; M2 |
| `npm run test:live -- --provider=<name>` | Opt-in read-only comparison using local operator config, no secrets in arguments/output; M2 onward |
| `npm run test:resilience` | Temporary DB pressure, crash/restart/restore, scheduler and retention stress; M8 |
| `npm run test:soak -- --hours=24` | Bounded workload and progress/reporting, reference environment resource record; M9 |

Live tests require an explicit opt-in environment flag and out-of-band secret files. Never auto-discover, scan a network or mutate services. `--provider=all` runs configured providers and lists unconfigured/unsupported ones. SMART live checks consume collector snapshots; install/device commands are reviewed separately. Default tests must work without a homelab or external network.

## Required evidence

Tests should prove semantic invariants: last-success timestamps cannot advance on failure; failed/partial inventory cannot erase valid state; cursors and events commit together; secrets are excluded by DTO projection; all network operations are bounded; host metrics have correct units and identity; SMART return bits differ from process failure; unavailable is never zero.

Use temporary local databases. Include migration from every supported prior schema, duplicate/replay handling, WAL recovery and restore. Use a fake clock for scheduler/backoff/rollups and real short timeout tests for cancellation. Avoid snapshot tests that merely restate implementation structure.

Fixtures include source version and redaction notes. Never commit actual API keys, Docker environment, full serial inventories, media-user history, tailscale keys or raw service configuration. Seed clearly synthetic personal data for UI checks. Secret tests inject unique sentinel values into headers, nested upstream objects and failure messages, then scan outputs/DB/logs/client bundle.

For UI acceptance capture screenshots at the three experience-spec sizes and inspect them, run automated accessibility checks, and manually test focus, keyboard navigation, contrast/readability and reduced motion. Test healthy, empty, degraded and stale mixed scenarios, not just a full screen of ideal demo data.

Reference performance setup: record Ubuntu version, CPU/RAM/storage, app/collector versions, 50 synthetic or real containers, 200 synthetic or real peers, enabled series count, and refresh frequencies. Capture p50/p95 cached API latency, CPU/RSS, SQLite+WAL bytes and poll queue depth. State when test data is simulated. Do not claim benchmark results before measuring.

## Milestone report template

```text
Milestone/task:
Completed acceptance criteria:
Files/contracts changed:
Commands actually run and results:
Live provider/hardware versions verified:
Fixture-only or untested cases:
Security/permission changes:
Known limitations/deviations:
Next task:
```
