import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { TextEncoder } from 'node:util';
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

async function loadCommentExport() {
    const context = vm.createContext({
        Map,
        Set,
        Object,
        Array,
        String,
        Number,
        Boolean,
        Date,
        JSON,
        TextEncoder
    });
    vm.runInContext(
        await read('src/shared/comment-export.user.js.part'),
        context,
        { filename: 'comment-export' }
    );
    return context.MediaArchiverCommentExport;
}

function comment(key, parent, depth, body, extra = {}) {
    return {
        key: `reddit-comment:${key}`,
        kind: 'comment',
        adapterId: 'reddit-comments',
        sourceId: key,
        parentSourceId: parent,
        timestamp: extra.timestamp || '2026-08-05T07:00:00.000Z',
        discoveryIndex: extra.discoveryIndex || 0,
        manuallySelected: extra.manuallySelected !== false,
        payload: {
            author: extra.author || 'fixture-author',
            bodyText: body,
            bodyHtmlSanitized: `<p>${body}</p>`,
            depth,
            scoreText: extra.scoreText || '1 point',
            permalink: `https://www.reddit.com/r/fixture/comments/post/title/${key.replace('t1_', '')}/`,
            deleted: Boolean(extra.deleted),
            collapsed: Boolean(extra.collapsed),
            edited: Boolean(extra.edited)
        }
    };
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

test('selected comments export in preserved hierarchy as JSON Markdown and CSV', async () => {
    const exporter = await loadCommentExport();
    const selected = [
        comment('t1_parent', 't3_post', 0, 'Parent text', { discoveryIndex: 1 }),
        comment('t1_child', 't1_parent', 1, 'Child text', { discoveryIndex: 2, edited: true }),
        comment('t1_deleted', 't3_post', 0, '[removed]', { discoveryIndex: 3, author: '[deleted]', deleted: true, collapsed: true })
    ];
    const prepared = exporter.prepareArchiveItems(selected, {
        postId: 't3_post',
        postLabel: 'fixture · title',
        postPermalink: 'https://www.reddit.com/r/fixture/comments/post/title/'
    });

    assert.equal(prepared.selectedCommentCount, 3);
    assert.equal(prepared.selectedBinaryCount, 0);
    assert.deepEqual(prepared.finalItems.map(item => item.payload.fixedArchiveName), [
        'comments.json',
        'comments.md',
        'comments.csv'
    ]);

    const json = JSON.parse(prepared.finalItems[0].payload.generatedText);
    assert.deepEqual(json.comments.map(record => record.id), [
        't1_parent',
        't1_child',
        't1_deleted'
    ]);
    assert.equal(json.comments[1].depth, 1);
    assert.equal(json.comments[2].deleted, true);
    assert.equal(json.comments[2].collapsed, true);

    const markdown = prepared.finalItems[1].payload.generatedText;
    assert.match(markdown, /\*\*fixture-author\*\*/);
    assert.match(markdown, /  - \*\*fixture-author\*\*/);
    assert.match(markdown, /\[removed\]/);

    const csv = prepared.finalItems[2].payload.generatedText;
    assert.match(csv, /"comment_id","parent_id","depth"/);
    assert.match(csv, /"t1_child","t1_parent","1"/);
});

test('only manually selected comment records are passed to generated exports', async () => {
    const exporter = await loadCommentExport();
    const candidates = [
        comment('t1_selected', 't3_post', 0, 'Keep me'),
        comment('t1_deselected', 't3_post', 0, 'Do not export', { manuallySelected: false })
    ];
    const selected = candidates.filter(item => item.manuallySelected);
    const prepared = exporter.prepareArchiveItems(selected, { postId: 't3_post' });
    const json = JSON.parse(prepared.finalItems[0].payload.generatedText);
    assert.deepEqual(json.comments.map(record => record.id), ['t1_selected']);
    assert.doesNotMatch(prepared.finalItems[1].payload.generatedText, /Do not export/);
});

test('Reddit implementation uses rendered DOM only and performs no account actions or API enumeration', async () => {
    const source = [
        await read('src/adapters/reddit-comments/00-config.user.js.part'),
        await read('src/adapters/reddit-comments/10-comments.user.js.part'),
        await read('src/adapters/reddit-comments/20-media.user.js.part'),
        await read('src/adapters/reddit-comments/30-thread.user.js.part')
    ].join('\n');
    assert.match(source, /querySelectorAll/);
    assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|\/api\/|graphql|Authorization/i);
    assert.doesNotMatch(source, /\.click\(\)|vote|upvote|downvote|join|follow|submit|postMessage/i);
    assert.match(source, /kind: 'comment'/);
    assert.match(source, /kind: 'media'/);
});

test('comment exports are generated locally and only media enters binary transport', async () => {
    const archive = await read('src/core/42-archive-workflow.user.js.part');
    assert.match(archive, /entry\.kind === 'generated-document'/);
    assert.match(archive, /entry\.payload\.generatedBytes/);
    assert.match(archive, /else if \(entry\.kind === 'media'\)[\s\S]*requestArrayBuffer\(entry\.url\)/);
    const generatedBranch = archive.match(/if \(entry\.kind === 'generated-document'\)[\s\S]*?else if \(entry\.kind === 'media'\)/)?.[0] || '';
    assert.doesNotMatch(generatedBranch.split('else if')[0], /requestArrayBuffer/);
});

test('Reddit hosts are minimal and thread matches remain narrow', async () => {
    const manifest = JSON.parse(await read('src/adapters/manifest.json'));
    const adapter = manifest.adapters.find(item => item.id === 'reddit-comments');
    assert.deepEqual(adapter.matches, [
        'https://www.reddit.com/r/*/comments/*',
        'https://reddit.com/r/*/comments/*',
        'https://old.reddit.com/r/*/comments/*'
    ]);
    assert.deepEqual(adapter.connect, [
        'i.redd.it',
        'preview.redd.it',
        'external-preview.redd.it',
        'v.redd.it'
    ]);
});
