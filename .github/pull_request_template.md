## Summary

Describe the user-visible change and the problem it solves.

## Discord context

- Channel or thread:
- Relevant DOM/URL pattern:
- Media type:
- Scan direction:
- Date filter:

## Testing

- [ ] `npm test`
- [ ] Firefox + Tampermonkey
- [ ] Chromium + Tampermonkey
- [ ] `fflate` fast path
- [ ] Built-in ZIP fallback
- [ ] More than one media type or ZIP part, when relevant
- [ ] Stop and final-position behavior, when relevant

## Safety

- [ ] No Discord token access
- [ ] No internal authenticated Discord API calls
- [ ] No arbitrary external-site scraping
- [ ] Host permissions remain minimal
