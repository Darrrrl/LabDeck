# Investigation add-ons validation

Date: 2026-09-27

Status: fixture implementation and local validation complete. This report covers the requested Compose grouping, forecasts, problem investigation, preferences and backup status. External notifications are design-only in [the post-v1 proposal](external-notifications.md).

## Evidence

- Compose collector projects canonical labels into optional bounded project/service fields; fake Engine tests check projection, invalid identifiers and secret canaries. The container UI groups by project and service with full-group attention counts, local filtering and native keyboard disclosures. Partial inventory keeps the prior full list and original observation timestamp.
- Forecast tests cover sustained growth, single bulk import, deletion/flat trend, unstable oscillation, missing days, sparse hours, stale state, changed identity/capacity, repeated snapshots, threshold already crossed and 180-day horizon. The 30-day baseline starts collecting after migration 005; no pre-upgrade metric backfill is claimed.
- Problem contract tests check a current storage warning against entity-matched retained events and metric history, stale evidence and resolution. HTTP tests check authentication, no-store, ID bounds, 404 for no-longer-current IDs and no mutation route. Browser checks open the problem detail, show a chart gap and table, and exercise the resolved state.
- Browser checks cover selected volume and range persistence, project search/filter persistence, widget DOM order, wallboard title hiding, malformed or unwritable local storage, 390px layouts, 1280×720 wallboard fit and representative automated accessibility. The inspected fixture screenshots were readable at these sizes. Automated accessibility and scripted keyboard tests do not replace the outstanding complete manual M9 review.
- The backup/restore fixture verifies source and copy integrity, records status only after a successful backup, leaves the previous status unchanged on target collision, and clears status and sessions in a restored copy. The Settings browser check distinguishes no record from verified creation and exposes restore guidance.

Commands actually run successfully:

- `npm run check` (typecheck, lint, local links and production build).
- `npm run test:integration` (24 files, 106 tests, including unit and fixture projects). After the final title-bound change, `npm run test:integration -- --project=host --project=foundation` passed (10 files, 44 tests).
- `PLAYWRIGHT_BROWSERS_PATH=/tmp/labdeck-playwright npm run test:e2e` (22 Chromium tests).
- `npm run test:security` (boundary checks passed).
- `GOCACHE=/tmp/labdeck-go-cache /tmp/labdeck-go-toolchain/go/bin/go -C collector test ./...` (all Go packages passed) and the matching `vet ./...` command (passed). The temporary Go 1.27.1 archive was checked against the official release metadata before extraction.
- `git diff --check` (passed after final documentation update).

An earlier complete browser run exposed ambiguous test locators and a new test's repeated login hitting the existing rate limiter. Test selectors and session reuse were corrected; the final 22-test run passed. An earlier lint run found untyped browser fixture responses; those fixtures now pass the response schemas. The sandbox could not run Go until a temporary verified toolchain was installed. These earlier attempts are not counted as passing validation.

## Compatibility and remaining gates

Optional Compose labels preserve protocol v1 compatibility; older collectors show ungrouped containers. Only project/service labels are exported. Migration 005 adds bounded forecast-day state and backup status. Schemas 1–4 remain supported by the backup/restore CLI; the new application upgrades restored copies and does not downgrade databases. Restore clears old sessions and backup status. Existing generic metric history is not backfilled into forecasts.

No live Docker Engine/Compose, Ubuntu installation/restore drill, actual storage growth run, SMART hardware, external notification delivery, or 24-hour reference-host soak was performed. Fixture estimates demonstrate algorithm behavior, not accuracy for the owner's future workload. Backup status confirms creation-time verification only. Wallboard privacy affects presentation, not authorized API access. See [decision 005](../decisions/005-monitoring-investigation-addons.md) for defaults and limits.
