# Copilot instructions

This repository builds a modular Media Archiver product. The current production artifact is a Tampermonkey userscript; the approved next phase adds shared browser-extension targets, a manual media-library picker, Pinterest, Reddit comment-thread export, one collision-safe archive naming system, structured diagnostics, and one-second live statistics.

Core modules live in `src/core/`, site integrations live in `src/adapters/`, and `npm run build` currently creates `media-archiver.user.js` from the two JSON manifests.

The required delivery targets are all first-class outputs from one shared source tree:

1. universal userscript;
2. Chromium extension;
3. Firefox extension.

## Mandatory context

Before changing files, read these as authoritative context:

1. `AGENTS.md`
2. `SECURITY.md`
3. `docs/PROJECT_CONTEXT.md`
4. `docs/CURRENT_STATE_AUDIT.md`
5. `docs/IMPLEMENTATION_PLAN.md`
6. `docs/NAMING_SYSTEM.md`
7. `docs/DIAGNOSTICS_AND_LIVE_STATS.md`
8. `docs/ROADMAP_REQUIREMENTS_CHECKLIST.md`
9. `docs/ARCHITECTURE.md`
10. `docs/ADAPTERS.md`
11. `docs/TESTING.md`

For a fresh coding-agent session, use `docs/AI_HANDOFF_PROMPT.md`.

When editing code:

- Keep the product title and shared core site-neutral.
- Put hostnames, selectors, timestamps, URL normalization, and terminology in adapters.
- Do not introduce token, cookie, credential, or authenticated internal API access.
- Collect only content already represented in the rendered page or explicitly loaded by a safe user action.
- Keep adapter connection permissions minimal and mirror them in runtime URL validation.
- Keep filtering and final manual selection as separate concepts.
- Keep archive naming centralized in shared code; adapters may supply source context but must not generate filenames independently.
- Plan every final filename before downloads begin and reuse the plan for preview, retries, manifests, and every ZIP part.
- Keep sequence numbering global across the final selection, media types, generated documents, workers, and ZIP parts.
- Never reuse a normalized filename stem for different extensions; `000001.jpg`, `000001.jpeg`, and `000001.png` in one archive is forbidden.
- Preserve true file extensions and enforce cross-platform/Windows-safe naming.
- Preserve the built-in ZIP fallback.
- Treat timelines as virtualized and asynchronous.
- Treat the slow visible counters observed in the current 6.0 userscript as a regression.
- During active foreground work, update DOM-visible primary statistics at least once per second.
- Do not rebuild the full media grid/list or reload thumbnails on the one-second metric heartbeat.
- Keep live metrics in shared runtime-neutral state and refresh immediately at phase completion and on return from a hidden tab.
- Store logs as structured diagnostic events rather than DOM text only.
- Keep Activity concise and put technical details behind Developer logs.
- Provide selectable logs, one-click Copy, and a sanitized Markdown report download.
- Use stable diagnostic error codes and redact signed URL parameters, credentials, private content, and local paths by default.
- Keep setup, library/media, and activity concerns separated in the UI.
- Keep the File naming UI simple by default and expose templates only under an advanced disclosure.
- Never add changelog or release-note content to the panel.
- Use English for UI strings and logs until localization exists.
- Preserve keyboard accessibility and reduced-motion behavior.
- Keep the userscript, Chromium extension, and Firefox extension behavior aligned.
- Update all version declarations and `CHANGELOG.md` for releases.
- Run `npm test` after edits.

Do not edit the generated `media-archiver.user.js` directly. Implement source changes in source modules and build scripts.
