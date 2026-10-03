# 004 — Host-owned SMART self-test scheduling

Status: accepted for the requested dashboard add-ons, 2026-09-25.

The owner requested long-running SMART tests, scheduling and a result view. The monitoring architecture prohibits app-to-host control endpoints. Use smartmontools' existing smartd scheduler, configured by the host operator, to initiate tests independently of the web application.

Storage provides a configuration preview with day/hour selection. Activation remains a host installation task, explicitly labeled in the UI. The existing SMART helper projects ATA progress and five recent result entries from its fixed read command into an optional bounded `selfTest` field. Older snapshots remain readable. Unknown results are never inferred as successful tests.

There is no new socket, device mount, shell, queue, privileged web route or browser-to-helper channel. A future in-app Run/Schedule action requires its own authorization and auditing design. NVMe/SCSI test logs and host schedule-state ingestion are deferred until their protocol and installation evidence can be validated.

The owner's later request for a web Start action is handled narrowly by [decision 006](006-web-started-smart-tests.md). Host-owned scheduling and the periodic read helper remain as described here.

See the [operator setup](../operations/smart-tests.md) for activation and compatibility limits.
