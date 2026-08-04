# Testing guide

## Automated validation

Run:

```bash
npm test
```

This performs JavaScript syntax validation and repository-specific invariant checks.

## Required manual environments

- Firefox on Windows 11 with Tampermonkey
- Current Chrome or Edge with Tampermonkey
- Optional: Firefox with the `fflate` CDN deliberately blocked

## Smoke test

1. Install the userscript.
2. Open a Discord channel containing at least one image and one video.
3. Verify the panel appears.
4. Disable automatic ZIP creation.
5. Run a short current-position scan.
6. Verify counters and media list entries.
7. Click CREATE ZIP NOW.
8. Open the ZIP and verify numbered files plus `manifest_part.csv`.

## Media matrix

| Case | Expected result |
| --- | --- |
| JPG/PNG/WebP attachment | Photo count increments; original extension preserved |
| Native GIF attachment | Photo/GIF count increments; `.gif` preserved |
| MP4/WebM/MOV attachment | Video count increments; extension preserved |
| Uncommon video rendered in `<video>` | Classified as video |
| Klipy/Tenor/Giphy rendered preview | External GIF preview count increments; proxy file saved |
| YouTube embed | Ignored |
| Same file exposed as link and image | One media entry only |

## Filter matrix

Test every type switch alone and in combinations. Confirm that Total found remains constant while Selected for ZIP changes.

For date ranges:

- From date through latest
- One-day range
- Multi-day fixed range
- End earlier than start: START must be disabled and an error shown
- Media exactly at local midnight boundaries
- Unknown timestamp while date filter is enabled: excluded

## Scan matrix

- Newest → oldest
- Current → oldest
- Current → newest
- Full current → oldest → newest

Test each with:

- no date filter
- date boundary reached before physical channel boundary
- slow network loading
- STOP during scrolling

## Final-position matrix

- Jump to newest after scan/ZIP
- Stay at scan end
- Return to starting position

Confirm that Discord virtual-list reflow does not leave “Jump to newest” several messages above the newest message.

## ZIP matrix

- `fflate` available: log reports fast engine
- `fflate` unavailable: log reports built-in fallback
- More than one ZIP part
- Mixed image/video part
- A part near the configured byte limit
- STOP during download
- Browser prompt for multiple downloads

## Regression checks

- No Discord token access
- No calls to `discord.com/api`
- No arbitrary external hosts in `@connect`
- Newest-to-oldest numbering remains continuous across parts
- Manifest entries match archive files
