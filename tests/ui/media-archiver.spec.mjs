import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const userscript = await readFile(
    new URL('../../media-archiver.user.js', import.meta.url),
    'utf8'
);
const metricsModule = await readFile(
    new URL('../../src/shared/diagnostics-metrics.user.js.part', import.meta.url),
    'utf8'
);

const transparentPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+WfMB9wAAAABJRU5ErkJggg==',
    'base64'
);

function discordFixture(count = 3) {
    const attachment = (id, filename, timestamp) => `
        <article id="chat-messages-${id}" data-list-item-id="chat-messages___${id}">
            <time id="message-timestamp-${id}" datetime="${timestamp}"></time>
            <a href="https://cdn.discordapp.com/attachments/111/${id}/${filename}?ex=fixture&is=fixture&hm=redacted">
                <img src="https://media.discordapp.net/attachments/111/${id}/${filename}?width=640&height=640&ex=fixture&is=fixture&hm=redacted" alt="">
            </a>
        </article>`;
    const items = Array.from({ length: count }, (_, index) => {
        const id = String(100000000000000001n + BigInt(index));
        const filename = `fixture-${String(index + 1).padStart(4, '0')}.${index % 3 === 0 ? 'jpg' : index % 3 === 1 ? 'png' : 'jpeg'}`;
        const timestamp = new Date(Date.UTC(2026, 7, 5, 8, 0, index)).toISOString();
        return attachment(id, filename, timestamp);
    }).join('');

    return `<!doctype html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                html, body { height: 100%; margin: 0; }
                main { height: 100%; padding: 20px; box-sizing: border-box; }
                [data-list-id="chat-messages"] {
                    height: 420px;
                    overflow-y: auto;
                    border: 1px solid #333;
                }
                article { min-height: 240px; padding: 10px; }
                article img { width: 160px; height: 120px; object-fit: cover; }
            </style>
        </head>
        <body>
            <main>
                <div data-list-id="chat-messages">${items}</div>
            </main>
        </body>
        </html>`;
}

async function openDiscordFixture(page, { count = 3 } = {}) {
    await page.addInitScript(() => {
        const settings = new Map();
        globalThis.__maOriginalRequests = [];
        globalThis.GM_getValue = (key, fallback) =>
            settings.has(key) ? settings.get(key) : fallback;
        globalThis.GM_setValue = (key, value) => {
            settings.set(key, value);
            return value;
        };
        globalThis.GM_xmlhttpRequest = options => {
            const request = {
                url: options.url,
                aborted: false
            };
            globalThis.__maOriginalRequests.push(request);
            const handle = {
                abort() {
                    request.aborted = true;
                    options.onabort?.();
                }
            };
            setTimeout(() => {
                if (request.aborted) return;
                const bytes = new TextEncoder().encode(`fixture:${options.url}`);
                options.onload?.({
                    status: 200,
                    response: bytes.buffer
                });
            }, 20);
            return handle;
        };
    });

    await page.route('https://discord.com/**', route => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: discordFixture(count)
    }));
    await page.route('https://media.discordapp.net/**', route => route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: transparentPng
    }));
    await page.route('https://cdn.discordapp.com/**', route => route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: transparentPng
    }));

    await page.goto('https://discord.com/channels/111/222');
    await page.addScriptTag({ content: userscript });
    await expect(page.locator('#media-archiver-panel')).toBeVisible();
}

test('Review mode makes no original request before Archive selected', async ({ page }) => {
    await openDiscordFixture(page);

    await page.locator('[data-ma-tab="archive"]').click();
    await page.locator('#ma-review-before').check();
    await page.locator('[data-ma-tab="setup"]').click();
    await page.locator('#ma-scan-direction').selectOption('current-to-newest');
    await page.locator('#ma-start').click();
    await expect(page.locator('#ma-found')).toHaveText('3');
    await page.locator('#ma-stop').click();

    const library = page.locator('#ma-library-overlay');
    await expect(library).toBeVisible();
    await expect(page.locator('.ma-library-card')).toHaveCount(3);
    await expect(page.locator('.ma-library-card.ma-selected')).toHaveCount(3);
    expect(await page.evaluate(() => globalThis.__maOriginalRequests.length)).toBe(0);

    await page.locator('.ma-library-card').nth(1).click();
    await expect(page.locator('.ma-library-card.ma-selected')).toHaveCount(2);
    await page.locator('#ma-library-close').click();
    await expect(library).toBeHidden();
    expect(await page.evaluate(() => globalThis.__maOriginalRequests.length)).toBe(0);

    await page.locator('#ma-zip').click();
    await expect(library).toBeVisible();
    await expect(page.locator('.ma-library-card.ma-selected')).toHaveCount(2);

    await page.locator('#ma-library-archive').click();
    await expect.poll(
        () => page.evaluate(() => globalThis.__maOriginalRequests.length)
    ).toBe(2);
    await expect(page.locator('#ma-phase')).toContainText('FINISHED', {
        timeout: 15_000
    });
});

test('Library is keyboard accessible and selection does not rebuild all cards', async ({ page }) => {
    await openDiscordFixture(page);

    await page.locator('[data-ma-tab="archive"]').click();
    await page.locator('#ma-review-before').check();
    await page.locator('[data-ma-tab="setup"]').click();
    await page.locator('#ma-start').click();
    await expect(page.locator('#ma-found')).toHaveText('3');
    await page.locator('#ma-stop').click();
    await expect(page.locator('#ma-library-overlay')).toBeVisible();

    await page.evaluate(() => {
        const items = document.querySelector('#ma-library-items');
        globalThis.__maLibraryRebuilds = 0;
        const original = items.replaceChildren.bind(items);
        items.replaceChildren = (...children) => {
            globalThis.__maLibraryRebuilds++;
            return original(...children);
        };
    });

    const firstCard = page.locator('.ma-library-card').first();
    await firstCard.focus();
    await page.keyboard.press('Space');
    await expect(firstCard).toHaveAttribute('aria-selected', 'false');
    expect(await page.evaluate(() => globalThis.__maLibraryRebuilds)).toBe(0);

    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.ma-library-card').nth(1)).toBeFocused();
    await page.keyboard.press('ControlOrMeta+A');
    await expect(page.locator('.ma-library-card.ma-selected')).toHaveCount(3);
    expect(await page.evaluate(() => globalThis.__maLibraryRebuilds)).toBe(0);

    await page.keyboard.press('Escape');
    await expect(page.locator('#ma-library-overlay')).toBeHidden();
});

test('1,100-item Library stays scrollable, bounded and click-toggleable', async ({ page }) => {
    test.setTimeout(60_000);
    await openDiscordFixture(page, { count: 1_100 });

    await page.locator('[data-ma-tab="archive"]').click();
    await page.locator('#ma-review-before').check();
    await page.locator('[data-ma-tab="setup"]').click();
    await page.locator('#ma-scan-direction').selectOption('current-to-newest');
    await page.locator('#ma-start').click();
    await expect(page.locator('#ma-found')).toHaveText('1100', { timeout: 20_000 });
    await page.locator('#ma-stop').click();
    await expect(page.locator('#ma-library-overlay')).toBeVisible();

    const items = page.locator('#ma-library-items');
    const initialCards = await page.locator('.ma-library-card').count();
    expect(initialCards).toBeGreaterThan(0);
    expect(initialCards).toBeLessThanOrEqual(240);

    const dimensions = await items.evaluate(element => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        overflowY: getComputedStyle(element).overflowY
    }));
    expect(dimensions.clientHeight).toBeGreaterThan(100);
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
    expect(dimensions.overflowY).toBe('auto');

    const firstCard = page.locator('.ma-library-card').first();
    await expect(firstCard).toHaveAttribute('aria-selected', 'true');
    await firstCard.click();
    await expect(firstCard).toHaveAttribute('aria-selected', 'false');
    await firstCard.click();
    await expect(firstCard).toHaveAttribute('aria-selected', 'true');

    await items.evaluate(element => {
        element.scrollTop = element.scrollHeight;
        element.dispatchEvent(new Event('scroll'));
    });
    await expect.poll(() => page.locator('.ma-library-card').count()).toBeGreaterThan(initialCards);
    expect(await page.locator('.ma-library-card').count()).toBeLessThan(1_100);

    await page.locator('#ma-library-close').click();
    await page.locator('[data-ma-tab="activity"]').click();
    await page.locator('#ma-developer-logs').click();
    await expect(page.locator('#ma-developer-overlay')).toBeVisible();
    const checkboxBox = await page.locator('[data-ma-dev-level]').first().boundingBox();
    expect(checkboxBox?.width).toBeLessThanOrEqual(18);
    expect(checkboxBox?.height).toBeLessThanOrEqual(18);
});

test('Activity remains selectable and diagnostics download sanitized Markdown', async ({ page }) => {
    await openDiscordFixture(page);

    await page.locator('[data-ma-tab="activity"]').click();
    await expect(page.locator('#ma-log')).toBeVisible();
    const userSelect = await page.locator('#ma-log').evaluate(element =>
        getComputedStyle(element).userSelect
    );
    expect(userSelect).toBe('text');

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#ma-download-report').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^media-archiver-diagnostics_.*\.md$/);
});

test('DOM-visible metrics remain at most one second stale for twelve seconds', async ({ page }) => {
    await page.setContent(`
        <strong id="visible-found">0</strong>
        <div id="library"><img id="thumbnail" alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></div>
    `);
    await page.addScriptTag({ content: metricsModule });

    await page.evaluate(() => {
        const library = document.querySelector('#library');
        const thumbnail = document.querySelector('#thumbnail');
        const originalReplaceChildren = library.replaceChildren.bind(library);
        globalThis.__metricTest = {
            internal: 0,
            rendered: 0,
            renderedAt: performance.now(),
            startedAt: performance.now(),
            rebuilds: 0,
            originalThumbnailSrc: thumbnail.src
        };
        library.replaceChildren = (...children) => {
            globalThis.__metricTest.rebuilds++;
            return originalReplaceChildren(...children);
        };

        const metrics = globalThis.MediaArchiverDiagnostics.createLiveMetrics({
            heartbeatMs: 750,
            onSnapshot(snapshot) {
                document.querySelector('#visible-found').textContent = String(snapshot.found);
                globalThis.__metricTest.rendered = snapshot.found;
                globalThis.__metricTest.renderedAt = performance.now();
            }
        });
        globalThis.__metrics = metrics;
        metrics.startSession({ phase: 'scanning' });
        globalThis.__metricInterval = setInterval(() => {
            globalThis.__metricTest.internal++;
            metrics.record('found', 1);
        }, 250);
    });

    for (let iteration = 0; iteration < 60; iteration++) {
        await page.waitForTimeout(200);
        const snapshot = await page.evaluate(() => ({
            ...globalThis.__metricTest,
            visibleText: Number(document.querySelector('#visible-found').textContent),
            thumbnailSrc: document.querySelector('#thumbnail').src,
            now: performance.now()
        }));
        expect(snapshot.now - snapshot.renderedAt).toBeLessThanOrEqual(1_000);
        expect(snapshot.internal - snapshot.visibleText).toBeLessThanOrEqual(4);
        expect(snapshot.rebuilds).toBe(0);
        expect(snapshot.thumbnailSrc).toBe(snapshot.originalThumbnailSrc);
    }

    const final = await page.evaluate(() => {
        clearInterval(globalThis.__metricInterval);
        globalThis.__metrics.stopSession({ phase: 'completed' });
        return {
            internal: globalThis.__metricTest.internal,
            visible: Number(document.querySelector('#visible-found').textContent),
            rebuilds: globalThis.__metricTest.rebuilds
        };
    });
    expect(final.visible).toBe(final.internal);
    expect(final.rebuilds).toBe(0);
});
