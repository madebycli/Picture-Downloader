# Site adapters

## Purpose

A site adapter contains every rule that depends on a specific web application. New sites should be added by creating an adapter module and manifest entry, not by adding hostname checks or selectors to core modules.

## Manifest entry

Add an object to `src/adapters/manifest.json`:

```json
{
  "id": "example",
  "label": "Example",
  "modules": ["src/adapters/example/adapter.user.js.part"],
  "matches": ["https://example.com/library/*"],
  "connect": ["media.example.com"]
}
```

The build converts `matches` and `connect` into Tampermonkey metadata. Keep both lists minimal.

## Runtime contract

Register an object with `registerSiteAdapter(adapter)`. Required members are:

- `id`, `label`, and `archivePrefix`
- `matches(location)`
- `scanVisibleMedia()`
- `findScroller()`
- `visibleItemIds()`
- `visibleItemTimeRange()`
- `findItemElementById(id)`
- `captureStartingAnchor(scroller)`
- `findItemId(element)`
- `findItemTimestamp(element)`
- `compareItemIds(left, right)`
- `getArchiveContext()`
- `isDownloadUrlAllowed(url)`

Optional members include `timestampFromItemId(id)`, `terms`, and `openTargetHelp`.

## Media discovery

Adapter discovery functions create or update entries in the shared `mediaEntries` Map. An entry should provide:

```js
{
    key,
    url,
    previewUrl,
    filename,
    mediaType: 'photo' | 'video' | 'external-gif',
    sourceKind,
    sourcePageUrl,
    itemId,
    timestamp,
    firstSeen,
    status,
    error,
    size
}
```

Use stable semantic attributes, URL patterns, and DOM relationships. Avoid generated CSS class names when possible.

## Download safety

The manifest `connect` list grants Tampermonkey permission. `isDownloadUrlAllowed` is a second runtime boundary and must independently reject every undeclared host. Do not follow a source-page link to scrape additional files.

## Virtual timelines

Adapters must treat timeline boundaries as asynchronous. `findScroller`, visible IDs, timestamps, and anchor functions should remain defensive when the site unloads off-screen content or changes scroll height after rendering.

## Adding an adapter checklist

1. Add the adapter module and manifest entry.
2. Keep all site constants, selectors, epochs, hosts, and normalization rules inside the adapter.
3. Document supported page types and media sources.
4. Add validation markers or adapter-specific tests.
5. Test unsupported pages, all scan directions, date boundaries, stop behavior, and both ZIP engines.
6. Run `npm test` and inspect the generated metadata.
