import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const readJson = async relativePath => JSON.parse(
    await readFile(resolve(repositoryRoot, relativePath), 'utf8')
);
const readModule = relativePath =>
    readFile(resolve(repositoryRoot, relativePath), 'utf8');

const buildManifest = await readJson('src/build-manifest.json');
const adapterManifest = await readJson('src/adapters/manifest.json');
const adapters = adapterManifest.adapters || [];

if (!adapters.length) {
    throw new Error('At least one site adapter must be configured.');
}

const beforeAdapters = await Promise.all(
    buildManifest.beforeAdapters.map(readModule)
);
const adapterModulePaths = adapters.flatMap(adapter =>
    adapter.modules || [adapter.module]
);
const adapterModules = await Promise.all(
    adapterModulePaths.map(readModule)
);
const afterAdapters = await Promise.all(
    buildManifest.afterAdapters.map(readModule)
);

const matchLines = [...new Set(
    adapters.flatMap(adapter => adapter.matches || [])
)].map(value => `// @match        ${value}`).join('\n');
const connectLines = [...new Set(
    adapters.flatMap(adapter => adapter.connect || [])
)].map(value => `// @connect      ${value}`).join('\n');

beforeAdapters[0] = beforeAdapters[0]
    .replace('// __ADAPTER_MATCHES__', matchLines)
    .replace('// __ADAPTER_CONNECTS__', connectLines);

const assembled = [
    ...beforeAdapters,
    ...adapterModules,
    ...afterAdapters
].join('');

if (!assembled.startsWith('// ==UserScript==')) {
    throw new Error('Assembled userscript has no metadata header.');
}
if (assembled.includes('__ADAPTER_')) {
    throw new Error('An adapter metadata placeholder was not replaced.');
}
if (!assembled.trimEnd().endsWith('})();')) {
    throw new Error('Assembled userscript appears incomplete.');
}

const outputPath = resolve(repositoryRoot, buildManifest.output);
await writeFile(outputPath, assembled, 'utf8');
console.log(
    `Assembled ${beforeAdapters.length + adapterModules.length + afterAdapters.length} modules ` +
    `and ${adapters.length} adapter(s) into ${buildManifest.output}.`
);
