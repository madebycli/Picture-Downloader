import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const userscript = await readFile(
    new URL('../../media-archiver.user.js', import.meta.url),
    'utf8'
);

function message(id, timestamp, filename) {
    return `
        <article id="chat-messages-${id}" data-list-item-id="chat-messages___${id}">
            <time id="message-timestamp-${id}" datetime="${timestamp}"></time>
            <a href="https://cdn.discordapp.com/attachments/111/${id}/${filename}">
                <img src="https://media.discordapp.net/attachments/111/${id}/${filename}" alt="">
            </a>
        </article>`;
}

const pages = {
    august: [
        message('140000000000000003', '2026-08-05T12:00:00.000Z', 'august-1.jpg'),
        message('140000000000000004', '2026-08-06T12:00:00.000Z', 'august-2.jpg')
    ].join(''),
    may: [
        message('130000000000000003', '2026-05-12T12:00:00.000Z', 'may-1.jpg'),
        message('130000000000000004', '2026-05-22T12:00:00.000Z', 'may-2.jpg')
    ].join(''),
    april: [
        message('120000000000000003', '2026-04-20T12:00:00.000Z', 'april-1.jpg'),
        message('120000000000000004', '2026-04-21T12:00:00.000Z', 'april-2.jpg')
    ].join('')
};

function fixture() {
    return `<!doctype html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                html, body { height: 100%; margin: 0; }
                main { height: 100%; }
                [data-list-id="chat-messages"] {
                    height: 320px;
                    overflow-y: hidden;
                    border: 1px solid #333;
                }
                article { min-height: 220px; }
                img { width: 120px; height: 90px; }
            </style>
        </head>
        <body>
            <main>
                <div id="chat" data-list-id="chat-messages">${pages.august}</div>
            </main>
        </body>
        </html>`;
}

async function openFixture(page) {
    await page.addInitScript(() => {
        const settings = new Map();
        globalThis.GM_getValue = (key, fallback) => settings.has(key)
            ? settings.get(key)
            : fallback;
        globalThis.GM_setValue = (key, value) => {
            settings.set(key, value);
            return value;
        };
        globalThis.GM_xmlhttpRequest = options => {
            const bytes = new TextEncoder().encode(`fixture:${options.url}`);
            queueMicrotask(() => options.onload?.({ status: 200, response: bytes.buffer }));
            return { abort() {} };
        };
    });

    await page.route('https://discord.com/**', route => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: fixture()
    }));
    await page.goto('https://discord.com/channels/111/222');

    await page.evaluate(({ may, april }) => {
        const scroller = document.querySelector('#chat');
        globalThis.__dateFixturePage = 'august';
        scroller.addEventListener('scroll', () => {
            if (scroller.scrollTop > 0) return;
            if (globalThis.__dateFixturePage === 'august') {
                globalThis.__dateFixturePage = 'may';
                scroller.innerHTML = may;
                scroller.scrollTop = 100;
            } else if (globalThis.__dateFixturePage === 'may') {
                globalThis.__dateFixturePage = 'april';
                scroller.innerHTML = april;
                scroller.scrollTop = 100;
            }
        });
    }, { may: pages.may, april: pages.april });

    await page.addScriptTag({ content: userscript });
    await expect(page.locator('#media-archiver-panel')).toBeVisible();
}

test('compact panel exposes four tabs and hides chronology in date mode', async ({ page }) => {
    await openFixture(page);

    await expect(page.locator('.ma-tabs button')).toHaveCount(4);
    await expect(page.locator('[data-ma-tab="setup"]')).toHaveText('Scan');
    await expect(page.locator('[data-ma-tab="archive"]')).toHaveText('Archive');

    await page.locator('label.ma-switch').click();
    await expect(page.locator('#ma-date-filter')).toBeChecked();
    await expect(page.locator('#ma-scan-direction').closest('label')).toBeHidden();
    await expect(page.locator('#ma-start')).toContainText('interval');

    await page.locator('[data-ma-tab="archive"]').click();
    await expect(page.locator('[data-ma-panel="archive"]')).toBeVisible();
    await expect(page.locator('[data-ma-panel="setup"]')).toBeHidden();
});

test('VirusTotal Beta is off and collapsed until explicitly expanded', async ({ page }) => {
    await openFixture(page);

    await page.locator('[data-ma-tab="archive"]').click();
    const virusTotal = page.locator('#ma-virustotal-settings');
    await expect(virusTotal).toBeVisible();
    await expect(virusTotal.locator('summary')).toContainText('VirusTotal');
    await expect(virusTotal.locator('summary')).toContainText('BETA');
    await expect(virusTotal).not.toHaveAttribute('open', '');
    await expect(page.locator('#ma-vt-mode')).toBeHidden();

    await virusTotal.locator('summary').click();
    await expect(virusTotal).toHaveAttribute('open', '');
    await expect(page.locator('#ma-vt-mode')).toBeVisible();
    await expect(page.locator('#ma-vt-mode')).toHaveValue('off');
    await expect(page.locator('#ma-vt-summary-status')).toHaveText('Off');
});

test('date interval seeks without collecting and archives only the requested month', async ({ page }) => {
    test.setTimeout(45_000);
    await openFixture(page);

    await page.locator('[data-ma-tab="archive"]').click();
    await page.locator('#ma-review-before').check();
    await page.locator('[data-ma-tab="setup"]').click();
    await page.locator('label.ma-switch').click();
    await expect(page.locator('#ma-date-filter')).toBeChecked();
    await page.locator('#ma-from-date').fill('2026-05-01');
    await page.locator('#ma-date-end-mode').selectOption('specific');
    await page.locator('#ma-to-date').fill('2026-05-31');
    await page.locator('#ma-start').click();

    await expect(page.locator('#ma-phase')).toContainText('REVIEW READY', {
        timeout: 30_000
    });
    await expect(page.locator('#ma-found')).toHaveText('2');
    await expect(page.locator('#ma-library-overlay')).toBeVisible();
    await expect(page.locator('.ma-library-card')).toHaveCount(2);
    await expect(page.locator('#ma-library-overlay')).toContainText('may-1.jpg');
    await expect(page.locator('#ma-library-overlay')).toContainText('may-2.jpg');
    await expect(page.locator('#ma-library-overlay')).not.toContainText('august-1.jpg');
    await expect(page.locator('#ma-library-overlay')).not.toContainText('april-1.jpg');
});
