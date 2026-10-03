# Experience specification

## Visual hierarchy

Use a near-black neutral canvas, slightly elevated surfaces, fine borders, system typography (including the native macOS system font), tabular numerals, and a 4px spacing scale. Body text 14–16px; captions no smaller than 12px. One restrained accent for interaction; green/amber/red reserved for status, always paired with words/icons. Avoid gradients, decorative gauges, repeated oversized metric tiles and animated background effects.

At 1440px: a 208px navigation rail, compact page header and status strip, then a 12-column content grid. Storage occupies roughly seven columns and Currently Watching five. Service summaries form compact rows below, with recent activity spanning the remaining width. Use whitespace and typography to separate priority, not a border around every number.

At 768px collapse navigation and stack major sections into two/one columns; at 390px a single column preserves headline, warnings, storage and watching priority. Tables allow focused horizontal overflow only inside the table or become labeled rows; page-level horizontal scrolling fails acceptance. Menus/drawers preserve keyboard focus and escape behavior. Respect reduced motion; refreshes must not steal focus or reorder rows under a pointer.

## Navigation and pages

Start with Overview, System, Storage, Media, Events and Settings. Add Downloads, Containers and Network as their slices land; do not ship empty navigation destinations.

| Page | Content and drilldown |
| --- | --- |
| Overview | Five-second status, important warnings, selected volume capacity, active playback, concise service cards, latest 8 events |
| System | Host metadata, CPU/load, memory/swap, interface throughput and selected block I/O with 1h/24h history |
| Storage | Capacity bar, exact used/available/reserved values per selected filesystem, growth graph, physical disks with SMART evidence |
| Media | Active/paused sessions, recent additions and library counts; launch configured Jellyfin UI |
| Downloads | Combined source-labeled queue, wanted/monitored totals, upcoming items and recent imports; health section for Arr/Prowlarr |
| Containers | Compact searchable inventory, state filters, detail panel with uptime/resources/restart count/healthcheck and freshness |
| Network | Server Tailscale state, known peers, online/last-seen; separately labeled host interface traffic |
| Events | Chronological paginated activity, severity/source filters, observation vs upstream labels |
| Settings | Configured connections, safe capability diagnostics, versions/retention and setup guidance; no secrets or credential editor |

Service cards link to a relevant detail section plus a separate “Open service” link. Browser-facing service URLs are explicit configuration, because internal Compose hostnames may be inaccessible from the MacBook. Never expose an API-key URL.

## State design

Every card supports loading, fresh, empty, stale-with-data, unreachable, auth-error, unsupported, permission-denied and not-configured states. Initial loading uses stable skeleton dimensions; a refresh retains content. Show last successful observation as relative time with exact local date/time on focus/hover. Charts leave visible gaps. A stale value has a textual stale label, not only reduced opacity.

Example: “Radarr · Unreachable / Last successful connection 12 minutes ago / 3 queue entries at last refresh.” A true fresh empty queue says “Nothing downloading.” A disabled integration is explained in Settings rather than shown as down.

Keep host uptime and LabDeck runtime separate. Use IEC units consistently for byte values and label network rates as MiB/s, with optional exact-byte details. Display timezone-local dates while persisting UTC. Duration/progress labels must remain understandable without tooltips.

Storage uses a horizontal capacity bar: used, reserved and available segments with a nearby text legend and exact figures. One selected primary volume leads the overview. Physical disk inventory is a separate table; it does not contribute raw capacity to the filesystem bar. Do not invent media/category segments without measured attribution.

## Later storage forecast specification

Not in MVP or required v1. When implemented, use daily observations from the same filesystem identity/capacity over the latest 30 days, requiring ≥14 valid days and ≥70% coverage. Fit growth to daily used bytes; exclude periods across capacity changes/remount identity changes. Validate a robust estimator against deletions, flat growth and large imports before selecting it. Use available bytes for the exhaustion estimate, not nominal free space reserved for root.

Show “Estimated full around [date], based on recent growth,” analysis window, coverage, trend rate, and a range derived from plausible growth variation. The range is not a statistical confidence interval unless justified. If growth is nonpositive, unstable, insufficiently observed or extrapolated beyond 180 days, show “No reliable estimate” or “Beyond forecast horizon.” Never present an exact countdown or imply disk failure prediction.

## UX acceptance

Use realistic synthetic data and a mixed-failure scenario in visual tests. A reader should identify the unhealthy service, primary available storage, active stream and stale source without navigating. Test at 1440×900, 768×1024 and 390×844; keyboard-only and reduced-motion passes are required. Include text/table alternatives for chart values, semantic landmarks and accessible status announcements that do not fire every poll. Target WCAG AA contrast; automated accessibility checks supplement manual focus/readability review.

## Server wallboard and test evidence

Wallboard hides the navigation rail, retains an Overview exit link and offers browser fullscreen. Six bounded widgets summarize System, Storage, Docker, Watching, Downloads and Network. Each observed source shows freshness; watching caps titles at two with a remainder count and a Media link. At 1280×720 and larger desktop displays the default view fits one screen. Mobile and enlarged text can scroll.

Docker search matches name/image and combines with All, Needs attention, Running and Not running filters. Optional stopped containers stay out of Needs attention unless unhealthy. State, healthcheck and running expectations are separate concepts.

Storage separates SMART overall health from self-test results and labels disk lifetime hours explicitly. Schedule previews never appear installed. The optional Start buttons appear only for ATA disks when the control service is configured; they require current readable evidence and report command acceptance separately from test outcome. Follow the [host setup](../operations/smart-tests.md) to activate schedules or web starts.

## Delivered investigation add-ons

The later forecast specification above is refined by [decision 005](../decisions/005-monitoring-investigation-addons.md): the delivered estimate targets 10% available space rather than complete exhaustion, uses a fixed 30 completed UTC day window, and explains unavailable/unstable/stale results. Forecasts do not replace current capacity warnings.

Overview lists clickable current problems above reordered widgets. Problem detail shows evidence, provenance, related retained events and a timestamped chart where a relevant metric already exists; gaps and a table alternative remain visible. Docker groups projects and services with expandable native disclosures, full-group attention counts and filtered shown counts. Missing labels are explicit.

Settings provides keyboard-operated widget ordering, reset, wallboard title privacy, and backup creation-time verification with restore guidance. Volume, range and container filters persist per browser. The wallboard privacy option hides rendered titles and title tooltips while leaving session counts and status visible.
