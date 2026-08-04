# AGENTS.md

## Mission

Maintain a browser-only Tampermonkey userscript that archives media visible in Discord’s web client. Reliability on large virtualized message lists is more important than cleverness.

## Canonical file

`src/parts/*.user.js.part` contains the ordered source segments. `npm run build` assembles the installable root file `discord-media-archiver.user.js`. Keep the parts lexically ordered and never edit the generated root without reflecting the same change in the parts.

## Non-negotiable constraints

1. Never extract, request, log, or persist a Discord user token.
2. Never use Discord’s undocumented/internal authenticated API endpoints.
3. Never automate sending messages, reactions, friend actions, or other account actions.
4. Only collect media that the Discord page has rendered for the signed-in user.
5. Keep external-site handling limited to Discord-rendered proxy media. Do not scrape external GIF websites.
6. Ignore YouTube and ordinary external video links.
7. Preserve original attachment extensions. Do not rename MP4 data to `.gif`.
8. Preserve newest-to-oldest sequence numbering across ZIP parts.
9. A disabled media type or out-of-range date must never enter a ZIP.
10. Browser compatibility must include current Firefox and Chromium-based browsers with Tampermonkey.

## Important behavior

- Discord attachments use `cdn.discordapp.com` or `media.discordapp.net` attachment paths.
- External GIF previews use Discord’s `images-ext-1.discordapp.net` or `images-ext-2.discordapp.net` proxy.
- The optional `fflate` dependency is a speed optimization, not a hard requirement.
- The built-in ZIP32 STORE writer is the required fallback.
- Date ranges use the browser’s local calendar days and are inclusive.
- Message dates come from `time[datetime]`; Discord snowflakes are the fallback.
- The scanner must wait at possible list boundaries before declaring completion.
- Discord virtual-list reflow can move the viewport. Final-position correction must remain defensive.

## Change rules

- Increment both the userscript `@version` and the internal `VERSION` constant.
- Update `CHANGELOG.md` for user-visible behavior.
- Run `npm test` before committing.
- Keep user-facing UI and logs in English unless a future localization system is introduced.
- Prefer focused helper functions over duplicating DOM or filter logic.
- Avoid unbounded concurrency and large in-memory duplicate buffers.
- When adding a media source, document its host, detection rule, output format, and security boundary.

## Testing priorities

Always test at least:

- Firefox + Tampermonkey with the `fflate` CDN blocked
- Chromium + Tampermonkey with `fflate` available
- Photos only, videos only, external GIF previews only, and mixed media
- Fixed date range and “latest available”
- Current → older, current → newer, newest → older, and full two-pass scan
- Stop during scanning and stop during media download
- More than one ZIP part
- Final position: newest, scan end, and starting position

See `docs/TESTING.md` for the full matrix.
