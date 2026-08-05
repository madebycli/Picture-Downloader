import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const readJson = async relativePath => JSON.parse(
    await readFile(resolve(repositoryRoot, relativePath), 'utf8')
);
const readText = relativePath =>
    readFile(resolve(repositoryRoot, relativePath), 'utf8');

const buildManifest = await readJson('src/build-manifest.json');
const adapterManifest = await readJson('src/adapters/manifest.json');
const source = await readText(buildManifest.output);
const packageJson = await readJson('package.json');
const coreSource = (await Promise.all(
    [
        ...buildManifest.beforeAdapters,
        ...buildManifest.afterAdapters
    ].map(readText)
)).join('\n');
const sharedPaths = buildManifest.beforeAdapters.filter(path =>
    path.startsWith('src/shared/')
);
const sharedSource = (await Promise.all(sharedPaths.map(readText))).join('\n');
const userscriptRuntimeSource = await readText(
    'src/core/09-userscript-runtime.user.js.part'
);

const failures = [];
const requireText = (needle, description = needle) => {
    if (!source.includes(needle)) failures.push(`Missing: ${description}`);
};
const forbid = (pattern, description, target = source) => {
    if (pattern.test(target)) failures.push(`Forbidden pattern: ${description}`);
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
    'createPinterestAdapter',
    'createRedditCommentsAdapter',
    'MediaArchiverRuntimeContract',
    'MediaArchiverSelection',
    'MediaArchiverNaming',
    'planArchiveNames',
    'createDiagnosticsStore',
    'createLiveMetrics',
    'reviewArchiveConfirmed',
    'archiveSelectedFromLibrary',
    'buildFallbackStoredZip',
    'getDateRangeConfig',
    'autoScrollToOldest',
    'autoScrollToNewest',
    'media-archiver-panel',
    'ma-library-dialog',
    'ma-developer-logs',
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
forbid(/(?:pinterest|reddit)\.com\/api\//i, 'private site API access');

for (const [pattern, description] of [
    [/discord(?:app)?\.com|discordapp\.net/i, 'Discord host in shared/core modules'],
    [/pinterest\.com|pinimg\.com/i, 'Pinterest host in shared/core modules'],
    [/reddit\.com|redd\.it/i, 'Reddit host in shared/core modules'],
    [/chat-messages|message-timestamp/i, 'Discord DOM selector in shared/core modules'],
    [/shreddit-comment|data-test-pin-id/i, 'site DOM selector in shared/core modules'],
    [/DISCORD_EPOCH/i, 'Discord timestamp constant in shared/core modules']
]) {
    if (pattern.test(coreSource)) {
        failures.push(`Site coupling in core: ${description}`);
    }
}

forbid(/\bGM_[A-Za-z]+\b/, 'Tampermonkey API in shared modules', sharedSource);
forbid(/\bchrome\s*\./, 'Chromium API in shared modules', sharedSource);
forbid(/\bbrowser\s*\./, 'Firefox API in shared modules', sharedSource);

for (const runtimeMarker of [
    'GM_xmlhttpRequest',
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
    if (!userscriptRuntimeSource.includes(runtimeMarker)) {
        failures.push(`Userscript runtime bridge is missing ${runtimeMarker}.`);
    }
}

const reviewGuardIndex = source.indexOf('reviewMode && !reviewArchiveConfirmed');
const requestIndex = source.indexOf('requestArrayBuffer(entry.url)');
if (reviewGuardIndex < 0 || requestIndex < 0 || reviewGuardIndex > requestIndex) {
    failures.push('Review confirmation guard must precede every original-file request path.');
}

if (failures.length) {
    console.error('Userscript validation failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
}

console.log(
    `${metadataName} ${metadataVersion} passed validation with ` +
    `${adapterManifest.adapters.length} adapter(s) and ${sharedPaths.length} shared module(s).`
);
