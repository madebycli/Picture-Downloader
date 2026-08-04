# Security policy

## Scope

Security-sensitive areas include:

- Discord authentication or account data
- unexpected network hosts
- arbitrary external-page scraping
- unsafe filename handling
- ZIP corruption or path traversal
- excessive memory allocation

## Design guarantees

The userscript is intended to:

- avoid Discord user-token access
- avoid authenticated internal Discord APIs
- fetch only declared Discord CDN/proxy hosts
- sanitize generated filenames
- place flat numbered filenames and a manifest in ZIP parts
- keep external GIF handling limited to Discord-rendered proxy media

## Reporting

Report security concerns through a private repository issue with enough detail to reproduce the problem. Do not include Discord tokens, cookies, signed URLs that expose private content, or personal message data.
