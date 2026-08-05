# Security policy

Media Archiver runs with Tampermonkey privileges and can download files from hosts declared by installed site adapters. Changes must therefore preserve a narrow trust boundary.

## Prohibited behavior

- reading or exporting account tokens, cookies, authorization data, or browser credentials
- calling undocumented authenticated APIs to enumerate private content
- sending messages, reactions, posts, follows, or other account actions
- scraping arbitrary linked third-party pages
- accepting download URLs outside the active adapter's allowlist
- logging private source URLs, personal content, or credentials unnecessarily

## Required adapter controls

Every adapter must:

- activate only on explicit `@match` patterns
- declare the minimum required `@connect` hosts
- validate every requested download URL at runtime
- collect only media represented in the rendered page
- document selectors, timestamp logic, and external-source boundaries

The included Discord adapter additionally forbids Discord user-token access and authenticated internal Discord API calls.

## Reporting

Report security concerns privately with enough sanitized detail to reproduce the issue. Do not include tokens, cookies, private signed URLs, or personal message content.
