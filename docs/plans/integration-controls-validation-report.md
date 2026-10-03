# Integration controls and files: validation evidence

Date: 2026-10-03. Scope: SMART control hardening, allowlisted Docker actions, mounted-share status, and optional one-share file operations. This is local fixture evidence on macOS, not an Ubuntu compatibility claim.

| Check | Result | Evidence limit |
| --- | --- | --- |
| `npm run check` | Passed | TypeScript, ESLint, local Markdown links and production build. |
| `npm run test:unit` | Passed, 19 tests | Includes migration 006 and navigation expectations. |
| `npm run test:integration` | Passed, 109 tests | Includes authenticated file route/CSRF fixture, SMART route fixture, host/Docker/SMART state and backup/restore migration. Temporary Unix sockets needed local sandbox escalation. |
| `go -C collector test ./...` | Passed | Official Go 1.24.0 macOS arm64 archive and checksum matched; used temporary build cache and socket permission escalation. Synthetic tests only. |
| `go -C collector vet ./...` | Passed | Same local toolchain. |
| `python3 -m unittest discover -s deploy/files -p 'test_*.py'` | Passed, 3 tests | Path traversal, symlinks, resume, collision, rename, delete and paginated listing on a temporary local directory; macOS shim stands in for Linux `renameat2`. |
| `npm run test:security` | Passed | Existing static boundary checks. |
| Combined Compose `config --quiet` with dummy variables | Passed | Syntax/rendering only; no container started. |
| `git diff --check` | Passed | No whitespace errors. |

## Open compatibility gates

- Ubuntu systemd installation, service user/ACL, directory and socket ownership, and app container group access are unverified.
- No real SMART self-test was initiated. Installed smartmontools and SATA/bridge behavior remain unverified; obtain owner approval for an exact disk before a physical test.
- No real Docker container or Compose project was started, stopped or restarted. Installed Docker CLI/Engine/Compose and reviewed project files remain unverified.
- No real NFS/SMB share was accessed or changed. Verify mount failure behavior, hard-link/no-replace rename support, permissions, and long/100 GiB upload recovery on the chosen share.
- Browser end-to-end and 24-hour soak checks were not run for this slice. Do not mark M9 release readiness complete from these fixtures.

Use [the Copilot handoff](../operations/copilot-integration-setup.md) for the host setup and record actual host observations alongside this report.
