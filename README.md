# Discord Media Archiver

A Tampermonkey userscript that scans the Discord web client, collects media rendered in a channel or thread, and saves the selected files as numbered ZIP parts.

The project is designed for large channels where manually opening and downloading hundreds of files is impractical. It operates on the Discord page currently open in the browser and does **not** read or store a Discord user token.

## Features

- Photos and native animated GIF attachments
- Discord-hosted videos in common container formats
- Rendered previews for external GIF-page embeds such as Klipy, Tenor, and Giphy
- Original Discord attachment URLs instead of resized image previews
- Separate filters for photos/GIFs, videos, and external GIF previews
- Date ranges with an inclusive start and end day, or “latest available”
- Multiple scan directions, including starting from the current position
- Automatic scrolling with delayed-boundary confirmation
- Numbered archive names such as `000001.jpg`, `000002.mp4`, and `000003.gif`
- ZIP splitting by item count and estimated/actual size
- Fast `fflate` ZIP creation when available
- Built-in Firefox-safe ZIP fallback when the external library is blocked
- Live logs, counters, per-item status indicators, stop controls, and final-position controls
- CSV manifest in every ZIP part

## Installation

1. Install Tampermonkey in a supported desktop browser.
2. Open [`discord-media-archiver.user.js`](./discord-media-archiver.user.js).
3. Use GitHub’s **Raw** view, then allow Tampermonkey to install the userscript.
4. Open Discord in the browser and enter the channel or thread to archive.
5. Configure media types, date range, scan direction, and final chat position.
6. Click **START: SCAN + ZIP**.

Because this repository is private, the Raw link requires a GitHub session with access to the repository. Copying the file into a new Tampermonkey script is an alternative.

## Recommended modes

| Goal | Scan mode | Final position |
| --- | --- | --- |
| Archive the latest content back to a date | Newest → oldest | Jump to newest |
| Continue from the current location toward older messages | Current → oldest | Return to starting position or stay at scan end |
| Continue from the current location toward newer messages | Current → newest | Jump to newest |
| Cover a date range while starting in the middle | Full channel: current → oldest → newest | Jump to newest |

## What is downloaded

### Native Discord attachments

Direct attachment URLs from `cdn.discordapp.com/attachments/...` or `media.discordapp.net/attachments/...` are collected. Preview sizing and conversion parameters are removed while Discord’s signed URL parameters remain intact.

### External GIF previews

For supported GIF-page embeds, Discord may render an animated proxy file through `images-ext-1.discordapp.net` or `images-ext-2.discordapp.net`. The userscript downloads that rendered preview. It is commonly an MP4 file even when Discord labels the embed as a GIF.

External pages such as YouTube are not downloaded.

## ZIP output

Files are sorted newest to oldest and named with a six-digit sequence while preserving the actual extension:

```text
000001.mp4
000002.jpg
000003.webp
000004.gif
```

Each ZIP part includes `manifest_part.csv` with the archive filename, original filename, media type, source kind, source page, message ID, timestamp, byte size, and source URL.

## Browser notes

- Allow multiple downloads when the browser asks; large archives are split into several ZIP parts.
- Keep the Discord tab open while scanning and creating ZIPs.
- Firefox may block the optional `fflate` CDN dependency. Version 5.6 includes a built-in ZIP fallback and continues instead of failing.
- Large videos require substantial memory. Reduce the selected range or media types if the browser becomes unstable.
- Discord’s web markup changes over time. Selectors and scan behavior may require maintenance after Discord updates.

## Safety and account use

Use this tool only for media you are authorized to access and save. The userscript intentionally avoids Discord user-token extraction, internal Discord API calls, and automated account messaging. It works by observing and scrolling the web interface that the signed-in user can already see.

## Development

Requirements: Node.js 20 or newer.

```bash
npm test
```

The validation command checks JavaScript syntax, userscript metadata, version consistency, required permissions, important feature markers, and the absence of known token/API access patterns.

See the project context in [`AGENTS.md`](./AGENTS.md) and [`docs/PROJECT_CONTEXT.md`](./docs/PROJECT_CONTEXT.md).

## Current release

`5.6.0` — Firefox-safe ZIP fallback, stable final chat positioning, date filters, native media support, and external GIF preview support.
