# Media Archiver

Media Archiver is a modular Tampermonkey userscript for collecting media that a supported web application has already rendered in the browser and saving the selected files as numbered ZIP parts.

The product name and core are site-neutral. Site behavior is supplied by adapters. The first included adapter supports Discord channels and threads; additional sites can be added without rebuilding the scanner, archive engine, or interface.

## Highlights

- Compact tabbed interface with related controls grouped under **Setup**, **Media**, and **Activity**
- Photos, native GIF files, videos, and rendered animated previews
- Optional inclusive local-date filtering
- Four scan directions for virtualized timelines
- Automatic ZIP creation or review-before-archive workflow
- Numbered ZIP parts with CSV manifests
- Fast `fflate` ZIP path plus a dependency-free ZIP32 fallback
- Adapter registry with generated Tampermonkey `@match` and `@connect` metadata
- No user-token extraction and no authenticated internal API calls

## Install

1. Install Tampermonkey in a current Firefox- or Chromium-based browser.
2. Open [`media-archiver.user.js`](./media-archiver.user.js).
3. Choose **Raw** and confirm the Tampermonkey installation prompt.
4. Open a page supported by an installed adapter. For the included Discord adapter, open a text channel or thread.
5. Open the Media Archiver panel, configure the scan, and start.

Because this repository is private, GitHub must be signed in when the raw userscript is opened.

## Interface

### Setup

Controls are grouped by purpose:

- **What to save** — media categories
- **Date range** — optional source-date limits
- **Scan behavior** — direction, starting point, and final page position
- **Create ZIPs after scanning** — automatic archive creation or review-first mode

### Media

Shows collected entries, detailed type and filter counters, download state, file size, timestamp, and archive status.

### Activity

Contains only operational messages for the current session. Release notes and changelog content are intentionally kept out of the runtime interface.

## Current adapter: Discord

The included adapter detects media rendered in Discord channels and threads:

- attachment images and native GIF files
- Discord-hosted video attachments
- animated external GIF previews rendered through Discord proxy hosts

It works from the visible web interface and scrolls Discord's virtualized message timeline. It does not request a Discord token or call authenticated internal Discord APIs.

## Build and validate

```bash
npm test
```

This command:

1. reads `src/build-manifest.json`
2. reads all adapters from `src/adapters/manifest.json`
3. generates Tampermonkey host metadata from the adapter manifest
4. assembles `media-archiver.user.js`
5. checks JavaScript syntax and project invariants

## Source layout

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

The generated root file is a release artifact. Make source changes in `src/core/` or `src/adapters/`, then run `npm test`.

See [`docs/ADAPTERS.md`](./docs/ADAPTERS.md) for the adapter contract and extension process.

## Safety and use

Use this tool only for media you are authorized to access and save. Each adapter must restrict downloads to explicitly declared hosts and must operate on content already available to the signed-in browser page. See [`SECURITY.md`](./SECURITY.md).
