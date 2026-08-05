import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const readJson = async path => JSON.parse(await read(path));

const fixturePaths = [
    'tests/fixtures/discord-channel.html',
    'tests/fixtures/pinterest-board.html',
    'tests/fixtures/pinterest-pin-detail.html',
    'tests/fixtures/reddit-comments.html'
];

test('baseline metadata preserves the audited 6.0 main build independently from the current release', async () => {
    const baseline = await readJson('tests/fixtures/baseline.json');
    const packageJson = await readJson('package.json');

    assert.equal(baseline.auditedMainCommit, 'e2799fe310cfd6cb6dc9d1482780bc3d64b8cbeb');
    assert.equal(baseline.version, '6.0.0');
    assert.equal(packageJson.version, '7.2.0');
    assert.notEqual(packageJson.version, baseline.version);
    assert.match(baseline.buildOutput, /17 modules and 1 adapter/);
    assert.equal(baseline.automatedResult, 'npm test passed');
});

test('sanitized fixtures contain no credentials or private snapshots', async () => {
    const forbidden = [
        /authorization\s*:/i,
        /bearer\s+[a-z0-9._-]+/i,
        /\btoken\b\s*[:=]/i,
        /document\.cookie/i,
        /webpackChunkdiscord_app/i,
        /discord\.com\/api\//i,
        /<script\b/i
    ];

    for (const path of fixturePaths) {
        const fixture = await read(path);
        assert.ok(fixture.length < 12_000, `${path} must remain a minimal DOM fragment`);
        for (const pattern of forbidden) {
            assert.doesNotMatch(fixture, pattern, `${path} contains ${pattern}`);
        }
    }
});

test('phase-zero fixtures encode deterministic adapter expectations', async () => {
    const expected = await readJson('tests/fixtures/expected.json');
    const discord = await read('tests/fixtures/discord-channel.html');
    const pinterestBoard = await read('tests/fixtures/pinterest-board.html');
    const pinterestDetail = await read('tests/fixtures/pinterest-pin-detail.html');
    const reddit = await read('tests/fixtures/reddit-comments.html');

    assert.equal((discord.match(/<article\b/g) || []).length, expected.discord.expectedMedia);
    assert.equal((pinterestBoard.match(/data-test-pin-id=/g) || []).length, expected.pinterestBoard.renderedCards);
    assert.equal(new Set([...pinterestBoard.matchAll(/data-test-pin-id="([^"]+)"/g)].map(match => match[1])).size, expected.pinterestBoard.expectedUniquePins);
    assert.match(pinterestDetail, /\/originals\//);
    assert.equal((reddit.match(/data-testid="comment"/g) || []).length, expected.redditComments.expectedComments);
    assert.equal((reddit.match(/data-depth="1"/g) || []).length, expected.redditComments.expectedNestedComments);
    assert.equal((reddit.match(/\[deleted\]/g) || []).length, expected.redditComments.expectedDeletedComments);
});

test('the old Windows duplicate-stem regression remains a permanent acceptance fixture', async () => {
    const expected = await readJson('tests/fixtures/expected.json');
    assert.deepEqual(expected.namingRegression.forbidden, [
        '000001.jpg',
        '000001.jpeg',
        '000001.png'
    ]);
    assert.deepEqual(expected.namingRegression.required, [
        '000001.jpg',
        '000002.jpeg',
        '000003.png'
    ]);
});

test('selection clarification preserves the complete scanner and defines both completion modes', async () => {
    const clarification = await read('docs/SELECTION_WORKFLOW_CLARIFICATION.md');
    const uiMarkup = await read('src/core/60-ui-markup.user.js.part');
    const zipEngine = await read('src/core/41-zip-engine.user.js.part');

    for (const value of [
        'newest-to-oldest',
        'current-to-oldest',
        'current-to-newest',
        'full-finish-down'
    ]) {
        assert.match(uiMarkup, new RegExp(`value="${value}"`));
    }

    assert.match(clarification, /Quick archive/);
    assert.match(clarification, /Review before archive/);
    assert.match(clarification, /must not pre-download all original binaries/i);
    assert.match(clarification, /manual Stop/i);
    assert.match(zipEngine, /buildFallbackStoredZip/);
});

test('current 6.0 visible-stat behavior is explicitly captured as a regression baseline', async () => {
    const workflow = await read('src/core/50-workflow.user.js.part');
    const baseline = await readJson('tests/fixtures/baseline.json');

    assert.match(workflow, /function updateCounters\(\)/);
    assert.match(workflow, /mediaList\.replaceChildren\(fragment\)/);
    assert.doesNotMatch(workflow, /setInterval\([^)]*updateCounters/s);
    assert.match(baseline.knownRegressions.visibleStatistics, /no fixed active-work heartbeat/i);
});
