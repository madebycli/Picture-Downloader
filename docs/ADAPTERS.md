# Site adapters

## Contract

A site adapter translates rendered page state into shared `ArchiveItem` records. Site-specific hosts, selectors, ID/timestamp rules, URL normalization, terminology, source labels, and timeline behavior belong only in the adapter.

Each adapter manifest entry declares:

```json
{
  "id": "example",
  "label": "Example",
  "matches": ["https://example.com/library/*"],
  "connect": ["media.example.com"],
  "modules": ["src/adapters/example/adapter.user.js.part"]
}
```

The build generates userscript and extension permissions from these values. Runtime validation independently rejects undeclared hosts.

Required runtime members include identity, capabilities, page matching, rendered-item discovery, archive context, and URL allowlisting. Virtual-timeline adapters additionally provide scroller, visible IDs/time range, item lookup, starting-anchor capture, timestamps, and ID comparison.

Capabilities control the shared UI:

```js
capabilities: {
    media: true,
    textRecords: false,
    virtualTimeline: true,
    dateFilter: true,
    hostPageSelection: false,
    scanModes: [
        'newest-to-oldest',
        'current-to-oldest',
        'current-to-newest',
        'full-finish-down'
    ],
    views: ['grid', 'list']
}
```

Direct selection inside the host website is optional and must remain adapter-controlled. No current adapter enables it; the shared post-scan Library is the supported selection surface.

## Discord

Supported pages: text channels and threads on stable, PTB, and Canary hosts.

Rendered sources:

- attachment images and native GIF files;
- Discord-hosted video attachments, including uncommon containers rendered by a video element;
- external GIF previews rendered through Discord proxy hosts.

The adapter normalizes scaled `media.discordapp.net` attachment previews to the corresponding rendered original path on `cdn.discordapp.com`, while preserving temporary signature parameters and removing only preview/conversion parameters. Canonical keys ignore signed query values. Snowflake IDs provide timestamp fallback. The full existing virtual timeline behavior and date semantics remain enabled.

Allowed download hosts:

```text
cdn.discordapp.com
media.discordapp.net
images-ext-1.discordapp.net
images-ext-2.discordapp.net
```

No Discord token access and no `discord.com/api` calls are permitted.

## Pinterest

Initial page scope:

- pin detail;
- boards;
- visible profile-created/profile-saved grids;
- pin search results.

The root/personalized home feed is rejected. Date filtering is disabled because reliable rendered timestamps are not consistently available.

Discovery inspects only rendered `img`, `picture`, `video`, and `source` attributes. Candidate quality is based on actual `currentSrc`, `srcset`, `src`, and rendered video sources; the adapter never synthesizes a higher-resolution URL. Stable Pin IDs plus media host/path form canonical keys so Masonry re-renders merge rather than duplicate records.

Allowed download hosts:

```text
i.pinimg.com
v1.pinimg.com
v.pinimg.com
```

No Pinterest resource/API enumeration is permitted.

## Reddit comments

Supported pages are only post-detail comment-thread paths under `/r/<subreddit>/comments/<post>/...`, including old Reddit. Home, Popular, subreddit feeds, search feeds, recommendations, and For You surfaces do not match.

Rendered comment records include:

- comment ID and parent ID;
- depth;
- rendered author;
- plain body text;
- optional sanitized rendered HTML;
- rendered timestamp;
- visible score text;
- permalink;
- deleted, collapsed, and edited state.

Selected comments are transformed locally after confirmation into `comments.json`, `comments.md`, and `comments.csv`. Their hierarchy is rebuilt from selected ID/parent relationships and discovery order. Comment records never enter binary transport. Images/videos rendered inside comments become separate media items and can be independently selected.

Allowed media hosts:

```text
i.redd.it
preview.redd.it
external-preview.redd.it
v.redd.it
```

The adapter never votes, posts, joins, follows, reacts, expands replies automatically, or calls authenticated Reddit APIs.

## Adding an adapter

1. Add minimal sanitized fixtures and expected canonical results.
2. Implement explicit page matching that rejects unsupported/feed surfaces.
3. Add capabilities and rendered-item discovery with stable keys.
4. Declare minimal matches and connection hosts in `src/adapters/manifest.json`.
5. Add runtime allowlisting using the same reviewed hosts.
6. Document timestamp semantics, source-label semantics, boundaries, and safety exclusions.
7. Add fixture, unsupported-page, deduplication, selection, naming, and diagnostics tests.
8. Run `npm test` and the relevant Playwright/browser matrix.
