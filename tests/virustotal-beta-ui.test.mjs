import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(
    new URL('../src/core/65-virustotal-ui.user.js.part', import.meta.url),
    'utf8'
);

test('VirusTotal Beta is an Archive-tab disclosure that is closed by default', () => {
    assert.match(source, /document\.createElement\('details'\)/);
    assert.match(source, /ma-vt-beta-badge/);
    assert.match(source, />BETA</);
    assert.match(source, /data-ma-panel="archive"/);
    assert.doesNotMatch(source, /virusTotalGroup\.open\s*=\s*true/);
});

test('7.2 resets VirusTotal to off once and keeps settings opt-in', () => {
    assert.match(source, /virustotal\.v72BetaReset/);
    assert.match(source, /runtime\.setSetting\('virustotal\.mode', 'off'\)/);
    assert.match(source, /VirusTotal is disabled\. No hashes or files are sent\./);
    assert.match(source, /virusTotalUploadConsentCheckbox\.checked = false/);
});

test('VirusTotal settings are separated into individual cards', () => {
    for (const heading of [
        'Check mode',
        'API access',
        'Blocking rule',
        'Unknown or failed checks',
        'Upload consent for this session'
    ]) {
        assert.match(source, new RegExp(heading));
    }
});
