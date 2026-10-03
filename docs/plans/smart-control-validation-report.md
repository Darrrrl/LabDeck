# Web-started SMART tests — validation evidence

Status: workspace implementation complete; Ubuntu host validation pending (2026-10-01).

The requested action is limited to current ATA disks in the existing SMART inventory. The browser sends a disk ID and fixed short/extended choice. The API requires owner authentication, exact origin and CSRF, rejects stale/unreadable or unsupported disk evidence, and returns command acceptance separately from later drive results. The optional host service resolves only configured IDs and fixed smartctl arguments; no device path crosses the web request boundary. No migration or backup format change is required.

Checks run in this workspace:

- `npm run check` passed (typecheck, lint, docs links and build).
- `npm run test:integration` passed: 25 files, 108 tests, including the fake Unix-socket action and browser-component tests. The first sandboxed focused attempt could not create a socket; an approved local run passed.
- `npx vitest run apps/web/src/features/storage/SmartTests.test.tsx` passed: the button sends only ID/type and reports acceptance.
- `npm run test:security` passed.
- `git diff --check` passed.

The Go toolchain is absent in this workspace, so `go test` and `go vet` could not run. The targeted Chromium E2E run built successfully but did not execute because the Playwright Chromium binary is not installed. No real disk or Ubuntu SMART control service was accessed. Before enabling the service, compile and test the Go collector on Linux, inspect socket ownership and systemd restrictions, and verify both test types against a reviewed ATA disk with the installed smartmontools version. Confirm the next snapshot reflects drive-reported progress or result; command acceptance alone is not a health result.
