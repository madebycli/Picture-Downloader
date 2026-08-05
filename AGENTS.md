# AGENTS.md

## Mission

Maintain a browser-only, adapter-driven Media Archiver product that archives content already rendered by supported web applications. Reliability on large virtualized timelines is more important than cleverness.

The current production artifact is a Tampermonkey userscript. The approved roadmap requires three first-class outputs from one shared source tree:

1. universal userscript;
2. Chromium extension;
3. Firefox extension.

The userscript must remain supported while the extension runtimes are added.

## Mandatory planning context

Before implementing roadmap work, read:

- `docs/CURRENT_STATE_AUDIT.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/NAMING_SYSTEM.md`
- `docs/PROJECT_CONTEXT.md`
- `docs/ARCHITECTURE.md`
- `docs/ADAPTERS.md`
- `docs/TESTING.md`
- `SECURITY.md`

## Canonical source

Current userscript layout:

- `src/core/*.user.js.part` contains site-neutral runtime modules.
- `src/adapters/**/*.user.js.part` contains site integrations.
- `src/adapters/manifest.json` declares adapter modules, `@match` patterns, and allowed download hosts.
- `src/build-manifest.json` defines assembly order and the generated output name.
- `npm run build` assembles `media-archiver.user.js`.

The roadmap migrates this incrementally toward shared domain, runtime, UI, archive, selection, and adapter modules. Never edit a generated release artifact without making the equivalent source-module change.

## Architecture boundaries

Shared/core code owns:

- adapter registration and activation
- filtering, ordering, and final manual selection
- generic virtual-timeline scanning
- collision-safe archive naming
- downloads, retries, and ZIP creation through a runtime contract
- workflow state
- the shared launcher and library interface

An adapter owns:

- page matching
- rendered media or record discovery
- item IDs and timestamps
- timeline/scroller discovery
- visible-item ranges and anchor restoration
- source URL normalization
- allowed download hosts
- archive context, safe source labels, and site terminology

A runtime owns:

- cross-origin binary transport
- cancellation
- downloads/blob saving
- settings storage
- extension/content/background messaging where applicable

Do not add site selectors, URL rules, epochs, or host checks to shared/core modules. Do not add Tampermonkey, Chromium, or Firefox globals to shared modules.

## Non-negotiable constraints

1. Never extract, request, log, or persist user tokens, cookies, authorization headers, or account credentials.
2. Never use undocumented authenticated APIs to enumerate content.
3. Never automate posting, messaging, voting, reactions, follows, joins, or other account actions.
4. Only collect content the supported page has rendered for the signed-in user or explicitly loads through a safe user action.
5. Do not scrape linked third-party pages to discover extra media.
6. Each adapter must allow downloads only from hosts declared in its manifest.
7. Preserve true file extensions; never rename one media format as another.
8. Plan final archive names centrally before downloads begin.
9. Keep sequence numbers global across the complete final selection, file types, generated documents, worker batches, and ZIP parts.
10. Never reuse a normalized filename stem for different files, even when extensions differ. `000001.jpg`, `000001.jpeg`, and `000001.png` in one archive is forbidden.
11. Apply cross-platform and Windows-safe sanitization on every runtime.
12. Preserve newest-to-oldest default ordering across ZIP parts.
13. Disabled, ineligible, or manually deselected items must never enter archive output.
14. Keep current Firefox and Chromium-based browsers supported.
15. Produce and validate the universal userscript, Chromium extension, and Firefox extension from shared source.
16. Keep release notes in repository documentation, not in the runtime interface.

## Naming rules

`docs/NAMING_SYSTEM.md` is authoritative.

- The default preset is global six-digit numbering, newest to oldest.
- Built-in presets also include source date/time, source+date+number, and original+number.
- Advanced templates stay behind a clean optional disclosure.
- Adapters supply safe context; they do not generate final filenames.
- Preview, retries, manifests, downloads, and all ZIP parts must use the same immutable naming plan.
- Same input order and settings must produce the same names in all three runtime targets.

## UI rules

- Group controls by user task, not implementation detail.
- Keep the primary status visible while setup, library/media, and activity are separated.
- Keep ordinary controls simple and expose power-user options progressively.
- The File naming control must show a preset and live preview; template editing is advanced.
- Avoid long explanatory paragraphs in the runtime UI.
- Use adapter labels only for current-site context; never put a site name in the product title.
- Keep UI strings and logs in English until a localization system exists.
- Preserve keyboard-accessible controls, meaningful labels, focus management, and reduced-motion behavior.

## Change rules

- Increment all target/version declarations together for releases.
- Update `CHANGELOG.md` for user-visible releases, but do not surface it in the panel.
- Run `npm test` before committing.
- Prefer focused shared modules, runtime bridges, and adapter methods over target or site checks in generic functions.
- Avoid unbounded concurrency and duplicate in-memory buffers.
- When adding an adapter, document detection rules, host permissions, timestamp semantics, safe source-label semantics, and safety boundaries in `docs/ADAPTERS.md`.
- Keep the userscript working after each migration milestone.

## Testing priorities

Always test at least:

- Firefox + Tampermonkey with the `fflate` CDN blocked
- Chromium + Tampermonkey with `fflate` available
- packaged Firefox extension
- packaged Chromium extension
- identical naming fixtures across all three outputs
- old Windows duplicate-stem regression with `.jpg`, `.jpeg`, and `.png`
- sequence continuity across media types and multiple ZIP parts
- each enabled media category alone and mixed
- fixed date range and latest-available mode
- all supported scan directions
- stop during scanning and stop during download
- more than one ZIP part
- final position at timeline end, scan end, and starting position
- unsupported pages do not inject the interface
- adapter host restrictions block undeclared download URLs

See `docs/TESTING.md` and `docs/NAMING_SYSTEM.md` for the complete matrices.
