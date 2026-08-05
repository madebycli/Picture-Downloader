# Site adapters

## Contract

A site adapter translates rendered page state into shared `ArchiveItem` records. Site-specific hosts, selectors, IDs/timestamps, URL normalization, terminology, labels, and timeline behavior stay in the adapter.

Each adapter manifest entry declares page matches, reviewed media hosts, and source modules. The build generates userscript and extension permissions from those values. Runtime validation independently rejects undeclared media hosts. Optional external services such as VirusTotal are declared separately in `src/build-manifest.json` and are not adapter media sources.

Direct selection inside the host website remains optional and adapter-controlled. The shared post-scan Library is the supported selection surface.

## Discord

Supported pages: text channels and threads on stable, PTB, and Canary hosts.

Rendered sources:

- attachment images and native GIF files;
- Discord-hosted video attachments, including uncommon containers rendered by a video element;
- external GIF previews rendered through Discord proxy hosts.

The existing virtual-timeline scanner, dates, four directions, manual stop, final-position behavior, ZIP parts, `fflate`, and ZIP fallback remain enabled. No Discord token access and no `discord.com/api` calls are permitted.

## Pinterest

Supported deterministic surfaces:

- pin detail;
- boards;
- visible profile-created/profile-saved grids;
- pin search results.

The personalized home feed is rejected. Discovery inspects only rendered `img`, `picture`, `video`, and `source` attributes. Stable Pin IDs plus media host/path form canonical keys so Masonry re-renders merge instead of duplicating records.

## Reddit comment media

Supported pages are only post-detail comment-thread paths under `/r/<subreddit>/comments/<post>/...`, including old Reddit. Home, Popular, subreddit feeds, search feeds, recommendations, and For You surfaces do not match.

Comments are DOM containers and timeline anchors only. The adapter does **not** create comment-text ArchiveItems and does not generate JSON, Markdown, or CSV comment exports.

Rendered media discovery covers:

- `img` current/source/lazy attributes;
- `srcset` candidates;
- `picture` and rendered source candidates;
- `video` and nested source candidates;
- direct links whose rendered target is a reviewed media file;
- native Reddit photos, GIFs, and videos;
- external rendered media from reviewed CDN hosts.

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

Canonical media keys use normalized media hostname and path. The same meme rendered in multiple comments is therefore merged globally while retaining the contributing comment IDs/permalinks in internal payload metadata.

The adapter never votes, posts, joins, follows, reacts, expands replies automatically, requests feeds, or calls authenticated Reddit APIs.

## Adding an adapter

1. Add minimal sanitized fixtures and expected canonical results.
2. Implement explicit page matching that rejects unsupported/feed surfaces.
3. Add capabilities and rendered-item discovery with stable keys.
4. Declare minimal matches and connection hosts in `src/adapters/manifest.json`.
5. Add runtime allowlisting using the same reviewed hosts, including wildcard tests when needed.
6. Document timestamp semantics, source-label semantics, boundaries, and safety exclusions.
7. Add fixture, unsupported-page, deduplication, selection, naming, and diagnostics tests.
8. Run `npm test` and the Chromium/Firefox Playwright matrix.
