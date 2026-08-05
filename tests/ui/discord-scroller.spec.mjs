import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const userscript = await readFile(
    new URL('../../media-archiver.user.js', import.meta.url),
    'utf8'
);

function discordScrollerFixture() {
    const messages = Array.from({ length: 18 }, (_, index) => {
        const id = String(100000000000001000n + BigInt(index));
        const timestamp = new Date(Date.UTC(2026, 7, 5, 8, index)).toISOString();
        return `
            <article id="chat-messages-${id}" data-list-item-id="chat-messages___${id}">
                <time id="message-timestamp-${id}" datetime="${timestamp}"></time>
                <a href="https://cdn.discordapp.com/attachments/111/${id}/fixture-${index}.jpg">
                    <img alt="" src="https://media.discordapp.net/attachments/111/${id}/fixture-${index}.jpg">
                </a>
            </article>`;
    }).join('');

    return `<!doctype html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                html, body { height: 100%; margin: 0; }
                main { height: 100%; padding: 16px; box-sizing: border-box; }
                #decoy-scroll-container {
                    position: fixed;
                    left: 10px;
                    bottom: 10px;
                    width: 260px;
                    height: 260px;
                    overflow-y: auto;
                    border: 1px solid red;
                }
                #decoy-content { height: 3000px; }
                #discord-real-scroller {
                    height: 420px;
                    overflow-y: hidden;
                    border: 1px solid #333;
                }
                [data-list-id="chat-messages"] { margin: 0; padding: 0; }
                article { min-height: 180px; padding: 8px; list-style: none; }
                article img { width: 80px; height: 60px; }
            </style>
        </head>
        <body>
            <main>
                <div id="decoy-scroll-container"><div id="decoy-content"></div></div>
                <div id="discord-real-scroller">
                    <ol data-list-id="chat-messages">${messages}</ol>
                </div>
            </main>
        </body>
        </html>`;
}

async function openFixture(page) {
    await page.addInitScript(() => {
        const settings = new Map();
        globalThis.GM_getValue = (key, fallback) =>
            settings.has(key) ? settings.get(key) : fallback;
        globalThis.GM_setValue = (key, value) => {
            settings.set(key, value);
            return value;
        };
        globalThis.GM_xmlhttpRequest = () => ({ abort() {} });
    });

    await page.route('https://discord.com/**', route => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: discordScrollerFixture()
    }));
    await page.route('https://media.discordapp.net/**', route => route.fulfill({
        status: 204,
        body: ''
    }));

    await page.goto('https://discord.com/channels/111/222');
    await page.addScriptTag({ content: userscript });
    await expect(page.locator('#media-archiver-panel')).toBeVisible();
}

test('Discord chooses the writable message scroller instead of a visible decoy', async ({ page }) => {
    await openFixture(page);

    const olderOption = page.locator('#ma-scan-direction option[value="current-to-oldest"]');
    const newerOption = page.locator('#ma-scan-direction option[value="current-to-newest"]');
    await expect(olderOption).toHaveText('Current position → older messages');
    await expect(newerOption).toHaveText('Current position → newer messages');

    expect(await page.locator('#ma-scan-direction option[value="newest-to-oldest"]')
        .evaluate(option => option.hidden && option.disabled)).toBe(true);
    expect(await page.locator('#ma-scan-direction option[value="full-finish-down"]')
        .evaluate(option => option.hidden && option.disabled)).toBe(true);

    await page.locator('#ma-scan-direction').selectOption('current-to-newest');
    await page.locator('#ma-start').click();

    await expect.poll(() => page.evaluate(() =>
        document.querySelector('#discord-real-scroller').scrollTop
    )).toBeGreaterThan(100);

    expect(await page.evaluate(() =>
        document.querySelector('#decoy-scroll-container').scrollTop
    )).toBe(0);

    await page.locator('#ma-stop').click();
});
