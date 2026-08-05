# Media Archiver

Media Archiver archives content that supported web applications have already rendered in the browser. Version 7 produces three first-class targets from one shared source tree:

1. universal Tampermonkey userscript;
2. Chromium extension;
3. Firefox extension.

The product and shared UI remain site-neutral. Discord, Pinterest, and Reddit behavior lives in isolated adapters.

## Supported sources

### Discord

Channels and threads, including rendered photos/native GIFs, Discord-hosted videos, and rendered external GIF previews. Existing date ranges, all four scan directions, delayed virtual-boundary confirmation, manual stop, completion-position choices, ZIP splitting, and the built-in ZIP fallback remain available.

### Pinterest

Initial deterministic scope:

- pin detail pages;
- boards;
- visible profile-created/profile-saved grids;
- pin search results.

The personalized home feed is intentionally excluded. The adapter uses only rendered image/video attributes and does not call private Pinterest APIs.

### Reddit comments

Post-detail comment threads only. Home, Popular, subreddit/search feeds, recommendations, and For You surfaces are rejected. Selected rendered comments export as `comments.json`, `comments.md`, and `comments.csv`; rendered media inside comments remains independently selectable.

## Archive modes

### Quick archive

Scans the configured range, merges duplicate rendered representations, and automatically downloads and archives every eligible canonical item.

### Review before archive

Scans and deduplicates first, then opens the near-fullscreen Library. No original binary request occurs before **Archive selected** is confirmed. Closing or cancelling the Library starts nothing. A manually stopped scan can review the partial collection found so far.

The Library provides grid/list views, search, filters, sorting, select-all/none/invert actions, plain-click exclusive selection, checkmark/Ctrl/Cmd additive toggles, Shift ranges, Ctrl/Cmd+Shift additive ranges, Ctrl/Cmd+A, Space, Escape, and arrow-key focus navigation.

## Naming

All final names are planned once over the complete confirmed selection and reused for previews, retries, downloads, manifests, generated comment documents, workers, ZIP parts, and all three targets.

Default output is global six-digit numbering, newest to oldest:

```text
000001.jpg
000002.jpeg
000003.png
```

The old ambiguous duplicate-stem output (`000001.jpg`, `000001.jpeg`, `000001.png`) is permanently forbidden and tested. Other presets include source date/time, source + date + number, original + number, and a safe advanced token template.

## Diagnostics and live statistics

Active foreground work uses a 750 ms lightweight metrics heartbeat. DOM-visible Found, Eligible, Selected, Downloaded, Saved, Errors, bytes, item/ZIP progress, and elapsed time are refreshed without rebuilding the Library or reloading thumbnails. Phase completion and visibility return perform exact flushes.

Activity remains concise. **Copy**, **Download .md**, **Developer logs**, and **Clear** use a structured event store. Sanitized reports redact signed parameters, credentials, private text, source labels, local paths, and unnecessary extension IDs by default.

## Install

### Userscript

1. Install Tampermonkey in a current Firefox- or Chromium-based browser.
2. Open `media-archiver.user.js` in this repository.
3. Choose **Raw** and confirm installation.

### Chromium extension

1. Build with `npm run build:extension:chromium` or download the CI artifact.
2. Extract `dist/media-archiver-chromium-7.0.0.zip`.
3. Open the browser extension page, enable Developer mode, choose **Load unpacked**, and select the extracted directory.

### Firefox extension

1. Build with `npm run build:extension:firefox` or download the CI artifact.
2. For temporary development installation, open `about:debugging`, choose **This Firefox**, then **Load Temporary Add-on** and select the extracted `manifest.json`.
3. Permanent distribution requires normal Firefox add-on signing.

## Build and test

```bash
npm install --ignore-scripts
npm test
npm run test:ui
```

`npm test` builds and validates the userscript and both extension packages, runs unit/fixture tests, checks generated permissions, rejects remote executable JavaScript, and verifies reproducible extension ZIPs. Playwright runs the Review request gate and twelve-second DOM-visible live-stat regression in Chromium and Firefox.

Generated outputs:

```text
media-archiver.user.js
dist/media-archiver-chromium-7.0.0.zip
dist/media-archiver-firefox-7.0.0.zip
```

## Safety

Media Archiver never extracts tokens, cookies, credentials, or Authorization headers; never enumerates content through undocumented authenticated APIs; never votes, posts, reacts, follows, joins, or messages; and never scrapes linked third-party pages. Every download URL must pass both generated build permissions and the active adapter runtime allowlist. See `SECURITY.md`.
