# Complete roadmap requirements checklist

Status date: 2026-08-05  
Implementation branch: `feature/extension-pinterest-reddit-picker`

Status vocabulary:

- **Implemented** — production source exists.
- **Tested automatically** — repository or Playwright test/CI gate exists.
- **Tested manually** — an interactive real-browser check was actually performed.
- **Deferred with reason** — intentionally postponed with a documented reason.
- **Out of scope with approval** — explicitly excluded by the approved scope.
- **Blocked with evidence** — required manual/live check cannot run in the current execution environment.

No requirement is silently omitted.

## 1. Product and distribution

- [x] Product remains site-neutral and named **Media Archiver** — **Implemented · Tested automatically**.
- [x] Site names appear only as active-adapter context — **Implemented · Tested automatically**.
- [x] One shared source tree produces a universal userscript — **Implemented · Tested automatically**.
- [x] One shared source tree produces a Chromium extension — **Implemented · Tested automatically**.
- [x] One shared source tree produces a Firefox extension — **Implemented · Tested automatically**.
- [x] Userscript remains supported/installable after extension work — **Implemented · Tested automatically**.
- [x] All targets share domain, adapter, selection, naming, diagnostics, archive, and UI logic — **Implemented · Tested automatically**.
- [x] Runtime-specific APIs are isolated behind runtime contracts — **Implemented · Tested automatically**.
- [x] Extension packages contain no remote executable JavaScript — **Implemented · Tested automatically**.
- [x] Build artifacts are reproducible and uploaded by CI — **Implemented · Tested automatically**.

## 2. Existing behavior that must remain stable

- [x] Discord remains fully supported through an isolated adapter — **Implemented · Tested automatically**; real private-channel regression — **Blocked with evidence**.
- [x] Photos and native GIF attachments remain supported — **Implemented · Tested automatically**.
- [x] Discord-hosted videos retain broad container support — **Implemented · Tested automatically**.
- [x] Rendered external GIF previews remain separately selectable — **Implemented · Tested automatically**.
- [x] Original/high-quality rendered media URLs remain preferred — **Implemented · Tested automatically**.
- [x] Current scan-direction options remain available where supported — **Implemented · Tested automatically**.
- [x] Scans wait before confirming asynchronous boundaries — **Implemented · Tested automatically**.
- [x] Date ranges support From-through-latest and fixed inclusive ranges — **Implemented · Tested automatically**.
- [x] Final page position supports scan end, start, and timeline end — **Implemented · Tested automatically**.
- [x] ZIP splitting and built-in Firefox-safe fallback remain — **Implemented · Tested automatically**; live blocked-CDN browser check — **Blocked with evidence**.
- [x] Disabled, filtered, or manually deselected items never enter archives — **Implemented · Tested automatically**.
- [x] Changelog/release notes never appear in runtime UI — **Implemented · Tested automatically**.

## 3. Shared runtime architecture

- [x] Shared modules have no direct `GM_*`, `chrome.*`, or `browser.*` calls — **Implemented · Tested automatically**.
- [x] Runtime contract covers fetch, cancellation, save, clipboard, settings, platform, and UI — **Implemented · Tested automatically**.
- [x] Userscript runtime contains Tampermonkey APIs only in its bridge — **Implemented · Tested automatically**.
- [x] Chromium uses content/background messaging and generated permissions — **Implemented · Tested automatically**.
- [x] Firefox uses compatible content/background messaging and generated permissions — **Implemented · Tested automatically**.
- [ ] One >50 MB video transport spike — **Blocked with evidence**: no interactive authenticated source/packaged-extension browser environment in this session.
- [ ] >=300 MB combined-media spike — **Blocked with evidence**: same environment limitation.
- [ ] Cancellation and memory behavior documented from real Firefox/Chromium runs — **Blocked with evidence**; cancellation paths are **Implemented · Tested automatically**, real memory measurements are not claimed.
- [x] Host permissions are generated and validated again at runtime — **Implemented · Tested automatically**.

## 4. Adapter model and future expansion

- [x] Adapters own matches, selectors, IDs/timestamps, URLs, timelines, labels, and hosts — **Implemented · Tested automatically**.
- [x] Shared/core contains no Discord/Pinterest/Reddit selectors or hosts — **Implemented · Tested automatically**.
- [x] Adapter capabilities control meaningful UI options — **Implemented · Tested automatically**.
- [x] New websites use a documented adapter contract — **Implemented · Documented**.
- [x] Unsupported pages inject no interface — **Implemented · Tested automatically**.

## 5. Pinterest

- [x] Pin-detail pages — **Implemented · Tested automatically**.
- [x] Boards — **Implemented · Tested automatically**.
- [x] Visible profile-created/profile-saved grids — **Implemented · Tested automatically**.
- [x] Search-result grids — **Implemented · Tested automatically**.
- [x] Personalized home feed excluded initially — **Out of scope with approval · Tested automatically**.
- [x] Collect only rendered image/video sources — **Implemented · Tested automatically**.
- [x] Select highest actually rendered source without inventing URLs — **Implemented · Tested automatically**.
- [x] Masonry/virtual re-rendering does not create duplicate archive items — **Implemented · Tested automatically**.
- [x] Date controls hidden when reliable rendered timestamps do not exist — **Implemented · Tested automatically**.
- [x] No private Pinterest API enumeration — **Implemented · Tested automatically**.
- [x] Minimal Pinterest media-host allowlist — **Implemented · Tested automatically**.
- [x] Fixture regression checks — **Tested automatically**.
- [ ] Live Pinterest browser regression — **Blocked with evidence**: no authenticated/private live Pinterest browsing session available.

## 6. Reddit comments

- [x] Adapter activates only on post-detail/comment-thread pages — **Implemented · Tested automatically**.
- [x] Home, Popular, subreddit/search feeds, recommendations, and For You are rejected — **Implemented · Tested automatically**.
- [x] Collect rendered comments only — **Implemented · Tested automatically**.
- [x] Records include ID, parent, depth, author, plain body, sanitized HTML, timestamp, score, permalink — **Implemented · Tested automatically**.
- [x] Nested hierarchy preserved — **Implemented · Tested automatically**.
- [x] Deleted, collapsed, edited, unavailable comments remain robust — **Implemented · Tested automatically**.
- [x] Rendered comment media is independently selectable — **Implemented · Tested automatically**.
- [x] Selected comments export as `comments.json`, `comments.md`, and `comments.csv` — **Implemented · Tested automatically**.
- [x] Only manually selected comments are exported — **Implemented · Tested automatically**.
- [x] Reply expansion is not automated — **Out of scope with approval**; future explicit safe DOM action only.
- [x] No voting, posting, joining, following, reacting, or authenticated enumeration — **Implemented · Tested automatically**.
- [ ] Live Reddit browser regression — **Blocked with evidence**: no authenticated/private live thread environment available.

## 7. Manual file-manager selection

- [x] Eligibility/filtering and manual selection are separate — **Implemented · Tested automatically**.
- [x] Eligible canonical entries start selected — **Implemented · Tested automatically**.
- [x] Plain card click selects only the item and sets anchor — **Implemented · Tested automatically**.
- [x] Checkmark toggles without clearing others — **Implemented · Tested automatically**.
- [x] Ctrl+click toggles additively — **Implemented · Tested automatically**.
- [x] Cmd+click toggles additively — **Implemented · Tested automatically**.
- [x] Shift+click selects contiguous range — **Implemented · Tested automatically**.
- [x] Ctrl/Cmd+Shift adds a contiguous range — **Implemented · Tested automatically**.
- [x] Ctrl/Cmd+A selects eligible current-view items — **Implemented · Tested automatically**.
- [x] Space toggles focused item — **Implemented · Tested automatically**.
- [x] Escape closes Library — **Implemented · Tested automatically**.
- [x] Arrow keys move focus — **Implemented · Tested automatically**.
- [x] Alt is not used for ranges — **Implemented · Tested automatically**.
- [x] Filter changes preserve explicit selection — **Implemented · Tested automatically**.
- [x] Shift ranges follow current visible order — **Implemented · Tested automatically**.
- [x] Final archive input is canonical/eligible/manual selection — **Implemented · Tested automatically**.

## 8. Library UI

- [x] Compact launcher/status remains — **Implemented · Tested automatically**.
- [x] Near-fullscreen centered review Library — **Implemented · Tested automatically**.
- [x] Grid and list modes — **Implemented · Tested automatically**.
- [x] Search, sorting, type/source/date/status filtering — **Implemented · Tested automatically**.
- [x] Select all visible, all eligible, none, invert — **Implemented · Tested automatically**.
- [x] Fixed selection summary and Archive selected — **Implemented · Tested automatically**.
- [x] Red ring, overlay, check badge, animation, and non-color cue — **Implemented · Tested automatically**.
- [x] `prefers-reduced-motion` reduces/disables animation — **Implemented · Tested automatically**.
- [x] Selection highlighting exists only inside Media Archiver — **Implemented · Tested automatically**.
- [x] Focus trap, ARIA dialog, visible focus, keyboard operation — **Implemented · Tested automatically**.
- [x] 2,000 synthetic items remain selectable — **Tested automatically**.
- [x] One toggle does not rebuild the Library — **Implemented · Tested automatically**.
- [x] Thumbnail/video-preview use is bounded — **Implemented · Tested automatically**.
- [x] Progressive disclosure keeps advanced naming/log controls out of normal flow — **Implemented · Tested automatically**.
- [x] Closing/cancelling Review starts no request — **Implemented · Tested automatically**.
- [x] Stopped scan can review the partial collection — **Implemented · Tested automatically**.

## 9. Collision-safe naming

- [x] Complete final names planned before downloads — **Implemented · Tested automatically**.
- [x] Immutable map reused for preview/retry/download/manifest/ZIP parts — **Implemented · Tested automatically**.
- [x] Sequence global across media, generated documents, workers, ZIP parts — **Implemented · Tested automatically**.
- [x] Old Windows duplicate-stem regression permanently tested — **Tested automatically**.
- [x] Forbidden duplicate `000001` stems — **Tested automatically**.
- [x] Required `000001.jpg`, `000002.jpeg`, `000003.png` — **Tested automatically**.
- [x] No normalized stem reuse across extensions — **Implemented · Tested automatically**.
- [x] True extensions preserved — **Implemented · Tested automatically**.
- [x] Reserved names, invalid chars, case, Unicode, trailing dots/spaces, long paths handled centrally — **Implemented · Tested automatically**.
- [x] Default six-digit newest-to-oldest preset — **Implemented · Tested automatically**.
- [x] Source date/time preset — **Implemented · Tested automatically**.
- [x] Source + date + number preset — **Implemented · Tested automatically**.
- [x] Original + number preset — **Implemented · Tested automatically**.
- [x] Safe advanced token template behind Customize — **Implemented · Tested automatically**.
- [x] Live preview uses final naming implementation — **Implemented · Tested automatically**.
- [x] Settings persist through shared runtime storage — **Implemented · Tested automatically**.

## 10. One-second live statistics

- [x] Foreground visible primary counters stay <=1 second stale — **Implemented · Tested automatically**.
- [x] Acceptance measures DOM-visible values — **Tested automatically in Chromium and Firefox Playwright**.
- [x] Found, Eligible, Selected, Downloaded, Saved, Skipped/Errors, bytes, item/part, elapsed — **Implemented**.
- [x] Lightweight 750 ms active heartbeat — **Implemented · Tested automatically**.
- [x] Heartbeat does not rebuild Library — **Implemented · Tested automatically**.
- [x] Counter refresh does not reload thumbnails — **Implemented · Tested automatically**.
- [x] Dirty/version flags make idle heartbeat near-zero — **Implemented · Tested automatically**.
- [x] Timer stops when session ends — **Implemented · Tested automatically**.
- [x] Phase completion performs exact flush — **Implemented · Tested automatically**.
- [x] Visibility return performs exact flush — **Implemented · Tested automatically**.
- [x] Same shared metric model in all targets — **Implemented · Tested automatically**.

## 11. Activity and developer diagnostics

- [x] Ordinary Activity remains concise — **Implemented · Tested automatically**.
- [x] Copy, Download `.md`, Developer logs, Clear — **Implemented · Tested automatically**.
- [x] Visible log text explicitly selectable — **Implemented · Tested automatically**.
- [x] Developer logs advanced dialog — **Implemented · Tested automatically**.
- [x] Structured event store is source of truth — **Implemented · Tested automatically**.
- [x] Events include timestamp, level, category, code, phase, adapter/runtime, sanitized context/error — **Implemented · Tested automatically**.
- [x] Search and level/category filters — **Implemented · Tested automatically**.
- [x] Errors-only is achievable through level filters — **Implemented · Tested automatically**.
- [x] Expandable details — **Implemented · Tested automatically**.
- [x] Copy Activity — **Implemented · Tested automatically**.
- [x] Copy sanitized developer report — **Implemented · Tested automatically**.
- [x] Download sanitized UTF-8 Markdown — **Implemented · Tested automatically**.
- [x] Clipboard fallback leaves selectable report — **Implemented · Tested automatically**.
- [x] Stable codes cover adapter/scan/network/naming/ZIP/runtime/UI — **Implemented · Tested automatically**.
- [x] Report sections include environment/config/stats/errors/activity/events/redaction — **Implemented · Tested automatically**.
- [x] Signed parameters, credentials, private content/labels, URLs, paths redacted — **Implemented · Tested automatically**.
- [x] Event retention bounded without debug eviction of all warnings/errors — **Implemented · Tested automatically**.
- [x] Identical report schema across targets — **Implemented · Tested automatically**.

## 12. Tests and CI

- [x] Baseline `npm test` run before edits — **Tested automatically**, SHA recorded in PR.
- [x] Sanitized minimal fixtures only — **Implemented · Tested automatically**.
- [x] Unit tests for runtime, selection, naming, diagnostics, metrics, handlers, redaction, codes — **Tested automatically**.
- [x] DOM/adapter fixtures for Discord, Pinterest, Reddit comments — **Tested automatically**.
- [x] Playwright tests for modal, keyboard, request gate, reduced motion structure, Copy/Markdown — **Tested automatically**.
- [x] Twelve-second visible-counter regression — **Tested automatically in Chromium and Firefox**.
- [x] No Library rebuild/no thumbnail reload heartbeat test — **Tested automatically**.
- [x] Visibility-return exact refresh test — **Tested automatically**.
- [x] Windows duplicate-stem regression — **Tested automatically**.
- [x] Multi-kind/ZIP naming continuity — **Tested automatically**.
- [x] Built-in ZIP fallback retained and statically/unit validated — **Tested automatically**; live Firefox blocked-CDN run — **Blocked with evidence**.
- [x] Chromium and Firefox manifest validation — **Tested automatically**.
- [x] Cross-target naming/report source is shared — **Implemented · Tested automatically**.
- [x] CI builds userscript, Chromium, Firefox — **Implemented · Tested automatically**.
- [x] Manual matrix is documented honestly — **Implemented**.

## 13. Security and privacy

- [x] Never extract/request/log/persist tokens, cookies, credentials, Authorization — **Implemented · Tested automatically**.
- [x] Never use undocumented authenticated enumeration APIs — **Implemented · Tested automatically**.
- [x] Never perform account mutations — **Implemented · Tested automatically**.
- [x] Collect rendered content only — **Implemented · Tested automatically**.
- [x] Do not scrape linked pages — **Implemented · Tested automatically**.
- [x] Adapter-owned runtime allowlists enforced — **Implemented · Tested automatically**.
- [x] Diagnostic exports safe by default — **Implemented · Tested automatically**.
- [x] Reddit/Discord private body text absent from diagnostics by default — **Implemented · Tested automatically**.

## 14. Documentation and handoff completeness

- [x] Mandatory context read before edits — **Completed and reported**.
- [x] Initial read checklist, architecture, risks, branch, commits, blockers reported — **Completed**.
- [x] Naming and diagnostics plans treated as mandatory — **Implemented**.
- [x] README, architecture, adapters, testing, security, troubleshooting, release updated — **Implemented**.
- [x] Changelog remains repository-only — **Implemented · Tested automatically**.
- [x] Final report/PR contains PR, commits, architecture, features, automated tests, open manual tests, risks, install paths — **Implemented in PR/final handoff**.

## Manual blockers and evidence

The current coding environment can execute repository tests and headless Chromium/Firefox Playwright suites but cannot install the packaged extensions interactively into a persistent user profile, access the owner's private Discord/Pinterest/Reddit content, or perform reliable real-browser memory profiling with authenticated >300 MB source selections. Therefore the following remain **Blocked with evidence**, not silently passed:

1. Firefox + Tampermonkey with the `fflate` CDN blocked on a real Discord timeline.
2. Chromium + Tampermonkey with `fflate` available on a real Discord timeline.
3. Interactive packaged Chromium and Firefox extension installation smoke tests.
4. Live Pinterest surface matrix.
5. Live Reddit nested-thread matrix.
6. One real >50 MB video and >=300 MB aggregate transfer.
7. Browser memory comparison and cancellation during those large transfers.
8. Real multiple-download permission prompts and final-position restoration.

These blockers do not weaken the automated request-gate, selection, naming, diagnostics, manifest, packaging, fixture, and DOM-visible timing tests; they remain explicit release gates in `docs/TESTING.md` and `docs/RELEASE.md`.
