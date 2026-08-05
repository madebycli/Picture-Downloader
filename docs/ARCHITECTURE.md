# Architecture

## Build model

One ordered source graph produces three targets:

- `scripts/assemble-userscript.mjs` creates `media-archiver.user.js`.
- `scripts/build-extension.mjs chromium` creates a Chromium MV3 package.
- `scripts/build-extension.mjs firefox` creates a Firefox-compatible package.

`src/build-manifest.json` defines shared assembly order. `src/adapters/manifest.json` defines adapter modules, supported page matches, and the minimum download hosts. Userscript `@match`/`@connect`, extension content matches, extension host permissions, and the background runtime allowlist are generated from that adapter manifest.

## Shared layers

### Domain

`ArchiveItem` separates record kind from media type. Supported kinds are binary media, rendered comments, and locally generated documents. Every item has a stable key, canonical/deduplication state, eligibility, independent manual selection, status, adapter identity, source identity, timestamp, discovery order, and kind-specific payload.

Final archive input is exactly:

```text
canonical && eligible && manuallySelected
```

Reddit comments remain `kind: comment`; they are never disguised as media.

### Runtime contract

Shared code calls:

```text
fetchBinary
abortRequest
abortAllRequests
saveBlob
copyText
getSetting
setSetting
getPlatformInfo
openUi
closeUi
```

The userscript bridge owns `GM_xmlhttpRequest` and Tampermonkey-compatible storage/save behavior. Extension content code owns the overlay and selection workflow; the extension background runtime owns cross-origin fetch/cancellation and enforces the generated host allowlist again.

### Adapter contract and capabilities

Adapters own all page matching, selectors, IDs, timestamps, terminology, URL normalization, source labels, scroller/timeline behavior, path classification, and allowed download hosts. Capabilities declare media/text support, virtual timelines, date filtering, supported scan modes, views, and optional host-page selection. Shared code contains no Discord-, Pinterest-, or Reddit-specific hosts/selectors.

### Selection

The selection store is keyed and independent from filters. Newly discovered canonical eligible items initialize selected. Filter/sort/view changes do not erase explicit choices. Shift ranges use the current visible order. A card toggle updates keyed state and existing card classes rather than rebuilding the Library.

### Workflow

The original scanner remains the shared scanner. It keeps date filtering, four scan modes, delayed boundary confirmation, stop behavior, and final-position restoration.

After scanning:

- Quick archive moves directly to final-selection download and packing.
- Review before archive opens the Library and performs no original request until explicit confirmation.
- A stopped Review scan can transition to Review with its partial canonical collection.

### Naming

`planArchiveNames()` freezes the complete final item order and produces one immutable map. Sequence and stem reservations are global across media types, generated documents, workers, and ZIP parts. Sanitization is Windows-safe and case/Unicode-normalized on every platform. True extensions are appended by the naming service.

### Diagnostics and metrics

A bounded structured event store drives Activity, Developer logs, Copy, and Markdown export. Redaction occurs before export. Live metrics use a 750 ms active-session heartbeat with dirty/version flags. Metric refresh mutates only status text/progress; card rendering is incremental and separate.

### Archive

Only `kind: media` enters binary transport. Selected Reddit comments are transformed locally into generated JSON/Markdown/CSV items after confirmation. Bounded workers download selected originals, then ZIP parts are split by count/size. `fflate` STORE is optional; the built-in ZIP32 STORE writer remains mandatory.

## Runtime layout

```text
src/
├── shared/
│   ├── runtime-contract.user.js.part
│   ├── domain.user.js.part
│   ├── workflow-state.user.js.part
│   ├── selection-store.user.js.part
│   ├── naming-service.user.js.part
│   ├── generated-document-naming.user.js.part
│   ├── comment-export.user.js.part
│   └── diagnostics-metrics.user.js.part
├── runtimes/extension/
├── core/
└── adapters/
    ├── discord/
    ├── pinterest/
    └── reddit-comments/
```

## Extension packaging

Chromium uses Manifest V3 with a service worker and toolbar action. Firefox uses the compatible background-script/browser-action manifest form. Both use extension storage, content/background messaging, generated host permissions, and no remote executable JavaScript. Build ZIPs are deterministic: files are sorted, stored without compression, and use fixed archive metadata.

## Security boundary

Every request must pass:

1. adapter-declared build permission;
2. active content adapter `isDownloadUrlAllowed()`;
3. extension background allowlist when applicable.

Requests use omitted credentials. Shared code never receives cookies, tokens, or Authorization headers. Unsupported pages resolve no adapter and stop before UI injection.
