# YouTube downloader validation — 2026-10-08

## Implemented scope

Owner-approved optional extension: three-mode preparation preview, track-title edits, explicit confirmation, queued/downloading/processing/terminal/interrupted states, cancellation and retry without redownloading completed items. The server checks owner session, exact origin and CSRF; reads only its scheduled last-good cache. A separate unprivileged host worker validates fixed requests, stores version-1 SQLite manifests, enforces playlist/queue/deadline/media limits, uses controlled subprocess arguments and publishes MP4/NFO or tagged MP3 without overwrite. Existing Arr/Prowlarr panels and LabDeck database schema are unchanged.

## Evidence

The following checks ran on 2026-10-08 in the local macOS checkout. Implementation, sanitized-fixture behavior, local codec output and selected browser flows are verified; installed Ubuntu/YouTube/Jellyfin compatibility is not.

| Command | Result and scope |
| --- | --- |
| `npm run test:integration` | Passed: 28 files, 115 tests, including shared request validation, owner/origin/CSRF enforcement, disabled configuration, cached reads, last-good timestamps, bounded socket responses and absolute worker-command timeout, plus existing integration regressions. |
| `LABDECK_YOUTUBE_FFMPEG_TEST=1 python3 -m unittest discover -s tests/youtube -v` | Passed: all 14 tests, with no codec-test skip. Sanitized fixtures/fake subprocesses cover movie and TV destinations/NFO escaping, unavailable episode numbering, music title edits/tags, rejected URLs/names/live/age-restricted metadata, collisions/symlinks, queue/retention limits, disk/byte/deadline checks, cancellation, interrupted recovery and retry skipping completed items. Publication tests exercise inode-safe rollback and SQLite failure. Actual local FFmpeg/ffprobe verify synthetic WebM to H.264/AAC MP4 and tagged MP3; no YouTube requests are involved. |
| `PLAYWRIGHT_BROWSERS_PATH=/tmp/labdeck-playwright npm run test:e2e -- --grep 'YouTube\|downloads'` | Passed: 5 selected Chromium tests, not the full browser suite. Music prepare/edit/confirm/retry/cancel runs at 1440px and 390px; movie and TV previews/confirmation and the existing Downloads panel isolation test also pass. The music flow checks keyboard confirmation, no horizontal overflow and zero automated Axe violations. Worker responses are fixtures. |
| `npm run check` | Passed: workspace typecheck, ESLint, documentation links and production builds. Vite reports a non-failing 505.13 kB frontend chunk warning; bundle splitting is outside this slice. |
| `npm run test:security` | Passed: existing security boundary checks. YouTube-specific owner/origin/CSRF checks also run in the integration suite. |
| `npm run docs:check` and `git diff --check` | Passed: documentation links and patch whitespace. |
| `python3 tests/youtube/live_check.py --help` | Passed: opt-in operator checker argument/help path only; no installed-worker or live download check ran. |

Observed local runtimes: Node.js 26.10.0, Python 3.14.7 and FFmpeg 9.0.1. Local yt-dlp 2026.08.19 accepted the worker's fixed base arguments with `--version`; this verifies option parsing only, not extraction, JS challenges or network compatibility. The codec test checks actual output streams and music tags rather than relying on filename extensions. The 390px screenshot was visually inspected; automated Axe checks do not constitute a complete manual accessibility audit.

Initial test/tooling failures were resolved and the affected checks rerun: canonical temporary fixture paths, a missing fixture audio encoder, sandbox restrictions on local Unix sockets, session-cookie extraction, native TypeScript module resolution, matching Chromium installation and asynchronous browser assertions. Chromium was installed into a temporary test location; no Ubuntu worker dependencies or service were installed, no firewall policy was applied and no production media was downloaded. The feature remains disabled unless its socket is explicitly configured.

## Pending live gates and limitations

- No live YouTube requests performed; public availability, yt-dlp JS runtime support and exact installed dependency versions require operator validation. No login/cookies/DRM or arbitrary sites.
- Ubuntu systemd, nftables rules/UID, redirected/private-destination denial, group/socket permissions, local filesystem publication and Jellyfin scheduled discovery remain unverified. Mandatory network policy installation is documented, not auto-installed.
- One serial worker prepares manifests as well as downloading, so a preview can wait behind an active job. Progress is item/stage state, not byte percentage. Missing flat-playlist live flags are rechecked by the download filter; no automatic waiting for live streams.
- Upstream omitted entries cannot be invented; retained playlist indices and explicit unavailable placeholders preserve numbering. Unavailable entries are not retried in a frozen manifest.
- Ready previews and terminal history share a 100-record/30-day pool. Restart removes unfinished staging and rolls back journaled incomplete publication; empty destination directories may remain. Separate metadata/media files cannot form one atomic filesystem transaction, but playable files are linked only when complete.
- Worker SQLite and media backups must be performed separately from LabDeck. Dependency updates and actual deployed versions require operator change records; no live installation is claimed.
