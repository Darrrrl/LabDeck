# Host collector and physical disk boundary

## Topology and protocol

Install one Go binary and two independently permissioned systemd execution modes: a long-running ordinary collector for system/optional Docker/Tailscale reads, and an optional SMART oneshot timer. The application has no IPC path that can request commands. The ordinary process must not execute SMART via sudo or gain root simply because SMART is enabled.

Root-owned configuration at `/etc/labdeck/collector.json` defines a stable host ID, selected mountpoints/interfaces, disk IDs/device types and optional modules. Ownership/mode must prevent writes by the app and ordinary collector. The daemon runs as `labdeck-collector`; an installation-created `labdeck-readers` numeric group allows the app container to read snapshot files. Root-owned parent directories prevent cross-module replacement:

- `/var/lib/labdeck-collector/public/system/`: ordinary collector writable.
- `/var/lib/labdeck-collector/public/smart/`: root SMART helper writable, reader group readable.
- Mount the public parent directory read-only at `/run/labdeck-host` in the app, not individual files (atomic rename replaces inodes).

Snapshots are 0640, directory access 0750, with reviewed matching group IDs. No world-readable host inventory. Collector writes a temporary file in its module directory, fsyncs it and renames atomically. App opens only fixed filenames, rejects symlinks/non-regular files and enforces decoded size ≤2MiB each. Collector temp files never become accepted filenames.

Versioned envelope: `schemaVersion`, `collectorVersion`, `hostId`, `bootId`, `generation`, `sequence`, `generatedAt`, and independently timestamped capability results with safe errors. Sequence restarts only with a new random collector generation; boot ID separates rate baselines. Preserve original observed timestamps for cached sections. SMART file and ordinary file merge by capability, never by file-read time. Unsupported protocol major, future timestamp, malformed file, expired observation or unreadable file creates an explicit diagnostic and preserves last good data. Retain no raw command output.

Systemd hardening should include no-new-privileges, protect-system/home, bounded memory/tasks, explicit write paths and restricted address families where compatible. Do not use PrivateDevices for SMART or hide required host `/proc`/mountpoints from system collection. Test actual mount visibility: a hardening option that substitutes tmpfs for a configured mount can produce false capacity. Root SMART configuration and binary must not be modifiable by the ordinary collector. No installer runs privileged host commands automatically from the app container.

## System metrics

Read host `/proc/stat`, `/proc/meminfo`, `/proc/uptime`, `/proc/loadavg`, `/proc/net/dev`, `/proc/diskstats`, selected `/sys` device identity, and configured mount statfs values. Running on the host avoids accidentally reporting container CPU quotas, memory or overlay storage as the server.

- CPU model and logical CPU count are metadata; utilization derives from counter deltas with a documented idle/iowait convention. Load averages are not CPU percentages.
- RAM used = total − MemAvailable; show cache/reclaimable semantics in details. Swap used = total − free; absent swap is valid.
- Network shows selected physical/logical interfaces separately. Default excludes loopback, veth and bridge interfaces from totals to avoid double-counting; let the owner choose the primary link. Tailscale overlay traffic is separate from physical link traffic.
- Disk I/O uses named block-device deltas and documents `/proc/diskstats` sector units. Do not sum a partition and its parent or RAID logical and member devices. Unsupported devices yield null.
- Filesystem identity includes configured logical ID, source, fs type and mount identity. Snapshot total/free/available/used/reserved separately. `used = total - free`; `available` is what unprivileged writers can allocate, and `reserved = free - available`. Capacity percentage uses used/total; explain reserved space and show available prominently.

Require explicit selected volumes for overview aggregation; refuse duplicate identities. Bind mounts, overlay, tmpfs and remote filesystems are excluded by default. Filesystem-to-physical-disk relationships may be many-to-many; v1 does not infer health of a pool from a guessed one-to-one mapping. Pool-aware capacity and ZFS/Btrfs/RAID health are future adapters; ordinary statfs capacity alone is labeled accordingly.

## Docker

Optional ordinary collector module gets the Docker Unix socket. This is effectively administrator access even when code uses only reads; membership in a docker group is not a reduced-privilege role. The application never gets that group/socket. A future dedicated Docker exporter process can narrow collector compromise impact, but is not needed as an extra service now.

Negotiate supported Engine API version; use fixed allowlisted reads: version, container list with all states, inspect selected IDs, and one-shot stats (`stream=false`, options checked against installed Engine). Concurrency 2, each request ≤5s, overall cycle ≤10s; containers beyond the cycle budget retain old stats with age. Target validation load is 50 containers. Consult [Docker Engine API](https://docs.docker.com/reference/api/engine/) during implementation for exact field/CPU/memory behavior.

Export ID, safe name/image display, created/start timestamps, running/stopped/restarting state, healthcheck status, restart count, CPU and memory usage/limit. Never export environment, labels wholesale, mounts, command arguments, registry auth, or healthcheck logs. Memory should clearly identify working-set vs raw usage; prefer working-set excluding cache only when the platform counters support it, otherwise label raw usage. Stopped containers have no current CPU/RAM measurement; do not display stale running stats as current.

Allow operator-configured expected-running container names for aggregate warnings. Container ID identifies a lifecycle; a recreated same-name container is a new entity. Compare restart counters within the same ID, handle counter reset and baseline first observation. Polling misses short lifetimes; events are “restart observed,” not a complete Docker audit. No logs/events stream, exec, archive endpoint, or writes in v1.

M6 fixture implementation negotiates API versions 1.40–1.45 from `/version`, reads only `/containers/json?all=1`, validated-ID `/containers/{id}/json`, and `/containers/{id}/stats?stream=false`. Every request is GET-only; each has a five-second deadline and 2 MiB body limit. Two per-container workers share a ten-second cycle budget and cap inventory at 100. The collector publishes safe names/images, state/health, restart count, nullable CPU, and memory. CPU uses 100% per logical CPU fully occupied; a missing/reset delta is null. Memory is labeled working set if Linux `inactive_file` or `total_inactive_file` evidence exists, otherwise raw cgroup usage. A stopped container has null current stats. Missed stats retain their original `statsObservedAt` timestamp; partial inventory never implies disappearance. The host snapshot is still protocol v1 with optional `docker` capability, so old snapshots remain valid. Go fake-Engine fixtures establish parsing only; installed Engine compatibility remains unverified.

## SMART

The optional root-owned systemd timer executes the fixed installed binary in SMART mode every 10 minutes. It invokes an absolute trusted smartctl path with an argument array, never a shell. Config contains reviewed `/dev/disk/by-id` identities and allowlisted device types; validate resolution to block devices and stable identity before each read. Device selection never comes from HTTP or an app-writable file. Initial device discovery is an operator-run setup step, not periodic scanning.

Proposed read is JSON information/health/attributes/error counters with standby-aware options such as `smartctl -a -j -n standby <configured-device>`. Exact arguments and return interpretation are a hardware verification gate: SATA, NVMe, USB bridges and HBAs differ. Reading may wake some hardware despite standby options. Do not issue self-tests, enable/disable SMART, reset counters, or change disk power settings.

Root is the compatibility baseline only for this short-lived helper. Narrow capabilities/device ACLs may work but must be tested rather than assumed. Do not grant the dashboard privileged mode, broad `/dev` access, or host root. Root helper has no network requirement. Document each mapped device and why permission is needed.

Normalize identity using WWN/serial/model when available, display a friendly configured label plus serial suffix, retain stable ID across `/dev/sdX` reordering. Export capacity, protocol, model, temperature, overall SMART evidence, power-on hours and supported counters. ATA: reallocated/pending/offline-uncorrectable sectors where defined. NVMe: critical warning, spare, percentage used, media/data-integrity errors and error log count. SCSI: supported error/health fields. Do not map unlike protocol counters into fake ATA fields; preserve null + unavailable reason. Retain large counters as decimal strings if necessary.

smartctl exit status includes health/error bits, so nonzero is not automatically a failed invocation. Distinguish parse/permission/device failures, standby skip and actual SMART findings; [smartmontools exit-status definitions](https://www.smartmontools.org/static/doxygen/smartctl_8h_source.html) and [implementation](https://www.smartmontools.org/static/doxygen/smartctl_8cpp_source.html) confirm that the return value needs interpretation. Full man-page retrieval was blocked during planning; verify against the installed smartctl manual in M7.

Keep last known observation when asleep, labeled asleep and dated. Missing temperature is not 0°C. Default example thresholds: warning ≥45°C sustained for two actual samples, clear <42°C for two samples; make thresholds per disk configurable and state they are operational settings, not manufacturer limits. Overall SMART fail is critical immediately; pending/uncorrectable sectors warn; increases in relevant error counters produce evidence-based warnings. Reallocated counts alone do not prove imminent failure. NVMe warning bits require protocol-specific interpretation. Show “SMART cannot predict when a disk will fail.”

## Tailscale

Run a fixed `tailscale status --json` command with a 5s timeout and 2MiB output limit; no shell, no arbitrary flags, no diagnostic uploads or pings. Confirm local status is readable by the collector user before granting anything additional; if it is denied, surface permission-denied and leave disabled until an operator reviews the minimal access. Do not grant broad Tailscale operator controls merely for observation.

The [Tailscale CLI](https://tailscale.com/docs/reference/tailscale-cli) documents JSON status output. Its [status types](https://github.com/tailscale/tailscale/blob/main/ipn/ipnstate/ipnstate.go) expose online and last-seen information, but support and completeness must be validated against the installed client. Export local backend status, self hostname/IPs and locally known peer IDs, hostnames, Tailscale IPs, online and optional last seen. Discard user profiles, keys and unrelated network metadata.

Online comes from reported status, not recent byte traffic or a guaranteed probe. LastSeen can be omitted/zero and must stay unknown. Devices not visible under local network policy are not declared offline. No cloud admin API token is required. Tailscale itself uses its existing control infrastructure; LabDeck adds no cloud backend and continues displaying other local data if Tailscale is unavailable.
