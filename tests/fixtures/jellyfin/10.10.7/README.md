# Jellyfin 10.10.7 synthetic fixtures

- App/API version: shaped from Jellyfin 10.10.7 public DTOs and controller routes; no live server supplied.
- Source review: Jellyfin server and generated TypeScript SDK `master`, reviewed 2026-09-20.
- Fixture collection: hand-authored 2026-09-20; all people, titles, IDs and values are synthetic.
- Verified fixture routes: `GET /System/Info`, `/Sessions`, `/Items/Counts`, `/Items`.
- Authentication header: `Authorization` using the MediaBrowser token scheme; value never captured.
- Supported capabilities: `media.playback`, `media.library`.
- Redaction: no source response or credential was copied; optional and unknown fields are omitted or synthetic.

These fixtures validate normalization only. Path-prefix, installed-version, key-permission and live schema compatibility remain pending until the operator runs the opt-in Jellyfin live check.
