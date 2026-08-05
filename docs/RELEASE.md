# Release process

## Version alignment

Update together:

- userscript metadata version;
- runtime `VERSION`;
- `package.json` version;
- generated Chromium manifest;
- generated Firefox manifest;
- `CHANGELOG.md`;
- release filenames and notes.

Do not place changelog or release notes inside the runtime UI.

## Pre-release commands

```bash
npm install --ignore-scripts
npm test
npx playwright install chromium firefox
npm run test:ui
```

Review generated packages:

```text
media-archiver.user.js
dist/media-archiver-chromium-<version>.zip
dist/media-archiver-firefox-<version>.zip
```

Run `npm run check:reproducible` and record package hashes.

## VirusTotal release gate

Before enabling a release version, confirm automatically that:

- VirusTotal defaults to off;
- missing API keys block the archive before any original request begins;
- hash-only mode never creates an upload request;
- upload-unknown requires current-session consent;
- API keys are absent from diagnostics and result objects;
- malicious/suspicious/unknown policies behave as configured;
- the scan hook runs after the confirmed source download and before ZIP acceptance;
- userscript and extension service hosts are generated from `runtimeConnect` rather than adapter media hosts.

A real API key and real private file must never be placed in repository fixtures or CI secrets merely to exercise this feature. Live VirusTotal testing should use a harmless public fixture and a separately controlled account.

## Manual release gate

Before marking a production release complete, execute and document:

- Firefox + Tampermonkey, with `fflate` blocked;
- Chromium + Tampermonkey, with `fflate` available;
- packaged Firefox extension;
- packaged Chromium extension;
- Discord, Pinterest, and Reddit live regression matrices;
- Reddit native and external comment photos/GIFs/videos;
- optional VirusTotal hash-only lookup with a harmless file;
- optional consent-gated upload with a harmless test file;
- >50 MB single video;
- >=300 MB combined selection;
- cancellation during download and VirusTotal polling;
- Firefox and Chromium memory behavior;
- ZIP save/download permission behavior;
- all final-position choices on real virtualized pages.

Unrun checks remain **Blocked with evidence** or **Deferred with reason** and must not be represented as passed.

## Automated GitHub Release

`.github/workflows/publish-userscript.yml` runs after a qualifying push to `main`:

1. installs tooling;
2. runs `npm test`;
3. refreshes and commits `media-archiver.user.js` when necessary;
4. derives tag `v<package version>`;
5. creates the tag when absent;
6. creates or refreshes the GitHub Release;
7. uploads:
   - `media-archiver.user.js`;
   - Chromium ZIP;
   - Firefox ZIP;
   - `SHA256SUMS.txt`.

The workflow is idempotent for an existing version and replaces assets with the newly validated builds. Store publication and permanent Firefox signing remain separate steps requiring the appropriate store accounts and reviews.

## Pull request contents

The PR body must include architecture changes, user-facing behavior, adapter scopes/exclusions, permission changes, VirusTotal privacy implications, automated results, manual blockers, known risks, artifact links, and the complete requirements status.
