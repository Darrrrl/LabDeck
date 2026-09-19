# Decision 001: one application, bounded host collection

Status: accepted for implementation; revisit only with measured constraints.

Use React/TypeScript and a Fastify TypeScript backend in one deployable application, SQLite persistence, and a small Go host collector. Use npm workspaces without a monorepo orchestration product. Compile the frontend into assets served by the backend.

The TypeScript choice keeps public/domain schemas shared. Fastify offers a small request server without requiring SSR. Choose supported versions during M1 using the [Node release schedule](https://nodejs.org/en/about/previous-releases) and [Fastify LTS policy](https://fastify.dev/docs/latest/Reference/LTS/); planning baseline is Node 24 and Fastify 5. Exact dependency pins and the lockfile belong to implementation.

M1 pins Node support to 24–26 and uses Fastify 5.12.5, React 19.3.0, Vite 8.3.0, TypeScript 5.9.3, Vitest 5.0.1 and better-sqlite3 13.0.3. The lockfile is authoritative for transitive versions. TypeScript 7 was available during implementation but incompatible with the current typescript-eslint peer range, so it was not forced into the build.

A Go-only application would reduce deployment runtime requirements, but requires maintaining a generated or duplicated frontend contract. Python adds a similar language boundary to the main application. The collector benefits enough from a standalone Linux binary to justify Go in that limited area. Keep its responsibility to collecting and normalizing host observations, not serving requests, retaining history, or deciding UI policy.

Prefer sanitized snapshot files over a Docker socket proxy. A proxy still needs precise method/path filtering and exposes daemon responses which can contain secrets. A periodic exporter exposes only selected fields and accepts no instructions from the web app. The tradeoff is a systemd installation step and periodic rather than instantaneous updates.

Built-in adapters are modules, not microservices. Static registration supports multiple configured instances with stable IDs but v1 optimizes its UX for one instance of each service. No hot configuration reload; restart after editing local configuration. No executable plugins.

Begin metric and event persistence with the first system slice. Postponing the persistence contract until all integrations exist would require rewriting every integration. Advanced historical UX and retention load testing still belong later.

Consequences: native SQLite dependency builds and a two-language toolchain need CI coverage. Host collector installation is outside Compose. These are explicit costs; do not add a broker, remote agent protocol, ORM, or distributed scheduler to compensate.
