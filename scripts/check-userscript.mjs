import { readFile } from 'node:fs/promises';

const path = new URL('../discord-media-archiver.user.js', import.meta.url);
const source = await readFile(path, 'utf8');

const failures = [];
const requireText = (needle, description = needle) => {
    if (!source.includes(needle)) failures.push(`Missing: ${description}`);
};
const forbid = (pattern, description) => {
    if (pattern.test(source)) failures.push(`Forbidden pattern: ${description}`);
};

const metadataVersion = source.match(/^\/\/ @version\s+([^\s]+)$/m)?.[1];
const runtimeVersion = source.match(/const VERSION = '([^']+)'/)?.[1];

if (!metadataVersion || !runtimeVersion) {
    failures.push('Could not read both version declarations.');
} else if (metadataVersion !== runtimeVersion) {
    failures.push(`Version mismatch: metadata=${metadataVersion}, runtime=${runtimeVersion}`);
}

for (const host of [
    'cdn.discordapp.com',
    'media.discordapp.net',
    'images-ext-1.discordapp.net',
    'images-ext-2.discordapp.net'
]) {
    requireText(`// @connect      ${host}`, `@connect ${host}`);
}

for (const marker of [
    'resolveFflateLibrary',
    'buildFallbackStoredZip',
    'scanExternalGifPreviews',
    'getDateRangeConfig',
    'autoScrollToOldest',
    'autoScrollToNewest',
    'applyFinalChatPosition',
    'manifest_part.csv'
]) {
    requireText(marker, marker);
}

forbid(/localStorage\s*\.\s*getItem\s*\([^)]*token/i, 'Discord token access through localStorage');
forbid(/webpackChunkdiscord_app/i, 'Discord webpack token/module extraction');
forbid(/Authorization\s*:\s*[`'"](?:Bot\s+)?/i, 'Authorization header construction');
forbid(/discord\.com\/api\//i, 'direct Discord API access');
forbid(/\/api\/v\d+\/channels\//i, 'Discord channel API access');

const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8')
);
if (packageJson.version !== metadataVersion) {
    failures.push(
        `package.json version ${packageJson.version} does not match userscript ${metadataVersion}`
    );
}

if (failures.length) {
    console.error('Userscript validation failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
}

console.log(`Userscript ${metadataVersion} passed repository validation.`);
