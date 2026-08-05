# Media Archiver

Media Archiver archives media that supported web applications have already rendered in the browser. Version 7.1 produces three first-class targets from one shared source tree:

1. universal Tampermonkey userscript;
2. Chromium extension;
3. Firefox extension.

The shared scanner, Review Library, naming, ZIP creation, diagnostics, and optional VirusTotal checks are site-neutral. Discord, Pinterest, and Reddit behavior lives in isolated adapters.

## Download

Open the repository **Releases** tab and download one of these files:

```text
media-archiver.user.js
media-archiver-chromium-7.1.0.zip
media-archiver-firefox-7.1.0.zip
SHA256SUMS.txt
```

The main-branch publish workflow validates all targets, creates tag `v7.1.0`, and creates or refreshes the GitHub Release automatically.

## Supported sources

### Discord

Channels and threads, including rendered photos/native GIFs, Discord-hosted videos, and rendered external GIF previews. Existing date ranges, all four scan directions, delayed virtual-boundary confirmation, manual stop, completion-position choices, ZIP splitting, and the built-in ZIP fallback remain available.

### Pinterest

Deterministic scope:

- pin detail pages;
- boards;
- visible profile-created/profile-saved grids;
- pin search results.

The personalized home feed is intentionally excluded. The adapter uses only rendered image/video attributes and does not call private Pinterest APIs.

### Reddit comment media

Only post-detail comment threads under `/r/<subreddit>/comments/<post>/...` are supported. Home, Popular, subreddit/search feeds, recommendations, and For You surfaces are rejected.

Comments are used only as rendered containers and timeline anchors. **Comment text is not exported.** The adapter collects independently selectable media rendered inside comments:

- photos and native GIF files;
- animated GIF previews;
- Reddit-hosted videos;
- rendered external images, GIFs, and videos from reviewed media CDNs such as Imgur, Giphy, Tenor, Streamable, Redgifs, Discord CDN, X/Twitter media, and Tumblr media.

Masonry/re-render duplicates are merged by canonical media host and path, even when the same meme appears in more than one comment.

## Archive modes

### Quick archive

Scans the configured range, merges duplicate rendered representations, and automatically downloads and archives every eligible canonical item.

### Review before archive

Scans and deduplicates first, then opens the near-fullscreen Library. No original binary request occurs before **Archive selected** is confirmed. Closing or cancelling the Library starts nothing. A manually stopped scan can review the partial collection found so far.

The Library provides grid/list views, search, filters, sorting, select-all/none/invert actions, plain-click exclusive selection, checkmark/Ctrl/Cmd additive toggles, Shift ranges, Ctrl/Cmd+Shift additive ranges, Ctrl/Cmd+A, Space, Escape, and arrow-key focus navigation.

## Optional VirusTotal checks

VirusTotal is disabled by default and requires the user's own API key.

Available modes:

- **Off** — no hash or file is sent.
- **SHA-256 report lookup only** — computes the file hash locally and checks whether VirusTotal already has a report. Unknown files are not uploaded.
- **Lookup, then upload unknown files** — unknown files are uploaded only after the current-session consent checkbox is selected.

The check occurs after the user confirms Review mode and after the original file is downloaded, but before that file is accepted into a ZIP. Malicious results are blocked; suspicious and unknown/error handling are configurable.

Important privacy and quota notes:

- standard VirusTotal uploads may be shared with security partners;
- the public API is rate-limited, so large selections can take substantially longer;
- uploads larger than 32 MB use VirusTotal's large-file upload URL;
- files larger than 650 MB cannot be uploaded through this integration;
- the API key is stored only in the current browser profile and is never written to diagnostics, reports, or ZIP manifests.

## Naming

All final names are planned once over the complete confirmed selection and reused for previews, retries, downloads, workers, manifests, and ZIP parts.

Default output is global six-digit numbering, newest to oldest:

```text
000001.jpg
000002.jpeg
000003.png
```

The old ambiguous duplicate-stem output (`000001.jpg`, `000001.jpeg`, `000001.png`) is permanently forbidden and tested. Other presets include source date/time, source + date + number, original + number, and a safe advanced token template.

## Install

### Tampermonkey userscript

1. Install Tampermonkey in a current Firefox- or Chromium-based browser.
2. Download `media-archiver.user.js` from GitHub Releases.
3. Open the file and confirm installation.

### Chromium extension

1. Download and extract `media-archiver-chromium-7.1.0.zip`.
2. Open the browser extension page.
3. Enable Developer mode.
4. Choose **Load unpacked** and select the extracted directory.

### Firefox extension

1. Download and extract `media-archiver-firefox-7.1.0.zip`.
2. Open `about:debugging` → **This Firefox** → **Load Temporary Add-on**.
3. Select the extracted `manifest.json`.

Permanent Firefox distribution still requires normal add-on signing.

## Build and test

```bash
npm install --ignore-scripts
npm test
npm run test:ui
```

`npm test` builds and validates the userscript and both extension packages, runs unit/fixture tests, checks generated permissions, rejects remote executable JavaScript, verifies VirusTotal consent/hash/upload behavior, and checks reproducible extension ZIPs. Playwright runs the Review request gate and twelve-second DOM-visible live-stat regression in Chromium and Firefox.

Generated outputs:

```text
media-archiver.user.js
dist/media-archiver-chromium-7.1.0.zip
dist/media-archiver-firefox-7.1.0.zip
```

## Safety

Media Archiver never extracts tokens, cookies, account credentials, or Authorization headers; never enumerates site content through undocumented authenticated APIs; never votes, posts, reacts, follows, joins, or messages; and never scrapes arbitrary linked pages. Every media URL must pass generated permissions plus the active adapter runtime allowlist. VirusTotal is a separate opt-in service boundary with its own explicit host allowlist and consent controls. See `SECURITY.md`.
