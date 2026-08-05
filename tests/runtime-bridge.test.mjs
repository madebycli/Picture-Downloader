import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('Tampermonkey globals are isolated to the userscript runtime bridge', async () => {
    const runtime = await read('src/core/09-userscript-runtime.user.js.part');
    const download = await read('src/core/40-download-manifest.user.js.part');
    const zip = await read('src/core/41-zip-engine.user.js.part');
    const shared = (await Promise.all([
        'src/shared/runtime-contract.user.js.part',
        'src/shared/domain.user.js.part',
        'src/shared/workflow-state.user.js.part',
        'src/shared/selection-store.user.js.part',
        'src/shared/naming-service.user.js.part',
        'src/shared/diagnostics-metrics.user.js.part'
    ].map(read))).join('\n');

    assert.match(runtime, /GM_xmlhttpRequest/);
    assert.match(runtime, /GM_getValue/);
    assert.match(runtime, /GM_setValue/);
    assert.doesNotMatch(download, /GM_xmlhttpRequest/);
    assert.doesNotMatch(zip, /URL\.createObjectURL|document\.createElement\('a'\)/);
    assert.doesNotMatch(shared, /\bGM_|\bchrome\.|\bbrowser\./);
});

test('userscript runtime implements every required contract operation', async () => {
    const runtime = await read('src/core/09-userscript-runtime.user.js.part');
    for (const method of [
        'fetchBinary',
        'abortRequest',
        'abortAllRequests',
        'saveBlob',
        'copyText',
        'getSetting',
        'setSetting',
        'getPlatformInfo',
        'openUi',
        'closeUi'
    ]) {
        assert.match(runtime, new RegExp(`\\b${method}\\s*\\(`));
    }
});

test('download retry orchestration uses runtime transport and stable diagnostics', async () => {
    const download = await read('src/core/40-download-manifest.user.js.part');
    assert.match(download, /runtime\.fetchBinary/);
    assert.match(download, /NETWORK_HOST_REJECTED|NETWORK_RETRY_EXHAUSTED/);
    assert.match(download, /diagnostics\.error/);
    assert.match(download, /REQUEST_RETRIES/);
});
