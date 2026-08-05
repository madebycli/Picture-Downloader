# Changelog

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
- Reddit post-comment-thread adapter with selected-only JSON/Markdown/CSV export and independent rendered comment media.
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
