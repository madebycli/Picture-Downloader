# Site adapters

## Contract

A site adapter translates rendered page state into shared `ArchiveItem` records. Site-specific hosts, selectors, IDs/timestamps, URL normalization, terminology, labels, timeline behavior, and safe rendered-content expansion stay in the adapter.

Each adapter manifest entry declares page matches, reviewed media hosts, and source modules. The build generates userscript and extension permissions from those values. Runtime validation independently rejects undeclared media hosts. Optional external services such as VirusTotal are declared separately in `src/build-manifest.json` and are not adapter media sources.

Optional navigation hooks include:

- `jumpScanWindow({ scroller, direction, iteration })` for adapter-specific virtual-timeline jumps with overlap reporting;
- `expandRenderedContent({ scroller, direction })` for narrowly reviewed, already rendered loading controls;
- `preferredScanMode` and `boundaryConfirmMs` for provider-appropriate defaults.

Direct selection inside the host website remains optional and adapter-controlled. The shared post-scan Library is the supported selection surface.

## Discord

Supported pages: text channels and threads on stable, PTB, and Canary hosts.

Rendered sources:

- attachment images and native GIF files;
- Discord-hosted video attachments, including uncommon containers rendered by a video element;
- external GIF previews rendered through Discord proxy hosts.

Discord supports date filtering and all four scan modes. Its preferred mode remains newest-to-oldest.

### Loaded-edge jump scanning

For each pass the adapter:

1. scans the currently rendered items;
2. records the message ID at the travel edge;
3. sets the channel scroller directly to the currently loaded top or bottom;
4. waits while Discord prepends or appends its next virtual chunk;
5. reapplies the edge during the settle window;
6. scans the settled rendered chunk;
7. verifies that the previous edge ID is still represented in the overlap;
8. when the ID was virtualized away, moves back by a bounded half/one viewport, rescans, and returns to the edge.

Canonical attachment/proxy keys remain the deduplication authority. The navigation change does not broaden hosts or access Discord APIs. A possible real timeline start still receives the full delayed confirmation.

## Pinterest

Supported deterministic surfaces:

- pin detail;
- boards;
- visible profile-created/profile-saved grids;
- pin search results.

The personalized home feed is rejected. Discovery inspects only rendered `img`, `picture`, `video`, and `source` attributes. Stable Pin IDs plus media host/path form canonical keys so Masonry re-renders merge instead of duplicating records.

## Reddit comment media

Supported pages are only post-detail comment-thread paths under `/r/<subreddit>/comments/<post>/...`, including old Reddit. Home, Popular, subreddit feeds, search feeds, recommendations, and For You surfaces do not match.

Comments are DOM containers and navigation anchors only. The adapter does **not** create comment-text ArchiveItems and does not generate JSON, Markdown, or CSV comment exports.

Reddit declares `dateFilter: false` and exposes only `current-to-newest`. Comment timestamps are not used as an archive boundary because nested replies can be much newer than their parent comments.

Rendered media discovery covers:

- `img` current/source/lazy attributes;
- `srcset` candidates;
- `picture` and rendered source candidates;
- `video` and nested source candidates;
- direct links whose rendered target is a reviewed media file;
- native Reddit photos, GIFs, and videos;
- external rendered media from reviewed CDN hosts.

During downward scanning, the adapter can activate visible enabled controls matching **View/Load/Show more comments or replies**, **More comments/replies**, and **Continue this thread**. It attempts no more than eight controls per pass and applies an eight-second per-element cooldown. Controls referring to login, signup, awards, sharing, reporting, saving, following, joining, or voting are rejected. No API call is made by Media Archiver; activation is equivalent to a user click on Reddit's already rendered loading control.

Reviewed Reddit media hosts include:

```text
i.redd.it
preview.redd.it
external-preview.redd.it
v.redd.it
packaged-media.redd.it
i.redditmedia.com
reddit-uploaded-media.s3-accelerate.amazonaws.com
i.imgur.com
*.giphy.com
media.tenor.com
*.streamable.com
*.redgifs.com
*.gfycat.com
cdn.discordapp.com
media.discordapp.net
pbs.twimg.com
video.twimg.com
*.tumblr.com
```

Canonical media keys use normalized media hostname and path. The same meme rendered in multiple comments is merged globally while retaining contributing comment IDs/permalinks in internal payload metadata.

The adapter never votes, posts, joins, follows, reacts, requests feeds, or calls authenticated Reddit APIs.

## Adding an adapter

1. Add minimal sanitized fixtures and expected canonical results.
2. Implement explicit page matching that rejects unsupported/feed surfaces.
3. Add capabilities and rendered-item discovery with stable keys.
4. Declare minimal matches and connection hosts in `src/adapters/manifest.json`.
5. Add runtime allowlisting using the same reviewed hosts, including wildcard tests when needed.
6. Keep jump/expansion hooks bounded, DOM-only, and separately tested.
7. Document timestamp semantics, boundaries, and safety exclusions.
8. Add fixture, unsupported-page, deduplication, selection, navigation, naming, and diagnostics tests.
9. Run `npm test` and the Chromium/Firefox Playwright matrix.
