# M1 validation report

Validated 2026-09-19 on macOS arm64 with Node 26.7.0 and npm 11.19.0. Production baseline remains Node 24; CI targets Node 24. No live homelab service or host collector is part of M1.

## Acceptance evidence

- One Fastify process serves the compiled React SPA and versioned REST routes. Direct browser routes fall back to uncached `index.html`.
- Operational state requires an owner session. The owner password is Argon2id, session and CSRF tokens are stored only as SHA-256 hashes, sessions expire after eight hours, and changing the configured password hash clears them.
- Login/logout enforce exact Origin and Host checks, bound CSRF, local/global attempt limits, safe error bodies, strict cookies in production, bounded bodies, and restrictive response headers.
- Missing owner authentication returns readiness `503` with only `{ "ok": false }`; liveness remains independent.
- The normal UI contains Overview and Settings only, reports “No integrations configured,” and never displays fabricated metrics. Fixture demo mode is loopback-only and permanently labeled.
- Compose binds the host port to loopback, runs UID/GID 10001, drops all capabilities, enables no-new-privileges, uses a read-only root filesystem and mounts only SQLite data plus the password-hash file. No device, Docker socket, privileged mode, or host namespace is present.

## Commands run

| Command | Result |
| --- | --- |
| `npm ci` | Passed; 377 packages installed from lockfile |
| `npm run check` | Passed: typecheck, lint, 14-document local-link check, frontend/backend build |
| `npm run test:unit` | Passed: 6 files, 11 tests |
| `npm run test:integration -- --project=foundation` | Passed: 1 file, 8 tests |
| `npm run test:e2e -- --project=chromium --grep shell` | Passed: 4 Chromium tests, including 1440×900, 768×1024, 390×844 and keyboard flow |
| `npm run test:security` | Passed: client bundle and Compose boundary scan |
| `docker compose ... config --quiet` with documented required variables | Passed |
| `docker compose ... build` with documented required variables | Not run to completion: local Docker daemon socket was absent |
| `npm audit --omit=dev` | Passed: zero production vulnerabilities reported |

The browser test required permission to bind a loopback test server and launch Chromium. Its HTTP fixture uses explicit loopback-only demo mode; production cookie flags are verified in integration tests because no local TLS endpoint was provisioned. The image definition is present and CI builds it on Ubuntu, but the local Docker build remains unverified until a daemon is available.

## Implementation decisions

Direct dependencies are exact-pinned and the npm lockfile is authoritative. TypeScript 5.9.3 is used because TypeScript 7 did not satisfy the current typescript-eslint peer range. The password helper uses `node --import tsx` so it does not place passwords in arguments and works in restricted local environments. Login throttling is a small bounded in-process limiter because this is a single-instance application; no Redis or proxy-derived client IP is involved.
