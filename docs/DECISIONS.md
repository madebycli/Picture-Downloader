# Architecture decisions

## 001 — Rendered-page integration

**Decision:** Collect media from the rendered browser page rather than account credentials or authenticated internal APIs.

**Reason:** This preserves a narrow security boundary and keeps behavior visible to the user.

**Consequence:** Scanning depends on adapter-maintained DOM rules and virtual-timeline behavior.

## 002 — Adapter-owned site behavior

**Decision:** Hostnames, selectors, IDs, timestamps, URL normalization, terminology, and download allowlists live in site adapters.

**Reason:** The product must support additional web applications without forking the scanner, archive engine, workflow, or UI.

**Consequence:** Core modules may call only the adapter contract and must not contain site checks.

## 003 — Manifest-generated permissions

**Decision:** Generate userscript `@match` and `@connect` metadata from `src/adapters/manifest.json`.

**Reason:** Runtime adapters and Tampermonkey permissions should have one reviewable source of truth.

## 004 — Persistent status plus task tabs

**Decision:** Keep progress and primary counters visible while separating Setup, Media, and Activity.

**Reason:** Related controls belong together, and long single-panel layouts obscure the current task.

**Consequence:** Changelog and release-note content remains outside the runtime UI.

## 005 — Newest-first archive ordering

**Decision:** Sort through adapter item IDs or timestamps and keep numbering continuous across ZIP parts.

## 006 — Dual ZIP implementation

**Decision:** Use `fflate` STORE mode when available and retain a dependency-free ZIP32 STORE writer.

**Reason:** Browser extension content policies or network failures can block the external library.

## 007 — Defensive virtual-boundary confirmation

**Decision:** Wait and rescan before confirming timeline start or end.

**Reason:** Virtualized pages can temporarily appear complete while content is still loading.

## 008 — Discord remains an adapter

**Decision:** Preserve Discord support as the first adapter, not as product identity or core architecture.

**Consequence:** Discord-specific attachment hosts, proxy rules, snowflake timestamps, and selectors remain in the Discord adapter.
