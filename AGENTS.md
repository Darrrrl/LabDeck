# Working on LabDeck

## Read first

- `PRODUCT.md`: product scope and release boundaries.
- `ARCHITECTURE.md`: topology, ownership, persistence, and proposed module tree.
- `PLAN.md`: ordered, independently reviewable implementation slices.
- `docs/integrations/contract.md`: normalized data and failure semantics.
- Read the integration and decision documents linked by your milestone.

## Durable rules

- Implement only the requested milestone or task; keep unrelated user changes intact.
- Deliver a working vertical slice. Do not scaffold unused adapters or speculative frameworks.
- V1 observes infrastructure. Do not add control endpoints, generic proxies, arbitrary commands, or a plugin loader.
- Credentials stay server-side. Never persist raw upstream responses or log secrets, headers, query strings, or configuration dumps.
- The application never receives Docker/Tailscale sockets, raw devices, host root mounts, or privileged mode.
- Unknown, stale, unsupported, offline, and zero are different states. Retain last good data with its original timestamp.
- Browser requests read cached state; they never trigger upstream polling.
- Validate boundaries with runtime schemas. Bound concurrency, payloads, histories, and query ranges.
- Use SQLite on local disk. Version migrations; document backup and restore consequences.
- Test failure states and data semantics, not just the happy path. Use sanitized fixtures; live tests are opt-in.
- Keep accessible status text, visible freshness, keyboard access, and responsive layouts.
- Update affected contracts and docs with behavior changes. Record significant architectural departures in `docs/decisions/`.
- Do not claim a command or live integration passed unless you ran it. Report untested hardware/API assumptions.

## Handoff

State what changed, acceptance criteria met, validation actually run, and remaining limitations. Update the milestone status and compatibility evidence. Validation commands in the plan are future contracts until their tooling exists.
