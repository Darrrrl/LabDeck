# Copilot task: configure LabDeck SMART test controls on Ubuntu

Use this guide on the **LabDeck Ubuntu host**, in the LabDeck repository checkout, with terminal and sudo access. The objective is to make Storage's **Start short test** and **Start extended test** buttons available for reviewed ATA drives. Stop before initiating either physical test and ask the owner to approve the exact drive ID and test type. Do not select a disk automatically.

## Rules for this setup

- Read `AGENTS.md`, `docs/integrations/smart-hardware.md`, `docs/operations/smart-tests.md`, and `docs/decisions/006-web-started-smart-tests.md` first.
- Do not send raw `smartctl` output, full serial numbers, device paths, credentials, environment dumps, or Docker configuration to a chat or log. Report only sanitized identity suffixes and safe status codes.
- Do not mount `/dev`, the Docker socket, or the host root into the LabDeck app. The app needs only its existing read-only snapshot mount plus access to the dedicated SMART control socket group.
- Preserve existing collector configuration, Compose overrides, systemd drop-ins, and smartd schedules. Do not replace an active setup with example files without comparing them.

## 1. Inspect and record the current installation

Confirm this is the intended Ubuntu server and repository checkout. Record the Ubuntu and smartmontools versions, the LabDeck commit or working-tree state, current Compose file list, current collector binary version, and whether `labdeck-smart.timer` already publishes a fresh sanitized snapshot. Inspect (without sharing raw contents) `/etc/labdeck/collector.json`, `systemctl cat labdeck-smart.service`, `systemctl cat labdeck-smart.timer`, and the app's active Compose configuration. Check that every configured `smartDisks` entry is a whole-disk `/dev/disk/by-id/` symlink whose device type and identity were reviewed by the owner. Follow the [hardware compatibility gate](../integrations/smart-hardware.md); stop if no ATA disk produces current readable evidence.

Confirm that `/var/lib/labdeck-collector/public/smart` and its parents are root-owned, that the SMART directory is not group/other-writable, and that the app currently reads its snapshots through the read-only `/run/labdeck-host` mount. Back up the collector configuration and any unit or Compose files that will be changed, preserving ownership and permissions. Record the backup locations locally without exposing configuration contents.

## 2. Validate and install the reviewed collector

Run the repository checks available on the host: `go -C collector test ./...`, `go -C collector vet ./...`, `npm run check`, and `npm run test:integration`. Stop on failure. Build `collector/cmd/labdeck-collector` with the installed Go toolchain and compare the resulting binary's version with the deployed binary. Install the new binary at `/usr/local/bin/labdeck-collector` only after checking that the existing systemd units use that path. Keep a rollback copy of the previous binary. The ordinary collector and SMART read timer must continue to work after the replacement.

## 3. Enable only the SMART control socket

Create a dedicated `labdeck-smart-control` group if it does not already exist. Do not add human users or the ordinary collector to it. Install `deploy/systemd/labdeck-smart-control.service` as `/etc/systemd/system/labdeck-smart-control.service`, review its effective settings with `systemctl cat`, then reload systemd and start the service. Its Unix socket should be `/var/lib/labdeck-collector/public/smart/control.sock`, owned by `root:labdeck-smart-control` with mode `0660`. Check the full directory path with `namei -l`; retain the separate `labdeck-readers` group for snapshot reads.

Set `LABDECK_SMART_CONTROL_GID` to the numeric GID of that dedicated group in the deployment environment. Add `deploy/compose/compose.smart-control.yml` alongside the **existing** host and SMART overrides, review `docker compose config` with the exact active file list, then recreate only the LabDeck app container. Confirm the app receives the reader and control supplemental groups and still has no raw-device, Docker-socket, or privileged mount. Confirm the Storage page displays the Start buttons for a current ATA disk. A visible button is a configuration check, not proof that a physical test has run.

## 4. Verify without starting a physical test

Check the new service is active and that its socket ownership, app group membership, SMART snapshot freshness, and web login are correct. Confirm a request without a valid session or CSRF token is rejected, and that invalid disk IDs or unsupported test types cannot reach `smartctl`. Use only fixture or fake-socket tests for this check; do not submit a valid Start request yet. Review service logs for safe disk IDs and outcomes only. If permissions or evidence are stale, repair the specific fault and recheck before proceeding.

**Stop here and ask the owner:** “The SMART control service is configured. May I start a short self-test on disk `<reviewed ID>` (model `<safe model>`, serial suffix `<last four>`)? It may wake the drive.” Do not infer approval from this guide. Do not start an extended test during setup.

## 5. After approval, verify a real short test

Use the Storage button for the approved disk once. Record the host's accepted or rejected outcome without raw output. Wait for the next SMART snapshot and verify that LabDeck shows drive-reported progress or a new result with its original evidence timestamp. A command accepted by `smartctl` is not a passing test. If a short test completes before the ten-minute timer captures its running phase, verify the result from the drive's self-test history. Record the smartmontools version, controller/bridge type, selected device type, snapshot age, result, and any unsupported behavior in the local compatibility report. Leave an extended test for a separately chosen maintenance window.

## Rollback

If the control path fails, remove `deploy/compose/compose.smart-control.yml` from the active Compose command and recreate the app, then stop and disable `labdeck-smart-control.service`. This removes web starts while keeping ordinary SMART observation and any smartd schedule. Restore the prior collector binary or configuration only if its replacement caused a regression, using the local backups made above. Confirm the SMART read timer and Storage evidence still work. Report exactly which steps ran, tests passed, and which host or drive behaviors remain unverified.
