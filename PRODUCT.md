# Product specification

## Purpose

LabDeck lets one homelab owner understand the server in five seconds, then investigate without opening several administration tools. It summarizes those tools and links to them for administration. It does not recreate their interfaces.

Primary environment: one Ubuntu server, Docker Compose, local persistent disk, existing Jellyfin/Sonarr/Radarr/Prowlarr/Tailscale, accessed from a MacBook over Tailscale. Desktop first; useful at 390px phone width and on tablets. No LabDeck cloud account, telemetry, external fonts, or public ingress is required.

## Release boundaries

| Capability | First usable release: M1–M3 | Complete monitoring v1: through M9 | Later |
| --- | --- | --- | --- |
| Overview | Overall observed health, freshness, uptime, CPU/RAM, network, selected storage, Jellyfin | All configured service summaries and prioritized warnings | Custom layouts |
| System | Hostname, CPU model/load/utilization, memory/swap, interfaces, filesystem capacity, practical block I/O | Refined trends and diagnostics | Multi-host fleet |
| Jellyfin | Active playback, user/title/progress/mode, optional bitrate, recent additions and counts | Same, hardened against supported versions | Rich artwork, watch analytics |
| Downloads | — | Sonarr/Radarr queues, wanted counts, monitored totals, upcoming items, imports and reported failures | Direct download-client adapters |
| Prowlarr | — | Reported health/failing indexers; known application issues | Optional statistics and deeper connectivity evidence |
| Docker | — | Container state, uptime, CPU/RAM, restart count, healthcheck, detail view | Logs, Compose grouping, actions |
| Storage | Capacity and available bytes by selected filesystem; short trends | Polished capacity view, longer growth history | Forecasts, folder scans, library byte attribution |
| Disk health | Explicitly not configured | Physical disk identity, temperature, SMART evidence and protocol-specific counters where supported | Controller-specific support beyond tested hardware |
| Tailscale | — | Local state and known peers with reported online/last-seen data | Tailnet inventory via administrative API |
| Events/history | Basic transitions, stream observations, short host trends | Imports, Docker observations, disk warnings, bounded retention | Webhooks, external alert delivery, anomaly detection |

The first release is a narrow checkpoint, not a claim to meet every v1 feature. SMART is a required v1 milestone because disk confidence matters to this product. Unsupported hardware must remain explicit rather than blocking all other monitoring.

## Overview behavior

1. A compact status strip presents overall observed state, server uptime, CPU, RAM, available storage, and selected-interface throughput.
2. A large but restrained storage panel and compact Currently Watching list anchor the page.
3. Service cards show status, one or two relevant metrics, warnings, and last successful refresh. Unconfigured integrations live in Settings rather than filling the page with empty cards.
4. A recent activity list distinguishes upstream events from polling observations. Critical current problems remain visible above informational activity.

“All observed systems healthy” is permitted only when all enabled, required observations are current and healthy. Missing required data produces “Monitoring incomplete”; outages and critical findings take priority. Optional devices going offline do not turn the entire homelab red. This is a monitoring summary, not a guarantee of server or disk safety.

## Feature semantics

- Jellyfin: a session is not necessarily a playing stream. Count sessions with current media; show paused separately. Bitrate is optional and identifies source/transcode estimate rather than claiming measured network throughput. Counts and playback refresh at different rates.
- Sonarr/Radarr: downloads are only those known to the corresponding service. Queue errors and history failures are distinct. Wanted means the adapter's documented monitored/missing definition, not every absent title.
- Prowlarr: report its health evidence. An application being configured is not proof it is reachable. Never invoke an application/indexer test automatically.
- Docker: a stopped container is not automatically an outage. Only containers configured as expected-running contribute stopped-state warnings; unhealthy healthchecks still surface. A container without a healthcheck is “No healthcheck,” not healthy by assertion.
- Storage: filesystem usable capacity and physical disk capacity are separate. Do not sum RAID members, pool members, bind mounts, or overlapping filesystems into a fictitious total. The owner selects the main storage volume(s).
- SMART: present overall result and supporting counters, with unsupported and sleeping states. No predicted disk death date. A passing overall result does not erase concerning counters.
- Tailscale: show the server's locally known peers, not a guaranteed complete tailnet inventory. Reported online does not prove the device's services are reachable.
- Events: say “stream observed” or “restart observed” where occurrence is inferred. Polling cannot capture every brief event. Gaps remain visible.

## MVP exclusions

No restart/start/stop, shell, logs viewer, SMART self-tests, media management, search/grab, automatic remediation, browser credential editor, user administration, multi-user roles, public hosting, Kubernetes, Redis, Kafka, Grafana/Prometheus dependency, remote agent fleet, plugin marketplace, external notifications, recursive folder scans, or storage forecasts. A future action feature requires a separate design for authorization and auditing, not merely a confirmation modal.

## Quality targets

- On the reference Ubuntu host, overview cached API p95 <200ms with 50 containers and 200 peers; dashboard usable within 2 seconds on a warm Tailscale connection. These are acceptance targets to measure, not current claims.
- App plus collector idle CPU target <2% of one core, app RSS <250MiB, collector RSS <64MiB; separately record SMART subprocess peaks. Bound telemetry disk use and explain when limits trim history.
- Dark mode, keyboard navigation, readable contrast, reduced motion, text alternatives to charts, and no color-only status meanings.
- One unreachable integration never prevents other cards or cached history from rendering.
- The app survives restart without losing confirmed events/history; an observation gap never becomes invented uptime.
- A single person can install, upgrade, restore, and understand the architecture using repository documentation.

See [experience details](docs/product/experience.md) for page hierarchy and state design.
