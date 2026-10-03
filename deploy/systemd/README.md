# Host collector installation

The base ordinary Linux collector reads selected `/proc` counters, `/proc/self/mountinfo`, statfs for explicitly configured mountpoints, and the host boot ID. It has no network listener, Docker group, sudo path, or command channel from the web application. M6 adds an opt-in Docker module; enabling that module grants the collector access to the Docker socket, which is effectively host-administrator power.

Build on the Ubuntu host with Go 1.24 or later:

```sh
go -C collector build -trimpath -o /tmp/labdeck-collector ./cmd/labdeck-collector
sudo install -o root -g root -m 0755 /tmp/labdeck-collector /usr/local/bin/labdeck-collector
```

Create system users and directories deliberately:

```sh
sudo groupadd --system labdeck-readers
sudo useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin labdeck-collector
sudo install -d -o root -g root -m 0755 /etc/labdeck
sudo install -d -o root -g labdeck-readers -m 0750 /var/lib/labdeck-collector/public
sudo install -d -o labdeck-collector -g labdeck-readers -m 0750 /var/lib/labdeck-collector/public/system
```

Copy `collector.example.json` to `/etc/labdeck/collector.json`, replace every mount/interface/device name with reviewed values from the host, then set owner `root:root` and mode `0644` or stricter. The collector rejects configuration writable by group/others, duplicate mount paths, unsafe identifiers, and implicit filesystem/interface selection. Block device names refer to `/proc/diskstats`; they do not grant device access.

Install the unit, review `systemd-analyze security`, then enable it:

```sh
sudo install -o root -g root -m 0644 deploy/systemd/labdeck-collector.service /etc/systemd/system/labdeck-collector.service
sudo systemctl daemon-reload
sudo systemctl enable --now labdeck-collector.service
```

The collector atomically replaces `/var/lib/labdeck-collector/public/system/snapshot.json` with mode `0640`. Add the numeric `labdeck-readers` group to the application container only when M2 application ingest is configured, and mount the `public` directory read-only. Do not mount host `/proc`, `/sys`, filesystems, or this service's writable directory into the application.

Use the opt-in Compose override after finding the numeric reader group with `getent group labdeck-readers`:

```sh
LABDECK_READERS_GID=1234 \
LABDECK_HOST_PUBLIC_DIRECTORY=/var/lib/labdeck-collector/public \
docker compose -f deploy/compose/compose.example.yml -f deploy/compose/compose.host.yml up -d
```

The override supplies only the supplemental reader GID and a read-only parent-directory mount, which preserves atomic rename visibility. It does not add a Docker group, device, host namespace, privileged mode, or write path.

## Optional Docker observation

Review the compromise impact first: Docker group membership gives the collector effective host-administrator power even though its code uses fixed GET requests. This is not a read-only socket permission. The web app container must **never** get the Docker group or socket.

On the Ubuntu host, set `"docker": true` in the root-owned collector configuration. Install `labdeck-collector.docker.conf` as a systemd drop-in under `/etc/systemd/system/labdeck-collector.service.d/`, then run `systemctl daemon-reload` and restart the collector. Review the resulting `systemctl show labdeck-collector -p SupplementaryGroups` and the collector user's access to `/var/run/docker.sock`. Do not grant access automatically through the application. The collector allows only Engine version, all-container list, inspect-by-validated-ID and `stream=false` stats reads; no write endpoints, logs, exec, events stream, or arbitrary paths. Two requests run concurrently, each with a five-second deadline and 2 MiB body cap; the Docker cycle has a ten-second deadline.

Optionally set `LABDECK_EXPECTED_RUNNING_CONTAINERS` to a comma-separated list of exact container names in the host Compose override. Only these stopped containers affect overall health; optional stopped containers remain informational. A recreated same-name container is a new ID. No per-container metric history is persisted in M6; current stats and restart/recreation observations are retained. If a stats read times out, the last sample keeps its original timestamp. Inspect configuration, environment, commands, mounts, labels and health logs are not exported.

Use `LABDECK_LIVE_TEST=true LABDECK_HOST_SNAPSHOT_PATH=/var/lib/labdeck-collector/public/system/snapshot.json npm run test:live -- --provider=docker` only after reviewing the actual socket permissions and snapshot privacy. The live checker reads the sanitized snapshot, not the Docker socket.

### Optional Docker controls

The owner's requested controls are a separate opt-in service. In root-owned `/etc/labdeck/collector.json`, set `dockerControlDirectory` to `/var/lib/labdeck-collector/public/docker-control`, add reviewed exact names to `dockerControlContainers`, and optionally add `{"id":"project-name","composeFile":"/etc/labdeck/compose/project-name.yaml"}` to `dockerControlProjects`. Keep configured Compose files root-owned regular files, not group/other-writable, and review their includes, environment and relative paths. The service allows only `start`, `stop` and `restart`; it cannot run Compose `up` or `down`.

Create `labdeck-docker-control` and the control directory owned by `labdeck-collector:labdeck-docker-control` mode `0750`. Install `labdeck-docker-control.service`, review its effective systemd restrictions and Docker group access, then enable it. Verify `control.sock` is group `labdeck-docker-control` and mode `0660`. Set its numeric GID as `LABDECK_DOCKER_CONTROL_GID`; mirror the reviewed container names and project IDs in `LABDECK_DOCKER_CONTROL_CONTAINERS` and `LABDECK_DOCKER_CONTROL_PROJECTS`, and add `deploy/compose/compose.docker-control.yml` to the active Compose file list. Recreate only the app after checking `docker compose config`. The host allowlist is authoritative; keep the mirrored app list aligned so buttons reflect the allowed targets. Do not mount Docker's socket into the app. First test one noncritical target and confirm the audit record and next observed state. Remove the Compose override and stop the control service to revoke actions without interrupting Docker observation.

## Optional mounted shares and file operations

Add up to four exact SMB/NFS mount paths in the root-owned `fileShares` array. The ordinary collector probes them without new privileges. For browsing and file changes on one selected share, install the separate unprivileged service and Compose override using the [file setup guide](../../docs/operations/files-setup.md). The app never receives the share mount.

## Optional SMART observation

Review [SMART hardware compatibility and validation](../../docs/integrations/smart-hardware.md) before enabling this timer. Install `smartmontools` from the host distribution. Add at most 16 explicitly reviewed entries to root-owned `/etc/labdeck/collector.json`, for example `{"id":"array-a","label":"Array disk A","path":"/dev/disk/by-id/ata-EXAMPLE","deviceType":"sat"}` under `smartDisks`. The path must be a stable `/dev/disk/by-id/` symlink resolving to a block device. `deviceType` is limited to `auto`, `ata`, `sat`, `scsi`, or `nvme`; a USB bridge or HBA may need a supported type determined by the operator. Never accept device paths from the browser.

Create `/var/lib/labdeck-collector/public/smart` as `root:labdeck-readers` mode `0750`, within the already shared public parent, and install `labdeck-smart.service` and `labdeck-smart.timer` under `/etc/systemd/system/`. Review the unit before `systemctl daemon-reload` and `systemctl enable --now labdeck-smart.timer`. The root one-shot uses only fixed `smartctl -a -j -n standby,3 -d <reviewed type> <reviewed by-id path>` reads. It never enables SMART, starts self-tests, changes settings, or accepts a web request. Each disk has a 20-second limit and the service has a 130-second ceiling. The helper atomically writes a sanitized JSON snapshot in the separate SMART directory; it contains no raw smartctl output or full serial number. The ordinary collector remains unprivileged and does not inherit raw-device access.

The app needs read access only to the sanitized public directory through the existing read-only Compose host mount. Add the SMART Compose override to set `LABDECK_SMART_SNAPSHOT_PATH`; the app does not need root, raw devices, or a helper control path. Back up the collector configuration as an operator secret because it exposes host device identity. Backing up the snapshot is unnecessary; it is regenerated by the timer. SQLite backup/restore remains as described in the deployment guide; retained SMART observations/events retain their original timestamps and are not made fresh by restore.

On the actual Ubuntu host, inspect ownership and unit restrictions with `systemctl cat labdeck-smart.service` and `namei -l /var/lib/labdeck-collector/public/smart/snapshot.json`. Compare one fresh sanitized snapshot with the reviewed command on each allowlisted device. Run `LABDECK_LIVE_TEST=true LABDECK_SMART_SNAPSHOT_PATH=/var/lib/labdeck-collector/public/smart/snapshot.json npm run test:live -- --provider=smart`; the live checker reads only the snapshot. Exercise a sleeping disk and unsupported bridge if available. Do not call fixture tests hardware evidence.

### Optional web-started self-tests

After validating the SMART read path, create a dedicated `labdeck-smart-control` group. Keep `/var/lib/labdeck-collector/public/smart` root-owned and non-writable by group or others. Install `labdeck-smart-control.service`, review its hardening settings, and enable it with `systemctl enable --now labdeck-smart-control.service`. The service creates `control.sock` as `root:labdeck-smart-control` mode `0660` inside the existing SMART directory. Check it with `stat` and `systemctl status` before exposing the buttons.

Set `LABDECK_SMART_CONTROL_GID` to that group's numeric GID and add `deploy/compose/compose.smart-control.yml` to the existing Compose files, then recreate only the app container. This gives it socket access through the existing read-only host directory mount; do not add `/dev`, a host root mount, or privileged mode. Only this dedicated group should reach the socket. The app route enforces login, exact origin and CSRF; the host resolves IDs from root-owned configuration and accepts only short/extended tests. A start response does not prove completion. Verify one reviewed ATA disk on the Ubuntu host, then confirm progress/result in Storage after a snapshot. The service logs only disk ID, type and accepted/rejected outcome; it discards smartctl output. Disable the service and remove the Compose override to revoke web starts without affecting observation or smartd schedules.

## Optional Tailscale status

Review the [local-status compatibility guide](../../docs/integrations/tailscale.md), including the unprivileged user's access to `/usr/bin/tailscale status --json`, before setting `"tailscale": true` in the root-owned collector configuration. Restart only the ordinary collector. The app needs no new mount, socket, group, token or privilege; the existing sanitized host snapshot carries the optional peer capability. If the CLI is inaccessible, leave the module disabled or report permission-denied after a reviewed minimal access change. Do not grant Tailscale operator controls merely for observation. The opt-in live checker reads the sanitized snapshot, not the CLI or daemon.

Validate values over the same interval with `free -b`, `df -B1`, `/proc/uptime`, `/proc/net/dev`, and `/proc/diskstats`. Memory definitions differ between tools: LabDeck uses `MemTotal - MemAvailable`. Filesystem used space is `total - free`, available is the unprivileged allocation amount, and reserved is `free - available`. Network and block-I/O rates are unknown for the first sample and after counter resets.

After reviewing the installed configuration, run the read-only live check on Ubuntu:

```sh
LABDECK_LIVE_TEST=true \
LABDECK_HOST_SNAPSHOT_PATH=/var/lib/labdeck-collector/public/system/snapshot.json \
npm run test:live -- --provider=host
```

For an interval rate comparison, record the selected lines from `/proc/net/dev` and `/proc/diskstats` immediately after one collector publication and again after the next. Divide counter deltas by the difference between snapshot `generatedAt` values. Diskstats sectors are exactly 512 bytes for this interface, regardless of physical sector size. Compare receive/transmit byte rates and read/write sector rates separately; do not sum a partition with its parent. Small differences are expected because the manual reads cannot occur at the collector's exact sampling instant. A reset, reboot, negative delta, or zero interval must produce `null`, not a spike.
