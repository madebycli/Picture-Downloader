import { readdir, readFile, writeFile } from 'node:fs/promises';

const partsDirectory = new URL('../src/parts/', import.meta.url);
const outputPath = new URL('../discord-media-archiver.user.js', import.meta.url);

const partNames = (await readdir(partsDirectory))
    .filter(name => name.endsWith('.user.js.part'))
    .sort();

if (!partNames.length) {
    throw new Error('No userscript parts were found in src/parts.');
}

const contents = await Promise.all(
    partNames.map(name => readFile(new URL(name, partsDirectory), 'utf8'))
);

const assembled = contents.join('');
if (!assembled.startsWith('// ==UserScript==')) {
    throw new Error('Assembled userscript has no metadata header.');
}
if (!assembled.trimEnd().endsWith('})();')) {
    throw new Error('Assembled userscript appears incomplete.');
}

await writeFile(outputPath, assembled, 'utf8');
console.log(`Assembled ${partNames.length} parts into discord-media-archiver.user.js.`);
