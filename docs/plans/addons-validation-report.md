# Requested add-ons validation

Date: 2026-09-25.

## Delivered

- `/wallboard`: six widgets, fullscreen control, Overview exit, detail links, visible source freshness, bounded playback titles and remainder count. Desktop fit target 1280×720; smaller screens reflow.
- Containers: name/image search, state and attention filters, counts and empty matches, separate state/healthcheck labels and explicit running expectations.
- Storage: ATA self-test progress, estimated duration and five recent results; host smartd schedule preview with day/hour controls. Operator [activation instructions](../operations/smart-tests.md) and [decision](../decisions/004-host-owned-smart-tests.md).
- Optional normalized snapshot fields preserve old collector compatibility and last-good evidence timestamps. No schema migration, raw response persistence, command path or device permissions added.

## Validation actually run

- `npm run check` passed (types, lint, documentation links, production builds).
- SMART integration project: 5 tests passed, including retained test evidence and rejection of invalid percentages.
- Collector `go test ./...` and `go vet ./...` passed using `/tmp/labdeck-go-m6/go/bin/go` with `GOCACHE=/tmp/labdeck-go-cache`.
- Targeted Chromium tests: 4 passed, including a populated wallboard with five sessions and mixed stale/partial sources. Checks cover server-screen fit, accessibility, mobile overflow, Docker search/filter semantics, sleeping-disk self-test evidence and schedule preview. The first sandboxed attempt could not reach its test server. Subsequent tests ran outside the sandbox; screen fit and selectors were corrected from failures.
- Wallboard screenshot visually inspected at 1280×720.

## Compatibility and limitations

Synthetic ATA JSON and browser fixtures only. No actual disk test or schedule was started or installed. ATA field mapping was checked against upstream smartmontools source; NVMe/SCSI test history is explicitly unavailable. The existing M7 hardware and M9 release gates remain open.

Schedule activation is host-owned, not an in-app control action. The preview cannot report whether a schedule is installed, its next actual execution, or missed runs. Drive history is bounded to five reported entries and uses lifetime hours rather than calendar completion dates. Ten-minute collector cadence can miss the active phase of short tests. Widget customization and automatic page rotation are not implemented.
