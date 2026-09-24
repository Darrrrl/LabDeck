# Service integration specifications and verification gates

Sources checked 2026-09-19. Upstream development schemas identify candidate contracts, not proof of compatibility with the user's installed versions. No live homelab was accessed. Each implementation must record installed version, credential behavior, paths, sanitized fixture provenance and unsupported fields before claiming live support. Pin a source commit/version in fixture metadata at implementation time.

All endpoint paths below are relative to the configured base path and are GET-only. Match authentication to the installed version. Raw response DTOs remain private to the adapter. API keys must not reach the browser even when a vendor returns them inside configuration responses.

## Jellyfin

M3 implements header-based MediaBrowser token authentication and fixed `GET` reads of `/System/Info`, `/Sessions`, `/Items/Counts`, and `/Items` with a bounded recently-added query. [Jellyfin's session controller](https://github.com/jellyfin/jellyfin/blob/master/Jellyfin.Api/Controllers/SessionController.cs) exposes authenticated session reads, and the [generated TypeScript SDK library client](https://github.com/jellyfin/jellyfin-sdk-typescript/blob/master/src/generated-client/api/library-api.ts) confirms the item-count path and Authorization header contract. These upstream sources and synthetic 10.10.7-shaped fixtures are not substitutes for installed-server validation; real recent-item permissions, filters and path-prefix behavior remain an open live gate.

Normalize playback to session ID, user display name (optional privacy masking), title/subtitle, media ID, paused flag, position/duration seconds, playback mode (`direct-play | direct-stream | transcode | unknown`) and optional bitrate with source. Do not infer transcode simply because a field is absent. Convert ticks only with verified units; clamp progress safely and leave unknown duration null. A paused session remains visible but is not counted as actively playing.

Library summary contains movies/series/episodes counts, recent items and optional provider-reported library bytes. **Library size initially means item counts; total byte size is unavailable unless verified.** Do not scan media folders or multiply counts by guessed sizes. Library stats refresh every 5m, playback every 10s. Library failures do not hide current playback.

Polling stream events are observations: first baseline has no fabricated starts; a newly observed session/media pair after baseline yields “Playback observed”; change or disappearance is approximate. Store minimal event detail with the global retention policy. Defer artwork until there is a constrained, authenticated asset-cache design; no arbitrary URL proxy.

Verify: key permissions; multiple users/devices; paused/transcode/direct stream samples; nullable runtime/bitrate; API path prefix; recently added pagination; counts visibility. Test missing optional fields, non-media sessions and sessions that change titles under the same ID.

## Sonarr and Radarr

M4 implements the API v3 read paths below with fixed-route `X-Api-Key` authentication, bounded local pagination and immediate normalized projection. Sonarr and Radarr share transport, queue, health and history mechanics while retaining service-specific catalog and release-date mapping. Synthetic fixtures validate behavior only; installed-version semantics remain a live gate.

Share HTTP transport, `X-Api-Key` auth handling, queue pagination, health warning mapping and history cursor machinery. Keep series/movie catalog mapping and release semantics separate. Both use API v3 routes in the current published specifications: [Sonarr OpenAPI](https://raw.githubusercontent.com/Sonarr/Sonarr/develop/src/Sonarr.Api.V3/openapi.json), [Radarr OpenAPI](https://raw.githubusercontent.com/Radarr/Radarr/develop/src/Radarr.Api.V3/openapi.json). The API version number is not the application major version.

Candidate route set: `/api/v3/system/status`, `/health`, `/queue`, `/history`, `/calendar`, `/wanted/missing` beneath `/api/v3`; catalog is `/series` for Sonarr and `/movie` for Radarr. Verify wanted filtering and totals on each installed version. Limit upcoming items to 14 days, visible results to 50; retain authoritative total and indicate truncation.

Queue payload: service source, stable item/download ID, title, size, remaining bytes, normalized progress, optional ETA, stage and safe warnings. Derive progress only when total >0. Do not promise download speed if not supplied. A torrent shared between services may appear twice; aggregate as “queue entries,” not unique downloads, unless IDs/provider identity reliably match.

Catalog summary: monitored series/movies, monitored missing episodes/movies under an explicit filter definition, upcoming entries. Cutoff-unmet upgrades are separate from missing. Recent imports use history types validated per service; failed downloads use queue status/history evidence, not every blocklist entry. Keep upstream event IDs for idempotency.

Verify: history event enums and retention, page totals/order, all catalog sizes, missing filter defaults, movie digital/theatrical/physical release dates, date timezone, transient warning format, queue error shape. Optional endpoints returning 404 produce unsupported capabilities, not a total-service failure. No command, search, refresh, delete, or download-client test calls.

## Prowlarr

Current published contract is [Prowlarr API v1](https://raw.githubusercontent.com/Prowlarr/Prowlarr/develop/src/Prowlarr.Api.V1/openapi.json). Candidate reads: `/api/v1/system/status`, `/health`, `/indexerstatus`, `/indexer`, `/applications`, and optional `/indexerstats` with a bounded date range. The schema includes indexer status/statistics and application configuration endpoints; configuration is not proof of connectivity.

Only fetch indexer/application configuration if safe names/IDs cannot be obtained otherwise. Project immediately onto IDs, names, enabled state and supported safe status evidence. Do not retain provider field arrays; these may contain credentials. Application connectivity is `unknown` unless health/status evidence identifies success or failure with timestamp. Do not call `/applications/test`, `/testall`, indexer tests, or queries to manufacture a green status.

Primary v1 card: reported warnings and failing indexers with reason/last evidence. Optional stats remain outside the first v1 gate if schemas or denominators are unclear. Verify disabled-vs-failing behavior, retry windows, application-specific warnings, and statistics units/date range before enabling.

M5 fixture implementation uses the published API v1 schema's `IndexerStatusResource.disabledTill` and `mostRecentFailure` plus `IndexerResource.enable`. An enabled indexer is marked failing only while `disabledTill` is in the future. Past failure timestamps alone do not establish a current failure; an absent status row is shown as “no active failure reported,” not proven healthy. Configuration is fetched solely to project ID/name/enable, and nested `fields` are discarded immediately. Health messages and sources are not projected because they may include secret-bearing configuration or URLs; only generic severity text is retained. Application connectivity remains `unknown`; application configuration and active tests are not read. This mapping is fixture-tested and remains subject to installed-version verification.

## Compatibility record required per adapter

Create `tests/fixtures/<provider>/<version>/README.md` when implementing, containing exact app version, API/schema version or source commit, fixture collection date, verified read paths, auth header name (never value), supported capabilities and redaction procedure. Hand-authored fixtures must say synthetic. Minimum cases: healthy, empty, partial, unauthorized, unreachable, slow, malformed, oversized and changed optional fields.

Record live acceptance in the milestone report. Mock tests establish parsing behavior, not actual server compatibility. If no live server is available, mark the slice fixture-validated and leave the live acceptance gate open.
