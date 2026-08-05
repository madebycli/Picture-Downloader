import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

async function loadRedditConfig(pathname = '/r/fixture/comments/post123/title/') {
    const context = vm.createContext({
        URL,
        String,
        Number,
        BigInt,
        Object,
        Array,
        Set,
        RegExp,
        Date,
        location: {
            hostname: 'www.reddit.com',
            pathname,
            href: `https://www.reddit.com${pathname}`,
            origin: 'https://www.reddit.com'
        },
        sanitizeFilename: value => String(value).replace(/[^a-z0-9._-]+/gi, '-'),
        scanRedditRenderedThread() {},
        expandRedditRenderedComments() {},
        findRedditThreadScroller() {},
        redditVisibleCommentIds() { return []; },
        redditVisibleCommentTimeRange() { return null; },
        findRedditCommentElementById() {},
        captureRedditStartingAnchor() {}
    });
    vm.runInContext(
        await read('src/adapters/reddit-comments/00-config.user.js.part'),
        context,
        { filename: 'reddit-config' }
    );
    return context;
}

test('Reddit adapter activates only on post-detail comment threads', async () => {
    const context = await loadRedditConfig();
    const pageType = (hostname, pathname) => vm.runInContext(
        `redditCommentThreadPageType({ hostname: ${JSON.stringify(hostname)}, pathname: ${JSON.stringify(pathname)} })`,
        context
    );

    assert.equal(pageType('www.reddit.com', '/r/fixture/comments/post123/title/'), 'post-comments');
    assert.equal(pageType('old.reddit.com', '/r/fixture/comments/post123/title/t1child/'), 'post-comments');
    assert.equal(pageType('www.reddit.com', '/'), null);
    assert.equal(pageType('www.reddit.com', '/r/popular/'), null);
    assert.equal(pageType('www.reddit.com', '/r/fixture/'), null);
    assert.equal(pageType('www.reddit.com', '/search/?q=fixture'), null);
    assert.equal(pageType('www.reddit.com', '/r/fixture/hot/'), null);
});

test('Reddit comment adapter exposes media only and never creates comment records', async () => {
    const source = [
        await read('src/adapters/reddit-comments/00-config.user.js.part'),
        await read('src/adapters/reddit-comments/10-comments.user.js.part'),
        await read('src/adapters/reddit-comments/20-media.user.js.part')
    ].join('\n');

    assert.match(source, /textRecords:\s*false/);
    assert.doesNotMatch(source, /kind:\s*['"]comment['"]/);
    assert.doesNotMatch(source, /comments\.(?:json|md|csv)/);
    assert.match(source, /kind:\s*'media'/);
    assert.match(source, /scanRedditRenderedThread\(\)[\s\S]*scanRedditRenderedCommentMedia\(\)/);
});

test('Reddit hides date range and uses a complete downward comment-thread scan', async () => {
    const context = await loadRedditConfig();
    const adapter = vm.runInContext('createRedditCommentsAdapter()', context);

    assert.equal(adapter.capabilities.dateFilter, false);
    assert.deepEqual([...adapter.capabilities.scanModes], ['current-to-newest']);
    assert.equal(adapter.preferredScanMode, 'current-to-newest');
    assert.equal(adapter.boundaryConfirmMs, 5_000);
    assert.equal(typeof adapter.expandRenderedContent, 'function');
});

test('Reddit media collector covers rendered photos GIFs videos picture sources and direct links', async () => {
    const source = await read('src/adapters/reddit-comments/20-media.user.js.part');
    for (const marker of [
        'img[src]',
        'img[srcset]',
        'picture',
        'video[src]',
        'video source[src]',
        'a[href]',
        "mediaType === 'external-gif'",
        "'reddit-comment-video'",
        "'reddit-comment-photo'"
    ]) {
        assert.ok(source.includes(marker), `missing Reddit media marker ${marker}`);
    }
    assert.match(source, /reddit-media:\$\{canonicalPath\}/);
    assert.doesNotMatch(source, /reddit-media:\$\{commentId\}/);
});

test('Reddit external host matcher supports approved wildcard CDNs', async () => {
    const context = await loadRedditConfig();
    const allowed = hostname => vm.runInContext(
        `redditCommentMediaHostAllowed(${JSON.stringify(hostname)})`,
        context
    );

    assert.equal(allowed('i.redd.it'), true);
    assert.equal(allowed('media3.giphy.com'), true);
    assert.equal(allowed('files.redgifs.com'), true);
    assert.equal(allowed('cdn-cf-east.streamable.com'), true);
    assert.equal(allowed('example.com'), false);
});

test('Reddit expansion is narrowly limited to rendered more-comments controls', async () => {
    const thread = await read('src/adapters/reddit-comments/30-thread.user.js.part');

    assert.match(thread, /view\|load\|show/);
    assert.match(thread, /more\\s\+\(\?:comments/);
    assert.match(thread, /continue\\s\+this\\s\+thread/);
    assert.match(thread, /slice\(0, 8\)/);
    assert.match(thread, /8_000/);
    assert.match(thread, /control\.click\(\)/);
    assert.match(thread, /log\\s\*in\|sign\\s\*up/);
    assert.match(thread, /award\|share\|report\|save\|follow\|join\|vote\|upvote\|downvote/);
    assert.match(thread, /redditExpansionControlEligible/);
    assert.match(thread, /redditCommentElements\(\)\.length/);
});

test('Reddit implementation uses rendered DOM only and performs no API enumeration or account actions', async () => {
    const config = await read('src/adapters/reddit-comments/00-config.user.js.part');
    const comments = await read('src/adapters/reddit-comments/10-comments.user.js.part');
    const media = await read('src/adapters/reddit-comments/20-media.user.js.part');
    const thread = await read('src/adapters/reddit-comments/30-thread.user.js.part');
    const source = [config, comments, media, thread].join('\n');

    assert.match(source, /querySelectorAll/);
    assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|\/api\/|graphql|Authorization/i);
    assert.doesNotMatch(
        source,
        /\b(?:upvote|downvote|follow|joinCommunity|submitPost|postMessage)\s*\(/i
    );

    // The only click path belongs to the reviewed rendered expansion helper.
    const clickOccurrences = source.match(/\.click\s*\(\)/g) || [];
    assert.equal(clickOccurrences.length, 1);
    assert.match(thread, /async function expandRedditRenderedComments/);
});

test('Reddit host permissions cover native and common rendered external media CDNs', async () => {
    const manifest = JSON.parse(await read('src/adapters/manifest.json'));
    const adapter = manifest.adapters.find(item => item.id === 'reddit-comments');

    assert.deepEqual(adapter.matches, [
        'https://www.reddit.com/r/*/comments/*',
        'https://reddit.com/r/*/comments/*',
        'https://old.reddit.com/r/*/comments/*'
    ]);
    for (const host of [
        'i.redd.it',
        'v.redd.it',
        'i.imgur.com',
        '*.giphy.com',
        'media.tenor.com',
        '*.streamable.com',
        '*.redgifs.com'
    ]) {
        assert.ok(adapter.connect.includes(host), `missing Reddit media host ${host}`);
    }
});
