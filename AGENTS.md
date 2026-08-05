# AGENTS.md

## Mission

Maintain a browser-only, adapter-driven Tampermonkey userscript that archives media already rendered by supported web applications. Reliability on large virtualized timelines is more important than cleverness.

## Canonical source

- `src/core/*.user.js.part` contains site-neutral runtime modules.
- `src/adapters/*.user.js.part` contains site integrations.
- `src/adapters/manifest.json` declares adapter modules, `@match` patterns, and allowed download hosts.
- `src/build-manifest.json` defines assembly order and the generated output name.
- `npm run build` assembles `media-archiver.user.js`.

Never edit the generated root file without making the equivalent source-module change.

## Architecture boundaries

The core owns:

- adapter registration and activation
- filtering and ordering
- generic virtual-timeline scanning
- downloads, retries, and ZIP creation
- workflow state
- the tabbed interface

An adapter owns:

- page matching
- visible-media discovery
- item IDs and timestamps
- timeline/scroller discovery
- visible-item ranges and anchor restoration
- source URL normalization
- allowed download hosts
- archive context and site terminology

Do not add site selectors, URL rules, epochs, or host checks to `src/core/`. Put them in an adapter.

## Non-negotiable constraints

1. Never extract, request, log, or persist user tokens, cookies, authorization headers, or account credentials.
2. Never use undocumented authenticated APIs to enumerate content.
3. Never automate posting, messaging, reactions, follows, or other account actions.
4. Only collect media the supported page has rendered for the signed-in user.
5. Do not scrape linked third-party pages to discover extra media.
6. Each adapter must allow downloads only from hosts declared in its manifest.
7. Preserve true file extensions; never rename one media format as another.
8. Preserve newest-to-oldest numbering across ZIP parts.
9. Disabled media types and out-of-range dates must never enter ZIP output.
10. Keep current Firefox and Chromium-based browsers with Tampermonkey supported.
11. Keep release notes in repository documentation, not in the runtime interface.

## UI rules

- Group controls by user task, not implementation detail.
- Keep the primary status visible while setup, media, and activity are separate tabs.
- Avoid long explanatory paragraphs in the panel.
- Use adapter labels only for current-site context; never put a site name in the product title.
- Keep UI strings and logs in English until a localization system exists.
- Preserve keyboard-accessible native controls and meaningful labels.

## Change rules

- Increment the metadata version, runtime `VERSION`, and `package.json` together.
- Update `CHANGELOG.md` for user-visible releases, but do not surface it in the panel.
- Run `npm test` before committing.
- Prefer focused modules and adapter methods over site checks in generic functions.
- Avoid unbounded concurrency and duplicate in-memory buffers.
- When adding an adapter, document detection rules, host permissions, timestamp semantics, and safety boundaries in `docs/ADAPTERS.md`.

## Testing priorities

Always test at least:

- Firefox + Tampermonkey with the `fflate` CDN blocked
- Chromium + Tampermonkey with `fflate` available
- each enabled media category alone and mixed
- fixed date range and latest-available mode
- all four scan directions
- stop during scanning and stop during download
- more than one ZIP part
- final position at timeline end, scan end, and starting position
- unsupported pages do not inject the interface
- adapter host restrictions block undeclared download URLs

See `docs/TESTING.md` for the full matrix.
