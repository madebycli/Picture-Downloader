import { readFile, writeFile } from 'node:fs/promises';

const read = path => readFile(path, 'utf8');
const write = (path, content) => writeFile(path, content, 'utf8');

function replaceRequired(source, search, replacement, label) {
    if (!source.includes(search)) {
        throw new Error(`Missing expected ${label}`);
    }
    return source.replace(search, replacement);
}

const version = '7.3.0';

let bootstrap = await read('src/core/00-bootstrap.user.js.part');
bootstrap = replaceRequired(
    bootstrap,
    '// @version      7.2.0',
    `// @version      ${version}`,
    'userscript metadata version'
);
bootstrap = replaceRequired(
    bootstrap,
    '// @run-at       document-idle',
    '// @noframes\n// @run-at       document-idle',
    'userscript run-at marker'
);
bootstrap = replaceRequired(
    bootstrap,
    "    const VERSION = '7.2.0';\n    const APP_NAME = 'Media Archiver';",
    `    const VERSION = '${version}';
    const MEDIA_ARCHIVER_ROOT_ID = 'media-archiver-panel';
    const MEDIA_ARCHIVER_MOUNT_ATTRIBUTE = 'data-media-archiver-mounted';

    let mediaArchiverIsTopLevelDocument = false;
    try {
        mediaArchiverIsTopLevelDocument = window.top === window.self;
    } catch {
        mediaArchiverIsTopLevelDocument = false;
    }

    if (!mediaArchiverIsTopLevelDocument) return;

    const mediaArchiverDocumentRoot = document.documentElement;
    const mediaArchiverExistingPanel = document.getElementById(
        MEDIA_ARCHIVER_ROOT_ID
    );

    if (
        mediaArchiverExistingPanel ||
        mediaArchiverDocumentRoot?.hasAttribute(MEDIA_ARCHIVER_MOUNT_ATTRIBUTE)
    ) {
        mediaArchiverExistingPanel?.classList.remove('ma-collapsed');
        return;
    }

    mediaArchiverDocumentRoot?.setAttribute(
        MEDIA_ARCHIVER_MOUNT_ATTRIBUTE,
        VERSION
    );

    const APP_NAME = 'Media Archiver';`,
    'bootstrap version block'
);
await write('src/core/00-bootstrap.user.js.part', bootstrap);

const packageJson = JSON.parse(await read('package.json'));
packageJson.version = version;
await write('package.json', `${JSON.stringify(packageJson, null, 2)}\n`);

const packageLock = JSON.parse(await read('package-lock.json'));
packageLock.version = version;
packageLock.packages[''].version = version;
await write('package-lock.json', `${JSON.stringify(packageLock, null, 2)}\n`);

let baseline = await read('tests/baseline.test.mjs');
baseline = replaceRequired(
    baseline,
    "assert.equal(packageJson.version, '7.2.0');",
    "assert.equal(packageJson.version, '7.3.0');",
    'baseline package version'
);
const singletonAssertionAnchor = "    assert.notEqual(packageJson.version, baseline.version);\n";
baseline = replaceRequired(
    baseline,
    singletonAssertionAnchor,
    `${singletonAssertionAnchor}    const bootstrap = await read('src/core/00-bootstrap.user.js.part');
    assert.match(bootstrap, /@noframes/);
    assert.match(bootstrap, /data-media-archiver-mounted/);
    assert.match(bootstrap, /window\\.top === window\\.self/);
`,
    'baseline singleton assertion anchor'
);
await write('tests/baseline.test.mjs', baseline);

const uiTest = `import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const userscript = await readFile(
    new URL('../../media-archiver.user.js', import.meta.url),
    'utf8'
);

function fixture() {
    return \`<!doctype html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                html, body { height: 100%; margin: 0; }
                [data-list-id="chat-messages"] { height: 360px; overflow-y: auto; }
                article { min-height: 220px; }
                img { width: 120px; height: 90px; }
            </style>
        </head>
        <body>
            <div data-list-id="chat-messages">
                <article id="chat-messages-150000000000000001" data-list-item-id="chat-messages___150000000000000001">
                    <time id="message-timestamp-150000000000000001" datetime="2026-08-05T12:00:00.000Z"></time>
                    <a href="https://cdn.discordapp.com/attachments/111/150000000000000001/fixture.jpg">
                        <img src="https://media.discordapp.net/attachments/111/150000000000000001/fixture.jpg" alt="">
                    </a>
                </article>
            </div>
        </body>
        </html>\`;
}

async function installRuntime(page) {
    await page.addInitScript(() => {
        const settings = new Map();
        globalThis.GM_getValue = (key, fallback) =>
            settings.has(key) ? settings.get(key) : fallback;
        globalThis.GM_setValue = (key, value) => {
            settings.set(key, value);
            return value;
        };
        globalThis.GM_xmlhttpRequest = options => {
            const bytes = new TextEncoder().encode(\`fixture:\${options.url}\`);
            queueMicrotask(() => options.onload?.({
                status: 200,
                response: bytes.buffer
            }));
            return { abort() {} };
        };
    });

    await page.route('https://discord.com/**', route => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: fixture()
    }));
}

test('repeated Tampermonkey injection and Media tab switching keep one UI root', async ({ page }) => {
    await installRuntime(page);
    await page.goto('https://discord.com/channels/111/222');

    await page.addScriptTag({ content: userscript });
    const roots = page.locator('#media-archiver-panel');
    await expect(roots).toHaveCount(1);
    await roots.evaluate(element => {
        element.dataset.singletonRegressionRoot = 'original';
    });

    await page.addScriptTag({ content: userscript });
    await expect(roots).toHaveCount(1);

    for (const tab of ['media', 'setup', 'archive', 'activity', 'media']) {
        const button = page.locator(\`[data-ma-tab="\${tab}"]\`);
        await expect(button).toHaveCount(1);
        await button.click();
        await expect(roots).toHaveCount(1);
        await expect(roots).toHaveAttribute(
            'data-singleton-regression-root',
            'original'
        );
        await expect(button).toHaveAttribute('aria-selected', 'true');
    }
});

test('a Discord child frame cannot mount another Media Archiver panel', async ({ page }) => {
    await installRuntime(page);
    await page.goto('https://discord.com/channels/111/222');
    await page.addScriptTag({ content: userscript });
    await expect(page.locator('#media-archiver-panel')).toHaveCount(1);

    const framePromise = page.waitForEvent('frameattached');
    await page.evaluate(() => {
        const frame = document.createElement('iframe');
        frame.src = 'https://discord.com/channels/333/444';
        document.body.appendChild(frame);
    });
    const frame = await framePromise;
    await frame.waitForLoadState('domcontentloaded');
    await frame.addScriptTag({ content: userscript });

    await expect(frame.locator('#media-archiver-panel')).toHaveCount(0);
    await expect(page.locator('#media-archiver-panel')).toHaveCount(1);
});
`;
await write('tests/ui/7.3-singleton-ui.spec.mjs', uiTest);

let changelog = await read('CHANGELOG.md');
const changelogEntry = `# Changelog

## 7.3.0 — 2026-08-05

### Fixed

- Tampermonkey now mounts exactly one Media Archiver interface per top-level document.
- Repeated userscript injection no longer creates stacked duplicate panels when switching to Media or another tab.
- Child-frame execution is blocked both by userscript metadata and by a runtime top-level-document guard.

### Tests

- Added Chromium and Firefox regression coverage for repeated injection, tab switching, root identity, and Discord child frames.

`;
changelog = replaceRequired(
    changelog,
    '# Changelog\n\n',
    changelogEntry,
    'changelog heading'
);
await write('CHANGELOG.md', changelog);
