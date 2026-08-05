# Current state audit

Audited branch: `main`  
Audited commit: `d513b259d7d6a08d0e5cb94a2d3a7155c83636b8`  
Audit date: 2026-08-05

## Executive summary

Media Archiver is currently a well-separated, adapter-driven Tampermonkey userscript. The site-neutral core, the Discord adapter, generated host permissions, ZIP fallback, and CI invariants are already strong foundations.

The next requested phase cannot be implemented cleanly by adding only more selectors. A browser extension target, a large interactive media picker, Pinterest support, and Reddit comment export require two additional architecture layers:

1. a runtime bridge that separates the core from Tampermonkey-only APIs;
2. a generalized archive-item model that can represent both binary media and structured text records.

## How the repository currently builds

The build is manifest-driven and performs no transpilation.

- `src/build-manifest.json` defines the ordered core modules and output filename.
- `src/adapters/manifest.json` defines adapter modules, userscript `@match` patterns, and allowed connection hosts.
- `scripts/assemble-userscript.mjs` injects generated Tampermonkey metadata and concatenates all modules into `media-archiver.user.js`.
- The generated root userscript is a release artifact; source changes belong in `src/core/` or `src/adapters/`.

Current output:

- product: **Media Archiver**
- version: `6.0.0`
- runtime target: Tampermonkey
- installed site adapters: Discord only

## Current runtime flow

1. `00-bootstrap` creates shared constants, state, the media-entry Map, and the adapter registry.
2. Adapter modules register themselves.
3. `10-activate-adapter` resolves the first adapter matching the current page and stops on unsupported pages.
4. The active adapter discovers rendered media and exposes timeline operations.
5. Core filtering applies media-type and local-date eligibility.
6. The scanner moves through a virtual timeline in overlapping steps and confirms asynchronous boundaries.
7. The archive workflow downloads selected entries with bounded concurrency, creates numbered ZIP parts, and writes CSV manifests.
8. The UI exposes Setup, Media, and Activity tabs with a persistent status card and action footer.

## Current source layout

```text
src/
├── build-manifest.json
├── adapters/
│   ├── manifest.json
│   └── discord/
│       ├── 00-config.user.js.part
│       ├── 10-embeds.user.js.part
│       ├── 20-items.user.js.part
│       ├── 30-timeline.user.js.part
│       └── 90-register.user.js.part
└── core/
    ├── 00-bootstrap.user.js.part
    ├── 10-activate-adapter.user.js.part
    ├── 20-selection.user.js.part
    ├── 30-scanner-position.user.js.part
    ├── 31-scanner-boundaries.user.js.part
    ├── 40-download-manifest.user.js.part
    ├── 41-zip-engine.user.js.part
    ├── 42-archive-workflow.user.js.part
    ├── 50-workflow.user.js.part
    ├── 60-ui-markup.user.js.part
    ├── 61-ui-style.user.js.part
    └── 62-ui-bindings.user.js.part
```

## What is already strong

### Adapter boundary

Discord selectors, hostnames, snowflake timestamps, URL normalization, timeline discovery, and archive context are contained in the Discord adapter. The core validation explicitly rejects Discord coupling in core modules.

### Safety boundary

The project does not extract account tokens or use authenticated internal APIs. Manifest host permissions are paired with runtime URL allowlisting.

### Virtual timeline behavior

The scanner supports overlapping movement, delayed boundary confirmation, date-boundary exits, stop handling, and final-position restoration.

### Archive reliability

The archive path includes retries, bounded concurrency, size-based ZIP splitting, continuous newest-to-oldest numbering, CSV manifests, optional `fflate`, and a built-in ZIP32 fallback.

### Existing UI separation

Setup, Media, and Activity are already separated. Changelog content is intentionally absent from the runtime interface.

### CI

`npm test` currently builds the userscript, checks syntax, validates project invariants, and verifies unsupported-page behavior. The latest `main` validation and publishing workflows completed successfully at the audited commit.

## Gaps relative to the requested roadmap

### 1. No browser-extension runtime

The source begins as one userscript metadata header plus one global IIFE. Core code directly depends on:

- `GM_xmlhttpRequest`;
- userscript `@require`, `@grant`, `@match`, and `@connect` metadata;
- direct page-DOM injection;
- browser-anchor ZIP downloads.

This is suitable for Tampermonkey but is not yet a reusable extension architecture.

### 2. “Selected” currently means filter-eligible

There is no independent per-item manual selection state. `selectedMediaEntries()` is currently the result of media-type and date filters only.

Missing file-manager behavior:

- click selection;
- Ctrl/Cmd additive toggle;
- Shift range selection;
- select all, none, and invert;
- a persistent selection anchor;
- a grid/library modal;
- selection-aware bulk archive actions.

### 3. The entry model is media-only

The shared Map represents downloadable binary media. Reddit comment export requires structured text records with hierarchy and metadata. Comments should not be disguised as media entries.

### 4. Adapter capabilities are implicit

The current UI assumes every adapter can expose a virtual timeline and meaningful timestamps. Pinterest pages and Reddit comment threads may support different scan modes, date semantics, item kinds, and archive formats. Capabilities need to be explicit so unavailable controls can be hidden or disabled.

### 5. Tests are mostly build and invariant checks

The current tests are valuable but do not yet exercise:

- DOM fixtures for each adapter;
- manual selection reducers and keyboard shortcuts;
- modal grid/list behavior;
- Pinterest discovery;
- Reddit comment-tree export;
- extension manifests and runtime bridges;
- cross-browser extension packaging.

### 6. No Pinterest or Reddit adapter is present on `main`

The current adapter manifest contains only Discord. Pinterest and Reddit work must start as new adapter implementations and fixture sets.

## Recommended target architecture

```text
src/
├── shared/
│   ├── domain/
│   ├── selection/
│   ├── scanner/
│   ├── archive/
│   └── ui/
├── runtimes/
│   ├── userscript/
│   └── extension/
├── adapters/
│   ├── discord/
│   ├── pinterest/
│   └── reddit-comments/
└── manifests/
    ├── product.json
    └── adapters.json

extension/
├── chromium/
├── firefox/
└── assets/
```

The exact migration can remain incremental, but the end state should have one shared domain/selection/scanner/archive/UI implementation and thin runtime-specific bridges.

## Required new abstractions

### Runtime bridge

The core should call a runtime interface instead of Tampermonkey globals directly.

Suggested responsibilities:

```js
runtime.fetchBinary(url, options)
runtime.abortAllRequests()
runtime.saveBlob(blob, filename)
runtime.getSetting(key, fallback)
runtime.setSetting(key, value)
runtime.getPlatformInfo()
```

The userscript bridge can use `GM_xmlhttpRequest`; the extension bridge can use extension messaging/background permissions.

### Archive item model

Introduce an item kind separate from media type.

```js
{
    key,
    kind: 'media' | 'comment-export',
    sourceId,
    timestamp,
    adapterId,
    eligible,
    manuallySelected,
    status,
    payload
}
```

Media payloads keep the current URL, preview, filename, and media type. Comment payloads hold structured comment metadata and text.

### Adapter capabilities

Suggested capability flags:

```js
capabilities: {
    virtualTimeline: true,
    dateFilter: true,
    media: true,
    textRecords: false,
    supportedScanModes: [...],
    supportedViews: ['grid', 'list']
}
```

The core UI should derive available controls from these flags.

## Immediate conclusion

The repository is healthy and currently passing CI. The correct next step is not to replace the existing userscript. It is to extract shared behavior behind runtime and item-model interfaces while keeping the userscript working after every milestone. The detailed staged plan is in `docs/IMPLEMENTATION_PLAN.md`.
