# Architecture

## Build model

`scripts/assemble-userscript.mjs` reads two manifests:

- `src/build-manifest.json` defines core module order and the generated output.
- `src/adapters/manifest.json` defines ordered adapter modules, URL matches, and allowed connection hosts.

The build injects adapter-derived Tampermonkey metadata and concatenates the modules without transpilation into `media-archiver.user.js`.

## Runtime layers

### Bootstrap and adapter registry

`00-bootstrap` defines shared constants, state, entry storage, and the adapter registry. Each adapter registers itself. `10-activate-adapter` selects the first adapter whose `matches(location)` method succeeds and stops before UI injection when no adapter supports the page.

### Site adapter

An adapter translates a site's rendered page into the shared model. It owns:

- page matching and terminology
- media discovery and URL normalization
- item ID and timestamp extraction
- scroller and virtual-timeline discovery
- visible item IDs and date range
- anchor capture and item restoration
- archive context
- runtime download allowlisting

The core must not branch on hostnames or import site selectors.

### Selection

The selection module sorts entries newest-first and applies media-type and inclusive local-date filters. Counters distinguish total discovered, date-eligible, type-excluded, selected, saved, and failed entries.

### Scanner

The scanner operates only through adapter-facing wrappers. It moves a generic virtual timeline in overlapping steps, scans before and after movement, waits at possible boundaries, supports date-boundary early exits, and restores the selected final position.

### Archive

The archive layer downloads with `GM_xmlhttpRequest`, bounded concurrency, retries, and adapter URL validation. It produces numbered ZIP parts and CSV manifests. `fflate` is optional; the built-in ZIP32 STORE writer is mandatory.

### Workflow

The workflow module coordinates scan, stop, review-first, ZIP creation, reset, progress, logs, and counters.

### UI

The UI is a site-neutral panel with a persistent status area, Setup/Media/Activity tabs, and a stable action footer. The active adapter appears only as a context badge. Release notes do not appear in the panel.

## Entry model

Each Map entry contains:

- canonical key
- download and preview URLs
- filename and media type
- adapter-defined source kind and optional source page
- item ID and timestamp
- discovery order
- processing state, error, size, and ZIP part

## Security boundary

Tampermonkey metadata and runtime URL validation are both generated from or aligned with the adapter manifest. An adapter cannot download from an undeclared host merely by returning a URL.
