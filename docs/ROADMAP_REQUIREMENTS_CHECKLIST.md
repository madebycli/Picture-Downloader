# Complete roadmap requirements checklist

Status: authoritative scope checklist for the next implementation agent  
Created: 2026-08-05

This document verifies that all product requests collected during the planning conversation are represented in the repository. The next implementation agent must use it as a completeness gate together with:

- [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md)
- [`NAMING_SYSTEM.md`](./NAMING_SYSTEM.md)
- [`DIAGNOSTICS_AND_LIVE_STATS.md`](./DIAGNOSTICS_AND_LIVE_STATS.md)
- [`CURRENT_STATE_AUDIT.md`](./CURRENT_STATE_AUDIT.md)
- [`AI_HANDOFF_PROMPT.md`](./AI_HANDOFF_PROMPT.md)

A roadmap item is not complete merely because UI exists. It is complete only after shared implementation, automated tests, cross-runtime behavior, documentation, and required manual browser checks exist.

## 1. Product and distribution

- [ ] Product remains site-neutral and named **Media Archiver**.
- [ ] Site names appear only as active-adapter context, never in the product title.
- [ ] One shared source tree produces three first-class outputs:
  - [ ] universal userscript;
  - [ ] Chromium extension;
  - [ ] Firefox extension.
- [ ] The userscript remains supported and installable after extension work begins.
- [ ] All three targets share domain, adapter, selection, naming, diagnostics, archive, and UI logic.
- [ ] Runtime-specific APIs are isolated behind runtime contracts.
- [ ] Extension packages contain no remote executable JavaScript.
- [ ] Build artifacts are reproducible and uploaded by CI.

## 2. Existing behavior that must remain stable

- [ ] Discord remains fully supported through an isolated adapter.
- [ ] Photos and native GIF attachments remain supported.
- [ ] Discord-hosted videos retain broad container support.
- [ ] Rendered external GIF previews remain separately selectable.
- [ ] Original/high-quality rendered media URLs remain preferred over thumbnails.
- [ ] Current scan-direction options remain available where an adapter supports them.
- [ ] Scans wait before declaring asynchronous virtual-timeline boundaries complete.
- [ ] Date ranges support From date through latest and fixed inclusive ranges.
- [ ] Final page position can remain at scan end, return to start, or jump to timeline end.
- [ ] ZIP splitting and the built-in Firefox-safe ZIP fallback remain supported.
- [ ] Disabled, filtered, or manually deselected items never enter archives.
- [ ] Changelog/release-note content never appears in runtime UI.

## 3. Shared runtime architecture

- [ ] Shared modules have no direct `GM_*`, `chrome.*`, or `browser.*` calls.
- [ ] Runtime contract covers binary fetch, cancellation, blob saving, clipboard, settings, platform information, and UI opening.
- [ ] Userscript runtime uses Tampermonkey APIs only inside its bridge.
- [ ] Chromium runtime uses content/background messaging and generated permissions.
- [ ] Firefox runtime uses compatible content/background messaging and generated permissions.
- [ ] A large-transfer spike covers at least one 50 MB video and 300 MB combined media.
- [ ] Cancellation and memory behavior are documented for Firefox and Chromium.
- [ ] Host permissions are generated from adapter manifests and validated again at runtime.

## 4. Adapter model and future expansion

- [ ] Adapters own page matching, selectors, ID/timestamp rules, URL normalization, timeline discovery, source labels, and allowed hosts.
- [ ] Shared/core code contains no Discord-, Pinterest-, or Reddit-specific selectors or hosts.
- [ ] Adapter capabilities control which UI options are visible.
- [ ] Adding another website requires a documented adapter contract, not edits scattered through shared code.
- [ ] Unsupported pages inject no interface.

## 5. Pinterest

Initial deterministic scope:

- [ ] Pin-detail pages.
- [ ] Boards.
- [ ] Visible profile-created/profile-saved grids.
- [ ] Search-result grids.
- [ ] Personalized home feed remains out of initial scope until deterministic surfaces pass regression testing.
- [ ] Adapter collects only rendered image/video sources.
- [ ] Highest actually rendered source is selected without inventing URLs.
- [ ] Masonry and virtual re-rendering do not create duplicates.
- [ ] Date controls are hidden/disabled when reliable rendered timestamps do not exist.
- [ ] No private Pinterest API enumeration.
- [ ] Minimal Pinterest media-host allowlist.
- [ ] Fixture and live-browser regression checks.

## 6. Reddit comments

- [ ] Adapter activates only on post-detail/comment-thread pages.
- [ ] It explicitly rejects Home, Popular, subreddit feeds, search feeds, recommendations, and For You surfaces.
- [ ] It collects rendered comments only.
- [ ] Comment records include ID, parent ID, depth, rendered author, plain body, optional sanitized HTML, timestamp, visible score text, and permalink where safely available.
- [ ] Nested hierarchy is preserved.
- [ ] Deleted, collapsed, edited, and unavailable comments do not crash export.
- [ ] Rendered comment media becomes independently selectable media items.
- [ ] Selected comments export as `comments.json`, `comments.md`, and `comments.csv`.
- [ ] Only manually selected comments are exported.
- [ ] Optional reply expansion, if ever added, is an explicit safe DOM action.
- [ ] No voting, posting, joining, following, reacting, or authenticated API enumeration.

## 7. Manual file-manager selection

- [ ] Eligibility/filtering and manual selection are separate state concepts.
- [ ] Eligible entries start selected to preserve existing output behavior.
- [ ] Plain card click selects only that item and sets the range anchor.
- [ ] Checkbox/checkmark toggles one item without clearing others.
- [ ] Ctrl+click on Windows/Linux toggles additively.
- [ ] Cmd+click on macOS toggles additively.
- [ ] Shift+click selects a contiguous range.
- [ ] Ctrl/Cmd+Shift+click adds a contiguous range.
- [ ] Ctrl/Cmd+A selects all eligible items in the current view.
- [ ] Space toggles the focused item.
- [ ] Escape closes the library modal.
- [ ] Arrow keys move focus predictably.
- [ ] Alt is not used for range selection.
- [ ] Filter changes do not silently erase explicit selection.
- [ ] Shift ranges follow current visible sort/filter order.
- [ ] Final archive input is exactly `eligible && manuallySelected`.

## 8. Library UI

- [ ] Compact floating launcher/status remains available.
- [ ] Large centered modal opens for review and selection.
- [ ] Grid and list modes.
- [ ] Search, sorting, type/source/date/status filters.
- [ ] Select all visible, select all eligible, none, and invert.
- [ ] Fixed selected count and archive-selected action.
- [ ] Selected cards use a red ring, translucent overlay, check badge, short lift/glow animation, and a non-color cue.
- [ ] `prefers-reduced-motion` disables/reduces animation.
- [ ] Selection highlighting exists only inside Media Archiver, not directly on supported websites.
- [ ] Focus trap, ARIA dialog semantics, visible focus, and keyboard operation.
- [ ] At least 2,000 synthetic items remain usable.
- [ ] One selection toggle does not rebuild the entire library.
- [ ] Thumbnail and video-preview resource usage remains bounded.
- [ ] UI stays clean and user-first; advanced controls use progressive disclosure.

## 9. Collision-safe naming

Authoritative detail: [`NAMING_SYSTEM.md`](./NAMING_SYSTEM.md).

- [ ] Final names are planned for the complete final selection before downloads begin.
- [ ] One immutable naming map is reused for previews, retries, downloads, manifests, and every ZIP part.
- [ ] Sequence numbers are global across media types, generated comment documents, workers, and ZIP parts.
- [ ] The old Windows regression is permanently tested.
- [ ] Forbidden: `000001.jpg`, `000001.jpeg`, and `000001.png` for three different items.
- [ ] Required: `000001.jpg`, `000002.jpeg`, `000003.png`.
- [ ] No two files share the same normalized stem, even with different extensions.
- [ ] True extensions are preserved.
- [ ] Windows reserved names, invalid characters, case-only differences, Unicode normalization, trailing dots/spaces, and long paths are handled centrally.
- [ ] Default preset: six-digit numbering, newest to oldest.
- [ ] Preset: source date/time.
- [ ] Preset: source label + date + number.
- [ ] Preset: original name + number.
- [ ] Advanced safe token template behind Customize.
- [ ] Live filename preview matches final ZIP names.
- [ ] Settings persist identically in all three runtimes.

## 10. One-second live statistics

Authoritative detail: [`DIAGNOSTICS_AND_LIVE_STATS.md`](./DIAGNOSTICS_AND_LIVE_STATS.md).

This is an explicit regression requirement based on observed behavior in the current 6.0 userscript.

- [ ] During foreground scanning, downloading, and ZIP creation, visible primary counters are never more than **1 second stale** under normal operation.
- [ ] Acceptance tests measure DOM-visible values, not only internal state or function-call frequency.
- [ ] At minimum update Found, Eligible/In range, Selected, Downloaded, Saved, Skipped, Errors, bytes, current item/part progress, and elapsed time.
- [ ] Use a lightweight 500–1000 ms heartbeat while a session is active.
- [ ] Heartbeat updates counters/progress only; it must not rebuild the full media grid/list.
- [ ] Counter refresh does not reload thumbnails.
- [ ] Idle heartbeat work is near-zero through dirty/version flags.
- [ ] Timer stops when no active session exists.
- [ ] Phase completion performs an immediate exact refresh.
- [ ] Returning from a throttled hidden tab performs an immediate exact refresh.
- [ ] Same live-metric model and behavior in Userscript, Chromium, and Firefox.

## 11. Activity and developer diagnostics

- [ ] Ordinary Activity remains concise and user-readable.
- [ ] Activity provides Copy, Download `.md`, Developer logs, and Clear actions.
- [ ] All log text is explicitly selectable regardless of host-page CSS.
- [ ] Developer logs open in an advanced modal/drawer.
- [ ] Structured event store is the source of truth, not DOM text.
- [ ] Events have timestamp, level, category, stable code, message, phase, adapter, runtime target, sanitized context, and sanitized error/cause.
- [ ] Search and level/category filters.
- [ ] Errors-only shortcut.
- [ ] Expandable event details.
- [ ] Copy activity in one click.
- [ ] Copy complete sanitized developer report in one click.
- [ ] Download sanitized UTF-8 Markdown report in one click.
- [ ] Clipboard fallback leaves report selectable if permission fails.
- [ ] Stable error codes cover adapter, scan, network, naming, ZIP, runtime, and UI failures.
- [ ] Reports include environment, configuration, final statistics, grouped errors, activity, developer events, and a redaction notice.
- [ ] Signed query parameters, credentials, private content, personal labels, full sensitive URLs, and local paths are redacted by default.
- [ ] Event retention is bounded without allowing repetitive debug messages to evict every warning/error.
- [ ] Identical report schema across all three runtime targets.

## 12. Tests and CI

- [ ] Baseline `npm test` is run before edits.
- [ ] Sanitized minimal fixtures; no complete private browser snapshots.
- [ ] Unit tests for runtime contract, selection reducer, range selection, naming, diagnostics, metric store, archive handlers, redaction, and error codes.
- [ ] DOM fixture tests for Discord, Pinterest, and Reddit comments.
- [ ] Playwright tests for modal, grid/list, keyboard selection, reduced motion, Copy, Developer logs, and Markdown download.
- [ ] Synthetic 12-second scan verifies visible counters never exceed one-second staleness.
- [ ] Heartbeat test verifies no full-library rebuild and no thumbnail re-request.
- [ ] Background-tab return test verifies immediate exact refresh.
- [ ] Windows duplicate-stem regression test.
- [ ] Multi-ZIP numbering continuity test.
- [ ] Firefox test with fflate unavailable and built-in ZIP fallback active.
- [ ] Chromium and Firefox extension-manifest validation.
- [ ] Cross-target fixture proves identical naming and report structures.
- [ ] CI builds userscript, Chromium package, and Firefox package.
- [ ] Manual browser matrix is documented honestly; unrun tests are never claimed as passed.

## 13. Security and privacy

- [ ] Never extract, request, log, or persist tokens, cookies, credentials, or Authorization headers.
- [ ] Never use undocumented authenticated APIs for content enumeration.
- [ ] Never perform account mutations.
- [ ] Collect only rendered content or content loaded through an explicit safe DOM action.
- [ ] Do not scrape linked third-party pages for extra media.
- [ ] Runtime host allowlists are adapter-owned and enforced.
- [ ] Diagnostic exports are safe to attach publicly by default.
- [ ] Reddit body text and Discord private message text never appear in diagnostics by default.

## 14. Documentation and handoff completeness

- [ ] New agents read all mandatory context before edits.
- [ ] New agents report the read checklist, current architecture, risks, branch, commits, and true blockers before changing files.
- [ ] `NAMING_SYSTEM.md` and `DIAGNOSTICS_AND_LIVE_STATS.md` are mandatory, not optional addenda.
- [ ] README, architecture, adapter, testing, security, troubleshooting, and release docs are updated during implementation.
- [ ] Changelog remains repository-only.
- [ ] Final report provides PR, commits, architecture changes, features, automated tests, open manual tests, risks, and install paths for all three targets.

## Completeness gate for the next agent

Before opening a pull request, the implementation agent must copy this checklist into the PR description or link every section to tests/commits. Every unchecked item must be labeled one of:

```text
Implemented
Tested automatically
Tested manually
Deferred with reason
Out of scope with approval
Blocked with evidence
```

Silently omitting an item is not acceptable.
