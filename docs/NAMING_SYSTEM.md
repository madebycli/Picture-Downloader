# Archive naming system plan

Status: required companion to [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md)  
Created: 2026-08-05  
Origin: Windows tester regression reported against an older 5.x build

## Purpose

Media Archiver needs one central, predictable naming engine shared by all three supported runtime targets:

1. universal userscript;
2. Chromium extension;
3. Firefox extension.

The naming engine must be user-friendly by default, powerful when expanded, deterministic, Windows-safe, collision-safe across the complete archive, and independent of media type or ZIP-part boundaries.

## Reported regression

A tester reported an older Windows build producing visually duplicated sequence stems such as:

```text
0001.jpg
0001.jpeg
0001.png
```

Windows itself can store these files because their full names differ, but this is still undesirable. File managers, image tools, import workflows, scripts, and users often treat the stem as the logical identity. Reusing `0001` for three different files creates ambiguity and can cause collisions after conversion, extension hiding, renaming, synchronization, or import.

The regression requirement is therefore stricter than ordinary filesystem uniqueness:

> No two archived items may receive the same normalized filename stem, even when their extensions differ.

For example, after the fix the output must be:

```text
000001.jpg
000002.jpeg
000003.png
```

and never three files sharing `000001`.

## Non-negotiable naming invariants

1. Generate final archive names for the complete final selection before starting downloads.
2. Use one global naming plan across all media kinds, comment-generated files, and ZIP parts.
3. Never restart sequence numbers for a new extension, media type, folder, worker batch, or ZIP part.
4. Treat filename and stem collisions case-insensitively for cross-platform safety.
5. Reserve both the complete path and the filename stem.
6. Preserve the true extension of downloaded media.
7. Never change `.jpeg` to `.jpg`, `.mp4` to `.gif`, or otherwise disguise a format.
8. Generated comment documents use their true `.json`, `.md`, and `.csv` extensions.
9. Apply Windows reserved-name and invalid-character rules on every platform so all archives extract consistently.
10. Record original and generated names in the archive manifest.
11. Use the same naming implementation and saved settings in the userscript, Chromium extension, and Firefox extension.
12. Unknown dates, duplicate timestamps, missing source labels, and repeated original names must never cause an overwrite.

## Recommended user experience

### Placement

Add one compact **File naming** group in Setup and repeat its current summary in the library/archive confirmation footer.

The normal view should contain only:

- a preset selector;
- a live example preview;
- an optional **Customize** disclosure;
- a short collision-safety note only when relevant.

Do not expose a large token editor until the user opens **Customize**.

### Default preset

The default remains the safest and easiest option:

**Numbered — newest to oldest**

```text
000001.jpg
000002.mp4
000003.png
```

Properties:

- six digits minimum;
- width grows automatically when more than 999,999 items are selected;
- sequence follows final archive order;
- sequence is global across all file types and ZIP parts;
- this preset preserves the current simple workflow while fixing the old collision regression.

### Built-in presets

#### 1. Numbered

```text
000001.jpg
000002.jpeg
000003.png
```

Template concept:

```text
{sequence}
```

Use case: sorting, bulk processing, maximum compatibility.

#### 2. Source date and time

```text
2026-08-05_12-13-45.jpg
2026-08-05_12-13-45_000002.png
```

Template concept:

```text
{date}_{time}
```

Rules:

- use the item's source timestamp, not download time;
- default to browser-local time because date filtering already uses browser-local calendar days;
- expose UTC as an advanced option;
- when timestamps collide, append the global sequence;
- when source time is unknown, use `unknown-date_{sequence}`.

#### 3. Source label, date, and number

```text
cafeteria_2026-08-05_000001.jpg
fanart-showcase_2026-08-05_000002.png
board-character-art_2026-08-05_000003.webp
```

Template concept:

```text
{source}_{date}_{sequence}
```

The adapter supplies a human-readable source label:

- Discord: channel or thread name;
- Pinterest: board, profile section, search context, or pin context;
- Reddit comments: post/subreddit context for comment exports and comment media.

If the source label is missing, use the adapter label and sequence rather than an empty component.

#### 4. Original name plus number

```text
artwork_000001.png
artwork_000002.jpg
clip_000003.mp4
```

Template concept:

```text
{original}_{sequence}
```

Use case: retaining recognizable original names while guaranteeing uniqueness.

#### 5. Advanced custom template

Available only after opening **Customize**.

Supported tokens:

```text
{sequence}
{date}
{time}
{datetime}
{site}
{source}
{original}
{mediaType}
{itemId}
```

The extension is never typed into the template. The naming engine appends the validated true extension automatically.

Do not support arbitrary JavaScript, regular-expression replacement code, or executable template expressions.

## Clean UI specification

Suggested compact control:

```text
File naming
[ Numbered — newest to oldest              ▾ ]
Example: 000001.jpg · 000002.mp4 · 000003.png
[Customize]
```

Expanded advanced area:

```text
Template       [{source}_{date}_{sequence}]
Time zone      [Local source time ▾]
Source label   [Automatic from current page ▾]
Sequence width [6]

Preview
cafeteria_2026-08-05_000001.jpg
cafeteria_2026-08-05_000002.png

✓ Unique stems across every ZIP part
✓ True extensions are always preserved
[Reset to preset]
```

User-first rules:

- show real examples using the first few selected entries;
- update preview immediately without rebuilding the archive;
- show validation errors inline, not in Activity logs only;
- disable archive creation only when a custom template is invalid;
- keep safe collision resolution automatic;
- never ask ordinary users to understand filesystem rules;
- persist the chosen preset and advanced settings through the shared runtime storage interface;
- provide a one-click reset to the default numbered preset.

## Timestamp and ordering decisions

### Ordering

Naming is applied after final sort and manual selection.

Default archive order remains newest to oldest. The generated sequence reflects that final order:

```text
000001 = newest selected item
000002 = next selected item
...
```

Changing grid display order must not silently change archive order unless the UI explicitly lets the user choose **Use current library sort as archive order**. That option should be advanced and off by default.

### Source timestamps

For `{date}`, `{time}`, and `{datetime}`:

1. use the adapter-provided source timestamp;
2. use the adapter's documented ID-derived timestamp fallback where available;
3. otherwise emit `unknown-date` or `unknown-time` plus sequence.

Never substitute the current download time without clearly labeling a separate token such as `{archiveDate}` or `{archiveTime}`.

## Sanitization and Windows compatibility

Normalize every generated path component centrally.

Required behavior:

- replace `< > : " / \\ | ? *` and control characters;
- remove trailing dots and spaces;
- collapse repeated whitespace and separators;
- reject empty components;
- protect Windows device names including `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, and `LPT1`–`LPT9`, case-insensitively;
- normalize Unicode consistently;
- cap component length while preserving the sequence and extension;
- cap the final archive path to a conservative cross-platform length;
- avoid names differing only by case;
- avoid names differing only by Unicode normalization;
- never create `.` or `..` path components.

Suggested fallback component:

```text
untitled_{sequence}
```

## Collision algorithm

Build an archive naming plan before downloads:

```js
planArchiveNames(finalItems, namingSettings, adapterContext)
```

Suggested process:

1. sort and freeze the final selected item order;
2. determine the true extension for every item;
3. render the selected preset/template without extension;
4. sanitize each component;
5. derive a normalized, case-insensitive stem key;
6. reserve the stem globally;
7. if occupied, append `_000002`-style global sequence or a deterministic collision index;
8. append the true extension;
9. reserve the complete normalized path globally;
10. store the result in an immutable `archiveNameByItemKey` map;
11. use that map for downloads, ZIP creation, UI preview, retries, manifests, and every ZIP part.

Do not generate names independently inside download workers or ZIP-part loops.

The collision resolver must be deterministic. The same ordered item set and settings must produce the same names in every target runtime.

## Manifest additions

Each manifest record should include:

```text
archive_filename
archive_stem
original_filename
naming_preset
naming_template
source_label
source_timestamp
naming_timezone
collision_resolved
collision_index
```

Do not expose private account data merely to create a source label. Use only adapter context already intended for archive metadata.

## Comment export naming

Reddit generated exports must also use the shared naming service.

Default package-level names may remain recognizable:

```text
comments.json
comments.md
comments.csv
```

If more than one Reddit thread/export group exists in one archive, use source context plus sequence:

```text
post-title_000001_comments.json
post-title_000001_comments.md
post-title_000001_comments.csv
```

Generated comment documents and binary media must participate in complete-path collision detection.

## Required regression and unit tests

### Exact old regression

Input items in one selected archive:

```text
one.jpg
one.jpeg
one.png
```

Numbered expected output:

```text
000001.jpg
000002.jpeg
000003.png
```

Forbidden output:

```text
000001.jpg
000001.jpeg
000001.png
```

### Additional required cases

- sequence remains continuous across photo, GIF, video, and comment document items;
- sequence does not restart in ZIP part 002;
- identical source timestamps receive unique stems;
- repeated original filenames receive unique stems;
- `.jpg` and `.JPG` are collision-checked case-insensitively;
- names differing only by case remain unique;
- names differing only by Unicode normalization remain unique;
- Windows reserved names are sanitized;
- invalid Windows characters are sanitized;
- trailing dots and spaces are removed;
- very long source/channel/board/post labels remain valid;
- missing source label falls back safely;
- unknown timestamp falls back safely;
- true extensions remain unchanged;
- generated Reddit JSON/Markdown/CSV files remain collision-safe;
- preview names exactly match final ZIP names;
- retries reuse the same planned name;
- userscript, Chromium, and Firefox produce the same naming plan for the same fixture.

## Integration into the main roadmap

Treat this document as a required sub-plan of these implementation phases:

### Phase 0

Add the old 5.x Windows collision report as a permanent fixture and acceptance baseline.

### Phase 1

Create the shared naming domain/service and move current `uniqueArchiveName` behavior behind it. The shared implementation must not depend on Tampermonkey, Chromium, or Firefox APIs.

### Phase 2

Add the clean File naming UI, preview, presets, advanced template disclosure, persistent settings, and final-selection integration.

### Phase 3

Verify identical naming behavior across all three outputs:

- `media-archiver.user.js`;
- Chromium extension package;
- Firefox extension package.

### Phases 4 and 5

Have Pinterest and Reddit adapters supply safe source labels and timestamp context through the adapter contract. They must not implement their own filename generation.

### Phase 6

Run all naming tests in CI, document presets, and include generated naming previews in UI tests.

## Definition of done

Naming work is complete when:

- no two archived items share the same normalized stem;
- numbering is global over the complete final selection and all ZIP parts;
- users can choose Numbered, Date/time, Source+date+number, Original+number, or an advanced template;
- the default remains simple and safe;
- previews match actual archive contents;
- true extensions are preserved;
- Windows extraction and downstream import workflows have no ambiguous duplicate stems;
- the same naming code and settings work in the userscript, Chromium extension, and Firefox extension;
- all regression, unit, fixture, and UI tests pass.
