import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

async function pinterestContext(pathname = '/fixture/board/') {
    const context = vm.createContext({
        URL,
        String,
        Number,
        BigInt,
        Object,
        Array,
        Set,
        RegExp,
        location: {
            hostname: 'www.pinterest.com',
            pathname,
            href: `https://www.pinterest.com${pathname}`,
            origin: 'https://www.pinterest.com'
        },
        sanitizeFilename: value => String(value).replace(/[^a-z0-9._-]+/gi, '-'),
        scanPinterestVisibleMedia() {},
        findPinterestScroller() {},
        pinterestVisibleItemIds() { return []; },
        findPinterestItemElementById() {},
        capturePinterestStartingAnchor() {}
    });
    vm.runInContext(
        await read('src/adapters/pinterest/00-config.user.js.part'),
        context,
        { filename: 'pinterest-config' }
    );
    return context;
}

test('Pinterest activates only on deterministic initial surfaces', async () => {
    const context = await pinterestContext();
    const classify = pathname => vm.runInContext(
        `pinterestPageType({ hostname: 'www.pinterest.com', pathname: ${JSON.stringify(pathname)} })`,
        context
    );

    assert.equal(classify('/pin/900000000000000003/'), 'pin-detail');
    assert.equal(classify('/search/pins/?q=fixture'), 'search-results');
    assert.equal(classify('/fixture/board/'), 'board');
    assert.equal(classify('/fixture/_created/'), 'profile-grid');
    assert.equal(classify('/fixture/_saved/'), 'profile-grid');
    assert.equal(classify('/'), null);
    assert.equal(classify('/homefeed/'), null);
    assert.equal(classify('/settings/'), null);
});

test('Pinterest chooses the strongest actually rendered source without inventing a URL', async () => {
    const context = await pinterestContext('/pin/900000000000000003/');
    context.fixtureImage = {
        tagName: 'IMG',
        currentSrc: 'https://i.pinimg.com/736x/11/22/33/fixture-detail.webp',
        src: 'https://i.pinimg.com/236x/11/22/33/fixture-detail.webp',
        getAttribute(name) {
            if (name === 'srcset') {
                return 'https://i.pinimg.com/236x/11/22/33/fixture-detail.webp 236w, https://i.pinimg.com/originals/11/22/33/fixture-detail.webp 1600w';
            }
            if (name === 'src') return this.src;
            return null;
        },
        closest() { return null; }
    };
    const result = vm.runInContext('pinterestBestRenderedUrl(fixtureImage)', context);
    assert.equal(result, 'https://i.pinimg.com/736x/11/22/33/fixture-detail.webp');
});

test('Pinterest fixture encodes masonry duplicate merging', async () => {
    const fixture = await read('tests/fixtures/pinterest-board.html');
    const ids = [...fixture.matchAll(/data-test-pin-id="([^"]+)"/g)].map(match => match[1]);
    assert.equal(ids.length, 3);
    assert.equal(new Set(ids).size, 2);
    assert.match(fixture, /data-test-duplicate-render="true"/);
});

test('Pinterest adapter uses only rendered DOM and minimal declared hosts', async () => {
    const manifest = JSON.parse(await read('src/adapters/manifest.json'));
    const adapter = manifest.adapters.find(item => item.id === 'pinterest');
    const source = [
        await read('src/adapters/pinterest/00-config.user.js.part'),
        await read('src/adapters/pinterest/10-items.user.js.part'),
        await read('src/adapters/pinterest/20-timeline.user.js.part')
    ].join('\n');

    assert.deepEqual(adapter.connect, ['i.pinimg.com', 'v1.pinimg.com', 'v.pinimg.com']);
    assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|\/resource\/|\/api\//i);
    assert.match(source, /querySelectorAll/);
    assert.match(source, /recordCanonicalDuplicate/);
    assert.match(source, /dateFilter: false/);
});
