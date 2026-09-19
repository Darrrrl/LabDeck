# Risk register and verification gates

All live environment assumptions are unverified at planning time. The architecture resolves ordinary choices; these gates identify evidence needed during implementation, not reasons to postpone the documentation pass.

| Risk | Consequence | Decision / mitigation | Verification owner |
| --- | --- | --- | --- |
| Docker socket privileges | Collector compromise can control host | No socket in app; fixed exporter reads and projected fields; explicitly trusted optional module | M6 privilege review and fake-daemon method/path assertions |
| SMART permissions/controller variation | Excessive privileges or misleading/missing health | Separate root timer; configured devices; protocol-aware nulls; no self-tests | M7 ATA/NVMe/USB/HBA compatibility report |
| Host vs container metrics | Plausible but wrong server values | Host process, explicit counters/mounts, compare with host tools | M2 Ubuntu live validation |
| Filesystem/pool overlap | Inflated capacity and misleading health | Selected filesystem IDs; no physical-member sum; pool health out of scope | M2/M7 duplicate/bind/RAID scenarios |
| Secret-bearing vendor responses | API keys leak via nested configuration/errors | Allowlisted projection, no raw persistence, sentinel tests | M1/M3/M5/M6 |
| Powerful integration keys | Stolen read-only app credentials allow writes upstream | Dedicated keys where possible; network isolation; fixed GET client; documented residual risk | Every service live gate |
| API version/pagination drift | Inaccurate counts or partial data shown as complete | Versioned fixtures, runtime validation, partial flags and caps | M3–M5 |
| Prowlarr connectivity assumption | False green application/indexer state | Evidence or unknown; no automatic test calls | M5 |
| Jellyfin session/mode/count permissions | Wrong active-stream count or totals | Verify playback state and field semantics per installed version | M3 |
| Tailscale local visibility/permissions | Incomplete peers or overly broad operator permission | Known-peers label; denied state; no broad grant by default | M8 |
| Polling misses short events | False promise of complete audit history | Observed-vs-upstream distinction; gap markers; baseline logic | M2 onward |
| Poll fanout and hung requests | Slow dashboard/resource exhaustion | Cached REST, deadlines, group isolation, global caps/backoff | M2/M4/M6 load checks |
| Series cardinality/SQLite write load | Disk growth and blocking Node loop | Series admission, minute buckets, retention, short transactions; profile before worker/DB change | M8/M9 |
| Native SQLite addon/platform builds | Image fails on target architecture | Pin compatible versions, test linux amd64/arm64 | M1/M9 |
| Collector schema drift/clock reset | Stale data looks current or rate spikes | Schema major check, generation/boot IDs, original timestamps, safe null deltas | M2/M7/M8 |
| SMART wakeups/vendor thresholds | Unnecessary power cycles or noisy alarms | Standby-aware tested reads; per-disk thresholds, actual-sample hysteresis | M7 hardware gate |
| Public/LAN exposure or session bypass | Personal activity and host inventory exposed | Loopback default, TLS, owner auth, Host/Origin/CSRF and no generic proxy | M1/M9 network validation |
| Upgrade/restore error or full disk | Lost history/session inconsistency | Backup API, integrity check, pressure modes, pre-migration backup | M8/M9 restore drill |
| Too much feature scope | Unpolished broad dashboard | First release M1–M3; no actions/scans/forecasts; later v1 gates explicit | Every milestone scope review |

## Environment facts to collect during implementation

- Exact Ubuntu/kernel and CPU architecture; local disk filesystem and intended app data path.
- Jellyfin/Arr/Prowlarr versions, configured API base paths and browser UI origins. Secret files are supplied locally, never pasted into reports.
- Primary storage volumes, pool topology, stable physical disk IDs and controllers; permitted collector installation method.
- Docker Engine/rootless status and which containers are expected to remain running. Rootless daemon socket path/permissions need separate verification.
- Tailscale version and minimal local-status permissions; primary physical network interface.
- Owner TLS access path and hostname; availability of local Tailscale Serve or another TLS reverse proxy.

Defaults remain single host, one integration instance of each kind, read-only monitoring, local SQLite, no public ingress and no optional elevated module enabled without explicit installation configuration. Unknown environment facts do not justify guessing hardware mappings or granting broad privileges.
