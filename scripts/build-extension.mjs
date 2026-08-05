import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const target = process.argv[2];
if (!['chromium', 'firefox'].includes(target)) {
    throw new Error('Usage: node scripts/build-extension.mjs chromium|firefox');
}

const readText = path => readFile(resolve(repositoryRoot, path), 'utf8');
const readJson = async path => JSON.parse(await readText(path));
const buildManifest = await readJson('src/build-manifest.json');
const adapterManifest = await readJson('src/adapters/manifest.json');
const packageJson = await readJson('package.json');
const adapters = adapterManifest.adapters || [];

const userscriptRuntimePath = 'src/core/09-userscript-runtime.user.js.part';
const extensionRuntimePath = 'src/runtimes/extension/content-runtime.user.js.part';
const beforePaths = buildManifest.beforeAdapters.map(path =>
    path === userscriptRuntimePath ? extensionRuntimePath : path
);
const adapterPaths = adapters.flatMap(adapter => adapter.modules || [adapter.module]);
const allPaths = [...beforePaths, ...adapterPaths, ...buildManifest.afterAdapters];
const modules = await Promise.all(allPaths.map(readText));

modules[0] = modules[0].replace(
    /^\/\/ ==UserScript==[\s\S]*?^\/\/ ==\/UserScript==\s*/m,
    ''
);
const contentScript = modules.join('');
if (!contentScript.trimEnd().endsWith('})();')) {
    throw new Error('Extension content script assembly is incomplete.');
}
if (/\bGM_(?:xmlhttpRequest|getValue|setValue)\b/.test(contentScript)) {
    throw new Error('Extension content script contains a userscript runtime API.');
}

const matchPatterns = [...new Set(adapters.flatMap(adapter => adapter.matches || []))];
const downloadHosts = [...new Set(adapters.flatMap(adapter => adapter.connect || []))].sort();
const hostPermissions = downloadHosts.map(host => `https://${host}/*`);
const backgroundTemplate = await readText('src/runtimes/extension/background.js.template');
const backgroundScript = backgroundTemplate.replace(
    '__ALLOWED_DOWNLOAD_HOSTS__',
    JSON.stringify(downloadHosts)
);
if (backgroundScript.includes('__ALLOWED_DOWNLOAD_HOSTS__')) {
    throw new Error('Extension background allowlist placeholder was not replaced.');
}

const common = {
    name: 'Media Archiver',
    version: packageJson.version,
    description: 'Archive rendered content from supported web applications.',
    content_scripts: [{
        matches: matchPatterns,
        js: ['content.js'],
        run_at: 'document_idle',
        all_frames: false
    }]
};

const manifest = target === 'chromium'
    ? {
        manifest_version: 3,
        ...common,
        permissions: ['storage', 'downloads'],
        host_permissions: hostPermissions,
        background: { service_worker: 'background.js', type: 'module' },
        action: { default_title: 'Open Media Archiver' },
        content_security_policy: {
            extension_pages: "script-src 'self'; object-src 'self'"
        }
    }
    : {
        manifest_version: 2,
        ...common,
        permissions: ['storage', 'downloads', ...hostPermissions],
        background: { scripts: ['background.js'], persistent: false },
        browser_action: { default_title: 'Open Media Archiver' },
        content_security_policy: "script-src 'self'; object-src 'self'",
        browser_specific_settings: {
            gecko: {
                id: 'media-archiver@madebycli',
                strict_min_version: '128.0'
            }
        }
    };

const outputDirectory = resolve(repositoryRoot, 'dist', target);
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
const files = {
    'manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'content.js': contentScript,
    'background.js': backgroundScript
};
for (const [name, content] of Object.entries(files)) {
    await writeFile(resolve(outputDirectory, name), content, 'utf8');
}

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index++) {
        let value = index;
        for (let bit = 0; bit < 8; bit++) {
            value = (value & 1) ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
        }
        table[index] = value >>> 0;
    }
    return table;
})();

function crc32(bytes) {
    let value = 0xFFFFFFFF;
    for (const byte of bytes) {
        value = CRC_TABLE[(value ^ byte) & 0xFF] ^ (value >>> 8);
    }
    return (value ^ 0xFFFFFFFF) >>> 0;
}

function u16(value) {
    const bytes = Buffer.alloc(2);
    bytes.writeUInt16LE(value, 0);
    return bytes;
}

function u32(value) {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32LE(value >>> 0, 0);
    return bytes;
}

function storedZip(entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    for (const [name, content] of entries.sort(([a], [b]) => a.localeCompare(b))) {
        const nameBytes = Buffer.from(name, 'utf8');
        const data = Buffer.from(content, 'utf8');
        const crc = crc32(data);
        const local = Buffer.concat([
            u32(0x04034B50), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21),
            u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0),
            nameBytes
        ]);
        const central = Buffer.concat([
            u32(0x02014B50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21),
            u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0),
            u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes
        ]);
        localParts.push(local, data);
        centralParts.push(central);
        offset += local.length + data.length;
    }
    const centralDirectory = Buffer.concat(centralParts);
    const end = Buffer.concat([
        u32(0x06054B50), u16(0), u16(0), u16(entries.length), u16(entries.length),
        u32(centralDirectory.length), u32(offset), u16(0)
    ]);
    return Buffer.concat([...localParts, centralDirectory, end]);
}

const packagePath = resolve(
    repositoryRoot,
    'dist',
    `media-archiver-${target}-${packageJson.version}.zip`
);
await writeFile(packagePath, storedZip(Object.entries(files)));
console.log(
    `Built ${target} extension with ${adapters.length} adapter(s), ` +
    `${matchPatterns.length} page match(es), and ${downloadHosts.length} download host permission(s).`
);
console.log(`Package: ${packagePath}`);
