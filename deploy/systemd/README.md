# Host collector installation

M2 adds an ordinary, unprivileged Linux collector. It reads selected `/proc` counters, `/proc/self/mountinfo`, statfs for explicitly configured mountpoints, and the host boot ID. It has no network listener, socket access, raw device access, Docker group, sudo path, or command channel from the web application.

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

Validate values over the same interval with `free -b`, `df -B1`, `/proc/uptime`, `/proc/net/dev`, and `/proc/diskstats`. Memory definitions differ between tools: LabDeck uses `MemTotal - MemAvailable`. Filesystem used space is `total - free`, available is the unprivileged allocation amount, and reserved is `free - available`. Network and block-I/O rates are unknown for the first sample and after counter resets.

After reviewing the installed configuration, run the read-only live check on Ubuntu:

```sh
LABDECK_LIVE_TEST=true \
LABDECK_HOST_SNAPSHOT_PATH=/var/lib/labdeck-collector/public/system/snapshot.json \
npm run test:live -- --provider=host
```

For an interval rate comparison, record the selected lines from `/proc/net/dev` and `/proc/diskstats` immediately after one collector publication and again after the next. Divide counter deltas by the difference between snapshot `generatedAt` values. Diskstats sectors are exactly 512 bytes for this interface, regardless of physical sector size. Compare receive/transmit byte rates and read/write sector rates separately; do not sum a partition with its parent. Small differences are expected because the manual reads cannot occur at the collector's exact sampling instant. A reset, reboot, negative delta, or zero interval must produce `null`, not a spike.
