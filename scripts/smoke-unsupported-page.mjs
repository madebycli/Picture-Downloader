import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(
    new URL('../media-archiver.user.js', import.meta.url),
    'utf8'
);

const context = {
    location: {
        hostname: 'unsupported.example',
        pathname: '/not-supported',
        href: 'https://unsupported.example/not-supported'
    },
    URL,
    console,
    Set,
    Map,
    Object,
    Promise,
    Number,
    String,
    BigInt,
    Date,
    Math,
    RegExp,
    TextEncoder,
    Uint8Array,
    DataView,
    Blob,
    performance,
    setTimeout,
    clearTimeout
};

vm.runInNewContext(source, context, { timeout: 2_000 });
console.log('Unsupported-page smoke test passed without DOM access.');
