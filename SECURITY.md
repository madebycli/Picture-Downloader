# Security policy

Media Archiver runs with elevated browser download permissions. The trust boundary is intentionally narrow and shared across the userscript, Chromium extension, and Firefox extension.

## Prohibited behavior

- reading, requesting, exporting, logging, or persisting site tokens, cookies, Authorization headers, credentials, or account secrets;
- calling undocumented authenticated Discord, Pinterest, or Reddit APIs to enumerate content;
- posting, messaging, voting, reacting, following, joining, or performing any other account mutation;
- scraping arbitrary linked third-party pages for additional media;
- accepting a media URL outside the active adapter allowlist;
- placing private message/comment bodies or personal source labels in diagnostics by default;
- loading remotely executed JavaScript in extension packages.

## Rendered-content rule

Adapters collect only media represented in the current rendered page. The Reddit adapter uses comments solely as DOM containers and timeline anchors. It does not export comment text, expand replies automatically, or request feed/API data.

## Permission model

`src/adapters/manifest.json` is the reviewed media permission source. It generates:

- userscript `@match` and media `@connect` metadata;
- extension content-script matches;
- Chromium and Firefox media host permissions;
- extension background media-request allowlists.

`src/build-manifest.json` separately declares optional runtime service hosts. VirusTotal hosts are never mixed into an adapter's media allowlist. Every URL is checked again in the runtime bridge and extension background. Extension requests use `credentials: 'omit'` and `referrerPolicy: 'no-referrer'`.

## VirusTotal boundary

VirusTotal is disabled by default. Enabling it requires a user-provided API key stored only through the active runtime's local settings storage.

Modes:

- **off** sends nothing;
- **hash-only** sends the locally calculated SHA-256 hash for report lookup;
- **upload-unknown** first performs the hash lookup and uploads the file only when no report exists and the user has selected the current-session consent checkbox.

Standard VirusTotal uploads may be shared with VirusTotal security partners. This is stated beside the consent control and in release documentation. The consent value is not persisted between page sessions.

The API key must never appear in:

- Activity or Developer logs;
- sanitized issue reports;
- exception messages;
- ZIP manifests;
- VirusTotal result objects;
- GitHub Actions logs or release artifacts.

Public-API requests are serialized and cached by SHA-256. Files over the supported 650 MB upload maximum fail with a stable local error before an upload request is attempted. A configured malicious/suspicious verdict blocks the file before it enters a ZIP. Unknown and service-error results follow the explicit allow-or-block setting.

VirusTotal cannot inspect a file before Media Archiver possesses its bytes. Therefore the order is intentionally:

1. Review confirmation, when Review mode is active;
2. original media request;
3. local SHA-256 calculation and optional VirusTotal request;
4. acceptance or rejection before ZIP creation.

No original request occurs merely because the Library was opened, closed, or cancelled.

## Diagnostics privacy

The structured diagnostics store redacts or omits:

- query strings and fragments;
- signed CDN parameters;
- cookies, Authorization values, API keys, tokens, and secrets;
- private message/comment text;
- usernames and private source labels;
- local filesystem paths;
- unnecessary extension IDs;
- full sensitive URLs when host/path classification is sufficient.

Downloaded Markdown reports include a redaction notice and should still be reviewed before publishing.

## Extension content policy

Packaged extensions contain only repository-built local JavaScript. `scripts/check-extension.mjs` rejects remote script imports and userscript `@require` metadata in extension output. The userscript may use the optional reviewed `fflate` CDN dependency; when unavailable, the built-in ZIP writer is used.

## Reporting

Report security concerns privately with the smallest sanitized reproduction possible. Never include real site tokens, VirusTotal API keys, cookies, private signed URLs, personal messages, uploaded private files, or private browser snapshots.
