# Project context

## Product statement

Media Archiver is a Tampermonkey userscript for saving large collections of media from supported web applications without manually downloading each file.

The core is site-neutral. An active adapter discovers rendered media and exposes a virtual timeline to the shared filter, scanner, archive, workflow, and interface modules.

## Primary workflow

1. Open a page supported by an installed adapter.
2. Choose media categories.
3. Optionally choose an inclusive local-date range.
4. Choose scan direction and the final page position.
5. Choose automatic ZIP creation or review-first mode.
6. Start scanning.
7. Review collected entries in the Media tab and operational messages in Activity.
8. Receive one or more numbered ZIP parts.

## Interface model

- **Persistent status:** phase, progress, found, selected, saved, and error counts
- **Setup:** media categories, date range, scan behavior, and automatic ZIP setting
- **Media:** detailed counters and per-entry state
- **Activity:** current-session operational messages
- **Action footer:** start, stop, create ZIP, and reset

Release history is repository documentation and is not shown in the runtime interface.

## Shared media categories

### Photo

An image file rendered by the active site. Native `.gif` files remain in this category.

### Video

A rendered video file. Common browser and uploaded-video containers are supported; adapters can also classify uncommon source extensions from semantic video elements.

### Rendered GIF preview

An animated preview rendered or proxied by the active site for an external GIF-page link. The downloaded file can be MP4 rather than GIF.

## Date semantics

- The From date begins at local midnight in the browser timezone.
- A specific To date is inclusive through the end of that local day.
- Latest available has no upper boundary.
- The adapter supplies exact item timestamps and may provide an ID-based fallback.
- Entries without a resolvable date are excluded while date filtering is enabled.

## Scan modes

- End → start
- Current position → start
- Current position → end
- Full timeline: current → start → end

Virtualized timelines require delayed boundary confirmation. Scroll position alone is not proof that the true start or end has been reached.

## Archive behavior

- Entries are ordered newest to oldest.
- Filenames use continuous sequence numbers plus true extensions.
- ZIP parts split by item count and byte size.
- Each part contains `manifest_part.csv`.
- `fflate` STORE mode is the fast path.
- A built-in ZIP32 STORE writer is the required fallback.

## Current adapter

The Discord adapter supports channels and threads, attachment media, and rendered external GIF previews. Its selectors, hosts, snowflake timestamps, and archive context live entirely in `src/adapters/discord/` and `src/adapters/manifest.json`.
