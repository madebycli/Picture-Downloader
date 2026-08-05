# Copilot instructions

This repository builds one modular Tampermonkey userscript. Core modules live in `src/core/`, site integrations live in `src/adapters/`, and `npm run build` creates `media-archiver.user.js` from the two JSON manifests.

Use `AGENTS.md`, `docs/PROJECT_CONTEXT.md`, and `docs/ADAPTERS.md` as authoritative context.

When editing code:

- Keep the product title and core site-neutral.
- Put hostnames, selectors, timestamps, URL normalization, and terminology in adapters.
- Do not introduce token, cookie, credential, or authenticated internal API access.
- Collect only media already represented in the rendered page.
- Keep adapter `@connect` permissions minimal and mirror them in runtime URL validation.
- Keep filtering centralized through `isEntryIncluded`, `mediaTypeIsEnabled`, and date helpers.
- Keep numbering newest-to-oldest and continuous across ZIP parts.
- Preserve the built-in ZIP fallback.
- Treat timelines as virtualized and asynchronous.
- Keep Setup, Media, and Activity concerns separated in the UI.
- Never add changelog or release-note content to the panel.
- Use English for UI strings and logs.
- Update all version declarations and `CHANGELOG.md` for releases.
- Run `npm test` after edits.
