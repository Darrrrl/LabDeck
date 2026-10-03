# SMART tests on the host

Storage now shows ATA self-test progress, drive duration estimates, and up to five recent drive-reported results. A passing overall SMART status is separate from a completed self-test. Older collectors and unsupported protocols show unavailable test evidence. NVMe/SCSI self-test projection is not yet implemented.

Open **Storage → Plan SMART tests** to choose a weekly extended test day and server-local start hour. This generates configuration only; it does not activate a schedule. Short tests run Monday–Saturday; the extended test takes precedence when both match. The app does not know whether the generated schedule is installed.

On Ubuntu, install smartmontools if needed. Review each whole-disk `/dev/disk/by-id/` identity and its appropriate device type against the [hardware guide](../integrations/smart-hardware.md). Back up `/etc/smartd.conf` and merge an explicit entry for each selected disk, replacing the placeholder. Do not duplicate an existing entry or leave a conflicting DEVICESCAN rule.

```conf
/dev/disk/by-id/REPLACE_WITH_REVIEWED_DISK_ID -d auto -a -n standby,q -s (S/../../[1-6]/03|L/../../7/03)
```

This example selects short tests Monday–Saturday and an extended test Sunday in the 03:00–03:59 server-local window. Select different hours/days across disks so extended tests do not overlap during normal use. Sleeping disks can defer a test until active. smartd avoids interrupting an already-running self-test; timing is a polling window, not an exact start-time guarantee. See the upstream [smartd configuration manual](https://github.com/mirror/smartmontools/blob/master/smartd.conf.5.in).

Validate the merged configuration and inspect the printed schedule before enabling it:

```sh
sudo smartd -q showtests -c /etc/smartd.conf
sudo systemctl enable --now smartmontools.service
sudo systemctl reload smartmontools.service
sudo systemctl status smartmontools.service
```

Verify the unit name on your Ubuntu installation. Review local service logs for rejected devices and schedule errors. An installed service is not proof that a disk accepted a test.

For an operator-initiated test, use the reviewed device path and correct device type:

```sh
sudo smartctl -t short -d auto /dev/disk/by-id/REPLACE_WITH_REVIEWED_DISK_ID
# Or an extended test:
sudo smartctl -t long -d auto /dev/disk/by-id/REPLACE_WITH_REVIEWED_DISK_ID
```

These commands initiate device tests; run only the intended one. Keep the LabDeck SMART helper timer enabled to collect results. The default ten-minute observation cadence can miss the running phase of a short test, but its result remains in the drive log. Long-test progress is device-reported and coarse; it is not a live countdown. Aborted, interrupted, failed and missing results remain distinct. Result time is disk power-on hours, not a fabricated calendar date.

### Optional Start buttons in Storage

Install the separate [SMART control service](../../deploy/systemd/README.md) and Compose override to enable **Start short test** and **Start extended test** on current ATA disks. The buttons are disabled while evidence is stale, unreadable, or a test is reported running. Starting can wake a sleeping drive. A **started** response means `smartctl` accepted the command; completion and outcome come from the next SMART snapshots. The existing ten-minute timer can miss short-test progress, but the drive log should retain the result. NVMe/SCSI buttons are withheld until their test-result evidence is supported.

The periodic helper still runs only its fixed read command. The separate opt-in control service accepts fixed test-start requests over a local Unix socket; the app receives no devices. smartd can still own host scheduling independently. No DB migration is required: normalized evidence uses existing snapshot persistence. On failed/asleep reads, the last test evidence retains its original timestamp. Upgrading only the app leaves self-test evidence unavailable until the collector is upgraded.

Compatibility is fixture-only for ATA JSON. Actual smartmontools versions, controller passthrough, scheduled test execution, sleep behavior and completion must be validated on the target Ubuntu host before claiming hardware support. No schedule was installed and no physical test was started in the development workspace.
