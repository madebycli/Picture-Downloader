# Contributing

## Development workflow

1. Create a focused branch.
2. Edit site-neutral behavior in `src/core/` or site behavior in `src/adapters/`.
3. Update `src/adapters/manifest.json` when adapter matches, modules, or download hosts change.
4. Run `npm test` to regenerate and validate `media-archiver.user.js`.
5. Test the affected browser, adapter, media types, scan modes, and ZIP path.
6. Open a pull request using the repository template.

## Adding a site adapter

Follow [`docs/ADAPTERS.md`](./docs/ADAPTERS.md). A new adapter must provide the full adapter contract, explicit metadata permissions, tests, and documentation. Site-specific selectors and URL normalization must remain outside `src/core/`.

## Bug reports

Include:

- userscript version
- active site adapter
- browser and Tampermonkey version
- relevant page type
- media filters, date range, scan direction, and final position
- relevant Activity-tab messages
- exact DOM or URL pattern when safe to share

Remove personal content, signed private URLs, cookies, and credentials.

## Safety

Do not submit code that extracts credentials, calls authenticated internal APIs, performs account actions, or scrapes arbitrary linked websites. Download hosts must be minimal, explicit, and adapter-owned.
