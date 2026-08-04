# Release process

1. Update the userscript metadata `@version`.
2. Update the internal `VERSION` constant to the same value.
3. Run `npm run build` and verify the generated root file.
4. Add a dated entry to `CHANGELOG.md`.
5. Run `npm test`.
6. Complete the manual smoke test in Firefox and a Chromium browser.
7. Confirm both ZIP engines:
   - `fflate` available
   - built-in fallback with the CDN blocked
8. Commit with a message such as `release: v5.7.0`.
9. Create a matching Git tag and GitHub release when the repository release process is enabled.

The root `discord-media-archiver.user.js` file is the release artifact.
