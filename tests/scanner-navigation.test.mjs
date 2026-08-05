import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('Discord uses loaded-edge jumps instead of viewport-sized scanner steps', async () => {
    const config = await read('src/adapters/discord/00-config.user.js.part');
    const timeline = await read('src/adapters/discord/30-timeline.user.js.part');
    const boundaries = await read('src/core/31-scanner-boundaries.user.js.part');

    assert.match(config, /jumpScanWindow:\s*discordJumpScanWindow/);
    assert.match(config, /preferredScanMode:\s*'newest-to-oldest'/);
    assert.match(timeline, /function setDiscordLoadedEdge/);
    assert.match(timeline, /scroller\.scrollTop = direction === 'older'\s*\? 0\s*:\s*scroller\.scrollHeight/s);
    assert.match(timeline, /async function discordJumpScanWindow/);
    assert.match(boundaries, /activeSiteAdapter\?\.jumpScanWindow/);
});

test('Discord jump scanner verifies the previous edge and performs recovery scans', async () => {
    const timeline = await read('src/adapters/discord/30-timeline.user.js.part');
    const boundaries = await read('src/core/31-scanner-boundaries.user.js.part');

    for (const marker of [
        'overlapId',
        'overlapVerified',
        'findDiscordItemElementById(overlapId)',
        'recoveryDistance',
        '0.55 + pass * 0.45',
        'setDiscordLoadedEdge(scroller, direction)'
    ]) {
        assert.ok(timeline.includes(marker), `missing overlap marker ${marker}`);
    }
    assert.match(boundaries, /SCAN_OVERLAP_NOT_VERIFIED/);
    assert.match(boundaries, /A recovery scan was attempted/);
});

test('fast scanning retains duplicate-safe canonical collection and date boundaries', async () => {
    const discordItems = await read('src/adapters/discord/20-items.user.js.part');
    const boundaries = await read('src/core/31-scanner-boundaries.user.js.part');

    assert.match(discordItems, /const key = canonicalKey\(originalUrl\)/);
    assert.match(discordItems, /const existing = mediaEntries\.get\(key\)/);
    assert.match(discordItems, /recordCanonicalDuplicate\(existing/);
    assert.match(discordItems, /mediaEntries\.set\(key, item\)/);
    assert.match(boundaries, /selectedDateBoundaryReached\('older'\)/);
    assert.match(boundaries, /selectedDateBoundaryReached\('newer'\)/);
    assert.match(boundaries, /scanVisiblePage\(\);\s*await sleep\(120\);\s*scanVisiblePage\(\)/s);
});

test('adapter expansion runs before downward boundary completion', async () => {
    const boundaries = await read('src/core/31-scanner-boundaries.user.js.part');
    const reddit = await read('src/adapters/reddit-comments/00-config.user.js.part');

    assert.match(boundaries, /expandActiveRenderedContent/);
    assert.match(boundaries, /confirmRealTimelineEnd[\s\S]*expandActiveRenderedContent\(scroller, 'newer'\)/);
    assert.match(reddit, /expandRenderedContent:\s*expandRedditRenderedComments/);
    assert.match(reddit, /boundaryConfirmMs:\s*5_000/);
});
