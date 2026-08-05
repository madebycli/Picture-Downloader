## Summary

Describe the user-visible change and the problem it solves.

## Adapter context

- Adapter/site:
- Supported page type:
- Relevant DOM or URL pattern:
- Media type:
- Scan direction/date filter:

## Architecture

- [ ] Site-specific behavior remains in an adapter
- [ ] Adapter manifest and runtime allowlist agree
- [ ] Product name and core remain site-neutral
- [ ] Runtime UI contains no changelog/release-note content

## Testing

- [ ] `npm test`
- [ ] Firefox + Tampermonkey
- [ ] Chromium + Tampermonkey
- [ ] `fflate` fast path
- [ ] Built-in ZIP fallback
- [ ] Supported and unsupported pages
- [ ] Stop and final-position behavior, when relevant

## Safety

- [ ] No credentials or token access
- [ ] No authenticated internal API calls
- [ ] No arbitrary external-page scraping
- [ ] Host permissions remain minimal
