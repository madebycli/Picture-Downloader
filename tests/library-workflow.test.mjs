import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('review mode guards every original request behind explicit Library confirmation', async () => {
    const archive = await read('src/core/42-archive-workflow.user.js.part');
    const workflow = await read('src/core/50-workflow.user.js.part');
    const controller = await read('src/core/55-library-controller.user.js.part');

    const guardIndex = archive.indexOf("reviewMode && !reviewArchiveConfirmed");
    const selectionIndex = archive.indexOf('const selectedEntries = selectedMediaEntries()');
    const requestIndex = archive.indexOf('requestArrayBuffer(entry.url)');
    assert.ok(guardIndex >= 0 && guardIndex < selectionIndex && selectionIndex < requestIndex);
    assert.match(archive, /reviewArchiveConfirmed = true;\s*closeLibrary\(\);\s*await createAndDownloadZipParts\(\)/s);
    assert.doesNotMatch(controller.match(/function closeLibrary\(\)[\s\S]*?\n    }/)?.[0] || '', /reviewArchiveConfirmed\s*=\s*true/);
    assert.match(workflow, /No original files have been requested/);
    assert.match(workflow, /PARTIAL REVIEW READY/);
    assert.match(workflow, /openLibrary\(\)/);
});

test('quick archive and the complete existing scanner remain present', async () => {
    const workflow = await read('src/core/50-workflow.user.js.part');
    const markup = await read('src/core/60-ui-markup.user.js.part');
    const libraryMarkup = await read('src/core/60-library-markup.user.js.part');
    const zip = await read('src/core/41-zip-engine.user.js.part');

    for (const value of [
        'newest-to-oldest',
        'current-to-oldest',
        'current-to-newest',
        'full-finish-down'
    ]) {
        assert.match(markup, new RegExp(`value="${value}"`));
    }
    assert.match(workflow, /moveToNewest/);
    assert.match(workflow, /autoScrollToOldest/);
    assert.match(workflow, /autoScrollToNewest/);
    assert.match(workflow, /applyFinalTimelinePosition/);
    assert.match(libraryMarkup, /Quick archive/);
    assert.match(libraryMarkup, /Review before archive/);
    assert.match(zip, /buildFallbackStoredZip/);
});

test('Library exposes required file-manager controls and accessibility', async () => {
    const markup = await read('src/core/60-library-markup.user.js.part');
    const controller = await read('src/core/55-library-controller.user.js.part');
    const style = await read('src/core/61-library-style.user.js.part');

    for (const marker of [
        'role="dialog"',
        'aria-modal="true"',
        'role="listbox"',
        'aria-multiselectable="true"',
        'ma-library-search',
        'ma-library-sort',
        'ma-library-type-filter',
        'ma-library-status-filter',
        'ma-select-visible',
        'ma-select-eligible',
        'ma-select-none',
        'ma-select-invert',
        'ma-library-archive'
    ]) {
        assert.match(markup, new RegExp(marker));
    }
    assert.match(controller, /ctrlKey \|\| event\.metaKey/);
    assert.match(controller, /event\.key === ' '/);
    assert.match(controller, /event\.key === 'Escape'/);
    assert.match(controller, /ArrowLeft|ArrowRight|ArrowUp|ArrowDown/);
    assert.match(controller, /focusableIn/);
    assert.match(style, /prefers-reduced-motion: reduce/);
    assert.match(style, /ma-library-card\.ma-selected/);
    assert.match(style, /content-visibility: auto/);
});

test('selection toggle path updates card state without rebuilding the Library', async () => {
    const controller = await read('src/core/55-library-controller.user.js.part');
    const applyClick = controller.match(/function applyLibraryClick\([\s\S]*?\n    }/)?.[0] || '';
    const updateStates = controller.match(/function updateAllLibraryCardStates\([\s\S]*?\n    }/)?.[0] || '';

    assert.match(applyClick, /selectionStore\.applyClick/);
    assert.match(applyClick, /updateAllLibraryCardStates/);
    assert.doesNotMatch(applyClick, /renderLibrary\(/);
    assert.doesNotMatch(updateStates, /replaceChildren|createLibraryCard/);
});

test('plain card clicks toggle repeatedly without clearing other selections', async () => {
    const context = vm.createContext({
        Map,
        Set,
        Object,
        Array,
        String,
        Number,
        Boolean,
        TypeError,
        Error
    });
    for (const path of [
        'src/shared/domain.user.js.part',
        'src/shared/selection-store.user.js.part'
    ]) {
        vm.runInContext(await read(path), context, { filename: path });
    }

    const items = ['one', 'two', 'three'].map(key => ({
        key,
        canonical: true,
        eligibility: { adapter: true, type: true, date: true }
    }));
    const store = context.MediaArchiverSelection.createSelectionStore();
    store.ensureItems(items);
    assert.equal(store.count, 3);

    store.applyClick({ key: 'two', viewItems: items });
    assert.equal(store.count, 2);
    assert.equal(store.isSelected('one'), true);
    assert.equal(store.isSelected('two'), false);

    store.applyClick({ key: 'two', viewItems: items });
    assert.equal(store.count, 3);
    assert.equal(store.isSelected('two'), true);
});

test('selection store handles 2,000 synthetic items without rebuilding state', async () => {
    const context = vm.createContext({
        Map,
        Set,
        Object,
        Array,
        String,
        Number,
        Boolean,
        TypeError,
        Error
    });
    for (const path of [
        'src/shared/domain.user.js.part',
        'src/shared/selection-store.user.js.part'
    ]) {
        vm.runInContext(await read(path), context, { filename: path });
    }

    const items = Array.from({ length: 2_000 }, (_, index) => ({
        key: `item-${index}`,
        canonical: true,
        eligibility: { adapter: true, type: true, date: true }
    }));
    const store = context.MediaArchiverSelection.createSelectionStore();
    const startedAt = performance.now();
    store.ensureItems(items);
    store.setAnchor('item-500');
    store.applyRange(items, 'item-1500');
    store.toggle('item-1000');
    const elapsed = performance.now() - startedAt;

    assert.equal(store.count, 1_000);
    assert.ok(elapsed < 1_000, `2,000-item selection operations took ${elapsed.toFixed(1)}ms`);
});

test('large Library uses fixed scroll rows and bounded render batches', async () => {
    const hotfix = await read('src/core/61-library-performance-hotfix.user.js.part');
    const manifest = JSON.parse(await read('src/build-manifest.json'));

    assert.ok(manifest.afterAdapters.includes('src/core/61-library-performance-hotfix.user.js.part'));
    assert.match(hotfix, /LIBRARY_INITIAL_RENDER_COUNT = 240/);
    assert.match(hotfix, /LIBRARY_RENDER_BATCH_COUNT = 160/);
    assert.match(hotfix, /appendLibraryRenderBatch/);
    assert.match(hotfix, /overflow-y:\s*auto/);
    assert.match(hotfix, /grid-auto-rows:\s*232px/);
    assert.match(hotfix, /input\[type="checkbox"\]/);
    assert.match(hotfix, /fetchPriority = 'low'/);
    assert.doesNotMatch(hotfix, /document\.createElement\(['"]video['"]\)/);
});

test('immutable naming plan is reused across downloads and ZIP parts', async () => {
    const archive = await read('src/core/42-archive-workflow.user.js.part');
    assert.match(archive, /planArchiveNames\(/);
    assert.match(archive, /const archiveNames = activeArchiveNamePlan\.namesByKey/);
    assert.match(archive, /const archiveName = archiveNames\.get\(record\.entry\.key\)/);
    assert.doesNotMatch(archive, /uniqueArchiveName\(/);
});

test('Activity and Developer logs expose copy, Markdown, filtering, and selectable text', async () => {
    const markup = await read('src/core/60-library-markup.user.js.part');
    const controller = await read('src/core/55-library-controller.user.js.part');
    const style = await read('src/core/61-library-style.user.js.part');
    const hotfix = await read('src/core/61-library-performance-hotfix.user.js.part');

    for (const marker of [
        'ma-copy-activity',
        'ma-download-report',
        'ma-developer-logs',
        'ma-clear-log',
        'ma-developer-search',
        'data-ma-dev-level',
        'data-ma-dev-category',
        'ma-copy-developer',
        'ma-download-developer'
    ]) {
        assert.match(markup, new RegExp(marker));
    }
    assert.match(controller, /runtime\.copyText/);
    assert.match(controller, /text\/markdown;charset=utf-8/);
    assert.match(controller, /diagnostics\.events/);
    assert.match(style, /user-select: text !important/);
    assert.match(hotfix, /width:\s*15px !important/);
    assert.match(hotfix, /min-height:\s*0 !important/);
});
