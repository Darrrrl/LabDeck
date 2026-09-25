# Monitoring v1 validation report

Date: 2026-09-25

## Status

M9 release validation is in progress. This report records a first M9.1 fixture UI pass. It is not a release approval or live compatibility claim. M9.2 installation and multi-architecture evidence, M9.3 24-hour soak, and the earlier milestones' live gates remain open.

## M9.1 changes and acceptance evidence

- Navigation moves focus to the new main region after a client-side route change. Shared keyboard focus outlines are visible on navigation, history controls, filesystem selection, links, and container details.
- History range controls expose their selected state with `aria-pressed` and a named group. The Events page distinguishes a failed cached API request from a successful empty feed, and event timestamps expose an exact local time on hover.
- System, Storage, and Network announce failed cached-detail requests as errors. Storage no longer displays a permanent loading message after a request failure.
- Secondary text and the interaction accent were lightened for dark-theme readability. The tablet layout now collapses navigation at 800px; phone host metrics use two compact columns so storage and playback appear sooner.
- A direct WCAG contrast calculation against the main panel background found the revised muted and faint text tokens at 8.5:1 and 7.3:1 respectively. This does not substitute for checking every rendered color combination.
- The Chromium journey asserts route focus, range selection, failed cached-detail states, tablet navigation mode, phone metric columns, and no page-level horizontal overflow for the mixed media state at 390×844, 768×1024, and 1440×900. Axe checks found no automated violations on login, nine authenticated routes, the phone Media view with reduced motion enabled, or representative populated mixed states for Storage, Overview, Media, Downloads, Containers, and Network. Synthetic screenshots of Overview at 390px and Media at all three sizes were captured under ignored `test-results/` and visually inspected. The inspected captures showed readable headings, statuses, playback detail, and stale library evidence after the layout adjustment.

## Commands actually run

- `npm run check`: passed (typecheck, lint, docs links, production build).
- `PLAYWRIGHT_BROWSERS_PATH=/tmp/labdeck-playwright npm run test:e2e -- --project=chromium --grep 'shell|history controls'`: 14 passed after correcting a route pattern and an ambiguous test selector. An earlier default-cache attempt could not find Chromium, and a sandboxed run could not start the loopback test server; neither was a product test failure.
- `git diff --check`: passed after the final documentation and dependency update.

## Remaining gates

- Complete the M9.1 review of every page in fresh, empty, stale, and error states, including manual keyboard and contrast inspection across those combinations. Automated checks cover representative fixture states, not every permutation.
- M9.2 requires a fresh Ubuntu install, service-only and full-collector permission matrix, amd64/arm64 images, upgrade and restore drill, and exact supported-version/hardware records.
- M9.3 requires the reference-host 24-hour soak, measured latency/CPU/RSS/SQLite budgets, ingress/log/request audit, release notes, and known limitations. No soak or live integration was run in this pass.
