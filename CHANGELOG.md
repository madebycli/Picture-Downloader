# Changelog

## 7.2.0 — 2026-08-05

### Fixed

- Discord scanning no longer advances only a fraction of a viewport per pass. It jumps to the currently loaded virtual edge and waits for Discord to load the next chunk.
- Each Discord jump verifies the previous edge message ID and performs a bounded recovery overlap scan when virtualization hides that anchor.
- Large Review Libraries no longer compress hundreds of selected cards into unusable horizontal lines.
- The Library now has fixed card/list heights, a stable vertical scrollbar, and batched DOM rendering for 1,000+ candidates.
- Plain card/checkmark clicks now toggle select/deselect without clearing every other selected item.
- Developer-log level/category checkboxes use compact native dimensions instead of inheriting full-width toolbar input sizing.
- Reddit date filtering is disabled and its scan controls are reduced to the provider-appropriate complete downward comment-thread scan.

### Added

- Reddit DOM-only expansion for visible **View/Load/Show more comments or replies**, **More replies**, and **Continue this thread** controls.
- Expansion safety filters, an eight-control pass limit, an eight-second per-element cooldown, and post-click rendered-list settling.
- Scanner navigation regression tests for Discord edge jumps, overlap recovery, canonical deduplication, and Reddit expansion ordering.
- Chromium/Firefox Playwright coverage for a synthetic 1,100-item Library, scroll batching, repeated click toggles, and compact Developer filters.

### Performance

- The Library initially attaches at most 240 cards and appends blocks of 160 near the scroll boundary.
- Image previews are lazy, asynchronous, and low priority.
- Video/GIF cards never instantiate a video player in the Library and use only an already available static poster when possible.

### Safety

- Reddit expansion remains restricted to rendered comment-loading controls and rejects login, signup, awards, sharing, reporting, saving, following, joining, and voting controls.
- No Reddit/Discord private APIs, tokens, cookies, or Authorization headers are used.
- Review mode still makes no original media request before **Archive selected**.

## 7.1.0 — 2026-08-05

### Added

- Optional VirusTotal integration with locally stored user API keys.
- Hash-first SHA-256 report lookup that avoids uploading files VirusTotal already knows.
- Consent-gated upload mode for unknown files, including the large-file upload flow and a 650 MB hard limit.
- Configurable suspicious/malicious block threshold and unknown/error allow-or-block policy.
- Public-API request serialization, per-hash caching, sanitized diagnostics, and API-key redaction tests.
- Automatic GitHub Release publishing with userscript, Chromium ZIP, Firefox ZIP, and SHA-256 checksums.

### Changed

- Reddit support is now focused exclusively on media rendered inside post-detail comments.
- Reddit comment text is no longer represented as an archive item and `comments.json`, `comments.md`, and `comments.csv` are no longer produced.
- Reddit comment media discovery now covers rendered `img`, `srcset`, `picture`, `video`, `source`, and direct media links.
- Reviewed external media hosts include Imgur, Giphy, Tenor, Streamable, Redgifs, Gfycat, Discord CDN, X/Twitter media, Tumblr media, and additional native Reddit media hosts.
- Reddit canonical keys use media host/path rather than comment ID so repeated memes across comments deduplicate globally.
- Extension background host checks now support reviewed wildcard CDN permissions.
- Runtime contracts now include an isolated external-service request operation used only by the VirusTotal allowlist.

### Safety

- VirusTotal remains disabled by default.
- No original binary is requested before Review mode confirmation.
- VirusTotal scanning occurs after confirmed source download and before ZIP acceptance.
- Uploading unknown files requires explicit current-session consent.
- VirusTotal API keys are never included in diagnostics, generated reports, archive manifests, or service results.

## 7.0.0 — 2026-08-05

### Added

- Three first-class builds from one shared source: universal userscript, Chromium extension, and Firefox extension.
- Runtime contract for binary transport, cancellation, saving, clipboard, settings, platform metadata, and UI control.
- General ArchiveItem model for binary media, rendered comments, and generated documents.
- Quick archive and Review before archive workflows.
- Near-fullscreen Library with grid/list, search, sort, filters, select-all/none/invert, file-manager modifier selection, keyboard navigation, focus trapping, and reduced-motion behavior.
- Collision-safe shared naming presets, advanced templates, live preview, Windows-safe sanitization, and immutable final name plans.
- Structured Activity/Developer diagnostics, stable codes, sanitized copy/Markdown export, and privacy redaction.
- 750 ms live-stat heartbeat with DOM-visible one-second staleness regression coverage.
- Pinterest rendered-media adapter for pin detail, boards, visible profile grids, and pin search results.
- Reddit post-comment-thread adapter with rendered comment media.
- Deterministic extension packaging, generated host permissions, toolbar actions, content/background messaging, and reproducibility checks.
- Sanitized adapter fixtures, unit suites, and Chromium/Firefox Playwright UI tests.

### Changed

- Manual selection is now independent from eligibility. Final archive inclusion is canonical, eligible, and manually selected.
- Final archive names are planned before downloads and reused across preview, retries, manifests, generated documents, workers, and ZIP parts.
- Binary transport is isolated behind runtime bridges; shared modules no longer call Tampermonkey or extension globals directly.
- Activity remains concise while technical detail moves to searchable Developer logs.

### Preserved

- Discord channels/threads, photos/native GIFs, broad video containers, rendered external GIF previews, date ranges, all scan directions, delayed virtual-boundary confirmation, manual stop, completion-position choices, ZIP splitting, optional `fflate`, and the built-in ZIP fallback.

### Security

- No token/cookie/Authorization extraction, no authenticated private API enumeration, no account actions, no third-party linked-page scraping, and no remote executable JavaScript in extension packages.

## 6.0.0 — 2026-08-05

### Changed

- Renamed the product to **Media Archiver** and moved Discord-specific behavior behind a site adapter.
- Split the monolithic userscript into manifest-driven core and adapter source modules.
- Added generated Tampermonkey `@match` and `@connect` metadata from the adapter manifest.
- Reworked the interface into persistent status plus Setup, Media, and Activity tabs.
- Added four scan directions, local-date filtering, review-before-ZIP behavior, final-position restoration, numbered ZIP parts, CSV manifests, retries, bounded concurrency, optional `fflate`, and a built-in ZIP32 fallback.
- Preserved Discord attachment media, native GIFs, broad uploaded-video container support, and rendered external GIF previews.

### Security

- Added runtime URL allowlisting aligned with adapter permissions.
- Added invariant checks rejecting Discord token extraction, authenticated Discord API access, credentials, and site coupling in core modules.
