import { readFile, writeFile, rm } from 'node:fs/promises';

const read = path => readFile(path, 'utf8');
const write = (path, content) => writeFile(path, content);

function replaceRequired(source, from, to, label) {
    if (!source.includes(from)) throw new Error(`Missing patch target: ${label}`);
    return source.replace(from, to);
}

let layout = await read('src/core/64-interface-layout.user.js.part');
layout = replaceRequired(
    layout,
    "        const row = compactAutoArchiveGroup.querySelector('.ma-option-row');\n        if (row) archiveMainGroup.querySelector('.ma-archive-primary').appendChild(row);\n        compactAutoArchiveGroup.remove();",
    "        const archiveChoiceContent = compactAutoArchiveGroup.querySelector(\n            '.ma-after-scan-options, .ma-option-row'\n        );\n        if (archiveChoiceContent) {\n            archiveMainGroup\n                .querySelector('.ma-archive-primary')\n                .appendChild(archiveChoiceContent);\n        }\n        compactAutoArchiveGroup.remove();",
    'preserve archive choice inputs'
);
layout = replaceRequired(
    layout,
    "        #media-archiver-panel .ma-date-mode-active .ma-current-direction { display: none; }",
    "        #media-archiver-panel .ma-date-mode-active .ma-current-direction { display: none; }\n        #media-archiver-panel .ma-switch > span { pointer-events: none; }",
    'date switch click target'
);
await write('src/core/64-interface-layout.user.js.part', layout);

let legacyUi = await read('tests/ui/media-archiver.spec.mjs');
legacyUi = legacyUi.replaceAll(
    "    await page.locator('#ma-review-before').check();",
    "    await page.locator('[data-ma-tab=\"archive\"]').click();\n    await page.locator('#ma-review-before').check();\n    await page.locator('[data-ma-tab=\"setup\"]').click();"
);
await write('tests/ui/media-archiver.spec.mjs', legacyUi);

let dateUi = await read('tests/ui/7.2-date-interface.spec.mjs');
dateUi = replaceRequired(
    dateUi,
    "    await page.locator('#ma-date-filter').check();",
    "    await page.locator('label.ma-switch').click();\n    await expect(page.locator('#ma-date-filter')).toBeChecked();",
    'first date interval switch'
);
dateUi = replaceRequired(
    dateUi,
    "    await page.locator('#ma-auto-zip').uncheck();\n    await page.locator('#ma-date-filter').check();",
    "    await page.locator('[data-ma-tab=\"archive\"]').click();\n    await page.locator('#ma-review-before').check();\n    await page.locator('[data-ma-tab=\"setup\"]').click();\n    await page.locator('label.ma-switch').click();\n    await expect(page.locator('#ma-date-filter')).toBeChecked();",
    'date review mode and interval switch'
);
await write('tests/ui/7.2-date-interface.spec.mjs', dateUi);

await rm('scripts/fix-7.2-browser-regressions.mjs', { force: true });
await rm('.github/workflows/fix-7.2-browser-regressions.yml', { force: true });
