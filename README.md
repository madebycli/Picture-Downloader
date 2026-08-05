# Media Archiver

Media Archiver archives media that supported web applications have already rendered in the browser. Version 7.2 produces three targets from one shared source tree:

1. universal Tampermonkey userscript;
2. Chromium extension;
3. Firefox extension.

The shared Review Library, naming, ZIP creation, diagnostics, and optional VirusTotal checks remain site-neutral. Discord, Pinterest, and Reddit navigation behavior lives in isolated adapters.

## Download

Open the repository **Releases** tab and download one of these files:

```text
media-archiver.user.js
media-archiver-chromium-7.2.0.zip
media-archiver-firefox-7.2.0.zip
SHA256SUMS.txt
```

After a validated merge to `main`, the publish workflow creates or refreshes release `v7.2.0` automatically.

## Supported sources

### Discord

Channels and threads, including rendered photos/native GIFs, Discord-hosted videos, and rendered external GIF previews. Date ranges, all four scan directions, manual stop, final-position choices, ZIP splitting, and the built-in ZIP fallback remain available.

Discord scanning now uses a loaded-edge jump strategy. Instead of moving about one viewport at a time, Media Archiver repeatedly jumps to the currently loaded virtual edge, waits for Discord to prepend or append its next chunk, and scans again. Each jump records the previous edge message ID. When Discord virtualizes that anchor away, Media Archiver performs a recovery step into the overlap and rescans before returning to the edge. Canonical URL keys continue to merge duplicate discoveries.

A date range still controls the stopping boundary. The scanner gets to that boundary using the same fast jump passes rather than changing the selected scan direction.

### Pinterest

Deterministic scope:

- pin detail pages;
- boards;
- visible profile-created/profile-saved grids;
- pin search results.

The personalized home feed is excluded. The adapter uses only rendered image/video attributes and does not call private Pinterest APIs.

### Reddit comment media

Only post-detail comment threads under `/r/<subreddit>/comments/<post>/...` are supported. Home, Popular, subreddit/search feeds, recommendations, and For You surfaces are rejected.

Comments are used only as rendered containers and navigation anchors. **Comment text is not exported.** Reddit date filtering is disabled because the goal is to collect the complete media conversation rather than mix parent-comment and reply dates.

The Reddit scan moves downward through the thread and activates visible rendered controls such as **View more comments**, **Load more comments**, **More replies**, and **Continue this thread**. Activation is DOM-only, rate-limited, and restricted to the comment area. Login, voting, posting, joining, following, reporting, and other account controls are excluded.

Collected media includes:

- photos and native GIF files;
- animated GIF previews;
- Reddit-hosted videos;
- rendered external images, GIFs, and videos from reviewed media CDNs such as Imgur, Giphy, Tenor, Streamable, Redgifs, Discord CDN, X/Twitter media, and Tumblr media.

Repeated media is merged by canonical media host/path, even when the same meme appears in multiple comments.

## Archive modes

### Quick archive

Scans the configured scope, merges duplicate rendered representations, and downloads every eligible canonical item.

### Review before archive

Scans and deduplicates first, then opens the Library. No original binary request occurs before **Archive selected** is confirmed. Closing or cancelling starts nothing. A manually stopped scan can review the partial collection found so far.

A normal card or checkmark click now always toggles that item: selected → deselected → selected. Shift still selects a range; Ctrl/Cmd+Shift adds a range. Ctrl/Cmd+A, Space, Escape, and arrow-key navigation remain supported.

## Large Review Libraries

The Library uses fixed card heights and its own vertical scrollbar. It does not compress hundreds of cards into the available viewport.

For large collections it initially creates at most 240 cards and appends blocks of 160 near the scroll boundary. Selection state still covers the complete filtered collection, including cards not currently attached to the DOM. Images use lazy, asynchronous, low-priority previews. Video and rendered-GIF cards do not create a video player; they display an icon and only use an already available static image poster.

## Optional VirusTotal checks

VirusTotal is disabled by default and requires the user's own API key.

- **Off** — no hash or file is sent.
- **SHA-256 report lookup only** — computes the hash locally and checks for an existing report; unknown files are not uploaded.
- **Lookup, then upload unknown files** — uploads only after explicit current-session consent.

The check occurs after Review confirmation and original-file download, but before ZIP acceptance. Malicious results are blocked; suspicious and unknown/error handling are configurable. Standard VirusTotal uploads may be shared with security partners, and public API limits can make large selections significantly slower.

## Naming

All final names are planned once over the complete confirmed selection and reused for previews, retries, downloads, workers, manifests, and ZIP parts.

Default output is global six-digit numbering, newest to oldest:

```text
000001.jpg
000002.jpeg
000003.png
```

The ambiguous duplicate-stem output (`000001.jpg`, `000001.jpeg`, `000001.png`) is forbidden and tested.

## Install

### Tampermonkey userscript

1. Install Tampermonkey in a current Firefox- or Chromium-based browser.
2. Download `media-archiver.user.js` from GitHub Releases.
3. Open the file and confirm installation.

### Chromium extension

1. Download and extract `media-archiver-chromium-7.2.0.zip`.
2. Open the browser extension page and enable Developer mode.
3. Choose **Load unpacked** and select the extracted directory.

### Firefox extension

1. Download and extract `media-archiver-firefox-7.2.0.zip`.
2. Open `about:debugging` → **This Firefox** → **Load Temporary Add-on**.
3. Select the extracted `manifest.json`.

Permanent Firefox distribution still requires normal add-on signing.

## Build and test

```bash
npm install --ignore-scripts
npm test
npm run test:ui
```

`npm test` validates the userscript and both extension packages, unsupported pages, permissions, reproducible ZIPs, selection, jump-scanner invariants, Reddit expansion restrictions, and VirusTotal behavior. Playwright covers the Review request gate, click toggling, keyboard behavior, a synthetic 1,100-item Library, compact Developer filters, and live metrics in Chromium and Firefox.

Generated outputs:

```text
media-archiver.user.js
dist/media-archiver-chromium-7.2.0.zip
dist/media-archiver-firefox-7.2.0.zip
```

## Validation limits

Automated fixtures can prove the control flow, overlap recovery, DOM restrictions, deduplication, and large-Library behavior. They cannot prove how a future Discord or Reddit production DOM will virtualize every real channel/thread. A sanitized HTML capture or dedicated test channel remains the strongest live regression evidence.

## Safety

Media Archiver never extracts tokens, cookies, account credentials, or Authorization headers; never enumerates site content through undocumented authenticated APIs; and never votes, posts, reacts, follows, joins, or messages. Every media URL must pass generated permissions plus the active adapter runtime allowlist. See `SECURITY.md`.
