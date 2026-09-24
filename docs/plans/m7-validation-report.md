# M7 validation report

Date: 2026-09-24

## Milestone/tasks

M7.1–M7.3 fixture implementation; M7.4 live Ubuntu hardware gate pending.

## Implemented acceptance criteria

- Storage distinguishes selected filesystem used/reserved/available capacity, trend, and separate physical disk identity; disk and volume capacities are not summed.
- A root-only, timer-driven helper reads at most 16 reviewed `/dev/disk/by-id/` block-device symlinks through fixed `smartctl -a -j -n standby,3` commands, with per-disk and total deadlines and a separate atomic sanitized snapshot. The app has no device or helper control access.
- ATA, NVMe and SCSI safe fields are normalized. SMART exit health bits, asleep, unsupported, permission and timeout/read-failed states remain distinct. Large counters use decimal strings; absent values remain unknown.
- Cached SMART evidence retains its original timestamp after a failed/asleep read. The UI shows state, freshness and current versus retained evidence. Threshold episodes, counter increases and identity replacement produce bounded observations.
- Systemd and Compose opt-in setup and the [hardware compatibility gate](../integrations/smart-hardware.md) are documented.

## Validation actually run

- `go -C collector test ./...` and `go -C collector vet ./...` passed using a local Go 1.27.1 toolchain (the shell has no `go` on PATH).
- `npm run check`, `npm run test:unit` (18 tests), `npm run test:integration` (86 tests, including four SMART-specific cases), and `npm run test:security` passed.
- Targeted Chromium `storage|disk|containers` checks passed (3 tests); the full Chromium E2E suite passed (10 tests), including the mobile storage/retained-evidence case.
- `git diff --check` passed. `npm run test:live -- --provider=smart` was run and skipped without explicit live opt-in; no hardware claim is made.

## Fixture versus live evidence

Synthetic smartctl JSON and browser fixtures only. No Ubuntu smartctl, device node, bridge, HBA, standby disk or root timer was accessed here. The opt-in live runner reads only the sanitized snapshot; operators must also compare against reviewed local smartctl output and audit permissions. M7.4 remains open.

## Limitations and next task

- Temperature warning uses two readings at or above 45°C to enter and two below 42°C to clear; per-model vendor thresholds are not inferred.
- A missing serial leaves replacement identity unknown. Unsupported USB/RAID/HBA passthrough remains unsupported until the operator verifies a suitable device type.
- SMART pass is current evidence, not a prediction of future survival. No self-tests or forecasts are shipped.
