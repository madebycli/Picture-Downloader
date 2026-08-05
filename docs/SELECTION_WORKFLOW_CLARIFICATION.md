# Selection workflow clarification

Status: authoritative clarification and required companion to `IMPLEMENTATION_PLAN.md`  
Created: 2026-08-05  
Priority: this document supersedes any ambiguous wording about scanning, manual selection, downloading, and ZIP creation.

## Exact product intent

Media Archiver must keep the complete existing scan workflow and add an optional review step **before** original files are downloaded and before ZIP files are created.

The required sequence for review mode is:

```text
configure scan
→ scan / collect rendered candidates
→ deduplicate candidates
→ open near-fullscreen library
→ optionally filter and select/deselect items
→ confirm Archive selected
→ download only the final selected originals
→ create ZIP parts
```

The application must never require users to download everything first and delete unwanted files afterward.

## Existing scan behavior must remain

Do not replace or weaken the current scanner. Preserve all supported adapter capabilities, including where applicable:

- From date through latest available;
- inclusive From/To date range;
- newest to oldest, including jump to newest first;
- current position to oldest;
- current position to newest;
- full timeline: current to oldest and then newest;
- manual Stop, followed by review/archive of everything collected so far;
- media-type filters;
- final page-position options;
- delayed virtual-timeline boundary confirmation;
- ZIP splitting and Firefox-safe ZIP fallback.

Manual selection is an additional final-selection layer. It does not replace date filters, scan direction, manual stopping, or deduplication.

## Two user-facing completion modes

Setup must offer one clean **After scan** choice.

### 1. Quick archive

Preserves the established workflow:

```text
scan → archive every eligible deduplicated item
```

- Every item passing adapter, media-type, and date filters is included.
- No manual review is required.
- This mode exists for users who want to start the job and leave it running.

### 2. Review before archive

Adds the requested file-manager workflow:

```text
scan → review collected items → archive selected items only
```

- Scanning collects metadata, rendered previews, timestamps, source context, and canonical media URLs.
- Scanning must not pre-download all original binaries merely to populate the library.
- After scanning or manual Stop, open or offer a prominent button to open the near-fullscreen Library.
- All currently eligible, deduplicated items start selected so the user can simply confirm without extra work.
- The user may deselect unwanted items, select only a subset, change the visible date/type/source filters, or use file-manager shortcuts.
- Only `eligible && manuallySelected` items are fetched and archived after explicit confirmation.
- Closing/canceling the review must not silently begin downloads.

The manual-review feature is optional for the user. It must not remove Quick archive.

## Mandatory near-fullscreen Library

The reliable primary implementation is a large modal or application surface occupying most of the viewport, not a small corner list.

Required behavior:

- grid view as the default for images, GIF previews, and videos;
- optional list view;
- large enough to inspect many previews comfortably;
- search, sorting, and filters;
- visible selected count;
- select all visible, select all eligible, select none, and invert;
- plain click, checkmark click, Ctrl/Cmd click, Shift click, Ctrl/Cmd+Shift click, Ctrl/Cmd+A, Space, Escape, and arrow-key behavior defined in the main plan;
- selected cards use the planned accessible red ring, overlay, badge, and reduced-motion-safe animation;
- final action is clearly named **Archive selected** or **Download selected**;
- no original-file network fetch begins until that final action in Review mode.

Changing a Library filter changes what is visible, not the stored explicit selection, unless the user invokes a selection command.

## Direct selection inside a supported website

Selecting messages or media directly inside Discord or another supported website is an optional enhancement, not the required foundation.

It may be implemented only when it is robust and does not interfere with the host application. If implemented:

- it must be adapter-owned, capability-gated, and disabled on unsupported layouts;
- it must not mutate account state or intercept ordinary site actions dangerously;
- it should use an unobtrusive overlay or explicit selection mode, not permanently rewrite the host UI;
- selected host items synchronize into the same shared selection store;
- the user may still open the near-fullscreen Library to verify or adjust the final selection;
- no download begins merely because an item was highlighted in the host page.

If direct in-page selection is technically fragile, omit it initially. The near-fullscreen post-scan Library remains mandatory and must provide the complete workflow.

## Deduplication requirements

Deduplication occurs before final manual selection wherever identity can be established without downloading the original binary.

### Pre-fetch deduplication

Merge repeated discoveries using adapter-provided stable identity and normalized source information, for example:

- canonical media key;
- stable source item/message/pin/comment ID plus media identity;
- normalized original media URL with transient signatures removed only according to adapter rules;
- repeated virtual-DOM rendering of the same item;
- preview and attachment elements referring to the same original.

The Library should show one logical item, not repeated copies. The statistics and Developer logs should report how many duplicate discoveries were merged.

### Exact-content deduplication

Different URLs can sometimes contain identical bytes. Exact equality cannot always be known before fetching unless the page exposes a trustworthy content identifier.

An optional content-hash stage may prevent byte-identical files from appearing twice in the ZIP after fetch. It must:

- reuse already fetched buffers where possible;
- avoid packaging duplicate binary content twice;
- record the deduplication decision in the manifest and Developer logs;
- never claim that two different URLs were prevented from being fetched when their equality was unknowable before download.

The default acceptance requirement is that repeated representations of the same canonical source are merged before network download.

## State model

Keep these concepts separate:

```text
discovered
→ canonical/deduplicated
→ eligible by adapter/type/date
→ manually selected
→ fetched
→ saved in ZIP
```

Final archive inclusion is exactly:

```text
canonical && eligible && manuallySelected
```

Do not derive manual selection from DOM classes. Store it in a stable keyed selection model that survives re-rendering, sorting, filtering, rescans, and virtualized Library rendering.

## UI wording

Suggested Setup control:

```text
After scan
(•) Quick archive
    Download every eligible item automatically.
( ) Review before archive
    Inspect and choose items in the fullscreen Library first.
```

When Review mode is active, the primary scan action should not misleadingly say `Scan & create ZIPs`. Use wording such as:

```text
Scan and review
```

After scanning:

```text
Review 428 items
```

Inside the Library:

```text
Archive 317 selected
```

## Acceptance tests

The implementation is not complete until tests prove:

1. every existing scan mode still returns the expected candidates;
2. fixed dates, latest-available mode, and manual Stop still work;
3. Quick archive continues to archive all eligible deduplicated items;
4. Review mode performs no original-file download before final confirmation;
5. deselected items cause no original-file request and never enter a ZIP;
6. selected items alone are downloaded after confirmation;
7. all eligible items begin selected in Review mode;
8. closing Review mode does not start an archive;
9. canonical duplicates appear once in the Library and are fetched once;
10. duplicate-merging counts appear in statistics and diagnostics;
11. selection survives filter, sort, incremental scan updates, and Library virtualization;
12. manual Stop can transition into Review mode using the partial collection;
13. direct host-page selection, if implemented, is optional and synchronizes with the shared store;
14. the same behavior exists in the userscript, Chromium extension, and Firefox extension.

## Definition of done

This clarification is complete when users can choose either:

- the established automatic scan-and-archive flow; or
- scan first, inspect a large file-manager-like Library, remove unwanted items, and only then download/archive the selected originals.

The second flow must happen before downloading and ZIP creation, not after files already exist on disk.