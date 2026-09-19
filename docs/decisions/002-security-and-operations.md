# Decision 002: credentials, host access, and private deployment

Status: accepted baseline. The threat model includes a curious LAN/tailnet user, malicious integration response, compromised browser session, leaked API key, and a web application exploit. Host root compromise is outside the protection boundary. Private networking reduces exposure but does not replace authentication.

## Application access

One owner account, configured out of band. Store an Argon2id password hash via a local secret file; provide a local CLI to produce it without echoing a password or putting it in shell history. No registration or password-reset email flow. Default startup fails readiness if authentication is missing; explicit fixture-only development mode binds loopback and has a persistent demo banner.

Login generates a random 256-bit opaque session token; SQLite stores its SHA-256 hash. Set an HttpOnly, Secure, SameSite=Strict cookie with an 8-hour absolute expiry. Logout deletes the server session and cookie. Rate-limit login by source and globally, bound the session table, return generic errors, and clear sessions on password-hash change. Protect login/logout with exact Origin checks and a CSRF nonce bound to the pre-login/session context. Do not put tokens in URLs or localStorage.

Host Tailscale Serve provides the default TLS edge; proxy only to `127.0.0.1:port`. Configure canonical origin and allowed Host values. Do not trust forwarded identity or arbitrary `X-Forwarded-*`; restrict proxy trust explicitly. Keep the app login even behind Tailscale. An owner may later choose an authentication proxy through a separate decision, but do not silently trust tailnet membership. A TLS LAN reverse proxy is an alternative. Do not publish public ingress or Tailscale Funnel.

Apply restrictive CSP (self-hosted scripts/styles/assets), no framing, MIME sniff protection, same-origin API, no wildcard CORS, bounded request sizes and safe error bodies. Render upstream titles/warnings as plain text. Permit navigation links only to configured HTTP(S) UI origins; no vendor-supplied HTML or arbitrary URL schemes.

## Secrets and outbound access

Local configuration contains stable instance IDs, provider type, API base URL (including any reverse-proxy path prefix), browser UI URL, poll options and a secret reference. Secret values come from mounted files (preferred, Compose secrets) or environment variables; reject ambiguous dual definitions. Files must have restricted host permissions and app-readable ownership. Environment variables remain visible to administrators/container inspection, which is a tradeoff to document.

Never place credentials in `VITE_*`, client bundles, query strings, DTOs, event payloads, fixtures, logs, diagnostics, or SQLite. No raw upstream response cache. Build explicit field allowlists; Prowlarr application configuration and Docker inspect data can contain unrelated credentials. Use header authentication and redact known secret values defensively in sanitized upstream messages, including URL/query fragments; default to safe error codes when uncertain. Limit and normalize all text.

Only operator-owned configuration sets integration addresses. There is no browser URL-fetch API, image proxy, webhook receiver, or connection-test endpoint in v1. Allow configured private addresses because this is a homelab; reject URL credentials, unsupported schemes, fragments, link-local metadata destinations and redirected destinations. Disable redirects, verify TLS by default, permit a configured private CA bundle rather than a global insecure switch. HTTP to explicitly configured local service networks is supported and documented as plaintext to that service.

Adapter transport exposes fixed GET endpoint paths and allowlisted query parameters. Never accept an upstream URL as the next page link without checking it; construct pagination locally. Authenticate only to the configured origin/base path. Bound connection time (2s), total request time (5s), group lifetime, response size, page count, and concurrency. See contract for defaults.

Most integration API keys are potentially write-capable. LabDeck's read-only transport reduces accidental action risk but does not restrict a stolen key's upstream privileges. Use dedicated credentials where available, restrict service network reachability, and rotate after compromise. Do not claim APIs have read-only scopes unless verified.

## Permissions

| Component | Access | Risk and constraint |
| --- | --- | --- |
| App | Its SQLite volume, read-only config/secrets and snapshots; outbound configured service APIs | No host sockets, devices, host root, or privileged mode |
| Base collector | Host `/proc`, selected `/sys` counters, statfs on configured mountpoints; snapshot output | Dedicated user, no network listener; no shell commands from app input |
| Docker module | Optional Docker Unix socket | Effectively host-admin power; isolate in collector, emit only safe fields |
| SMART timer | Optional root or narrowly tested raw device capabilities | Fixed root-owned device allowlist and smartctl path/arguments; no web command path |
| Tailscale module | Ability to read local status through installed CLI/daemon | Verify minimum local permission; no socket in app, no broad operator grant just to monitor |

Docker documents the daemon's [security boundary](https://docs.docker.com/engine/security/) and socket [access controls](https://docs.docker.com/engine/security/protect-access/). A read-only filesystem bind of a socket does not make API operations read-only. The collector remains a trusted host component even if its current implementation only performs reads.

## Operations

Config/secrets are local files; startup validates them without dumping values. Invalid global config prevents startup; a single bad integration credential yields that integration's auth-error state. Adapter connection failures do not restart the app.

Healthchecks distinguish app failure from upstream failure. Use structured logs with integration IDs, safe error codes, latency, and event counts; omit request headers, raw bodies, command stdout and sensitive paths. Rotate container/collector logs with explicit size limits in deployment examples. No external telemetry.

Version app image, collector binary and snapshot protocol. Accept only supported schema major versions; unknown optional fields can be ignored. Upgrades back up the database before migration, retain rollback image/binary versions, and document restoring the previous database when needed. Test power-loss/restart recovery, expired snapshots, DB-full behavior, and restore in M8/M9.

Binding Compose ports may interact with host firewall rules. Validate actual reachability from another LAN device and from Tailscale; do not infer isolation from firewall configuration alone. Release acceptance includes proving the app has no route from the public internet under the documented topology.
