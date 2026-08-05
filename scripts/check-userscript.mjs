import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const readJson = async relativePath => JSON.parse(
    await readFile(resolve(repositoryRoot, relativePath), 'utf8')
);

const buildManifest = await readJson('src/build-manifest.json');
const adapterManifest = await readJson('src/adapters/manifest.json');
const source = await readFile(
    resolve(repositoryRoot, buildManifest.output),
    'utf8'
);
const packageJson = await readJson('package.json');
const coreSource = (await Promise.all(
    [
        ...buildManifest.beforeAdapters,
        ...buildManifest.afterAdapters
    ].map(relativePath =>
        readFile(resolve(repositoryRoot, relativePath), 'utf8')
    )
)).join('\n');

const failures = [];
const requireText = (needle, description = needle) => {
    if (!source.includes(needle)) failures.push(`Missing: ${description}`);
};
const forbid = (pattern, description) => {
    if (pattern.test(source)) failures.push(`Forbidden pattern: ${description}`);
};

const metadataName = source.match(/^\/\/ @name\s+(.+)$/m)?.[1]?.trim();
const metadataVersion = source.match(/^\/\/ @version\s+([^\s]+)$/m)?.[1];
const runtimeVersion = source.match(/const VERSION = '([^']+)'/)?.[1];

if (metadataName !== 'Media Archiver') {
    failures.push(`Unexpected userscript name: ${metadataName || 'missing'}`);
}
if (!metadataVersion || !runtimeVersion) {
    failures.push('Could not read both version declarations.');
} else if (metadataVersion !== runtimeVersion) {
    failures.push(`Version mismatch: metadata=${metadataVersion}, runtime=${runtimeVersion}`);
}
if (packageJson.version !== metadataVersion) {
    failures.push(
        `package.json version ${packageJson.version} does not match userscript ${metadataVersion}`
    );
}

for (const adapter of adapterManifest.adapters || []) {
    requireText(`id: '${adapter.id}'`, `runtime adapter ${adapter.id}`);
    requireText(`label: '${adapter.label}'`, `adapter label ${adapter.label}`);

    for (const match of adapter.matches || []) {
        requireText(`// @match        ${match}`, `@match ${match}`);
    }
    for (const host of adapter.connect || []) {
        requireText(`// @connect      ${host}`, `@connect ${host}`);
    }
}

for (const marker of [
    'registerSiteAdapter',
    'resolveSiteAdapter',
    'activeSiteAdapter',
    'createDiscordAdapter',
    'buildFallbackStoredZip',
    'getDateRangeConfig',
    'autoScrollToOldest',
    'autoScrollToNewest',
    'media-archiver-panel',
    'data-ma-tab="setup"',
    'data-ma-tab="media"',
    'data-ma-tab="activity"',
    'manifest_part.csv'
]) {
    requireText(marker, marker);
}

forbid(/Discord Media Archiver/i, 'site name in the product title');
forbid(/discord-auto-zip-panel/i, 'legacy Discord-specific panel id');
forbid(/\bdaz-/i, 'legacy Discord-specific UI prefix');
forbid(/what(?:'|’)s new|change\s*log/i, 'release notes inside the runtime UI');
forbid(/localStorage\s*\.\s*getItem\s*\([^)]*token/i, 'token access through localStorage');
forbid(/webpackChunkdiscord_app/i, 'Discord webpack token/module extraction');
forbid(/Authorization\s*:\s*[`'"](?:Bot\s+)?/i, 'Authorization header construction');
forbid(/discord\.com\/api\//i, 'direct Discord API access');
forbid(/\/api\/v\d+\/channels\//i, 'Discord channel API access');

for (const [pattern, description] of [
    [/discord(?:app)?\.com|discordapp\.net/i, 'Discord host in core modules'],
    [/chat-messages|message-timestamp/i, 'Discord DOM selector in core modules'],
    [/DISCORD_EPOCH/i, 'Discord timestamp constant in core modules']
]) {
    if (pattern.test(coreSource)) {
        failures.push(`Site coupling in core: ${description}`);
    }
}

if (failures.length) {
    console.error('Userscript validation failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
}

console.log(
    `${metadataName} ${metadataVersion} passed validation with ` +
    `${adapterManifest.adapters.length} adapter(s).`
);
