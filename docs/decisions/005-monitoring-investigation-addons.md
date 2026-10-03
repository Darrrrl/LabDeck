# Decision 005: monitoring investigation add-ons

Status: accepted for the owner's requested additions, 2026-09-27.

The owner requested Compose grouping, storage growth forecasts, problem investigation, browser preferences, and backup status. These are explicit additions to the original v1 boundaries; they do not complete the outstanding v1 live release gates. External notifications remain a separate post-v1 proposal.

## Docker grouping

The collector projects only `com.docker.compose.project` and `com.docker.compose.service` from list responses, as bounded identifier strings. Docker documents these [canonical labels](https://docs.docker.com/reference/compose-file/services/#labels). No arbitrary label map enters snapshots or SQLite. Both fields are optional so older snapshots remain accepted. Missing or invalid labels produce an ungrouped project or an unknown service; names are never guessed from container-name patterns. Projects and services expand with native keyboard-accessible disclosures. Project attention counts cover the full retained group even when local search/state filters narrow the visible rows. A stopped optional container stays neutral. Partial inventories retain prior containers and evidence time while clearly reporting incomplete collection.

## Storage forecast

Migration 005 adds a bounded daily filesystem table (at most 31 days for each of at most 64 configured filesystems). Each row retains last used bytes and observation time, capacity, a hash of logical ID/path/source/type/mount identity, and a 24-bit mask of observed UTC hours. Duplicate timestamps do not add coverage. Successful complete filesystem observations maintain this table in the same ingestion transaction; telemetry pressure pauses admission. Removed filesystems and expired days are pruned. Identity/capacity changes erase that filesystem's forecast baseline. Old metric buckets are not backfilled because they cannot prove identity and daily observation coverage.

A valid completed UTC day has observations in at least 18 distinct hours. Forecasts use the latest 30 completed days, require at least 14 valid days and 70% of that window (therefore at least 21 valid days), and need a valid day within the last two days. The current capacity evidence must be within 90 seconds. The estimator is the median pairwise slope of daily last used bytes (Theil–Sen); fixtures cover steady growth, a bulk-import outlier, deletions/flat growth, unstable alternating changes, sparse observations, and changed capacity/identity.

Low space means available bytes at or below 10% of total capacity. Headroom uses allocatable available bytes, so reserved bytes are not treated as writable space. Extrapolation anchors at the current observation time. Nonpositive median growth produces no date; nonpositive lower-quartile growth or upper/lower slope ratio above three is unstable. The lower and upper quartiles give a plausible date range, explicitly not a statistical confidence interval. A range extending beyond 180 days is reported beyond the horizon. An already crossed threshold is stated directly. No forecast changes aggregate health or implies disk failure prediction.

## Problem investigation

Authenticated cached GET routes `/api/v1/problems` and `/api/v1/problems/:id` derive current problems from existing stored observations. A stable opaque problem ID combines instance, entity, and problem kind. The list is capped at 200; details contain at most ten related events and one bounded existing metric projection where available. Event matching requires the same instance and, for entity problems, the same entity. Integration-wide events are described as such. The screen displays actual evidence time, freshness, provenance and occurrence time, plus a monitoring link and the configured service URL when present. Missing metric history is explained. It makes no root-cause claim. Resolved/no-longer-present IDs return 404 rather than inventing persistent incident state.

## Preferences and backup evidence

Versioned, runtime-validated local storage holds only chosen volume ID, history range, container search/filter, widget order and a wallboard title-privacy flag. This is an intentional exception to the memory-only operational data cache: API responses, credentials and playback data remain memory-only. Preferences are per browser/origin, survive logout, support reset, and fall back to tab memory if storage writes fail. Widget order is applied in DOM order so keyboard/screen-reader order matches presentation. Status and current problems remain ahead of widgets. Privacy hides titles from rendered text and tooltips, not from the authenticated API or Media page.

Migration 005 also adds one backup-status row. The CLI records success only after integrity/foreign-key verification and atomic target publication. It stores timestamps only, never the target path. Status recording needs write access to the source DB; a failure reports that the backup file exists but status recording failed. Older schemas are still backed up without adding a status table. Restore clears sessions and backup status in the destination. Settings reports creation-time verification, not continuing existence or integrity of the external backup file. No browser backup/restore action is introduced.
