# Testing

## Automated validation

Run:

```bash
npm test
```

This verifies assembly, generated adapter metadata, JavaScript syntax, version alignment, adapter-registry markers, generic product naming, the new tabbed UI, ZIP fallbacks, and prohibited credential/API patterns.

## Browser matrix

Test current:

- Firefox + Tampermonkey
- Chrome or Edge + Tampermonkey

Run once with `fflate` available and once with its CDN blocked to force the built-in ZIP writer.

## Adapter activation

For every adapter:

- supported pages inject one Media Archiver panel
- unsupported pages inject nothing
- the correct site badge appears
- every discovered download URL passes the adapter allowlist
- undeclared hosts are rejected

## Interface

Confirm:

- persistent phase, progress, and primary metrics remain visible
- Setup groups related media, date, scan, and archive controls
- Media shows detailed counters and item rows
- Activity contains operational messages and Clear works
- no changelog or release-note section appears
- action buttons remain visible and disabled states are correct
- collapse/expand and narrow-screen layout work

## Media and filters

Test each category alone and mixed:

- photos/native GIFs
- videos
- rendered GIF previews

Test date filter disabled, From through latest, and a specific inclusive To date. An entry outside the range or disabled by type must never enter a ZIP.

## Scan modes

Test:

- end → start
- current → start
- current → end
- full timeline current → start → end

Confirm delayed start/end loading is detected, date boundaries stop safely, and duplicate entries are not created during virtualized re-rendering.

## Stop and final position

Stop during scanning and during downloads. Confirm completed ZIP parts remain valid. Test final position at timeline end, scan end, and starting anchor, including an anchor that has been unloaded.

## ZIP output

Confirm:

- newest-to-oldest continuous numbering
- true extensions
- multiple ZIP parts
- `manifest_part.csv` content and `item_id` column
- retry/error states
- large-file responsiveness in Firefox

## Discord adapter regression set

Use a channel or thread containing an image, native GIF, video, and rendered external GIF preview. Verify attachment URL normalization, proxy-host handling, snowflake fallback timestamps, and virtual message-list boundary behavior. Also confirm no token access and no `discord.com/api` calls.
