# Architecture

## Runtime model

The ordered files in `src/parts/` are concatenated without transformation into the root userscript. The userscript then runs inside Tampermonkey on Discord channel URLs. It injects a fixed control panel into the page and coordinates four main subsystems:

1. DOM scanner
2. scan/scroll controller
3. media downloader
4. ZIP/archive writer

## Data model

Media entries are stored in a `Map` keyed by a canonical source identity. Each entry includes:

- source URL and preview URL
- filename and media type
- source kind and optional source page URL
- message ID and timestamp
- discovery order
- processing status, error, size, and ZIP part

The Map prevents duplicate downloads when Discord exposes the same media through multiple DOM elements or refreshes a signed URL.

## DOM scanner

The scanner looks for:

- Discord attachment anchors and media elements with `/attachments/` URLs
- semantic message containers and message timestamp elements
- external GIF embed contexts with `aria-label="GIF"`, known GIF-page links, and `data-safe-src`

Stable signals are preferred over generated Discord CSS class names.

## Scroll controller

The controller finds the main chat scroller, then moves in overlapping steps. It scans before and after movement. At a possible top or bottom boundary, it waits for Discord to load additional virtualized messages before declaring completion.

The controller also supports:

- current-position starting anchors
- date-boundary early stopping
- final viewport restoration or forced newest positioning

## Filtering

Filtering is applied after discovery and before ZIP creation:

- media-type filter
- date-range filter

Counters intentionally distinguish all discovered media from media inside the date range and media selected for ZIP.

## Download layer

`GM_xmlhttpRequest` fetches ArrayBuffers from allowed Discord CDN/proxy hosts. Requests use bounded parallelism and retries for transient failures.

Native Discord image URLs are normalized from media proxy to CDN and preview parameters are removed. Signed parameters are retained.

## ZIP layer

### Fast path

If an `fflate` UMD global is available, `zipSync(..., { level: 0 })` creates a STORE archive quickly.

### Fallback path

A built-in ZIP32 STORE writer calculates CRC32, writes local headers, central-directory records, and the end record. It yields to the event loop during large CRC calculations to keep Firefox responsive.

Both paths return a Blob with identical archive semantics.

## UI layer

The panel shows:

- state and progress
- discovery/filter/archive counters
- type/date/direction/final-position controls
- media list with status icons
- live logs
- start, stop, ZIP-now, reset, and ZIP-redownload actions

## Security boundary

The userscript may fetch only declared Discord CDN/proxy hosts. It does not access Discord authentication storage, internal API endpoints, message composition, or account actions.
