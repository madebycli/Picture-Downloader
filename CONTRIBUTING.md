# Contributing

## Before changing code

Read:

- `AGENTS.md`
- `docs/PROJECT_CONTEXT.md`
- `docs/ARCHITECTURE.md`
- `docs/DECISIONS.md`

## Development workflow

1. Create a focused branch.
2. Edit the ordered source files in `src/parts/`.
3. Run `npm run build` to regenerate `discord-media-archiver.user.js`.
4. Update documentation for behavior changes.
5. Update both version declarations for a release.
6. Run `npm test`.
7. Manually test Firefox and Chromium.
8. Open a pull request using the repository template.

## Pull-request expectations

Describe:

- the observed problem
- the exact Discord DOM or URL pattern involved
- browsers tested
- media types tested
- scan mode and date-range behavior tested
- ZIP engine tested
- memory or performance impact

Do not submit code that extracts user tokens, calls internal authenticated Discord endpoints, sends account actions, or scrapes arbitrary external websites.
