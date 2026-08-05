import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const packageJson = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'));
const targets = ['chromium', 'firefox'];

async function hashes() {
    const values = {};
    for (const target of targets) {
        const path = resolve(repositoryRoot, 'dist', `media-archiver-${target}-${packageJson.version}.zip`);
        values[target] = createHash('sha256').update(await readFile(path)).digest('hex');
    }
    return values;
}

const before = await hashes();
for (const target of targets) {
    const result = spawnSync(process.execPath, ['scripts/build-extension.mjs', target], {
        cwd: repositoryRoot,
        encoding: 'utf8'
    });
    if (result.status !== 0) {
        process.stderr.write(result.stdout || '');
        process.stderr.write(result.stderr || '');
        process.exit(result.status || 1);
    }
}
const after = await hashes();
for (const target of targets) {
    if (before[target] !== after[target]) {
        throw new Error(`${target} extension package is not reproducible.`);
    }
}
console.log(`Reproducible extension packages: ${JSON.stringify(after)}`);
