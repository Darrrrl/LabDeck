# LabDeck

A local-first, read-only mission control for an Ubuntu homelab. The intended experience is a calm, polished overview of host health, storage, media activity, containers, and remote access.

**Status: M4 fixture implementation complete; Ubuntu host and live provider evidence pending.** LabDeck provides owner authentication, host health and capacity collection, cached trends/events, Jellyfin playback/library summaries, Sonarr/Radarr queue and catalog summaries, polished Overview/System/Storage/Media/Downloads views, read-only settings diagnostics, and hardened Compose packaging.

Start with [PRODUCT.md](PRODUCT.md), then [ARCHITECTURE.md](ARCHITECTURE.md) and [PLAN.md](PLAN.md). Coding agents should read [AGENTS.md](AGENTS.md).

## Documentation map

- [Product and scope](PRODUCT.md) and [experience specification](docs/product/experience.md)
- [Architecture](ARCHITECTURE.md) and [security and operations](docs/decisions/002-security-and-operations.md)
- [Technology decisions](docs/decisions/001-stack-and-boundaries.md)
- [Provider contract](docs/integrations/contract.md), [service integration notes](docs/integrations/services.md), and [host collector](docs/integrations/host-collector.md)
- [Execution milestones](PLAN.md), [validation protocol](docs/plans/validation.md), and [risk register](docs/plans/risks.md)

The deployment is one application container with local SQLite storage. An optional host-installed collector publishes sanitized snapshots for system monitoring today and later Docker, SMART, and Tailscale slices. It is an unprivileged, file-publishing service with no app command channel; see the [collector installation guide](deploy/systemd/README.md).

The first release checkpoint focuses on host health, filesystem capacity, Jellyfin, and a polished overview. Subsequent milestones complete the wider v1 monitoring experience. No infrastructure control actions are included in v1.

## Local development

Requires Node 24–26 and npm 11 or later.

```sh
npm ci
npm run password:hash
```

Put the resulting hash in a mode `0600` local file, then run the API and Vite development server with an explicit loopback-only demo configuration:

```sh
LABDECK_DEMO_MODE=true \
LABDECK_CANONICAL_ORIGIN=http://127.0.0.1:5173 \
LABDECK_ALLOWED_HOSTS=127.0.0.1:7337 \
LABDECK_OWNER_PASSWORD_HASH_FILE=/absolute/path/to/owner_password_hash \
npm run dev
```

Vite serves the browser at `http://127.0.0.1:5173` and proxies API requests to `127.0.0.1:7337`. Demo mode permits non-Secure development cookies only on loopback and displays a persistent banner. Production requires HTTPS and Secure cookies.

Run `npm run check`, `npm run test:unit`, `npm run test:integration -- --project=foundation`, `npm run test:integration -- --project=host`, `npm run test:integration -- --project=jellyfin`, and `npm run test:integration -- --project=arr` for normal checks. Live host and provider checks are explicit opt-ins; the host check is Ubuntu-only and provider checks require out-of-band key files. See [Compose deployment](deploy/compose/README.md) for a private HTTPS deployment.

The module tree in ARCHITECTURE.md remains incremental: add paths only when their milestone needs them.
