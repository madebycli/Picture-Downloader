# Security policy

Media Archiver runs with elevated browser download permissions. The trust boundary is intentionally narrow and identical across the userscript, Chromium extension, and Firefox extension.

## Prohibited behavior

- reading, requesting, exporting, logging, or persisting tokens, cookies, Authorization headers, credentials, or account secrets;
- calling undocumented authenticated Discord, Pinterest, or Reddit APIs to enumerate content;
- posting, messaging, voting, reacting, following, joining, or performing any other account mutation;
- scraping arbitrary linked third-party pages for additional media;
- accepting a download URL outside the active adapter allowlist;
- placing private message/comment bodies or personal source labels in diagnostics by default;
- loading remotely executed JavaScript in extension packages.

## Rendered-content rule

Adapters collect only records and media represented in the current rendered page. A future adapter may explicitly trigger a safe DOM-only expansion action, but it must be user-controlled, documented, testable, and incapable of account mutation. The current Reddit adapter does not expand replies automatically.

## Permission model

`src/adapters/manifest.json` is the reviewed permission source. It generates:

- userscript `@match` and `@connect` metadata;
- extension content-script matches;
- Chromium host permissions;
- Firefox host permissions;
- extension background request allowlists.

Every URL is checked again by the active adapter, and extension requests are checked a third time in the background runtime. Extension fetches use `credentials: 'omit'` and `referrerPolicy: 'no-referrer'`.

## Diagnostics privacy

The structured diagnostics store redacts or omits:

- query strings and fragments;
- signed CDN parameters;
- cookies, Authorization values, tokens, and secrets;
- private message/comment text;
- usernames and private source labels;
- local filesystem paths;
- unnecessary extension IDs;
- full sensitive URLs when host/path classification is sufficient.

Downloaded Markdown reports include a redaction notice and are intended to be safe to attach to a public issue by default. Users should still review reports before publishing.

## Generated comment exports

Reddit comment bodies belong in the user-requested archive documents, not in diagnostics. Only manually selected rendered comments are exported. Generated comment documents are produced locally and do not create network requests.

## Extension content policy

Packaged extensions contain only repository-built local JavaScript. `scripts/check-extension.mjs` rejects remote script imports and userscript `@require` metadata in extension output. The userscript may still use the optional reviewed `fflate` CDN dependency; when unavailable, the built-in ZIP writer is used.

## Reporting

Report security concerns privately with the smallest sanitized reproduction possible. Never include real tokens, cookies, private signed URLs, personal messages/comments, or private browser snapshots.
