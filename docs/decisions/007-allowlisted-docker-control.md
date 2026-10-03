# 007 — Allowlisted Docker controls

Status: workspace implementation; Ubuntu live validation pending (2026-10-03).

The owner requested container start, stop and restart, followed by Compose project actions. These are opt-in exceptions to LabDeck's observation-only baseline. The app container still has no Docker socket, Docker group, privileged mode, or Compose-file mount. A separate host service runs as `labdeck-collector`, has the Docker group and a dedicated control socket group, and accepts only fixed `container|project` plus `start|stop|restart` requests. The Docker group's host-administrator impact remains material even though the application protocol is narrow.

Root-owned collector configuration allowlists exact container names and named Compose projects. For a container request the service re-inspects the exact 64-character Docker ID, checks its current name against the allowlist, then invokes the fixed Docker CLI operation by ID. For a project request it uses only a root-owned regular Compose file under `/etc/labdeck/compose/` and a configured project ID. It never exposes `up`, `down`, arbitrary CLI flags, command execution, logs, or Compose-file paths through the browser.

The authenticated API requires exact origin and CSRF, a complete fresh cached inventory, and a matching app-side allowlist before sending a request. A versioned SQLite action-audit table records request and outcome; an action completing on the host is still separate from the next observed container state. Host logs contain safe IDs, action and outcome only. The two allowlists must be kept aligned during installation; the root-owned host list is authoritative. Action retention is capped at 1,000 records. Existing Docker observation remains usable without the control service.
