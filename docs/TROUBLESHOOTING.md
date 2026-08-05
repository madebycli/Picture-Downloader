# Troubleshooting

## The panel does not appear

The current page must match an entry in `src/adapters/manifest.json`, and the corresponding runtime adapter must accept the location. Open a supported content page rather than a settings, login, or landing page.

## Nothing is collected

Open the Media tab while scanning. Confirm the active page has rendered media, at least one media category is enabled, and the adapter still recognizes the site's current DOM and URLs.

## Date-filtered entries are missing

Dates use local browser calendar days. Entries without a resolvable adapter timestamp are excluded while the filter is enabled. Check Activity for date-boundary messages.

## The scan ends too early

Virtual timelines can pause at apparent boundaries. Media Archiver waits before confirming them, but a site update can require adapter timing or selector changes. Include the active adapter and Activity messages in a bug report.

## The final position is not exact

Choose the desired completion position in Setup. Virtualized pages may unload the original anchor or move after render; the scanner applies repeated correction and can fall back to an approximate scroll ratio.

## ZIP creation is slow

When `fflate` is unavailable, the built-in ZIP writer is used. It is intentionally dependency-free and yields during large checksums, but can be slower. Keep the page open until completion.

## ZIP downloads are blocked

Allow multiple downloads for the active site in the browser. Check the browser download panel and popup-blocking indicator.

## A media URL is rejected

The active adapter blocks hosts not declared in its allowlist. This is intentional. A legitimate new host requires a reviewed adapter manifest and runtime allowlist change.

## Discord-specific notes

The Discord adapter can collect rendered external GIF previews only when Discord creates a proxy media element. A plain external link without a rendered preview has no proxy file to save. Discord web updates can also require selector maintenance inside `src/adapters/discord/`.
