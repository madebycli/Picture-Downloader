# Release process

1. Make source changes in `src/core/` or `src/adapters/`.
2. Update adapter/build manifests when modules or permissions change.
3. Update the metadata version, runtime `VERSION`, and `package.json` together.
4. Add user-visible changes to `CHANGELOG.md`; do not add release notes to the runtime UI.
5. Run `npm test`.
6. Test Firefox and Chromium, both ZIP engines, and every affected adapter.
7. Review generated `@match` and `@connect` metadata.
8. Commit the generated `media-archiver.user.js` with the source changes.
9. Merge only after GitHub Actions succeeds.

The root `media-archiver.user.js` file is the installable release artifact.
