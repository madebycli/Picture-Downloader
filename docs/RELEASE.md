# Release process

## Version alignment

Update together:

- userscript metadata version;
- runtime `VERSION`;
- `package.json` version;
- generated Chromium manifest;
- generated Firefox manifest;
- `CHANGELOG.md`.

Do not place changelog or release notes inside the runtime UI.

## Pre-release commands

```bash
npm install --ignore-scripts
npm test
npx playwright install chromium firefox
npm run test:ui
```

Review generated permissions and packages:

```text
media-archiver.user.js
dist/media-archiver-chromium-<version>.zip
dist/media-archiver-firefox-<version>.zip
```

Run `npm run check:reproducible` and record the package hashes.

## Manual release gate

Before marking a production release complete, execute and document:

- Firefox + Tampermonkey, with `fflate` blocked;
- Chromium + Tampermonkey, with `fflate` available;
- packaged Firefox extension;
- packaged Chromium extension;
- Discord, Pinterest, and Reddit live regression matrices;
- >50 MB single video;
- >=300 MB combined selection;
- cancellation during download;
- Firefox and Chromium memory behavior;
- ZIP save/download permission behavior;
- all final-position choices on real virtualized pages.

Unrun checks must remain **Blocked with evidence** or **Deferred with reason**; they must never be represented as passed.

## Checklist gate

Review `docs/ROADMAP_REQUIREMENTS_CHECKLIST.md` point by point. Every requirement must carry one or more visible statuses:

```text
Implemented
Tested automatically
Tested manually
Deferred with reason
Out of scope with approval
Blocked with evidence
```

## Pull request contents

The PR body must include:

- architecture changes;
- user-facing behavior;
- adapter scopes and exclusions;
- permission changes;
- security/privacy review;
- automated command results;
- manual browser matrix;
- known limitations and risks;
- screenshots or recordings where available;
- links to userscript, Chromium, and Firefox CI artifacts;
- complete requirements status.

## Publishing

The main-branch workflow runs full validation, refreshes the generated userscript when necessary, and uploads all three installable artifacts. Chromium store publication and permanent Firefox signing remain separate distribution steps requiring the relevant store accounts and review processes.
