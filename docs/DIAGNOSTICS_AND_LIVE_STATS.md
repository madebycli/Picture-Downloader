# Diagnostics, developer logs, and one-second live statistics

Status: required companion to [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md)  
Created: 2026-08-05  
Origin: observed behavior in the current 6.0 userscript and earlier 5.x tester feedback

## Goal

Media Archiver must make progress visible and failures understandable without turning the normal interface into a developer console.

This plan applies equally to all three first-class outputs:

1. universal userscript;
2. Chromium extension;
3. Firefox extension.

The implementation must provide:

- visible statistics refreshed at least once per second while work is active;
- concise user-facing Activity messages;
- deeper structured Developer logs behind an explicit control;
- selectable log text;
- one-click copy;
- one-click sanitized Markdown report download;
- sufficient error context to identify scan, network, naming, archive, ZIP, adapter, and runtime failures;
- privacy-safe diagnostic exports suitable for attaching to a GitHub issue.

## Current 6.0 finding

The 6.0 source calls `updateCounters()` during visible-media scans, and the generic scanner performs multiple scans per scroll iteration. However, users have observed the displayed totals changing only around every ten seconds during real runs.

Therefore the requirement is based on visible behavior, not merely on how often internal functions are called:

> While scanning, downloading, or creating ZIPs, the visible status counters must never remain stale for more than one second under normal foreground-tab operation.

This is a regression requirement for the current 6.0 behavior.

## One-second live statistics contract

### Maximum visible delay

While a session is active, update the lightweight status summary on a fixed heartbeat of at most:

```text
1000 ms
```

Recommended implementation interval:

```text
500–1000 ms
```

The acceptance test measures DOM-visible values, not only internal state.

### Metrics covered

At minimum, the heartbeat updates:

- total discovered;
- eligible/in-range;
- manually selected;
- downloaded successfully;
- saved to ZIP;
- skipped;
- errors;
- bytes downloaded;
- current scan iteration or position when meaningful;
- current ZIP part and file progress;
- elapsed session time.

The compact launcher may show only the primary counters. The library and diagnostics views may show the full metric set.

### Performance rule

Do **not** rebuild the complete media grid/list every second.

Separate state rendering into:

```js
refreshLiveMetrics(snapshot)
renderLibraryChanges(changedKeys)
renderActivityChanges(newEvents)
```

The one-second heartbeat updates only text, progress values, and small status indicators. Media cards are updated incrementally when entries are added or their state changes.

Required characteristics:

- no full sort of thousands of entries on every heartbeat;
- no complete `replaceChildren()` of the library every second;
- no thumbnail reload caused by counter updates;
- no repeated full `selectionStatistics()` scan when cached counters can be updated incrementally;
- use a dirty flag or version counter so idle heartbeats perform almost no work;
- stop the timer when no session is active;
- perform one final synchronous refresh when a phase ends;
- tolerate background-tab timer throttling, then refresh immediately on `visibilitychange` when the page becomes visible again.

Suggested interface:

```js
liveMetrics.startSession()
liveMetrics.markDirty(reason)
liveMetrics.recordDiscovery(delta)
liveMetrics.recordDownload(bytes)
liveMetrics.recordSaved(count)
liveMetrics.recordError(code)
liveMetrics.flushNow()
liveMetrics.stopSession()
```

### Source of truth

UI elements are never the source of truth. Keep session metrics in a runtime-neutral model:

```js
{
    sessionId,
    startedAt,
    elapsedMs,
    phase,
    found,
    eligible,
    selected,
    downloading,
    downloaded,
    saved,
    skipped,
    errors,
    bytesDownloaded,
    currentZipPart,
    totalZipPartsKnown,
    currentItem,
    totalItems,
    scanIterations,
    lastUpdatedAt
}
```

The same model must drive Userscript, Chromium, and Firefox UIs.

## Logging architecture

### Two levels of detail

Keep the ordinary **Activity** view concise and user-first.

Activity should show:

- session start and selected configuration;
- major scan transitions and boundary decisions;
- important download and ZIP progress;
- actionable warnings;
- short error summaries;
- final result summary.

Add a separate button named:

```text
Developer logs
```

It opens an advanced diagnostics drawer or modal. Raw stacks and large context blocks do not belong in the normal Activity stream.

### Activity actions

The Activity header should offer:

```text
[Copy] [Download .md] [Developer logs] [Clear]
```

On narrow layouts, secondary actions may move into an overflow menu, but Copy and Developer logs must remain easy to find.

### Selectable text

All visible log text must be selectable regardless of host-page CSS:

```css
.ma-log,
.ma-log *,
.ma-developer-log,
.ma-developer-log * {
    user-select: text;
    -webkit-user-select: text;
}
```

Buttons and interactive drag handles may opt out individually.

## Structured diagnostic event model

Do not treat rendered DOM text as the log database. Store structured events in a bounded in-memory diagnostics store.

Suggested event shape:

```js
{
    id,
    sessionId,
    timestamp,
    monotonicMs,
    level: 'debug' | 'info' | 'success' | 'warn' | 'error',
    category: 'runtime' | 'adapter' | 'scan' | 'selection' |
              'network' | 'naming' | 'archive' | 'zip' | 'ui',
    code,
    message,
    userMessage,
    phase,
    adapterId,
    runtimeTarget,
    context,
    error: {
        name,
        message,
        stack,
        causeCode
    } | null
}
```

Runtime-neutral API:

```js
diagnostics.debug(code, message, context)
diagnostics.info(code, message, context)
diagnostics.success(code, message, context)
diagnostics.warn(code, message, context)
diagnostics.error(code, message, error, context)
diagnostics.startSession(metadata)
diagnostics.endSession(summary)
diagnostics.exportMarkdown(options)
```

Keep a bounded number of events in memory. Suggested default:

```text
2,000 structured events per session
```

When the limit is reached, retain all errors and warnings, preserve the first and final session events, and sample repetitive debug events instead of silently losing critical information.

## Stable error codes

Important failures must use stable codes. Initial set:

```text
ADAPTER_UNSUPPORTED_PAGE
ADAPTER_TIMELINE_NOT_FOUND
ADAPTER_DISCOVERY_FAILED
SCAN_BOUNDARY_TIMEOUT
SCAN_ITERATION_LIMIT
SCAN_POSITION_RESTORE_FAILED
NETWORK_HTTP_403
NETWORK_HTTP_404
NETWORK_HTTP_429
NETWORK_HTTP_5XX
NETWORK_TIMEOUT
NETWORK_ABORTED
NETWORK_HOST_REJECTED
NETWORK_RETRY_EXHAUSTED
NAMING_TEMPLATE_INVALID
NAMING_COLLISION_RESOLVED
NAMING_PLAN_FAILED
ZIP_ENGINE_UNAVAILABLE
ZIP_FALLBACK_ACTIVE
ZIP_PART_BUILD_FAILED
ZIP_PART_TOO_LARGE
ZIP_DOWNLOAD_BLOCKED
RUNTIME_CLIPBOARD_FAILED
RUNTIME_SAVE_FAILED
RUNTIME_STORAGE_FAILED
```

Codes are stable support identifiers. User-facing wording may change without breaking tests or issue references.

## User-facing error design

Every Activity error should answer:

1. What failed?
2. What was affected?
3. Did the remaining work continue?
4. What should the user try next?
5. What is the reference code?

Example:

```text
Could not download 3 files because the server returned HTTP 403.
The remaining files were saved. Open Developer logs for details.
Code: NETWORK_HTTP_403
```

The expanded developer record may include:

- retry attempt and maximum attempts;
- request duration;
- response status;
- sanitized host and path class;
- deterministic short item hash;
- adapter and runtime target;
- current ZIP part;
- selected naming preset;
- ZIP engine;
- sanitized stack and cause chain.

## Privacy and redaction

Diagnostic exports must be safe to attach to a public GitHub issue by default.

Always redact or omit:

- URL query strings and fragments;
- signed CDN parameters;
- cookies and authorization headers;
- tokens and credentials;
- private message or comment bodies;
- complete source URLs when host plus path classification is sufficient;
- local filesystem paths;
- unnecessary extension IDs;
- usernames and private source labels unless explicitly included by the user through a clearly unsafe advanced option.

Prefer:

```text
host: cdn.discordapp.com
pathClass: /attachments/:container/:item/:filename
itemHash: 8f31c0a2
```

instead of a full signed media URL.

The Markdown report must state that sensitive parameters and content were redacted.

## One-click copy

Provide:

### Copy activity

Copies the concise user-facing current-session log.

### Copy developer report

Copies the complete sanitized Markdown diagnostic report.

Runtime contract addition:

```js
runtime.copyText(text)
```

Implementations:

- Clipboard API when available;
- hidden selectable textarea fallback when clipboard permission is unavailable;
- brief non-blocking success confirmation;
- on failure, keep the report open and selectable and log `RUNTIME_CLIPBOARD_FAILED`.

## Markdown report download

Provide one-click **Download .md**.

Suggested filename:

```text
media-archiver-diagnostics_2026-08-05_12-26-30.md
```

Runtime contract uses the existing save facility:

```js
runtime.saveBlob(markdownBlob, filename)
```

Required report sections:

```markdown
# Media Archiver diagnostic report

## Environment
- App version
- Runtime target
- Browser family/version when available
- Operating system family when safely available
- Active adapter and supported page type
- Session ID
- Start and finish times

## Configuration
- Scan mode
- Date-range summary
- Enabled content types
- Final-position setting
- Naming preset, without private source text
- ZIP engine and limits

## Final statistics
- Found
- Eligible
- Manually selected
- Downloaded
- Saved
- Failed
- Skipped
- Bytes downloaded
- ZIP parts created
- Elapsed time

## Error summary
- Counts grouped by stable code

## Activity timeline
- Concise chronological events

## Developer events
- Sanitized structured context

## Redaction notice
```

## Developer logs interface

Recommended controls:

- level filters: Debug, Info, Warning, Error;
- category filters;
- text/code search;
- `Errors only` shortcut;
- expand/collapse all errors;
- copy selected event;
- copy full report;
- download Markdown;
- clear current diagnostics;
- optional `Include debug events` toggle, enabled by default only in the advanced view.

Each event row should show:

```text
12:26:31.482  ERROR  NETWORK  NETWORK_HTTP_403
Could not download item 8f31c0a2 after 4 attempts.
[Details]
```

Expanded details may use a definition list or formatted JSON. Never dump unsanitized arbitrary objects with `JSON.stringify(error)` directly into the UI.

## Runtime and adapter responsibilities

Shared diagnostics owns:

- event schema;
- storage and bounds;
- redaction;
- Markdown generation;
- metric snapshots;
- stable error-code registry;
- UI view model.

Runtime owns:

- clipboard implementation;
- report download;
- browser/platform metadata that is safely available;
- extension messaging failures.

Adapter owns:

- adapter-specific event context;
- safe page-type labels;
- safe path classification;
- discovery diagnostics;
- no final redaction policy override.

## Required tests

### One-second statistics regression

During a synthetic 12-second scan where one item is added every 250 ms:

- the internal found count increases continuously;
- the DOM-visible found count is never more than one second stale while the tab is visible;
- the media grid is not fully rebuilt by the heartbeat;
- thumbnails are not re-requested by metric refreshes;
- one final exact refresh occurs at completion.

Repeat for:

- download progress;
- saved count;
- error count;
- ZIP-part progress;
- userscript runtime;
- Chromium extension;
- Firefox extension.

### Background-tab behavior

- timer throttling may occur in a hidden tab;
- returning to the page triggers an immediate exact refresh;
- no incorrect accumulated delta is displayed.

### Logging and export

- Activity text is selectable;
- Copy activity copies exactly the visible concise session events;
- Copy developer report includes sanitized details;
- Download .md produces valid UTF-8 Markdown;
- copied and downloaded reports contain the same event data;
- full signed URLs and query parameters are absent;
- errors retain stable codes;
- repetitive debug logs cannot evict all errors;
- clipboard failure provides a selectable fallback;
- Markdown save failure generates an actionable Activity error;
- logs work identically in all three runtime targets.

### Error-path fixtures

At minimum test:

- unsupported page;
- timeline/scroller not found;
- boundary timeout;
- HTTP 403, 404, 429, and 5xx;
- network timeout and cancellation;
- rejected undeclared host;
- naming-template validation error;
- naming collision resolution;
- fflate unavailable with ZIP fallback active;
- ZIP part creation failure;
- browser blocks multiple downloads;
- final-position restoration failure.

## Integration into the main roadmap

### Phase 0

Capture the current 6.0 visible counter delay as a regression baseline and add deterministic synthetic timing fixtures.

### Phase 1

Create shared diagnostics and live-metric models. Add `runtime.copyText()` and keep runtime APIs out of shared logic.

### Phase 2

Add Activity actions, Developer logs UI, one-second status heartbeat, incremental library rendering, selectable text, and report preview.

### Phase 3

Implement clipboard and Markdown download in Userscript, Chromium, and Firefox runtimes and verify identical report structure.

### Phases 4 and 5

Require Pinterest and Reddit adapters to emit stable, safe diagnostic context without leaking page content.

### Phase 6

Run timing, redaction, clipboard, Markdown export, and cross-runtime diagnostic tests in CI.

## Definition of done

Diagnostics and live statistics are complete when:

- a foreground active session never shows counters more than one second stale;
- the one-second heartbeat does not rebuild the entire library;
- ordinary Activity remains concise;
- Developer logs expose structured, searchable details;
- all log text is selectable;
- Activity and developer reports can be copied in one click;
- a sanitized UTF-8 Markdown report can be downloaded in one click;
- error events include stable codes and useful context;
- sensitive URLs, tokens, account content, and private text are redacted by default;
- behavior is shared and tested in Userscript, Chromium, and Firefox;
- all required timing, error-path, privacy, and export tests pass.
