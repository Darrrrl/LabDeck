# Decision 003: bounded synchronous SQLite telemetry writes

Status: accepted for M8 fixture implementation; measure on the reference host at M9.

The M0 architecture anticipated a 1,000-batch asynchronous write queue with coalescing. The implementation instead uses one Node process and one `better-sqlite3` connection with short synchronous transactions. Each host snapshot is capped by the collector protocol, the metric series registry admits at most 400 identities, retention deletes at most 1,000 rows per pass, and cached browser queries do not trigger collection. There is no separate write queue to overflow or acknowledge incorrectly.

This reduces moving parts in a single-owner app, but synchronous write latency can affect cached API p95 during bursts. M8's pressure policy uses measured DB+WAL size and filesystem free space: at 1 GiB it trims the oldest hourly telemetry in bounded batches; at 2 GiB or below 512 MiB free it pauses new metric/event writes while retaining capability-state attempts. SQLite write failure is caught by the existing state boundary and must not be presented as a confirmed durable observation. The Settings page exposes pressure and history-availability diagnostics.

The M9 soak must measure write latency, cached API p95, WAL size and event retention under the reference 50-container/200-peer workload. If the target is missed, introduce a bounded queue with explicit coalescing/drop semantics in a separate reviewed change. Until then, “write queue overflow” from the original plan is replaced by series-admission and disk-pressure tests; it is not claimed as a queue test.
