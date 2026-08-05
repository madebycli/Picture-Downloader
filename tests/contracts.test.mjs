import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const modulePaths = [
    'src/shared/runtime-contract.user.js.part',
    'src/shared/domain.user.js.part',
    'src/shared/workflow-state.user.js.part'
];

async function loadSharedModules(paths = modulePaths) {
    const context = vm.createContext({
        URL,
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
    for (const path of paths) {
        const source = await readFile(new URL(path, root), 'utf8');
        vm.runInContext(source, context, { filename: path });
    }
    return context;
}

test('shared modules do not depend on userscript or extension globals', async () => {
    for (const path of modulePaths) {
        const source = await readFile(new URL(path, root), 'utf8');
        assert.doesNotMatch(source, /\bGM_/);
        assert.doesNotMatch(source, /\bchrome\./);
        assert.doesNotMatch(source, /\bbrowser\./);
        assert.doesNotMatch(source, /discord(?:app)?\.com|pinterest\.com|reddit\.com/i);
    }
});

test('runtime contract requires the complete cross-target surface', async () => {
    const context = await loadSharedModules(['src/shared/runtime-contract.user.js.part']);
    const contract = context.MediaArchiverRuntimeContract;
    assert.deepEqual([...contract.REQUIRED_METHODS], [
        'fetchBinary',
        'requestExternal',
        'abortRequest',
        'abortAllRequests',
        'saveBlob',
        'copyText',
        'getSetting',
        'setSetting',
        'getPlatformInfo',
        'openUi',
        'closeUi'
    ]);

    assert.throws(() => contract.createRuntimeFacade({}), /fetchBinary/);
    const calls = [];
    const implementation = Object.fromEntries(
        contract.REQUIRED_METHODS.map(method => [method, (...args) => {
            calls.push([method, args]);
            return method;
        }])
    );
    const facade = contract.createRuntimeFacade(implementation);
    assert.equal(facade.requestExternal('https://www.virustotal.com/api/v3/files'), 'requestExternal');
    assert.deepEqual(calls, [[
        'requestExternal',
        ['https://www.virustotal.com/api/v3/files']
    ]]);
});

test('ArchiveItem separates comment records from binary media', async () => {
    const context = await loadSharedModules(['src/shared/domain.user.js.part']);
    const domain = context.MediaArchiverDomain;
    const comment = domain.createArchiveItem({
        key: 'reddit:comment:t1_fixture',
        kind: 'comment',
        adapterId: 'reddit-comments',
        sourceId: 't1_fixture',
        parentSourceId: 't3_fixture',
        eligibility: { adapter: true, type: true, date: true },
        payload: { bodyText: 'fixture' }
    });

    assert.equal(comment.kind, domain.ITEM_KINDS.COMMENT);
    assert.equal(comment.manuallySelected, true);
    assert.equal(domain.isFinalArchiveCandidate(comment), true);
    comment.manuallySelected = false;
    assert.equal(domain.isFinalArchiveCandidate(comment), false);
});

test('adapter capabilities explicitly gate scan and view behavior', async () => {
    const context = await loadSharedModules(['src/shared/domain.user.js.part']);
    const capabilities = context.MediaArchiverDomain.normalizeAdapterCapabilities({
        media: true,
        textRecords: false,
        virtualTimeline: true,
        dateFilter: true,
        scanModes: ['newest-to-oldest', 'newest-to-oldest', 'current-to-oldest'],
        views: ['grid', 'list']
    });

    assert.equal(capabilities.media, true);
    assert.equal(capabilities.textRecords, false);
    assert.deepEqual([...capabilities.scanModes], ['newest-to-oldest', 'current-to-oldest']);
    assert.ok(Object.isFrozen(capabilities));
});

test('workflow state distinguishes quick archive and review before archive', async () => {
    const context = await loadSharedModules();
    const workflow = context.MediaArchiverWorkflowState;

    const quick = workflow.createWorkflowStateMachine({ mode: 'quick' });
    quick.transition(workflow.phases.SCANNING);
    quick.afterScan();
    assert.equal(quick.phase, workflow.phases.FETCHING_SELECTED);

    const review = workflow.createWorkflowStateMachine({ mode: 'review' });
    review.transition(workflow.phases.SCANNING);
    review.afterScan();
    assert.equal(review.phase, workflow.phases.REVIEW_READY);
    review.transition(workflow.phases.REVIEWING);
    review.transition(workflow.phases.FETCHING_SELECTED);
    assert.equal(review.phase, workflow.phases.FETCHING_SELECTED);

    const stoppedReview = workflow.createWorkflowStateMachine({ mode: 'review' });
    stoppedReview.transition(workflow.phases.SCANNING);
    stoppedReview.afterScan({ stopped: true });
    assert.equal(stoppedReview.phase, workflow.phases.REVIEW_READY);
});

test('Discord declares current behavior as explicit capabilities', async () => {
    const source = await readFile(
        new URL('src/adapters/discord/00-config.user.js.part', root),
        'utf8'
    );
    for (const marker of [
        'media: true',
        'virtualTimeline: true',
        'dateFilter: true',
        "'newest-to-oldest'",
        "'current-to-oldest'",
        "'current-to-newest'",
        "'full-finish-down'"
    ]) {
        assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
});
