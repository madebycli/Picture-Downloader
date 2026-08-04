# Troubleshooting

## “fflate did not load” or no ZIP on Firefox

Use version 5.6 or newer. The userscript now searches multiple Tampermonkey scopes for `fflate` and falls back to a built-in ZIP writer. The fallback log says:

```text
ZIP engine: fflate is unavailable. Using the built-in Firefox-safe ZIP fallback.
```

The fallback is slower for large videos but does not need a CDN.

## The scan ends too early

- Use the full two-pass mode when starting in the middle.
- Keep the tab visible when possible.
- Verify the chosen date range; the scanner stops after passing the selected date boundary.
- Check the live log for “Date boundary reached” versus physical chat-boundary confirmation.

## The final viewport is not at the newest message

Choose **Jump to newest after scan / ZIP**. The script applies repeated bottom positioning after Discord’s virtual list settles. A Discord web update can still require selector or timing changes.

## Photos found is larger than ZIP saved

The type counters show everything discovered during scrolling. Compare:

- Total found
- In date range
- Excluded by date
- Selected for ZIP
- ZIP saved

`ZIP saved` should match `Selected for ZIP` when Errors is zero.

## External GIF link is skipped

External GIF previews are only available when Discord renders an animated preview in the DOM. A plain external link without a preview has no Discord proxy media file to save.

## ZIP parts do not all download

Allow multiple downloads for Discord in the browser. Check the browser download panel and popup-blocking indicator.

## Memory usage is high

Videos are buffered in memory before each ZIP part is built. Reduce the date range, disable videos, or process smaller sections of the channel.
