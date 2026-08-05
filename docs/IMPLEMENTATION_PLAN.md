# Implementation plan: extension, Pinterest, Reddit comments, and media picker

Status: approved planning baseline  
Created: 2026-08-05  
Related audit: [`CURRENT_STATE_AUDIT.md`](./CURRENT_STATE_AUDIT.md)

## Goal

Evolve Media Archiver from one modular Tampermonkey build into a shared archiving product with:

1. the existing userscript kept working;
2. installable Chromium and Firefox extension builds;
3. a Pinterest adapter;
4. a Reddit comment-thread adapter focused on comments, not Reddit home or recommendation feeds;
5. a full media-library picker with file-manager selection behavior;
6. one shared core, UI, adapter model, and test suite across all runtime targets.

## Product principles

- The product remains named **Media Archiver** and stays site-neutral.
- Site names appear only as active-adapter context.
- The userscript remains a supported first-class target.
- The extension is an additional target, not a replacement.
- Only content already rendered or explicitly loaded by the signed-in browser page may be collected.
- No token extraction, cookie harvesting, authorization-header construction, or undocumented authenticated API enumeration.
- Host permissions and runtime URL validation remain minimal and adapter-owned.
- Changelog and release-note content remain outside the runtime UI.
- Firefox and Chromium remain supported.

## Scope decisions

### Pinterest initial scope

Implement rendered media collection for deterministic Pinterest surfaces first:

- pin detail pages;
- boards;
- profile-created and profile-saved grids where visible;
- search result grids.

The personalized home feed can be added only after the deterministic surfaces pass regression testing. The adapter must collect rendered image/video sources and must not call private Pinterest APIs.

### Reddit initial scope

Support Reddit post-detail comment threads only. Do not activate on home, popular, subreddit feed, recommendation, or “For You” pages.

The Reddit adapter should export:

- rendered comment text;
- comment hierarchy;
- author as rendered;
- timestamp as rendered;
- visible score when available;
- comment ID and parent ID when derivable from the DOM;
- permalink when rendered or derivable without an authenticated API;
- media rendered inside comments as normal media items.

Default text outputs for selected comments:

- `comments.json` for complete structured data;
- `comments.md` for readable nested output;
- `comments.csv` for spreadsheet use.

Only comments present in the DOM are collected. Expanding “more replies” may be offered later as an explicit opt-in DOM interaction; it must never vote, post, follow, join, or mutate the account.

### Manual selection behavior

The existing behavior is preserved by default: every entry that passes type/date filters starts selected.

Manual selection is then independent of filters:

- eligibility answers “may this item be archived?”;
- manual selection answers “does the user want this eligible item now?”;
- final archive inclusion is `eligible && manuallySelected`.

Standard file-manager shortcuts:

- plain card click: select only that item and set the range anchor;
- checkbox/checkmark click: toggle that item without clearing others;
- Ctrl+click on Windows/Linux: toggle one item additively;
- Cmd+click on macOS: toggle one item additively;
- Shift+click: select a contiguous range from the last anchor to the clicked item;
- Ctrl/Cmd+Shift+click: add a contiguous range without clearing the previous selection;
- Ctrl/Cmd+A: select all currently eligible items in the current view;
- Escape: close the library modal;
- Space: toggle the focused item;
- arrow keys: move keyboard focus through the grid/list.

`Alt` is intentionally not assigned because browsers and operating systems commonly reserve it.

## Target architecture

### Shared product source

```text
src/
├── shared/
│   ├── domain/
│   │   ├── archive-item.js
│   │   ├── media-item.js
│   │   └── comment-record.js
│   ├── adapters/
│   │   ├── registry.js
│   │   ├── contract.js
│   │   └── capabilities.js
│   ├── selection/
│   │   ├── selection-store.js
│   │   ├── range-selection.js
│   │   └── filters.js
│   ├── scanner/
│   ├── archive/
│   ├── runtime/
│   │   └── contract.js
│   └── ui/
│       ├── launcher/
│       ├── library-modal/
│       ├── cards/
│       └── styles/
├── runtimes/
│   ├── userscript/
│   │   ├── transport.js
│   │   ├── storage.js
│   │   └── entry.js
│   └── extension/
│       ├── content-entry.js
│       ├── background-entry.js
│       ├── transport.js
│       ├── storage.js
│       └── messaging.js
├── adapters/
│   ├── discord/
│   ├── pinterest/
│   └── reddit-comments/
└── manifests/
    ├── product.json
    └── adapters.json

extension/
├── manifest.base.json
├── manifest.chromium.json
├── manifest.firefox.json
└── assets/
```

The migration may be incremental, but the final shared modules must not depend directly on Tampermonkey or extension globals.

### Runtime contract

Introduce one runtime interface consumed by shared code:

```js
runtime.fetchBinary(url, options)
runtime.abortRequest(requestId)
runtime.abortAllRequests()
runtime.saveBlob(blob, filename)
runtime.getSetting(key, fallback)
runtime.setSetting(key, value)
runtime.getPlatformInfo()
runtime.openUi()
runtime.closeUi()
```

Userscript implementation:

- `GM_xmlhttpRequest` for cross-origin binary fetches;
- Blob URL plus anchor download for ZIP output;
- current page DOM for UI mounting.

Extension implementation:

- content script for adapter discovery, scanning, and the shared overlay;
- background runtime for cross-origin fetch permission and request cancellation;
- extension storage for settings;
- toolbar action to open/focus the library;
- separate generated manifests for Chromium and Firefox when permissions or background declarations differ.

A proof-of-concept must test large binary transfers before finalizing whether ZIP creation runs in the content script, a background context, or a dedicated extension document.

### Adapter capability contract

Extend every adapter registration with explicit capabilities:

```js
capabilities: {
    media: true,
    textRecords: false,
    virtualTimeline: true,
    dateFilter: true,
    scanModes: [
        'end-to-start',
        'current-to-start',
        'current-to-end',
        'full'
    ],
    views: ['grid', 'list']
}
```

The UI must show only meaningful controls for the active adapter.

Examples:

- Discord: media, virtual timeline, dates, all current scan modes.
- Pinterest: media, virtual feed/grid, dates only if reliable timestamps exist.
- Reddit comments: text records plus comment media, comment-tree scanning, comment-specific export options.

### Generalized archive item

Do not force Reddit comments into the existing media model.

```js
{
    key,
    kind: 'media' | 'comment',
    adapterId,
    sourceId,
    parentSourceId,
    timestamp,
    discoveryIndex,
    eligibility: {
        type: true,
        date: true,
        adapter: true
    },
    manuallySelected: true,
    status: 'collected' | 'fetching' | 'packed' | 'error',
    payload
}
```

Media payload:

```js
{
    url,
    previewUrl,
    filename,
    mediaType,
    sourceKind,
    sourcePageUrl,
    size
}
```

Comment payload:

```js
{
    author,
    bodyText,
    bodyHtmlSanitized,
    depth,
    scoreText,
    permalink
}
```

The archive pipeline uses handlers by item kind:

- media handler downloads original binary files;
- comment handler generates JSON, Markdown, and CSV documents;
- mixed archives can contain both generated comment documents and media files.

## UI redesign

### Two-level interface

Keep a compact floating launcher/status panel for:

- current site;
- scan state;
- progress;
- selected count;
- Start/Stop;
- an **Open library** button.

Open a large centered modal for review and selection.

### Library modal structure

```text
┌──────────────────────────────────────────────────────────────┐
│ Media Archiver · active site · search · filters · view      │
├───────────────┬──────────────────────────────────────────────┤
│ filter rail   │ grid/list of collected items                │
│ types         │                                              │
│ dates         │ cards with preview, metadata, state         │
│ source        │                                              │
├───────────────┴──────────────────────────────────────────────┤
│ selected count · select all/none/invert · archive selected  │
└──────────────────────────────────────────────────────────────┘
```

Required controls:

- grid/list toggle;
- search by filename, author, or source metadata;
- sort newest/oldest, discovery order, filename, and type;
- filter by item kind, media type, source kind, date eligibility, and status;
- select all visible;
- select all eligible;
- select none;
- invert current view;
- archive selected;
- close modal.

### Card selection visuals

Selected cards use a deliberate red accent without becoming unreadable:

- red outer ring;
- translucent red overlay;
- animated check badge entering from the corner;
- subtle lift/scale and shadow;
- a short border sweep or glow animation;
- clear focus ring independent of selected state;
- no animation when `prefers-reduced-motion: reduce` is active.

Do not mark or alter media directly inside the supported website. Selection highlighting exists only inside the Media Archiver library.

### Large collection performance

The modal must remain usable with thousands of entries.

Minimum requirements:

- stable keyed rendering;
- batched state updates;
- lazy thumbnail loading;
- no complete image/video decoding during every render;
- `content-visibility` or list/grid virtualization;
- selection stored outside DOM nodes;
- no full-list rebuild for one selection toggle.

For videos, show a lightweight poster or type tile by default. Optional hover preview must be muted and resource-limited.

### Accessibility

- modal dialog semantics and focus trap;
- Escape closes the modal;
- keyboard-reachable cards and controls;
- meaningful labels and live selected-count updates;
- selection cannot rely on red color alone;
- visible focus indicators;
- reduced-motion support.

## Milestones

## Phase 0 — fixtures and acceptance baselines

Tasks:

- record the current userscript output hash and smoke behavior;
- create sanitized minimal Discord fixture fragments;
- capture sanitized Pinterest board/search/pin fixtures;
- capture sanitized Reddit post-comment-thread fixtures;
- write expected discovery results for every fixture;
- document current browser behavior before refactoring.

Do not commit full personal browsing snapshots. Reduce fixtures to the smallest DOM fragments needed by adapter tests and remove account names, server names, private content, tokens, and unrelated scripts.

Acceptance criteria:

- fixtures contain no credentials or private identifying content;
- current Discord discovery expectations are reproducible;
- `npm test` still passes before architecture changes.

## Phase 1 — shared runtime and domain extraction

Tasks:

- introduce runtime and storage interfaces;
- move direct `GM_xmlhttpRequest` use into the userscript runtime;
- move Blob save behavior into the runtime;
- introduce the generalized archive-item model;
- introduce explicit adapter capabilities;
- keep compatibility wrappers while modules migrate;
- add unit tests for adapter resolution, eligibility, and runtime host validation.

Acceptance criteria:

- the userscript behaves as before;
- shared modules contain no `GM_*`, `chrome.*`, or `browser.*` calls;
- Discord remains the only active production adapter during this phase;
- `npm test` passes;
- current userscript metadata remains generated from the adapter manifest.

## Phase 2 — independent selection store and library modal

Tasks:

- add `manuallySelected` state or a dedicated selected-key Set;
- separate eligibility statistics from manual-selection statistics;
- implement range-selection reducer;
- implement click, Ctrl/Cmd, Shift, Ctrl/Cmd+Shift, and Ctrl/Cmd+A behavior;
- add select all, none, and invert commands;
- create the centered library modal;
- implement grid/list views;
- add red selected-card animation and reduced-motion alternative;
- move the existing detailed media rows into reusable item-card/list components;
- change archive creation to consume final manual selection.

Acceptance criteria:

- all currently eligible entries start selected, preserving current output;
- manually deselected entries never enter ZIP output;
- changing a filter does not silently erase explicit selection state;
- Shift range follows current sorted/filtered view order;
- selection remains correct after re-render, adapter rescans, and virtualized modal rendering;
- 2,000 synthetic entries remain interactively selectable;
- keyboard-only selection works.

## Phase 3 — browser extension target

Tasks:

- add a shared bundling strategy for userscript and extension outputs;
- generate Chromium and Firefox manifests from adapter permissions;
- add content script, background runtime, and toolbar action;
- use the same adapter registry and library modal;
- implement extension binary-fetch and cancellation transport;
- implement extension settings storage;
- package reproducible ZIP artifacts for both browsers;
- keep the userscript release artifact.

Required spike before final transport choice:

- one 50+ MB video;
- 300+ MB combined selected media;
- cancellation during download;
- Firefox and Chromium memory behavior;
- ZIP download from the chosen extension context.

Acceptance criteria:

- userscript, Chromium extension, and Firefox extension build from one source tree;
- permissions are generated from installed adapter manifests;
- unsupported pages inject nothing;
- toolbar action opens the shared UI on a supported page;
- built packages contain no remote executable code;
- no token/API boundary regressions;
- CI uploads extension build artifacts.

## Phase 4 — Pinterest adapter

Tasks:

- add Pinterest manifest matches and minimal media-host permissions;
- implement page matching for initial deterministic scopes;
- implement stable pin ID and canonical media key extraction;
- discover highest-quality rendered image source from semantic image attributes/source sets;
- discover rendered video sources;
- implement duplicate handling across re-rendered masonry grids;
- implement scroller/boundary behavior for infinite grids;
- expose only scan modes supported by the page;
- disable date filtering when a reliable rendered timestamp is unavailable;
- add fixture tests and live regression checklist.

Acceptance criteria:

- pin detail, board, profile grid, and search fixtures pass;
- same pin/media does not produce duplicates after virtualized re-rendering;
- only declared Pinterest media hosts can be downloaded;
- no private Pinterest API calls;
- original/highest-quality rendered source is selected without inventing URLs;
- the shared picker works with Pinterest results.

## Phase 5 — Reddit comments adapter

Tasks:

- match post-detail comment-thread pages only;
- explicitly reject home/feed/recommendation pages;
- discover rendered comment nodes defensively;
- capture ID, parent, depth, author, body, timestamp, score text, and permalink when available;
- collect media rendered inside selected comments;
- preserve comment hierarchy;
- add comment-specific library cards/list rows;
- add export format controls for JSON, Markdown, and CSV;
- optionally add an explicit “expand rendered replies” mode only after safe DOM testing;
- add fixtures for nested, deleted, collapsed, edited, and media-containing comments.

Acceptance criteria:

- comment hierarchy is preserved in JSON and Markdown;
- deleted/unavailable authors and bodies are represented without crashes;
- selected comments only are exported;
- comment media can be independently selected;
- the adapter never activates on feed pages;
- no vote/post/join/follow/account mutations;
- no authenticated Reddit API enumeration.

## Phase 6 — CI, release, and migration completion

Tasks:

- add unit tests for selection and archive handlers;
- add fixture tests for all adapters;
- add extension manifest validation;
- add extension build artifact upload;
- add Playwright UI tests for modal selection and keyboard behavior;
- add a browser matrix checklist;
- update README, architecture, adapter, testing, release, security, and troubleshooting docs;
- update all version declarations together;
- preserve changelog outside the runtime UI.

Acceptance criteria:

- one command builds and validates every target;
- CI passes for userscript and both extension packages;
- generated artifacts are reproducible;
- documentation describes how to add a runtime and how to add an adapter;
- legacy compatibility wrappers are removed only after all targets pass.

## Build and CI target

Suggested commands:

```bash
npm run build:userscript
npm run build:extension:chromium
npm run build:extension:firefox
npm run test:unit
npm run test:fixtures
npm run test:ui
npm test
```

Suggested CI jobs:

1. static invariants and syntax;
2. unit tests;
3. adapter fixture tests;
4. userscript build;
5. Chromium extension build and manifest validation;
6. Firefox extension build and manifest validation;
7. UI smoke tests;
8. artifact upload.

## Test cases that must exist

### Selection

- single selection;
- Ctrl/Cmd additive toggle;
- Shift range forward and backward;
- Ctrl/Cmd+Shift additive range;
- select all eligible;
- select all visible;
- none and invert;
- filtering while preserving selection;
- sorting changes range order predictably;
- deselected items excluded from ZIP;
- keyboard-only operation;
- reduced motion.

### Runtime

- userscript fetch bridge;
- extension fetch bridge;
- cancellation;
- host allowlist rejection;
- large binary transfer;
- Blob download;
- optional fflate and mandatory fallback ZIP writer.

### Adapters

- unsupported page activation prevention;
- duplicate DOM rendering;
- missing IDs/timestamps;
- delayed virtual timeline boundaries;
- Pinterest masonry re-rendering;
- Reddit nested/deleted/collapsed comments;
- Discord current regression set.

## Expected commit sequence

Keep commits reviewable and keep the userscript working after every milestone.

1. `test: add sanitized adapter fixtures`
2. `refactor: introduce archive item and capability contracts`
3. `refactor: isolate userscript runtime transport`
4. `feat: add independent manual selection store`
5. `feat: add media library modal and range selection`
6. `build: add extension targets`
7. `feat: add Pinterest adapter`
8. `feat: add Reddit comment-thread export adapter`
9. `test: add cross-target and adapter regression suites`
10. `docs: document runtimes adapters and release process`

## Definition of done

The roadmap is complete when:

- the original userscript remains installable and functional;
- Chromium and Firefox extension packages are produced from the same shared source;
- Discord, Pinterest, and Reddit-comment adapters are isolated and tested;
- users can open a centered grid/list library and manually select exactly what to archive;
- file-manager range and additive selection work with keyboard modifiers;
- selected cards have accessible red animated highlighting;
- Reddit comment threads export selected comments as structured and readable documents;
- no feed-only Reddit behavior is implemented;
- all tests and CI jobs pass;
- no credentials or authenticated internal API access are introduced.
