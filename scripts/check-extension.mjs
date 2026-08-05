import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const target = process.argv[2];
if (!['chromium', 'firefox'].includes(target)) {
    throw new Error('Usage: node scripts/check-extension.mjs chromium|firefox');
}

const readJson = async path => JSON.parse(await readFile(resolve(repositoryRoot, path), 'utf8'));
const buildManifest = await readJson('src/build-manifest.json');
const adapterManifest = await readJson('src/adapters/manifest.json');
const packageJson = await readJson('package.json');
const manifest = await readJson(`dist/${target}/manifest.json`);
const content = await readFile(resolve(repositoryRoot, `dist/${target}/content.js`), 'utf8');
const background = await readFile(resolve(repositoryRoot, `dist/${target}/background.js`), 'utf8');
const matches = [...new Set(adapterManifest.adapters.flatMap(adapter => adapter.matches || []))];
const downloadHosts = [...new Set(adapterManifest.adapters.flatMap(adapter => adapter.connect || []))].sort();
const externalHosts = [...new Set(buildManifest.runtimeConnect || [])].sort();
const hosts = [...new Set([...downloadHosts, ...externalHosts])].sort();
const permissions = hosts.map(host => `https://${host}/*`);
const failures = [];
const requireValue = (condition, message) => { if (!condition) failures.push(message); };

requireValue(manifest.name === 'Media Archiver', 'Manifest name must remain site-neutral.');
requireValue(manifest.version === packageJson.version, 'Manifest version must match package.json.');
requireValue(JSON.stringify(manifest.content_scripts?.[0]?.matches || []) === JSON.stringify(matches), 'Content-script matches must be generated from adapter manifests.');
requireValue(content.trimEnd().endsWith('})();'), 'Content script is incomplete.');
requireValue(!/\bGM_(?:xmlhttpRequest|getValue|setValue)\b/.test(content), 'Content script contains userscript APIs.');
requireValue(!content.includes('__ADAPTER_'), 'Content script contains an unreplaced adapter placeholder.');
requireValue(!background.includes('__ALLOWED_'), 'Background contains an unreplaced host placeholder.');
requireValue(background.includes(JSON.stringify(downloadHosts)), 'Background media allowlist differs from adapter hosts.');
requireValue(background.includes(JSON.stringify(externalHosts)), 'Background service allowlist differs from runtime hosts.');
requireValue(background.includes('hostMatchesPattern'), 'Background does not support wildcard media hosts.');
requireValue(content.includes('requestExternal'), 'Content runtime is missing external service transport.');
requireValue(background.includes('media-archiver:external-request'), 'Background runtime is missing external service routing.');
requireValue(permissions.includes('https://www.virustotal.com/*'), 'VirusTotal host permission is missing.');
requireValue(!/(?:importScripts|import)\s*\(?\s*['"]https?:/i.test(`${content}\n${background}`), 'Remote executable JavaScript is forbidden.');
requireValue(!/@require\s+https?:/i.test(content), 'Extension content must not contain userscript remote requirements.');

if (target === 'chromium') {
    requireValue(manifest.manifest_version === 3, 'Chromium must use Manifest V3.');
    requireValue(manifest.background?.service_worker === 'background.js', 'Chromium background service worker is missing.');
    requireValue(JSON.stringify(manifest.host_permissions || []) === JSON.stringify(permissions), 'Chromium host permissions are not minimal/generated.');
    requireValue(Boolean(manifest.action), 'Chromium toolbar action is missing.');
} else {
    requireValue(manifest.manifest_version === 2, 'Firefox package must use the compatible Manifest V2 target.');
    requireValue(manifest.background?.scripts?.includes('background.js'), 'Firefox background script is missing.');
    const firefoxHosts = (manifest.permissions || []).filter(value => value.startsWith('https://'));
    requireValue(JSON.stringify(firefoxHosts) === JSON.stringify(permissions), 'Firefox host permissions are not minimal/generated.');
    requireValue(Boolean(manifest.browser_action), 'Firefox toolbar action is missing.');
}

const packagePath = resolve(repositoryRoot, 'dist', `media-archiver-${target}-${packageJson.version}.zip`);
const packageStats = await stat(packagePath);
requireValue(packageStats.size > 1_000, 'Packaged extension ZIP is unexpectedly empty.');

if (failures.length) {
    console.error(`${target} extension validation failed:`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
}
console.log(
    `${target} extension ${packageJson.version} passed validation with ` +
    `${downloadHosts.length} media host permission(s) and ${externalHosts.length} optional service host permission(s).`
);
