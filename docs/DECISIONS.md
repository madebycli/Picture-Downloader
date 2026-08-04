# Engineering decisions

## 001 — DOM-only Discord integration

**Decision:** Work from the rendered Discord web interface instead of a user token or internal authenticated API.

**Reason:** Reduces account risk, avoids token handling, and keeps the tool aligned with content the user can already see.

**Consequence:** Scanning depends on scrolling and Discord DOM stability.

## 002 — Original attachment URL normalization

**Decision:** Convert `media.discordapp.net/attachments/...` to `cdn.discordapp.com/attachments/...` and remove display-size/conversion query parameters while preserving signed parameters.

**Reason:** Avoid saving resized previews when the original attachment is available.

## 003 — External GIF previews are a separate category

**Decision:** Treat rendered external GIF previews separately from native GIF attachments and videos.

**Reason:** They originate from an external page link but are delivered through Discord’s proxy, and the actual file is commonly MP4.

## 004 — No external-site scraping

**Decision:** Do not open or scrape Klipy, Tenor, Giphy, YouTube, or other external websites.

**Reason:** Keeps host permissions narrow and avoids fragile provider-specific scraping.

## 005 — Local-day date ranges

**Decision:** Interpret date inputs as full calendar days in the browser’s local timezone.

**Reason:** Matches how users choose dates in an HTML date input.

## 006 — Newest-to-oldest archive numbering

**Decision:** Sort selected entries newest to oldest and use continuous six-digit numbering across ZIP parts.

**Reason:** Gives deterministic ordering independent of ZIP-part boundaries.

## 007 — Optional fast ZIP dependency plus mandatory fallback

**Decision:** Use `fflate` when available but retain a built-in ZIP32 STORE writer.

**Reason:** Firefox/Tampermonkey or network filters can block the CDN dependency. ZIP creation must still work.

## 008 — STORE rather than recompressing media

**Decision:** Store image and video bytes without DEFLATE compression.

**Reason:** These formats are already compressed; recompression costs CPU and memory with little benefit.

## 009 — Defensive chat-boundary confirmation

**Decision:** Wait and rescan before accepting a top or bottom boundary.

**Reason:** Discord’s virtualized list can temporarily appear complete while older or newer messages are still loading.
