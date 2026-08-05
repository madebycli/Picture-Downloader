import { readFile, writeFile } from 'node:fs/promises';

const path = 'tests/ui/7.3.1-panel-scroll.spec.mjs';
let content = await readFile(path, 'utf8');
const search = `    await panel.locator('[data-ma-tab="media"]').click();
    await tabContent.evaluate(element => { element.scrollTop = element.scrollHeight; });

    const mediaList = panel.locator('#ma-media-list');`;
const replacement = `    await panel.locator('[data-ma-tab="media"]').click();
    await page.waitForTimeout(600);
    await page.evaluate(() => {
        const mediaList = document.querySelector('#ma-media-list');
        mediaList.replaceChildren();
        for (let index = 1; index <= 24; index += 1) {
            const row = document.createElement('div');
            row.className = 'ma-row';
            row.dataset.scrollFixture = String(index);
            row.textContent = \`Fixture media \${index}\`;
            mediaList.appendChild(row);
        }
    });
    await tabContent.evaluate(element => { element.scrollTop = element.scrollHeight; });

    const mediaList = panel.locator('#ma-media-list');`;

if (!content.includes(search)) {
    throw new Error('Expected nested media-list test block was not found.');
}

content = content.replace(search, replacement);
await writeFile(path, content, 'utf8');
console.log('Stabilized the nested Media-list scroll fixture.');
