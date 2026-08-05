import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';

const read = path => readFile(path, 'utf8');
const write = async (path, content) => {
    await mkdir(path.split('/').slice(0, -1).join('/') || '.', { recursive: true });
    await writeFile(path, content);
};

function replaceOne(source, pattern, replacement, label) {
    const matches = source.match(pattern);
    if (!matches) throw new Error(`Missing patch target: ${label}`);
    return source.replace(pattern, replacement);
}

const dateNavigation = `    // ---------- Date-interval navigation ----------

    let scanCollectionPolicy = Object.freeze({
        enabled: true,
        startMs: Number.NEGATIVE_INFINITY,
        endExclusiveMs: Number.POSITIVE_INFINITY
    });

    function setScanCollectionPolicy({ enabled = true, range = null } = {}) {
        scanCollectionPolicy = Object.freeze({
            enabled: Boolean(enabled),
            startMs: range?.enabled && range?.valid
                ? range.startMs
                : Number.NEGATIVE_INFINITY,
            endExclusiveMs: range?.enabled && range?.valid
                ? range.endExclusiveMs
                : Number.POSITIVE_INFINITY
        });
    }

    function shouldCollectRenderedItem(sourceElement) {
        if (!scanCollectionPolicy.enabled) return false;
        if (
            scanCollectionPolicy.startMs === Number.NEGATIVE_INFINITY &&
            scanCollectionPolicy.endExclusiveMs === Number.POSITIVE_INFINITY
        ) {
            return true;
        }

        const itemId = findItemId(sourceElement);
        const rawTimestamp =
            findItemTimestamp(sourceElement) ||
            timestampFromItemId(itemId);
        const timestamp = Date.parse(rawTimestamp || '');

        return Number.isFinite(timestamp) &&
            timestamp >= scanCollectionPolicy.startMs &&
            timestamp < scanCollectionPolicy.endExclusiveMs;
    }

    function dateIntervalTargetLabel(milliseconds) {
        return new Date(milliseconds).toLocaleDateString('en-GB', {
            year: 'numeric',
            month: 'short',
            day: '2-digit'
        });
    }

    function dateSeekReached(visible, targetMs, direction) {
        if (!visible) return false;
        return direction === 'older'
            ? visible.minMs <= targetMs
            : visible.maxMs >= targetMs;
    }

    function dateSeekProgressed(previous, current, direction) {
        if (!previous || !current) return Boolean(current);
        return direction === 'older'
            ? current.minMs < previous.minMs
            : current.maxMs > previous.maxMs;
    }

    async function seekDateBoundary(scroller, targetMs, direction) {
        const label = dateIntervalTargetLabel(targetMs);
        setPhase(\`SEEK: \${direction} messages → \${label}\`);
        addLog(
            \`Fast seek started toward \${direction} messages. Media collection is paused until the \${label} boundary is reached.\`
        );

        let previousRange = visibleItemTimeRange();
        if (dateSeekReached(previousRange, targetMs, direction)) {
            return { reached: true, iterations: 0 };
        }

        let noProgressRounds = 0;
        for (let iteration = 1; iteration <= 20_000 && !stopRequested; iteration++) {
            const before = scrollPosition(scroller);
            scroller.scrollTop = direction === 'older'
                ? 0
                : scroller.scrollHeight;
            scroller.dispatchEvent(new Event('scroll', { bubbles: true }));

            await sleep(iteration < 8 ? 190 : 280);
            const currentRange = visibleItemTimeRange();

            if (dateSeekReached(currentRange, targetMs, direction)) {
                setPhase(\`SEEK COMPLETE: \${label}\`);
                addLog(
                    \`Date boundary located near \${label}. Safe overlap scanning starts now.\`,
                    'success'
                );
                return { reached: true, iterations: iteration };
            }

            const after = scrollPosition(scroller);
            const moved =
                Math.abs(after.top - before.top) >= 2 ||
                Math.abs(after.height - before.height) >= 3 ||
                dateSeekProgressed(previousRange, currentRange, direction);

            noProgressRounds = moved ? 0 : noProgressRounds + 1;
            previousRange = currentRange || previousRange;

            if (iteration % 20 === 0 && currentRange) {
                const currentLabel = dateIntervalTargetLabel(
                    direction === 'older'
                        ? currentRange.minMs
                        : currentRange.maxMs
                );
                setPhase(\`SEEK: \${direction} messages · \${currentLabel}\`);
            }

            if (noProgressRounds >= 7) {
                const error = new Error(
                    \`Discord did not move toward \${direction} messages while seeking \${label}.\`
                );
                error.code = 'DATE_SEEK_NO_PROGRESS';
                throw error;
            }
        }

        if (stopRequested) return { reached: false, stopped: true };
        const error = new Error('The date seek reached its safety iteration limit.');
        error.code = 'DATE_SEEK_ITERATION_LIMIT';
        throw error;
    }

    function createDateIntervalPlan(range, visible) {
        if (!visible) {
            const error = new Error('No machine-readable message timestamps are visible.');
            error.code = 'DATE_SEEK_TIMESTAMPS_MISSING';
            throw error;
        }

        const centerMs = (visible.minMs + visible.maxMs) / 2;
        if (!Number.isFinite(range.endExclusiveMs)) {
            return {
                targetMs: range.startMs,
                seekDirection: centerMs > range.startMs ? 'older' : 'newer',
                scanDirection: 'newer',
                targetBoundary: 'From date'
            };
        }

        const endTargetMs = range.endExclusiveMs - 1;
        if (centerMs > endTargetMs) {
            return {
                targetMs: endTargetMs,
                seekDirection: 'older',
                scanDirection: 'older',
                targetBoundary: 'To date'
            };
        }
        if (centerMs < range.startMs) {
            return {
                targetMs: range.startMs,
                seekDirection: 'newer',
                scanDirection: 'newer',
                targetBoundary: 'From date'
            };
        }

        const distanceToStart = Math.abs(centerMs - range.startMs);
        const distanceToEnd = Math.abs(endTargetMs - centerMs);
        if (distanceToEnd < distanceToStart) {
            return {
                targetMs: endTargetMs,
                seekDirection: 'newer',
                scanDirection: 'older',
                targetBoundary: 'To date'
            };
        }

        return {
            targetMs: range.startMs,
            seekDirection: 'older',
            scanDirection: 'newer',
            targetBoundary: 'From date'
        };
    }

    async function runDateIntervalScan(scroller, range) {
        setScanCollectionPolicy({ enabled: false });
        const visible = visibleItemTimeRange();
        const plan = createDateIntervalPlan(range, visible);
        const targetLabel = dateIntervalTargetLabel(plan.targetMs);

        addLog(
            \`Automatic date plan: seek \${plan.seekDirection} messages to the \${plan.targetBoundary} near \${targetLabel}, then scan \${plan.scanDirection} messages across the requested interval.\`
        );

        const seekResult = await seekDateBoundary(
            scroller,
            plan.targetMs,
            plan.seekDirection
        );
        if (!seekResult.reached) return false;

        setScanCollectionPolicy({ enabled: true, range });
        lastScanBoundaryReason = '';

        const reached = plan.scanDirection === 'older'
            ? await autoScrollToOldest(scroller)
            : await autoScrollToNewest(scroller);

        setScanCollectionPolicy({ enabled: true });
        return reached;
    }
`;

const dateAwareWorkflow = `    // ---------- Date-aware workflow override ----------

    async function startAutomaticWorkflow() {
        if (running) return;

        resetCollection();
        stopRequested = false;
        running = true;
        scanning = true;
        packing = false;
        reviewArchiveConfirmed = false;
        const afterScanMode = syncWorkflowMode();
        try {
            workflowState.transition(globalThis.MediaArchiverWorkflowState.phases.SCANNING);
        } catch {
            // Diagnostic compatibility state only.
        }
        updateButtons();

        const dateRange = getDateRangeConfig();
        const scanMode = dateRange.enabled
            ? 'date-interval'
            : scanDirectionSelect.value;

        if (!dateRange.valid) {
            running = false;
            scanning = false;
            setPhase('DATE INTERVAL ERROR');
            addLog(dateRange.error, 'error');
            updateButtons();
            return;
        }

        diagnostics.startSession({
            adapterId: activeSiteAdapter.id,
            pageType: activeSiteAdapter.getArchiveContext()?.label || 'supported-page',
            scanMode,
            afterScanMode,
            dateRange: dateRange.label
        });
        liveMetrics.startSession({ phase: 'scanning' });

        lastScanBoundaryReason = '';
        setPhase('STARTING');
        addLog(
            dateRange.enabled
                ? \`Date-interval scan started on \${activeSiteAdapter.label}: \${dateRange.label}. Direction and seek pacing are automatic.\`
                : \`Scan started on \${activeSiteAdapter.label}. Mode: \${scanModeDescription(scanMode)}.\`
        );

        await sleep(250);
        let scroller = null;
        let startingAnchor = null;

        try {
            scroller = findTimelineScroller();
            if (!scroller) {
                const error = new Error(
                    \`\${activeSiteAdapter.label} \${adapterTerm('timeline', 'timeline')} was not found.\`
                );
                error.code = 'ADAPTER_TIMELINE_NOT_FOUND';
                throw error;
            }

            startingAnchor = captureStartingAnchor(scroller);
            let reachedBoundary = false;
            let completedBoundaryLabel = '';

            if (dateRange.enabled) {
                reachedBoundary = await runDateIntervalScan(scroller, dateRange);
                completedBoundaryLabel = scanBoundaryDescription(
                    lastScanBoundaryReason
                );
            } else {
                setScanCollectionPolicy({ enabled: true });
                scanVisiblePage();

                if (scanMode === 'newest-to-oldest') {
                    await moveToNewest(scroller);
                    if (stopRequested) {
                        finishStoppedScan();
                        return;
                    }
                    reachedBoundary = await autoScrollToOldest(scroller);
                } else if (scanMode === 'current-to-oldest') {
                    reachedBoundary = await autoScrollToOldest(scroller);
                } else if (scanMode === 'current-to-newest') {
                    reachedBoundary = await autoScrollToNewest(scroller);
                } else if (scanMode === 'full-finish-down') {
                    const reachedOlderBoundary = await autoScrollToOldest(scroller);
                    if (stopRequested) {
                        finishStoppedScan();
                        return;
                    }
                    if (reachedOlderBoundary) {
                        lastScanBoundaryReason = '';
                        reachedBoundary = await autoScrollToNewest(scroller);
                    }
                }
                completedBoundaryLabel = scanBoundaryDescription(
                    lastScanBoundaryReason
                );
            }

            scanning = false;
            setScanCollectionPolicy({ enabled: true });

            if (stopRequested) {
                finishStoppedScan();
                return;
            }

            running = false;
            updateCounters();
            updateButtons();

            if (reachedBoundary) {
                setPhase(\`SCAN FINISHED: \${mediaEntries.size} items\`);
                addLog(
                    \`Scan completed at the \${completedBoundaryLabel}: \${mediaEntries.size} unique items found.\`,
                    'success'
                );
            } else {
                setPhase(\`SCAN ENDED: \${mediaEntries.size} items\`);
                addLog(
                    'The scan stopped before the selected boundary could be verified.',
                    'warn'
                );
            }

            const statsAfterScan = selectionStatistics();
            addLog(
                \`Selection summary: \${statsAfterScan.total} canonical items, \${statsAfterScan.eligible} eligible, \${statsAfterScan.selected} selected.\`
            );

            await applyFinalTimelinePosition(
                scroller,
                finalPositionSelect.value,
                startingAnchor
            );

            const selectedAfterScan = selectedMediaEntries();
            if (afterScanMode === 'quick') {
                try {
                    workflowState.afterScan();
                } catch {
                    // Diagnostic compatibility state only.
                }
                if (selectedAfterScan.length > 0) {
                    await createAndDownloadZipParts();
                } else {
                    liveMetrics.stopSession({ phase: 'completed' });
                    setPhase('SCAN FINISHED: NOTHING ELIGIBLE');
                    addLog('The scan finished, but no eligible items matched the interval and media choices.', 'warn');
                }
                return;
            }

            try {
                workflowState.afterScan();
            } catch {
                // Diagnostic compatibility state only.
            }
            liveMetrics.stopSession({ phase: 'review-ready' });
            setPhase(\`REVIEW READY: \${statsAfterScan.selected} selected\`);
            addLog(
                'Review is ready. No original files have been requested.',
                'success'
            );
            openLibrary();
        } catch (error) {
            setScanCollectionPolicy({ enabled: true });
            scanning = false;
            running = false;
            packing = false;
            liveMetrics.stopSession({ phase: 'error', errors: 1 });
            setPhase('SCAN ERROR');
            diagnostics.error(
                error.code || 'SCAN_WORKFLOW_FAILED',
                'The scan workflow failed.',
                error,
                { adapterId: activeSiteAdapter.id, scanMode },
                {
                    category: 'scan',
                    userMessage: error.message
                }
            );
            addLog(
                \`\${error.message} Code: \${error.code || 'SCAN_WORKFLOW_FAILED'}\`,
                'error'
            );
            updateButtons();
        }
    }
`;

const interfaceLayout = `    // ---------- Compact four-tab interface ----------

    const setupTabButton = panel.querySelector('[data-ma-tab="setup"]');
    const setupTabPanel = panel.querySelector('[data-ma-panel="setup"]');
    const mediaTabButton = panel.querySelector('[data-ma-tab="media"]');
    const mediaTabPanel = panel.querySelector('[data-ma-panel="media"]');
    const activityTabButton = panel.querySelector('[data-ma-tab="activity"]');

    if (setupTabButton) setupTabButton.textContent = 'Scan';

    const archiveTabButton = document.createElement('button');
    archiveTabButton.type = 'button';
    archiveTabButton.dataset.maTab = 'archive';
    archiveTabButton.setAttribute('aria-selected', 'false');
    archiveTabButton.textContent = 'Archive';
    activityTabButton?.before(archiveTabButton);

    const archiveTabPanel = document.createElement('section');
    archiveTabPanel.dataset.maPanel = 'archive';
    archiveTabPanel.hidden = true;
    activityTabButton && panel
        .querySelector('[data-ma-panel="activity"]')
        ?.before(archiveTabPanel);

    tabButtons.splice(
        Math.max(0, tabButtons.indexOf(activityTabButton)),
        0,
        archiveTabButton
    );
    tabPanels.push(archiveTabPanel);
    archiveTabButton.addEventListener('click', () => selectInterfaceTab('archive'));

    const mediaChoiceGroup = photoCheckbox?.closest('.ma-group');
    if (mediaChoiceGroup && mediaTabPanel) {
        mediaTabPanel.prepend(mediaChoiceGroup);
        const heading = mediaChoiceGroup.querySelector('h2');
        const description = mediaChoiceGroup.querySelector('p');
        if (heading) heading.textContent = 'Media types';
        if (description) description.textContent = 'Choose what the interval scan may collect.';
    }

    const photoChoice = photoCheckbox?.closest('.ma-choice');
    const videoChoice = videoCheckbox?.closest('.ma-choice');
    const gifChoice = externalGifCheckbox?.closest('.ma-choice');
    if (photoChoice) {
        photoChoice.querySelector('strong').textContent = 'Images';
        photoChoice.querySelector('small').textContent = 'Photos and image attachments';
    }
    if (gifChoice) {
        gifChoice.querySelector('strong').textContent = 'GIFs & animated previews';
        gifChoice.querySelector('small').textContent = 'Native GIFs and rendered animation previews';
    }
    if (videoChoice) {
        videoChoice.querySelector('strong').textContent = 'Videos';
        videoChoice.querySelector('small').textContent = 'Rendered video attachments';
    }

    const dateGroup = dateFilterCheckbox?.closest('.ma-group');
    if (dateGroup) {
        const heading = dateGroup.querySelector('h2');
        const description = dateGroup.querySelector('p');
        const switchLabel = dateGroup.querySelector('.ma-switch b');
        if (heading) heading.textContent = 'Date interval';
        if (description) description.textContent = 'Seek first, then collect only inside the requested calendar interval.';
        if (switchLabel) switchLabel.textContent = 'Use interval';
    }

    const scanBehaviorGroup = scanDirectionSelect?.closest('.ma-group');
    const scanDirectionLabel = scanDirectionSelect?.closest('label');
    const finalPositionLabel = finalPositionSelect?.closest('label');
    if (scanBehaviorGroup) {
        const heading = scanBehaviorGroup.querySelector('h2');
        const description = scanBehaviorGroup.querySelector('p');
        if (heading) heading.textContent = 'Current-position scan';
        if (description) description.textContent = 'Used only when Date interval is off.';
    }
    if (scanDirectionLabel?.querySelector('span')) {
        scanDirectionLabel.querySelector('span').textContent = 'Chronology';
    }

    const archiveMainGroup = document.createElement('section');
    archiveMainGroup.className = 'ma-group';
    archiveMainGroup.innerHTML = \`
        <div class="ma-group-heading">
            <div>
                <h2>Archive workflow</h2>
                <p>Choose whether to review first and where Discord remains afterward.</p>
            </div>
        </div>
        <div class="ma-archive-primary"></div>
        <details class="ma-advanced-disclosure">
            <summary>Position after completion</summary>
            <div class="ma-disclosure-body ma-field-grid"></div>
        </details>
    \`;
    archiveTabPanel.appendChild(archiveMainGroup);

    const autoArchiveGroup = autoZipCheckbox?.closest('.ma-group');
    if (autoArchiveGroup) {
        const row = autoArchiveGroup.querySelector('.ma-option-row');
        if (row) archiveMainGroup.querySelector('.ma-archive-primary').appendChild(row);
        autoArchiveGroup.remove();
    }
    if (finalPositionLabel) {
        archiveMainGroup
            .querySelector('.ma-disclosure-body')
            .appendChild(finalPositionLabel);
    }

    const compactStyle = document.createElement('style');
    compactStyle.textContent = \`
        #media-archiver-panel .ma-tabs { grid-template-columns: repeat(4, 1fr); }
        #media-archiver-panel .ma-tab-content { overflow: hidden; }
        #media-archiver-panel [data-ma-panel="setup"],
        #media-archiver-panel [data-ma-panel="archive"] { min-height: 0; }
        #media-archiver-panel .ma-advanced-disclosure {
            margin-top: 10px;
            border: 1px solid var(--ma-border);
            border-radius: 9px;
            background: rgba(0,0,0,.14);
        }
        #media-archiver-panel .ma-advanced-disclosure summary {
            padding: 10px;
            cursor: pointer;
            color: #cfd7df;
            font-size: 11px;
            font-weight: 750;
        }
        #media-archiver-panel .ma-disclosure-body { padding: 0 10px 10px; }
        #media-archiver-panel .ma-archive-primary .ma-option-row {
            padding: 9px;
            border: 1px solid var(--ma-border);
            border-radius: 9px;
            background: rgba(0,0,0,.14);
        }
        #media-archiver-panel .ma-date-mode-active .ma-current-direction { display: none; }
    \`;
    document.head.appendChild(compactStyle);

    scanDirectionLabel?.classList.add('ma-current-direction');

    function refreshCompactScanMode() {
        const dateMode = Boolean(dateFilterCheckbox?.checked);
        scanBehaviorGroup?.classList.toggle('ma-date-mode-active', dateMode);
        if (scanDirectionLabel) scanDirectionLabel.hidden = dateMode;
        if (startButton && !running) {
            startButton.textContent = dateMode
                ? (autoZipCheckbox.checked ? 'Scan interval & create ZIPs' : 'Scan interval')
                : (autoZipCheckbox.checked ? 'Scan & create ZIPs' : 'Scan for review');
        }
    }

    dateFilterCheckbox?.addEventListener('change', refreshCompactScanMode);
    autoZipCheckbox?.addEventListener('change', refreshCompactScanMode);
    refreshCompactScanMode();
`;

await write('src/core/32-date-interval-navigation.user.js.part', dateNavigation);
await write('src/core/51-date-aware-workflow.user.js.part', dateAwareWorkflow);
await write('src/core/64-interface-layout.user.js.part', interfaceLayout);

let manifest = JSON.parse(await read('src/build-manifest.json'));
const addAfter = (array, after, value) => {
    if (array.includes(value)) return;
    const index = array.indexOf(after);
    if (index < 0) throw new Error(`Manifest anchor missing: ${after}`);
    array.splice(index + 1, 0, value);
};
addAfter(manifest.afterAdapters, 'src/core/31-scanner-boundaries.user.js.part', 'src/core/32-date-interval-navigation.user.js.part');
addAfter(manifest.afterAdapters, 'src/core/50-workflow.user.js.part', 'src/core/51-date-aware-workflow.user.js.part');
addAfter(manifest.afterAdapters, 'src/core/64-capability-bindings.user.js.part', 'src/core/64-interface-layout.user.js.part');
await write('src/build-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);

let discordItems = await read('src/adapters/discord/20-items.user.js.part');
discordItems = replaceOne(
    discordItems,
    /    function addOrUpdateMediaEntry\(rawUrl, sourceElement\) \{\n/,
    "    function addOrUpdateMediaEntry(rawUrl, sourceElement) {\n        if (!shouldCollectRenderedItem(sourceElement)) return false;\n",
    'Discord attachment collection gate'
);
discordItems = replaceOne(
    discordItems,
    /    function addOrUpdateExternalGif\(\n        rawUrl,\n        sourceElement,\n        sourcePageUrl = null\n    \) \{\n/,
    "    function addOrUpdateExternalGif(\n        rawUrl,\n        sourceElement,\n        sourcePageUrl = null\n    ) {\n        if (!shouldCollectRenderedItem(sourceElement)) return false;\n",
    'Discord GIF collection gate'
);
await write('src/adapters/discord/20-items.user.js.part', discordItems);

let markup = await read('src/core/60-ui-markup.user.js.part');
markup = markup
    .replace('data-ma-tab="setup" aria-selected="true">Setup</button>', 'data-ma-tab="setup" aria-selected="true">Scan</button>')
    .replace('<h2>Date range</h2>', '<h2>Date interval</h2>')
    .replace('<p>Filter by each item\'s source timestamp.</p>', '<p>Seek first, then scan only the requested interval.</p>')
    .replace('<b>Use filter</b>', '<b>Use interval</b>');
await write('src/core/60-ui-markup.user.js.part', markup);

let bindings = await read('src/core/62-ui-bindings.user.js.part');
bindings = bindings
    .replace("? 'All scanned dates are included.'", "? 'Date interval is off. The current-position chronology control is used.'")
    .replace('`Inclusive range: ${range.label}`', '`Automatic interval: ${range.label}`');
await write('src/core/62-ui-bindings.user.js.part', bindings);

const dateTest = `import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('date intervals seek without collection and then use safe overlap scanning', async () => {
    const navigation = await read('src/core/32-date-interval-navigation.user.js.part');
    const workflow = await read('src/core/51-date-aware-workflow.user.js.part');
    const discord = await read('src/adapters/discord/20-items.user.js.part');

    assert.match(navigation, /setScanCollectionPolicy\(\{ enabled: false \}\)/);
    assert.match(navigation, /seekDateBoundary/);
    assert.match(navigation, /autoScrollToOldest/);
    assert.match(navigation, /autoScrollToNewest/);
    assert.match(navigation, /DATE_SEEK_NO_PROGRESS/);
    assert.match(workflow, /scanMode = dateRange\.enabled\s*\? 'date-interval'/);
    assert.match(workflow, /runDateIntervalScan/);
    assert.match(discord, /shouldCollectRenderedItem\(sourceElement\)/);
});

test('compact interface exposes Scan, Media, Archive and Activity tabs', async () => {
    const layout = await read('src/core/64-interface-layout.user.js.part');
    for (const label of ['Scan', 'Media', 'Archive', 'Activity']) {
        assert.match(layout + await read('src/core/60-ui-markup.user.js.part'), new RegExp(label));
    }
    assert.match(layout, /grid-template-columns: repeat\(4, 1fr\)/);
    assert.match(layout, /scanDirectionLabel\.hidden = dateMode/);
});
`;
await write('tests/date-interval-navigation.test.mjs', dateTest);

let changelog = await read('CHANGELOG.md');
if (!/^## \[?7\.2\.0/m.test(changelog)) {
    changelog = changelog.replace(
        /^(# Changelog[^\n]*\n)/,
        `$1\n## 7.2.0 - 2026-08-05\n\n- Fix Firefox Discord timeline selection by verifying writable scroll movement.\n- Replace ambiguous up/down terminology with older/newer messages.\n- Add automatic date-interval seeking that pauses collection until the requested boundary is reached.\n- Scan and collect only inside the requested interval with the established overlap-safe scanner.\n- Split the compact interface into Scan, Media, Archive and Activity tabs.\n- Keep VirusTotal Beta disabled by default; its final collapsed interface is added in the release-finalization commit.\n\n`
    );
}
await write('CHANGELOG.md', changelog);

let readme = await read('README.md');
if (!readme.includes('Automatic date intervals')) {
    readme += `\n## 7.2 navigation\n\n- **Current position → older messages** and **Current position → newer messages** use explicit chronology wording.\n- **Automatic date intervals** seek to the nearest interval boundary without collecting media, then run the safe scanner only across the selected dates.\n- The compact panel is organized into **Scan**, **Media**, **Archive**, and **Activity** tabs.\n`;
}
await write('README.md', readme);

await rm('scripts/apply-7.2-core.mjs', { force: true });
await rm('.github/workflows/apply-7.2-core.yml', { force: true });
