# Mounted share and file service setup

This optional integration monitors up to four explicitly configured NFS/SMB mounts. File operations are enabled for **one** selected share at a time. The app gets only the local file-service socket in its existing read-only collector-public mount; the mounted share is never mounted into the app container. The host service runs as an unprivileged `labdeck-files` user and can touch only paths under the selected share through directory handles. It rejects symlinks, special entries, path traversal, nested mounts with a different Linux mount ID, and name collisions. Deleting a directory requires it to be empty. Uploads are sequential 4 MiB chunks, resumable after browser refresh by selecting the same file, and capped at 100 GiB. An incomplete upload occupies space in `.labdeck-uploads` until manually removed; never remove an active session.

## 1. Review the host mount

On Ubuntu, choose the exact mounted share path and an ID such as `archive`. Confirm `findmnt -T /srv/archive -o TARGET,FSTYPE,SOURCE,OPTIONS` identifies an NFS/NFS4/CIFS/SMB3 mount at that path. Confirm the host mount is writable as the intended service user; do not grant host root access or mount a whole parent such as `/srv`. Add `{"id":"archive","path":"/srv/archive"}` to `fileShares` in root-owned `/etc/labdeck/collector.json`. The ordinary collector probes each selected mount in an isolated subprocess with a five-second deadline every 30 seconds. It records current `ok`, `offline`, `unsupported`, `timeout`, or `read-failed` and retains the original timestamp of last measured capacity.

Restart the ordinary collector and verify `fileShares` in the sanitized host snapshot and the Files page. This status-only setup needs no file-service user or socket.

## 2. Install the optional file service

Create the dedicated identities and control directory. The control directory is inside the existing sanitized public parent; group traversal permits the app to reach only its known socket path. Give `labdeck-files` the minimum host ACL on `/srv/archive` needed for the intended reads and writes. The service creates `.labdeck-uploads` at the mount root with mode `0700`; confirm the share honors ownership and mode, especially with CIFS ownership mapping.

```sh
sudo groupadd --system labdeck-file-control
sudo useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin labdeck-files
sudo install -d -o labdeck-files -g labdeck-file-control -m 0710 /var/lib/labdeck-collector/public/file-control
sudo install -d -o root -g root -m 0755 /usr/local/lib/labdeck
sudo install -o root -g root -m 0755 deploy/files/labdeck_files.py /usr/local/lib/labdeck/labdeck_files.py
sudo install -o root -g root -m 0644 deploy/systemd/labdeck-files@.service /etc/systemd/system/labdeck-files@.service
```

Review the unit and create a root-owned drop-in for the selected mount. Replace `archive` and `/srv/archive` with the reviewed ID/path:

```ini
# /etc/systemd/system/labdeck-files@archive.service.d/share.conf
[Service]
ReadWritePaths=/srv/archive
```

Run `systemctl daemon-reload`, `systemctl enable --now labdeck-files@archive.service`, then inspect `systemctl status` and `stat -c '%U:%G %a' /var/lib/labdeck-collector/public/file-control/files.sock`. The socket must be `labdeck-files:labdeck-file-control 660`; the directory must be `labdeck-files:labdeck-file-control 710`. The service requires root-owned collector configuration and refuses an offline or replaced mount. It never executes shell commands.

Set `LABDECK_FILE_CONTROL_SHARE_ID=archive` and `LABDECK_FILE_CONTROL_GID` to `getent group labdeck-file-control | cut -d: -f3`. Add `-f deploy/compose/compose.files.yml` to the existing Compose command along with `compose.host.yml`; inspect `docker compose config` before recreating the app. Confirm the app container has no share bind mount, Docker socket, device, host root, or privileged mode. Check the Files page as owner. First exercise list and a new empty test folder in a reviewed noncritical location; then test an upload, resume, collision, rename and deletion of only that test item. The browser displays progress and only one upload at a time.

The HTTPS reverse proxy must allow a 6 MiB JSON request body for 4 MiB upload chunks. Check that the selected NFS/SMB server supports the helper's no-replace rename and hard-link completion behavior before trusting uploads; an unsupported operation is reported as a file error and retains the unfinished session for inspection.

## Failure and recovery

If a share is offline, stale, unmounted or replaced, the app pauses controls and the host service refuses operations. A slow network filesystem can still block the service inside a kernel call; restart it only after investigating the mount. Use the host's mount options appropriate to that storage system. The app times out individual requests after 45 seconds. A timed-out chunk might have completed on the host; reselect the same local file to resume from the recorded offset. If the local file changes or its name/size/time differs, it starts a separate session and a collision is rejected at completion.

To revoke access, remove `compose.files.yml` and recreate the app, then stop `labdeck-files@archive.service`. The share status remains available from the collector. Back up the real share separately; LabDeck's SQLite backup does **not** back up share contents or unfinished uploads. Before cleaning `.labdeck-uploads`, stop the file service, inventory incomplete sessions in the control directory, and confirm no upload should be resumed. Real Ubuntu NFS/SMB permissions, 100 GiB transfer behavior, and systemd sandbox compatibility require host validation; local fixtures do not establish those claims.
