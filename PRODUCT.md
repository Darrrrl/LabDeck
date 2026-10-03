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

The original monitoring MVP excludes infrastructure actions, shell, logs viewer, media management, search/grab, automatic remediation, browser credential editor, user administration, multi-user roles, public hosting, Kubernetes, Redis, Kafka, Grafana/Prometheus dependency, remote agent fleet, plugin marketplace, external notifications, and recursive folder scans. The owner's later SMART, Docker, and one-share file requests are the documented opt-in exceptions below, with separate authorization and host boundaries.

## Quality targets

- On the reference Ubuntu host, overview cached API p95 <200ms with 50 containers and 200 peers; dashboard usable within 2 seconds on a warm Tailscale connection. These are acceptance targets to measure, not current claims.
- App plus collector idle CPU target <2% of one core, app RSS <250MiB, collector RSS <64MiB; separately record SMART subprocess peaks. Bound telemetry disk use and explain when limits trim history.
- Dark mode, keyboard navigation, readable contrast, reduced motion, text alternatives to charts, and no color-only status meanings.
- One unreachable integration never prevents other cards or cached history from rendering.
- The app survives restart without losing confirmed events/history; an observation gap never becomes invented uptime.
- A single person can install, upgrade, restore, and understand the architecture using repository documentation.

See [experience details](docs/product/experience.md) for page hierarchy and state design.

## Requested monitoring add-ons (2026-09-25)

A dedicated `/wallboard` presents six bounded summary widgets for a server display, with fullscreen and detail links. The no-scroll target is a desktop viewport of at least 1280×720 at normal zoom; smaller screens reflow with scrolling for readability. Docker adds local name/image search and state/attention filters, separate state and healthcheck labels, and explicit running expectations.

Storage adds ATA self-test evidence and a host smartd schedule preview. The exclusion of app-initiated self-tests remains: test initiation and schedule activation occur on the host. See [decision 004](docs/decisions/004-host-owned-smart-tests.md) and [setup](docs/operations/smart-tests.md).

## Requested investigation additions (2026-09-27)

The owner explicitly expanded the add-on scope to include Compose project/service grouping, conservative storage growth forecasts, current-problem investigation, browser dashboard preferences, and backup verification status. These additions supersede the earlier “Later” classification for Compose grouping, forecasts, and custom widget ordering only. They preserve observation-only infrastructure access. See [decision 005](docs/decisions/005-monitoring-investigation-addons.md) and [validation evidence](docs/plans/investigation-validation-report.md). External notifications remain [a post-v1 design](docs/plans/external-notifications.md), disabled and unimplemented.

## Requested SMART test start (2026-10-01)

The owner explicitly requested starting short and extended disk self-tests from Storage. This opt-in action is limited to configured ATA disks with fresh readable SMART evidence. It uses an authenticated CSRF-protected route and a fixed host Unix socket service; no device path reaches the browser or application container. See [decision 006](docs/decisions/006-web-started-smart-tests.md). The request acknowledgement means the host accepted the start command, not that the test completed or passed.

## Requested Docker controls and file integration (2026-10-03)

The owner expanded the scope to allowlisted container and Compose project start/stop/restart, mounted-share health, and one-share browsing, resumable upload, folder creation, rename and nonrecursive delete. Docker controls use a separate host service and never give the app the Docker socket. Compose `up` and `down` remain excluded. File actions use a separate unprivileged host service and never mount the share in the app. Recursive deletion and overwriting existing names are excluded. See [Docker decision 007](docs/decisions/007-allowlisted-docker-control.md) and [file decision 008](docs/decisions/008-mounted-share-file-service.md).
