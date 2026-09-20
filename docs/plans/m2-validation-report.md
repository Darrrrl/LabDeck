# M2 validation report

Validated 2026-09-20 on macOS arm64 with Node 26.7.0, npm 11.19.0, an official Go 1.27.1 darwin-arm64 toolchain, and fixture collector data. The required Ubuntu live comparison is implemented but remains pending because this machine is not Linux and no homelab host was made available.

## Acceptance evidence

- The ordinary Go collector reads host `/proc`, statfs, and explicit configured entities without root, network, Docker socket, devices, subprocesses, or an inbound command path. It writes versioned snapshots atomically with mode `0640`.
- Linux amd64 and arm64 collector builds pass. Parser/rate tests cover first samples, reset/reboot behavior, duplicate mount identities, memory semantics, and 512-byte diskstats sectors.
- The application accepts only one fixed regular non-symlink file up to 2MiB, rejects malformed and >30-second future observations, and preserves collector timestamps.
- A server-owned scheduler is independent of browser activity, non-overlapping, jittered, abortable, and backs off 2×/4× to five minutes. Snapshot generation/sequence deduplication, current capability state, metrics, rollups, retention, outage/recovery and storage threshold events persist in SQLite.
- Failed reads preserve last-good capability data. Two failed polls after a known success create one outage event; one genuinely newer successful snapshot creates one recovery. Startup unknown is not an outage.
- Authenticated Overview, System, Storage, Events, and Settings routes read cached SQLite state only. Stale data stays dated. Selected network and disk-I/O rates remain nullable for first/reset samples. The storage view distinguishes used, available, reserved, and total bytes and offers subtle 1h/24h trends.
- The optional Compose host override adds only the reader GID and a read-only collector public-directory mount. It adds no host `/proc`, raw device, Docker socket/group, host namespace, app privilege, or write path.

## Commands run

| Command | Result |
| --- | --- |
| `npm run check` | Passed: typecheck, lint, docs links, frontend/backend build |
| `npm run test:unit` | Passed: 7 files, 14 tests before final M2 validation rerun |
| `npm run test:integration -- --project=foundation` | Passed: 1 file, 8 tests |
| `npm run test:integration -- --project=host` | Passed: 4 files, 15 tests before final M2 validation rerun |
| `npm run test:e2e -- --project=chromium --grep 'host|storage|stale'` | Passed: fixture-backed Chromium flow, including authenticated 390px overflow check |
| `go -C collector test ./...` | Passed with the downloaded official Go toolchain |
| `go -C collector vet ./...` | Passed with the downloaded official Go toolchain |
| Linux `amd64` and `arm64` collector cross-builds | Passed |
| `npm run test:live -- --provider=host` | Correctly reports skipped without explicit opt-in; Ubuntu measurement pending |

## Remaining live gate

On the Ubuntu homelab, install the reviewed systemd unit, run the live command with explicit environment opt-in, and record Ubuntu/kernel/tool versions. Compare `free -b`, `df -B1`, uptime, and selected interface/disk counters over the same publication interval using [the installation guide](../../deploy/systemd/README.md). This is deliberately not claimed from macOS or synthetic fixtures.

The implementation uses direct 1-minute, 15-minute, and 1-hour bucket updates at ingest rather than a separate later rollup job. Counts, sum, min, max, last and coverage are retained, so the aggregation semantics are equivalent while keeping this single-writer slice smaller. Retention deletes are capped at 1,000 rows per ingest. Broader disk-budget pressure and online backup hardening remain assigned to M8.
