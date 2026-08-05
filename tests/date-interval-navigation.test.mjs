import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('date intervals seek without collection and then use safe overlap scanning', async () => {
    const navigation = await read('src/core/32-date-interval-navigation.user.js.part');
    const workflow = await read('src/core/51-date-aware-workflow.user.js.part');
    const discord = await read('src/adapters/discord/20-items.user.js.part');

    assert.match(navigation, /setScanCollectionPolicy({ enabled: false })/);
    assert.match(navigation, /seekDateBoundary/);
    assert.match(navigation, /autoScrollToOldest/);
    assert.match(navigation, /autoScrollToNewest/);
    assert.match(navigation, /DATE_SEEK_NO_PROGRESS/);
    assert.match(workflow, /scanMode = dateRange.enableds*? 'date-interval'/);
    assert.match(workflow, /runDateIntervalScan/);
    assert.match(discord, /shouldCollectRenderedItem(sourceElement)/);
});

test('compact interface exposes Scan, Media, Archive and Activity tabs', async () => {
    const layout = await read('src/core/64-interface-layout.user.js.part');
    for (const label of ['Scan', 'Media', 'Archive', 'Activity']) {
        assert.match(layout + await read('src/core/60-ui-markup.user.js.part'), new RegExp(label));
    }
    assert.match(layout, /grid-template-columns: repeat(4, 1fr)/);
    assert.match(layout, /scanDirectionLabel.hidden = dateMode/);
});
