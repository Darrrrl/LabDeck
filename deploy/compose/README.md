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

The base container runs as non-root with no Linux capabilities, a read-only root filesystem, a small temporary `/tmp`, and one writable SQLite volume. It has no Docker socket, devices, host namespaces, or host filesystem mounts.

After separately installing and reviewing the [unprivileged host collector](../systemd/README.md), enable host monitoring with the second Compose file:

```sh
LABDECK_READERS_GID="$(getent group labdeck-readers | cut -d: -f3)" \
LABDECK_HOST_PUBLIC_DIRECTORY=/var/lib/labdeck-collector/public \
docker compose -f deploy/compose/compose.example.yml -f deploy/compose/compose.host.yml config --quiet
```

Review the rendered configuration before starting it. The override adds a supplemental read-only group and mounts only the collector's sanitized public directory at `/run/labdeck-host:ro`; it does not expose host `/proc`, `/sys`, raw devices, or a daemon socket.

## Jellyfin monitoring

Create a dedicated Jellyfin API key and store only its value in a host file readable by container UID/GID `10001:10001`, mode `0440`. Configure the internal API base URL separately from the browser URL; both may include a reverse-proxy path prefix. The browser URL is only used for the “Open Jellyfin” link.

```sh
LABDECK_JELLYFIN_BASE_URL=http://jellyfin:8096/jellyfin \
LABDECK_JELLYFIN_BROWSER_URL=https://media.example-tailnet.ts.net/jellyfin \
LABDECK_JELLYFIN_API_KEY_FILE=/secure/path/jellyfin-api-key \
docker compose -f deploy/compose/compose.example.yml -f deploy/compose/compose.jellyfin.yml config --quiet
```

The application performs only bounded `GET` requests to system info, sessions, item counts, and a twelve-item recent-additions query. It does not follow redirects or expose the API key to the browser, database, logs, or URL query strings. Add explicit network membership if the service name is on another Compose network; do not publish Jellyfin merely for LabDeck.

## Sonarr and Radarr monitoring

Store each API key in its own restricted host file and add either or both provider overrides. Internal API and browser launch URLs are intentionally separate and may include reverse-proxy path prefixes.

```sh
LABDECK_SONARR_BASE_URL=http://sonarr:8989/sonarr \
LABDECK_SONARR_BROWSER_URL=https://sonarr.example-tailnet.ts.net/sonarr \
LABDECK_SONARR_API_KEY_FILE=/secure/path/sonarr-api-key \
docker compose -f deploy/compose/compose.example.yml -f deploy/compose/compose.sonarr.yml config --quiet

LABDECK_RADARR_BASE_URL=http://radarr:7878/radarr \
LABDECK_RADARR_BROWSER_URL=https://radarr.example-tailnet.ts.net/radarr \
LABDECK_RADARR_API_KEY_FILE=/secure/path/radarr-api-key \
docker compose -f deploy/compose/compose.example.yml -f deploy/compose/compose.radarr.yml config --quiet
```

These adapters issue only fixed API v3 `GET` requests. They never invoke command, search, grab, delete, refresh, or test endpoints.
