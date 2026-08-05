import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

async function loadVirusTotal() {
    const context = vm.createContext({
        URL,
        Date,
        Map,
        Object,
        Array,
        String,
        Number,
        Boolean,
        Error,
        TypeError,
        Promise,
        ArrayBuffer,
        Uint8Array,
        TextEncoder,
        crypto: webcrypto,
        setTimeout,
        clearTimeout
    });
    const source = await readFile(
        new URL('src/shared/virustotal-service.user.js.part', root),
        'utf8'
    );
    vm.runInContext(source, context, { filename: 'virustotal-service' });
    return context.MediaArchiverVirusTotal;
}

const bytes = value => new TextEncoder().encode(value);

test('VirusTotal computes deterministic SHA-256 without uploading', async () => {
    const api = await loadVirusTotal();
    assert.equal(
        await api.sha256Hex(bytes('abc'), webcrypto),
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
});

test('known clean hash reuses the report and never uploads file bytes', async () => {
    const api = await loadVirusTotal();
    const calls = [];
    const runtime = {
        async requestExternal(url, options) {
            calls.push({ url, method: options.method, multipart: Boolean(options.multipartFile) });
            return {
                ok: true,
                status: 200,
                body: {
                    data: {
                        attributes: {
                            last_analysis_stats: {
                                malicious: 0,
                                suspicious: 0,
                                harmless: 62,
                                undetected: 8
                            }
                        }
                    }
                }
            };
        }
    };
    const service = api.createService(runtime, {
        minimumIntervalMs: 0,
        crypto: webcrypto
    });
    const result = await service.scanBytes(bytes('clean sample'), 'clean.jpg', {
        mode: 'upload-unknown',
        apiKey: 'secret-fixture-key',
        uploadConsent: true,
        blockThreshold: 'suspicious',
        unknownPolicy: 'block'
    });

    assert.equal(result.verdict, 'clean');
    assert.equal(result.uploaded, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].multipart, false);
    assert.doesNotMatch(JSON.stringify(result), /secret-fixture-key/);
});

test('hash-only mode returns unknown without a file upload', async () => {
    const api = await loadVirusTotal();
    const calls = [];
    const service = api.createService({
        async requestExternal(url, options) {
            calls.push({ url, options });
            return { ok: false, status: 404, body: null };
        }
    }, { minimumIntervalMs: 0, crypto: webcrypto });

    const result = await service.scanBytes(bytes('unknown sample'), 'unknown.gif', {
        mode: 'hash-only',
        apiKey: 'fixture-key',
        unknownPolicy: 'allow'
    });
    assert.equal(result.verdict, 'unknown');
    assert.equal(result.uploaded, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, 'GET');
    assert.equal(calls[0].options.multipartFile, undefined);
});

test('upload-unknown requires explicit current-session consent', async () => {
    const api = await loadVirusTotal();
    const service = api.createService({
        async requestExternal() {
            return { ok: false, status: 404, body: null };
        }
    }, { minimumIntervalMs: 0, crypto: webcrypto });

    await assert.rejects(
        service.scanBytes(bytes('consent sample'), 'fixture.png', {
            mode: 'upload-unknown',
            apiKey: 'fixture-key',
            uploadConsent: false
        }),
        error => error.code === 'VIRUSTOTAL_UPLOAD_CONSENT_REQUIRED'
    );
});

test('unknown file can be uploaded and receives a completed flagged verdict', async () => {
    const api = await loadVirusTotal();
    const calls = [];
    const service = api.createService({
        async requestExternal(url, options) {
            calls.push({ url, method: options.method, multipart: options.multipartFile });
            if (url.includes('/files/') && options.method === 'GET') {
                return { ok: false, status: 404, body: null };
            }
            if (url.endsWith('/files') && options.method === 'POST') {
                return {
                    ok: true,
                    status: 200,
                    body: { data: { id: 'analysis-fixture' } }
                };
            }
            if (url.includes('/analyses/analysis-fixture')) {
                return {
                    ok: true,
                    status: 200,
                    body: {
                        data: {
                            attributes: {
                                status: 'completed',
                                stats: {
                                    malicious: 1,
                                    suspicious: 0,
                                    harmless: 60,
                                    undetected: 9
                                }
                            }
                        }
                    }
                };
            }
            throw new Error(`Unexpected request ${options.method} ${url}`);
        }
    }, {
        minimumIntervalMs: 0,
        pollIntervalMs: 0,
        maximumPolls: 2,
        crypto: webcrypto,
        sleep: async () => {}
    });

    const result = await service.scanBytes(bytes('flagged sample'), 'meme.mp4', {
        mode: 'upload-unknown',
        apiKey: 'fixture-key',
        uploadConsent: true,
        blockThreshold: 'malicious',
        unknownPolicy: 'allow'
    });

    assert.equal(result.verdict, 'malicious');
    assert.equal(result.uploaded, true);
    assert.equal(service.shouldBlock(result, { blockThreshold: 'malicious' }), true);
    const upload = calls.find(call => call.method === 'POST');
    assert.equal(upload.multipart.filename, 'meme.mp4');
    assert.ok(upload.multipart.bytes instanceof Uint8Array);
});

test('blocking rules distinguish suspicious and unknown policies', async () => {
    const api = await loadVirusTotal();
    assert.equal(api.shouldBlock({ verdict: 'malicious' }, { blockThreshold: 'malicious' }), true);
    assert.equal(api.shouldBlock({ verdict: 'suspicious' }, { blockThreshold: 'malicious' }), false);
    assert.equal(api.shouldBlock({ verdict: 'suspicious' }, { blockThreshold: 'suspicious' }), true);
    assert.equal(api.shouldBlock({ verdict: 'unknown' }, { unknownPolicy: 'allow' }), false);
    assert.equal(api.shouldBlock({ verdict: 'unknown' }, { unknownPolicy: 'block' }), true);
    assert.equal(api.shouldBlock({ verdict: 'error' }, { unknownPolicy: 'block' }), true);
});
