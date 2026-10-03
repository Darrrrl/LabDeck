# Execution plan

Status: M0–M8 fixture implementation complete. M2 Ubuntu, M3 Jellyfin, M4 Arr, M5 Prowlarr, M6 Docker, M7 SMART, and M8 Tailscale/operational live evidence remain pending. M9.1 UI review is in progress; see [v1 validation report](docs/plans/v1-validation-report.md). Commands for completed milestones are implemented unless their report says otherwise. See [validation protocol](docs/plans/validation.md).

## Sequence and handoff discipline

`M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8 → M9`

First usable release checkpoint: M1–M3. Complete monitoring v1: M1–M9, including disk health. The ordering prioritizes a real system slice, then real Jellyfin, then broader monitoring. History/event primitives arrive in M2, with scale/retention hardening in M8. Advanced control actions are outside this plan.

Within a milestone implement the numbered tasks in order, normally one task per reviewable change. Each task must preserve a runnable prior slice and update adjacent tests; do not defer all testing to the final task. Use synthetic fixtures for deterministic CI, then opt-in read-only live validation. Tasks own only the listed feature/modules and minimal supporting changes. Do not pre-create future adapters.

For each handoff record: completed task IDs, code/contract changes, actual commands and outcomes, fixture vs live evidence, deviations, and the next task. If no server/hardware access is available, finish safe fixture work and clearly leave live acceptance pending. No milestone is live-validated solely because mocks passed.

## M0 — architecture baseline (complete)

**Goal:** Resolve scope, topology, security boundaries and executable-sized work before application coding.

**Scope/tasks:** Inspect repository; verify high-risk upstream references; write product, architecture, contracts, risk register and milestone plan.

**Files:** Root README/PRODUCT/ARCHITECTURE/PLAN/AGENTS and `docs/{product,integrations,decisions,plans}/` documents.

**Acceptance:** Documentation-only tree; MVP/v1 separation explicit; no broad host permissions hidden in the app; every future milestone has dependencies and validation. Links resolve locally. Live API assumptions remain marked unverified.

**Tests/validation:** Read every document, check internal links and required milestone sections; `rg --files`; `rg '^## M[0-9]' PLAN.md`. No application tests are applicable.

**Dependencies:** None.

## M1 — secure runnable shell

**Goal:** Serve a polished, authenticated app from one container without implying any integrations work yet.

**Scope/tasks:**

1. M1.1 Establish npm workspaces, pinned supported toolchain, TypeScript/lint/build/test scripts, minimal contracts, Fastify server and React entrypoint. Build an empty overview and configuration validation; introduce SQLite migration runner/session table only when auth needs them.
2. M1.2 Implement owner password-hash CLI, session login/logout/CSRF, allowed origin/Host enforcement, sanitized logging and liveness/readiness. Add auth boundary tests alongside it.
3. M1.3 Build navigation, tokens, status primitive and explicit “No integrations configured” page; add responsive/keyboard checks. No pretend metrics in normal mode; fixture/demo mode is labeled.
4. M1.4 Package non-root read-only app image and loopback Compose example with local data/secrets/config mounts. Document TLS/Tailscale Serve setup and local development. Add CI and documentation-link check.

**Expected files/modules:** Root package/toolchain configuration and lockfile, `apps/web/src/{app,components,styles}`, `apps/server/src/{auth,config,http,db}`, `packages/contracts/src`, `deploy/compose`, `tests/e2e/shell.spec.ts`, `.github/workflows/ci.yml`, `.gitignore`, setup README updates. Initialize Git only if implementation workflow needs it; never commit secrets.

**Acceptance:** One image serves UI and REST; login required for state; missing auth config fails readiness; invalid/expired sessions fail safely. Compose renders with no privileged mode, Docker socket, device mounts or all-interface default port. Dark shell works at target sizes, no empty future pages. Build contains no secret canary.

**Tests:** Auth session/CSRF/Origin/Host and throttling; config precedence; migration clean start; no-secrets log/response/bundle scan; keyboard and layout smoke.

**Validation commands:** `npm ci`; `npm run check`; `npm run test:unit`; `npm run test:integration -- --project=foundation`; `npm run test:e2e -- --project=chromium --grep shell`; `npm run test:security`; `docker compose -f deploy/compose/compose.example.yml config --quiet`; `docker compose -f deploy/compose/compose.example.yml build`. Use documented dummy fixture secret files for CI. Manual TLS/cookie verification at the configured origin.

**Dependencies:** M0. Before pinning, verify Node/Fastify/SQLite addon and frontend dependency compatibility; document exact versions.

## M2 — real host health vertical slice

**Goal:** Ubuntu host → safe snapshot → adapter/state/SQLite → overview/System/Storage, with truthful freshness and first trends/events.

**Scope/tasks:**

1. M2.1 Implement ordinary unprivileged Go collector for hostname/uptime, CPU/memory/swap, selected interfaces/filesystems and practical block I/O. Atomic versioned snapshots, fixed configuration, systemd unit; no Docker/SMART/Tailscale privileges yet.
2. M2.2 Implement host adapter, scheduler, capability state and bounded metrics/events persistence. Add 1-minute buckets and basic rollup/retention from the beginning, preserving actual sample timestamps. Add stale/error/threshold transition semantics.
3. M2.3 Wire cached overview API to compact health strip, selected-volume storage bar, System details and subtle 1h/24h trends; add Events list. Read-only Settings explains missing collector/mounts.
4. M2.4 Validate host counters against Ubuntu tools over the same interval; document statfs/reserved bytes, interface selection and privilege-free installation.

**Expected modules:** `collector/cmd/labdeck-collector`, `collector/internal/{system,snapshots}`, collector schema/fixtures, `deploy/systemd/labdeck-collector.service`, server `core/{scheduler,state,health,metrics,events}`, `integrations/host`, DB migrations/queries, web `features/{overview,system,storage,events,settings}`.

**Acceptance:** Values describe the host, not app container; old snapshot read cannot become fresh. CPU/network first samples and resets yield null. Duplicate mounts are not summed. Collector loss preserves dated values and produces monitoring-incomplete status. UI reads never invoke collection. Basic history and event dedupe survive app restart. System-only mode requires no root daemon or Docker group.

**Tests:** Linux counter fixtures, reboot/wrap/zero interval, duplicate mount and reserved capacity; malformed/oversized/old/future snapshots; independent group failures, bounded scheduler, fake-clock retention/rollups, event replay, DB restart, API no-upstream-call invariant.

**Validation commands:** `npm run check`; `npm run test:integration -- --project=host`; `npm run test:e2e -- --grep 'host|storage|stale'`; `go -C collector test ./...`; `go -C collector vet ./...`; `npm run test:live -- --provider=host` on Ubuntu after reviewed collector setup. Compare `free -b`, `df -B1`, uptime and interface counters without assuming tools use identical memory formulas.

**Dependencies:** M1. Protocol and permission rules in `docs/integrations/host-collector.md` are required inputs.

## M3 — Jellyfin and first usable release

**Status:** M3.1–M3.3 fixture implementation complete 2026-09-20 and acceptance coverage hardened 2026-09-23. Live installed-version, credential, and path-prefix compatibility remains explicitly pending; see [M3 validation report](docs/plans/m3-validation-report.md).

**Goal:** Real Jellyfin activity and library counts appear alongside host health without weakening failure isolation.

**Scope/tasks:**

1. M3.1 Capture sanitized versioned fixtures; implement fixed-route authenticated Jellyfin reads, playback normalization and independent library group.
2. M3.2 Add summary selectors, Currently Watching, Media page with counts/recent additions and external UI link; nullable bitrate/progress and paused states.
3. M3.3 Add baseline-safe playback observations, mixed healthy/stale/unauthorized visuals, and live API compatibility report. Review overview hierarchy as a complete daily-use screen.

**Expected modules:** `integrations/jellyfin`, shared read-only transport in server core, media contracts/selectors, `features/media`, overview additions, `tests/fixtures/jellyfin/<version>`, media browser tests and deployment config examples.

**Acceptance:** Currently Watching identifies user/title and mode from evidence; pause/empty/unknown differ. Library failure cannot hide playback; Jellyfin failure cannot block host data. Keys absent from browser traffic/bundle/logs/database. Real server path-prefix and credential behavior verified, or live gate explicitly pending. Owner can answer server health, available storage and current watching from the overview.

**Tests:** Direct/direct-stream/transcode/paused sessions, unknown bitrate/runtime, multiple sessions, empty library, library-only failure, invalid key, request timeout and body limit, replay-safe observed events; complete first-release browser journey.

**Validation commands:** `npm run check`; `npm run test:integration -- --project=jellyfin`; `npm run test:e2e -- --grep 'media|overview'`; `npm run test:security`; `npm run test:live -- --provider=jellyfin`. Manual desktop/tablet/phone review per experience spec.

**Dependencies:** M2; source/version verification gates in service notes. This is the first usable release checkpoint; wider service coverage is not claimed yet.

## M4 — Sonarr then Radarr vertical slices

**Status:** M4.1–M4.4 fixture implementation complete 2026-09-23. Installed Sonarr/Radarr version, enum and filter compatibility remains explicitly pending; see [M4 validation report](docs/plans/m4-validation-report.md).

**Goal:** Summarize managed downloads and recent imports with shared mechanics but correct service-specific semantics.

**Scope/tasks:**

1. M4.1 Implement shared Arr HTTP/auth/pagination helpers only as needed by Sonarr; ship Sonarr queue + health adapter through Downloads and overview card.
2. M4.2 Add Sonarr monitored/missing counts, bounded upcoming items and imports/history with transactional cursors. Verify filtering definitions.
3. M4.3 Implement Radarr queue + health using established helpers; ship its card/detail rows with movie-specific contract tests.
4. M4.4 Add Radarr missing/monitored/calendar/history; validate mixed-source queue totals, partial pages and timezone behavior. Finish fixture/live compatibility records.

**Expected modules:** `integrations/arr/common`, `integrations/{sonarr,radarr}`, downloads contracts/selectors, `features/downloads`, overview cards, provider fixtures, event/history persistence extensions if required.

**Acceptance:** Both services can fail independently; counts use documented filters; source-labeled queue entries are not falsely deduplicated. Capped lists show truncation. Imports survive poll overlap/restart without duplicate feed entries. There are no search/grab/command endpoints. Unknown speeds and release dates stay unknown.

**Tests:** Shared pagination/auth; per-service missing/upcoming/history enums; partial last page, oversized catalog, overlapping history, cursor crash rollback, duplicate IDs across services, all queue stages, error redaction.

**Validation commands:** `npm run check`; `npm run test:integration -- --project=arr`; `npm run test:e2e -- --grep downloads`; `npm run test:live -- --provider=sonarr`; `npm run test:live -- --provider=radarr`.

**Dependencies:** M3. Implement each service vertically; do not land two empty adapter shells first.

## M5 — Prowlarr health

**Status:** M5.1–M5.2 fixture implementation complete 2026-09-24. Installed API/credential compatibility remains pending; see [M5 validation report](docs/plans/m5-validation-report.md).

**Goal:** Show indexer/application health evidence without exposing sensitive provider configuration.

**Scope/tasks:**

1. M5.1 Implement status/health/indexer-status mapping with explicit configuration projection only if needed for IDs/names. Verify the installed API.
2. M5.2 Wire failing-indexer summary and health details into Overview/Downloads, with application connectivity unknown unless evidence exists. Add safe event transitions.

**Expected modules:** `integrations/prowlarr`, indexer contracts, Downloads health panel, Prowlarr fixtures and compatibility record.

**Acceptance:** Disabled indexers are not mistaken for failures. Application configuration alone never yields a healthy connection claim. Credentials nested in config fields never escape normalization. No active test requests. Statistics are optional later, not a gate.

**Tests:** Nested secret canaries, failing/disabled/missing indexers, nullable application evidence, expired failures, endpoint unsupported; UI evidence timestamp and safe text.

**Validation commands:** `npm run check`; `npm run test:integration -- --project=prowlarr`; `npm run test:security`; `npm run test:e2e -- --grep indexers`; `npm run test:live -- --provider=prowlarr`.

**Dependencies:** M4. Do not infer that its similar interface means it uses API v3.

## M6 — Docker observation

**Status:** M6.1–M6.3 fixture implementation complete 2026-09-24. Installed Engine API, socket permissions, and 50-container host performance remain live gates; see [M6 validation report](docs/plans/m6-validation-report.md).

**Goal:** Safe collector output powers container inventory/detail without exposing daemon access to the application.

**Scope/tasks:**

1. M6.1 Add optional Docker collector module with negotiated fixed read paths, projected DTOs and bounded stats concurrency. Document explicit socket/group permission and compromise impact.
2. M6.2 Add container snapshot contract/adapter, inventory table/detail and expected-running configuration; expose CPU denominator, memory semantics and absent healthcheck.
3. M6.3 Add restart/recreation observations and 50-container mixed-state load validation. Preserve per-container freshness when a collection budget expires.

**Expected modules:** `collector/internal/docker`, Docker fixtures, host adapter/container contracts, `features/containers`, collector permission docs/example, overview card and events.

**Acceptance:** App image/Compose still has no Docker socket or group. Collector exports no env/commands/health logs or arbitrary labels. Stopped optional containers do not degrade overall health. Same-name recreation is not the same ID; partial inventories do not fabricate removals. Detail view is observation-only.

**Tests:** Engine negotiation, CPU delta and cgroup memory variants, stopped/restarting/no-healthcheck, counter reset/recreate, deadline truncation, secret-bearing inspect fixture projection; fake Docker server asserts allowed methods/paths.

**Validation commands:** `go -C collector test ./...`; `go -C collector vet ./...`; `npm run check`; `npm run test:integration -- --project=docker`; `npm run test:e2e -- --grep containers`; `npm run test:security`; `npm run test:live -- --provider=docker` on Ubuntu with reviewed socket access.

**Dependencies:** M5 in release sequence; technically uses M2's collector protocol/core. Socket privilege is opt-in, never silently added.

## M7 — polished storage and SMART

**Status:** M7.1–M7.3 fixture implementation complete 2026-09-24. M7.4 remains a live Ubuntu hardware/permissions gate; see [M7 validation report](docs/plans/m7-validation-report.md).

**Goal:** Make capacity and disk evidence useful and trustworthy while isolating elevated device access.

**Scope/tasks:**

1. M7.1 Refine Storage into per-volume used/reserved/available visualization with history, explicit volume selection and separate physical-disk identity.
2. M7.2 Implement SMART-only helper mode and root timer with reviewed device allowlist, atomic separate output, timeout/standby handling, no shell. Ship ATA JSON through disk detail and fixture tests first.
3. M7.3 Add NVMe/SCSI supported fields and unknown reasons; test identity stability, threshold episodes and increasing error evidence. Document hardware compatibility and USB/HBA limitations.
4. M7.4 Validate against actual Ubuntu smartctl/device reports; audit file ownership and lack of app-to-helper control path. Confirm unsupported hardware fallback and sleeping disk behavior.

**Expected modules:** `collector/internal/smart`, SMART mode in collector command, `deploy/systemd/labdeck-smart.{service,timer}`, protocol/schema fixtures, host disk adapter/contracts, storage/disk UI, history/event selectors, hardware compatibility document created under `docs/integrations/`.

**Acceptance:** App remains unprivileged with no raw devices. Helper executes only fixed reads of configured disks. Nonzero smartctl exit health bits produce appropriate findings, not blanket parse failure. Sleeping/unsupported/permission states are visible. Pending/reallocated/uncorrectable and NVMe fields have correct labels/units. SMART pass never guarantees future survival; no forecast or folder scan ships here.

**Tests:** ATA/NVMe/SCSI fixtures, large counters, nonzero exit bitmask, missing temperature, standby skip, timeout, symlink/device identity rejection, malformed JSON, thresholds/hysteresis, disk replacement, capacity change and double-count prevention.

**Validation commands:** `go -C collector test ./...`; `go -C collector vet ./...`; `npm run check`; `npm run test:integration -- --project=smart`; `npm run test:e2e -- --grep 'storage|disk'`; `npm run test:security`; `npm run test:live -- --provider=smart`. Live runner reads snapshots only; operator obtains comparison smartctl output using the reviewed helper command, never enables SMART or initiates self-tests.

**Dependencies:** M6 release sequence, M2 filesystem/metrics foundation. Do not mark hardware validation complete on macOS or synthetic fixtures alone.

## M8 — Tailscale and durable history hardening

**Status:** M8.1–M8.3 fixture implementation complete 2026-09-25; see [M8 validation report](docs/plans/m8-validation-report.md). Installed Tailscale permission/version, DB disk-pressure behavior, measured growth and restore drill remain live gates.

**Goal:** Finish network visibility and prove bounded local history/events survive real operational failures.

**Scope/tasks:**

1. M8.1 Add fixed local Tailscale status collector read, safe peer projection, Network page and overview summary. Validate client version/permissions; missing LastSeen is unknown.
2. M8.2 Harden metric rollups/query resolutions/coverage and series caps using accelerated 400-day fixtures; add time controls and library/storage history. Preserve event baselines across retention.
3. M8.3 Implement documented online backup/restore CLI, DB budget diagnostics, WAL/checkpoint handling and retention pressure behavior. Run restart/DB-full/corrupt-backup scenarios; do not mutate the user's actual DB for tests.

**Expected modules:** `collector/internal/tailscale`, peer fixtures/contracts, `features/network`, DB `retention/backup` and query refinements, history UI controls, integration/system resilience tests and restore runbook.

**Acceptance:** Only locally known peers are claimed; no cloud token needed; permission denial affects only Tailscale. Metrics retain real coverage through downsampling, event replay stays idempotent after pruning. DB+WAL disk growth is measured against architecture budgets. Restored DB reproduces history, rejects old sessions and passes integrity checks. Upstream outages never count as app readiness failure.

**Tests:** Online/idle/offline/missing last-seen, absent peers/permission denial; rollup sum/count correctness, gaps/capacity reset, query bounds, series admission, full disk, write queue overflow, WAL growth, backup integrity, migration rollback via restore.

**Validation commands:** `go -C collector test ./...`; `npm run check`; `npm run test:integration -- --project=network`; `npm run test:integration -- --project=persistence`; `npm run test:e2e -- --grep 'network|history|events'`; `npm run test:live -- --provider=tailscale`; `npm run test:resilience`. Compare local status output only after reviewing its privacy content.

**Dependencies:** M7 for all retained series/event families. This is hardening of M2 persistence, not a second history implementation.

## M9 — monitoring v1 release

**Status:** M9.1 fixture UI review in progress; M9.2–M9.3 and all required live release gates pending. See [v1 validation report](docs/plans/v1-validation-report.md).

**Goal:** Ship a small, coherent, documented monitoring product with proven installation and failure behavior.

**Scope/tasks:**

1. M9.1 Finish visual/accessibility/responsive review across mixed live/empty/stale/error states. Tune hierarchy and performance without adding feature scope.
2. M9.2 Validate fresh Ubuntu install, service-only and full-collector configurations, amd64/arm64 app builds, upgrade/restore and permission matrix. Record exact supported versions/hardware.
3. M9.3 Run at least 24h soak on the reference setup, measure budgets, inspect logs for canaries and request counts, verify read-only API behavior and no unintended ingress. Publish release notes and known limitations.

**Expected files/modules:** Existing feature refinements only, deployment examples/runbooks, CI release pipeline, versioned compatibility matrix, `docs/plans/v1-validation-report.md` introduced with measured evidence.

**Acceptance:** All prior required gates satisfied or unsupported environments clearly excluded from compatibility claims. No broken nav, secret exposure, fabricated freshness or broad app privileges. All questions in PRODUCT's v1 scope have a useful answer or explicit unsupported/unknown explanation. Default setup remains private with login. Restore drill passes. Budget misses are fixed or documented with measured reasons and revised limits. No infrastructure actions included.

**Tests:** Full relevant unit/integration/e2e suite, accessibility and keyboard review, actual Ubuntu deployment, independent adapter failure injection, resource soak, secret sentinel audit and backup restore.

**Validation commands:** `npm ci`; `npm run check`; `npm run test:unit`; `npm run test:integration`; `npm run test:e2e`; `npm run test:security`; `npm run test:resilience`; `go -C collector test ./...`; `go -C collector vet ./...`; `docker compose -f deploy/compose/compose.example.yml config --quiet`; `npm run test:live -- --provider=all`; `npm run test:soak -- --hours=24`. Live/all covers configured integrations only and reports omissions explicitly. Multi-architecture image build is required in release CI.

**Dependencies:** M1–M8. The soak command intentionally runs longer than a normal coding session; implementation must expose progress and a resumable report, not imply a short check substitutes for it.

## After v1 (uncommitted)

Consider storage forecast, optional Prowlarr statistics, safe artwork caching, per-library byte attribution, webhook/event completeness and Compose grouping only after usage feedback. Logs/control actions, multi-host collection and external alerts each require a new scope/security decision. No tasks or placeholders for these belong in the initial implementation.

## Requested add-ons — server display, Docker clarity, SMART test evidence

**Status:** Implementation complete for wallboard, Docker search/filters and ATA self-test evidence. Host schedule activation and real-device validation remain pending; see [add-on validation](docs/plans/addons-validation-report.md).

**Acceptance:** Six bounded wallboard widgets with fullscreen and detail navigation; desktop no-scroll target 1280×720; Docker search and attention/state filters retain optional-stop semantics; SMART progress/results preserve original evidence time; host-owned schedule preview clearly says it is not installed. No app infrastructure control route or new privileges.

**Remaining:** Activate reviewed smartd schedules on Ubuntu, validate actual ATA hardware and installed smartmontools behavior. NVMe/SCSI self-test projection and in-app test initiation/schedule activation are outside this delivered slice.

## Requested follow-up — web-started SMART tests (2026-10-01)

**Status:** Implemented in the workspace; host deployment and hardware validation pending. Storage offers short and extended start buttons for current ATA evidence. The optional host control service accepts only allowlisted IDs and fixed test types via a group-restricted Unix socket. The app route requires owner session, exact origin and CSRF; browser data never supplies a device path. See [decision 006](docs/decisions/006-web-started-smart-tests.md), [host setup](docs/operations/smart-tests.md), and [validation evidence](docs/plans/smart-control-validation-report.md).

**Validation remaining:** Run Go tests and vet with an installed Go toolchain; install and inspect the socket service on Ubuntu; verify an actual short and extended test and confirm the drive-reported results. No test was initiated on physical hardware by this change.

## Requested investigation add-ons — 2026-09-27

**Status:** Implementation and local fixture validation complete; live compatibility gates remain open. See [investigation validation](docs/plans/investigation-validation-report.md). M9 live release gates remain open.

**Acceptance:** Compose project/service disclosures and full-group attention counts; conservative identity-aware storage forecasts with coverage and uncertainty; cached problem evidence/events/chart/service links; browser preferences for selected volume, range, filters, widget order and wallboard privacy; verified backup creation timestamps and restore guidance. Migration 005 retains bounded forecast history and clears backup status on restore.

**Deferred:** External notification delivery is specified in the [post-v1 design](docs/plans/external-notifications.md); no sender is installed or enabled. Live Engine/Compose, Ubuntu install/restore, hardware and resource soak remain unverified for these additions.

## Requested integration controls and files — 2026-10-03

**Status:** Implemented in the workspace. Ubuntu deployment and live hardware, Docker Engine/Compose and NFS/SMB validation remain pending. The [Copilot handoff](docs/operations/copilot-integration-setup.md) and [validation evidence](docs/plans/integration-controls-validation-report.md) track the next gate.

**Delivered:** SMART control preflight, persistent cooldown and socket ownership; allowlisted Docker container/Compose `start`, `stop`, `restart` with authenticated UI and bounded audit; optional SMB/NFS mount health with last-good capacity evidence; one-share file browsing, folder creation, resumable uploads up to 100 GiB, rename and nonrecursive delete. App containers receive only group-restricted sockets in the existing sanitized host mount. See [Docker decision](docs/decisions/007-allowlisted-docker-control.md), [file decision](docs/decisions/008-mounted-share-file-service.md) and [file setup](docs/operations/files-setup.md).

**Validation remaining:** Run Go tests/vet with Go 1.24+; verify effective systemd/Compose permissions and action behavior on Ubuntu; test actual Docker targets, ATA SMART hardware, NFS/SMB mount failures and long upload resume. No real infrastructure action was performed by this repository change.
