# Compose deployment

Generate the owner password hash without putting the password in command arguments:

```sh
npm run password:hash
```

Save only the printed Argon2id hash to a host file. Set its owner/group so container UID/GID `10001:10001` can read it, and mode `0440`; it must not be world-readable. Set `LABDECK_OWNER_PASSWORD_HASH_FILE` to its absolute host path. Set `LABDECK_CANONICAL_ORIGIN` to the exact HTTPS browser origin, such as `https://labdeck.example-tailnet.ts.net`, and `LABDECK_ALLOWED_HOSTS` to its host (including a non-default port).

Validate and start:

```sh
docker compose -f deploy/compose/compose.example.yml config --quiet
docker compose -f deploy/compose/compose.example.yml up -d --build
```

The published port listens on host loopback only. For Tailscale, keep Funnel disabled and proxy with Tailscale Serve:

```sh
sudo tailscale serve --bg http://127.0.0.1:7337
```

Review `tailscale serve status` and use the resulting HTTPS URL as the canonical origin. LabDeck still requires its owner password. A LAN deployment needs an authenticated TLS reverse proxy to the same loopback address. Do not expose port 7337 publicly.

The container runs as non-root with no Linux capabilities, a read-only root filesystem, a small temporary `/tmp`, and one writable SQLite volume. It has no Docker socket, devices, host namespaces, or host filesystem mounts. M1 does not install the host collector.
