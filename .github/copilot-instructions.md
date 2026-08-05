# Copilot instructions

This repository builds a modular Media Archiver product. The current production artifact is a Tampermonkey userscript; the approved next phase adds shared browser-extension targets, a manual media-library picker, Pinterest, and Reddit comment-thread export.

Core modules live in `src/core/`, site integrations live in `src/adapters/`, and `npm run build` currently creates `media-archiver.user.js` from the two JSON manifests.

## Mandatory context

Before changing files, read these as authoritative context:

1. `AGENTS.md`
2. `SECURITY.md`
3. `docs/PROJECT_CONTEXT.md`
4. `docs/CURRENT_STATE_AUDIT.md`
5. `docs/IMPLEMENTATION_PLAN.md`
6. `docs/ARCHITECTURE.md`
7. `docs/ADAPTERS.md`
8. `docs/TESTING.md`

For a fresh coding-agent session, use `docs/AI_HANDOFF_PROMPT.md`.

When editing code:

- Keep the product title and shared core site-neutral.
- Put hostnames, selectors, timestamps, URL normalization, and terminology in adapters.
- Do not introduce token, cookie, credential, or authenticated internal API access.
- Collect only content already represented in the rendered page or explicitly loaded by a safe user action.
- Keep adapter connection permissions minimal and mirror them in runtime URL validation.
- Keep filtering and final manual selection as separate concepts.
- Keep numbering newest-to-oldest and continuous across ZIP parts.
- Preserve the built-in ZIP fallback.
- Treat timelines as virtualized and asynchronous.
- Keep setup, library/media, and activity concerns separated in the UI.
- Never add changelog or release-note content to the panel.
- Use English for UI strings and logs until localization exists.
- Preserve keyboard accessibility and reduced-motion behavior.
- Update all version declarations and `CHANGELOG.md` for releases.
- Run `npm test` after edits.

Do not edit the generated `media-archiver.user.js` directly. Implement source changes in source modules and build scripts.
