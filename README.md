# LabDeck

A local-first, read-only mission control for an Ubuntu homelab. The intended experience is a calm, polished overview of host health, storage, media activity, containers, and remote access.

**Status: architecture and planning only. No application, dependencies, deployment configuration, or runnable commands have been implemented.** This directory was empty when planning began; it is not yet a Git repository.

Start with [PRODUCT.md](PRODUCT.md), then [ARCHITECTURE.md](ARCHITECTURE.md) and [PLAN.md](PLAN.md). Coding agents should read [AGENTS.md](AGENTS.md).

## Documentation map

- [Product and scope](PRODUCT.md) and [experience specification](docs/product/experience.md)
- [Architecture](ARCHITECTURE.md) and [security and operations](docs/decisions/002-security-and-operations.md)
- [Technology decisions](docs/decisions/001-stack-and-boundaries.md)
- [Provider contract](docs/integrations/contract.md), [service integration notes](docs/integrations/services.md), and [host collector](docs/integrations/host-collector.md)
- [Execution milestones](PLAN.md), [validation protocol](docs/plans/validation.md), and [risk register](docs/plans/risks.md)

The planned deployment is one application container with local SQLite storage. An optional host-installed collector publishes sanitized snapshots for system, Docker, SMART, and Tailscale monitoring. Full host monitoring requires that collector; service-only mode does not.

The first release checkpoint focuses on host health, filesystem capacity, Jellyfin, and a polished overview. Subsequent milestones complete the wider v1 monitoring experience. No infrastructure control actions are included in v1.

The module tree in ARCHITECTURE.md is a future structure, not a set of placeholder files to generate now. Implementation should grow through the vertical slices in PLAN.md.
