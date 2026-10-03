# SQLite backup and restore

LabDeck keeps history, events, capability state and hashed login sessions in a local SQLite database with WAL. Never copy a live database file alone; it may omit WAL transactions. Use the packaged `node /app/apps/server/dist/db/maintenance-cli.js` command, which uses SQLite's online backup API and verifies integrity and foreign keys. The command never overwrites an existing target. Treat backups as sensitive history and keep copies outside the app volume with restricted permissions; back up the owner password-hash file and host/integration configuration separately.

## Online backup

While the app runs, create a new backup file on the writable data volume, for example by executing inside the container:

```sh
node /app/apps/server/dist/db/maintenance-cli.js backup --source=/var/lib/labdeck/labdeck.db --target=/var/lib/labdeck/labdeck-YYYYMMDD.db
```

Use an unused target name, then copy that completed file to a secure off-volume location and confirm its size/checksum there. The backup is a consistent standalone database; it is not a raw copy of the live `.db` file. The command performs full `integrity_check` and `foreign_key_check` on both source and copy. It reports no rows, identities or secrets to stdout.

## Restore drill and replacement

First stop the LabDeck app. Keep the current database plus any `-wal`/`-shm` companions together as a recoverable pre-restore set; never replace only one file while a process holds the database open. In an isolated container or maintenance environment with the same app version and a writable data volume, create a *new* destination:

```sh
node /app/apps/server/dist/db/maintenance-cli.js restore --source=/var/lib/labdeck/labdeck-YYYYMMDD.db --target=/var/lib/labdeck/labdeck-restored.db
```

The source must be a regular non-symlink file. Restore verifies integrity/schema, copies into a new standalone database, clears all prior login sessions, re-verifies integrity and atomically creates the destination. It does not replace the active `labdeck.db` automatically. With the app still stopped, the operator can move the verified restored file into the configured database path after safely preserving the old database set. Restart the matching app image and confirm readiness, history, events, owner login and integration freshness. Restored observations keep their original timestamps; a restore cannot make old data fresh. An older schema is upgraded only when the matching application starts; there are no automatic down-migrations. Retain the pre-upgrade image/database until the restore drill succeeds.

The application periodically requests a passive WAL checkpoint and exposes database+WAL size, free filesystem space, series/event counts and pressure state in Settings. At 1 GiB it trims oldest hourly telemetry in bounded batches; at 2 GiB or under 512 MiB free it stops new telemetry event/metric writes. Current capability ingestion may still fail if the filesystem is truly full; restore space before assuming history durability. This is a guardrail, not a substitute for disk monitoring or a measured 24-hour soak.

## Backup status and migration 005

New databases record backup creation and verification timestamps after the verified file is published. The CLI therefore needs write access to the source DB for this small status update. It never stores the backup destination path. If status recording fails after publication, the command reports that distinction; the newly created backup remains valid and is not removed. Backups of schemas 1–4 remain supported without recording status. Settings cannot establish whether a backup has subsequently been moved, deleted, or corrupted.

Migration 005 adds this singleton record and bounded daily forecast history. Keep a pre-upgrade backup with its matching app version; there is no downgrade migration. Restore clears backup status in the destination along with sessions, so an old backup cannot masquerade as a newly protected installation. New forecast collection is needed after upgrade; pre-existing metric buckets are not backfilled.

## Migration 006 and share data

Migration 006 adds a bounded action audit table for optional Docker and file operations. Back up the database with the matching application version before upgrading; there is no downgrade migration. The audit records action type, target ID, time and result, never file paths or contents. SQLite backup does not include mounted share files, unfinished upload data or the file-service control directory. Back up the share with its own storage procedure. After restore, verify the optional control services and socket permissions before resuming actions.
