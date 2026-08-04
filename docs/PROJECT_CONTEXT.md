# Project context

## Product statement

Discord Media Archiver is a Tampermonkey userscript for saving large collections of media from a Discord channel or thread without manually downloading each attachment.

It scans the currently open Discord web interface, identifies eligible media, applies user-selected type and date filters, downloads the source files, and creates numbered ZIP parts with CSV manifests.

## Primary user workflow

1. Open a Discord channel or thread in the browser.
2. Choose one or more media categories:
   - photos and native GIF files
   - Discord-hosted videos
   - external GIF previews rendered by Discord
3. Optionally enable a date range.
4. Choose scan direction and starting behavior.
5. Choose the final chat position after the scan and ZIP process.
6. Start scanning.
7. Review live counters, logs, and per-item states.
8. Receive one or more ZIP downloads.

## Media categories

### Photo

Native image attachment from a Discord attachment URL. Native `.gif` files belong to this category.

### Video

Native video attachment from a Discord attachment URL. Common extensions include MP4, WebM, MOV, MKV, AVI, MPEG, OGV, 3GP, FLV, WMV, TS, M2TS, and related formats. A Discord-rendered `<video>` element can classify uncommon attachment extensions as video.

### External GIF preview

An animated preview that Discord renders for an external GIF-page link. It is detected from the GIF embed context and a Discord `images-ext-*` proxy URL. The downloaded preview is often MP4, not GIF.

## Excluded sources

- YouTube and ordinary external video embeds
- Arbitrary website media
- Media that Discord has not rendered in the page
- Internal Discord API results
- Content outside the selected date range
- Disabled media categories

## Date semantics

- The From date begins at local midnight in the browser’s timezone.
- A specific To date is inclusive through the end of that local day.
- “Latest available” has no upper date boundary.
- The exact Discord `time[datetime]` value is preferred.
- The Discord snowflake timestamp is the fallback.
- Media with no resolvable message date is excluded when the date filter is enabled.

## Scan modes

### Newest → oldest

Jump to the newest loaded message, then scan toward older messages. Best for “from a date through latest.”

### Current → oldest

Begin at the current viewport and scan upward.

### Current → newest

Begin at the current viewport and scan downward.

### Full channel: current → oldest → newest

Scan from the current position to the old boundary, then scan downward to the new boundary. This is the safest mode when starting in the middle of a date range.

## Completion and boundary rules

Discord’s message list is virtualized. Reaching scroll position zero or the current scroll height is not enough to prove the true boundary. The script waits for delayed DOM changes and retries before confirming the oldest or newest boundary.

A selected date boundary can stop the scan earlier than the physical channel boundary once the entire visible viewport has passed outside the selected date range.

## ZIP behavior

- Entries are ordered newest to oldest.
- Filenames are six-digit sequence numbers plus the true extension.
- Numbering continues across ZIP parts.
- ZIP parts are divided by file count and byte size.
- `fflate` with level 0 is the fast path.
- The built-in ZIP32 STORE writer is the offline/Firefox fallback.
- The built-in writer must not be removed unless replaced with another dependency-free fallback.

## Current constraints

- The whole userscript is assembled from ordered source parts without transpilation.
- Discord DOM changes may break selectors.
- Large videos can exhaust browser memory.
- Signed Discord URLs expire; fresh URLs are captured whenever the DOM exposes them.
- External GIF preview availability depends on Discord rendering the preview.
- ZIP32 imposes per-file and per-part limits below 4 GiB.
