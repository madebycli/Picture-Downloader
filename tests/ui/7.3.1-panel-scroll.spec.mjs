import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const userscript = await readFile(
    new URL('../../media-archiver.user.js', import.meta.url),
    'utf8'
);

test.use({ viewport: { width: 466, height: 824 } });

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

async function wheelUntilScrolled(page, locator) {
    await locator.hover();
    await page.mouse.wheel(0, 700);
    await expect.poll(() => locator.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
}

test('compact panel keeps fixed controls while every long tab can scroll', async ({ page }) => {
    await installRuntime(page);
    await page.goto('https://discord.com/channels/111/222');
    await page.addScriptTag({ content: userscript });

    const panel = page.locator('#media-archiver-panel');
    const tabContent = panel.locator('.ma-tab-content');
    const footer = panel.locator('.ma-actions');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.ma-subtitle')).toContainText('v7.3.1');

    const scrollingStyle = await tabContent.evaluate(element => ({
        overflowY: getComputedStyle(element).overflowY,
        flexGrow: getComputedStyle(element).flexGrow,
        minHeight: getComputedStyle(element).minHeight
    }));
    expect(scrollingStyle.overflowY).toBe('auto');
    expect(Number(scrollingStyle.flexGrow)).toBeGreaterThan(0);
    expect(scrollingStyle.minHeight).toBe('0px');

    await page.evaluate(() => {
        const mediaList = document.querySelector('#ma-media-list');
        for (let index = 1; index <= 24; index += 1) {
            const row = document.createElement('div');
            row.className = 'ma-row';
            row.dataset.scrollFixture = String(index);
            row.innerHTML = `<div class="ma-thumb"></div><div class="ma-details"><div class="ma-name">Fixture media ${index}</div><div class="ma-meta">scroll regression</div></div><div class="ma-check ma-check-packed">✓</div>`;
            mediaList.appendChild(row);
        }

        for (const name of ['setup', 'archive', 'activity']) {
            const target = document.querySelector(`[data-ma-panel="${name}"]`);
            const spacer = document.createElement('div');
            spacer.dataset.longTabFixture = name;
            spacer.style.height = '1200px';
            spacer.textContent = `Long ${name} content`;
            target.appendChild(spacer);
        }
    });

    const footerBefore = await footer.boundingBox();
    expect(footerBefore).not.toBeNull();
    expect(footerBefore.y + footerBefore.height).toBeLessThanOrEqual(824);

    for (const tab of ['media', 'setup', 'archive', 'activity']) {
        await panel.locator(`[data-ma-tab="${tab}"]`).click();
        await tabContent.evaluate(element => { element.scrollTop = 0; });
        await expect.poll(() => tabContent.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(100);
        await wheelUntilScrolled(page, tabContent);

        const footerAfter = await footer.boundingBox();
        expect(footerAfter).not.toBeNull();
        expect(Math.abs(footerAfter.y - footerBefore.y)).toBeLessThanOrEqual(1);
    }

    await panel.locator('[data-ma-tab="media"]').click();
    await page.waitForTimeout(600);
    await page.evaluate(() => {
        const mediaList = document.querySelector('#ma-media-list');
        mediaList.replaceChildren();
        for (let index = 1; index <= 24; index += 1) {
            const row = document.createElement('div');
            row.className = 'ma-row';
            row.dataset.scrollFixture = String(index);
            row.textContent = `Fixture media ${index}`;
            mediaList.appendChild(row);
        }
    });
    await tabContent.evaluate(element => { element.scrollTop = element.scrollHeight; });

    const mediaList = panel.locator('#ma-media-list');
    await expect.poll(() => mediaList.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(100);
    await wheelUntilScrolled(page, mediaList);
    await mediaList.evaluate(element => { element.scrollTop = element.scrollHeight; });

    const lastRow = mediaList.locator('[data-scroll-fixture="24"]');
    await expect(lastRow).toBeVisible();
    const [listBox, rowBox] = await Promise.all([
        mediaList.boundingBox(),
        lastRow.boundingBox()
    ]);
    expect(listBox).not.toBeNull();
    expect(rowBox).not.toBeNull();
    expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(listBox.y + listBox.height + 1);
});
