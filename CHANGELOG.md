# Changelog

All notable user-facing changes are recorded here.

## 5.6.0

- Added Firefox/Tampermonkey-safe ZIP library discovery.
- Added a built-in ZIP32 STORE fallback when `fflate` is unavailable.
- ZIP creation no longer aborts solely because the external CDN dependency failed.

## 5.5.0

- Added final chat-position choices.
- Improved forced return to the newest message after scanning or ZIP creation.
- Clarified Total found, In date range, Excluded by date, Selected for ZIP, and ZIP saved counters.

## 5.4.0

- Added external GIF-preview detection for Discord-rendered Klipy, Tenor, and Giphy embeds.
- Added a separate external-GIF-preview filter and counter.
- Added source kind and source page fields to manifests.

## 5.3.0

- Added inclusive date-range filtering.
- Added From date, fixed To date, and Latest available modes.
- Added date-boundary scan stopping and date tokens in ZIP names.

## 5.2.0

- Expanded Discord-hosted video-format support.
- Added fallback classification for uncommon files rendered in a video element.
- Clarified that native GIFs use the photo/GIF filter.

## 5.1.0

- Added selectable scan directions and current-position starts.
- Added upward, downward, and full two-pass scan modes.

## 5.0.0

- Added separate photo and video selection.
- Added original-quality video downloads and adaptive ZIP grouping.
- Converted the user interface and logs to English.

## Earlier development

Earlier iterations introduced automatic scrolling, original attachment normalization, ZIP parts, numbered filenames, live logs, and per-item status indicators.
