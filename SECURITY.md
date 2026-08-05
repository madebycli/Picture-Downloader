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

Adapters collect only media represented in the current rendered page. Discord navigation changes only the position of its existing rendered virtual timeline. Reddit comments are DOM containers and navigation anchors; comment text is not archived.

The Reddit adapter may activate a narrowly reviewed set of already rendered expansion controls whose accessible text matches comment-loading actions such as **View more comments**, **Load more comments**, **More replies**, or **Continue this thread**. Expansion is subject to all of these rules:

- the control must be visible, enabled, and located inside the rendered comment/main area;
- login, signup, award, share, report, save, follow, join, vote, upvote, and downvote controls are rejected;
- at most eight controls are attempted in one pass;
- the same DOM element is not retried for at least eight seconds;
- no `fetch`, `XMLHttpRequest`, GraphQL, private API, token, cookie, or Authorization path is used;
- expansion only runs while scanning downward through a supported post-detail comment thread.

## Discord jump-scanner boundary

The Discord adapter may set the existing channel scroller directly to its currently loaded start or end. It records the previous edge message ID, waits for the rendered list to settle, and scans again. If Discord virtualizes the previous edge away, the adapter makes a bounded recovery move into the expected overlap and rescans before returning to the edge. This changes navigation speed only; canonical URL deduplication and adapter URL allowlisting remain unchanged.

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

The API key must never appear in Activity or Developer logs, sanitized issue reports, exception messages, ZIP manifests, service result objects, GitHub Actions logs, or release artifacts.

Public-API requests are serialized and cached by SHA-256. Files over the supported 650 MB upload maximum fail locally before an upload request is attempted. A configured malicious/suspicious verdict blocks the file before it enters a ZIP. Unknown and service-error results follow the explicit allow-or-block setting.

VirusTotal cannot inspect a file before Media Archiver possesses its bytes. Therefore the order is intentionally:

1. Review confirmation, when Review mode is active;
2. original media request;
3. local SHA-256 calculation and optional VirusTotal request;
4. acceptance or rejection before ZIP creation.

No original request occurs merely because the Library was opened, closed, or cancelled.

## Diagnostics privacy

The structured diagnostics store redacts or omits query strings, fragments, signed CDN parameters, cookies, Authorization values, API keys, tokens, secrets, private message/comment text, usernames, private source labels, local paths, unnecessary extension IDs, and full sensitive URLs when classification is sufficient.

Downloaded Markdown reports include a redaction notice and should still be reviewed before publishing.

## Extension content policy

Packaged extensions contain only repository-built local JavaScript. `scripts/check-extension.mjs` rejects remote script imports and userscript `@require` metadata in extension output. The userscript may use the optional reviewed `fflate` CDN dependency; when unavailable, the built-in ZIP writer is used.

## Reporting

Report security concerns privately with the smallest sanitized reproduction possible. Never include real site tokens, VirusTotal API keys, cookies, private signed URLs, personal messages, uploaded private files, or private browser snapshots.
