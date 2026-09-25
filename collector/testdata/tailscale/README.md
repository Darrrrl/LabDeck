# Synthetic Tailscale status fixture

`status.json` is a fabricated local `tailscale status --json` shape, modeled on the upstream `ipnstate.Status`/`PeerStatus` fields as reviewed 2026-09-25. It is not captured from a real tailnet. Names, IP addresses, stable IDs and timestamps are synthetic; a secret canary in discarded fields proves the collector projection does not publish profiles or keys. Installed client compatibility and permissions remain a live Ubuntu gate.
