# Optional external notifications — post-v1 design

Status: proposal only, 2026-09-27. No delivery code, credentials, new outbound requests, or notification tables are installed by this change. Implement only after v1 release validation and authorization of a destination.

## Behavior

Start with one optional server-configured HTTPS webhook destination. Default is disabled. Send versioned JSON for confirmed integration outage/recovery, storage threshold/recovery, SMART failure/warning/counter increase, and temperature warning/recovery. Consume committed event episodes, not UI polling or the generic current-problems list. Establish a baseline on first enablement; do not replay retained historical events as new alerts. Recovery references the matching open episode and uses observed duration with observation gaps explicitly unknown.

The initial payload includes delivery ID, event kind, severity, observation time, optional occurrence time, origin, and operator-configured source alias. It omits media titles, usernames, filesystem paths, IPs, raw error text, headers, and credentials. A configured dashboard URL may provide a private investigation link. Delivery is optional and cannot affect application readiness or collection.

## Delivery boundary

Configuration and an optional bearer-token file stay server-side. Validate one fixed HTTPS origin/path at startup; reject credentials in URLs, query strings, fragments, and redirects. The browser cannot supply destinations, secrets, or test-send requests. Reuse bounded transport mechanics where compatible, but implement outbound POST in a separate notifier rather than widening read-only integration transport. Apply a five-second request deadline and cap JSON bodies and response reads at 8 KiB. Log safe outcome codes only.

A future versioned SQLite migration will add a durable outbox and episode-delivery state. Use event dedupe key plus destination revision plus notification kind as the uniqueness key. A single worker sends at most one request per second. Retry transient network errors, 429, and 5xx after 30 seconds, 2 minutes, and 10 minutes, then mark failed; honor Retry-After up to 15 minutes. Treat other 4xx as permanent and surface a safe Settings diagnostic. Use a stable delivery ID for retries and document at-least-once delivery: a crash after remote receipt can produce a duplicate.

Cap pending deliveries at 1,000 and retain delivery metadata for seven days, without storing response bodies. Emit one notification per episode and one recovery; suppress repeats for 30 minutes per source/entity/kind, while allowing an escalation to critical and a recovery through. Coalesce suppressed counts into the next eligible message. Show overflow/dropped counts and last successful delivery in Settings. Destination revision changes discard unsent messages for the old destination and establish a new baseline; disabling stops sending immediately without deleting monitoring history.

## Acceptance and rollout

Tests must cover enablement baseline, deduplication across restart, cooldown/escalation/recovery, partial observations, DB commit failure, network timeout, 429/backoff, redirects, permanent rejection, outbox limits, crash-after-delivery replay, and secret/privacy canaries. Use a local fake webhook receiver before any authorized live delivery. Document the receiver's authentication and payload compatibility. Ship disabled, enable for the single configured destination only after a reviewed test message, and retain independent failure diagnostics. This design does not authorize sending messages during the current task.
