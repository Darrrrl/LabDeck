# Integration contract

This is the normative implementation contract. TypeScript below specifies shapes, not an implementation or a requirement to generate empty modules.

## Identity and capability boundary

An instance has an operator-chosen stable ID, display name, provider kind, enabled flag, required-for-overall flag, secret reference and configured base URL. IDs must not contain addresses, credentials, or display names that change over time. Entity IDs are namespaced by instance. Changing a provider/origin under an existing ID requires a new config revision and resets cursors/baselines; never silently combine unrelated histories.

```ts
type Connection = 'unknown' | 'reachable' | 'unreachable' | 'auth-error';
type Health = 'unknown' | 'healthy' | 'warning' | 'critical';
type Availability = 'supported' | 'unsupported' | 'permission-denied';
type ErrorCode = 'timeout' | 'network' | 'auth' | 'rate-limited'
  | 'invalid-response' | 'unsupported-version' | 'permission' | 'internal';

interface IntegrationAdapter {
  readonly kind: ProviderKind;
  readonly groups: readonly PollGroup[];
  poll(context: PollContext, group: string): Promise<PollBatch>;
}
interface PollGroup {
  id: string;
  capabilities: readonly CapabilityName[];
  intervalMs: number;
  deadlineMs: number;
  establishesConnection: boolean;
}
interface PollContext {
  instanceId: string;
  signal: AbortSignal;
  now: () => Date;
  cursor: unknown; // validated by the adapter; no secrets
  transport: ReadOnlyTransport; // bound origin, headers, paths, time/size limits
}
interface PollBatch {
  results: CapabilityResult[]; // discriminated union keyed by capability name
  metrics: MetricObservation[];
  events: EventCandidate[];
  nextCursor?: unknown;
}
```

`CapabilityResult` is either a successful typed observation, explicit unsupported/permission state, or safe failure code. Each success includes capability, `observedAt`, completeness (`complete | partial`), Health, normalized warnings and a typed payload. Partial list data includes coverage/truncation and must not replace a known complete inventory or create disappearance events. Failure never supplies a fabricated empty payload.

Define only capabilities a completed slice uses: `host.summary`, `host.filesystems`, `host.interfaces`, `host.disks`, `media.playback`, `media.library`, `downloads.queue`, `downloads.catalog`, `downloads.history`, `indexers.health`, `containers.inventory`, `containers.stats`, `network.peers`. Domain payloads are discriminated types, not arbitrary JSON bags. Common summaries derive from capability state in core selectors; avoid separate health/summary calls fetching the same data twice.

Provider contexts receive narrow dependencies, not DB handles or an unrestricted HTTP client. Host adapter reads validated local snapshots instead of receiving a network transport. All instances use the same outcome envelope. An unexpected thrown adapter error is caught at the scheduler boundary and converted to a safe failure.

M6 Docker snapshots contain only a bounded, projected inventory and nullable per-container stats with their own observation timestamps; a partial inventory cannot prove removal. M7 SMART snapshots are a separate versioned, atomic file produced by a root one-shot timer. The app reads that sanitized file; an optional separate socket service accepts only fixed self-test starts and is never used for reads. The app has no raw-device path. Disk state is `ok | asleep | unsupported | permission-denied | timeout | read-failed`, independent from SMART health `passed | warning | failed | unknown`. A non-`ok` read preserves prior measurements and their original evidence timestamp while reporting the current state/time. Physical-disk capacity is never added to filesystem capacity. Counters that may exceed JavaScript's safe integer range are decimal strings; missing is unknown, not zero. See [hardware gate](smart-hardware.md).

M8 Tailscale status is an optional, fixed local CLI read in the ordinary collector. It projects only safe local status and at most 250 locally known peers; absent LastSeen remains null and reported Online is not a reachability probe. A partial list cannot erase a complete cached inventory. The app has neither a Tailscale socket nor a command path. See [compatibility gate](tailscale.md).

## State and freshness

Persist `lastAttemptAt`, `lastSuccessAt` and `lastErrorCode` per poll group, plus last good observation time per capability. Public fields include `observedAt`, `lastSuccessfulRefreshAt`, `nextExpectedAt`, and derived freshness (`fresh | stale | never`). A fresh file read does not refresh old collector data; use the collector's sample timestamp.

- Stale after `max(3 × group interval, 30s)` without a successful fresh observation; SMART uses three SMART intervals.
- A failed attempt updates the error and attempted time immediately, while the previous payload retains its timestamp. Show “Connection failed · showing data from 12 minutes ago.” A failure is not a zero count.
- A timeout is “Unreachable,” not proof the upstream process is stopped. Unauthorized is “Credentials rejected.” A missing endpoint does not necessarily make the whole service unreachable.
- Instance connection comes from the designated cheap connection group. Capability errors remain local; one slow library query cannot overwrite evidence of a successful session connection.
- Scheduler restart loads old timestamps; it does not declare cached data fresh. Future timestamps >30s ahead are invalid and trigger a clock diagnostic.
- Ingest each collector generation/sequence/capability observation only once. Re-reading an unchanged file may confirm transport availability, but must not add metric samples, advance threshold hysteresis, duplicate events, or refresh observation timestamps. Persist the ingestion watermark with the resulting writes.
- Empty successful lists are distinct from failures. Unsupported never becomes zero or healthy. Disabled/not-configured instances are excluded from aggregate health.

Overall precedence: current critical finding → “Critical”; current connection failure or warning → “Needs attention”; otherwise missing/stale required observation → “Monitoring incomplete”; otherwise → “All observed systems healthy.” Preserve secondary stale/coverage badges even when a higher-severity headline wins. Optional unsupported capabilities do not invalidate an otherwise observed service; requiredness is explicit per instance/capability. Persist outage transitions after two consecutive failed connection polls, recovery after one success; display failed attempts immediately. Unknown start-up state is not an outage event.

## Polling and resilience

| Group | Default cadence | Group deadline |
| --- | --- | --- |
| Host snapshot ingest | 5s (collector publishes every 5s) | 2s |
| Jellyfin playback / service connection | 10s / 30s | 8s / 8s |
| Arr queue / health | 15s / 60s | 10s / 10s |
| Imports/history | 60s | 15s |
| Catalog/counts/recent additions/calendar | 5m | 20s |
| Docker inventory / stats in collector | 15s | 10s |
| Tailscale status in collector | 30s | 5s |
| Filesystems in collector | 30s | 5s |
| SMART host timer | 10m | 20s per disk; 2m total |

Use ±10% jitter. At most one active poll per instance/group, two requests per instance, eight external requests globally; one SMART process at a time. No overlapping interval jobs or unbounded pending queue. Schedule the next job after completion. Per-request 2s connection/5s total timeout, maximum 2MiB decoded body, 10 pages of 100 entries per group, maximum 10MiB total group data. Exceptions for an unpaginated catalog need a documented cap, not unlimited parsing. If capped, expose partial/unsupported detail and retain safe summary totals when authoritative.

No immediate automatic retries within a poll. Consecutive group failures back off to 2×, 4×, up to 5m; honor Retry-After up to 15m. Auth failures retry slowly (5m). Success resets backoff. Cheap connection groups remain independently scheduled, but an instance-wide auth/rate-limit response gates all its groups. Catch every rejection. Cancel ongoing work on shutdown and drain bounded DB writes. Polling must not depend on browser presence.

## Metrics and events

Metrics use a registry: name, unit, scope, sampling class, valid range and aggregation meaning. Units: bytes, bytes/s, Celsius, seconds, count, ratio (0–1), CPU percent with its denominator explicitly documented. No arbitrary labels. An entity ID may identify a configured filesystem, physical disk, interface or selected container; names/titles/users are not metric labels.

Counters are converted to rates using monotonic elapsed time in the collector. A first sample, reboot, negative delta, device replacement, reset or invalid elapsed interval produces null, never a spike. Library counts and filesystem capacity are gauges. Container CPU uses 100% per fully occupied logical CPU; host CPU is 0–100% across all CPUs. The UI must make these different denominators visible.

Events contain `kind`, `severity`, `instanceId`, optional `entityId`, nullable upstream `occurredAt`, local `observedAt`, origin (`upstream | observed | threshold`), deterministic dedupe key and a small typed safe payload. Titles are generated from the typed payload, not raw HTML or log text.

For upstream history use instance + event type + upstream ID, fetch an overlapping recent window, and persist cursor + events in one transaction. First connection baselines existing history without flooding the feed; optionally show the latest 20 clearly labeled historical entries. For snapshot transitions use persisted prior state and an episode/generation key. Baseline on first successful complete inventory; absence from partial/failed snapshots never means stop/deletion. Repeated thresholds produce one open episode and one recovery. If collection was absent, log an observation gap and bound the outage interval instead of inventing exact duration.

Keep a separate dedupe/cursor baseline long enough that event retention cannot cause recurring old events to reappear. A config revision reset baselines again. If DB commit fails, do not advance the persisted cursor; uniqueness makes replay safe. Store neither full sessions nor raw commands in event payloads; watching history is sensitive local data.

## Adding an integration

### Optional YouTube download jobs

`GET /api/v1/youtube` is an authenticated, `no-store`, cached read of the separate host worker: `configured`, `available`, nullable last successful `observedAt`, and at most 121 bounded jobs. Poll failures retain last-good jobs and their original timestamps. Browser reads never extract metadata or poll the worker. `POST /api/v1/youtube` accepts only the strict shared preparation/submission/cancel/retry union; all mutations require owner session, exact origin and CSRF. Preparation accepts a fixed media kind, public HTTPS YouTube source and supplied names, never paths or flags. Submission freezes approved music-title edits against an opaque prepared job; cancel/retry use only that job ID. A 202 acknowledges a worker command, not download completion. Worker errors are sanitized categories.

States distinguish preparing, ready preview, queued, downloading, processing, completed, partially-completed, failed, cancelled and interrupted; item states retain unavailable playlist positions without renumbering. Restart requires explicit retry and retains completed files. Source IDs and normalized manifests live only in the worker's separate version-1 SQLite database, not LabDeck state. File paths in responses are relative preview destinations, never host roots. No raw extraction responses, query-string URLs, subprocess logs or credentials persist. See [decision 009](../decisions/009-youtube-downloader.md), [installation and limits](youtube-downloader.md), and [validation evidence](../plans/youtube-validation-report.md).

Implement a typed payload, sanitized fixtures and adapter; register its groups and safe transport routes; add summary/detail selectors and UI; add failure/partial tests and compatibility evidence. Reuse core health/history/auth rather than adding integration-specific versions. Do not require every provider to supply every capability.

### Optional ATA self-test evidence

`host.disks` and the SMART snapshot can include nullable/omitted `selfTest`: state (`unknown | idle | running`), nullable 0–100 integer remaining percentage, nullable short/extended minute estimates, and up to five newest-first test entries. Entries contain only normalized type, result (`passed | failed | aborted | interrupted | running | unknown`) and nullable lifetime hours. Arbitrary vendor result text is discarded. Missing fields preserve compatibility with older collectors. The disk evidence timestamp applies to all test fields; failed/asleep reads retain the original evidence. There is no calendar completion time or schedule-installed claim. Optional `POST /api/v1/storage/smart-tests` accepts strictly `{diskId, type: "short" | "extended"}` with owner session, exact origin and CSRF; only fresh readable ATA disks are eligible. A 202 `started` response reports host command acceptance, not test success. No browser request polls SMART; the normal timer remains the source of test results.

### Investigation additions

Docker containers may include optional nullable `composeProject` and `composeService`, restricted to 1–128 characters matching `[a-zA-Z0-9][a-zA-Z0-9_.-]*`. Only the two canonical Compose labels are projected; old snapshots remain valid. Partial Docker inventories keep prior containers and original evidence time and expose `partial-inventory` with unknown total.

Storage responses add optional `forecasts` keyed by selected filesystem ID. Each result includes status, original observation time, the fixed 30-day window, valid-day count and coverage, threshold bytes, nullable growth and nullable date/range. See [decision 005](../decisions/005-monitoring-investigation-addons.md) for the estimator and admission requirements. Settings adds optional `backup` timestamps for successful creation and integrity verification; null means no recorded evidence.

Problem list/detail schemas cap collections and preserve event origin and upstream occurrence time. Both routes are authenticated cached GETs with `no-store`; IDs are opaque stable hashes, not upstream addresses or proxy targets. Detail IDs that are no longer current return 404.

### Optional Docker and mounted-share actions

`POST /api/v1/containers/actions` accepts only `{kind:"container"|"project", id, action:"start"|"stop"|"restart"}`. It requires owner session, exact origin, CSRF, fresh complete cached Docker inventory, app-side allowlist, and an independent host allowlist. Container IDs are exact 64-hex identities; project IDs map to reviewed root-owned Compose files. The separate host socket returns only completed/rejected; the next collector snapshot is authoritative for observed state. The app retains at most 1,000 bounded action audit rows. See [decision 007](../decisions/007-allowlisted-docker-control.md).

The optional host snapshot `fileShares` capability has at most four configured entries with `id`, exact `path`, `kind`, `state`, `observedAt`, nullable `totalBytes` and nullable `availableBytes`. State is `ok | offline | unsupported | timeout | read-failed`; an unsuccessful observation retains last measured capacity and its original `evidenceAt` in app state. `GET /api/v1/files/shares` is a cached read with no upstream probe. The separate authenticated `POST /api/v1/files/operations` accepts fixed `list`, `start`, `chunk`, `finish`, `rename`, `delete`, and `mkdir` requests for only the configured control share. All require exact origin and CSRF. `start` accepts a relative path and size 0–100 GiB with optional resume ID; `chunk` accepts an opaque ID, exact next offset and at most 4 MiB of base64 data; `finish` requires full size and rejects a destination collision. List returns at most 200 entries and a cursor. No file data, path, or raw share listing is persisted in SQLite. See [decision 008](../decisions/008-mounted-share-file-service.md).
