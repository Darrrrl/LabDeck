# Synthetic Docker Engine responses

Hand-authored fake Engine responses in `collector/internal/docker/collector_test.go`, dated 2026-09-24. They exercise API version negotiation, all-state listing, inspect projection, one-shot stats, a 50-container load, nested environment/health-log secret canaries and fixed GET routes. They are not captured from an installed Docker Engine. The frontend/browser fixture is in `tests/e2e/shell.spec.ts`. Installed Engine API, cgroup stats variants, socket permissions and actual load behavior remain live verification gates.
