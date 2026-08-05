# Testing

## Required commands

```bash
npm install --ignore-scripts
npm test
npm run test:fixtures
npm run test:ui
```

Target-specific builds remain available:

```bash
npm run build:userscript
npm run build:extension:chromium
npm run build:extension:firefox
```

## Automated coverage

### Baseline and invariants

- source-manifest assembly and syntax;
- version alignment;
- adapter-generated userscript metadata;
- unsupported pages stop before DOM access;
- no token/API/account-action patterns;
- no site coupling in shared modules;
- retained ZIP fallback.

### Shared domain and runtime

- complete runtime contract;
- no direct `GM_*`, `chrome.*`, or `browser.*` calls in shared modules;
- ArchiveItem kinds and final inclusion rule;
- adapter capabilities;
- Quick/Review workflow transitions;
- userscript runtime isolation and retries;
- extension manifests, messaging, allowlists, toolbar actions, and absence of remote executable JavaScript.

### Selection and Library

- eligible canonical entries initialize selected;
- plain, checkmark, Ctrl/Cmd, Shift, and additive range semantics;
- filter/sort/re-render persistence;
- all visible, all eligible, none, and invert;
- 2,000-item reducer performance;
- one toggle does not rebuild all cards;
- ARIA dialog/listbox, focus trap, Escape, Space, arrows, and reduced motion;
- Review closes/cancels without requesting originals;
- only explicitly confirmed selected originals are requested.

### Naming

- exact Windows duplicate-stem regression;
- global numbering across extensions and item kinds;
- case/Unicode collision handling;
- reserved Windows names and invalid characters;
- immutable preview/download/manifest/ZIP naming map;
- fixed Reddit document names participating in complete collision detection;
- identical shared naming implementation for all targets.

### Diagnostics and metrics

- structured bounded event store;
- stable codes and sensitive-data redaction;
- selectable Activity/Developer text;
- Copy and UTF-8 Markdown download paths;
- 750 ms active heartbeat;
- synthetic twelve-second DOM-visible staleness test;
- no full Library rebuild or thumbnail source change on metrics updates;
- exact completion and visibility-return flush.

### Adapter fixtures

- Discord image/video/rendered-GIF discovery baseline;
- Pinterest pin detail, board, Masonry duplicate merge, profile/search scope, and home-feed rejection;
- Reddit thread-only activation, hierarchy, selected-only JSON/Markdown/CSV, deleted/collapsed/edited records, and independent comment media.

### Build reproducibility

Chromium and Firefox packages use sorted deterministic ZIP entries and fixed archive timestamps. `npm run check:reproducible` rebuilds and compares SHA-256 hashes.

## Playwright matrix

CI runs the UI suite in Chromium and Firefox. It uses sanitized Discord DOM fragments and a mocked Tampermonkey transport to verify:

- partial stopped scan opens Review;
- no original request before explicit confirmation;
- closing and reopening preserves selection;
- Archive selected requests only the final selection;
- keyboard selection changes card state without rebuilding the Library;
- Activity is selectable and `.md` download works;
- DOM-visible metrics remain at most one second stale for twelve seconds.

## Manual browser matrix

These checks remain mandatory before a production release and must never be claimed unless actually run:

- Firefox + Tampermonkey with `fflate` blocked;
- Chromium + Tampermonkey with `fflate` available;
- packaged Firefox extension;
- packaged Chromium extension;
- Discord channel/thread containing every supported media category;
- Pinterest pin, board, profile grid, and search result surfaces;
- Reddit nested/deleted/collapsed/edited comments with rendered media;
- one video larger than 50 MB;
- at least 300 MB combined selected data;
- cancellation and memory behavior in Firefox and Chromium;
- multiple ZIP download permissions;
- final-position restoration on a real virtualized timeline.

For this implementation session those live/manual checks are recorded as **Blocked with evidence** where the execution environment cannot install interactive browser extensions or access private real-world pages.
