import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const sharedPaths = [
    'src/shared/domain.user.js.part',
    'src/shared/selection-store.user.js.part',
    'src/shared/naming-service.user.js.part',
    'src/shared/diagnostics-metrics.user.js.part'
];

async function load(paths = sharedPaths) {
    let clock = 0;
    const context = vm.createContext({
        URL,
        Map,
        Set,
        WeakSet,
        Object,
        Array,
        String,
        Number,
        Boolean,
        RegExp,
        Date,
        Math,
        JSON,
        TypeError,
        Error,
        performance: { now: () => clock },
        setInterval,
        clearInterval
    });
    context.__setClock = value => { clock = value; };
    for (const path of paths) {
        const source = await readFile(new URL(path, root), 'utf8');
        vm.runInContext(source, context, { filename: path });
    }
    return context;
}

function mediaItem(key, filename, extra = {}) {
    return {
        key,
        kind: 'media',
        adapterId: 'fixture',
        canonical: true,
        eligibility: { adapter: true, type: true, date: true },
        timestamp: extra.timestamp || '2026-08-05T10:00:00.000Z',
        payload: {
            filename,
            originalFilename: filename,
            url: `https://media.example.invalid/${filename}`,
            mediaType: extra.mediaType || 'photo',
            sourceLabel: extra.sourceLabel || 'Fixture Source'
        },
        ...extra
    };
}

test('selection starts with all canonical eligible items selected', async () => {
    const context = await load();
    const store = context.MediaArchiverSelection.createSelectionStore();
    const items = [mediaItem('a', 'a.jpg'), mediaItem('b', 'b.png'), mediaItem('c', 'c.mp4')];
    store.ensureItems(items);
    assert.equal(store.count, 3);
    assert.deepEqual([...store.selectedKeys()].sort(), ['a', 'b', 'c']);
});

test('selection survives filtering, sorting, rerendering, and explicit deselection', async () => {
    const context = await load();
    const store = context.MediaArchiverSelection.createSelectionStore();
    const items = [mediaItem('a', 'a.jpg'), mediaItem('b', 'b.jpg'), mediaItem('c', 'c.jpg')];
    store.ensureItems(items);
    store.toggle('b');
    assert.equal(store.isSelected('b'), false);

    store.ensureItems([items[2], items[0]]);
    store.syncItems([items[2], items[0], items[1]]);
    assert.equal(store.isSelected('b'), false);
    assert.equal(items[1].manuallySelected, false);

    store.applyRange([items[2], items[0], items[1]], 'c');
    store.applyRange([items[2], items[0], items[1]], 'b');
    assert.deepEqual([...store.selectedKeys()].sort(), ['a', 'b', 'c']);
});

test('file-manager click semantics support plain, additive, and range selection', async () => {
    const context = await load();
    const store = context.MediaArchiverSelection.createSelectionStore();
    const items = ['a', 'b', 'c', 'd'].map(key => mediaItem(key, `${key}.jpg`));
    store.ensureItems(items);

    store.applyClick({ key: 'b', viewItems: items });
    assert.deepEqual([...store.selectedKeys()], ['b']);

    store.applyClick({ key: 'd', viewItems: items, ctrlKey: true });
    assert.deepEqual([...store.selectedKeys()].sort(), ['b', 'd']);

    store.applyClick({ key: 'c', viewItems: items, shiftKey: true });
    assert.deepEqual([...store.selectedKeys()].sort(), ['b', 'c']);

    store.applyClick({ key: 'd', viewItems: items, metaKey: true, shiftKey: true });
    assert.deepEqual([...store.selectedKeys()].sort(), ['b', 'c', 'd']);
});

test('global naming plan fixes duplicate stems and preserves true extensions', async () => {
    const context = await load();
    const naming = context.MediaArchiverNaming;
    const items = [
        mediaItem('one', 'one.jpg'),
        mediaItem('two', 'one.jpeg'),
        mediaItem('three', 'one.png')
    ];
    const plan = naming.planArchiveNames(items, { preset: naming.PRESETS.NUMBERED });
    assert.deepEqual(items.map(item => plan.get(item.key)), [
        '000001.jpg',
        '000002.jpeg',
        '000003.png'
    ]);
    assert.equal(new Set(plan.records.map(record => record.archiveStem.toLowerCase())).size, 3);
});

test('naming sanitizes Windows names and resolves case/Unicode collisions deterministically', async () => {
    const context = await load();
    const naming = context.MediaArchiverNaming;
    const items = [
        mediaItem('a', 'CON.jpg', { payload: { filename: 'CON.jpg', originalFilename: 'CON.jpg', url: 'https://media.example.invalid/CON.jpg', mediaType: 'photo' } }),
        mediaItem('b', 'café.png', { payload: { filename: 'café.png', originalFilename: 'café.png', url: 'https://media.example.invalid/cafe.png', mediaType: 'photo' } }),
        mediaItem('c', 'café.webp', { payload: { filename: 'café.webp', originalFilename: 'café.webp', url: 'https://media.example.invalid/cafe.webp', mediaType: 'photo' } })
    ];
    const plan = naming.planArchiveNames(items, { preset: naming.PRESETS.ORIGINAL_NUMBER });
    assert.match(plan.get('a'), /^_CON_000001\.jpg$/);
    const keys = plan.records.map(record => naming.normalizeCollisionKey(record.archiveStem));
    assert.equal(new Set(keys).size, keys.length);
});

test('diagnostic exports redact signed URLs, private text, credentials, and paths', async () => {
    const context = await load();
    const diagnostics = context.MediaArchiverDiagnostics.createDiagnosticsStore({
        runtimeTarget: 'userscript',
        appVersion: 'fixture'
    });
    diagnostics.startSession({ adapterId: 'discord', pageType: 'channel' });
    diagnostics.error(
        'NETWORK_HTTP_403',
        'Could not download one file.',
        new Error('Authorization: Bearer fixture-secret'),
        {
            url: 'https://cdn.example.invalid/file.jpg?token=secret#fragment',
            bodyText: 'private message text',
            localPath: 'C:\\Users\\Fixture\\Downloads\\file.jpg'
        },
        { category: 'network', userMessage: 'One file failed; remaining files continued.' }
    );
    const report = diagnostics.exportMarkdown({ metrics: { errors: 1 } });
    assert.doesNotMatch(report, /fixture-secret|private message text|token=secret|Users\\Fixture/);
    assert.match(report, /NETWORK_HTTP_403/);
    assert.match(report, /Redaction notice/);
});

test('750ms heartbeat keeps visible metrics within one second during a synthetic 12-second scan', async () => {
    const context = await load();
    let now = 0;
    let heartbeat = null;
    let visible = { found: 0, renderedAt: 0 };
    const metrics = context.MediaArchiverDiagnostics.createLiveMetrics({
        heartbeatMs: 750,
        now: () => now,
        setTimer(callback) {
            heartbeat = callback;
            return 1;
        },
        clearTimer() {},
        onSnapshot(snapshot) {
            visible = { found: snapshot.found, renderedAt: now };
        }
    });

    metrics.startSession({ phase: 'scanning' });
    let nextHeartbeat = 750;
    for (now = 250; now <= 12_000; now += 250) {
        metrics.record('found', 1);
        if (now >= nextHeartbeat) {
            heartbeat();
            nextHeartbeat += 750;
        }
        assert.ok(now - visible.renderedAt <= 1_000, `visible metrics stale by ${now - visible.renderedAt}ms`);
    }
    const finalSnapshot = metrics.stopSession({ phase: 'completed' });
    assert.equal(visible.found, 48);
    assert.equal(finalSnapshot.found, 48);
    assert.equal(finalSnapshot.phase, 'completed');
});
