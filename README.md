# LabDeck

A local-first, read-only mission control for an Ubuntu homelab. The intended experience is a calm, polished overview of host health, storage, media activity, containers, and remote access.

**Status: M1 secure application shell implemented.** LabDeck currently provides owner authentication, an honest empty dashboard, read-only settings diagnostics, and hardened Compose packaging. Host and service monitoring begin in M2 and later milestones.

Start with [PRODUCT.md](PRODUCT.md), then [ARCHITECTURE.md](ARCHITECTURE.md) and [PLAN.md](PLAN.md). Coding agents should read [AGENTS.md](AGENTS.md).

## Documentation map

- [Product and scope](PRODUCT.md) and [experience specification](docs/product/experience.md)
- [Architecture](ARCHITECTURE.md) and [security and operations](docs/decisions/002-security-and-operations.md)
- [Technology decisions](docs/decisions/001-stack-and-boundaries.md)
- [Provider contract](docs/integrations/contract.md), [service integration notes](docs/integrations/services.md), and [host collector](docs/integrations/host-collector.md)
- [Execution milestones](PLAN.md), [validation protocol](docs/plans/validation.md), and [risk register](docs/plans/risks.md)

The deployment is one application container with local SQLite storage. An optional host-installed collector will publish sanitized snapshots for system, Docker, SMART, and Tailscale monitoring. Full host monitoring requires that collector; M1 does not install it.

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

Run `npm run check`, `npm run test:unit`, and `npm run test:integration -- --project=foundation` for the normal M1 checks. See [Compose deployment](deploy/compose/README.md) for a private HTTPS deployment.

The module tree in ARCHITECTURE.md remains incremental: add paths only when their milestone needs them.
