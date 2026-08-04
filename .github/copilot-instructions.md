# Copilot instructions

This repository builds one production Tampermonkey userscript. Ordered source segments live in `src/parts/*.user.js.part`; `npm run build` creates `discord-media-archiver.user.js`.

Use `AGENTS.md` and `docs/PROJECT_CONTEXT.md` as the authoritative project context.

When editing code:

- Preserve browser-only JavaScript and Tampermonkey compatibility.
- Do not introduce Discord token extraction or authenticated internal API calls.
- Do not add external-page scraping for GIF services; only use media Discord already rendered or proxied.
- Keep native Discord attachments, Discord-hosted videos, native GIFs, and external GIF previews as separate concepts.
- Keep filtering centralized through `isEntryIncluded`, `mediaTypeIsEnabled`, and date-range helpers.
- Keep numbering newest-to-oldest and continuous across ZIP parts.
- Maintain the built-in ZIP fallback even if the `fflate` path changes.
- Avoid assuming stable Discord CSS class names. Prefer semantic attributes, stable IDs, URL patterns, and DOM relationships.
- Treat Discord’s message list as virtualized and asynchronous.
- Use English for UI strings and logs.
- Update both version declarations and `CHANGELOG.md` for releases.
- Run `npm test` after edits.
