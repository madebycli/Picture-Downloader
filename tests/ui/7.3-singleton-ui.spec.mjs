import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const userscript = await readFile(
    new URL('../../media-archiver.user.js', import.meta.url),
    'utf8'
);

function fixture() {
    return `<!doctype html>
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
        </html>`;
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
            const bytes = new TextEncoder().encode(`fixture:${options.url}`);
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
        const button = page.locator(`[data-ma-tab="${tab}"]`);
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
