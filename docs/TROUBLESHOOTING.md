# Troubleshooting

## The interface does not appear

The current URL must match an installed adapter and pass its runtime page check. Open a Discord channel/thread, a supported deterministic Pinterest surface, or a Reddit post-detail comment thread. Unsupported pages intentionally inject nothing.

For extensions, click the toolbar action on a supported page. If nothing opens, reload the page after installing/updating the extension so its content script is present.

## Review mode opened but no files downloaded

This is expected until **Archive selected** is pressed. Closing the Library, pressing Escape, clicking the backdrop, or choosing **Close without downloading** never starts original requests.

Confirm that at least one card is both eligible and selected. Filtered, non-canonical, or manually deselected items cannot enter the archive.

## Selection changed after filtering or sorting

Explicit selection is keyed and should persist. Filters only change the current view. **Select all visible** and Ctrl/Cmd+A affect the current eligible view; **Select all eligible** affects the complete eligible collection. Shift ranges follow the current visible sort/filter order.

## A stopped scan opened a partial Library

In Review mode, a manual stop intentionally opens the Library for the canonical items found so far. No original files were requested during scanning. Closing it preserves the partial collection until reset.

## Counters appear stale

During active foreground scanning, download, or ZIP work, primary counters should refresh every 750 ms and remain at most one second behind. Returning from a hidden tab triggers an immediate exact refresh. If visible values remain stale longer, download the sanitized Developer report and include the stable code/event timeline in an issue.

## Pinterest date controls are missing

Pinterest date filtering is disabled intentionally because reliable rendered source timestamps are not consistently available on the initial supported surfaces. Media discovery still uses the existing scan modes and rendered-grid boundaries.

## Pinterest items repeat while scrolling

Masonry layouts can render the same Pin multiple times. Media Archiver merges repeated Pin/media canonical keys and shows a duplicate-merged count. If distinct files are incorrectly merged, include a sanitized DOM fragment and rendered host/path pattern—not a private signed URL.

## Reddit does not activate

Open a post-detail URL under `/r/<subreddit>/comments/<post>/...`. Home, Popular, subreddit/search feeds, recommendations, and For You pages are intentionally unsupported.

## Reddit exports omit a comment

Only comments currently rendered and manually selected are exported. Collapsed or unloaded replies are not enumerated through APIs. Expand them yourself in the normal page UI, then scan again. Media Archiver does not automatically click reply-expansion controls.

## ZIP creation is slow

When `fflate` is unavailable, the dependency-free ZIP32 STORE writer is used. It yields during large checksums but is slower. Keep the page open. The fallback remains required for Firefox/Tampermonkey and restrictive extension environments.

## ZIP downloads are blocked

Allow downloads or multiple downloads for the page/extension. Completed ZIP parts remain valid after a stop. Check Developer logs for `ZIP_DOWNLOAD_BLOCKED` or `RUNTIME_SAVE_FAILED`.

## A media URL is rejected

The active adapter or extension background allowlist rejected an undeclared host. This is a security boundary. A legitimate new rendered media host requires an adapter-manifest change, runtime allowlist update generated from it, tests, and review.

## Copy fails

The report remains visible and selectable. Copy it manually. The event uses `RUNTIME_CLIPBOARD_FAILED`; downloaded Markdown uses the same sanitized event source.

## Naming validation fails

Open **Customize**, correct unsupported tokens or invalid template syntax, or reset to **Numbered — newest to oldest**. Final names are planned before any selected original is requested. Preview names and ZIP names use the same immutable plan.

## Extension installation

Chromium development packages must be extracted and loaded unpacked. Firefox temporary packages are loaded through `about:debugging`; permanent Firefox installation requires signing. Rebuild after adapter permission changes and reload the extension/page.
