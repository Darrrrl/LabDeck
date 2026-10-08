# Current-state review and retro desktop revamp

Date: 2026-10-08. Scope: local implementation review and owner-requested visual revamp; no deployment or live integration access.

## Review findings and recommended order

The existing product already includes cached integration state, current-problem investigation, Compose grouping, storage forecasts, browser preferences, wallboard privacy and explicit opt-in host action boundaries. These are delivered capabilities rather than proposals for new work.

1. **Preserve observation gaps in System and Storage history (correctness; medium effort).** Static review: [System](../../apps/web/src/features/system/SystemPage.tsx) and [Storage](../../apps/web/src/features/storage/StoragePage.tsx) map history to numeric values. [Sparkline](../../apps/web/src/components/Sparkline.tsx) spaces them equally and draws one continuous polyline. Missing intervals can therefore look like continuous observation. Pass timestamps and coverage through to rendering, break lines over gaps and expose values in a table. [Problem details](../../apps/web/src/features/problems/ProblemPage.tsx) already demonstrates timestamp/coverage-aware rendering.
2. **Complete Events investigation (documented unfinished capability; medium effort).** [Events](../../apps/web/src/features/events/EventsPage.tsx) calls the fixed first-50 query in [api.ts](../../apps/web/src/app/api.ts), with no load-more or filter controls. The [server query](../../apps/server/src/core/queries.ts) returns a cursor but projects away origin, occurred time and instance identity. It orders by observed time plus ID while paging by ID alone; backdated inserts deserve a regression test before exposing pagination. The duplicated title formatter also labels a Prowlarr connection event as Host collector. Deliver stable pagination, source/severity filters and explicit occurrence versus observation provenance together.
3. **Make overview service freshness consistent (static concern; small effort).** [Overview](../../apps/web/src/features/overview/OverviewPage.tsx) renders Arr summary cards from connection/health warnings without showing their freshness or observation timestamp. A reachable but stale summary can remain green. Match the dated last-good presentation used by the detail pages.
4. **Finish installation and live evidence (release gate; substantial elapsed validation time).** The [v1 report](v1-validation-report.md) still leaves Ubuntu installation, architecture builds, restore and 24-hour soak open. Fixture tests cannot establish installed provider, Docker, SMART or mounted-share compatibility.
5. **Split route bundles if measured loading warrants it (optimization; small/medium effort).** The production build reports a roughly 505 kB minified JavaScript entry (148 kB gzip). Measure on the intended Tailscale connection before prioritizing route-level splitting; this warning alone is not evidence of a breached performance target.

## Delivered design

- Muted sage desktop, warm gray beveled panels, navy window headers, squared controls and native monospace headings/metrics. The OS dark preference selects a matching dark palette.
- A compact six-cell desktop metric strip and paired overview widgets; saved widget DOM order remains authoritative.
- Visible navigation labels in the scrollable phone/tablet taskbar, with existing route-focus behavior and reduced-motion support.
- Shared styling covers login, detail pages, settings, controls and wallboard. Decorative chrome introduces no fake operational controls or status indicators.
- No API, persistence, credential or infrastructure behavior changes. Existing freshness and failure text remains visible.

## Validation

- `npm run check`: passed (typecheck, lint, Markdown links and production build). The existing bundle-size warning remains; see finding 5.
- `PLAYWRIGHT_BROWSERS_PATH=/tmp/labdeck-playwright npm run test:e2e`: 26 passed. Coverage includes keyboard route focus, reduced motion, responsive states, wallboard fit, preferences, failure semantics and YouTube confirmation/retry flows.
- After increasing small labels to 12px, the focused `--grep 'core pages|overview and media|YouTube preview'` browser run passed all 4 tests. Axe found no automated violations across ten authenticated routes in both light and dark appearance, plus representative populated states.
- Visually inspected synthetic Overview captures at 1440×900, 768×1024 and 390×844, desktop dark Overview, and desktop Media. Captures live in ignored `test-results/`; they are fixture data, not live observations. A final phone sign-out padding adjustment prevents icon compression; the focused Overview/Media browser test passed again and the final phone capture was inspected.
- The first styling pass exposed contrast failures, which were corrected. A sandboxed test-server restart timed out; browser verification subsequently ran outside the sandbox. Full-suite execution also exposed repeated YouTube test logins exhausting the login limiter; those tests now reuse worker-local session cookies, matching the existing suite pattern. The application limiter is unchanged.

`npm run docs:check` and `git diff --check` also passed after the documentation update.

Compatibility remains fixture-only. This was a UI/source review, not a full backend/security audit or a live provider/hardware check. M9.1 is partial and M9.2/M9.3 remain open.
