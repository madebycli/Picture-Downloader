// ==UserScript==
// @name         Media Archiver
// @namespace    https://github.com/madebycli/Picture-Downloader
// @version      7.2.0
// @description  Collect rendered media from supported web apps and save filtered files as numbered ZIP parts.
// @homepageURL  https://github.com/madebycli/Picture-Downloader
// @supportURL   https://github.com/madebycli/Picture-Downloader/issues
// @match        https://discord.com/channels/*
// @match        https://ptb.discord.com/channels/*
// @match        https://canary.discord.com/channels/*
// @match        https://www.pinterest.com/*
// @match        https://pinterest.com/*
// @match        https://www.reddit.com/r/*/comments/*
// @match        https://reddit.com/r/*/comments/*
// @match        https://old.reddit.com/r/*/comments/*
// @require      https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      www.virustotal.com
// @connect      *.virustotal.com
// @connect      cdn.discordapp.com
// @connect      media.discordapp.net
// @connect      images-ext-1.discordapp.net
// @connect      images-ext-2.discordapp.net
// @connect      i.pinimg.com
// @connect      v1.pinimg.com
// @connect      v.pinimg.com
// @connect      i.redd.it
// @connect      preview.redd.it
// @connect      external-preview.redd.it
// @connect      v.redd.it
// @connect      packaged-media.redd.it
// @connect      i.redditmedia.com
// @connect      reddit-uploaded-media.s3-accelerate.amazonaws.com
// @connect      i.imgur.com
// @connect      *.giphy.com
// @connect      media.tenor.com
// @connect      *.streamable.com
// @connect      *.redgifs.com
// @connect      *.gfycat.com
// @connect      pbs.twimg.com
// @connect      video.twimg.com
// @connect      *.tumblr.com
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    const VERSION = '7.2.0';
    const APP_NAME = 'Media Archiver';
    const SCAN_DELAY_MS = 650;
    const REAL_TOP_CONFIRM_MS = 20_000;
    const REAL_BOTTOM_CONFIRM_MS = 20_000;
    const FINAL_NEWEST_SETTLE_MS = 7_000;
    const RESTORE_POSITION_MAX_STEPS = 700;
    const TOP_PROBE_INTERVAL_MS = 1000;
    const NEWEST_STABLE_ROUNDS_REQUIRED = 3;
    const DOWNLOAD_CONCURRENCY = 8;
    const REQUEST_RETRIES = 4;
    const ZIP_BATCH_MAX_ITEMS = 200;
    const ZIP_MAX_BYTES = 350 * 1024 * 1024;
    const WORK_BATCH_ESTIMATED_MAX_BYTES = 420 * 1024 * 1024;
    const ESTIMATED_PHOTO_BYTES = 1.5 * 1024 * 1024;
    const ESTIMATED_VIDEO_BYTES = 60 * 1024 * 1024;
    const ESTIMATED_EXTERNAL_GIF_BYTES = 8 * 1024 * 1024;

    const IMAGE_EXTENSIONS = new Set([
        '.jpg', '.jpeg', '.png', '.gif', '.webp',
        '.bmp', '.tif', '.tiff', '.avif', '.heic'
    ]);

    const VIDEO_EXTENSIONS = new Set([
        '.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi',
        '.mpeg', '.mpg', '.mpe', '.mpv',
        '.ogv', '.ogg',
        '.3gp', '.3g2',
        '.flv', '.f4v',
        '.wmv', '.asf',
        '.ts', '.mts', '.m2ts',
        '.vob', '.divx',
        '.rm', '.rmvb'
    ]);

    const MEDIA_EXTENSIONS = new Set([
        ...IMAGE_EXTENSIONS,
        ...VIDEO_EXTENSIONS
    ]);

    const STATUS = Object.freeze({
        COLLECTED: 'collected',
        FETCHING: 'fetching',
        PACKED: 'packed',
        ERROR: 'error'
    });

    /**
     * General archive-item storage. The mediaEntries alias remains during the
     * incremental migration so the production Discord userscript keeps its
     * established behavior after every milestone.
     */
    const archiveItems = new Map();
    const mediaEntries = archiveItems;
    const activeRequests = new Set();

    let firstSeenCounter = 0;
    let running = false;
    let scanning = false;
    let packing = false;
    let stopRequested = false;
    let renderTimer = null;
    let lastScanBoundaryReason = '';

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    const SITE_ADAPTERS = [];
    let activeSiteAdapter = null;

    function registerSiteAdapter(adapter) {
        if (!adapter?.id || !adapter?.label) {
            throw new Error('A site adapter needs an id and label.');
        }

        const discover = adapter.scanVisibleMedia || adapter.discoverRenderedItems;
        const requiredMethods = [
            ['matches', adapter.matches],
            ['scanVisibleMedia/discoverRenderedItems', discover],
            ['getArchiveContext', adapter.getArchiveContext],
            ['isDownloadUrlAllowed', adapter.isDownloadUrlAllowed]
        ];

        for (const [name, implementation] of requiredMethods) {
            if (typeof implementation !== 'function') {
                throw new Error(`Site adapter ${adapter.id} is missing ${name}().`);
            }
        }

        const normalizeCapabilities = globalThis.MediaArchiverDomain
            ?.normalizeAdapterCapabilities;
        const capabilities = normalizeCapabilities
            ? normalizeCapabilities(adapter.capabilities)
            : Object.freeze({
                media: true,
                textRecords: false,
                virtualTimeline: true,
                dateFilter: true,
                hostPageSelection: false,
                scanModes: Object.freeze([
                    'newest-to-oldest',
                    'current-to-oldest',
                    'current-to-newest',
                    'full-finish-down'
                ]),
                views: Object.freeze(['grid', 'list'])
            });

        const normalized = {
            ...adapter,
            capabilities,
            scanVisibleMedia: discover,
            findScroller: adapter.findScroller || (() => document.scrollingElement),
            visibleItemIds: adapter.visibleItemIds || (() => []),
            visibleItemTimeRange: adapter.visibleItemTimeRange || (() => null),
            findItemElementById: adapter.findItemElementById || (() => null),
            captureStartingAnchor: adapter.captureStartingAnchor || (() => null),
            findItemId: adapter.findItemId || (() => null),
            findItemTimestamp: adapter.findItemTimestamp || (() => null),
            compareItemIds: adapter.compareItemIds || ((left, right) =>
                String(left || '').localeCompare(String(right || ''))
            )
        };

        SITE_ADAPTERS.push(Object.freeze(normalized));
    }

    function resolveSiteAdapter() {
        return SITE_ADAPTERS.find(adapter => {
            try {
                return adapter.matches(location);
            } catch {
                return false;
            }
        }) || null;
    }

    function scanVisiblePage() {
        return activeSiteAdapter.scanVisibleMedia();
    }

    function findTimelineScroller() {
        return activeSiteAdapter.findScroller();
    }

    function visibleItemIds() {
        return activeSiteAdapter.visibleItemIds();
    }

    function visibleItemTimeRange() {
        return activeSiteAdapter.visibleItemTimeRange();
    }

    function findItemElementById(itemId) {
        return activeSiteAdapter.findItemElementById(itemId);
    }

    function captureStartingAnchor(scroller) {
        return activeSiteAdapter.captureStartingAnchor(scroller);
    }

    function findItemId(element) {
        return activeSiteAdapter.findItemId(element);
    }

    function findItemTimestamp(element) {
        return activeSiteAdapter.findItemTimestamp(element);
    }

    function timestampFromItemId(itemId) {
        return activeSiteAdapter.timestampFromItemId?.(itemId) || null;
    }

    function compareItemIds(left, right) {
        return activeSiteAdapter.compareItemIds(left, right);
    }

    function adapterTerm(key, fallback) {
        return activeSiteAdapter?.terms?.[key] || fallback;
    }

    function upsertArchiveItem(input) {
        const createArchiveItem = globalThis.MediaArchiverDomain?.createArchiveItem;
        const item = createArchiveItem ? createArchiveItem(input) : input;
        const existing = archiveItems.get(item.key);

        if (existing) {
            existing.duplicateCount = (existing.duplicateCount || 0) + 1;
            existing.payload = { ...existing.payload, ...item.payload };
            return { item: existing, inserted: false, duplicateMerged: true };
        }

        archiveItems.set(item.key, item);
        return { item, inserted: true, duplicateMerged: false };
    }

    function sanitizeFilename(value) {
        return (value || 'bild')
            .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
            .replace(/\s+/g, ' ')
            .replace(/[. ]+$/g, '')
            .slice(0, 180) || 'bild';
    }

    function extensionFromPath(pathname) {
        const filename = pathname.split('/').pop() || '';
        const dot = filename.lastIndexOf('.');
        return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
    }

    (() => {
        const REQUIRED_METHODS = Object.freeze([
            'fetchBinary',
            'requestExternal',
            'abortRequest',
            'abortAllRequests',
            'saveBlob',
            'copyText',
            'getSetting',
            'setSetting',
            'getPlatformInfo',
            'openUi',
            'closeUi'
        ]);

        function assertRuntime(runtime) {
            if (!runtime || typeof runtime !== 'object') {
                throw new TypeError('A runtime implementation object is required.');
            }

            for (const method of REQUIRED_METHODS) {
                if (typeof runtime[method] !== 'function') {
                    throw new TypeError(`Runtime is missing ${method}().`);
                }
            }

            return runtime;
        }

        function createRuntimeFacade(implementation) {
            const runtime = assertRuntime(implementation);
            const facade = {};

            for (const method of REQUIRED_METHODS) {
                facade[method] = (...args) => runtime[method](...args);
            }

            return Object.freeze(facade);
        }

        function createMemorySettings(initialValues = {}) {
            const values = new Map(Object.entries(initialValues));
            return Object.freeze({
                async getSetting(key, fallback) {
                    return values.has(key) ? values.get(key) : fallback;
                },
                async setSetting(key, value) {
                    values.set(key, value);
                    return value;
                },
                snapshot() {
                    return Object.fromEntries(values);
                }
            });
        }

        const api = Object.freeze({
            REQUIRED_METHODS,
            assertRuntime,
            createRuntimeFacade,
            createMemorySettings
        });

        Object.defineProperty(globalThis, 'MediaArchiverRuntimeContract', {
            value: api,
            configurable: true,
            writable: false
        });
    })();

    (() => {
        const ITEM_KINDS = Object.freeze({
            MEDIA: 'media',
            COMMENT: 'comment',
            GENERATED_DOCUMENT: 'generated-document'
        });

        const WORKFLOW_PHASES = Object.freeze({
            IDLE: 'idle',
            SCANNING: 'scanning',
            SCAN_STOPPED: 'scan-stopped',
            REVIEW_READY: 'review-ready',
            REVIEWING: 'reviewing',
            FETCHING_SELECTED: 'fetching-selected',
            PACKING: 'packing',
            COMPLETED: 'completed',
            ERROR: 'error'
        });

        const DEFAULT_CAPABILITIES = Object.freeze({
            media: false,
            textRecords: false,
            virtualTimeline: false,
            dateFilter: false,
            hostPageSelection: false,
            scanModes: Object.freeze([]),
            views: Object.freeze(['grid', 'list'])
        });

        function normalizeAdapterCapabilities(capabilities = {}) {
            const scanModes = Array.isArray(capabilities.scanModes)
                ? [...new Set(capabilities.scanModes.map(String))]
                : [];
            const views = Array.isArray(capabilities.views) && capabilities.views.length
                ? [...new Set(capabilities.views.map(String))]
                : ['grid', 'list'];

            return Object.freeze({
                media: Boolean(capabilities.media),
                textRecords: Boolean(capabilities.textRecords),
                virtualTimeline: Boolean(capabilities.virtualTimeline),
                dateFilter: Boolean(capabilities.dateFilter),
                hostPageSelection: Boolean(capabilities.hostPageSelection),
                scanModes: Object.freeze(scanModes),
                views: Object.freeze(views)
            });
        }

        function normalizeEligibility(value = {}) {
            return Object.freeze({
                adapter: value.adapter !== false,
                type: value.type !== false,
                date: value.date !== false
            });
        }

        function isArchiveItemEligible(item) {
            const eligibility = item?.eligibility || {};
            return Boolean(
                item?.canonical !== false &&
                eligibility.adapter !== false &&
                eligibility.type !== false &&
                eligibility.date !== false
            );
        }

        function createArchiveItem(input = {}) {
            if (!input.key) throw new TypeError('ArchiveItem requires a stable key.');
            if (!input.adapterId) throw new TypeError('ArchiveItem requires adapterId.');

            const kind = input.kind || ITEM_KINDS.MEDIA;
            if (!Object.values(ITEM_KINDS).includes(kind)) {
                throw new TypeError(`Unsupported ArchiveItem kind: ${kind}`);
            }

            const eligibility = normalizeEligibility(input.eligibility);
            const canonical = input.canonical !== false;
            const initiallySelected = input.manuallySelected ?? (
                canonical &&
                eligibility.adapter &&
                eligibility.type &&
                eligibility.date
            );

            return {
                key: String(input.key),
                kind,
                adapterId: String(input.adapterId),
                sourceId: input.sourceId == null ? null : String(input.sourceId),
                parentSourceId: input.parentSourceId == null
                    ? null
                    : String(input.parentSourceId),
                timestamp: input.timestamp || null,
                discoveryIndex: Number.isFinite(input.discoveryIndex)
                    ? input.discoveryIndex
                    : 0,
                canonical,
                canonicalKey: String(input.canonicalKey || input.key),
                duplicateCount: Math.max(0, Number(input.duplicateCount) || 0),
                eligibility,
                manuallySelected: Boolean(initiallySelected),
                status: input.status || 'collected',
                error: input.error || '',
                payload: input.payload || {}
            };
        }

        function isFinalArchiveCandidate(item) {
            return Boolean(isArchiveItemEligible(item) && item.manuallySelected);
        }

        const api = Object.freeze({
            ITEM_KINDS,
            WORKFLOW_PHASES,
            DEFAULT_CAPABILITIES,
            normalizeAdapterCapabilities,
            createArchiveItem,
            isArchiveItemEligible,
            isFinalArchiveCandidate
        });

        Object.defineProperty(globalThis, 'MediaArchiverDomain', {
            value: api,
            configurable: true,
            writable: false
        });
    })();

    (() => {
        const phases = globalThis.MediaArchiverDomain?.WORKFLOW_PHASES || Object.freeze({
            IDLE: 'idle',
            SCANNING: 'scanning',
            SCAN_STOPPED: 'scan-stopped',
            REVIEW_READY: 'review-ready',
            REVIEWING: 'reviewing',
            FETCHING_SELECTED: 'fetching-selected',
            PACKING: 'packing',
            COMPLETED: 'completed',
            ERROR: 'error'
        });

        const transitions = Object.freeze({
            [phases.IDLE]: new Set([phases.SCANNING]),
            [phases.SCANNING]: new Set([
                phases.SCAN_STOPPED,
                phases.REVIEW_READY,
                phases.FETCHING_SELECTED,
                phases.ERROR
            ]),
            [phases.SCAN_STOPPED]: new Set([
                phases.REVIEW_READY,
                phases.REVIEWING,
                phases.FETCHING_SELECTED,
                phases.IDLE,
                phases.ERROR
            ]),
            [phases.REVIEW_READY]: new Set([
                phases.REVIEWING,
                phases.IDLE,
                phases.ERROR
            ]),
            [phases.REVIEWING]: new Set([
                phases.FETCHING_SELECTED,
                phases.REVIEW_READY,
                phases.IDLE,
                phases.ERROR
            ]),
            [phases.FETCHING_SELECTED]: new Set([
                phases.PACKING,
                phases.SCAN_STOPPED,
                phases.ERROR
            ]),
            [phases.PACKING]: new Set([
                phases.COMPLETED,
                phases.SCAN_STOPPED,
                phases.ERROR
            ]),
            [phases.COMPLETED]: new Set([
                phases.IDLE,
                phases.SCANNING
            ]),
            [phases.ERROR]: new Set([
                phases.IDLE,
                phases.SCANNING,
                phases.REVIEW_READY
            ])
        });

        function createWorkflowStateMachine(options = {}) {
            let phase = phases.IDLE;
            let mode = options.mode === 'review' ? 'review' : 'quick';
            let version = 0;
            const listeners = new Set();

            function emit(previous, metadata) {
                const snapshot = Object.freeze({ phase, mode, version, metadata });
                for (const listener of listeners) listener(snapshot, previous);
                return snapshot;
            }

            function transition(nextPhase, metadata = {}) {
                if (nextPhase === phase) return emit(phase, metadata);
                const allowed = transitions[phase] || new Set();
                if (!allowed.has(nextPhase)) {
                    throw new Error(`Invalid workflow transition: ${phase} -> ${nextPhase}`);
                }
                const previous = phase;
                phase = nextPhase;
                version++;
                return emit(previous, metadata);
            }

            return Object.freeze({
                transition,
                canTransition(nextPhase) {
                    return nextPhase === phase || Boolean(transitions[phase]?.has(nextPhase));
                },
                setMode(nextMode) {
                    if (phase !== phases.IDLE && phase !== phases.COMPLETED) {
                        throw new Error('After-scan mode can only change while idle or completed.');
                    }
                    mode = nextMode === 'review' ? 'review' : 'quick';
                    version++;
                    return emit(phase, { reason: 'mode-change' });
                },
                afterScan({ stopped = false } = {}) {
                    if (phase !== phases.SCANNING) {
                        throw new Error('afterScan() requires the scanning phase.');
                    }
                    if (stopped) {
                        transition(phases.SCAN_STOPPED, { stopped: true });
                        return mode === 'review'
                            ? transition(phases.REVIEW_READY, { partial: true })
                            : phase;
                    }
                    return transition(
                        mode === 'review'
                            ? phases.REVIEW_READY
                            : phases.FETCHING_SELECTED,
                        { partial: false }
                    );
                },
                subscribe(listener) {
                    listeners.add(listener);
                    return () => listeners.delete(listener);
                },
                get phase() {
                    return phase;
                },
                get mode() {
                    return mode;
                },
                get version() {
                    return version;
                },
                snapshot() {
                    return Object.freeze({ phase, mode, version });
                }
            });
        }

        Object.defineProperty(globalThis, 'MediaArchiverWorkflowState', {
            value: Object.freeze({ phases, transitions, createWorkflowStateMachine }),
            configurable: true,
            writable: false
        });
    })();

    (() => {
        function createSelectionStore(options = {}) {
            const selected = new Set();
            const initialized = new Set();
            let anchorKey = null;
            let version = 0;
            const isEligible = options.isEligible || (
                item => globalThis.MediaArchiverDomain
                    ? globalThis.MediaArchiverDomain.isArchiveItemEligible(item)
                    : item?.eligible !== false
            );

            function touch() {
                version++;
            }

            function itemKey(itemOrKey) {
                return typeof itemOrKey === 'string'
                    ? itemOrKey
                    : itemOrKey?.key;
            }

            function ensureItems(items) {
                let changed = false;
                for (const item of items || []) {
                    const key = itemKey(item);
                    if (!key) continue;

                    if (!initialized.has(key)) {
                        initialized.add(key);
                        if (isEligible(item)) selected.add(key);
                        changed = true;
                    }

                    item.manuallySelected = selected.has(key);
                }
                if (changed) touch();
                return changed;
            }

            function syncItems(items) {
                for (const item of items || []) {
                    if (item?.key) item.manuallySelected = selected.has(item.key);
                }
            }

            function setSelected(key, value, { setAnchor = true } = {}) {
                if (!key) return false;
                initialized.add(key);
                const had = selected.has(key);
                if (value) selected.add(key);
                else selected.delete(key);
                if (setAnchor) anchorKey = key;
                if (had !== Boolean(value)) touch();
                return had !== Boolean(value);
            }

            function toggle(key, options = {}) {
                return setSelected(key, !selected.has(key), options);
            }

            function selectOnly(key) {
                if (!key) return false;
                const unchanged = selected.size === 1 && selected.has(key);
                selected.clear();
                selected.add(key);
                initialized.add(key);
                anchorKey = key;
                if (!unchanged) touch();
                return !unchanged;
            }

            function selectNone() {
                if (!selected.size) return false;
                selected.clear();
                touch();
                return true;
            }

            function selectAllEligible(items) {
                let changed = false;
                for (const item of items || []) {
                    if (!item?.key) continue;
                    initialized.add(item.key);
                    if (isEligible(item) && !selected.has(item.key)) {
                        selected.add(item.key);
                        changed = true;
                    }
                }
                if (changed) touch();
                return changed;
            }

            function selectAllVisible(viewItems) {
                return selectAllEligible(viewItems);
            }

            function invertVisible(viewItems) {
                let changed = false;
                for (const item of viewItems || []) {
                    if (!item?.key || !isEligible(item)) continue;
                    initialized.add(item.key);
                    if (selected.has(item.key)) selected.delete(item.key);
                    else selected.add(item.key);
                    changed = true;
                }
                if (changed) touch();
                return changed;
            }

            function applyRange(viewItems, targetKey, { additive = false } = {}) {
                const eligibleItems = (viewItems || []).filter(item => item?.key && isEligible(item));
                const keys = eligibleItems.map(item => item.key);
                const targetIndex = keys.indexOf(targetKey);
                if (targetIndex < 0) return false;

                const anchorIndex = keys.indexOf(anchorKey);
                const effectiveAnchorIndex = anchorIndex >= 0 ? anchorIndex : targetIndex;
                const start = Math.min(effectiveAnchorIndex, targetIndex);
                const end = Math.max(effectiveAnchorIndex, targetIndex);
                const rangeKeys = keys.slice(start, end + 1);
                const before = new Set(selected);

                if (!additive) selected.clear();
                for (const key of rangeKeys) {
                    initialized.add(key);
                    selected.add(key);
                }
                anchorKey = anchorKey && anchorIndex >= 0 ? anchorKey : targetKey;

                const changed = before.size !== selected.size ||
                    [...before].some(key => !selected.has(key));
                if (changed) touch();
                return changed;
            }

            function applyClick({
                key,
                viewItems,
                checkmark = false,
                ctrlKey = false,
                metaKey = false,
                shiftKey = false
            }) {
                const additive = Boolean(ctrlKey || metaKey);

                if (shiftKey) {
                    return applyRange(viewItems, key, { additive });
                }

                // File-manager range modifiers remain available, but the
                // primary interaction is deliberately simple: every normal
                // card or checkmark click toggles the clicked item in place.
                // This avoids the surprising former behavior where a plain
                // click cleared the complete selection first.
                void checkmark;
                return toggle(key);
            }

            function removeMissing(validKeys) {
                const allowed = validKeys instanceof Set ? validKeys : new Set(validKeys || []);
                let changed = false;
                for (const key of [...selected]) {
                    if (!allowed.has(key)) {
                        selected.delete(key);
                        initialized.delete(key);
                        changed = true;
                    }
                }
                if (anchorKey && !allowed.has(anchorKey)) anchorKey = null;
                if (changed) touch();
                return changed;
            }

            return Object.freeze({
                ensureItems,
                syncItems,
                isSelected: key => selected.has(key),
                setSelected,
                toggle,
                selectOnly,
                selectNone,
                selectAllEligible,
                selectAllVisible,
                invertVisible,
                applyRange,
                applyClick,
                removeMissing,
                setAnchor(key) {
                    anchorKey = key || null;
                },
                get anchorKey() {
                    return anchorKey;
                },
                get version() {
                    return version;
                },
                get count() {
                    return selected.size;
                },
                selectedKeys() {
                    return new Set(selected);
                },
                snapshot() {
                    return Object.freeze({
                        selectedKeys: Object.freeze([...selected]),
                        anchorKey,
                        version
                    });
                }
            });
        }

        Object.defineProperty(globalThis, 'MediaArchiverSelection', {
            value: Object.freeze({ createSelectionStore }),
            configurable: true,
            writable: false
        });
    })();
    (() => {
        const PRESETS = Object.freeze({
            NUMBERED: 'numbered',
            SOURCE_DATETIME: 'source-datetime',
            SOURCE_DATE_NUMBER: 'source-date-number',
            ORIGINAL_NUMBER: 'original-number',
            CUSTOM: 'custom'
        });

        const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
        const TOKEN_PATTERN = /\{(sequence|date|time|datetime|site|source|original|mediaType|itemId)\}/g;
        const MAX_COMPONENT_LENGTH = 180;
        const MAX_FILENAME_LENGTH = 240;

        function sequenceText(index, total, requestedWidth = 6) {
            const width = Math.max(6, Number(requestedWidth) || 6, String(total).length);
            return String(index + 1).padStart(width, '0');
        }

        function extensionFromValue(value) {
            if (!value) return '';
            const clean = String(value).split(/[?#]/, 1)[0];
            const match = clean.match(/(\.[A-Za-z0-9]{1,12})$/);
            return match ? match[1] : '';
        }

        function trueExtension(item) {
            const payload = item?.payload || item || {};
            const explicit = extensionFromValue(payload.extension);
            if (explicit) return explicit;

            const original = extensionFromValue(
                payload.originalFilename ||
                payload.filename ||
                item?.filename
            );
            if (original) return original;

            try {
                const url = new URL(payload.url || item?.url || '', 'https://invalid.local/');
                const fromUrl = extensionFromValue(url.pathname);
                if (fromUrl) return fromUrl;
            } catch {
                // Fall through to kind-specific safe extensions.
            }

            if (item?.kind === 'comment') return '.json';
            if (item?.kind === 'generated-document') {
                return extensionFromValue(payload.filename) || '.txt';
            }
            if (payload.mediaType === 'video' || payload.mediaType === 'external-gif') {
                return '.mp4';
            }
            return '.jpg';
        }

        function withoutExtension(value) {
            const text = String(value || '');
            const extension = extensionFromValue(text);
            return extension ? text.slice(0, -extension.length) : text;
        }

        function collapseSeparators(value) {
            return value
                .replace(/[\s_-]+/g, '_')
                .replace(/^_+|_+$/g, '');
        }

        function sanitizeComponent(value, fallback = 'untitled') {
            let text = String(value ?? '')
                .normalize('NFKC')
                .replace(/[<>:"/\\|?*\u0000-\u001F\u007F]/g, '_')
                .replace(/[. ]+$/g, '')
                .replace(/^\.+$/g, '')
                .trim();

            text = collapseSeparators(text);
            if (!text || text === '.' || text === '..') text = fallback;
            if (WINDOWS_RESERVED.test(text)) text = `_${text}`;
            if (text.length > MAX_COMPONENT_LENGTH) {
                text = text.slice(0, MAX_COMPONENT_LENGTH).replace(/[. _-]+$/g, '');
            }
            return text || fallback;
        }

        function normalizeCollisionKey(value) {
            return String(value || '')
                .normalize('NFC')
                .replace(/[. ]+$/g, '')
                .toLocaleLowerCase('en-US');
        }

        function sourceDateParts(item, settings = {}) {
            const raw = item?.timestamp || item?.payload?.timestamp || null;
            const parsed = raw ? new Date(raw) : null;
            if (!parsed || !Number.isFinite(parsed.getTime())) {
                return {
                    date: 'unknown-date',
                    time: 'unknown-time',
                    datetime: 'unknown-date_unknown-time'
                };
            }

            const useUtc = settings.timezone === 'utc';
            const get = (local, utc) => useUtc ? utc.call(parsed) : local.call(parsed);
            const year = get(Date.prototype.getFullYear, Date.prototype.getUTCFullYear);
            const month = String(get(Date.prototype.getMonth, Date.prototype.getUTCMonth) + 1).padStart(2, '0');
            const day = String(get(Date.prototype.getDate, Date.prototype.getUTCDate)).padStart(2, '0');
            const hour = String(get(Date.prototype.getHours, Date.prototype.getUTCHours)).padStart(2, '0');
            const minute = String(get(Date.prototype.getMinutes, Date.prototype.getUTCMinutes)).padStart(2, '0');
            const second = String(get(Date.prototype.getSeconds, Date.prototype.getUTCSeconds)).padStart(2, '0');
            const date = `${year}-${month}-${day}`;
            const time = `${hour}-${minute}-${second}`;
            return { date, time, datetime: `${date}_${time}` };
        }

        function presetTemplate(preset) {
            switch (preset) {
                case PRESETS.SOURCE_DATETIME:
                    return '{datetime}';
                case PRESETS.SOURCE_DATE_NUMBER:
                    return '{source}_{date}_{sequence}';
                case PRESETS.ORIGINAL_NUMBER:
                    return '{original}_{sequence}';
                case PRESETS.CUSTOM:
                    return null;
                default:
                    return '{sequence}';
            }
        }

        function validateTemplate(template) {
            const value = String(template || '').trim();
            if (!value) return { valid: false, error: 'Template cannot be empty.' };
            if (/[\/\\]/.test(value)) {
                return { valid: false, error: 'Folders are not supported in naming templates yet.' };
            }

            const withoutKnownTokens = value.replace(TOKEN_PATTERN, '');
            const unknownToken = withoutKnownTokens.match(/\{[^}]+\}/)?.[0];
            if (unknownToken) {
                return { valid: false, error: `Unsupported token: ${unknownToken}` };
            }
            return { valid: true, error: '' };
        }

        function renderTemplate(template, item, values) {
            return String(template).replace(TOKEN_PATTERN, (_, token) => values[token] ?? '');
        }

        function buildTokenValues(item, index, total, settings, context) {
            const sequence = sequenceText(index, total, settings.sequenceWidth);
            const dates = sourceDateParts(item, settings);
            const payload = item?.payload || item || {};
            const original = sanitizeComponent(withoutExtension(
                payload.originalFilename || payload.filename || item?.filename || 'untitled'
            ), `untitled_${sequence}`);
            const site = sanitizeComponent(
                context.site || context.adapterLabel || item?.adapterId || 'site',
                'site'
            );
            const source = sanitizeComponent(
                payload.sourceLabel || context.sourceLabel || context.adapterLabel || item?.adapterId || 'source',
                `source_${sequence}`
            );

            return {
                sequence,
                date: dates.date,
                time: dates.time,
                datetime: dates.datetime,
                site,
                source,
                original,
                mediaType: sanitizeComponent(payload.mediaType || item?.kind || 'item', 'item'),
                itemId: sanitizeComponent(item?.sourceId || payload.itemId || item?.key || sequence, sequence)
            };
        }

        function trimStemForFilename(stem, extension, suffix = '') {
            const maximum = Math.max(1, MAX_FILENAME_LENGTH - extension.length - suffix.length);
            const trimmed = stem.slice(0, maximum).replace(/[. _-]+$/g, '');
            return trimmed || 'untitled';
        }

        function planArchiveNames(items, settings = {}, adapterContext = {}) {
            const finalItems = [...(items || [])];
            const preset = settings.preset || PRESETS.NUMBERED;
            const template = presetTemplate(preset) ?? settings.template;
            const validation = validateTemplate(template);
            if (!validation.valid) {
                const error = new Error(validation.error);
                error.code = 'NAMING_TEMPLATE_INVALID';
                throw error;
            }

            const reservedStems = new Set();
            const reservedPaths = new Set();
            const namesByKey = new Map();
            const records = [];

            finalItems.forEach((item, index) => {
                if (!item?.key) throw new TypeError('Every final item requires a stable key.');
                const extension = trueExtension(item);
                const values = buildTokenValues(item, index, finalItems.length, settings, adapterContext);
                let stem = sanitizeComponent(
                    renderTemplate(template, item, values),
                    `untitled_${values.sequence}`
                );
                let collisionResolved = false;
                let collisionIndex = 0;
                let candidateStem = stem;

                while (
                    reservedStems.has(normalizeCollisionKey(candidateStem)) ||
                    reservedPaths.has(normalizeCollisionKey(`${candidateStem}${extension}`))
                ) {
                    collisionResolved = true;
                    collisionIndex++;
                    const suffix = `_${values.sequence}${collisionIndex > 1 ? `_${collisionIndex}` : ''}`;
                    candidateStem = `${trimStemForFilename(stem, extension, suffix)}${suffix}`;
                }

                stem = trimStemForFilename(candidateStem, extension);
                const filename = `${stem}${extension}`;
                reservedStems.add(normalizeCollisionKey(stem));
                reservedPaths.add(normalizeCollisionKey(filename));
                namesByKey.set(item.key, filename);
                records.push(Object.freeze({
                    itemKey: item.key,
                    archiveFilename: filename,
                    archiveStem: stem,
                    originalFilename: item?.payload?.originalFilename || item?.payload?.filename || item?.filename || '',
                    namingPreset: preset,
                    namingTemplate: template,
                    sourceLabel: values.source,
                    sourceTimestamp: item.timestamp || null,
                    namingTimezone: settings.timezone === 'utc' ? 'utc' : 'local',
                    collisionResolved,
                    collisionIndex,
                    extension
                }));
            });

            return Object.freeze({
                preset,
                template,
                namesByKey,
                records: Object.freeze(records),
                get(itemKey) {
                    return namesByKey.get(itemKey) || null;
                }
            });
        }

        const api = Object.freeze({
            PRESETS,
            TOKEN_PATTERN,
            sanitizeComponent,
            normalizeCollisionKey,
            validateTemplate,
            trueExtension,
            planArchiveNames
        });

        Object.defineProperty(globalThis, 'MediaArchiverNaming', {
            value: api,
            configurable: true,
            writable: false
        });
    })();

    (() => {
        const base = globalThis.MediaArchiverNaming;
        if (!base) return;

        function fixedDocumentPlan(items, settings = {}, context = {}) {
            const fixedItems = items.filter(item => item?.payload?.fixedArchiveName);
            if (!fixedItems.length) return base.planArchiveNames(items, settings, context);

            const normalItems = items.filter(item => !item?.payload?.fixedArchiveName);
            const normalPlan = base.planArchiveNames(normalItems, settings, context);
            const namesByKey = new Map(normalPlan.namesByKey);
            const recordByKey = new Map(normalPlan.records.map(record => [record.itemKey, record]));
            const reservedStems = new Set(
                normalPlan.records.map(record => base.normalizeCollisionKey(record.archiveStem))
            );
            const reservedPaths = new Set(
                normalPlan.records.map(record => base.normalizeCollisionKey(record.archiveFilename))
            );

            for (const item of fixedItems) {
                const requested = String(item.payload.fixedArchiveName || item.payload.filename || 'document.txt');
                const extension = base.trueExtension(item);
                const rawStem = requested.toLowerCase().endsWith(extension.toLowerCase())
                    ? requested.slice(0, -extension.length)
                    : requested;
                const sequence = String(items.indexOf(item) + 1).padStart(
                    Math.max(6, String(items.length).length),
                    '0'
                );
                let stem = base.sanitizeComponent(rawStem, `document_${sequence}`);
                let filename = `${stem}${extension}`;
                let collisionIndex = 0;

                while (
                    reservedStems.has(base.normalizeCollisionKey(stem)) ||
                    reservedPaths.has(base.normalizeCollisionKey(filename))
                ) {
                    collisionIndex++;
                    stem = base.sanitizeComponent(
                        `${rawStem}_${sequence}${collisionIndex > 1 ? `_${collisionIndex}` : ''}`,
                        `document_${sequence}`
                    );
                    filename = `${stem}${extension}`;
                }

                reservedStems.add(base.normalizeCollisionKey(stem));
                reservedPaths.add(base.normalizeCollisionKey(filename));
                namesByKey.set(item.key, filename);
                recordByKey.set(item.key, Object.freeze({
                    itemKey: item.key,
                    archiveFilename: filename,
                    archiveStem: stem,
                    originalFilename: requested,
                    namingPreset: settings.preset || base.PRESETS.NUMBERED,
                    namingTemplate: 'fixed-generated-document',
                    sourceLabel: context.sourceLabel || context.adapterLabel || item.adapterId,
                    sourceTimestamp: item.timestamp || null,
                    namingTimezone: settings.timezone === 'utc' ? 'utc' : 'local',
                    collisionResolved: collisionIndex > 0,
                    collisionIndex,
                    extension
                }));
            }

            return Object.freeze({
                preset: settings.preset || base.PRESETS.NUMBERED,
                template: normalPlan.template,
                namesByKey,
                records: Object.freeze(items.map(item => recordByKey.get(item.key))),
                get(itemKey) {
                    return namesByKey.get(itemKey) || null;
                }
            });
        }

        Object.defineProperty(globalThis, 'MediaArchiverNaming', {
            value: Object.freeze({ ...base, planArchiveNames: fixedDocumentPlan }),
            configurable: true,
            writable: false
        });
    })();

    (() => {
        function csvCell(value) {
            let text = String(value ?? '');
            if (/^[=+\-@]/.test(text)) text = `'${text}`;
            return `"${text.replace(/"/g, '""')}"`;
        }

        function markdownText(value) {
            return String(value ?? '')
                .replace(/\\/g, '\\\\')
                .replace(/([*_`[\]<>])/g, '\\$1')
                .replace(/\r?\n/g, ' ')
                .trim();
        }

        function commentRecord(item) {
            const payload = item.payload || {};
            return {
                id: item.sourceId || payload.commentId || item.key,
                parentId: item.parentSourceId || payload.parentId || null,
                depth: Number(payload.depth) || 0,
                author: payload.author || '[unavailable]',
                bodyText: payload.bodyText || '',
                bodyHtmlSanitized: payload.bodyHtmlSanitized || null,
                timestamp: item.timestamp || payload.timestamp || null,
                scoreText: payload.scoreText || null,
                permalink: payload.permalink || null,
                deleted: Boolean(payload.deleted),
                collapsed: Boolean(payload.collapsed),
                edited: Boolean(payload.edited),
                discoveryIndex: Number(item.discoveryIndex) || 0
            };
        }

        function orderedComments(items) {
            const records = items.map(commentRecord);
            const byId = new Map(records.map(record => [record.id, record]));
            const children = new Map();
            const roots = [];
            for (const record of records) {
                if (record.parentId && byId.has(record.parentId)) {
                    const list = children.get(record.parentId) || [];
                    list.push(record);
                    children.set(record.parentId, list);
                } else {
                    roots.push(record);
                }
            }
            const sort = list => list.sort((a, b) => a.discoveryIndex - b.discoveryIndex);
            sort(roots);
            for (const list of children.values()) sort(list);
            const output = [];
            const visit = (record, depth) => {
                output.push({ ...record, depth });
                for (const child of children.get(record.id) || []) visit(child, depth + 1);
            };
            for (const root of roots) visit(root, Math.max(0, root.depth));
            return output;
        }

        function buildJson(records, context) {
            return `${JSON.stringify({
                schemaVersion: 1,
                source: {
                    adapter: 'reddit-comments',
                    pageType: 'post-comments',
                    postId: context.postId || null,
                    exportedAt: new Date(0).toISOString()
                },
                comments: records
            }, null, 2)}\n`;
        }

        function buildMarkdown(records, context) {
            const lines = [
                '# Reddit comments',
                '',
                context.postLabel ? `Source: ${markdownText(context.postLabel)}` : '',
                context.postPermalink ? `Permalink: ${context.postPermalink}` : '',
                ''
            ].filter((value, index, values) => value !== '' || values[index - 1] !== '');
            for (const record of records) {
                const indent = '  '.repeat(Math.max(0, record.depth));
                const author = markdownText(record.author || '[unavailable]');
                const body = markdownText(record.bodyText || (record.deleted ? '[deleted]' : '[no rendered body]'));
                const metadata = [record.timestamp, record.scoreText, record.edited ? 'edited' : '']
                    .filter(Boolean)
                    .map(markdownText)
                    .join(' · ');
                lines.push(`${indent}- **${author}**${metadata ? ` — ${metadata}` : ''}`);
                lines.push(`${indent}  ${body}`);
                if (record.permalink) lines.push(`${indent}  ${record.permalink}`);
            }
            return `${lines.join('\n').trim()}\n`;
        }

        function buildCsv(records) {
            const columns = [
                'comment_id', 'parent_id', 'depth', 'author', 'body_text',
                'timestamp', 'score_text', 'permalink', 'deleted', 'collapsed', 'edited'
            ];
            const rows = [columns.map(csvCell).join(',')];
            for (const record of records) {
                rows.push([
                    record.id,
                    record.parentId || '',
                    record.depth,
                    record.author,
                    record.bodyText,
                    record.timestamp || '',
                    record.scoreText || '',
                    record.permalink || '',
                    record.deleted,
                    record.collapsed,
                    record.edited
                ].map(csvCell).join(','));
            }
            return `\uFEFF${rows.join('\r\n')}`;
        }

        function generatedDocument(key, filename, content, mediaType, discoveryIndex) {
            return {
                key,
                kind: 'generated-document',
                adapterId: 'reddit-comments',
                sourceId: key,
                parentSourceId: null,
                timestamp: null,
                discoveryIndex,
                canonical: true,
                eligibility: { adapter: true, type: true, date: true },
                manuallySelected: true,
                status: 'collected',
                error: '',
                filename,
                mediaType: 'document',
                sourceKind: 'reddit-comment-export',
                url: null,
                previewUrl: null,
                size: new TextEncoder().encode(content).byteLength,
                payload: {
                    filename,
                    originalFilename: filename,
                    fixedArchiveName: filename,
                    mediaType,
                    generatedText: content,
                    generatedBytes: new TextEncoder().encode(content),
                    sourceKind: 'reddit-comment-export'
                }
            };
        }

        function buildCommentDocuments(selectedCommentItems, context = {}) {
            const records = orderedComments(selectedCommentItems);
            if (!records.length) return [];
            const baseIndex = Math.max(0, ...selectedCommentItems.map(item => Number(item.discoveryIndex) || 0)) + 1;
            return [
                generatedDocument('reddit-comments:json', 'comments.json', buildJson(records, context), 'application/json', baseIndex),
                generatedDocument('reddit-comments:markdown', 'comments.md', buildMarkdown(records, context), 'text/markdown', baseIndex + 1),
                generatedDocument('reddit-comments:csv', 'comments.csv', buildCsv(records), 'text/csv', baseIndex + 2)
            ];
        }

        function prepareArchiveItems(selectedItems, context = {}) {
            const comments = selectedItems.filter(item => item.kind === 'comment');
            const otherItems = selectedItems.filter(item => item.kind !== 'comment');
            return Object.freeze({
                selectedCommentCount: comments.length,
                selectedBinaryCount: otherItems.filter(item => item.kind === 'media').length,
                finalItems: Object.freeze([
                    ...otherItems,
                    ...buildCommentDocuments(comments, context)
                ])
            });
        }

        Object.defineProperty(globalThis, 'MediaArchiverCommentExport', {
            value: Object.freeze({
                commentRecord,
                orderedComments,
                buildCommentDocuments,
                prepareArchiveItems
            }),
            configurable: true,
            writable: false
        });
    })();

    (() => {
        const ERROR_CODES = Object.freeze([
            'ADAPTER_UNSUPPORTED_PAGE',
            'ADAPTER_TIMELINE_NOT_FOUND',
            'ADAPTER_DISCOVERY_FAILED',
            'SCAN_BOUNDARY_TIMEOUT',
            'SCAN_ITERATION_LIMIT',
            'SCAN_POSITION_RESTORE_FAILED',
            'NETWORK_HTTP_403',
            'NETWORK_HTTP_404',
            'NETWORK_HTTP_429',
            'NETWORK_HTTP_5XX',
            'NETWORK_TIMEOUT',
            'NETWORK_ABORTED',
            'NETWORK_HOST_REJECTED',
            'NETWORK_RETRY_EXHAUSTED',
            'NAMING_TEMPLATE_INVALID',
            'NAMING_COLLISION_RESOLVED',
            'NAMING_PLAN_FAILED',
            'ZIP_ENGINE_UNAVAILABLE',
            'ZIP_FALLBACK_ACTIVE',
            'ZIP_PART_BUILD_FAILED',
            'ZIP_PART_TOO_LARGE',
            'ZIP_DOWNLOAD_BLOCKED',
            'RUNTIME_CLIPBOARD_FAILED',
            'RUNTIME_SAVE_FAILED',
            'RUNTIME_STORAGE_FAILED',
            'UI_LIBRARY_RENDER_FAILED'
        ]);

        const LEVELS = new Set(['debug', 'info', 'success', 'warn', 'error']);
        const CATEGORIES = new Set([
            'runtime', 'adapter', 'scan', 'selection', 'network',
            'naming', 'archive', 'zip', 'ui'
        ]);
        const SENSITIVE_KEY = /(token|cookie|authorization|password|secret|signature|signed|query|fragment|bodyText|bodyHtml|username|sourceLabel|localPath|extensionId)/i;

        function sanitizeUrl(value) {
            try {
                const url = new URL(String(value));
                return `${url.protocol}//${url.host}${url.pathname}`;
            } catch {
                return String(value)
                    .replace(/[?#].*$/, '')
                    .replace(/(?:token|signature|authorization|cookie)=[^\s&]+/gi, '$1=[redacted]');
            }
        }

        function redactValue(value, key = '', seen = new WeakSet()) {
            if (SENSITIVE_KEY.test(key)) return '[redacted]';
            if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
            if (typeof value === 'string') {
                if (/^https?:\/\//i.test(value)) return sanitizeUrl(value);
                return value
                    .replace(/(?:Bearer|Bot)\s+[A-Za-z0-9._~+\/-]+/gi, '[redacted credential]')
                    .replace(/(?:token|cookie|authorization|signature)=([^\s&]+)/gi, '$1=[redacted]')
                    .replace(/(?:[A-Za-z]:\\|\/home\/|\/Users\/)[^\s]+/g, '[redacted path]');
            }
            if (typeof value !== 'object') return String(value);
            if (seen.has(value)) return '[circular]';
            seen.add(value);
            if (Array.isArray(value)) return value.map(item => redactValue(item, key, seen));

            const output = {};
            for (const [childKey, childValue] of Object.entries(value)) {
                output[childKey] = redactValue(childValue, childKey, seen);
            }
            return output;
        }

        function sanitizeError(error) {
            if (!error) return null;
            return Object.freeze({
                name: error.name || 'Error',
                message: redactValue(error.message || String(error)),
                stack: redactValue(error.stack || ''),
                causeCode: error.cause?.code || error.causeCode || null
            });
        }

        function createDiagnosticsStore(options = {}) {
            const limit = Math.max(100, Number(options.limit) || 2_000);
            const runtimeTarget = options.runtimeTarget || 'unknown';
            const appVersion = options.appVersion || 'unknown';
            let sessionId = null;
            let sequence = 0;
            let sessionMetadata = {};
            const events = [];
            const listeners = new Set();

            function preserveBoundedHistory() {
                while (events.length > limit) {
                    const removable = events.findIndex((event, index) =>
                        index > 0 &&
                        index < events.length - 1 &&
                        event.level !== 'error' &&
                        event.level !== 'warn'
                    );
                    if (removable >= 0) events.splice(removable, 1);
                    else events.splice(1, 1);
                }
            }

            function emit(level, code, message, context = {}, error = null, extra = {}) {
                const normalizedLevel = LEVELS.has(level) ? level : 'info';
                const category = CATEGORIES.has(extra.category) ? extra.category : 'runtime';
                const now = new Date();
                const event = Object.freeze({
                    id: `${sessionId || 'session'}-${++sequence}`,
                    sessionId,
                    timestamp: now.toISOString(),
                    monotonicMs: typeof performance !== 'undefined' ? performance.now() : Date.now(),
                    level: normalizedLevel,
                    category,
                    code: String(code || 'UNSPECIFIED'),
                    message: String(message || ''),
                    userMessage: String(extra.userMessage || message || ''),
                    phase: extra.phase || null,
                    adapterId: extra.adapterId || sessionMetadata.adapterId || null,
                    runtimeTarget,
                    context: Object.freeze(redactValue(context || {})),
                    error: sanitizeError(error)
                });
                events.push(event);
                preserveBoundedHistory();
                for (const listener of listeners) listener(event);
                return event;
            }

            function activityEvents() {
                return events.filter(event => event.level !== 'debug');
            }

            function copyableActivityText() {
                return activityEvents().map(event => {
                    const time = event.timestamp.slice(11, 19);
                    return `[${time}] ${event.userMessage}${event.level === 'error' ? ` Code: ${event.code}` : ''}`;
                }).join('\n');
            }

            function groupedErrors() {
                const counts = new Map();
                for (const event of events) {
                    if (event.level !== 'error') continue;
                    counts.set(event.code, (counts.get(event.code) || 0) + 1);
                }
                return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
            }

            function markdownValue(value) {
                if (value == null || value === '') return 'n/a';
                return String(value).replace(/\r?\n/g, ' ');
            }

            function exportMarkdown(exportOptions = {}) {
                const metrics = redactValue(exportOptions.metrics || {});
                const config = redactValue(exportOptions.configuration || {});
                const environment = {
                    appVersion,
                    runtimeTarget,
                    adapterId: sessionMetadata.adapterId || 'unknown',
                    pageType: sessionMetadata.pageType || 'unknown',
                    sessionId: sessionId || 'none',
                    startedAt: sessionMetadata.startedAt || 'unknown',
                    finishedAt: exportOptions.finishedAt || new Date().toISOString(),
                    ...(redactValue(exportOptions.environment || {}))
                };
                const lines = [
                    '# Media Archiver diagnostic report',
                    '',
                    '## Environment'
                ];
                for (const [key, value] of Object.entries(environment)) {
                    lines.push(`- ${key}: ${markdownValue(value)}`);
                }
                lines.push('', '## Configuration');
                for (const [key, value] of Object.entries(config)) {
                    lines.push(`- ${key}: ${markdownValue(Array.isArray(value) ? value.join(', ') : value)}`);
                }
                lines.push('', '## Final statistics');
                for (const [key, value] of Object.entries(metrics)) {
                    lines.push(`- ${key}: ${markdownValue(value)}`);
                }
                lines.push('', '## Error summary');
                const errors = groupedErrors();
                if (!errors.length) lines.push('- None');
                else for (const [code, count] of errors) lines.push(`- ${code}: ${count}`);

                lines.push('', '## Activity timeline');
                const activity = activityEvents();
                if (!activity.length) lines.push('- No activity events.');
                else for (const event of activity) {
                    lines.push(`- ${event.timestamp} [${event.level.toUpperCase()}] ${event.userMessage} (${event.code})`);
                }

                lines.push('', '## Developer events');
                for (const event of events) {
                    lines.push(`### ${event.timestamp} ${event.level.toUpperCase()} ${event.category.toUpperCase()} ${event.code}`);
                    lines.push('', event.message || 'No message.', '');
                    if (Object.keys(event.context).length) {
                        lines.push('```json', JSON.stringify(event.context, null, 2), '```', '');
                    }
                    if (event.error) {
                        lines.push('```json', JSON.stringify(event.error, null, 2), '```', '');
                    }
                }
                lines.push(
                    '## Redaction notice',
                    '',
                    'Sensitive URL parameters, credentials, private content, source labels, local paths, and unnecessary extension identifiers are redacted by default.',
                    ''
                );
                return lines.join('\n');
            }

            const api = {
                startSession(metadata = {}) {
                    sessionId = metadata.sessionId || `ma-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
                    sessionMetadata = {
                        ...redactValue(metadata),
                        startedAt: metadata.startedAt || new Date().toISOString()
                    };
                    emit('info', 'SESSION_STARTED', 'Session started.', sessionMetadata, null, {
                        category: 'runtime',
                        userMessage: 'Session started.'
                    });
                    return sessionId;
                },
                endSession(summary = {}) {
                    return emit('success', 'SESSION_COMPLETED', 'Session completed.', summary, null, {
                        category: 'runtime',
                        userMessage: 'Session completed.'
                    });
                },
                debug(code, message, context, extra = {}) {
                    return emit('debug', code, message, context, null, extra);
                },
                info(code, message, context, extra = {}) {
                    return emit('info', code, message, context, null, extra);
                },
                success(code, message, context, extra = {}) {
                    return emit('success', code, message, context, null, extra);
                },
                warn(code, message, context, extra = {}) {
                    return emit('warn', code, message, context, null, extra);
                },
                error(code, message, error, context, extra = {}) {
                    return emit('error', code, message, context, error, extra);
                },
                subscribe(listener) {
                    listeners.add(listener);
                    return () => listeners.delete(listener);
                },
                clear() {
                    events.length = 0;
                },
                events(filter = {}) {
                    return events.filter(event =>
                        (!filter.levels || filter.levels.includes(event.level)) &&
                        (!filter.categories || filter.categories.includes(event.category)) &&
                        (!filter.query || `${event.code} ${event.message}`.toLowerCase().includes(String(filter.query).toLowerCase()))
                    );
                },
                activityEvents,
                copyableActivityText,
                exportMarkdown,
                get sessionId() {
                    return sessionId;
                }
            };
            return Object.freeze(api);
        }

        function createLiveMetrics(options = {}) {
            const now = options.now || (() => Date.now());
            const setTimer = options.setTimer || ((callback, interval) => setInterval(callback, interval));
            const clearTimer = options.clearTimer || (handle => clearInterval(handle));
            const heartbeatMs = Math.min(1_000, Math.max(500, Number(options.heartbeatMs) || 750));
            const listeners = new Set();
            let timer = null;
            let dirty = true;
            let version = 0;
            let lastFlushedVersion = -1;
            const state = {
                sessionId: null,
                startedAt: 0,
                elapsedMs: 0,
                phase: 'idle',
                found: 0,
                eligible: 0,
                selected: 0,
                duplicatesMerged: 0,
                downloading: 0,
                downloaded: 0,
                saved: 0,
                skipped: 0,
                errors: 0,
                bytesDownloaded: 0,
                currentZipPart: 0,
                totalZipPartsKnown: 0,
                currentItem: 0,
                totalItems: 0,
                scanIterations: 0,
                lastUpdatedAt: 0
            };

            function snapshot() {
                return Object.freeze({ ...state });
            }

            function notify(force = false) {
                if (!force && !dirty && lastFlushedVersion === version) return snapshot();
                if (state.startedAt) state.elapsedMs = Math.max(0, now() - state.startedAt);
                state.lastUpdatedAt = now();
                dirty = false;
                lastFlushedVersion = version;
                const value = snapshot();
                for (const listener of listeners) listener(value);
                options.onSnapshot?.(value);
                return value;
            }

            function markDirty() {
                dirty = true;
                version++;
            }

            function update(patch = {}) {
                let changed = false;
                for (const [key, value] of Object.entries(patch)) {
                    if (!(key in state) || state[key] === value) continue;
                    state[key] = value;
                    changed = true;
                }
                if (changed) markDirty();
                return changed;
            }

            function record(field, delta = 1) {
                if (!(field in state)) throw new TypeError(`Unknown live metric: ${field}`);
                state[field] = Math.max(0, (Number(state[field]) || 0) + Number(delta || 0));
                markDirty();
                return state[field];
            }

            function startTimer() {
                if (!timer) timer = setTimer(() => notify(false), heartbeatMs);
            }

            return Object.freeze({
                startSession(metadata = {}) {
                    if (timer) clearTimer(timer);
                    Object.assign(state, {
                        sessionId: metadata.sessionId || `ma-${now().toString(36)}`,
                        startedAt: now(),
                        elapsedMs: 0,
                        phase: metadata.phase || 'scanning',
                        found: 0,
                        eligible: 0,
                        selected: 0,
                        duplicatesMerged: 0,
                        downloading: 0,
                        downloaded: 0,
                        saved: 0,
                        skipped: 0,
                        errors: 0,
                        bytesDownloaded: 0,
                        currentZipPart: 0,
                        totalZipPartsKnown: 0,
                        currentItem: 0,
                        totalItems: 0,
                        scanIterations: 0,
                        lastUpdatedAt: now()
                    });
                    markDirty();
                    startTimer();
                    return notify(true);
                },
                update,
                record,
                markDirty,
                setPhase(phase) {
                    update({ phase });
                },
                flushNow() {
                    return notify(true);
                },
                stopSession(finalPatch = {}) {
                    update(finalPatch);
                    const finalSnapshot = notify(true);
                    if (timer) clearTimer(timer);
                    timer = null;
                    return finalSnapshot;
                },
                handleVisibilityChange(isVisible) {
                    return isVisible ? notify(true) : snapshot();
                },
                subscribe(listener) {
                    listeners.add(listener);
                    return () => listeners.delete(listener);
                },
                snapshot,
                get heartbeatMs() {
                    return heartbeatMs;
                },
                get active() {
                    return Boolean(timer);
                },
                get version() {
                    return version;
                }
            });
        }

        const api = Object.freeze({
            ERROR_CODES,
            redactValue,
            sanitizeUrl,
            createDiagnosticsStore,
            createLiveMetrics
        });

        Object.defineProperty(globalThis, 'MediaArchiverDiagnostics', {
            value: api,
            configurable: true,
            writable: false
        });
    })();

    (() => {
        const API_ROOT = 'https://www.virustotal.com/api/v3';
        const DIRECT_UPLOAD_MAX_BYTES = 32 * 1024 * 1024;
        const MAX_UPLOAD_BYTES = 650 * 1024 * 1024;
        const PUBLIC_API_INTERVAL_MS = 15_500;

        function serviceError(code, message, details = {}) {
            const error = new Error(message);
            error.code = code;
            Object.assign(error, details);
            return error;
        }

        function byteView(input) {
            if (input instanceof Uint8Array) return input;
            if (input instanceof ArrayBuffer) return new Uint8Array(input);
            if (ArrayBuffer.isView(input)) {
                return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
            }
            throw serviceError('VIRUSTOTAL_INVALID_BYTES', 'VirusTotal requires binary file data.');
        }

        async function sha256Hex(input, cryptoImplementation = globalThis.crypto) {
            const bytes = byteView(input);
            if (!cryptoImplementation?.subtle?.digest) {
                throw serviceError('VIRUSTOTAL_HASH_UNAVAILABLE', 'SHA-256 is unavailable in this browser context.');
            }
            const digest = await cryptoImplementation.subtle.digest(
                'SHA-256',
                bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
            );
            return [...new Uint8Array(digest)]
                .map(value => value.toString(16).padStart(2, '0'))
                .join('');
        }

        function analysisStats(payload) {
            const attributes = payload?.data?.attributes || {};
            const source = attributes.last_analysis_stats || attributes.stats || {};
            return Object.freeze({
                malicious: Number(source.malicious) || 0,
                suspicious: Number(source.suspicious) || 0,
                harmless: Number(source.harmless) || 0,
                undetected: Number(source.undetected) || 0,
                timeout: Number(source.timeout) || 0,
                failure: Number(source.failure) || 0,
                typeUnsupported: Number(source['type-unsupported']) || 0
            });
        }

        function resultFromPayload(payload, sha256, extras = {}) {
            const stats = analysisStats(payload);
            const verdict = stats.malicious > 0
                ? 'malicious'
                : stats.suspicious > 0
                    ? 'suspicious'
                    : (stats.harmless + stats.undetected) > 0
                        ? 'clean'
                        : 'unknown';
            return Object.freeze({
                provider: 'virustotal',
                sha256,
                verdict,
                stats,
                known: verdict !== 'unknown',
                uploaded: Boolean(extras.uploaded),
                reportUrl: `https://www.virustotal.com/gui/file/${sha256}`,
                checkedAt: new Date().toISOString()
            });
        }

        function unknownResult(sha256, extras = {}) {
            return Object.freeze({
                provider: 'virustotal',
                sha256,
                verdict: 'unknown',
                stats: Object.freeze({
                    malicious: 0,
                    suspicious: 0,
                    harmless: 0,
                    undetected: 0,
                    timeout: 0,
                    failure: 0,
                    typeUnsupported: 0
                }),
                known: false,
                uploaded: Boolean(extras.uploaded),
                reportUrl: `https://www.virustotal.com/gui/file/${sha256}`,
                checkedAt: new Date().toISOString()
            });
        }

        function shouldBlock(result, settings = {}) {
            if (!result || result.verdict === 'error') {
                return settings.unknownPolicy === 'block';
            }
            if (result.verdict === 'malicious') return true;
            if (result.verdict === 'suspicious') {
                return settings.blockThreshold === 'suspicious';
            }
            if (result.verdict === 'unknown') {
                return settings.unknownPolicy === 'block';
            }
            return false;
        }

        function createService(runtime, options = {}) {
            if (typeof runtime?.requestExternal !== 'function') {
                throw serviceError(
                    'VIRUSTOTAL_RUNTIME_UNAVAILABLE',
                    'The active runtime cannot contact VirusTotal.'
                );
            }

            const minimumIntervalMs = Number.isFinite(options.minimumIntervalMs)
                ? Math.max(0, options.minimumIntervalMs)
                : PUBLIC_API_INTERVAL_MS;
            const sleepImplementation = options.sleep || (milliseconds =>
                new Promise(resolve => setTimeout(resolve, milliseconds))
            );
            const now = options.now || (() => Date.now());
            const cryptoImplementation = options.crypto || globalThis.crypto;
            const cache = new Map();
            let requestQueue = Promise.resolve();
            let lastRequestAt = 0;

            function queuedRequest(url, requestOptions) {
                const execute = async () => {
                    const remaining = minimumIntervalMs - (now() - lastRequestAt);
                    if (remaining > 0) await sleepImplementation(remaining);
                    try {
                        return await runtime.requestExternal(url, requestOptions);
                    } finally {
                        lastRequestAt = now();
                    }
                };
                const result = requestQueue.then(execute, execute);
                requestQueue = result.catch(() => undefined);
                return result;
            }

            async function requestJson(url, requestOptions = {}, acceptedStatuses = []) {
                const response = await queuedRequest(url, requestOptions);
                if (!response || typeof response.status !== 'number') {
                    throw serviceError('VIRUSTOTAL_RESPONSE_INVALID', 'VirusTotal returned an invalid response.');
                }
                if (!response.ok && !acceptedStatuses.includes(response.status)) {
                    const code = response.status === 401 || response.status === 403
                        ? 'VIRUSTOTAL_API_KEY_REJECTED'
                        : response.status === 429
                            ? 'VIRUSTOTAL_RATE_LIMITED'
                            : response.status >= 500
                                ? 'VIRUSTOTAL_SERVICE_UNAVAILABLE'
                                : 'VIRUSTOTAL_REQUEST_FAILED';
                    throw serviceError(code, `VirusTotal request failed with HTTP ${response.status}.`, {
                        status: response.status,
                        retryable: response.status === 429 || response.status >= 500
                    });
                }
                return response;
            }

            function apiHeaders(apiKey) {
                return {
                    Accept: 'application/json',
                    'x-apikey': apiKey
                };
            }

            async function lookupFile(sha256, apiKey) {
                const response = await requestJson(
                    `${API_ROOT}/files/${encodeURIComponent(sha256)}`,
                    {
                        method: 'GET',
                        headers: apiHeaders(apiKey),
                        timeoutMs: 120_000
                    },
                    [404]
                );
                if (response.status === 404) return null;
                return resultFromPayload(response.body, sha256);
            }

            async function uploadFile(bytes, filename, apiKey) {
                if (bytes.byteLength > MAX_UPLOAD_BYTES) {
                    throw serviceError(
                        'VIRUSTOTAL_FILE_TOO_LARGE',
                        'VirusTotal uploads are limited to 650 MB.',
                        { sizeBytes: bytes.byteLength, maximumBytes: MAX_UPLOAD_BYTES }
                    );
                }

                let uploadUrl = `${API_ROOT}/files`;
                if (bytes.byteLength > DIRECT_UPLOAD_MAX_BYTES) {
                    const uploadUrlResponse = await requestJson(
                        `${API_ROOT}/files/upload_url`,
                        {
                            method: 'GET',
                            headers: apiHeaders(apiKey),
                            timeoutMs: 120_000
                        }
                    );
                    uploadUrl = uploadUrlResponse.body?.data;
                    try {
                        const parsed = new URL(uploadUrl);
                        if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.virustotal.com')) {
                            throw new Error('Unexpected upload host');
                        }
                    } catch {
                        throw serviceError(
                            'VIRUSTOTAL_UPLOAD_URL_INVALID',
                            'VirusTotal returned an invalid large-file upload URL.'
                        );
                    }
                }

                const response = await requestJson(uploadUrl, {
                    method: 'POST',
                    headers: apiHeaders(apiKey),
                    multipartFile: {
                        fieldName: 'file',
                        filename: String(filename || 'media-file'),
                        mimeType: 'application/octet-stream',
                        bytes
                    },
                    timeoutMs: 10 * 60_000
                });
                const analysisId = response.body?.data?.id;
                if (!analysisId) {
                    throw serviceError(
                        'VIRUSTOTAL_ANALYSIS_ID_MISSING',
                        'VirusTotal accepted the upload but returned no analysis identifier.'
                    );
                }
                return analysisId;
            }

            async function waitForAnalysis(analysisId, apiKey) {
                const maximumPolls = Number.isFinite(options.maximumPolls)
                    ? Math.max(1, options.maximumPolls)
                    : 40;
                for (let poll = 0; poll < maximumPolls; poll++) {
                    const response = await requestJson(
                        `${API_ROOT}/analyses/${encodeURIComponent(analysisId)}`,
                        {
                            method: 'GET',
                            headers: apiHeaders(apiKey),
                            timeoutMs: 120_000
                        }
                    );
                    if (response.body?.data?.attributes?.status === 'completed') {
                        return response.body;
                    }
                    if (minimumIntervalMs === 0) {
                        await sleepImplementation(Number(options.pollIntervalMs) || 0);
                    }
                }
                throw serviceError(
                    'VIRUSTOTAL_ANALYSIS_TIMEOUT',
                    'VirusTotal analysis did not finish within the allowed polling window.',
                    { retryable: true }
                );
            }

            async function scanBytes(input, filename, settings = {}) {
                const mode = settings.mode || 'off';
                if (mode === 'off') {
                    return Object.freeze({
                        provider: 'virustotal',
                        verdict: 'skipped',
                        known: false,
                        uploaded: false,
                        stats: null,
                        reportUrl: null,
                        checkedAt: new Date().toISOString()
                    });
                }

                const apiKey = String(settings.apiKey || '').trim();
                if (!apiKey) {
                    throw serviceError(
                        'VIRUSTOTAL_API_KEY_MISSING',
                        'Add a VirusTotal API key before enabling scans.'
                    );
                }
                const bytes = byteView(input);
                const sha256 = await sha256Hex(bytes, cryptoImplementation);
                const cached = cache.get(sha256);
                if (cached && (cached.known || mode === 'hash-only')) return cached;

                const known = await lookupFile(sha256, apiKey);
                if (known) {
                    cache.set(sha256, known);
                    return known;
                }
                if (mode === 'hash-only') {
                    const result = unknownResult(sha256);
                    cache.set(sha256, result);
                    return result;
                }
                if (mode !== 'upload-unknown') {
                    throw serviceError('VIRUSTOTAL_MODE_INVALID', 'Unknown VirusTotal scan mode.');
                }
                if (settings.uploadConsent !== true) {
                    throw serviceError(
                        'VIRUSTOTAL_UPLOAD_CONSENT_REQUIRED',
                        'Confirm VirusTotal file sharing before uploading unknown files.'
                    );
                }

                const analysisId = await uploadFile(bytes, filename, apiKey);
                const analysisPayload = await waitForAnalysis(analysisId, apiKey);
                const refreshed = await lookupFile(sha256, apiKey);
                const result = refreshed || resultFromPayload(analysisPayload, sha256, { uploaded: true });
                const uploadedResult = Object.freeze({ ...result, uploaded: true });
                cache.set(sha256, uploadedResult);
                return uploadedResult;
            }

            return Object.freeze({
                scanBytes,
                lookupFile,
                shouldBlock,
                clearCache() {
                    cache.clear();
                }
            });
        }

        Object.defineProperty(globalThis, 'MediaArchiverVirusTotal', {
            value: Object.freeze({
                API_ROOT,
                DIRECT_UPLOAD_MAX_BYTES,
                MAX_UPLOAD_BYTES,
                PUBLIC_API_INTERVAL_MS,
                sha256Hex,
                analysisStats,
                shouldBlock,
                createService
            }),
            configurable: true,
            writable: false
        });
    })();

    const selectionStore = globalThis.MediaArchiverSelection.createSelectionStore({
        isEligible(item) {
            return item?.canonical !== false && item?.eligibility?.adapter !== false;
        }
    });

    const diagnostics = globalThis.MediaArchiverDiagnostics.createDiagnosticsStore({
        runtimeTarget: 'userscript',
        appVersion: VERSION,
        limit: 2_000
    });

    const liveMetrics = globalThis.MediaArchiverDiagnostics.createLiveMetrics({
        heartbeatMs: 750,
        onSnapshot(snapshot) {
            if (typeof refreshLiveMetrics === 'function') {
                refreshLiveMetrics(snapshot);
            }
        }
    });

    const workflowState = globalThis.MediaArchiverWorkflowState
        .createWorkflowStateMachine({ mode: 'quick' });

    function ensureSelectionForEntries(entries = [...archiveItems.values()]) {
        selectionStore.ensureItems(entries);
        selectionStore.syncItems(entries);
        return entries;
    }

    function recordCanonicalDuplicate(entry, reason = 'canonical-key') {
        entry.duplicateCount = (entry.duplicateCount || 0) + 1;
        liveMetrics.record('duplicatesMerged', 1);
        diagnostics.debug(
            'ADAPTER_DUPLICATE_MERGED',
            'Repeated rendered representation merged into one canonical item.',
            {
                itemKey: entry.key,
                reason,
                duplicateCount: entry.duplicateCount
            },
            { category: 'adapter', adapterId: entry.adapterId || activeSiteAdapter?.id }
        );
    }

    const userscriptSettingsFallback = new Map();
    const userscriptPendingRequests = new Map();
    let userscriptRequestSequence = 0;

    function runtimeNetworkError(message, details = {}) {
        const error = new Error(message);
        Object.assign(error, details);
        return error;
    }

    function isAllowedVirusTotalUrl(rawUrl) {
        try {
            const url = new URL(rawUrl);
            return url.protocol === 'https:' &&
                (url.hostname === 'www.virustotal.com' || url.hostname.endsWith('.virustotal.com'));
        } catch {
            return false;
        }
    }

    function parseExternalResponseBody(responseText) {
        const text = String(responseText || '');
        if (!text) return null;
        try {
            return JSON.parse(text);
        } catch {
            return { text };
        }
    }

    const userscriptRuntimeImplementation = {
        fetchBinary(url, options = {}) {
            if (!activeSiteAdapter?.isDownloadUrlAllowed(url)) {
                return Promise.reject(runtimeNetworkError(
                    'The active site adapter blocked this download URL.',
                    { code: 'NETWORK_HOST_REJECTED', retryable: false }
                ));
            }

            if (stopRequested) {
                return Promise.reject(runtimeNetworkError(
                    'Stopped by user',
                    { code: 'NETWORK_ABORTED', retryable: false }
                ));
            }

            const requestId = options.requestId || `userscript-${++userscriptRequestSequence}`;
            return new Promise((resolve, reject) => {
                let requestHandle;
                const finish = callback => value => {
                    userscriptPendingRequests.delete(requestId);
                    callback(value);
                };

                requestHandle = GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    responseType: 'arraybuffer',
                    timeout: options.timeoutMs || 120_000,
                    anonymous: true,
                    headers: {
                        Accept: options.accept || 'video/*,image/*,*/*;q=0.8'
                    },
                    onload: finish(response => {
                        if (
                            response.status >= 200 &&
                            response.status < 300 &&
                            response.response
                        ) {
                            resolve(response.response);
                            return;
                        }

                        const status = response.status || 0;
                        const code = status === 403
                            ? 'NETWORK_HTTP_403'
                            : status === 404
                                ? 'NETWORK_HTTP_404'
                                : status === 429
                                    ? 'NETWORK_HTTP_429'
                                    : status >= 500
                                        ? 'NETWORK_HTTP_5XX'
                                        : 'NETWORK_RETRY_EXHAUSTED';
                        reject(runtimeNetworkError(`HTTP ${status || 'unknown'}`, {
                            code,
                            status,
                            retryable: status === 0 || status === 429 || status >= 500,
                            requestId
                        }));
                    }),
                    onerror: finish(() => reject(runtimeNetworkError('Network error', {
                        code: 'NETWORK_RETRY_EXHAUSTED',
                        retryable: true,
                        requestId
                    }))),
                    ontimeout: finish(() => reject(runtimeNetworkError('Request timed out', {
                        code: 'NETWORK_TIMEOUT',
                        retryable: true,
                        requestId
                    }))),
                    onabort: finish(() => reject(runtimeNetworkError('Request aborted', {
                        code: 'NETWORK_ABORTED',
                        retryable: false,
                        requestId
                    })))
                });

                userscriptPendingRequests.set(requestId, requestHandle);
            });
        },
        requestExternal(url, options = {}) {
            if (!isAllowedVirusTotalUrl(url)) {
                return Promise.reject(runtimeNetworkError(
                    'The runtime blocked this external service URL.',
                    { code: 'RUNTIME_EXTERNAL_HOST_REJECTED', retryable: false }
                ));
            }

            const requestId = options.requestId || `external-${++userscriptRequestSequence}`;
            let data = options.body;
            if (options.multipartFile) {
                const file = options.multipartFile;
                const bytes = file.bytes instanceof Uint8Array
                    ? file.bytes
                    : new Uint8Array(file.bytes);
                const form = new FormData();
                form.append(
                    file.fieldName || 'file',
                    new Blob([bytes], { type: file.mimeType || 'application/octet-stream' }),
                    file.filename || 'media-file'
                );
                data = form;
            }

            return new Promise((resolve, reject) => {
                let requestHandle;
                const finish = callback => value => {
                    userscriptPendingRequests.delete(requestId);
                    callback(value);
                };
                requestHandle = GM_xmlhttpRequest({
                    method: options.method || 'GET',
                    url,
                    headers: options.headers || {},
                    data,
                    responseType: 'text',
                    timeout: options.timeoutMs || 120_000,
                    anonymous: true,
                    onload: finish(response => resolve({
                        ok: response.status >= 200 && response.status < 300,
                        status: response.status || 0,
                        body: parseExternalResponseBody(response.responseText || response.response),
                        responseHeaders: response.responseHeaders || ''
                    })),
                    onerror: finish(() => reject(runtimeNetworkError(
                        'External service request failed.',
                        { code: 'RUNTIME_EXTERNAL_REQUEST_FAILED', retryable: true }
                    ))),
                    ontimeout: finish(() => reject(runtimeNetworkError(
                        'External service request timed out.',
                        { code: 'RUNTIME_EXTERNAL_TIMEOUT', retryable: true }
                    ))),
                    onabort: finish(() => reject(runtimeNetworkError(
                        'External service request was aborted.',
                        { code: 'NETWORK_ABORTED', retryable: false }
                    )))
                });
                userscriptPendingRequests.set(requestId, requestHandle);
            });
        },
        abortRequest(requestId) {
            const handle = userscriptPendingRequests.get(requestId);
            if (!handle) return false;
            try {
                handle.abort();
            } finally {
                userscriptPendingRequests.delete(requestId);
            }
            return true;
        },
        abortAllRequests() {
            for (const requestId of [...userscriptPendingRequests.keys()]) {
                this.abortRequest(requestId);
            }
        },
        async saveBlob(blob, filename) {
            const blobUrl = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = blobUrl;
            anchor.download = filename;
            anchor.style.display = 'none';
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => URL.revokeObjectURL(blobUrl), 120_000);
            return filename;
        },
        async copyText(text) {
            const value = String(text ?? '');
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(value);
                return true;
            }

            const textarea = document.createElement('textarea');
            textarea.value = value;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            const copied = document.execCommand?.('copy') === true;
            textarea.remove();
            if (!copied) {
                const error = new Error('Clipboard access failed.');
                error.code = 'RUNTIME_CLIPBOARD_FAILED';
                throw error;
            }
            return true;
        },
        async getSetting(key, fallback) {
            try {
                if (typeof GM_getValue === 'function') {
                    return await GM_getValue(key, fallback);
                }
            } catch {
                // Use the bounded in-memory compatibility fallback.
            }
            return userscriptSettingsFallback.has(key)
                ? userscriptSettingsFallback.get(key)
                : fallback;
        },
        async setSetting(key, value) {
            try {
                if (typeof GM_setValue === 'function') {
                    await GM_setValue(key, value);
                    return value;
                }
            } catch {
                // Use the bounded in-memory compatibility fallback.
            }
            userscriptSettingsFallback.set(key, value);
            return value;
        },
        getPlatformInfo() {
            return Object.freeze({
                runtimeTarget: 'userscript',
                browserPlatform: navigator.userAgentData?.platform || navigator.platform || 'unknown',
                language: navigator.language || 'unknown'
            });
        },
        openUi() {
            const library = document.getElementById('ma-library-dialog');
            if (library && typeof openLibrary === 'function') openLibrary();
            else document.getElementById('media-archiver-panel')?.classList.remove('ma-collapsed');
        },
        closeUi() {
            if (typeof closeLibrary === 'function') closeLibrary();
            else document.getElementById('media-archiver-panel')?.classList.add('ma-collapsed');
        }
    };

    const runtime = globalThis.MediaArchiverRuntimeContract
        .createRuntimeFacade(userscriptRuntimeImplementation);

    const DISCORD_EPOCH_MS = 1420070400000;

    function createDiscordAdapter() {
        const downloadHosts = new Set([
            'cdn.discordapp.com',
            'media.discordapp.net',
            'images-ext-1.discordapp.net',
            'images-ext-2.discordapp.net'
        ]);

        return {
            id: 'discord',
            label: 'Discord',
            archivePrefix: 'discord',
            preferredScanMode: 'current-to-oldest',
            boundaryConfirmMs: 20_000,
            capabilities: {
                media: true,
                textRecords: false,
                virtualTimeline: true,
                dateFilter: true,
                hostPageSelection: false,
                scanModes: [
                    'current-to-oldest',
                    'current-to-newest'
                ],
                views: ['grid', 'list']
            },
            terms: Object.freeze({
                timeline: 'channel or thread',
                item: 'message',
                items: 'messages',
                oldest: 'oldest-message boundary',
                newest: 'newest-message boundary'
            }),
            matches(currentLocation) {
                return [
                    'discord.com',
                    'ptb.discord.com',
                    'canary.discord.com'
                ].includes(currentLocation.hostname) &&
                    currentLocation.pathname.startsWith('/channels/');
            },
            scanVisibleMedia: scanDiscordVisibleMedia,
            jumpScanWindow: discordJumpScanWindow,
            findScroller: findDiscordScroller,
            findScrollerCandidates: findDiscordScrollerCandidates,
            visibleItemIds: discordVisibleItemIds,
            visibleItemTimeRange: discordVisibleItemTimeRange,
            findItemElementById: findDiscordItemElementById,
            captureStartingAnchor: captureDiscordStartingAnchor,
            findItemId: findDiscordItemId,
            findItemTimestamp: findDiscordItemTimestamp,
            timestampFromItemId: discordTimestampFromSnowflake,
            compareItemIds(left, right) {
                if (!left || !right) return 0;
                try {
                    const a = BigInt(left);
                    const b = BigInt(right);
                    return a === b ? 0 : a < b ? -1 : 1;
                } catch {
                    return String(left).localeCompare(String(right));
                }
            },
            getArchiveContext() {
                const id =
                    location.pathname.match(
                        /\/channels\/(?:@me|\d+)\/(\d+)/
                    )?.[1] ||
                    'timeline';

                return { id, label: 'channel' };
            },
            isDownloadUrlAllowed(rawUrl) {
                try {
                    return downloadHosts.has(
                        new URL(rawUrl, location.href).hostname
                    );
                } catch {
                    return false;
                }
            },
            openTargetHelp: 'Open a text channel or thread first.'
        };
    }

    // Only direct Discord attachment hosts are accepted. External embeds
    // and links such as YouTube, Vimeo, Twitch, TikTok, or normal websites
    // are intentionally ignored.
    function isDiscordAttachmentUrl(rawUrl, sourceElement = null) {
        if (!rawUrl) return false;

        try {
            const url = new URL(rawUrl, location.href);
            const validHost =
                url.hostname === 'cdn.discordapp.com' ||
                url.hostname === 'media.discordapp.net';

            if (!validHost || !url.pathname.includes('/attachments/')) {
                return false;
            }

            const extension = extensionFromPath(url.pathname);
            if (MEDIA_EXTENSIONS.has(extension)) return true;

            // Accept uncommon Discord-hosted video attachments when Discord
            // itself renders them in a video player.
            const tagName = sourceElement?.tagName?.toUpperCase?.() || '';
            return (
                tagName === 'VIDEO' ||
                tagName === 'SOURCE' ||
                Boolean(sourceElement?.closest?.('video'))
            );
        } catch {
            return false;
        }
    }

    function mediaTypeFromUrl(rawUrl, sourceElement = null) {
        try {
            const extension = extensionFromPath(
                new URL(rawUrl, location.href).pathname
            );

            if (VIDEO_EXTENSIONS.has(extension)) return 'video';
            if (IMAGE_EXTENSIONS.has(extension)) return 'photo';

            const tagName = sourceElement?.tagName?.toUpperCase?.() || '';
            if (
                tagName === 'VIDEO' ||
                tagName === 'SOURCE' ||
                sourceElement?.closest?.('video')
            ) {
                return 'video';
            }

            return 'photo';
        } catch {
            return 'photo';
        }
    }

    function isDiscordExternalProxyUrl(rawUrl) {
        if (!rawUrl) return false;

        try {
            const url = new URL(rawUrl, location.href);
            const validHost =
                url.hostname === 'images-ext-1.discordapp.net' ||
                url.hostname === 'images-ext-2.discordapp.net';

            if (!validHost || !url.pathname.startsWith('/external/')) {
                return false;
            }

            return MEDIA_EXTENSIONS.has(
                extensionFromPath(url.pathname)
            );
        } catch {
            return false;
        }
    }

    function hasGifAriaLabel(element) {
        let current = element;

        for (
            let depth = 0;
            current && depth < 8;
            depth++, current = current.parentElement
        ) {
            const label = current.getAttribute?.('aria-label') || '';
            if (/\bgif\b/i.test(label)) return true;
        }

        return false;
    }

    function isKnownGifPageUrl(rawUrl) {
        if (!rawUrl) return false;

        try {
            const url = new URL(rawUrl, location.href);
            const host = url.hostname.toLowerCase();
            const path = url.pathname.toLowerCase();

            return (
                (host === 'klipy.com' || host.endsWith('.klipy.com')) &&
                path.startsWith('/gifs/')
            ) || (
                (host === 'tenor.com' || host.endsWith('.tenor.com')) &&
                (path.includes('/view/') || path.includes('/search/'))
            ) || (
                (host === 'giphy.com' || host.endsWith('.giphy.com')) &&
                path.includes('/gifs/')
            );
        } catch {
            return false;
        }
    }

    function findGifEmbedWrapper(element) {
        let current = element;

        for (
            let depth = 0;
            current && depth < 10;
            depth++, current = current.parentElement
        ) {
            if (
                current.querySelector?.('[aria-label="GIF"]') ||
                current.querySelector?.('video[aria-label*="GIF" i]') ||
                current.querySelector?.('a[data-role="img"][data-safe-src]')
            ) {
                return current;
            }
        }

        return findDiscordItemContainer(element);
    }

    function findExternalGifPageUrl(element) {
        const wrapper = findGifEmbedWrapper(element);

        const candidates = [
            element?.matches?.('a[href]') ? element.href : null,
            element?.closest?.('a[href]')?.href,
            wrapper?.querySelector?.('a[data-role="img"][href]')?.href,
            wrapper?.querySelector?.('a[href*="klipy.com/gifs/"]')?.href,
            wrapper?.querySelector?.('a[href*="tenor.com/"]')?.href,
            wrapper?.querySelector?.('a[href*="giphy.com/gifs/"]')?.href
        ].filter(Boolean);

        return (
            candidates.find(isKnownGifPageUrl) ||
            candidates.find(value => {
                try {
                    const url = new URL(value, location.href);
                    return ![
                        'discord.com',
                        'cdn.discordapp.com',
                        'media.discordapp.net',
                        'images-ext-1.discordapp.net',
                        'images-ext-2.discordapp.net'
                    ].includes(url.hostname);
                } catch {
                    return false;
                }
            }) ||
            null
        );
    }

    function isExternalGifEmbedContext(element) {
        if (!element) return false;
        if (hasGifAriaLabel(element)) return true;

        const wrapper = findGifEmbedWrapper(element);

        if (
            wrapper?.querySelector?.('[aria-label="GIF"]') ||
            wrapper?.querySelector?.('video[aria-label*="GIF" i]')
        ) {
            return true;
        }

        return isKnownGifPageUrl(
            findExternalGifPageUrl(element)
        );
    }

    function externalGifProxyCandidates(element) {
        const wrapper = findGifEmbedWrapper(element);
        const gifVideo =
            wrapper?.querySelector?.('video[aria-label*="GIF" i]') ||
            wrapper?.querySelector?.('[aria-label="GIF"] video');
        const gifSource =
            wrapper?.querySelector?.('[aria-label="GIF"] source[src]');

        const candidates = [
            element?.getAttribute?.('data-safe-src'),
            element?.dataset?.safeSrc,
            element?.currentSrc,
            element?.src,
            element?.getAttribute?.('src'),
            wrapper?.querySelector?.(
                'a[data-role="img"][data-safe-src]'
            )?.getAttribute('data-safe-src'),
            gifVideo?.currentSrc,
            gifVideo?.src,
            gifSource?.src
        ].filter(Boolean);

        return [...new Set(candidates)]
            .filter(isDiscordExternalProxyUrl);
    }

    function normalizeDiscordAttachmentUrl(rawUrl) {
        const url = new URL(rawUrl, location.href);

        // media.discordapp.net often serves a scaled preview.
        // The same attachment path on cdn.discordapp.com is the original file.
        if (url.hostname === 'media.discordapp.net') {
            url.hostname = 'cdn.discordapp.com';
        }

        // Temporary signature parameters ex/is/hm are preserved.
        // Only preview, size, and conversion parameters are removed.
        for (const parameter of [
            'width', 'height', 'size', 'quality', 'format',
            'animated', 'passthrough'
        ]) {
            url.searchParams.delete(parameter);
        }

        // Discord occasionally appends an empty parameter: "&="
        for (const [key] of [...url.searchParams.entries()]) {
            if (!key) url.searchParams.delete(key);
        }

        return url.href;
    }

    function urlQualityScore(rawUrl) {
        try {
            const url = new URL(rawUrl, location.href);
            let score = 0;
            if (url.hostname === 'cdn.discordapp.com') score += 100;
            if (!url.searchParams.has('width')) score += 20;
            if (!url.searchParams.has('height')) score += 20;
            if (!url.searchParams.has('format')) score += 10;
            return score;
        } catch {
            return 0;
        }
    }

    function canonicalKey(rawUrl) {
        const url = new URL(rawUrl, location.href);
        const normalizedHost =
            url.hostname === 'images-ext-1.discordapp.net' ||
            url.hostname === 'images-ext-2.discordapp.net'
                ? 'images-ext.discordapp.net'
                : url.hostname.toLowerCase();

        return `${normalizedHost}${url.pathname}`.toLowerCase();
    }

    function filenameFromUrl(rawUrl) {
        try {
            const url = new URL(rawUrl, location.href);
            return sanitizeFilename(
                decodeURIComponent(url.pathname.split('/').pop() || 'bild.jpg')
            );
        } catch {
            return 'bild.jpg';
        }
    }

    function findDiscordItemContainer(element) {
        return element.closest?.(
            'li[id*="chat-messages"], div[id*="chat-messages"], ' +
            '[data-list-item-id*="chat-messages"], article'
        ) || null;
    }

    function findDiscordItemId(element) {
        let current = findDiscordItemContainer(element) || element;

        for (let depth = 0; current && depth < 14; depth++, current = current.parentElement) {
            const values = [
                current.id,
                current.getAttribute?.('data-list-item-id'),
                current.getAttribute?.('aria-labelledby')
            ].filter(Boolean);

            for (const value of values) {
                const matches = String(value).match(/\d{16,22}/g);
                if (matches?.length) {
                    return matches[matches.length - 1];
                }
            }
        }

        return null;
    }

    function discordTimestampFromSnowflake(itemId) {
        if (!itemId) return null;

        try {
            const milliseconds =
                Number((BigInt(itemId) >> 22n) + BigInt(DISCORD_EPOCH_MS));

            if (!Number.isFinite(milliseconds)) return null;
            return new Date(milliseconds).toISOString();
        } catch {
            return null;
        }
    }

    function findDiscordItemTimestamp(element) {
        const container = findDiscordItemContainer(element);
        const itemId = findDiscordItemId(element);

        if (itemId) {
            const exactTime = document.getElementById(
                `message-timestamp-${itemId}`
            );

            if (
                exactTime?.matches?.('time[datetime]') &&
                (!container || container.contains(exactTime))
            ) {
                return exactTime.getAttribute('datetime');
            }
        }

        const time = container?.querySelector?.(
            'time[id^="message-timestamp-"][datetime], time[datetime]'
        );

        return (
            time?.getAttribute('datetime') ||
            timestampFromItemId(itemId)
        );
    }

    function createDiscordMediaItem({
        key,
        url,
        previewUrl,
        filename,
        mediaType,
        sourceKind,
        sourcePageUrl,
        sourceElement
    }) {
        const itemId = findItemId(sourceElement);
        const timestamp = findItemTimestamp(sourceElement);
        return {
            key,
            kind: 'media',
            adapterId: 'discord',
            canonical: true,
            canonicalKey: key,
            duplicateCount: 0,
            eligibility: {
                adapter: true,
                type: true,
                date: true
            },
            manuallySelected: true,
            url,
            previewUrl,
            filename,
            mediaType,
            sourceKind,
            sourcePageUrl,
            itemId,
            sourceId: itemId,
            timestamp,
            firstSeen: firstSeenCounter++,
            discoveryIndex: firstSeenCounter - 1,
            status: STATUS.COLLECTED,
            error: '',
            size: 0,
            payload: {
                url,
                previewUrl,
                filename,
                originalFilename: filename,
                mediaType,
                sourceKind,
                sourcePageUrl,
                itemId
            }
        };
    }

    function addOrUpdateMediaEntry(rawUrl, sourceElement) {
        if (!shouldCollectRenderedItem(sourceElement)) return false;
        if (!isDiscordAttachmentUrl(rawUrl, sourceElement)) return false;

        const originalUrl = normalizeDiscordAttachmentUrl(rawUrl);
        const key = canonicalKey(originalUrl);
        const existing = mediaEntries.get(key);

        if (existing) {
            recordCanonicalDuplicate(existing, 'discord-attachment-canonical-url');
            if (urlQualityScore(originalUrl) > urlQualityScore(existing.url)) {
                existing.url = originalUrl;
                existing.payload.url = originalUrl;
            }

            if (new URL(originalUrl).searchParams.has('ex')) {
                existing.url = originalUrl;
                existing.payload.url = originalUrl;
            }

            if (!existing.itemId) {
                existing.itemId = findItemId(sourceElement);
                existing.sourceId = existing.itemId;
                existing.payload.itemId = existing.itemId;
            }
            if (!existing.timestamp) existing.timestamp = findItemTimestamp(sourceElement);
            return false;
        }

        const item = createDiscordMediaItem({
            key,
            url: originalUrl,
            previewUrl: rawUrl,
            filename: filenameFromUrl(originalUrl),
            mediaType: mediaTypeFromUrl(originalUrl, sourceElement),
            sourceKind: 'discord-attachment',
            sourcePageUrl: null,
            sourceElement
        });
        mediaEntries.set(key, item);
        ensureSelectionForEntries([item]);
        liveMetrics.record('found', 1);
        scheduleRender();
        return true;
    }

    function addOrUpdateExternalGif(
        rawUrl,
        sourceElement,
        sourcePageUrl = null
    ) {
        if (!shouldCollectRenderedItem(sourceElement)) return false;
        if (
            !isDiscordExternalProxyUrl(rawUrl) ||
            !isExternalGifEmbedContext(sourceElement)
        ) {
            return false;
        }

        const mediaUrl = new URL(rawUrl, location.href).href;
        const key = `external-gif:${canonicalKey(mediaUrl)}`;
        const existing = mediaEntries.get(key);

        if (existing) {
            recordCanonicalDuplicate(existing, 'discord-external-gif-canonical-url');
            existing.url = mediaUrl;
            existing.previewUrl = mediaUrl;
            existing.payload.url = mediaUrl;
            existing.payload.previewUrl = mediaUrl;

            if (!existing.sourcePageUrl && sourcePageUrl) {
                existing.sourcePageUrl = sourcePageUrl;
                existing.payload.sourcePageUrl = sourcePageUrl;
            }

            if (!existing.itemId) {
                existing.itemId = findItemId(sourceElement);
                existing.sourceId = existing.itemId;
                existing.payload.itemId = existing.itemId;
            }

            if (!existing.timestamp) {
                existing.timestamp = findItemTimestamp(sourceElement);
            }

            return false;
        }

        let filename = filenameFromUrl(mediaUrl);

        if (!MEDIA_EXTENSIONS.has(extensionFromPath(`/${filename}`))) {
            filename = 'external-gif-preview.mp4';
        }

        const item = createDiscordMediaItem({
            key,
            url: mediaUrl,
            previewUrl: mediaUrl,
            filename,
            mediaType: 'external-gif',
            sourceKind: 'external-gif-preview',
            sourcePageUrl: sourcePageUrl || findExternalGifPageUrl(sourceElement),
            sourceElement
        });
        mediaEntries.set(key, item);
        ensureSelectionForEntries([item]);
        liveMetrics.record('found', 1);
        scheduleRender();
        return true;
    }

    function scanExternalGifPreviews() {
        let added = 0;

        const elements = document.querySelectorAll([
            'a[data-role="img"][data-safe-src]',
            'a[href*="klipy.com/gifs/"]',
            'a[href*="tenor.com/"]',
            'a[href*="giphy.com/gifs/"]',
            'video[aria-label*="GIF" i]',
            '[aria-label="GIF"] video',
            '[aria-label="GIF"] source[src]'
        ].join(','));

        for (const element of elements) {
            if (!isExternalGifEmbedContext(element)) continue;

            const sourcePageUrl =
                findExternalGifPageUrl(element);

            for (
                const mediaUrl of
                externalGifProxyCandidates(element)
            ) {
                if (
                    addOrUpdateExternalGif(
                        mediaUrl,
                        element,
                        sourcePageUrl
                    )
                ) {
                    added++;
                    break;
                }
            }
        }

        return added;
    }

    function scanDiscordVisibleMedia() {
        let added = 0;

        const selectors = [
            'a[href*="/attachments/"]',
            'img[src*="/attachments/"]',
            'video[src*="/attachments/"]',
            'source[src*="/attachments/"]'
        ].join(',');

        document.querySelectorAll(selectors).forEach(element => {
            const candidates = [
                element.href,
                element.currentSrc,
                element.src,
                element.getAttribute?.('href'),
                element.getAttribute?.('src')
            ].filter(Boolean);

            for (const candidate of candidates) {
                if (addOrUpdateMediaEntry(candidate, element)) {
                    added++;
                    break;
                }
            }
        });

        added += scanExternalGifPreviews();
        liveMetrics.update({
            found: mediaEntries.size,
            duplicatesMerged: [...mediaEntries.values()]
                .reduce((total, entry) => total + (entry.duplicateCount || 0), 0)
        });
        updateCounters();
        return added;
    }

    function discordVisibleItemTimeRange() {
        const values = [];

        document
            .querySelectorAll('time[id^="message-timestamp-"][datetime]')
            .forEach(time => {
                const milliseconds = Date.parse(
                    time.getAttribute('datetime') || ''
                );

                if (Number.isFinite(milliseconds)) values.push(milliseconds);
            });

        if (!values.length) {
            for (const itemId of visibleItemIds()) {
                const timestamp = timestampFromItemId(itemId);
                const milliseconds = Date.parse(timestamp || '');
                if (Number.isFinite(milliseconds)) values.push(milliseconds);
            }
        }

        if (!values.length) return null;

        return {
            minMs: Math.min(...values),
            maxMs: Math.max(...values)
        };
    }

    function discordMessageListElement() {
        return (
            document.querySelector('ol[data-list-id="chat-messages"]') ||
            document.querySelector('[data-list-id="chat-messages"]') ||
            document.querySelector('[aria-label][role="group"] article[id*="chat-messages"]')?.parentElement ||
            document.querySelector('main')
        );
    }

    function discordScrollerCandidateScore(element, messageList) {
        const range = Math.max(0, element.scrollHeight - element.clientHeight);
        const style = getComputedStyle(element);
        let score = Math.min(range, 2_000_000);

        if (messageList && element.contains(messageList)) score += 4_000_000;
        if (messageList && element === messageList.parentElement) score += 2_000_000;
        if (['auto', 'scroll', 'overlay'].includes(style.overflowY)) {
            score += 1_000_000;
        }
        if (element.closest?.('main')) score += 500_000;

        return score;
    }

    function findDiscordScrollerCandidates() {
        const messageList = discordMessageListElement();
        const candidates = [];
        const seen = new Set();
        const add = element => {
            if (!element || seen.has(element) || !isScrollable(element)) return;
            seen.add(element);
            candidates.push(element);
        };

        let current = messageList;
        while (current && current !== document.body?.parentElement) {
            add(current);
            if (current === document.body) break;
            current = current.parentElement;
        }

        for (const candidate of document.querySelectorAll(
            'main div, main section, main ol, main [role="log"], main [role="group"]'
        )) {
            if (
                messageList &&
                candidate !== messageList &&
                !candidate.contains(messageList)
            ) {
                continue;
            }
            add(candidate);
        }

        if (
            document.scrollingElement &&
            (!messageList || document.scrollingElement.contains(messageList))
        ) {
            add(document.scrollingElement);
        }

        return candidates.sort((left, right) =>
            discordScrollerCandidateScore(right, messageList) -
            discordScrollerCandidateScore(left, messageList)
        );
    }

    function findDiscordScroller() {
        const candidates = findDiscordScrollerCandidates();
        const selectedIndex = candidates.findIndex(canDriveScroller);

        if (selectedIndex < 0) {
            diagnostics.error(
                'DISCORD_SCROLLER_NOT_WRITABLE',
                'Discord timeline candidates were found, but none accepted a reversible programmatic scroll probe.',
                null,
                { candidateCount: candidates.length, continued: false },
                {
                    category: 'scan',
                    userMessage: 'Discord’s message timeline could not be moved in this browser runtime. Reload the channel and try again. Code: DISCORD_SCROLLER_NOT_WRITABLE'
                }
            );
            return null;
        }

        if (selectedIndex > 0) {
            diagnostics.warn(
                'DISCORD_SCROLLER_FALLBACK_USED',
                'The first Discord timeline candidate was not writable; a verified fallback candidate was selected.',
                {
                    candidateCount: candidates.length,
                    selectedIndex,
                    continued: true
                },
                { category: 'scan' }
            );
        }

        return candidates[selectedIndex];
    }

    function findDiscordItemElementById(itemId) {
        if (!itemId) return null;

        const elements = document.querySelectorAll(
            '[id*="chat-messages"], [data-list-item-id*="chat-messages"], ' +
            '[aria-labelledby*="chat-messages"]'
        );

        for (const element of elements) {
            const values = [
                element.id,
                element.getAttribute('data-list-item-id'),
                element.getAttribute('aria-labelledby')
            ].filter(Boolean);

            if (
                values.some(value =>
                    String(value).includes(itemId)
                )
            ) {
                return element;
            }
        }

        return null;
    }

    function captureDiscordStartingAnchor(scroller) {
        const scrollerRect = scroller.getBoundingClientRect();
        let best = null;

        const elements = document.querySelectorAll(
            '[id*="chat-messages"], [data-list-item-id*="chat-messages"]'
        );

        for (const element of elements) {
            const itemId = findDiscordItemId(element);
            if (!itemId) continue;

            const rect = element.getBoundingClientRect();

            if (
                rect.bottom < scrollerRect.top ||
                rect.top > scrollerRect.bottom
            ) {
                continue;
            }

            const distance = Math.abs(
                rect.top - scrollerRect.top
            );

            if (!best || distance < best.distance) {
                best = {
                    itemId,
                    offset: rect.top - scrollerRect.top,
                    distance
                };
            }
        }

        const position = scrollPosition(scroller);

        return {
            itemId: best?.itemId || null,
            offset: best?.offset || 0,
            scrollRatio:
                position.height > position.client
                    ? position.top /
                      (position.height - position.client)
                    : 0
        };
    }

    function discordVisibleItemIds() {
        const ids = new Set();
        const elements = document.querySelectorAll(
            '[id*="chat-messages"], [data-list-item-id*="chat-messages"], ' +
            '[aria-labelledby*="chat-messages"]'
        );

        for (const element of elements) {
            const values = [
                element.id,
                element.getAttribute?.('data-list-item-id'),
                element.getAttribute?.('aria-labelledby')
            ].filter(Boolean);

            for (const value of values) {
                const matches = String(value).match(/\d{16,22}/g);
                if (matches?.length) {
                    ids.add(matches[matches.length - 1]);
                    break;
                }
            }
        }

        return [...ids];
    }

    function discordBoundaryItemId(direction, ids = discordVisibleItemIds()) {
        let boundary = null;
        for (const id of ids) {
            if (
                boundary === null ||
                (direction === 'older'
                    ? compareItemIds(id, boundary) < 0
                    : compareItemIds(id, boundary) > 0)
            ) {
                boundary = id;
            }
        }
        return boundary;
    }

    function dispatchDiscordTimelineScroll(scroller) {
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    }

    function setDiscordLoadedEdge(scroller, direction) {
        scroller.scrollTop = direction === 'older'
            ? 0
            : scroller.scrollHeight;
        dispatchDiscordTimelineScroll(scroller);
    }

    async function discordJumpScanWindow({ scroller, direction }) {
        const before = scrollPosition(scroller);
        const beforeIds = discordVisibleItemIds();
        const overlapId = discordBoundaryItemId(direction, beforeIds);
        const beforeMediaCount = mediaEntries.size;
        const beforeBoundaryId = overlapId;
        let previousHeight = before.height;
        let stableRounds = 0;

        // This mirrors dragging Discord's scrollbar thumb directly to the
        // currently loaded edge and releasing it. Re-applying the edge during
        // the settle window lets Discord prepend/append a much larger virtual
        // page than a viewport-sized wheel step would reveal.
        setDiscordLoadedEdge(scroller, direction);

        for (let round = 0; round < 6 && !stopRequested; round++) {
            await sleep(round === 0 ? 620 : 320);
            scanVisiblePage();

            const current = scrollPosition(scroller);
            const heightChanged = Math.abs(current.height - previousHeight) >= 3;
            const edgeDistance = direction === 'older'
                ? current.top
                : current.height - (current.top + current.client);

            stableRounds = !heightChanged && edgeDistance <= 8
                ? stableRounds + 1
                : 0;
            previousHeight = current.height;

            if (round < 3 || edgeDistance > 8) {
                setDiscordLoadedEdge(scroller, direction);
            }

            if (stableRounds >= 2 && round >= 2) break;
        }

        scanVisiblePage();
        const afterEdgeIds = discordVisibleItemIds();
        const afterBoundaryId = discordBoundaryItemId(direction, afterEdgeIds);
        const progressed = Boolean(
            beforeBoundaryId &&
            afterBoundaryId &&
            (direction === 'older'
                ? compareItemIds(afterBoundaryId, beforeBoundaryId) < 0
                : compareItemIds(afterBoundaryId, beforeBoundaryId) > 0)
        ) || mediaEntries.size > beforeMediaCount;

        let overlapVerified = !overlapId || Boolean(
            findDiscordItemElementById(overlapId) ||
            afterEdgeIds.includes(overlapId)
        );
        let recovered = false;

        if (!overlapVerified && overlapId && !stopRequested) {
            // Discord may virtualize the previous edge out immediately after a
            // large jump. Move back by half/one viewport, scan that overlap,
            // then return to the loaded edge. This is the safety pass that
            // prevents a fast jump from silently leaving an unscanned gap.
            for (let pass = 0; pass < 2 && !stopRequested; pass++) {
                const current = scrollPosition(scroller);
                const recoveryDistance = Math.max(
                    420,
                    Math.floor(current.client * (0.55 + pass * 0.45))
                );
                scroller.scrollTop = direction === 'older'
                    ? Math.min(
                        Math.max(0, current.height - current.client),
                        recoveryDistance
                    )
                    : Math.max(
                        0,
                        current.height - current.client - recoveryDistance
                    );
                dispatchDiscordTimelineScroll(scroller);
                await sleep(360);
                scanVisiblePage();

                overlapVerified = Boolean(
                    findDiscordItemElementById(overlapId) ||
                    discordVisibleItemIds().includes(overlapId)
                );
                if (overlapVerified) {
                    recovered = true;
                    break;
                }
            }

            setDiscordLoadedEdge(scroller, direction);
            await sleep(260);
            scanVisiblePage();
        }

        const after = scrollPosition(scroller);
        const scrollPositionChanged =
            Math.abs(after.top - before.top) >= 1 ||
            Math.abs(after.height - before.height) >= 3;
        const visibleWindowChanged = beforeIds.some(id =>
            !afterEdgeIds.includes(id)
        ) || afterEdgeIds.some(id => !beforeIds.includes(id));
        const movementVerified =
            progressed || scrollPositionChanged || visibleWindowChanged;
        const requestedEdgeReached = direction === 'older'
            ? after.top <= 8
            : after.height - (after.top + after.client) <= 8;

        if (!movementVerified && !requestedEdgeReached) {
            diagnostics.warn(
                'DISCORD_SCROLL_NO_PROGRESS',
                'A Discord scan step did not change the writable scroll position or visible message window.',
                {
                    direction,
                    before,
                    after,
                    visibleItemCount: afterEdgeIds.length,
                    continued: true
                },
                {
                    category: 'scan',
                    userMessage: 'Discord did not move during one scan step. The scanner will retry or stop at the safety boundary. Code: DISCORD_SCROLL_NO_PROGRESS'
                }
            );
        }

        return {
            overlapId,
            overlapVerified,
            recovered,
            progressed,
            movementVerified,
            before,
            after,
            beforeBoundaryId,
            afterBoundaryId
        };
    }

    registerSiteAdapter(createDiscordAdapter());
    function pinterestPageType(currentLocation = location) {
        const path = currentLocation.pathname.replace(/\/+$/, '') || '/';
        if (path === '/' || path.startsWith('/homefeed')) return null;
        if (/^\/pin\/\d+/i.test(path)) return 'pin-detail';
        if (/^\/search\/pins/i.test(path)) return 'search-results';
        if (/^\/[^/]+\/(?:_created|_saved)$/i.test(path)) return 'profile-grid';
        if (/^\/[^/]+\/[^/]+$/i.test(path)) return 'board';
        if (/^\/[^/]+$/i.test(path) && !/^\/(?:login|logout|settings|business|ideas|today)$/i.test(path)) {
            return 'profile-grid';
        }
        return null;
    }

    function pinterestPinId(element) {
        let current = element;
        for (let depth = 0; current && depth < 10; depth++, current = current.parentElement) {
            const direct = current.getAttribute?.('data-test-pin-id') ||
                current.getAttribute?.('data-pin-id');
            if (/^\d+$/.test(direct || '')) return direct;
            const href = current.matches?.('a[href]')
                ? current.getAttribute('href')
                : current.querySelector?.('a[href*="/pin/"]')?.getAttribute('href');
            const match = String(href || '').match(/\/pin\/(\d+)/i);
            if (match) return match[1];
        }
        return null;
    }

    function pinterestSrcsetCandidates(value) {
        return String(value || '')
            .split(',')
            .map(part => part.trim())
            .map(part => {
                const match = part.match(/^(\S+)\s+(\d+(?:\.\d+)?)(w|x)$/i);
                return match
                    ? { url: match[1], score: Number(match[2]) * (match[3].toLowerCase() === 'x' ? 10_000 : 1) }
                    : null;
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score);
    }

    function pinterestBestRenderedUrl(element) {
        const candidates = [];
        const add = (url, score) => {
            if (!url) return;
            try {
                const parsed = new URL(url, location.href);
                if (!['i.pinimg.com', 'v1.pinimg.com', 'v.pinimg.com'].includes(parsed.hostname)) return;
                candidates.push({ url: parsed.href, score });
            } catch {
                // Ignore malformed rendered attributes.
            }
        };

        if (element?.tagName?.toUpperCase?.() === 'VIDEO') {
            add(element.currentSrc, 1_000_000);
            add(element.src, 900_000);
            for (const source of element.querySelectorAll?.('source[src]') || []) {
                add(source.src || source.getAttribute('src'), 800_000);
            }
        } else {
            add(element?.currentSrc, 1_000_000);
            for (const source of element?.closest?.('picture')?.querySelectorAll?.('source[srcset]') || []) {
                for (const candidate of pinterestSrcsetCandidates(source.getAttribute('srcset'))) {
                    add(candidate.url, 600_000 + candidate.score);
                }
            }
            for (const candidate of pinterestSrcsetCandidates(element?.getAttribute?.('srcset'))) {
                add(candidate.url, 500_000 + candidate.score);
            }
            add(element?.src, 100_000);
            add(element?.getAttribute?.('src'), 90_000);
        }

        candidates.sort((a, b) => b.score - a.score);
        return candidates[0]?.url || null;
    }

    function pinterestCanonicalMediaKey(rawUrl, pinId = null) {
        const url = new URL(rawUrl, location.href);
        return `pinterest:${pinId || 'unknown'}:${url.hostname.toLowerCase()}${url.pathname}`.toLowerCase();
    }

    function pinterestFilename(rawUrl) {
        try {
            const url = new URL(rawUrl, location.href);
            return sanitizeFilename(decodeURIComponent(url.pathname.split('/').pop() || 'pinterest-media.jpg'));
        } catch {
            return 'pinterest-media.jpg';
        }
    }

    function createPinterestAdapter() {
        const downloadHosts = new Set(['i.pinimg.com', 'v1.pinimg.com', 'v.pinimg.com']);
        return {
            id: 'pinterest',
            label: 'Pinterest',
            archivePrefix: 'pinterest',
            capabilities: {
                media: true,
                textRecords: false,
                virtualTimeline: true,
                dateFilter: false,
                hostPageSelection: false,
                scanModes: [
                    'newest-to-oldest',
                    'current-to-oldest',
                    'current-to-newest',
                    'full-finish-down'
                ],
                views: ['grid', 'list']
            },
            terms: Object.freeze({
                timeline: 'pin grid',
                item: 'pin',
                items: 'pins',
                oldest: 'grid start',
                newest: 'grid end'
            }),
            matches(currentLocation) {
                return /(^|\.)pinterest\.com$/i.test(currentLocation.hostname) &&
                    Boolean(pinterestPageType(currentLocation));
            },
            scanVisibleMedia: scanPinterestVisibleMedia,
            findScroller: findPinterestScroller,
            visibleItemIds: pinterestVisibleItemIds,
            visibleItemTimeRange: () => null,
            findItemElementById: findPinterestItemElementById,
            captureStartingAnchor: capturePinterestStartingAnchor,
            findItemId: pinterestPinId,
            findItemTimestamp: () => null,
            compareItemIds(left, right) {
                try {
                    const a = BigInt(left);
                    const b = BigInt(right);
                    return a === b ? 0 : a < b ? -1 : 1;
                } catch {
                    return String(left || '').localeCompare(String(right || ''));
                }
            },
            getArchiveContext() {
                const pageType = pinterestPageType() || 'pins';
                const parts = location.pathname.split('/').filter(Boolean);
                return {
                    id: sanitizeFilename(parts.slice(0, 2).join('-') || pageType),
                    label: pageType
                };
            },
            isDownloadUrlAllowed(rawUrl) {
                try {
                    return downloadHosts.has(new URL(rawUrl, location.href).hostname);
                } catch {
                    return false;
                }
            },
            openTargetHelp: 'Open a pin detail, board, visible profile grid, or pin search results page.'
        };
    }

    function addOrUpdatePinterestMedia(element) {
        const mediaUrl = pinterestBestRenderedUrl(element);
        if (!mediaUrl) return false;

        const pinId = pinterestPinId(element);
        const key = pinterestCanonicalMediaKey(mediaUrl, pinId);
        const existing = mediaEntries.get(key);
        const isVideo = element.tagName?.toUpperCase?.() === 'VIDEO' ||
            Boolean(element.closest?.('video')) ||
            VIDEO_EXTENSIONS.has(extensionFromPath(new URL(mediaUrl).pathname));

        if (existing) {
            recordCanonicalDuplicate(existing, 'pinterest-masonry-rerender');
            existing.previewUrl = element.currentSrc || element.src || existing.previewUrl;
            existing.payload.previewUrl = existing.previewUrl;
            return false;
        }

        const filename = pinterestFilename(mediaUrl);
        const item = {
            key,
            kind: 'media',
            adapterId: 'pinterest',
            canonical: true,
            canonicalKey: key,
            duplicateCount: 0,
            eligibility: { adapter: true, type: true, date: true },
            manuallySelected: true,
            url: mediaUrl,
            previewUrl: element.currentSrc || element.src || mediaUrl,
            filename,
            mediaType: isVideo ? 'video' : 'photo',
            sourceKind: 'pinterest-rendered-media',
            sourcePageUrl: pinId ? `${location.origin}/pin/${pinId}/` : null,
            itemId: pinId,
            sourceId: pinId,
            timestamp: null,
            firstSeen: firstSeenCounter++,
            discoveryIndex: firstSeenCounter - 1,
            status: STATUS.COLLECTED,
            error: '',
            size: 0,
            payload: {
                url: mediaUrl,
                previewUrl: element.currentSrc || element.src || mediaUrl,
                filename,
                originalFilename: filename,
                mediaType: isVideo ? 'video' : 'photo',
                sourceKind: 'pinterest-rendered-media',
                sourcePageUrl: pinId ? `${location.origin}/pin/${pinId}/` : null,
                itemId: pinId,
                sourceLabel: pinterestPageType() || 'pins'
            }
        };

        mediaEntries.set(key, item);
        ensureSelectionForEntries([item]);
        liveMetrics.record('found', 1);
        scheduleRender();
        return true;
    }

    function scanPinterestVisibleMedia() {
        let added = 0;
        const elements = document.querySelectorAll([
            'img[src*="pinimg.com"]',
            'img[srcset*="pinimg.com"]',
            'picture source[srcset*="pinimg.com"]',
            'video[src*="pinimg.com"]',
            'video source[src*="pinimg.com"]'
        ].join(','));

        const mediaElements = new Set();
        for (const element of elements) {
            if (element.tagName?.toUpperCase?.() === 'SOURCE') {
                const owner = element.closest('picture')?.querySelector('img') || element.closest('video');
                if (owner) mediaElements.add(owner);
            } else {
                mediaElements.add(element);
            }
        }

        for (const element of mediaElements) {
            const rect = element.getBoundingClientRect?.();
            if (rect && (rect.width <= 1 || rect.height <= 1)) continue;
            if (addOrUpdatePinterestMedia(element)) added++;
        }

        const duplicatesMerged = [...mediaEntries.values()]
            .filter(entry => entry.adapterId === 'pinterest')
            .reduce((sum, entry) => sum + (entry.duplicateCount || 0), 0);
        liveMetrics.update({ found: mediaEntries.size, duplicatesMerged });
        updateCounters();
        return added;
    }

    function findPinterestScroller() {
        const root = document.scrollingElement || document.documentElement;
        if (root && root.scrollHeight > root.clientHeight + 80) return root;

        const candidates = [...document.querySelectorAll('main, main div, [role="main"]')]
            .filter(isScrollable)
            .sort((a, b) =>
                (b.scrollHeight - b.clientHeight) -
                (a.scrollHeight - a.clientHeight)
            );
        return candidates[0] || null;
    }

    function pinterestVisibleItemIds() {
        const ids = new Set();
        for (const anchor of document.querySelectorAll('a[href*="/pin/"]')) {
            const id = pinterestPinId(anchor);
            if (!id) continue;
            const rect = anchor.getBoundingClientRect();
            if (rect.bottom >= 0 && rect.top <= window.innerHeight) ids.add(id);
        }
        return [...ids];
    }

    function findPinterestItemElementById(itemId) {
        if (!itemId) return null;
        for (const anchor of document.querySelectorAll(`a[href*="/pin/${itemId}/"]`)) {
            return anchor.closest('[data-test-pin-id], [data-pin-id], article, div') || anchor;
        }
        return null;
    }

    function capturePinterestStartingAnchor(scroller) {
        const scrollerRect = scroller === document.scrollingElement
            ? { top: 0, bottom: window.innerHeight }
            : scroller.getBoundingClientRect();
        let best = null;

        for (const anchor of document.querySelectorAll('a[href*="/pin/"]')) {
            const itemId = pinterestPinId(anchor);
            if (!itemId) continue;
            const rect = anchor.getBoundingClientRect();
            if (rect.bottom < scrollerRect.top || rect.top > scrollerRect.bottom) continue;
            const distance = Math.abs(rect.top - scrollerRect.top);
            if (!best || distance < best.distance) {
                best = {
                    itemId,
                    offset: rect.top - scrollerRect.top,
                    distance
                };
            }
        }

        const position = scrollPosition(scroller);
        return {
            itemId: best?.itemId || null,
            offset: best?.offset || 0,
            scrollRatio: position.height > position.client
                ? position.top / (position.height - position.client)
                : 0
        };
    }

    registerSiteAdapter(createPinterestAdapter());

    const REDDIT_COMMENT_MEDIA_HOST_PATTERNS = Object.freeze([
        'i.redd.it',
        'preview.redd.it',
        'external-preview.redd.it',
        'v.redd.it',
        'packaged-media.redd.it',
        'i.redditmedia.com',
        'reddit-uploaded-media.s3-accelerate.amazonaws.com',
        'i.imgur.com',
        '*.giphy.com',
        'media.tenor.com',
        '*.streamable.com',
        '*.redgifs.com',
        '*.gfycat.com',
        'cdn.discordapp.com',
        'media.discordapp.net',
        'pbs.twimg.com',
        'video.twimg.com',
        '*.tumblr.com'
    ]);

    function redditHostMatchesPattern(hostname, pattern) {
        const normalizedHost = String(hostname || '').toLowerCase();
        const normalizedPattern = String(pattern || '').toLowerCase();
        if (!normalizedHost || !normalizedPattern) return false;
        if (!normalizedPattern.startsWith('*.')) {
            return normalizedHost === normalizedPattern;
        }
        const suffix = normalizedPattern.slice(1);
        return normalizedHost.endsWith(suffix) &&
            normalizedHost.length > suffix.length;
    }

    function redditCommentMediaHostAllowed(hostname) {
        return REDDIT_COMMENT_MEDIA_HOST_PATTERNS.some(pattern =>
            redditHostMatchesPattern(hostname, pattern)
        );
    }

    function redditCommentThreadPageType(currentLocation = location) {
        const allowedHost = /^(?:www\.|old\.)?reddit\.com$/i.test(currentLocation.hostname);
        if (!allowedHost) return null;
        const path = currentLocation.pathname.replace(/\/+$/, '');
        return /^\/r\/[^/]+\/comments\/[a-z0-9]+(?:\/[^/]+)?(?:\/[a-z0-9]+)?$/i.test(path)
            ? 'post-comments'
            : null;
    }

    function redditCommentSelector() {
        return [
            'shreddit-comment',
            '[data-testid="comment"]',
            '[data-comment-id]',
            '[id^="t1_"]',
            '.thing.comment[data-fullname^="t1_"]'
        ].join(',');
    }

    function redditCommentNode(element) {
        return element?.closest?.(redditCommentSelector()) || null;
    }

    function redditCommentId(element) {
        const node = redditCommentNode(element) || element;
        const candidates = [
            node?.getAttribute?.('thingid'),
            node?.getAttribute?.('data-comment-id'),
            node?.getAttribute?.('data-fullname'),
            node?.id
        ].filter(Boolean);
        for (const value of candidates) {
            const match = String(value).match(/(?:^|\b)(t1_[a-z0-9]+)|(?:^|\b)([a-z0-9]{5,})$/i);
            if (match) return match[1] || `t1_${match[2]}`;
        }
        const permalink = node?.querySelector?.('a[href*="/comments/"]')?.getAttribute('href') || '';
        const match = permalink.match(/\/comments\/[a-z0-9]+\/[^/]+\/([a-z0-9]+)\/?$/i);
        return match ? `t1_${match[1]}` : null;
    }

    function redditCommentBodyNode(element) {
        const node = redditCommentNode(element) || element;
        return node?.querySelector?.([
            '[slot="comment"]',
            '[data-testid="comment-body"]',
            '[data-click-id="text"]',
            '.usertext-body .md',
            ':scope > .entry .md'
        ].join(',')) || null;
    }

    function redditCommentTimestamp(element) {
        const node = redditCommentNode(element) || element;
        const time = node?.querySelector?.('time[datetime]');
        if (time?.getAttribute('datetime')) return time.getAttribute('datetime');
        const timeago = node?.querySelector?.('faceplate-timeago[ts], faceplate-timeago[datetime]');
        const value = timeago?.getAttribute('ts') || timeago?.getAttribute('datetime');
        if (!value) return null;
        const milliseconds = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
        return Number.isFinite(milliseconds)
            ? new Date(milliseconds < 10_000_000_000 ? milliseconds * 1000 : milliseconds).toISOString()
            : null;
    }

    function redditCommentPermalink(element) {
        const node = redditCommentNode(element) || element;
        const href = node?.getAttribute?.('permalink') ||
            node?.querySelector?.('[data-testid="comment-permalink"], a[data-click-id="timestamp"], a.bylink')?.getAttribute('href');
        if (!href) return null;
        try {
            const url = new URL(href, location.origin);
            url.search = '';
            url.hash = '';
            return url.href;
        } catch {
            return null;
        }
    }

    function createRedditCommentsAdapter() {
        return {
            id: 'reddit-comments',
            label: 'Reddit comment media',
            archivePrefix: 'reddit',
            preferredScanMode: 'current-to-newest',
            boundaryConfirmMs: 5_000,
            capabilities: {
                media: true,
                textRecords: false,
                virtualTimeline: true,
                dateFilter: false,
                hostPageSelection: false,
                scanModes: [
                    'current-to-newest'
                ],
                views: ['grid', 'list']
            },
            terms: Object.freeze({
                timeline: 'comment thread',
                item: 'comment media item',
                items: 'comment media items',
                oldest: 'thread start',
                newest: 'thread end'
            }),
            matches(currentLocation) {
                return Boolean(redditCommentThreadPageType(currentLocation));
            },
            scanVisibleMedia: scanRedditRenderedThread,
            expandRenderedContent: expandRedditRenderedComments,
            findScroller: findRedditThreadScroller,
            visibleItemIds: redditVisibleCommentIds,
            visibleItemTimeRange: redditVisibleCommentTimeRange,
            findItemElementById: findRedditCommentElementById,
            captureStartingAnchor: captureRedditStartingAnchor,
            findItemId: redditCommentId,
            findItemTimestamp: redditCommentTimestamp,
            compareItemIds(left, right) {
                return String(left || '').localeCompare(String(right || ''));
            },
            getArchiveContext() {
                const match = location.pathname.match(/^\/r\/([^/]+)\/comments\/([a-z0-9]+)\/([^/]+)?/i);
                const subreddit = match?.[1] || 'reddit';
                const postId = match?.[2] || 'thread';
                const slug = match?.[3] || 'comments';
                return {
                    id: sanitizeFilename(`${subreddit}-${postId}`),
                    label: sanitizeFilename(`${subreddit}-${slug}-comment-media`),
                    postId: `t3_${postId}`,
                    postLabel: `${subreddit} · ${slug.replace(/_/g, ' ')}`,
                    postPermalink: `${location.origin}/r/${subreddit}/comments/${postId}/${slug}/`
                };
            },
            isDownloadUrlAllowed(rawUrl) {
                try {
                    const url = new URL(rawUrl, location.href);
                    return url.protocol === 'https:' &&
                        redditCommentMediaHostAllowed(url.hostname);
                } catch {
                    return false;
                }
            },
            openTargetHelp: 'Open a Reddit post detail page and scan media rendered inside its comments.'
        };
    }

    function redditCommentElements() {
        const selector = redditCommentSelector();
        const unique = new Map();
        for (const element of document.querySelectorAll(selector)) {
            const commentId = redditCommentId(element);
            if (commentId && !unique.has(commentId)) {
                unique.set(commentId, element);
            }
        }
        return [...unique.values()];
    }

    // Comment text is intentionally not represented as an ArchiveItem.
    // The Reddit adapter uses comments only as DOM containers and timeline anchors.
    function scanRedditRenderedComments() {
        return 0;
    }

    function redditMediaPathExtension(pathname) {
        const extension = extensionFromPath(pathname);
        return extension === '.gifv' ? '.mp4' : extension;
    }

    function normalizeRedditCommentMediaUrl(rawUrl) {
        if (!rawUrl) return null;
        try {
            const url = new URL(rawUrl, location.href);
            if (url.protocol !== 'https:' || !redditCommentMediaHostAllowed(url.hostname)) {
                return null;
            }
            if (url.hostname === 'i.imgur.com' && url.pathname.toLowerCase().endsWith('.gifv')) {
                url.pathname = `${url.pathname.slice(0, -5)}.mp4`;
            }
            url.hash = '';
            return url;
        } catch {
            return null;
        }
    }

    function redditDirectMediaLinkAllowed(url) {
        if (!url) return false;
        const extension = redditMediaPathExtension(url.pathname);
        if (MEDIA_EXTENSIONS.has(extension) || extension === '.gif') return true;
        return [
            'v.redd.it',
            'packaged-media.redd.it',
            'reddit-uploaded-media.s3-accelerate.amazonaws.com'
        ].includes(url.hostname);
    }

    function redditRenderedMediaCandidates(element) {
        const candidates = new Map();
        const add = (rawUrl, score, requireDirect = false) => {
            const url = normalizeRedditCommentMediaUrl(rawUrl);
            if (!url || (requireDirect && !redditDirectMediaLinkAllowed(url))) return;
            const key = `${url.hostname}${url.pathname}`.toLowerCase();
            const previous = candidates.get(key);
            if (!previous || score > previous.score) {
                candidates.set(key, { url: url.href, score });
            }
        };
        const addSrcset = (value, baseScore) => {
            for (const part of String(value || '').split(',')) {
                const match = part.trim().match(/^(\S+)(?:\s+(\d+(?:\.\d+)?)(w|x))?$/i);
                if (!match) continue;
                const dimension = Number(match[2]) || 0;
                add(match[1], baseScore + dimension);
            }
        };

        add(element.currentSrc, 1_000_000);
        add(element.src, 900_000);
        add(element.getAttribute?.('src'), 850_000);
        add(element.getAttribute?.('data-src'), 820_000);
        add(element.getAttribute?.('data-original'), 810_000);
        add(element.getAttribute?.('data-mp4'), 800_000);
        add(element.getAttribute?.('data-gif'), 790_000);
        addSrcset(element.getAttribute?.('srcset'), 700_000);

        if (element.tagName?.toUpperCase?.() === 'VIDEO') {
            for (const source of element.querySelectorAll?.('source[src], source[srcset]') || []) {
                add(source.src || source.getAttribute('src'), 980_000);
                addSrcset(source.getAttribute('srcset'), 960_000);
            }
        }

        if (element.tagName?.toUpperCase?.() === 'PICTURE') {
            for (const source of element.querySelectorAll?.('source[src], source[srcset], img[src], img[srcset]') || []) {
                add(source.currentSrc || source.src || source.getAttribute?.('src'), 950_000);
                addSrcset(source.getAttribute?.('srcset'), 930_000);
            }
        }

        if (element.tagName?.toUpperCase?.() === 'A') {
            add(element.href || element.getAttribute?.('href'), 880_000, true);
        } else {
            const anchor = element.closest?.('a[href]');
            add(anchor?.href || anchor?.getAttribute?.('href'), 500_000, true);
        }

        return [...candidates.values()].sort((a, b) => b.score - a.score);
    }

    function redditMediaType(rawUrl, element) {
        const url = new URL(rawUrl, location.href);
        const extension = redditMediaPathExtension(url.pathname);
        const externalGifProvider = [
            '.giphy.com',
            '.tenor.com',
            '.redgifs.com',
            '.gfycat.com'
        ].some(suffix => url.hostname.endsWith(suffix));
        if (
            extension === '.gif' ||
            (externalGifProvider && ['.mp4', '.webm', '.gif', '.webp', ''].includes(extension))
        ) {
            return 'external-gif';
        }
        if (
            element.tagName?.toUpperCase?.() === 'VIDEO' ||
            Boolean(element.closest?.('video')) ||
            VIDEO_EXTENSIONS.has(extension) ||
            ['v.redd.it', 'video.twimg.com'].includes(url.hostname)
        ) {
            return 'video';
        }
        return 'photo';
    }

    function redditMediaFilename(rawUrl, mediaType, element) {
        try {
            const url = new URL(rawUrl, location.href);
            const raw = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || 'reddit-media');
            const originalExtension = extensionFromPath(`/${raw}`);
            const extension = redditMediaPathExtension(`/${raw}`);
            if (extension) {
                const stem = originalExtension ? raw.slice(0, -originalExtension.length) : raw;
                return sanitizeFilename(`${stem}${extension}`);
            }
            const fallbackExtension = mediaType === 'video'
                ? '.mp4'
                : mediaType === 'external-gif'
                    ? (element.tagName?.toUpperCase?.() === 'VIDEO' ? '.mp4' : '.gif')
                    : '.jpg';
            return sanitizeFilename(`${raw || 'reddit-media'}${fallbackExtension}`);
        } catch {
            if (mediaType === 'video') return 'reddit-video.mp4';
            if (mediaType === 'external-gif') return 'reddit-gif.gif';
            return 'reddit-image.jpg';
        }
    }

    function addOrUpdateRedditCommentMedia(element) {
        const comment = redditCommentNode(element);
        const commentId = redditCommentId(comment);
        if (!commentId) return false;
        const candidate = redditRenderedMediaCandidates(element)[0];
        if (!candidate) return false;

        const url = new URL(candidate.url, location.href);
        const canonicalPath = `${url.hostname}${url.pathname}`.toLowerCase();
        const key = `reddit-media:${canonicalPath}`;
        const existing = mediaEntries.get(key);
        const mediaType = redditMediaType(candidate.url, element);
        const previewUrl = element.currentSrc || element.src || candidate.url;
        const permalink = redditCommentPermalink(comment);

        if (existing) {
            recordCanonicalDuplicate(existing, 'reddit-comment-media-duplicate');
            existing.url = candidate.url;
            existing.previewUrl = previewUrl || existing.previewUrl;
            existing.payload.url = existing.url;
            existing.payload.previewUrl = existing.previewUrl;
            existing.payload.commentIds = [...new Set([
                ...(existing.payload.commentIds || []),
                commentId
            ])];
            existing.payload.commentPermalinks = [...new Set([
                ...(existing.payload.commentPermalinks || []),
                ...(permalink ? [permalink] : [])
            ])];
            return false;
        }

        const filename = redditMediaFilename(candidate.url, mediaType, element);
        const timestamp = redditCommentTimestamp(comment);
        const sourceKind = mediaType === 'video'
            ? 'reddit-comment-video'
            : mediaType === 'external-gif'
                ? 'reddit-comment-external-gif'
                : 'reddit-comment-photo';
        const item = {
            key,
            kind: 'media',
            adapterId: 'reddit-comments',
            canonical: true,
            canonicalKey: key,
            duplicateCount: 0,
            eligibility: { adapter: true, type: true, date: true },
            manuallySelected: true,
            sourceId: `${commentId}:${canonicalPath}`,
            parentSourceId: commentId,
            itemId: commentId,
            timestamp,
            firstSeen: firstSeenCounter++,
            discoveryIndex: firstSeenCounter - 1,
            status: STATUS.COLLECTED,
            error: '',
            size: 0,
            filename,
            mediaType,
            sourceKind,
            sourcePageUrl: permalink,
            url: candidate.url,
            previewUrl,
            payload: {
                url: candidate.url,
                previewUrl,
                filename,
                originalFilename: filename,
                mediaType,
                sourceKind,
                sourcePageUrl: permalink,
                itemId: commentId,
                commentIds: [commentId],
                commentPermalinks: permalink ? [permalink] : [],
                externalHost: url.hostname,
                sourceLabel: activeSiteAdapter?.getArchiveContext?.().label || 'reddit-comment-media'
            }
        };
        mediaEntries.set(key, item);
        ensureSelectionForEntries([item]);
        liveMetrics.record('found', 1);
        scheduleRender();
        return true;
    }

    function redditCommentMediaElements(comment) {
        const body = redditCommentBodyNode(comment) || comment;
        const elements = new Set();
        for (const element of body.querySelectorAll?.([
            'img[src]',
            'img[srcset]',
            'picture',
            'video[src]',
            'video source[src]',
            'video source[srcset]',
            'a[href]'
        ].join(',')) || []) {
            if (element.tagName?.toUpperCase?.() === 'SOURCE') {
                const parent = element.closest('video, picture');
                if (parent) elements.add(parent);
            } else {
                elements.add(element);
            }
        }
        return [...elements];
    }

    function scanRedditRenderedCommentMedia() {
        let added = 0;
        for (const comment of redditCommentElements()) {
            for (const element of redditCommentMediaElements(comment)) {
                if (addOrUpdateRedditCommentMedia(element)) added++;
            }
        }
        return added;
    }

    function scanRedditRenderedThread() {
        const added = scanRedditRenderedCommentMedia();
        liveMetrics.update({
            found: mediaEntries.size,
            duplicatesMerged: [...mediaEntries.values()]
                .filter(entry => entry.adapterId === 'reddit-comments')
                .reduce((sum, entry) => sum + (entry.duplicateCount || 0), 0)
        });
        updateCounters();
        return added;
    }

    function findRedditThreadScroller() {
        const root = document.scrollingElement || document.documentElement;
        if (root && root.scrollHeight > root.clientHeight + 80) return root;
        const candidates = [...document.querySelectorAll('main, [role="main"], main div')]
            .filter(isScrollable)
            .sort((a, b) =>
                (b.scrollHeight - b.clientHeight) -
                (a.scrollHeight - a.clientHeight)
            );
        return candidates[0] || null;
    }

    function redditVisibleCommentIds() {
        const ids = [];
        for (const element of redditCommentElements()) {
            const rect = element.getBoundingClientRect();
            if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
            const id = redditCommentId(element);
            if (id) ids.push(id);
        }
        return [...new Set(ids)];
    }

    function redditVisibleCommentTimeRange() {
        const values = [];
        for (const element of redditCommentElements()) {
            const rect = element.getBoundingClientRect();
            if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
            const milliseconds = Date.parse(redditCommentTimestamp(element) || '');
            if (Number.isFinite(milliseconds)) values.push(milliseconds);
        }
        if (!values.length) return null;
        return { minMs: Math.min(...values), maxMs: Math.max(...values) };
    }

    function findRedditCommentElementById(itemId) {
        if (!itemId) return null;
        return redditCommentElements().find(element => redditCommentId(element) === itemId) || null;
    }

    function captureRedditStartingAnchor(scroller) {
        const scrollerRect = scroller === document.scrollingElement
            ? { top: 0, bottom: window.innerHeight }
            : scroller.getBoundingClientRect();
        let best = null;
        for (const element of redditCommentElements()) {
            const itemId = redditCommentId(element);
            if (!itemId) continue;
            const rect = element.getBoundingClientRect();
            if (rect.bottom < scrollerRect.top || rect.top > scrollerRect.bottom) continue;
            const distance = Math.abs(rect.top - scrollerRect.top);
            if (!best || distance < best.distance) {
                best = { itemId, offset: rect.top - scrollerRect.top, distance };
            }
        }
        const position = scrollPosition(scroller);
        return {
            itemId: best?.itemId || null,
            offset: best?.offset || 0,
            scrollRatio: position.height > position.client
                ? position.top / (position.height - position.client)
                : 0
        };
    }

    function redditExpansionControlText(element) {
        return [
            element?.innerText,
            element?.textContent,
            element?.getAttribute?.('aria-label'),
            element?.getAttribute?.('title')
        ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    }

    function redditExpansionControlEligible(element) {
        if (!(element instanceof HTMLElement)) return false;
        if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
        if (element.matches(':disabled, [disabled], [aria-disabled="true"]')) return false;
        if (!element.getClientRects().length) return false;

        const text = redditExpansionControlText(element).toLocaleLowerCase();
        if (!text) return false;

        const expansionText =
            /\b(?:view|load|show)\s+(?:\d+\s+)?(?:more\s+)?(?:comments?|repl(?:y|ies))\b/i.test(text) ||
            /\bmore\s+(?:comments?|repl(?:y|ies))\b/i.test(text) ||
            /\bcontinue\s+this\s+thread\b/i.test(text);
        if (!expansionText) return false;

        if (/\b(?:log\s*in|sign\s*up|award|share|report|save|follow|join|vote|upvote|downvote)\b/i.test(text)) {
            return false;
        }

        const withinThread = Boolean(element.closest([
            'shreddit-comment',
            '[data-testid="comment"]',
            '[data-comment-id]',
            '.commentarea',
            '.sitetable.nestedlisting',
            'main',
            '[role="main"]'
        ].join(',')));
        return withinThread;
    }

    function redditExpansionCandidates() {
        const selector = [
            'button',
            '[role="button"]',
            'a',
            'faceplate-button',
            'faceplate-tracker',
            'shreddit-async-loader'
        ].join(',');
        const candidates = [];
        for (const element of document.querySelectorAll(selector)) {
            const clickable = element.matches('button, a, [role="button"]')
                ? element
                : element.querySelector('button, a, [role="button"]') || element;
            if (redditExpansionControlEligible(clickable)) candidates.push(clickable);
        }
        return [...new Set(candidates)];
    }

    async function expandRedditRenderedComments({ scroller, direction }) {
        if (direction !== 'newer') return 0;
        const now = Date.now();
        const candidates = redditExpansionCandidates()
            .filter(element => {
                const lastAttempt = Number(element.dataset.maRedditExpandAttempt || 0);
                return !lastAttempt || now - lastAttempt >= 8_000;
            })
            .slice(0, 8);

        if (!candidates.length) return 0;

        const beforeHeight = scrollPosition(scroller).height;
        const beforeCommentCount = redditCommentElements().length;
        let activated = 0;

        for (const control of candidates) {
            control.dataset.maRedditExpandAttempt = String(now);
            try {
                control.click();
                activated++;
            } catch {
                // One stale/replaced control must not stop the remaining pass.
            }
            await sleep(90);
        }

        if (!activated) return 0;

        const startedAt = performance.now();
        let stableRounds = 0;
        let previousHeight = beforeHeight;
        while (!stopRequested && performance.now() - startedAt < 2_800) {
            await sleep(280);
            scanVisiblePage();
            const currentHeight = scrollPosition(scroller).height;
            const currentCommentCount = redditCommentElements().length;
            const changed =
                currentCommentCount > beforeCommentCount ||
                Math.abs(currentHeight - beforeHeight) >= 3;
            stableRounds = changed && Math.abs(currentHeight - previousHeight) < 3
                ? stableRounds + 1
                : 0;
            previousHeight = currentHeight;
            if (stableRounds >= 2) break;
        }

        return activated;
    }

    registerSiteAdapter(createRedditCommentsAdapter());

    activeSiteAdapter = resolveSiteAdapter();

    if (!activeSiteAdapter) {
        return;
    }

    function compareEntriesNewestFirst(a, b) {
        if (a.itemId && b.itemId) {
            const comparison = compareItemIds(a.itemId, b.itemId);
            if (comparison > 0) return -1;
            if (comparison < 0) return 1;
        }

        if (a.timestamp && b.timestamp) {
            const timeDifference =
                new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
            if (timeDifference) return timeDifference;
        }

        if (a.itemId && !b.itemId) return -1;
        if (!a.itemId && b.itemId) return 1;
        return a.firstSeen - b.firstSeen;
    }

    function sortedMediaEntries() {
        return [...mediaEntries.values()].sort(compareEntriesNewestFirst);
    }

    function localDateInputValue(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function localDayStartMilliseconds(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return NaN;

        const [year, month, day] = value.split('-').map(Number);
        const date = new Date(year, month - 1, day, 0, 0, 0, 0);

        if (
            date.getFullYear() !== year ||
            date.getMonth() !== month - 1 ||
            date.getDate() !== day
        ) {
            return NaN;
        }

        return date.getTime();
    }

    function getDateRangeConfig() {
        const enabled = Boolean(dateFilterCheckbox?.checked);

        if (!enabled) {
            return {
                enabled: false,
                valid: true,
                startMs: Number.NEGATIVE_INFINITY,
                endExclusiveMs: Number.POSITIVE_INFINITY,
                startValue: '',
                endValue: '',
                endMode: 'latest',
                label: 'All dates'
            };
        }

        const startValue = fromDateInput?.value || '';
        const endMode = dateEndModeSelect?.value || 'latest';
        const endValue = toDateInput?.value || '';
        const startMs = localDayStartMilliseconds(startValue);

        if (!Number.isFinite(startMs)) {
            return {
                enabled: true,
                valid: false,
                error: 'Choose a valid From date.'
            };
        }

        let endExclusiveMs = Number.POSITIVE_INFINITY;

        if (endMode === 'specific') {
            const endStartMs = localDayStartMilliseconds(endValue);

            if (!Number.isFinite(endStartMs)) {
                return {
                    enabled: true,
                    valid: false,
                    error: 'Choose a valid To date.'
                };
            }

            if (endStartMs < startMs) {
                return {
                    enabled: true,
                    valid: false,
                    error: 'The To date cannot be earlier than the From date.'
                };
            }

            const endDate = new Date(endStartMs);
            endDate.setDate(endDate.getDate() + 1);
            endExclusiveMs = endDate.getTime();
        }

        return {
            enabled: true,
            valid: true,
            startMs,
            endExclusiveMs,
            startValue,
            endValue,
            endMode,
            label: endMode === 'specific'
                ? `${startValue} through ${endValue}`
                : `${startValue} through latest available`
        };
    }

    function entryTimestampMilliseconds(entry) {
        const parsed = Date.parse(entry.timestamp || '');
        if (Number.isFinite(parsed)) return parsed;

        const fallback = timestampFromItemId(entry.itemId);
        const fallbackParsed = Date.parse(fallback || '');
        return Number.isFinite(fallbackParsed) ? fallbackParsed : NaN;
    }

    function isEntryInsideDateRange(entry) {
        const range = getDateRangeConfig();
        if (!range.enabled) return true;
        if (!range.valid) return false;

        const timestamp = entryTimestampMilliseconds(entry);
        if (!Number.isFinite(timestamp)) return false;

        return (
            timestamp >= range.startMs &&
            timestamp < range.endExclusiveMs
        );
    }

    function mediaTypeIsEnabled(entry) {
        if (entry.mediaType === 'video') {
            return Boolean(videoCheckbox?.checked);
        }

        if (entry.mediaType === 'external-gif') {
            return Boolean(externalGifCheckbox?.checked);
        }

        return Boolean(photoCheckbox?.checked);
    }

    function updateEntryEligibility(entry) {
        const eligibility = {
            adapter: entry.canonical !== false,
            type: mediaTypeIsEnabled(entry),
            date: isEntryInsideDateRange(entry)
        };
        entry.eligibility = eligibility;
        entry.manuallySelected = selectionStore.isSelected(entry.key);
        return eligibility;
    }

    function isEntryIncluded(entry) {
        const eligibility = updateEntryEligibility(entry);
        return eligibility.adapter && eligibility.type && eligibility.date;
    }

    function entrySkipReason(entry) {
        if (!mediaTypeIsEnabled(entry)) {
            return 'Skipped by media-type filter';
        }

        if (!isEntryInsideDateRange(entry)) {
            return Number.isFinite(entryTimestampMilliseconds(entry))
                ? 'Skipped by date-range filter'
                : 'Skipped because its source date is unknown';
        }

        if (!selectionStore.isSelected(entry.key)) {
            return 'Deselected in the Library';
        }

        return '';
    }

    function eligibleMediaEntries() {
        const entries = sortedMediaEntries();
        ensureSelectionForEntries(entries);
        return entries.filter(isEntryIncluded);
    }

    function selectedMediaEntries() {
        return eligibleMediaEntries().filter(entry =>
            selectionStore.isSelected(entry.key)
        );
    }

    function selectionStatistics() {
        const entries = [...mediaEntries.values()];
        ensureSelectionForEntries(entries);
        let inDateRange = 0;
        let excludedByDate = 0;
        let excludedByType = 0;
        let eligible = 0;
        let selected = 0;
        let manuallyDeselected = 0;
        let duplicatesMerged = 0;

        for (const entry of entries) {
            const insideDate = isEntryInsideDateRange(entry);
            const typeEnabled = mediaTypeIsEnabled(entry);
            const canonical = entry.canonical !== false;
            const manuallySelected = selectionStore.isSelected(entry.key);

            entry.eligibility = {
                adapter: canonical,
                type: typeEnabled,
                date: insideDate
            };
            entry.manuallySelected = manuallySelected;
            duplicatesMerged += entry.duplicateCount || 0;

            if (insideDate) inDateRange++;
            else excludedByDate++;

            if (insideDate && !typeEnabled) excludedByType++;
            if (canonical && insideDate && typeEnabled) {
                eligible++;
                if (manuallySelected) selected++;
                else manuallyDeselected++;
            }
        }

        liveMetrics.update({
            found: entries.length,
            eligible,
            selected,
            duplicatesMerged
        });

        return {
            total: entries.length,
            inDateRange,
            excludedByDate,
            excludedByType,
            eligible,
            selected,
            manuallyDeselected,
            duplicatesMerged
        };
    }

    function selectedDateBoundaryReached(direction) {
        const range = getDateRangeConfig();
        if (!range.enabled || !range.valid) return null;

        const visible = visibleItemTimeRange();
        if (!visible) return null;

        if (
            direction === 'older' &&
            visible.maxMs < range.startMs
        ) {
            return {
                reason: 'date-start',
                label: `passed the From date (${range.startValue})`
            };
        }

        if (
            direction === 'newer' &&
            Number.isFinite(range.endExclusiveMs) &&
            visible.minMs >= range.endExclusiveMs
        ) {
            return {
                reason: 'date-end',
                label: `passed the To date (${range.endValue})`
            };
        }

        return null;
    }

    function scanBoundaryDescription(reason) {
        switch (reason) {
            case 'date-start':
                return 'selected From-date boundary';
            case 'date-end':
                return 'selected To-date boundary';
            case 'timeline-start':
                return 'timeline-start boundary';
            case 'timeline-end':
                return 'timeline-end boundary';
            default:
                return 'selected scan boundary';
        }
    }

    function dateRangeFilenameToken() {
        const range = getDateRangeConfig();
        if (!range.enabled || !range.valid) return 'all_dates';

        const end = range.endMode === 'specific'
            ? range.endValue
            : 'latest';

        return `${range.startValue}_to_${end}`;
    }

    function countMediaTypes(entries = [...mediaEntries.values()]) {
        let photos = 0;
        let videos = 0;
        let externalGifs = 0;

        for (const entry of entries) {
            if (entry.mediaType === 'video') videos++;
            else if (entry.mediaType === 'external-gif') externalGifs++;
            else photos++;
        }

        return { photos, videos, externalGifs };
    }

    function selectedArchiveKind(entries) {
        const { photos, videos, externalGifs } =
            countMediaTypes(entries);

        const selectedTypeCount = [
            photos,
            videos,
            externalGifs
        ].filter(value => value > 0).length;

        if (selectedTypeCount > 1) return 'media';
        if (videos) return 'videos';
        if (externalGifs) return 'external_gifs';
        return 'photos';
    }

    function takeAdaptiveWorkGroup(entries, startIndex) {
        const group = [];
        let estimatedBytes = 0;

        for (
            let index = startIndex;
            index < entries.length && group.length < ZIP_BATCH_MAX_ITEMS;
            index++
        ) {
            const entry = entries[index];
            const estimate = entry.mediaType === 'video'
                ? ESTIMATED_VIDEO_BYTES
                : entry.mediaType === 'external-gif'
                    ? ESTIMATED_EXTERNAL_GIF_BYTES
                    : ESTIMATED_PHOTO_BYTES;

            if (
                group.length > 0 &&
                estimatedBytes + estimate > WORK_BATCH_ESTIMATED_MAX_BYTES
            ) {
                break;
            }

            group.push(entry);
            estimatedBytes += estimate;
        }

        return group;
    }
    function mediaTypeIsEnabled(entry) {
        if (entry.kind === 'comment' || entry.kind === 'generated-document') {
            return true;
        }
        if (entry.mediaType === 'video') {
            return Boolean(videoCheckbox?.checked);
        }
        if (entry.mediaType === 'external-gif') {
            return Boolean(externalGifCheckbox?.checked);
        }
        return Boolean(photoCheckbox?.checked);
    }

    function countMediaTypes(entries = [...mediaEntries.values()]) {
        let photos = 0;
        let videos = 0;
        let externalGifs = 0;
        let comments = 0;
        let documents = 0;

        for (const entry of entries) {
            if (entry.kind === 'comment') comments++;
            else if (entry.kind === 'generated-document') documents++;
            else if (entry.mediaType === 'video') videos++;
            else if (entry.mediaType === 'external-gif') externalGifs++;
            else photos++;
        }

        return { photos, videos, externalGifs, comments, documents };
    }

    function selectedArchiveKind(entries) {
        const { photos, videos, externalGifs, comments, documents } =
            countMediaTypes(entries);
        const mediaCount = photos + videos + externalGifs;
        const textCount = comments + documents;
        if (mediaCount && textCount) return 'archive';
        if (textCount) return 'comments';
        const selectedTypeCount = [photos, videos, externalGifs]
            .filter(value => value > 0).length;
        if (selectedTypeCount > 1) return 'media';
        if (videos) return 'videos';
        if (externalGifs) return 'external_gifs';
        return 'photos';
    }

    function isScrollable(element) {
        if (!element || typeof element !== 'object') return false;
        if (typeof element.scrollTop !== 'number') return false;

        const height = Number(element.scrollHeight);
        const client = Number(element.clientHeight);
        if (!Number.isFinite(height) || !Number.isFinite(client)) return false;
        if (height <= client + 80) return false;

        const rect = element.getBoundingClientRect?.();
        if (rect && (rect.width < 40 || rect.height < 80)) return false;

        return true;
    }

    function canDriveScroller(element) {
        if (!isScrollable(element)) return false;

        const original = Number(element.scrollTop) || 0;
        const maximum = Math.max(
            0,
            Number(element.scrollHeight) - Number(element.clientHeight)
        );
        if (maximum < 2) return false;

        const probeDistance = Math.min(
            64,
            Math.max(8, Math.floor(Number(element.clientHeight) * 0.02))
        );
        const target = original < maximum / 2
            ? Math.min(maximum, original + probeDistance)
            : Math.max(0, original - probeDistance);

        if (Math.abs(target - original) < 1) return false;

        let moved = false;
        try {
            element.scrollTop = target;
            moved = Math.abs((Number(element.scrollTop) || 0) - original) >= 1;
        } catch {
            moved = false;
        }

        try {
            element.scrollTop = original;
        } catch {
            // A failed restore means this is not a safe scanner target.
            return false;
        }

        return moved;
    }

    function scrollPosition(scroller) {
        return {
            top: Math.round(scroller.scrollTop),
            height: Math.round(scroller.scrollHeight),
            client: Math.round(scroller.clientHeight)
        };
    }

    async function forceScrollToNewest(
        scroller,
        durationMs = FINAL_NEWEST_SETTLE_MS
    ) {
        const startedAt = performance.now();
        let stableRounds = 0;
        let previousHeight = -1;

        while (
            !stopRequested &&
            performance.now() - startedAt < durationMs
        ) {
            scroller.scrollTop = scroller.scrollHeight;
            scroller.dispatchEvent(
                new Event('scroll', { bubbles: true })
            );

            await sleep(350);
            scanVisiblePage();

            const position = scrollPosition(scroller);
            const distanceFromBottom =
                position.height -
                (position.top + position.client);

            const stable =
                distanceFromBottom <= 4 &&
                Math.abs(position.height - previousHeight) < 3;

            stableRounds = stable ? stableRounds + 1 : 0;
            previousHeight = position.height;

            if (
                stableRounds >= 5 &&
                performance.now() - startedAt >= 1800
            ) {
                break;
            }
        }

        // Virtualized timelines can move the viewport after the first
        // bottom jump. Re-apply the bottom position twice after settling.
        for (let pass = 0; pass < 2; pass++) {
            scroller.scrollTop = scroller.scrollHeight;
            scroller.dispatchEvent(
                new Event('scroll', { bubbles: true })
            );
            await sleep(500);
        }

        const finalPosition = scrollPosition(scroller);
        return (
            finalPosition.height -
            (finalPosition.top + finalPosition.client)
        ) <= 8;
    }

    async function restoreStartingAnchor(scroller, anchor) {
        if (!anchor) return false;

        for (
            let step = 0;
            step < RESTORE_POSITION_MAX_STEPS &&
            !stopRequested;
            step++
        ) {
            const element =
                findItemElementById(anchor.itemId);

            if (element) {
                const scrollerRect =
                    scroller.getBoundingClientRect();
                const delta =
                    element.getBoundingClientRect().top -
                    scrollerRect.top -
                    anchor.offset;

                scroller.scrollTop += delta;
                scroller.dispatchEvent(
                    new Event('scroll', { bubbles: true })
                );
                await sleep(500);
                return true;
            }

            if (!anchor.itemId) break;

            const ids = visibleItemIds();
            let oldest = null;
            let newest = null;

            for (const id of ids) {
                if (oldest === null || compareItemIds(id, oldest) < 0) {
                    oldest = id;
                }

                if (newest === null || compareItemIds(id, newest) > 0) {
                    newest = id;
                }
            }

            let direction = 0;

            if (
                oldest &&
                compareItemIds(anchor.itemId, oldest) < 0
            ) {
                direction = -1;
            } else if (
                newest &&
                compareItemIds(anchor.itemId, newest) > 0
            ) {
                direction = 1;
            }

            if (direction === 0) break;

            const position = scrollPosition(scroller);
            const stepSize = Math.max(
                Math.floor(position.client * 0.65),
                460
            );

            scroller.scrollTop += direction * stepSize;
            scroller.dispatchEvent(
                new Event('scroll', { bubbles: true })
            );
            await sleep(SCAN_DELAY_MS);
            scanVisiblePage();
        }

        // Best-effort fallback if the original item could not be found.
        const position = scrollPosition(scroller);
        scroller.scrollTop =
            anchor.scrollRatio *
            Math.max(0, position.height - position.client);
        scroller.dispatchEvent(
            new Event('scroll', { bubbles: true })
        );
        await sleep(500);

        return false;
    }

    function finalPositionDescription(value) {
        switch (value) {
            case 'scan-end':
                return 'Stay where the scan finished';
            case 'start':
                return 'Return to the original message window';
            default:
                return 'Move to the newest messages after scan / ZIP';
        }
    }

    async function applyFinalTimelinePosition(
        scroller,
        option,
        startingAnchor
    ) {
        if (stopRequested || option === 'scan-end') {
            return;
        }

        if (option === 'start') {
            setPhase('RETURNING TO ORIGINAL MESSAGE WINDOW');
            addLog(
                'Returning to the message window where the scan started.'
            );

            const exact = await restoreStartingAnchor(
                scroller,
                startingAnchor
            );

            addLog(
                exact
                    ? 'Original message window restored.'
                    : `Original message window could not be restored exactly because ${activeSiteAdapter.label} unloaded the anchor ${adapterTerm('item', 'item')}. An approximate position was applied.`,
                exact ? 'success' : 'warn'
            );
            return;
        }

        setPhase('MOVING TO NEWEST MESSAGES');
        addLog(
            `Moving toward the newest messages and waiting for the ${activeSiteAdapter.label} virtual timeline to settle.`
        );

        const reachedBottom =
            await forceScrollToNewest(scroller);

        addLog(
            reachedBottom
                ? 'Newest-message boundary verified.'
                : `${activeSiteAdapter.label} moved the virtual timeline again; the strongest newest-message correction was applied but arrival was not verified.`,
            reachedBottom ? 'success' : 'warn'
        );
    }

    async function moveToNewest(scroller) {
        setPhase('SCAN: moving toward newest messages');
        addLog('Moving toward the newest loaded messages first.');
        await forceScrollToNewest(scroller, 5_000);
    }

    function oldestVisibleItemId() {
        let oldest = null;

        for (const id of visibleItemIds()) {
            if (oldest === null || compareItemIds(id, oldest) < 0) {
                oldest = id;
            }
        }

        return oldest;
    }

    function isOlderItemId(candidate, baseline) {
        return Boolean(
            candidate &&
            baseline &&
            compareItemIds(candidate, baseline) < 0
        );
    }

    function adapterBoundaryConfirmMs() {
        const configured = Number(activeSiteAdapter?.boundaryConfirmMs);
        return Number.isFinite(configured) && configured >= 1_000
            ? configured
            : REAL_TOP_CONFIRM_MS;
    }

    async function expandActiveRenderedContent(scroller, direction) {
        const expand = activeSiteAdapter?.expandRenderedContent;
        if (typeof expand !== 'function' || stopRequested) return 0;

        try {
            const expanded = Number(await expand({ scroller, direction })) || 0;
            if (expanded > 0 && !stopRequested) {
                await sleep(300);
                scanVisiblePage();
                await sleep(300);
                scanVisiblePage();
            }
            return expanded;
        } catch (error) {
            diagnostics.warn(
                'ADAPTER_EXPANSION_FAILED',
                'A rendered-content expansion control could not be activated.',
                { adapterId: activeSiteAdapter?.id, direction },
                {
                    category: 'adapter',
                    userMessage: `${activeSiteAdapter?.label || 'The site'} could not expand one rendered “more” control. Scanning continues.`
                }
            );
            return 0;
        }
    }

    async function advanceScanWindow(scroller, direction, iteration) {
        const expanded = await expandActiveRenderedContent(scroller, direction);
        if (stopRequested) return { expanded, overlapVerified: true };

        if (typeof activeSiteAdapter?.jumpScanWindow === 'function') {
            const result = await activeSiteAdapter.jumpScanWindow({
                scroller,
                direction,
                iteration
            }) || {};

            scanVisiblePage();
            await sleep(120);
            scanVisiblePage();

            if (result.overlapVerified === false) {
                diagnostics.warn(
                    'SCAN_OVERLAP_NOT_VERIFIED',
                    'The previous virtual-timeline edge was not visible after a jump.',
                    {
                        adapterId: activeSiteAdapter.id,
                        direction,
                        overlapId: result.overlapId || null,
                        iteration,
                        continued: true
                    },
                    {
                        category: 'scan',
                        userMessage: 'A fast jump temporarily hid the previous overlap anchor. A recovery scan was attempted and scanning continues.'
                    }
                );
            }

            return { ...result, expanded };
        }

        const before = scrollPosition(scroller);
        const step = Math.max(Math.floor(before.client * 0.78), 520);
        scroller.scrollTop = direction === 'older'
            ? Math.max(0, before.top - step)
            : Math.min(scroller.scrollHeight, before.top + step);
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        await sleep(SCAN_DELAY_MS);
        scanVisiblePage();
        await sleep(120);
        scanVisiblePage();

        return {
            expanded,
            overlapVerified: true,
            before,
            after: scrollPosition(scroller)
        };
    }

    async function confirmRealTimelineStart(scroller) {
        const startedAt = performance.now();
        const confirmMs = adapterBoundaryConfirmMs();
        const baseline = {
            oldestId: oldestVisibleItemId(),
            mediaCount: mediaEntries.size,
            height: scrollPosition(scroller).height
        };

        addLog(
            `Possible oldest-message boundary reached. Waiting ${Math.ceil(confirmMs / 1000)} seconds for delayed older messages.`
        );

        while (!stopRequested) {
            await expandActiveRenderedContent(scroller, 'older');
            scroller.scrollTop = 0;
            scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
            await sleep(TOP_PROBE_INTERVAL_MS);
            scanVisiblePage();

            const current = scrollPosition(scroller);
            const currentOldestId = oldestVisibleItemId();
            const olderItemLoaded = isOlderItemId(
                currentOldestId,
                baseline.oldestId
            );
            const changed =
                olderItemLoaded ||
                mediaEntries.size > baseline.mediaCount ||
                Math.abs(current.height - baseline.height) >= 3 ||
                current.top > 8;

            if (changed) {
                addLog(
                    `${activeSiteAdapter.label} loaded older messages; scanning continues (${mediaEntries.size} media files found).`,
                    'success'
                );
                return false;
            }

            const elapsed = performance.now() - startedAt;
            const remaining = Math.max(0, confirmMs - elapsed);
            setPhase(
                `SCAN: confirming oldest-message boundary · ${Math.ceil(remaining / 1000)} s left`
            );

            if (remaining <= 0) {
                scanVisiblePage();
                return true;
            }
        }

        return false;
    }

    async function autoScrollToOldest(scroller) {
        const usesJumpScanner = typeof activeSiteAdapter?.jumpScanWindow === 'function';
        setPhase('SCAN: moving toward older messages');
        addLog(
            usesJumpScanner
                ? 'Fast older-message edge scan started. Each loaded edge is scanned with an overlap-anchor safety pass.'
                : 'Older-message scan started. A delayed confirmation runs at the possible oldest-message boundary.'
        );

        let iterations = 0;

        while (!stopRequested && iterations < 20_000) {
            iterations++;
            scanVisiblePage();
            const result = await advanceScanWindow(scroller, 'older', iterations);
            const after = result.after || scrollPosition(scroller);
            const dateBoundary = selectedDateBoundaryReached('older');

            if (dateBoundary) {
                lastScanBoundaryReason = dateBoundary.reason;
                addLog(
                    `Date boundary reached: ${dateBoundary.label}.`,
                    'success'
                );
                return true;
            }

            if (iterations % 25 === 0) {
                addLog(`Older-message scan running: ${mediaEntries.size} media files found.`);
            }

            if (after.top <= 5) {
                const reallyAtTop = await confirmRealTimelineStart(scroller);

                if (reallyAtTop) {
                    lastScanBoundaryReason = 'timeline-start';
                    addLog(
                        `No older messages appeared during the final ${Math.ceil(adapterBoundaryConfirmMs() / 1000)}-second confirmation. Oldest-message boundary confirmed.`,
                        'success'
                    );
                    return true;
                }
            }
        }

        return false;
    }

    function newestVisibleItemId() {
        let newest = null;

        for (const id of visibleItemIds()) {
            if (newest === null || compareItemIds(id, newest) > 0) {
                newest = id;
            }
        }

        return newest;
    }

    function isNewerItemId(candidate, baseline) {
        return Boolean(
            candidate &&
            baseline &&
            compareItemIds(candidate, baseline) > 0
        );
    }

    async function confirmRealTimelineEnd(scroller) {
        const startedAt = performance.now();
        const confirmMs = adapterBoundaryConfirmMs();
        const baseline = {
            newestId: newestVisibleItemId(),
            mediaCount: mediaEntries.size,
            height: scrollPosition(scroller).height
        };

        addLog(
            `Possible newest-message boundary reached. Waiting ${Math.ceil(confirmMs / 1000)} seconds for delayed newer messages or expansion controls.`
        );

        while (!stopRequested) {
            const expanded = await expandActiveRenderedContent(scroller, 'newer');
            if (expanded > 0) {
                addLog(
                    `${activeSiteAdapter.label} expanded ${expanded} rendered “more” control${expanded === 1 ? '' : 's'}; newer-message scanning continues.`,
                    'success'
                );
                return false;
            }

            scroller.scrollTop = scroller.scrollHeight;
            scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
            await sleep(TOP_PROBE_INTERVAL_MS);
            scanVisiblePage();

            const current = scrollPosition(scroller);
            const currentNewestId = newestVisibleItemId();
            const newerItemLoaded = isNewerItemId(
                currentNewestId,
                baseline.newestId
            );
            const distanceFromBottom =
                current.height - (current.top + current.client);

            const changed =
                newerItemLoaded ||
                mediaEntries.size > baseline.mediaCount ||
                Math.abs(current.height - baseline.height) >= 3 ||
                distanceFromBottom > 8;

            if (changed) {
                addLog(
                    `${activeSiteAdapter.label} loaded newer messages; scanning continues (${mediaEntries.size} media files found).`,
                    'success'
                );
                return false;
            }

            const elapsed = performance.now() - startedAt;
            const remaining = Math.max(0, confirmMs - elapsed);

            setPhase(
                `SCAN: confirming newest-message boundary · ${Math.ceil(remaining / 1000)} s left`
            );

            if (remaining <= 0) {
                scanVisiblePage();
                return true;
            }
        }

        return false;
    }

    async function autoScrollToNewest(scroller) {
        const usesJumpScanner = typeof activeSiteAdapter?.jumpScanWindow === 'function';
        setPhase('SCAN: moving toward newer messages');
        addLog(
            usesJumpScanner
                ? 'Fast newer-message edge scan started with overlap verification.'
                : 'Newer-message scan started. Expansion controls are activated when supported.'
        );

        let iterations = 0;

        while (!stopRequested && iterations < 20_000) {
            iterations++;
            scanVisiblePage();
            const result = await advanceScanWindow(scroller, 'newer', iterations);
            const after = result.after || scrollPosition(scroller);
            const dateBoundary = selectedDateBoundaryReached('newer');

            if (dateBoundary) {
                lastScanBoundaryReason = dateBoundary.reason;
                addLog(
                    `Date boundary reached: ${dateBoundary.label}.`,
                    'success'
                );
                return true;
            }

            const nearBottom =
                after.top + after.client >= after.height - 5;

            if (iterations % 25 === 0) {
                addLog(
                    `Newer-message scan running: ${mediaEntries.size} media files found.`
                );
            }

            if (nearBottom) {
                const reallyAtBottom =
                    await confirmRealTimelineEnd(scroller);

                if (reallyAtBottom) {
                    lastScanBoundaryReason = 'timeline-end';
                    addLog(
                        `No newer messages or expansion controls appeared during the final ${Math.ceil(adapterBoundaryConfirmMs() / 1000)}-second confirmation. Newest-message boundary confirmed.`,
                        'success'
                    );
                    return true;
                }
            }
        }

        return false;
    }

    function scanModeDescription(mode) {
        switch (mode) {
            case 'current-to-oldest':
                return 'Current position → older messages';
            case 'current-to-newest':
                return 'Current position → newer messages';
            case 'full-finish-down':
                return 'Automatic whole-channel scan';
            default:
                return 'Automatic latest-message seek → older messages';
        }
    }

    // ---------- Date-interval navigation ----------

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
        setPhase(`SEEK: ${direction} messages → ${label}`);
        addLog(
            `Fast seek started toward ${direction} messages. Media collection is paused until the ${label} boundary is reached.`
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
                setPhase(`SEEK COMPLETE: ${label}`);
                addLog(
                    `Date boundary located near ${label}. Safe overlap scanning starts now.`,
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
                setPhase(`SEEK: ${direction} messages · ${currentLabel}`);
            }

            if (noProgressRounds >= 7) {
                const error = new Error(
                    `Discord did not move toward ${direction} messages while seeking ${label}.`
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
            `Automatic date plan: seek ${plan.seekDirection} messages to the ${plan.targetBoundary} near ${targetLabel}, then scan ${plan.scanDirection} messages across the requested interval.`
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
    function abortActiveRequests() {
        runtime.abortAllRequests();
        activeRequests.clear();
    }

    async function requestArrayBuffer(url, attempt = 1) {
        if (stopRequested) {
            const error = new Error('Stopped by user');
            error.code = 'NETWORK_ABORTED';
            throw error;
        }

        const requestId = `archive-${Date.now().toString(36)}-${attempt}-${Math.random().toString(36).slice(2, 8)}`;
        try {
            return await runtime.fetchBinary(url, {
                requestId,
                timeoutMs: 120_000,
                accept: 'video/*,image/*,*/*;q=0.8'
            });
        } catch (error) {
            const retryable = error?.retryable === true;
            if (retryable && attempt < REQUEST_RETRIES && !stopRequested) {
                diagnostics.warn(
                    error.code || 'NETWORK_RETRY_EXHAUSTED',
                    `Download attempt ${attempt} failed; retrying.`,
                    { attempt, maximumAttempts: REQUEST_RETRIES },
                    { category: 'network', adapterId: activeSiteAdapter?.id }
                );
                await sleep(700 * attempt);
                return requestArrayBuffer(url, attempt + 1);
            }

            diagnostics.error(
                error?.code || 'NETWORK_RETRY_EXHAUSTED',
                'Original-file download failed.',
                error,
                {
                    attempt,
                    maximumAttempts: REQUEST_RETRIES,
                    continued: true
                },
                { category: 'network', adapterId: activeSiteAdapter?.id }
            );
            throw error;
        }
    }

    async function runWorkerPool(items, concurrency, worker) {
        let cursor = 0;

        async function runner() {
            while (!stopRequested) {
                const current = cursor++;
                if (current >= items.length) return;
                await worker(items[current], current);
            }
        }

        await Promise.all(
            Array.from(
                { length: Math.min(concurrency, items.length) },
                () => runner()
            )
        );
    }

    function uniqueArchiveName(index, entry, digits) {
        const width = Math.max(6, digits);
        const prefix = String(index + 1).padStart(width, '0');
        let extension = extensionFromPath(new URL(entry.url, location.href).pathname);

        if (!MEDIA_EXTENSIONS.has(extension)) {
            extension = extensionFromPath(`/${entry.filename}`);
        }

        if (!MEDIA_EXTENSIONS.has(extension)) {
            extension =
                entry.mediaType === 'video' ||
                entry.mediaType === 'external-gif'
                    ? '.mp4'
                    : '.jpg';
        }

        return `${prefix}${extension}`;
    }

    function csvCell(value) {
        const text = String(value ?? '');
        return `"${text.replace(/"/g, '""')}"`;
    }

    function buildManifest(entries, archiveNames) {
        const rows = [
            [
                'order_newest_to_oldest',
                'archive_filename',
                'original_filename',
                'media_type',
                'source_kind',
                'source_page_url',
                'item_id',
                'timestamp',
                'status',
                'size_bytes',
                'source_url'
            ].map(csvCell).join(',')
        ];

        entries.forEach((entry, index) => {
            rows.push([
                index + 1,
                archiveNames.get(entry.key) || '',
                entry.filename,
                entry.mediaType,
                entry.sourceKind || '',
                entry.sourcePageUrl || '',
                entry.itemId || '',
                entry.timestamp || '',
                entry.status,
                entry.size || 0,
                entry.url
            ].map(csvCell).join(','));
        });

        return '\uFEFF' + rows.join('\r\n');
    }

    function splitRecordsBySize(records, maximumBytes) {
        const groups = [];
        let current = [];
        let currentBytes = 0;

        for (const record of records) {
            const bytes = record.data.byteLength;

            if (current.length && currentBytes + bytes > maximumBytes) {
                groups.push(current);
                current = [];
                currentBytes = 0;
            }

            current.push(record);
            currentBytes += bytes;
        }

        if (current.length) groups.push(current);
        return groups;
    }

    function buildPartManifest(records, archiveNames, partNumber) {
        const rows = [[
            'order_newest_to_oldest',
            'zip_part',
            'archive_filename',
            'original_filename',
            'media_type',
            'source_kind',
            'source_page_url',
            'item_id',
            'timestamp',
            'size_bytes',
            'source_url'
        ].map(csvCell).join(',')];

        for (const record of records) {
            const entry = record.entry;
            rows.push([
                record.globalIndex + 1,
                partNumber,
                archiveNames.get(entry.key) || '',
                entry.filename,
                entry.mediaType,
                entry.sourceKind || '',
                entry.sourcePageUrl || '',
                entry.itemId || '',
                entry.timestamp || '',
                entry.size || 0,
                entry.url
            ].map(csvCell).join(','));
        }

        return '\uFEFF' + rows.join('\r\n');
    }

    function resolveFflateLibrary() {
        const candidates = [];

        try {
            if (typeof fflate !== 'undefined') {
                candidates.push(fflate);
            }
        } catch {
            // Ignore unavailable lexical global.
        }

        try {
            candidates.push(globalThis?.fflate);
        } catch {
            // Ignore.
        }

        try {
            candidates.push(window?.fflate);
        } catch {
            // Ignore.
        }

        try {
            if (typeof unsafeWindow !== 'undefined') {
                candidates.push(unsafeWindow?.fflate);
            }
        } catch {
            // Ignore.
        }

        return candidates.find(candidate =>
            candidate &&
            typeof candidate.zipSync === 'function' &&
            typeof candidate.strToU8 === 'function'
        ) || null;
    }

    function encodeUtf8(value) {
        const library = resolveFflateLibrary();

        if (library) {
            return library.strToU8(String(value));
        }

        return new TextEncoder().encode(String(value));
    }

    const FALLBACK_CRC32_TABLE = (() => {
        const table = new Uint32Array(256);

        for (let index = 0; index < 256; index++) {
            let value = index;

            for (let bit = 0; bit < 8; bit++) {
                value = (value & 1)
                    ? (0xEDB88320 ^ (value >>> 1))
                    : (value >>> 1);
            }

            table[index] = value >>> 0;
        }

        return table;
    })();

    async function fallbackCrc32(bytes) {
        let crc = 0xFFFFFFFF;
        const yieldChunkSize = 16 * 1024 * 1024;

        for (
            let offset = 0;
            offset < bytes.length;
            offset += yieldChunkSize
        ) {
            const end = Math.min(
                bytes.length,
                offset + yieldChunkSize
            );

            for (let index = offset; index < end; index++) {
                crc =
                    FALLBACK_CRC32_TABLE[
                        (crc ^ bytes[index]) & 0xFF
                    ] ^
                    (crc >>> 8);
            }

            await sleep(0);
        }

        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    function writeUint16(view, offset, value) {
        view.setUint16(offset, value, true);
    }

    function writeUint32(view, offset, value) {
        view.setUint32(offset, value >>> 0, true);
    }

    function currentDosDateTime(date = new Date()) {
        const year = Math.max(1980, date.getFullYear());

        return {
            time:
                (date.getHours() << 11) |
                (date.getMinutes() << 5) |
                Math.floor(date.getSeconds() / 2),
            date:
                ((year - 1980) << 9) |
                ((date.getMonth() + 1) << 5) |
                date.getDate()
        };
    }

    async function buildFallbackStoredZip(
        fileMap,
        onProgress = null
    ) {
        const files = Object.entries(fileMap).map(
            ([name, data]) => ({
                name,
                data:
                    data instanceof Uint8Array
                        ? data
                        : new Uint8Array(data)
            })
        );

        if (files.length > 0xFFFF) {
            throw new Error(
                'Built-in ZIP fallback supports at most 65,535 files per part.'
            );
        }

        const encoder = new TextEncoder();
        const localParts = [];
        const centralParts = [];
        const dos = currentDosDateTime();

        let localOffset = 0;
        let centralDirectorySize = 0;

        for (let index = 0; index < files.length; index++) {
            if (stopRequested) {
                throw new Error('Stopped by user');
            }

            const file = files[index];
            const filenameBytes = encoder.encode(file.name);
            const dataLength = file.data.byteLength;

            if (
                dataLength > 0xFFFFFFFF ||
                localOffset > 0xFFFFFFFF
            ) {
                throw new Error(
                    'A ZIP part exceeded the 4 GiB ZIP32 limit.'
                );
            }

            const crc = await fallbackCrc32(file.data);

            const localHeader =
                new Uint8Array(30 + filenameBytes.length);
            const localView =
                new DataView(localHeader.buffer);

            writeUint32(localView, 0, 0x04034B50);
            writeUint16(localView, 4, 20);
            writeUint16(localView, 6, 0x0800);
            writeUint16(localView, 8, 0);
            writeUint16(localView, 10, dos.time);
            writeUint16(localView, 12, dos.date);
            writeUint32(localView, 14, crc);
            writeUint32(localView, 18, dataLength);
            writeUint32(localView, 22, dataLength);
            writeUint16(
                localView,
                26,
                filenameBytes.length
            );
            writeUint16(localView, 28, 0);
            localHeader.set(filenameBytes, 30);

            const centralHeader =
                new Uint8Array(46 + filenameBytes.length);
            const centralView =
                new DataView(centralHeader.buffer);

            writeUint32(centralView, 0, 0x02014B50);
            writeUint16(centralView, 4, 20);
            writeUint16(centralView, 6, 20);
            writeUint16(centralView, 8, 0x0800);
            writeUint16(centralView, 10, 0);
            writeUint16(centralView, 12, dos.time);
            writeUint16(centralView, 14, dos.date);
            writeUint32(centralView, 16, crc);
            writeUint32(centralView, 20, dataLength);
            writeUint32(centralView, 24, dataLength);
            writeUint16(
                centralView,
                28,
                filenameBytes.length
            );
            writeUint16(centralView, 30, 0);
            writeUint16(centralView, 32, 0);
            writeUint16(centralView, 34, 0);
            writeUint16(centralView, 36, 0);
            writeUint32(centralView, 38, 0);
            writeUint32(
                centralView,
                42,
                localOffset
            );
            centralHeader.set(filenameBytes, 46);

            localParts.push(localHeader, file.data);
            centralParts.push(centralHeader);

            localOffset +=
                localHeader.byteLength +
                dataLength;
            centralDirectorySize +=
                centralHeader.byteLength;

            onProgress?.({
                completed: index + 1,
                total: files.length,
                percent:
                    ((index + 1) / files.length) * 100
            });
        }

        if (
            localOffset > 0xFFFFFFFF ||
            centralDirectorySize > 0xFFFFFFFF
        ) {
            throw new Error(
                'A ZIP part exceeded the 4 GiB ZIP32 limit.'
            );
        }

        const endRecord = new Uint8Array(22);
        const endView = new DataView(endRecord.buffer);

        writeUint32(endView, 0, 0x06054B50);
        writeUint16(endView, 4, 0);
        writeUint16(endView, 6, 0);
        writeUint16(endView, 8, files.length);
        writeUint16(endView, 10, files.length);
        writeUint32(
            endView,
            12,
            centralDirectorySize
        );
        writeUint32(endView, 16, localOffset);
        writeUint16(endView, 20, 0);

        return new Blob(
            [...localParts, ...centralParts, endRecord],
            { type: 'application/zip' }
        );
    }

    async function createZipBlob(
        files,
        onProgress = null
    ) {
        const library = resolveFflateLibrary();

        if (library) {
            const zippedBytes = library.zipSync(
                files,
                { level: 0 }
            );

            onProgress?.({
                completed: Object.keys(files).length,
                total: Object.keys(files).length,
                percent: 100
            });

            return {
                blob: new Blob(
                    [zippedBytes],
                    { type: 'application/zip' }
                ),
                backend: 'fflate'
            };
        }

        diagnostics.warn(
            'ZIP_FALLBACK_ACTIVE',
            'The optional ZIP library is unavailable; using the built-in ZIP writer.',
            {},
            { category: 'zip', userMessage: 'Using the built-in ZIP fallback; archive creation may take longer.' }
        );

        return {
            blob: await buildFallbackStoredZip(
                files,
                onProgress
            ),
            backend: 'built-in'
        };
    }

    function downloadZipBlob(blob, filename) {
        return runtime.saveBlob(blob, filename);
    }

    let reviewArchiveConfirmed = false;
    let activeArchiveNamePlan = null;

    async function createAndDownloadZipParts() {
        const reviewMode = getAfterScanMode() === 'review';
        if (reviewMode && !reviewArchiveConfirmed) {
            openLibrary();
            setPhase('REVIEW READY');
            addLog(
                'Review mode is active. Confirm “Archive selected” in the Library before original files are downloaded.'
            );
            return;
        }

        const selectedEntries = selectedMediaEntries();

        if (packing || selectedEntries.length === 0) {
            if (!packing && selectedEntries.length === 0) {
                setPhase('NOTHING SELECTED');
                addLog(
                    'No eligible selected items are available. Adjust filters or select items in the Library.',
                    'warn'
                );
            }
            reviewArchiveConfirmed = false;
            return;
        }

        packing = true;
        running = true;
        scanning = false;
        stopRequested = false;
        resetEntryStatuses();
        updateButtons();

        const rawSelectedEntries = [...selectedEntries];
        const archiveContext = activeSiteAdapter.getArchiveContext();
        const preparedArchive = globalThis.MediaArchiverCommentExport
            ? globalThis.MediaArchiverCommentExport.prepareArchiveItems(
                rawSelectedEntries,
                archiveContext
            )
            : {
                selectedCommentCount: 0,
                selectedBinaryCount: rawSelectedEntries.length,
                finalItems: rawSelectedEntries
            };
        const entries = [...preparedArchive.finalItems];
        const namingSettings = currentNamingSettings();

        if (!entries.length) {
            packing = false;
            running = false;
            reviewArchiveConfirmed = false;
            setPhase('NOTHING TO ARCHIVE');
            addLog('The confirmed selection produced no archive items.', 'warn');
            updateButtons();
            return;
        }

        try {
            activeArchiveNamePlan = globalThis.MediaArchiverNaming.planArchiveNames(
                entries,
                namingSettings,
                {
                    site: activeSiteAdapter.id,
                    adapterLabel: activeSiteAdapter.label,
                    sourceLabel: archiveContext.label || activeSiteAdapter.label
                }
            );
        } catch (error) {
            packing = false;
            running = false;
            reviewArchiveConfirmed = false;
            setPhase('NAMING ERROR');
            diagnostics.error(
                error.code || 'NAMING_PLAN_FAILED',
                'Final archive names could not be planned.',
                error,
                { selectedCount: rawSelectedEntries.length, finalItemCount: entries.length },
                {
                    category: 'naming',
                    userMessage: `Archive naming failed. Correct the File naming settings and try again. Code: ${error.code || 'NAMING_PLAN_FAILED'}`
                }
            );
            addLog(
                `Archive naming failed. Correct the File naming settings and try again. Code: ${error.code || 'NAMING_PLAN_FAILED'}`,
                'error'
            );
            updateButtons();
            return;
        }

        const archiveNames = activeArchiveNamePlan.namesByKey;
        const stamp = new Date()
            .toISOString()
            .slice(0, 16)
            .replace('T', '_')
            .replace(':', '-');
        const archiveKind = selectedArchiveKind(entries);
        const selectedCounts = countMediaTypes(rawSelectedEntries);
        const initialZipLibrary = resolveFflateLibrary();
        const initialStats = selectionStatistics();

        liveMetrics.startSession({ phase: 'fetching-selected' });
        liveMetrics.update({
            found: initialStats.total,
            eligible: initialStats.eligible,
            selected: rawSelectedEntries.length,
            duplicatesMerged: initialStats.duplicatesMerged,
            totalItems: entries.length
        });

        try {
            if (workflowState.phase === globalThis.MediaArchiverWorkflowState.phases.REVIEWING ||
                workflowState.phase === globalThis.MediaArchiverWorkflowState.phases.REVIEW_READY) {
                workflowState.transition(globalThis.MediaArchiverWorkflowState.phases.FETCHING_SELECTED);
            }
        } catch {
            // Compatibility state is diagnostic only during incremental migration.
        }

        addLog(
            initialZipLibrary
                ? 'ZIP engine: fflate loaded successfully.'
                : 'ZIP engine: fflate is unavailable. Using the built-in Firefox-safe ZIP fallback; ZIP creation may take longer.',
            initialZipLibrary ? 'success' : 'warn'
        );

        let zipPart = 0;
        let zippedCount = 0;
        let errorCount = 0;
        let groupStart = 0;
        let savedGeneratedDocumentCount = 0;

        const contentSummary = [
            `${selectedCounts.photos} photos/native GIFs`,
            `${selectedCounts.videos} videos`,
            `${selectedCounts.externalGifs} rendered GIF previews`,
            `${preparedArchive.selectedCommentCount} comments`
        ].join(', ');
        addLog(
            `${rawSelectedEntries.length} selected records (${contentSummary}). ` +
            `${preparedArchive.selectedCommentCount ? 'Selected comments will be generated locally as comments.json, comments.md, and comments.csv. ' : ''}` +
            `Only ${preparedArchive.selectedBinaryCount} selected media originals can create network requests. ` +
            `Using ${DOWNLOAD_CONCURRENCY} parallel media downloads.`
        );

        while (groupStart < entries.length && !stopRequested) {
            const group = takeAdaptiveWorkGroup(entries, groupStart);
            if (!group.length) break;

            const records = new Array(group.length);
            let finishedInGroup = 0;
            let bytesInGroup = 0;
            const binaryItemsInGroup = group.filter(entry => entry.kind === 'media').length;

            setPhase(
                `PREPARING CONFIRMED ITEMS: ${groupStart + 1}–` +
                `${groupStart + group.length}/${entries.length}`
            );
            liveMetrics.setPhase('fetching-selected');
            liveMetrics.update({
                downloading: binaryItemsInGroup,
                currentItem: groupStart,
                totalItems: entries.length
            });

            await runWorkerPool(
                group,
                DOWNLOAD_CONCURRENCY,
                async (entry, localIndex) => {
                    if (stopRequested) return;

                    entry.status = STATUS.FETCHING;
                    entry.error = '';
                    scheduleRender();
                    updateLibraryCardState(entry.key);

                    try {
                        let data;
                        if (entry.kind === 'generated-document') {
                            data = entry.payload.generatedBytes instanceof Uint8Array
                                ? entry.payload.generatedBytes
                                : encodeUtf8(entry.payload.generatedText || '');
                        } else if (entry.kind === 'media') {
                            const buffer = await requestArrayBuffer(entry.url);
                            if (stopRequested) return;
                            data = new Uint8Array(buffer);
                            liveMetrics.record('downloaded', 1);
                            liveMetrics.record('bytesDownloaded', buffer.byteLength);
                        } else {
                            const error = new Error(`No archive handler for item kind ${entry.kind}.`);
                            error.code = 'ARCHIVE_HANDLER_UNAVAILABLE';
                            throw error;
                        }

                        entry.size = data.byteLength;
                        bytesInGroup += data.byteLength;
                        records[localIndex] = {
                            entry,
                            globalIndex: groupStart + localIndex,
                            data
                        };
                    } catch (error) {
                        if (stopRequested) return;

                        entry.status = STATUS.ERROR;
                        entry.error = error?.message || String(error);
                        errorCount++;
                        liveMetrics.record('errors', 1);
                        addLog(
                            `Failed: ${entry.filename || entry.key} — ${entry.error}. Remaining selected items continue. Code: ${error?.code || 'NETWORK_RETRY_EXHAUSTED'}`,
                            'error'
                        );
                    }

                    finishedInGroup++;
                    liveMetrics.update({
                        currentItem: groupStart + finishedInGroup,
                        downloading: Math.max(
                            0,
                            group.slice(finishedInGroup)
                                .filter(candidate => candidate.kind === 'media').length
                        )
                    });
                    setPhase(
                        `PREPARING CONFIRMED ITEMS: ${finishedInGroup}/${group.length} · ` +
                        `${formatBytes(bytesInGroup)}`
                    );
                    progressFill.style.width =
                        `${(finishedInGroup / group.length) * 100}%`;
                    scheduleRender();
                    updateLibraryCardState(entry.key);
                }
            );

            if (stopRequested) break;

            const successfulRecords = records.filter(Boolean);
            const sizeGroups = splitRecordsBySize(
                successfulRecords,
                ZIP_MAX_BYTES
            );
            liveMetrics.update({ totalZipPartsKnown: zipPart + sizeGroups.length });

            for (const partRecords of sizeGroups) {
                if (stopRequested) break;

                zipPart++;
                const partLabel = String(zipPart).padStart(3, '0');
                const files = {};

                for (const record of partRecords) {
                    const archiveName = archiveNames.get(record.entry.key);
                    if (!archiveName) {
                        throw new Error(`Immutable naming plan is missing ${record.entry.key}.`);
                    }
                    record.entry.part = zipPart;
                    files[archiveName] = record.data;
                }

                files['manifest_part.csv'] = encodeUtf8(
                    buildPartManifest(
                        partRecords,
                        archiveNames,
                        zipPart
                    )
                );

                setPhase(
                    `CREATING ZIP PART ${partLabel}: ` +
                    `${partRecords.length} files`
                );
                liveMetrics.setPhase('packing');
                liveMetrics.update({
                    currentZipPart: zipPart,
                    currentItem: 0,
                    totalItems: partRecords.length
                });
                progressFill.style.width = '0%';
                await sleep(20);

                let zipResult;
                try {
                    zipResult = await createZipBlob(
                        files,
                        progress => {
                            liveMetrics.update({ currentItem: progress.completed });
                            setPhase(
                                `CREATING ZIP PART ${partLabel}: ` +
                                `${progress.completed}/${progress.total} files · ` +
                                `${progress.percent.toFixed(0)}%`
                            );
                            progressFill.style.width =
                                `${progress.percent}%`;
                        }
                    );
                } catch (error) {
                    addLog(
                        `ZIP part ${partLabel} failed for ${partRecords.length} files. Remaining work continues when possible. Try smaller ZIP limits. Code: ZIP_PART_BUILD_FAILED`,
                        'error'
                    );
                    diagnostics.error(
                        'ZIP_PART_BUILD_FAILED',
                        `ZIP part ${partLabel} failed.`,
                        error,
                        { affectedFiles: partRecords.length, zipPart, continued: true },
                        { category: 'zip' }
                    );
                    errorCount += partRecords.length;
                    liveMetrics.record('errors', partRecords.length);

                    for (const record of partRecords) {
                        record.entry.status = STATUS.ERROR;
                        record.entry.error = `ZIP: ${error.message}`;
                        updateLibraryCardState(record.entry.key);
                    }
                    continue;
                }

                const blob = zipResult.blob;
                const usedZipBackend = zipResult.backend;
                const filename =
                    `${activeSiteAdapter.archivePrefix}_${archiveKind}_${archiveContext.id}_` +
                    `${dateRangeFilenameToken()}_${stamp}_part_${partLabel}.zip`;

                try {
                    await downloadZipBlob(blob, filename);
                } catch (error) {
                    diagnostics.error(
                        'RUNTIME_SAVE_FAILED',
                        `Saving ZIP part ${partLabel} failed.`,
                        error,
                        { affectedFiles: partRecords.length, zipPart, continued: false },
                        { category: 'runtime' }
                    );
                    throw error;
                }

                for (const record of partRecords) {
                    record.entry.status = STATUS.PACKED;
                    zippedCount++;
                    if (record.entry.kind === 'generated-document') {
                        savedGeneratedDocumentCount++;
                    }
                    liveMetrics.record('saved', 1);
                    record.data = null;
                    updateLibraryCardState(record.entry.key);
                }

                zipResult = null;
                progressFill.style.width = '100%';
                scheduleRender();
                updateCounters();
                addLog(
                    `ZIP part ${partLabel}: ${partRecords.length} files, ` +
                    `${formatBytes(blob.size)}, engine ${usedZipBackend}; ` +
                    `sent to the browser.`,
                    'success'
                );

                await sleep(900);
            }

            groupStart += group.length;
        }

        abortActiveRequests();
        packing = false;
        running = false;
        reviewArchiveConfirmed = false;

        if (savedGeneratedDocumentCount > 0) {
            for (const entry of rawSelectedEntries) {
                if (entry.kind === 'comment') {
                    entry.status = STATUS.PACKED;
                    updateLibraryCardState(entry.key);
                }
            }
        }

        if (stopRequested) {
            setPhase(`STOPPED: ${zippedCount} files already saved`);
            addLog(
                'The operation was stopped. Completed ZIP parts remain available.',
                'warn'
            );
            liveMetrics.stopSession({ phase: 'scan-stopped' });
        } else {
            setPhase('FINISHED');
            progressFill.style.width = '100%';
            addLog(
                `Finished: ${zippedCount} archive files in ${zipPart} ZIP parts, ` +
                `${errorCount} errors.`,
                errorCount ? 'warn' : 'success'
            );
            liveMetrics.stopSession({ phase: 'completed' });
            diagnostics.endSession({
                selectedRecords: rawSelectedEntries.length,
                selectedComments: preparedArchive.selectedCommentCount,
                binaryRequestsPlanned: preparedArchive.selectedBinaryCount,
                archiveFilesSaved: zippedCount,
                errors: errorCount,
                zipParts: zipPart
            });
        }

        activeArchiveNamePlan = null;
        updateButtons();
        updateCounters();
        renderNamingPreview();
    }

    async function archiveSelectedFromLibrary() {
        const selected = selectedMediaEntries();
        if (!selected.length) {
            setLibraryMessage('Select at least one eligible item before archiving.', true);
            return;
        }

        reviewArchiveConfirmed = true;
        closeLibrary();
        await createAndDownloadZipParts();
    }
    function getAfterScanMode() {
        return autoZipCheckbox?.checked ? 'quick' : 'review';
    }

    function syncWorkflowMode() {
        const mode = getAfterScanMode();
        try {
            if (workflowState.phase === globalThis.MediaArchiverWorkflowState.phases.COMPLETED) {
                workflowState.transition(globalThis.MediaArchiverWorkflowState.phases.IDLE);
            }
            if (workflowState.phase === globalThis.MediaArchiverWorkflowState.phases.IDLE) {
                workflowState.setMode(mode);
            }
        } catch {
            // State reporting must never break the established scanner.
        }
        return mode;
    }

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
            // Compatibility state is diagnostic only during incremental migration.
        }
        updateButtons();

        const scanMode = scanDirectionSelect.value;
        const dateRange = getDateRangeConfig();

        if (!dateRange.valid) {
            running = false;
            scanning = false;
            setPhase('DATE RANGE ERROR');
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
            `Scan started on ${activeSiteAdapter.label}. Mode: ` +
            `${scanModeDescription(scanMode)}. After scan: ` +
            `${afterScanMode === 'quick' ? 'Quick archive' : 'Review before archive'}.`
        );

        if (dateRange.enabled) {
            addLog(
                `Date range: ${dateRange.label}. Calendar days use your browser's local time zone.`
            );
        }

        await sleep(300);

        const scroller = findTimelineScroller();
        if (!scroller) {
            running = false;
            scanning = false;
            setPhase('ERROR');
            liveMetrics.stopSession({ phase: 'error', errors: 1 });
            diagnostics.error(
                'ADAPTER_TIMELINE_NOT_FOUND',
                'The active adapter could not find its timeline or scroller.',
                null,
                { adapterId: activeSiteAdapter.id, continued: false },
                {
                    category: 'adapter',
                    userMessage: `${activeSiteAdapter.label} ${adapterTerm('timeline', 'timeline')} was not found. ${activeSiteAdapter.openTargetHelp || ''}`.trim()
                }
            );
            addLog(
                `${activeSiteAdapter.label} ${adapterTerm('timeline', 'timeline')} was not found. ${activeSiteAdapter.openTargetHelp || ''} Code: ADAPTER_TIMELINE_NOT_FOUND`.trim(),
                'error'
            );
            updateButtons();
            return;
        }

        scanVisiblePage();
        const startingAnchor = captureStartingAnchor(scroller);
        let reachedBoundary = false;
        let completedBoundaryLabel = '';

        if (scanMode === 'newest-to-oldest') {
            await moveToNewest(scroller);

            if (stopRequested) {
                finishStoppedScan();
                return;
            }

            reachedBoundary = await autoScrollToOldest(scroller);
            completedBoundaryLabel = scanBoundaryDescription(
                lastScanBoundaryReason
            );
        } else if (scanMode === 'current-to-oldest') {
            reachedBoundary = await autoScrollToOldest(scroller);
            completedBoundaryLabel = scanBoundaryDescription(
                lastScanBoundaryReason
            );
        } else if (scanMode === 'current-to-newest') {
            reachedBoundary = await autoScrollToNewest(scroller);
            completedBoundaryLabel = scanBoundaryDescription(
                lastScanBoundaryReason
            );
        } else if (scanMode === 'full-finish-down') {
            addLog(
                'Full timeline mode: first scanning from the current position to the timeline start.'
            );

            const reachedTop = await autoScrollToOldest(scroller);

            if (stopRequested) {
                finishStoppedScan();
                return;
            }

            if (reachedTop) {
                addLog(
                    `${scanBoundaryDescription(lastScanBoundaryReason)} confirmed. ` +
                    'Now scanning downward toward the selected end boundary.',
                    'success'
                );

                lastScanBoundaryReason = '';
                reachedBoundary = await autoScrollToNewest(scroller);
                completedBoundaryLabel = scanBoundaryDescription(
                    lastScanBoundaryReason
                );
            } else {
                reachedBoundary = false;
                completedBoundaryLabel = 'timeline-start boundary';
                addLog(
                    'The first scan did not confirm the timeline-start boundary, so the downward full-timeline pass was not started.',
                    'warn'
                );
            }
        }

        scanning = false;

        if (stopRequested) {
            finishStoppedScan();
            return;
        }

        running = false;
        updateCounters();
        updateButtons();

        if (reachedBoundary) {
            setPhase(`SCAN FINISHED: ${mediaEntries.size} items`);
            addLog(
                `Scan completed at the ${completedBoundaryLabel}: ` +
                `${mediaEntries.size} unique items found.`,
                'success'
            );
        } else {
            setPhase(`SCAN ENDED: ${mediaEntries.size} items`);
            addLog(
                'The scan stopped at the safety iteration limit or could not confirm the selected boundary.',
                'warn'
            );
        }

        const statsAfterScan = selectionStatistics();
        addLog(
            `Selection summary: ${statsAfterScan.total} canonical items, ` +
            `${statsAfterScan.eligible} eligible, ` +
            `${statsAfterScan.selected} selected, ` +
            `${statsAfterScan.duplicatesMerged} duplicate discoveries merged.`
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
                // State reporting must not break archive execution.
            }
            if (selectedAfterScan.length > 0) {
                await createAndDownloadZipParts();
            } else {
                liveMetrics.stopSession({ phase: 'completed' });
                setPhase('SCAN FINISHED: NOTHING ELIGIBLE');
                addLog('The scan finished, but no eligible items matched the current filters.', 'warn');
            }
            return;
        }

        try {
            workflowState.afterScan();
        } catch {
            // State reporting must not break review.
        }
        liveMetrics.stopSession({ phase: 'review-ready' });
        setPhase(`REVIEW READY: ${statsAfterScan.selected} selected`);
        addLog(
            'Review is ready. No original files have been requested. Confirm “Archive selected” in the Library to begin downloads.',
            'success'
        );
        openLibrary();
    }

    function finishStoppedScan() {
        scanning = false;
        running = false;
        const afterScanMode = getAfterScanMode();
        const stats = selectionStatistics();

        try {
            workflowState.afterScan({ stopped: true });
        } catch {
            // State reporting must not break partial review.
        }

        if (afterScanMode === 'review' && stats.total > 0) {
            stopRequested = false;
            liveMetrics.stopSession({ phase: 'review-ready' });
            setPhase(`PARTIAL REVIEW READY: ${stats.selected} selected`);
            addLog(
                `Scanning stopped manually. Review the ${stats.total} unique items collected so far; no original files have been requested.`,
                'warn'
            );
            updateButtons();
            openLibrary();
            return;
        }

        liveMetrics.stopSession({ phase: 'scan-stopped' });
        setPhase(`STOPPED: ${mediaEntries.size} items collected`);
        addLog(
            'Scrolling stopped. Use the Library or archive action to save the eligible items found so far.',
            'warn'
        );
        updateButtons();
    }

    function requestStop() {
        if (!running && !packing && !scanning) return;

        stopRequested = true;
        abortActiveRequests();
        setPhase('STOPPING …');
        addLog('Stop requested.', 'warn');
        updateButtons();
    }

    function resetEntryStatuses() {
        for (const entry of mediaEntries.values()) {
            entry.status = STATUS.COLLECTED;
            entry.error = '';
            entry.size = 0;
        }
        scheduleRender();
        scheduleLibraryRender();
    }

    function resetCollection() {
        if (running || packing || scanning) return;

        mediaEntries.clear();
        selectionStore.removeMissing(new Set());
        firstSeenCounter = 0;
        activeArchiveNamePlan = null;
        reviewArchiveConfirmed = false;
        progressFill.style.width = '0%';
        mediaList.replaceChildren();
        if (typeof libraryItemsElement !== 'undefined') {
            libraryItemsElement.replaceChildren();
        }
        updateCounters();
        setPhase('READY');
        renderNamingPreview();
    }

    function formatBytes(bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        const power = Math.min(
            Math.floor(Math.log(bytes) / Math.log(1024)),
            units.length - 1
        );
        return `${(bytes / (1024 ** power)).toFixed(power ? 1 : 0)} ${units[power]}`;
    }

    function formatElapsed(milliseconds) {
        const seconds = Math.max(0, Math.floor((milliseconds || 0) / 1000));
        const minutes = Math.floor(seconds / 60);
        const remaining = seconds % 60;
        return `${minutes}:${String(remaining).padStart(2, '0')}`;
    }

    function statusIcon(entry) {
        if (!isEntryIncluded(entry) && entry.status === STATUS.COLLECTED) {
            return ['–', entrySkipReason(entry), 'skipped'];
        }

        if (!selectionStore.isSelected(entry.key) && entry.status === STATUS.COLLECTED) {
            return ['○', 'Deselected in the Library', 'skipped'];
        }

        switch (entry.status) {
            case STATUS.FETCHING:
                return ['…', 'Downloading selected original', 'fetching'];
            case STATUS.PACKED:
                return ['✓', 'Saved in ZIP', 'packed'];
            case STATUS.ERROR:
                return ['!', entry.error || 'Error', 'error'];
            default:
                return ['●', 'Selected for archive', 'collected'];
        }
    }

    function scheduleRender() {
        clearTimeout(renderTimer);
        renderTimer = setTimeout(renderMediaList, 120);
    }

    function renderMediaList() {
        const entries = sortedMediaEntries();
        const fragment = document.createDocumentFragment();

        entries.forEach((entry, index) => {
            const row = document.createElement('div');
            row.className = `ma-row ma-${entry.status}`;
            if (!isEntryIncluded(entry) || !selectionStore.isSelected(entry.key)) {
                row.classList.add('ma-skipped');
            }

            let thumbnail;

            if (
                entry.mediaType === 'video' ||
                entry.mediaType === 'external-gif'
            ) {
                thumbnail = document.createElement('div');
                thumbnail.className = 'ma-thumb ma-video-thumb';
                thumbnail.textContent =
                    entry.mediaType === 'external-gif'
                        ? 'GIF'
                        : '▶';
            } else {
                thumbnail = document.createElement('img');
                thumbnail.className = 'ma-thumb';
                thumbnail.loading = 'lazy';
                thumbnail.referrerPolicy = 'no-referrer';
                thumbnail.src = entry.previewUrl;
                thumbnail.alt = '';
            }

            const details = document.createElement('div');
            details.className = 'ma-details';

            const name = document.createElement('div');
            name.className = 'ma-name';
            name.textContent =
                `${String(index + 1).padStart(4, '0')} · ${entry.filename}`;
            name.title = entry.filename;

            const meta = document.createElement('div');
            meta.className = 'ma-meta';
            meta.textContent = [
                entry.mediaType === 'external-gif'
                    ? 'EXTERNAL GIF PREVIEW'
                    : entry.mediaType.toUpperCase(),
                entry.timestamp
                    ? new Date(entry.timestamp).toLocaleString('en-GB')
                    : 'Time unknown',
                entry.size ? formatBytes(entry.size) : '',
                entry.duplicateCount ? `${entry.duplicateCount} duplicates merged` : ''
            ].filter(Boolean).join(' · ');

            details.append(name, meta);

            const [symbol, title, className] = statusIcon(entry);
            const status = document.createElement('div');
            status.className = `ma-check ma-check-${className}`;
            status.textContent = symbol;
            status.title = title;

            row.append(thumbnail, details, status);
            fragment.appendChild(row);
        });

        mediaList.replaceChildren(fragment);
        updateCounters();
    }

    function diagnosticCategoryForMessage(message) {
        if (/zip/i.test(message)) return 'zip';
        if (/download|http|network/i.test(message)) return 'network';
        if (/scan|timeline|boundary/i.test(message)) return 'scan';
        if (/select|review|library/i.test(message)) return 'selection';
        return 'runtime';
    }

    function addLog(message, type = 'info') {
        const level = ['success', 'warn', 'error', 'debug'].includes(type)
            ? type
            : 'info';
        const category = diagnosticCategoryForMessage(message);
        const codeMatch = String(message).match(/Code:\s*([A-Z0-9_]+)/);
        const code = codeMatch?.[1] || 'ACTIVITY_MESSAGE';

        if (level === 'error') {
            diagnostics.error(code, 'User-visible operation error.', null, {
                phase: workflowState.phase,
                continued: !stopRequested
            }, { category, userMessage: String(message) });
        } else {
            diagnostics[level]?.(
                code,
                'User-visible activity event.',
                { phase: workflowState.phase },
                { category, userMessage: String(message) }
            );
        }

        const line = document.createElement('div');
        line.className = `ma-log-line ma-log-${type}`;
        const time = new Date().toLocaleTimeString('en-GB');
        line.textContent = `[${time}] ${message}`;
        logArea.appendChild(line);
        while (logArea.childElementCount > 250) {
            logArea.firstElementChild?.remove();
        }
        logArea.scrollTop = logArea.scrollHeight;
    }

    function setPhase(value) {
        phaseElement.textContent = value;
        liveMetrics.setPhase(String(value).toLowerCase());
    }

    function refreshLiveMetrics(snapshot) {
        if (!snapshot || !foundElement) return;
        foundElement.textContent = String(snapshot.found);
        selectedCountElement.textContent = String(snapshot.selected);
        packedElement.textContent = String(snapshot.saved);
        errorElement.textContent = String(snapshot.errors);
        selectedSummaryElement.textContent = `${snapshot.selected} selected`;
        if (typeof duplicateCountElement !== 'undefined' && duplicateCountElement) {
            duplicateCountElement.textContent = String(snapshot.duplicatesMerged);
        }
        if (typeof downloadedCountElement !== 'undefined' && downloadedCountElement) {
            downloadedCountElement.textContent = String(snapshot.downloaded);
        }
        if (typeof bytesCountElement !== 'undefined' && bytesCountElement) {
            bytesCountElement.textContent = formatBytes(snapshot.bytesDownloaded);
        }
        if (typeof elapsedElement !== 'undefined' && elapsedElement) {
            elapsedElement.textContent = formatElapsed(snapshot.elapsedMs);
        }
        if (typeof librarySelectedCountElement !== 'undefined' && librarySelectedCountElement) {
            librarySelectedCountElement.textContent = String(snapshot.selected);
        }
    }

    function updateCounters() {
        let packedCount = 0;
        let errorCount = 0;
        let downloadedCount = 0;
        let bytesDownloaded = 0;

        for (const entry of mediaEntries.values()) {
            if (entry.status === STATUS.PACKED) packedCount++;
            if (entry.status === STATUS.ERROR) errorCount++;
            if (entry.size > 0) {
                downloadedCount++;
                bytesDownloaded += entry.size;
            }
        }

        const counts = countMediaTypes();
        const stats = selectionStatistics();

        liveMetrics.update({
            found: stats.total,
            eligible: stats.eligible,
            selected: stats.selected,
            duplicatesMerged: stats.duplicatesMerged,
            downloaded: downloadedCount,
            saved: packedCount,
            errors: errorCount,
            bytesDownloaded
        });

        foundElement.textContent = String(stats.total);
        photoCountElement.textContent = String(counts.photos);
        videoCountElement.textContent = String(counts.videos);
        externalGifCountElement.textContent =
            String(counts.externalGifs);
        inRangeElement.textContent =
            String(stats.inDateRange);
        excludedDateElement.textContent =
            String(stats.excludedByDate);
        selectedCountElement.textContent =
            String(stats.selected);
        selectedSummaryElement.textContent = `${stats.selected} selected`;
        mediaTabCount.textContent = String(stats.total);
        packedElement.textContent = String(packedCount);
        errorElement.textContent = String(errorCount);
        if (typeof duplicateCountElement !== 'undefined' && duplicateCountElement) {
            duplicateCountElement.textContent = String(stats.duplicatesMerged);
        }
        if (typeof downloadedCountElement !== 'undefined' && downloadedCountElement) {
            downloadedCountElement.textContent = String(downloadedCount);
        }
        if (typeof bytesCountElement !== 'undefined' && bytesCountElement) {
            bytesCountElement.textContent = formatBytes(bytesDownloaded);
        }
        updateLibrarySelectionSummary();
        updateButtons();
    }

    function updateButtons() {
        const selectedCount = selectedMediaEntries().length;
        const busy = running || packing || scanning;
        const dateRange = getDateRangeConfig();
        const reviewMode = getAfterScanMode() === 'review';

        startButton.textContent = reviewMode
            ? 'Scan and review'
            : 'Scan & quick archive';

        startButton.disabled =
            busy ||
            (
                !photoCheckbox.checked &&
                !videoCheckbox.checked &&
                !externalGifCheckbox.checked
            ) ||
            !dateRange.valid;
        stopButton.disabled = !busy;
        zipButton.textContent = reviewMode ? 'Open Library' : 'Archive eligible now';
        zipButton.disabled =
            busy ||
            selectedCount === 0 ||
            !dateRange.valid;
        resetButton.disabled = busy;
        autoZipCheckbox.disabled = busy;
        if (typeof reviewBeforeRadio !== 'undefined' && reviewBeforeRadio) {
            reviewBeforeRadio.disabled = busy;
        }
        photoCheckbox.disabled = busy;
        videoCheckbox.disabled = busy;
        externalGifCheckbox.disabled = busy;
        scanDirectionSelect.disabled = busy;
        finalPositionSelect.disabled = busy;
        dateFilterCheckbox.disabled = busy;
        fromDateInput.disabled = busy || !dateFilterCheckbox.checked;
        dateEndModeSelect.disabled = busy || !dateFilterCheckbox.checked;
        toDateInput.disabled =
            busy ||
            !dateFilterCheckbox.checked ||
            dateEndModeSelect.value !== 'specific';
    }

    // ---------- Date-aware workflow override ----------

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
                ? `Date-interval scan started on ${activeSiteAdapter.label}: ${dateRange.label}. Direction and seek pacing are automatic.`
                : `Scan started on ${activeSiteAdapter.label}. Mode: ${scanModeDescription(scanMode)}.`
        );

        await sleep(250);
        let scroller = null;
        let startingAnchor = null;

        try {
            scroller = findTimelineScroller();
            if (!scroller) {
                const error = new Error(
                    `${activeSiteAdapter.label} ${adapterTerm('timeline', 'timeline')} was not found.`
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
                setPhase(`SCAN FINISHED: ${mediaEntries.size} items`);
                addLog(
                    `Scan completed at the ${completedBoundaryLabel}: ${mediaEntries.size} unique items found.`,
                    'success'
                );
            } else {
                setPhase(`SCAN ENDED: ${mediaEntries.size} items`);
                addLog(
                    'The scan stopped before the selected boundary could be verified.',
                    'warn'
                );
            }

            const statsAfterScan = selectionStatistics();
            addLog(
                `Selection summary: ${statsAfterScan.total} canonical items, ${statsAfterScan.eligible} eligible, ${statsAfterScan.selected} selected.`
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
            setPhase(`REVIEW READY: ${statsAfterScan.selected} selected`);
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
                `${error.message} Code: ${error.code || 'SCAN_WORKFLOW_FAILED'}`,
                'error'
            );
            updateButtons();
        }
    }
    let libraryRenderTimer = null;
    let libraryViewItems = [];
    let libraryFocusedKey = null;
    let libraryPreviouslyFocused = null;
    let libraryIsOpen = false;

    function currentNamingSettings() {
        const preset = typeof namingPresetSelect !== 'undefined' && namingPresetSelect
            ? namingPresetSelect.value
            : globalThis.MediaArchiverNaming.PRESETS.NUMBERED;
        return {
            preset,
            template: typeof namingTemplateInput !== 'undefined'
                ? namingTemplateInput?.value || '{sequence}'
                : '{sequence}',
            timezone: typeof namingTimezoneSelect !== 'undefined'
                ? namingTimezoneSelect?.value || 'local'
                : 'local',
            sequenceWidth: typeof namingSequenceWidthInput !== 'undefined'
                ? Number(namingSequenceWidthInput?.value) || 6
                : 6
        };
    }

    async function persistNamingSettings() {
        try {
            await runtime.setSetting('naming.settings', currentNamingSettings());
        } catch (error) {
            diagnostics.error(
                'RUNTIME_STORAGE_FAILED',
                'File naming settings could not be saved.',
                error,
                {},
                { category: 'runtime', userMessage: 'File naming settings could not be saved for the next session.' }
            );
        }
    }

    async function loadNamingSettings() {
        const fallback = {
            preset: globalThis.MediaArchiverNaming.PRESETS.NUMBERED,
            template: '{sequence}',
            timezone: 'local',
            sequenceWidth: 6
        };
        let settings = fallback;
        try {
            settings = await runtime.getSetting('naming.settings', fallback) || fallback;
        } catch {
            settings = fallback;
        }

        if (typeof namingPresetSelect !== 'undefined' && namingPresetSelect) {
            namingPresetSelect.value = settings.preset || fallback.preset;
        }
        if (typeof namingTemplateInput !== 'undefined' && namingTemplateInput) {
            namingTemplateInput.value = settings.template || fallback.template;
        }
        if (typeof namingTimezoneSelect !== 'undefined' && namingTimezoneSelect) {
            namingTimezoneSelect.value = settings.timezone || fallback.timezone;
        }
        if (typeof namingSequenceWidthInput !== 'undefined' && namingSequenceWidthInput) {
            namingSequenceWidthInput.value = String(settings.sequenceWidth || 6);
        }
        refreshNamingAdvancedVisibility();
        renderNamingPreview();
    }

    function refreshNamingAdvancedVisibility() {
        if (typeof namingAdvancedElement === 'undefined' || !namingAdvancedElement) return;
        namingAdvancedElement.hidden = !namingCustomizeToggle?.open;
        const custom = namingPresetSelect?.value === globalThis.MediaArchiverNaming.PRESETS.CUSTOM;
        namingTemplateWrap?.classList.toggle('ma-field-disabled', !custom);
        if (namingTemplateInput) namingTemplateInput.disabled = !custom;
    }

    function renderNamingPreview() {
        if (typeof namingPreviewElement === 'undefined' || !namingPreviewElement) return;
        const entries = eligibleMediaEntries().slice(0, 3);
        const previewItems = entries.length
            ? entries
            : [
                {
                    key: 'preview-photo',
                    kind: 'media',
                    adapterId: activeSiteAdapter?.id || 'site',
                    timestamp: '2026-08-05T12:13:45.000Z',
                    payload: {
                        filename: 'artwork.jpg',
                        originalFilename: 'artwork.jpg',
                        url: 'https://preview.invalid/artwork.jpg',
                        mediaType: 'photo',
                        sourceLabel: 'current source'
                    }
                },
                {
                    key: 'preview-video',
                    kind: 'media',
                    adapterId: activeSiteAdapter?.id || 'site',
                    timestamp: '2026-08-05T12:12:45.000Z',
                    payload: {
                        filename: 'clip.mp4',
                        originalFilename: 'clip.mp4',
                        url: 'https://preview.invalid/clip.mp4',
                        mediaType: 'video',
                        sourceLabel: 'current source'
                    }
                },
                {
                    key: 'preview-image',
                    kind: 'media',
                    adapterId: activeSiteAdapter?.id || 'site',
                    timestamp: '2026-08-05T12:11:45.000Z',
                    payload: {
                        filename: 'image.png',
                        originalFilename: 'image.png',
                        url: 'https://preview.invalid/image.png',
                        mediaType: 'photo',
                        sourceLabel: 'current source'
                    }
                }
            ];

        try {
            const context = activeSiteAdapter?.getArchiveContext?.() || {};
            const plan = globalThis.MediaArchiverNaming.planArchiveNames(
                previewItems,
                currentNamingSettings(),
                {
                    site: activeSiteAdapter?.id || 'site',
                    adapterLabel: activeSiteAdapter?.label || 'Site',
                    sourceLabel: context.label || activeSiteAdapter?.label || 'source'
                }
            );
            namingPreviewElement.textContent = plan.records
                .map(record => record.archiveFilename)
                .join(' · ');
            namingErrorElement.textContent = '';
            namingErrorElement.hidden = true;
            namingPreviewElement.classList.remove('ma-invalid');
        } catch (error) {
            namingPreviewElement.textContent = 'Preview unavailable';
            namingErrorElement.textContent = error.message;
            namingErrorElement.hidden = false;
            namingPreviewElement.classList.add('ma-invalid');
        }
    }

    function librarySearchText(entry) {
        return [
            entry.filename,
            entry.mediaType,
            entry.sourceKind,
            entry.itemId,
            entry.kind,
            entry.payload?.author,
            entry.payload?.sourceLabel
        ].filter(Boolean).join(' ').toLocaleLowerCase();
    }

    function libraryFilteredEntries() {
        const query = String(librarySearchInput?.value || '').trim().toLocaleLowerCase();
        const type = libraryTypeFilter?.value || 'all';
        const status = libraryStatusFilter?.value || 'all';
        const sort = librarySortSelect?.value || 'newest';

        const entries = sortedMediaEntries().filter(entry => {
            if (query && !librarySearchText(entry).includes(query)) return false;
            if (type !== 'all' && entry.mediaType !== type && entry.kind !== type) return false;
            if (status === 'eligible' && !isEntryIncluded(entry)) return false;
            if (status === 'selected' && !selectionStore.isSelected(entry.key)) return false;
            if (status === 'deselected' && selectionStore.isSelected(entry.key)) return false;
            if (status === 'error' && entry.status !== STATUS.ERROR) return false;
            if (status === 'saved' && entry.status !== STATUS.PACKED) return false;
            return true;
        });

        if (sort === 'oldest') entries.reverse();
        else if (sort === 'discovery') {
            entries.sort((a, b) => (a.firstSeen || 0) - (b.firstSeen || 0));
        } else if (sort === 'filename') {
            entries.sort((a, b) => String(a.filename).localeCompare(String(b.filename)));
        } else if (sort === 'type') {
            entries.sort((a, b) =>
                String(a.mediaType || a.kind).localeCompare(String(b.mediaType || b.kind)) ||
                compareEntriesNewestFirst(a, b)
            );
        }
        return entries;
    }

    function scheduleLibraryRender() {
        clearTimeout(libraryRenderTimer);
        libraryRenderTimer = setTimeout(renderLibrary, 80);
    }

    function selectionStateForEntry(entry) {
        return Boolean(isEntryIncluded(entry) && selectionStore.isSelected(entry.key));
    }

    function createLibraryPreview(entry) {
        if (entry.kind === 'comment') {
            const text = document.createElement('div');
            text.className = 'ma-library-comment-preview';
            text.textContent = entry.payload?.bodyText || 'Comment';
            return text;
        }

        if (entry.mediaType === 'video' || entry.mediaType === 'external-gif') {
            const tile = document.createElement('div');
            tile.className = 'ma-library-video-preview';
            tile.textContent = entry.mediaType === 'external-gif' ? 'GIF' : '▶';
            if (entry.previewUrl) {
                tile.style.backgroundImage = `url("${String(entry.previewUrl).replace(/"/g, '%22')}")`;
            }
            return tile;
        }

        const image = document.createElement('img');
        image.className = 'ma-library-image';
        image.loading = 'lazy';
        image.decoding = 'async';
        image.referrerPolicy = 'no-referrer';
        image.alt = '';
        image.src = entry.previewUrl || entry.url;
        return image;
    }

    function createLibraryCard(entry, index) {
        const card = document.createElement('article');
        card.className = 'ma-library-card';
        card.dataset.maItemKey = entry.key;
        card.dataset.maIndex = String(index);
        card.setAttribute('role', 'option');
        card.tabIndex = entry.key === libraryFocusedKey || (!libraryFocusedKey && index === 0) ? 0 : -1;

        const preview = createLibraryPreview(entry);
        const overlay = document.createElement('div');
        overlay.className = 'ma-library-selected-overlay';
        overlay.setAttribute('aria-hidden', 'true');

        const check = document.createElement('button');
        check.type = 'button';
        check.className = 'ma-library-check';
        check.setAttribute('aria-label', `Toggle ${entry.filename || entry.kind}`);
        check.textContent = '✓';

        const body = document.createElement('div');
        body.className = 'ma-library-card-body';
        const title = document.createElement('strong');
        title.textContent = entry.filename || entry.payload?.author || entry.kind;
        title.title = title.textContent;
        const meta = document.createElement('span');
        meta.textContent = [
            entry.mediaType || entry.kind,
            entry.timestamp ? new Date(entry.timestamp).toLocaleString('en-GB') : 'Time unknown',
            entry.duplicateCount ? `${entry.duplicateCount} duplicates merged` : '',
            entry.status
        ].filter(Boolean).join(' · ');
        body.append(title, meta);

        card.append(preview, overlay, check, body);
        updateLibraryCardElement(card, entry);

        card.addEventListener('focus', () => {
            libraryFocusedKey = entry.key;
            updateLibraryRovingTabIndex();
        });
        card.addEventListener('click', event => {
            const checkmark = Boolean(event.target.closest('.ma-library-check'));
            applyLibraryClick(entry.key, {
                checkmark,
                ctrlKey: event.ctrlKey,
                metaKey: event.metaKey,
                shiftKey: event.shiftKey
            });
            if (!checkmark) card.focus();
        });
        card.addEventListener('keydown', event => handleLibraryCardKeydown(event, entry.key));
        return card;
    }

    function updateLibraryCardElement(card, entry) {
        const selected = selectionStateForEntry(entry);
        const eligible = isEntryIncluded(entry);
        card.classList.toggle('ma-selected', selected);
        card.classList.toggle('ma-ineligible', !eligible);
        card.classList.toggle('ma-saved', entry.status === STATUS.PACKED);
        card.classList.toggle('ma-error', entry.status === STATUS.ERROR);
        card.setAttribute('aria-selected', String(selected));
        card.setAttribute('aria-disabled', String(!eligible));
        const check = card.querySelector('.ma-library-check');
        if (check) {
            check.setAttribute('aria-pressed', String(selected));
            check.disabled = !eligible;
        }
    }

    function updateLibraryCardState(key) {
        if (typeof libraryItemsElement === 'undefined' || !libraryItemsElement) return;
        const entry = mediaEntries.get(key);
        if (!entry) return;
        for (const card of libraryItemsElement.querySelectorAll('[data-ma-item-key]')) {
            if (card.dataset.maItemKey === key) {
                updateLibraryCardElement(card, entry);
                break;
            }
        }
        updateLibrarySelectionSummary();
    }

    function updateAllLibraryCardStates() {
        if (!libraryItemsElement) return;
        for (const card of libraryItemsElement.querySelectorAll('[data-ma-item-key]')) {
            const entry = mediaEntries.get(card.dataset.maItemKey);
            if (entry) updateLibraryCardElement(card, entry);
        }
        updateLibrarySelectionSummary();
        renderNamingPreview();
        updateCounters();
    }

    function renderLibrary() {
        if (typeof libraryItemsElement === 'undefined' || !libraryItemsElement) return;
        libraryViewItems = libraryFilteredEntries();
        if (!libraryViewItems.some(entry => entry.key === libraryFocusedKey)) {
            libraryFocusedKey = libraryViewItems[0]?.key || null;
        }

        const fragment = document.createDocumentFragment();
        libraryViewItems.forEach((entry, index) => {
            fragment.appendChild(createLibraryCard(entry, index));
        });
        libraryItemsElement.replaceChildren(fragment);
        libraryItemsElement.classList.toggle(
            'ma-list-view',
            libraryViewToggle?.dataset.view === 'list'
        );
        libraryEmptyElement.hidden = libraryViewItems.length > 0;
        updateLibrarySelectionSummary();
    }

    function updateLibraryRovingTabIndex() {
        for (const card of libraryItemsElement?.querySelectorAll('[data-ma-item-key]') || []) {
            card.tabIndex = card.dataset.maItemKey === libraryFocusedKey ? 0 : -1;
        }
    }

    function currentLibraryViewForSelection() {
        return libraryViewItems.filter(isEntryIncluded);
    }

    function applyLibraryClick(key, modifiers) {
        selectionStore.applyClick({
            key,
            viewItems: currentLibraryViewForSelection(),
            ...modifiers
        });
        selectionStore.syncItems([...mediaEntries.values()]);
        updateAllLibraryCardStates();
    }

    function handleLibraryCardKeydown(event, key) {
        if (event.key === ' ') {
            event.preventDefault();
            selectionStore.toggle(key);
            selectionStore.syncItems([...mediaEntries.values()]);
            updateAllLibraryCardStates();
            return;
        }

        const index = libraryViewItems.findIndex(entry => entry.key === key);
        if (index < 0) return;
        let target = index;
        const grid = libraryViewToggle?.dataset.view !== 'list';
        const firstCard = libraryItemsElement.querySelector('[data-ma-item-key]');
        const columns = grid && firstCard
            ? Math.max(1, Math.floor(libraryItemsElement.clientWidth / Math.max(180, firstCard.getBoundingClientRect().width)))
            : 1;

        if (event.key === 'ArrowLeft') target = index - 1;
        else if (event.key === 'ArrowRight') target = index + 1;
        else if (event.key === 'ArrowUp') target = index - columns;
        else if (event.key === 'ArrowDown') target = index + columns;
        else if (event.key === 'Home') target = 0;
        else if (event.key === 'End') target = libraryViewItems.length - 1;
        else return;

        event.preventDefault();
        target = Math.max(0, Math.min(libraryViewItems.length - 1, target));
        libraryFocusedKey = libraryViewItems[target]?.key || key;
        updateLibraryRovingTabIndex();
        const targetCard = [...libraryItemsElement.querySelectorAll('[data-ma-item-key]')]
            .find(card => card.dataset.maItemKey === libraryFocusedKey);
        targetCard?.focus();
        targetCard?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    function updateLibrarySelectionSummary() {
        if (typeof librarySelectedCountElement === 'undefined' || !librarySelectedCountElement) return;
        const stats = selectionStatistics();
        librarySelectedCountElement.textContent = String(stats.selected);
        libraryEligibleCountElement.textContent = String(stats.eligible);
        libraryVisibleCountElement.textContent = String(libraryViewItems.length);
        libraryArchiveButton.disabled = stats.selected === 0 || running || packing || scanning;
    }

    function setLibraryMessage(message, error = false) {
        if (!libraryMessageElement) return;
        libraryMessageElement.textContent = message || '';
        libraryMessageElement.classList.toggle('ma-error-text', Boolean(error));
        libraryMessageElement.hidden = !message;
    }

    function focusableIn(element) {
        return [...element.querySelectorAll(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), details summary, [tabindex]:not([tabindex="-1"])'
        )].filter(node => !node.hidden && node.offsetParent !== null);
    }

    function handleLibraryDialogKeydown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeLibrary();
            return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
            event.preventDefault();
            selectionStore.selectAllVisible(currentLibraryViewForSelection());
            selectionStore.syncItems([...mediaEntries.values()]);
            updateAllLibraryCardStates();
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = focusableIn(libraryDialogElement);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    function openLibrary() {
        if (!libraryOverlay) return;
        libraryPreviouslyFocused = document.activeElement;
        libraryIsOpen = true;
        setLibraryMessage('');
        libraryOverlay.hidden = false;
        document.documentElement.classList.add('ma-library-open');
        panel.setAttribute('inert', '');
        try {
            if (workflowState.phase === globalThis.MediaArchiverWorkflowState.phases.REVIEW_READY) {
                workflowState.transition(globalThis.MediaArchiverWorkflowState.phases.REVIEWING);
            }
        } catch {
            // State reporting must not block the dialog.
        }
        renderLibrary();
        requestAnimationFrame(() => librarySearchInput?.focus());
    }

    function closeLibrary() {
        if (!libraryOverlay || libraryOverlay.hidden) return;
        libraryOverlay.hidden = true;
        libraryIsOpen = false;
        document.documentElement.classList.remove('ma-library-open');
        panel.removeAttribute('inert');
        try {
            if (workflowState.phase === globalThis.MediaArchiverWorkflowState.phases.REVIEWING) {
                workflowState.transition(globalThis.MediaArchiverWorkflowState.phases.REVIEW_READY);
            }
        } catch {
            // State reporting must not block dialog closing.
        }
        libraryPreviouslyFocused?.focus?.();
    }

    function selectAllVisibleLibrary() {
        selectionStore.selectAllVisible(currentLibraryViewForSelection());
        selectionStore.syncItems([...mediaEntries.values()]);
        updateAllLibraryCardStates();
    }

    function selectAllEligibleLibrary() {
        selectionStore.selectAllEligible(eligibleMediaEntries());
        selectionStore.syncItems([...mediaEntries.values()]);
        updateAllLibraryCardStates();
    }

    function selectNoneLibrary() {
        selectionStore.selectNone();
        selectionStore.syncItems([...mediaEntries.values()]);
        updateAllLibraryCardStates();
    }

    function invertVisibleLibrary() {
        selectionStore.invertVisible(currentLibraryViewForSelection());
        selectionStore.syncItems([...mediaEntries.values()]);
        updateAllLibraryCardStates();
    }

    function toggleLibraryView() {
        const next = libraryViewToggle.dataset.view === 'list' ? 'grid' : 'list';
        libraryViewToggle.dataset.view = next;
        libraryViewToggle.textContent = next === 'grid' ? 'List view' : 'Grid view';
        libraryViewToggle.setAttribute('aria-pressed', String(next === 'list'));
        renderLibrary();
    }

    function visibleActivityText() {
        return [...logArea.querySelectorAll('.ma-log-line')]
            .map(line => line.textContent)
            .join('\n');
    }

    async function copyActivity() {
        try {
            await runtime.copyText(visibleActivityText());
            setLibraryMessage('Activity copied.');
        } catch (error) {
            diagnostics.error(
                'RUNTIME_CLIPBOARD_FAILED',
                'Copying Activity failed.',
                error,
                {},
                { category: 'runtime', userMessage: 'Copy failed. The Activity text remains selectable.' }
            );
            addLog('Copy failed. The Activity text remains selectable. Code: RUNTIME_CLIPBOARD_FAILED', 'error');
        }
    }

    function developerReportMarkdown() {
        return diagnostics.exportMarkdown({
            environment: runtime.getPlatformInfo(),
            configuration: {
                scanMode: scanDirectionSelect.value,
                dateRange: getDateRangeConfig().label,
                enabledContentTypes: [
                    photoCheckbox.checked ? 'photos' : '',
                    videoCheckbox.checked ? 'videos' : '',
                    externalGifCheckbox.checked ? 'rendered GIF previews' : ''
                ].filter(Boolean),
                finalPosition: finalPositionSelect.value,
                afterScanMode: getAfterScanMode(),
                namingPreset: currentNamingSettings().preset,
                zipEngine: resolveFflateLibrary() ? 'fflate' : 'built-in'
            },
            metrics: liveMetrics.snapshot()
        });
    }

    async function copyDeveloperReport() {
        const report = developerReportMarkdown();
        try {
            await runtime.copyText(report);
            developerReportText.value = report;
            developerReportText.select();
        } catch (error) {
            developerReportText.value = report;
            developerReportText.select();
            diagnostics.error(
                'RUNTIME_CLIPBOARD_FAILED',
                'Copying the developer report failed.',
                error,
                {},
                { category: 'runtime', userMessage: 'Copy failed. The sanitized report is selected for manual copying.' }
            );
        }
    }

    async function downloadDeveloperReport() {
        const report = developerReportMarkdown();
        const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
        try {
            await runtime.saveBlob(
                new Blob([report], { type: 'text/markdown;charset=utf-8' }),
                `media-archiver-diagnostics_${stamp}.md`
            );
        } catch (error) {
            addLog('Diagnostic report could not be saved. Keep the report open and copy it manually. Code: RUNTIME_SAVE_FAILED', 'error');
        }
    }

    function renderDeveloperLogs() {
        const levels = [...developerLevelFilters]
            .filter(input => input.checked)
            .map(input => input.value);
        const categories = [...developerCategoryFilters]
            .filter(input => input.checked)
            .map(input => input.value);
        const events = diagnostics.events({
            levels,
            categories,
            query: developerSearchInput.value
        });
        const fragment = document.createDocumentFragment();
        for (const event of events) {
            const details = document.createElement('details');
            details.className = `ma-developer-event ma-developer-${event.level}`;
            const summary = document.createElement('summary');
            summary.textContent = `${event.timestamp.slice(11, 23)}  ${event.level.toUpperCase()}  ${event.category.toUpperCase()}  ${event.code}`;
            const message = document.createElement('div');
            message.textContent = event.userMessage || event.message;
            const context = document.createElement('pre');
            context.textContent = JSON.stringify({ context: event.context, error: event.error }, null, 2);
            details.append(summary, message, context);
            fragment.appendChild(details);
        }
        developerEventList.replaceChildren(fragment);
        developerReportText.value = developerReportMarkdown();
    }

    function openDeveloperLogs() {
        developerLogsOverlay.hidden = false;
        renderDeveloperLogs();
        developerSearchInput.focus();
    }

    function closeDeveloperLogs() {
        developerLogsOverlay.hidden = true;
        developerLogsButton.focus();
    }
    // ---------- Interface ----------

    const panel = document.createElement('aside');
    panel.id = 'media-archiver-panel';
    panel.innerHTML = `
        <header class="ma-header">
            <div class="ma-brand">
                <div class="ma-title-row">
                    <div class="ma-title">${APP_NAME}</div>
                    <span class="ma-site-badge">${activeSiteAdapter.label}</span>
                </div>
                <div class="ma-subtitle">Rendered media · v${VERSION}</div>
            </div>
            <button
                id="ma-collapse"
                class="ma-icon-button"
                type="button"
                title="Collapse panel"
                aria-label="Collapse panel"
            >−</button>
        </header>

        <div id="ma-body">
            <section class="ma-status-card" aria-live="polite">
                <div class="ma-phase-row">
                    <div id="ma-phase">READY</div>
                    <span id="ma-selected-summary">0 selected</span>
                </div>
                <div class="ma-progress" aria-hidden="true">
                    <div id="ma-progress-fill"></div>
                </div>
                <div class="ma-primary-metrics">
                    <div><strong id="ma-found">0</strong><span>Found</span></div>
                    <div><strong id="ma-selected-count">0</strong><span>Selected</span></div>
                    <div><strong id="ma-packed">0</strong><span>Saved</span></div>
                    <div><strong id="ma-errors">0</strong><span>Errors</span></div>
                </div>
            </section>

            <nav class="ma-tabs" aria-label="Media Archiver sections">
                <button type="button" data-ma-tab="setup" aria-selected="true">Scan</button>
                <button type="button" data-ma-tab="media" aria-selected="false">
                    Media <span id="ma-media-tab-count">0</span>
                </button>
                <button type="button" data-ma-tab="activity" aria-selected="false">Activity</button>
            </nav>

            <div class="ma-tab-content">
                <section data-ma-panel="setup">
                    <section class="ma-group">
                        <div class="ma-group-heading">
                            <div>
                                <h2>Media types</h2>
                                <p>Choose the simple media categories included in the archive.</p>
                            </div>
                        </div>
                        <div class="ma-choice-grid">
                            <label class="ma-choice">
                                <input id="ma-include-photos" type="checkbox" checked>
                                <span><strong>Images</strong><small>Photos and static image attachments</small></span>
                            </label>
                            <label class="ma-choice">
                                <input id="ma-include-videos" type="checkbox" checked>
                                <span><strong>Videos</strong><small>Rendered video attachments and players</small></span>
                            </label>
                            <label class="ma-choice ma-choice-wide">
                                <input id="ma-include-external-gifs" type="checkbox" checked>
                                <span><strong>GIFs and animated previews</strong><small>Native GIF files and rendered animated previews</small></span>
                            </label>
                        </div>
                    </section>

                    <section class="ma-group">
                        <div class="ma-group-heading ma-heading-with-control">
                            <div>
                                <h2>Date interval</h2>
                                <p>Choose the calendar interval that the automatic navigator should scan.</p>
                            </div>
                            <label class="ma-switch">
                                <input id="ma-date-filter" type="checkbox">
                                <span aria-hidden="true"></span>
                                <b>Use interval</b>
                            </label>
                        </div>

                        <div id="ma-date-fields" class="ma-field-grid ma-date-fields">
                            <label>
                                <span>From</span>
                                <input id="ma-from-date" type="date">
                            </label>
                            <label>
                                <span>Interval end</span>
                                <select id="ma-date-end-mode">
                                    <option value="latest">Newest available message</option>
                                    <option value="specific">Specific date</option>
                                </select>
                            </label>
                            <label id="ma-to-date-wrap" class="ma-field-wide">
                                <span>To, inclusive</span>
                                <input id="ma-to-date" type="date">
                            </label>
                        </div>
                        <div id="ma-date-summary" class="ma-inline-status">All scanned dates are included.</div>
                    </section>

                    <section class="ma-group">
                        <div class="ma-group-heading">
                            <div>
                                <h2>Scan plan</h2>
                                <p>Describe movement by message chronology, not screen direction.</p>
                            </div>
                        </div>
                        <div class="ma-field-grid">
                            <label class="ma-field-wide">
                                <span>From the current message window</span>
                                <select id="ma-scan-direction">
                                    <option value="newest-to-oldest">Automatic latest-message seek → older messages</option>
                                    <option value="current-to-oldest">Current position → older messages</option>
                                    <option value="current-to-newest">Current position → newer messages</option>
                                    <option value="full-finish-down">Automatic whole-channel scan</option>
                                </select>
                            </label>
                            <label class="ma-field-wide">
                                <span>Position after completion</span>
                                <select id="ma-final-position">
                                    <option value="scan-end" selected>Stay where the scan finished</option>
                                    <option value="newest">Move to newest messages</option>
                                    <option value="start">Return to original message window</option>
                                </select>
                            </label>
                        </div>
                    </section>

                    <section class="ma-group ma-compact-group">
                        <label class="ma-option-row">
                            <span>
                                <strong>Create ZIPs after scanning</strong>
                                <small>Turn this off to review the collected media first.</small>
                            </span>
                            <input id="ma-auto-zip" type="checkbox" checked>
                        </label>
                    </section>
                </section>

                <section data-ma-panel="media" hidden>
                    <div class="ma-detail-metrics">
                        <div><span>Images</span><strong id="ma-photo-count">0</strong></div>
                        <div><span>Videos</span><strong id="ma-video-count">0</strong></div>
                        <div><span>GIF previews</span><strong id="ma-external-gif-count">0</strong></div>
                        <div><span>In interval</span><strong id="ma-in-range">0</strong></div>
                        <div><span>Date excluded</span><strong id="ma-excluded-date">0</strong></div>
                    </div>
                    <div class="ma-list-heading">
                        <div>
                            <h2>Collected media</h2>
                            <p>○ collected · … downloading · ✓ saved · – filtered out</p>
                        </div>
                    </div>
                    <div id="ma-media-list" class="ma-media-list"></div>
                </section>

                <section data-ma-panel="activity" hidden>
                    <div class="ma-list-heading ma-heading-with-control">
                        <div>
                            <h2>Activity</h2>
                            <p>Operational messages for the current session.</p>
                        </div>
                        <button id="ma-clear-log" class="ma-text-button" type="button">Clear</button>
                    </div>
                    <div id="ma-log" class="ma-log" aria-live="polite"></div>
                </section>
            </div>

            <footer class="ma-actions">
                <button id="ma-start" class="ma-primary" type="button">Scan & create ZIPs</button>
                <button id="ma-stop" class="ma-danger" type="button" disabled>Stop</button>
                <button id="ma-zip" class="ma-success" type="button" disabled>Create ZIP now</button>
                <button id="ma-reset" class="ma-secondary" type="button">Reset</button>
            </footer>
        </div>
    `;

    const existingAfterScanGroup = panel.querySelector('#ma-auto-zip')
        ?.closest('.ma-compact-group');

    const namingGroup = document.createElement('section');
    namingGroup.className = 'ma-group';
    namingGroup.innerHTML = `
        <div class="ma-group-heading">
            <div>
                <h2>File naming</h2>
                <p>Final names are planned once for the complete confirmed selection.</p>
            </div>
        </div>
        <label class="ma-field-block">
            <span>Preset</span>
            <select id="ma-naming-preset">
                <option value="numbered">Numbered — newest to oldest</option>
                <option value="source-datetime">Source date/time</option>
                <option value="source-date-number">Source + date + number</option>
                <option value="original-number">Original + number</option>
                <option value="custom">Custom template</option>
            </select>
        </label>
        <div class="ma-naming-preview-wrap">
            <span>Preview</span>
            <strong id="ma-naming-preview">000001.jpg · 000002.mp4 · 000003.png</strong>
            <small>Unique stems across all file types and ZIP parts. True extensions are preserved.</small>
        </div>
        <details id="ma-naming-customize" class="ma-disclosure">
            <summary>Customize</summary>
            <div id="ma-naming-advanced" class="ma-field-grid">
                <label id="ma-naming-template-wrap" class="ma-field-wide">
                    <span>Template</span>
                    <input id="ma-naming-template" type="text" value="{sequence}" spellcheck="false">
                </label>
                <label>
                    <span>Time zone</span>
                    <select id="ma-naming-timezone">
                        <option value="local">Local source time</option>
                        <option value="utc">UTC</option>
                    </select>
                </label>
                <label>
                    <span>Sequence width</span>
                    <input id="ma-naming-sequence-width" type="number" min="6" max="12" value="6">
                </label>
            </div>
        </details>
        <div id="ma-naming-error" class="ma-inline-status ma-date-error" hidden></div>
    `;

    if (existingAfterScanGroup) {
        existingAfterScanGroup.before(namingGroup);
        existingAfterScanGroup.className = 'ma-group';
        existingAfterScanGroup.innerHTML = `
            <div class="ma-group-heading">
                <div>
                    <h2>After scan</h2>
                    <p>Choose automatic archiving or review the deduplicated candidates first.</p>
                </div>
            </div>
            <div class="ma-after-scan-options">
                <label class="ma-mode-card">
                    <input id="ma-auto-zip" name="ma-after-scan" type="radio" value="quick" checked>
                    <span>
                        <strong>Quick archive</strong>
                        <small>Scan, merge duplicates, then download and archive every eligible item.</small>
                    </span>
                </label>
                <label class="ma-mode-card">
                    <input id="ma-review-before" name="ma-after-scan" type="radio" value="review">
                    <span>
                        <strong>Review before archive</strong>
                        <small>Scan first. Original requests start only after Archive selected is confirmed.</small>
                    </span>
                </label>
            </div>
        `;
    }

    const mediaHeading = panel.querySelector('[data-ma-panel="media"] .ma-list-heading');
    if (mediaHeading) {
        mediaHeading.classList.add('ma-heading-with-control');
        const openButton = document.createElement('button');
        openButton.id = 'ma-open-library';
        openButton.className = 'ma-text-button';
        openButton.type = 'button';
        openButton.textContent = 'Open Library';
        mediaHeading.appendChild(openButton);
    }

    const detailMetrics = panel.querySelector('.ma-detail-metrics');
    if (detailMetrics) {
        detailMetrics.insertAdjacentHTML('beforeend', `
            <div><span>Duplicates merged</span><strong id="ma-duplicate-count">0</strong></div>
            <div><span>Downloaded</span><strong id="ma-downloaded-count">0</strong></div>
            <div><span>Bytes</span><strong id="ma-bytes-count">0 B</strong></div>
            <div><span>Elapsed</span><strong id="ma-elapsed">0:00</strong></div>
        `);
    }

    const activityHeading = panel.querySelector('[data-ma-panel="activity"] .ma-list-heading');
    if (activityHeading) {
        activityHeading.querySelector('#ma-clear-log')?.remove();
        const actions = document.createElement('div');
        actions.className = 'ma-activity-actions';
        actions.innerHTML = `
            <button id="ma-copy-activity" class="ma-text-button" type="button">Copy</button>
            <button id="ma-download-report" class="ma-text-button" type="button">Download .md</button>
            <button id="ma-developer-logs" class="ma-text-button" type="button">Developer logs</button>
            <button id="ma-clear-log" class="ma-text-button" type="button">Clear</button>
        `;
        activityHeading.appendChild(actions);
    }

    const libraryOverlay = document.createElement('div');
    libraryOverlay.id = 'ma-library-overlay';
    libraryOverlay.hidden = true;
    libraryOverlay.innerHTML = `
        <section id="ma-library-dialog" class="ma-library-dialog" role="dialog" aria-modal="true" aria-labelledby="ma-library-title">
            <header class="ma-library-header">
                <div>
                    <div class="ma-title-row">
                        <h1 id="ma-library-title">Media Archiver Library</h1>
                        <span class="ma-site-badge">${activeSiteAdapter.label}</span>
                    </div>
                    <p>Review canonical candidates. Closing this window never starts a download.</p>
                </div>
                <button id="ma-library-close" class="ma-library-icon" type="button" aria-label="Close Library">×</button>
            </header>

            <div class="ma-library-toolbar" aria-label="Library controls">
                <label class="ma-library-search">
                    <span class="ma-visually-hidden">Search Library</span>
                    <input id="ma-library-search" type="search" placeholder="Search filename, type, source or ID">
                </label>
                <label>
                    <span>Sort</span>
                    <select id="ma-library-sort">
                        <option value="newest">Newest first</option>
                        <option value="oldest">Oldest first</option>
                        <option value="discovery">Discovery order</option>
                        <option value="filename">Filename</option>
                        <option value="type">Type</option>
                    </select>
                </label>
                <label>
                    <span>Type</span>
                    <select id="ma-library-type-filter">
                        <option value="all">All types</option>
                        <option value="photo">Photos & native GIFs</option>
                        <option value="video">Videos</option>
                        <option value="external-gif">Rendered GIF previews</option>
                        <option value="comment">Comments</option>
                    </select>
                </label>
                <label>
                    <span>Status</span>
                    <select id="ma-library-status-filter">
                        <option value="all">All statuses</option>
                        <option value="eligible">Eligible</option>
                        <option value="selected">Selected</option>
                        <option value="deselected">Deselected</option>
                        <option value="saved">Saved</option>
                        <option value="error">Errors</option>
                    </select>
                </label>
                <button id="ma-library-view" type="button" data-view="grid" aria-pressed="false">List view</button>
            </div>

            <div class="ma-library-selection-bar">
                <div class="ma-library-selection-actions">
                    <button id="ma-select-visible" type="button">Select all visible</button>
                    <button id="ma-select-eligible" type="button">Select all eligible</button>
                    <button id="ma-select-none" type="button">None</button>
                    <button id="ma-select-invert" type="button">Invert visible</button>
                </div>
                <div class="ma-library-shortcuts">Plain click: only · Check/Ctrl/Cmd: toggle · Shift: range · Ctrl/Cmd+A: visible · Space: toggle</div>
            </div>

            <div id="ma-library-items" class="ma-library-items" role="listbox" aria-multiselectable="true"></div>
            <div id="ma-library-empty" class="ma-library-empty" hidden>No items match the current view.</div>

            <footer class="ma-library-footer">
                <div>
                    <strong><span id="ma-library-selected-count">0</span> selected</strong>
                    <span><span id="ma-library-eligible-count">0</span> eligible · <span id="ma-library-visible-count">0</span> visible</span>
                    <p id="ma-library-message" hidden></p>
                </div>
                <div class="ma-library-footer-actions">
                    <button id="ma-library-cancel" type="button">Close without downloading</button>
                    <button id="ma-library-archive" class="ma-library-primary" type="button">Archive selected</button>
                </div>
            </footer>
        </section>
    `;

    const developerLogsOverlay = document.createElement('div');
    developerLogsOverlay.id = 'ma-developer-overlay';
    developerLogsOverlay.hidden = true;
    developerLogsOverlay.innerHTML = `
        <section class="ma-developer-dialog" role="dialog" aria-modal="true" aria-labelledby="ma-developer-title">
            <header class="ma-library-header">
                <div>
                    <h1 id="ma-developer-title">Developer logs</h1>
                    <p>Structured events and a sanitized report. Sensitive content is redacted by default.</p>
                </div>
                <button id="ma-developer-close" class="ma-library-icon" type="button" aria-label="Close Developer logs">×</button>
            </header>
            <div class="ma-developer-toolbar">
                <input id="ma-developer-search" type="search" placeholder="Search code or message">
                <fieldset>
                    <legend>Levels</legend>
                    <label><input data-ma-dev-level type="checkbox" value="debug" checked> Debug</label>
                    <label><input data-ma-dev-level type="checkbox" value="info" checked> Info</label>
                    <label><input data-ma-dev-level type="checkbox" value="success" checked> Success</label>
                    <label><input data-ma-dev-level type="checkbox" value="warn" checked> Warning</label>
                    <label><input data-ma-dev-level type="checkbox" value="error" checked> Error</label>
                </fieldset>
                <fieldset>
                    <legend>Categories</legend>
                    ${['runtime','adapter','scan','selection','network','naming','archive','zip','ui']
                        .map(category => `<label><input data-ma-dev-category type="checkbox" value="${category}" checked> ${category}</label>`)
                        .join('')}
                </fieldset>
                <div class="ma-developer-actions">
                    <button id="ma-copy-developer" type="button">Copy report</button>
                    <button id="ma-download-developer" type="button">Download .md</button>
                </div>
            </div>
            <div class="ma-developer-content">
                <div id="ma-developer-events" class="ma-developer-events"></div>
                <label class="ma-developer-report-wrap">
                    <span>Sanitized Markdown report</span>
                    <textarea id="ma-developer-report" readonly spellcheck="false"></textarea>
                </label>
            </div>
        </section>
    `;
    const reviewBeforeRadio = panel.querySelector('#ma-review-before');
    const openLibraryButton = panel.querySelector('#ma-open-library');
    const duplicateCountElement = panel.querySelector('#ma-duplicate-count');
    const downloadedCountElement = panel.querySelector('#ma-downloaded-count');
    const bytesCountElement = panel.querySelector('#ma-bytes-count');
    const elapsedElement = panel.querySelector('#ma-elapsed');

    const namingPresetSelect = panel.querySelector('#ma-naming-preset');
    const namingPreviewElement = panel.querySelector('#ma-naming-preview');
    const namingCustomizeToggle = panel.querySelector('#ma-naming-customize');
    const namingAdvancedElement = panel.querySelector('#ma-naming-advanced');
    const namingTemplateWrap = panel.querySelector('#ma-naming-template-wrap');
    const namingTemplateInput = panel.querySelector('#ma-naming-template');
    const namingTimezoneSelect = panel.querySelector('#ma-naming-timezone');
    const namingSequenceWidthInput = panel.querySelector('#ma-naming-sequence-width');
    const namingErrorElement = panel.querySelector('#ma-naming-error');

    const copyActivityButton = panel.querySelector('#ma-copy-activity');
    const downloadReportButton = panel.querySelector('#ma-download-report');
    const developerLogsButton = panel.querySelector('#ma-developer-logs');

    const libraryDialogElement = libraryOverlay.querySelector('#ma-library-dialog');
    const libraryCloseButton = libraryOverlay.querySelector('#ma-library-close');
    const libraryCancelButton = libraryOverlay.querySelector('#ma-library-cancel');
    const libraryArchiveButton = libraryOverlay.querySelector('#ma-library-archive');
    const librarySearchInput = libraryOverlay.querySelector('#ma-library-search');
    const librarySortSelect = libraryOverlay.querySelector('#ma-library-sort');
    const libraryTypeFilter = libraryOverlay.querySelector('#ma-library-type-filter');
    const libraryStatusFilter = libraryOverlay.querySelector('#ma-library-status-filter');
    const libraryViewToggle = libraryOverlay.querySelector('#ma-library-view');
    const libraryItemsElement = libraryOverlay.querySelector('#ma-library-items');
    const libraryEmptyElement = libraryOverlay.querySelector('#ma-library-empty');
    const librarySelectedCountElement = libraryOverlay.querySelector('#ma-library-selected-count');
    const libraryEligibleCountElement = libraryOverlay.querySelector('#ma-library-eligible-count');
    const libraryVisibleCountElement = libraryOverlay.querySelector('#ma-library-visible-count');
    const libraryMessageElement = libraryOverlay.querySelector('#ma-library-message');
    const selectVisibleButton = libraryOverlay.querySelector('#ma-select-visible');
    const selectEligibleButton = libraryOverlay.querySelector('#ma-select-eligible');
    const selectNoneButton = libraryOverlay.querySelector('#ma-select-none');
    const selectInvertButton = libraryOverlay.querySelector('#ma-select-invert');

    const developerCloseButton = developerLogsOverlay.querySelector('#ma-developer-close');
    const developerSearchInput = developerLogsOverlay.querySelector('#ma-developer-search');
    const developerLevelFilters = developerLogsOverlay.querySelectorAll('[data-ma-dev-level]');
    const developerCategoryFilters = developerLogsOverlay.querySelectorAll('[data-ma-dev-category]');
    const developerEventList = developerLogsOverlay.querySelector('#ma-developer-events');
    const developerReportText = developerLogsOverlay.querySelector('#ma-developer-report');
    const copyDeveloperButton = developerLogsOverlay.querySelector('#ma-copy-developer');
    const downloadDeveloperButton = developerLogsOverlay.querySelector('#ma-download-developer');
    const style = document.createElement('style');
    style.textContent = `
        #media-archiver-panel {
            --ma-bg: #111418;
            --ma-surface: #181d23;
            --ma-surface-2: #20262e;
            --ma-border: rgba(255, 255, 255, .11);
            --ma-text: #f4f7fa;
            --ma-muted: #98a3af;
            --ma-accent: #4f8cff;
            --ma-accent-strong: #3276f5;
            --ma-success: #28a76f;
            --ma-danger: #d94c57;
            position: fixed;
            right: 18px;
            bottom: 18px;
            z-index: 2147483647;
            width: min(460px, calc(100vw - 36px));
            max-height: min(820px, calc(100vh - 36px));
            overflow: hidden;
            border: 1px solid var(--ma-border);
            border-radius: 16px;
            background: var(--ma-bg);
            color: var(--ma-text);
            box-shadow: 0 22px 70px rgba(0, 0, 0, .48);
            font: 13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        #media-archiver-panel * { box-sizing: border-box; }
        #media-archiver-panel [hidden] { display: none !important; }

        .ma-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 13px 14px;
            border-bottom: 1px solid var(--ma-border);
            background: rgba(8, 10, 13, .72);
        }

        .ma-brand { min-width: 0; }
        .ma-title-row { display: flex; align-items: center; gap: 8px; }
        .ma-title { font-size: 16px; font-weight: 800; letter-spacing: -.01em; }
        .ma-site-badge {
            max-width: 150px;
            overflow: hidden;
            padding: 2px 7px;
            border: 1px solid rgba(79, 140, 255, .42);
            border-radius: 999px;
            color: #bcd2ff;
            background: rgba(79, 140, 255, .12);
            font-size: 10px;
            font-weight: 750;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .ma-subtitle { margin-top: 2px; color: var(--ma-muted); font-size: 10px; }

        #ma-body {
            display: flex;
            max-height: calc(min(820px, 100vh - 36px) - 58px);
            flex-direction: column;
            overflow: hidden;
        }

        .ma-status-card {
            margin: 12px 12px 0;
            padding: 11px;
            border: 1px solid var(--ma-border);
            border-radius: 11px;
            background: linear-gradient(145deg, var(--ma-surface-2), var(--ma-surface));
        }
        .ma-phase-row { display: flex; align-items: start; justify-content: space-between; gap: 12px; }
        #ma-phase { min-width: 0; font-weight: 760; overflow-wrap: anywhere; }
        #ma-selected-summary { flex: none; color: var(--ma-muted); font-size: 10px; }
        .ma-progress { height: 6px; margin-top: 9px; overflow: hidden; border-radius: 999px; background: #0d1014; }
        #ma-progress-fill { width: 0; height: 100%; border-radius: inherit; background: var(--ma-accent); transition: width .18s ease; }
        .ma-primary-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; margin-top: 10px; }
        .ma-primary-metrics div { min-width: 0; padding: 7px 6px; border-radius: 8px; background: rgba(0, 0, 0, .18); text-align: center; }
        .ma-primary-metrics strong { display: block; font-size: 15px; }
        .ma-primary-metrics span { display: block; margin-top: 1px; color: var(--ma-muted); font-size: 9px; text-transform: uppercase; letter-spacing: .04em; }

        .ma-tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin: 10px 12px 0; padding: 3px; border: 1px solid var(--ma-border); border-radius: 10px; background: #0c0f13; }
        .ma-tabs button { padding: 7px 8px !important; border-radius: 7px !important; background: transparent !important; color: var(--ma-muted) !important; font-weight: 700 !important; }
        .ma-tabs button[aria-selected="true"] { background: var(--ma-surface-2) !important; color: var(--ma-text) !important; box-shadow: 0 1px 4px rgba(0,0,0,.28); }
        #ma-media-tab-count { display: inline-grid; min-width: 18px; height: 18px; margin-left: 3px; place-items: center; border-radius: 999px; background: rgba(255,255,255,.09); font-size: 9px; }

        .ma-tab-content { min-height: 0; overflow-y: auto; padding: 10px 12px 12px; }
        .ma-group { margin-bottom: 9px; padding: 11px; border: 1px solid var(--ma-border); border-radius: 11px; background: var(--ma-surface); }
        .ma-compact-group { padding: 9px 11px; }
        .ma-group-heading, .ma-list-heading { margin-bottom: 10px; }
        .ma-heading-with-control { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .ma-group h2, .ma-list-heading h2 { margin: 0; color: var(--ma-text); font-size: 12px; font-weight: 800; }
        .ma-group p, .ma-list-heading p { margin: 2px 0 0; color: var(--ma-muted); font-size: 10px; }

        .ma-choice-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
        .ma-choice { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 9px; border: 1px solid var(--ma-border); border-radius: 9px; background: rgba(0,0,0,.15); cursor: pointer; }
        .ma-choice-wide { grid-column: 1 / -1; }
        .ma-choice span, .ma-option-row span { min-width: 0; }
        .ma-choice strong, .ma-option-row strong { display: block; font-size: 11px; }
        .ma-choice small, .ma-option-row small { display: block; margin-top: 2px; color: var(--ma-muted); font-size: 9px; }

        .ma-field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .ma-field-grid label { min-width: 0; color: #c8d0d8; font-size: 10px; }
        .ma-field-grid label > span { display: block; margin-bottom: 4px; }
        .ma-field-wide { grid-column: 1 / -1; }
        .ma-field-grid input, .ma-field-grid select { width: 100%; min-height: 34px; border: 1px solid var(--ma-border); border-radius: 8px; padding: 7px 8px; background: #0d1116; color: var(--ma-text); color-scheme: dark; font: inherit; }
        .ma-date-fields.ma-disabled { display: none; }
        .ma-inline-status { margin-top: 8px; color: var(--ma-muted); font-size: 10px; overflow-wrap: anywhere; }
        .ma-inline-status.ma-date-error { color: #ff7b84; }

        .ma-switch { display: inline-flex; align-items: center; gap: 6px; flex: none; cursor: pointer; color: var(--ma-muted); font-size: 10px; }
        .ma-switch input { position: absolute; opacity: 0; pointer-events: none; }
        .ma-switch span { position: relative; width: 30px; height: 17px; border-radius: 999px; background: #3a424c; transition: background .15s ease; }
        .ma-switch span::after { position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: white; content: ""; transition: transform .15s ease; }
        .ma-switch input:checked + span { background: var(--ma-accent); }
        .ma-switch input:checked + span::after { transform: translateX(13px); }
        .ma-switch b { font-weight: 650; }

        .ma-option-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; }
        .ma-option-row input { width: 17px; height: 17px; flex: none; }

        .ma-detail-metrics { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; margin-bottom: 11px; }
        .ma-detail-metrics div { min-width: 0; padding: 7px 5px; border: 1px solid var(--ma-border); border-radius: 8px; background: var(--ma-surface); text-align: center; }
        .ma-detail-metrics span { display: block; overflow: hidden; color: var(--ma-muted); font-size: 8px; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }
        .ma-detail-metrics strong { display: block; margin-top: 2px; font-size: 13px; }

        .ma-media-list { max-height: 390px; overflow-y: auto; border: 1px solid var(--ma-border); border-radius: 10px; background: #090c0f; }
        .ma-media-list:empty::before { display: block; padding: 28px 14px; color: var(--ma-muted); text-align: center; content: "No media collected yet"; }
        .ma-row { display: grid; grid-template-columns: 42px minmax(0, 1fr) 29px; align-items: center; gap: 8px; min-height: 52px; padding: 5px 7px; border-bottom: 1px solid rgba(255,255,255,.07); }
        .ma-row:last-child { border-bottom: 0; }
        .ma-thumb { width: 42px; height: 42px; border-radius: 7px; background: #242b33; object-fit: cover; }
        .ma-video-thumb { display: grid; place-items: center; color: white; font-size: 16px; }
        .ma-skipped { opacity: .44; }
        .ma-details { min-width: 0; }
        .ma-name { overflow: hidden; font-size: 11px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
        .ma-meta { margin-top: 3px; overflow: hidden; color: var(--ma-muted); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
        .ma-check { display: grid; width: 24px; height: 24px; place-items: center; border: 1px solid var(--ma-border); border-radius: 50%; font-weight: 900; }
        .ma-check-collected, .ma-check-skipped { color: #aeb8c2; }
        .ma-check-fetching { color: #ffc857; animation: ma-pulse .7s infinite alternate; }
        .ma-check-packed { border-color: var(--ma-success); background: var(--ma-success); color: white; }
        .ma-check-error { border-color: var(--ma-danger); background: var(--ma-danger); color: white; }
        @keyframes ma-pulse { to { opacity: .35; } }

        .ma-log { min-height: 290px; max-height: 440px; overflow: auto; padding: 9px; border: 1px solid var(--ma-border); border-radius: 10px; background: #080a0d; color: #bac3cc; font: 10px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; }
        .ma-log-line { overflow-wrap: anywhere; }
        .ma-log-success { color: #67d89e; }
        .ma-log-warn { color: #ffd06b; }
        .ma-log-error { color: #ff7b84; }

        .ma-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; padding: 10px 12px 12px; border-top: 1px solid var(--ma-border); background: rgba(8,10,13,.88); }
        #media-archiver-panel button { border: 0; border-radius: 8px; padding: 9px 8px; color: white; cursor: pointer; font: inherit; font-weight: 760; }
        #media-archiver-panel button:hover:not(:disabled) { filter: brightness(1.1); }
        #media-archiver-panel button:disabled { cursor: not-allowed; opacity: .42; }
        .ma-primary { grid-column: 1 / -1; background: var(--ma-accent-strong); }
        .ma-danger { background: var(--ma-danger); }
        .ma-success { background: var(--ma-success); }
        .ma-secondary, .ma-icon-button { background: #404954; }
        .ma-icon-button { width: 34px; min-width: 34px; padding: 6px !important; }
        .ma-text-button { padding: 5px 8px !important; background: transparent !important; color: var(--ma-muted) !important; }

        #media-archiver-panel.ma-collapsed #ma-body { display: none; }

        @media (max-width: 520px) {
            #media-archiver-panel { right: 8px; bottom: 8px; width: calc(100vw - 16px); max-height: calc(100vh - 16px); border-radius: 13px; }
            #ma-body { max-height: calc(100vh - 74px); }
            .ma-choice-grid, .ma-field-grid { grid-template-columns: 1fr; }
            .ma-choice-wide, .ma-field-wide { grid-column: auto; }
            .ma-detail-metrics { grid-template-columns: repeat(3, 1fr); }
        }
    `;

    const libraryStyle = document.createElement('style');
    libraryStyle.textContent = `
        html.ma-library-open { overflow: hidden !important; }

        #media-archiver-panel .ma-field-block { display: block; color: #c8d0d8; font-size: 10px; }
        #media-archiver-panel .ma-field-block > span { display: block; margin-bottom: 4px; }
        #media-archiver-panel .ma-field-block select,
        #media-archiver-panel .ma-field-block input { width: 100%; min-height: 34px; border: 1px solid var(--ma-border); border-radius: 8px; padding: 7px 8px; background: #0d1116; color: var(--ma-text); color-scheme: dark; font: inherit; }
        #media-archiver-panel .ma-naming-preview-wrap { margin-top: 8px; padding: 9px; border: 1px solid var(--ma-border); border-radius: 9px; background: rgba(0,0,0,.16); }
        #media-archiver-panel .ma-naming-preview-wrap span,
        #media-archiver-panel .ma-naming-preview-wrap small { display: block; color: var(--ma-muted); font-size: 9px; }
        #media-archiver-panel .ma-naming-preview-wrap strong { display: block; margin: 4px 0; overflow-wrap: anywhere; font: 10px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace; }
        #media-archiver-panel .ma-naming-preview-wrap strong.ma-invalid { color: #ff7b84; }
        #media-archiver-panel .ma-disclosure { margin-top: 8px; }
        #media-archiver-panel .ma-disclosure summary { cursor: pointer; color: #bcd2ff; font-weight: 700; }
        #media-archiver-panel .ma-field-disabled { opacity: .48; }
        #media-archiver-panel .ma-after-scan-options { display: grid; gap: 7px; }
        #media-archiver-panel .ma-mode-card { display: flex; align-items: flex-start; gap: 9px; padding: 10px; border: 1px solid var(--ma-border); border-radius: 10px; background: rgba(0,0,0,.15); cursor: pointer; }
        #media-archiver-panel .ma-mode-card:has(input:checked) { border-color: rgba(79,140,255,.72); background: rgba(79,140,255,.12); }
        #media-archiver-panel .ma-mode-card input { margin-top: 2px; }
        #media-archiver-panel .ma-mode-card strong,
        #media-archiver-panel .ma-mode-card small { display: block; }
        #media-archiver-panel .ma-mode-card small { margin-top: 3px; color: var(--ma-muted); font-size: 9px; }
        #media-archiver-panel .ma-activity-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 3px; }
        #media-archiver-panel .ma-detail-metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        #media-archiver-panel .ma-log,
        #media-archiver-panel .ma-log *,
        #ma-developer-overlay,
        #ma-developer-overlay * { user-select: text !important; -webkit-user-select: text !important; }

        #ma-library-overlay,
        #ma-developer-overlay {
            --ma-bg: #0d1014;
            --ma-surface: #171c22;
            --ma-surface-2: #202730;
            --ma-border: rgba(255,255,255,.13);
            --ma-text: #f5f7fa;
            --ma-muted: #99a5b2;
            --ma-danger: #e54855;
            --ma-danger-strong: #ff4858;
            position: fixed;
            inset: 0;
            z-index: 2147483647;
            display: grid;
            place-items: center;
            padding: clamp(8px, 1.5vw, 22px);
            background: rgba(3,5,8,.76);
            color: var(--ma-text);
            backdrop-filter: blur(12px);
            font: 13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        #ma-library-overlay[hidden], #ma-developer-overlay[hidden] { display: none !important; }
        #ma-library-overlay *, #ma-developer-overlay * { box-sizing: border-box; }

        .ma-library-dialog,
        .ma-developer-dialog {
            display: grid;
            width: min(1540px, calc(100vw - 20px));
            height: min(940px, calc(100vh - 20px));
            overflow: hidden;
            border: 1px solid var(--ma-border);
            border-radius: 18px;
            background: var(--ma-bg);
            box-shadow: 0 30px 100px rgba(0,0,0,.62);
        }
        .ma-library-dialog { grid-template-rows: auto auto auto minmax(0,1fr) auto; }
        .ma-developer-dialog { grid-template-rows: auto auto minmax(0,1fr); }

        .ma-library-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 18px;
            padding: 15px 18px;
            border-bottom: 1px solid var(--ma-border);
            background: rgba(7,9,12,.92);
        }
        .ma-library-header h1 { margin: 0; font-size: 18px; }
        .ma-library-header p { margin: 3px 0 0; color: var(--ma-muted); font-size: 11px; }
        .ma-library-header .ma-title-row { display: flex; align-items: center; gap: 9px; }
        .ma-library-header .ma-site-badge { padding: 3px 8px; border: 1px solid rgba(79,140,255,.5); border-radius: 999px; color: #bdd2ff; background: rgba(79,140,255,.13); font-size: 10px; }
        .ma-library-icon { display: grid; width: 38px; height: 38px; flex: none; place-items: center; border: 1px solid var(--ma-border); border-radius: 10px; background: var(--ma-surface-2); color: white; cursor: pointer; font-size: 24px; }

        .ma-library-toolbar {
            display: grid;
            grid-template-columns: minmax(250px, 2fr) repeat(3, minmax(145px, .7fr)) auto;
            gap: 9px;
            align-items: end;
            padding: 11px 16px;
            border-bottom: 1px solid var(--ma-border);
            background: var(--ma-surface);
        }
        .ma-library-toolbar label { color: var(--ma-muted); font-size: 9px; text-transform: uppercase; letter-spacing: .04em; }
        .ma-library-toolbar input,
        .ma-library-toolbar select,
        .ma-library-toolbar button,
        .ma-library-selection-bar button,
        .ma-library-footer button,
        .ma-developer-toolbar input,
        .ma-developer-toolbar button {
            width: 100%;
            min-height: 38px;
            border: 1px solid var(--ma-border);
            border-radius: 9px;
            padding: 8px 10px;
            background: #0d1116;
            color: var(--ma-text);
            color-scheme: dark;
            font: inherit;
        }
        .ma-library-toolbar label > span { display: block; margin-bottom: 4px; }
        .ma-library-toolbar button,
        .ma-library-selection-bar button,
        .ma-library-footer button,
        .ma-developer-toolbar button { cursor: pointer; font-weight: 700; }

        .ma-library-selection-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            padding: 8px 16px;
            border-bottom: 1px solid var(--ma-border);
            background: #10151a;
        }
        .ma-library-selection-actions { display: flex; flex-wrap: wrap; gap: 6px; }
        .ma-library-selection-actions button { width: auto; min-height: 32px; padding: 6px 9px; }
        .ma-library-shortcuts { color: var(--ma-muted); font-size: 10px; text-align: right; }

        .ma-library-items {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
            align-content: start;
            gap: 11px;
            min-height: 0;
            overflow: auto;
            padding: 14px 16px 32px;
            scroll-padding: 16px;
        }
        .ma-library-items.ma-list-view { grid-template-columns: 1fr; gap: 5px; }
        .ma-library-card {
            position: relative;
            display: grid;
            grid-template-rows: minmax(135px, 1fr) auto;
            min-width: 0;
            overflow: hidden;
            border: 2px solid transparent;
            border-radius: 13px;
            background: var(--ma-surface);
            box-shadow: 0 5px 16px rgba(0,0,0,.22);
            cursor: pointer;
            content-visibility: auto;
            contain: layout paint style;
            contain-intrinsic-size: 250px 230px;
            transition: transform .15s ease, border-color .15s ease, box-shadow .15s ease, opacity .15s ease;
        }
        .ma-library-items.ma-list-view .ma-library-card { grid-template-columns: 112px minmax(0,1fr); grid-template-rows: 90px; contain-intrinsic-size: 100% 94px; }
        .ma-library-card:focus-visible { outline: 3px solid #68a0ff; outline-offset: 3px; }
        .ma-library-card.ma-ineligible { opacity: .42; cursor: not-allowed; }
        .ma-library-card.ma-selected {
            border-color: var(--ma-danger-strong);
            box-shadow: 0 0 0 3px rgba(229,72,85,.23), 0 13px 34px rgba(0,0,0,.36);
            transform: translateY(-2px) scale(1.008);
            animation: ma-selection-sweep .24s ease-out;
        }
        .ma-library-card.ma-error { border-style: dashed; }
        .ma-library-card.ma-saved::after { position: absolute; left: 8px; top: 8px; z-index: 4; padding: 3px 6px; border-radius: 999px; background: #279b69; color: white; content: "Saved"; font-size: 9px; font-weight: 800; }
        .ma-library-image,
        .ma-library-video-preview,
        .ma-library-comment-preview { width: 100%; height: 100%; min-height: 135px; background: #252d36; object-fit: cover; }
        .ma-library-video-preview { display: grid; place-items: center; background-position: center; background-size: cover; color: white; font-size: 34px; font-weight: 900; text-shadow: 0 2px 12px #000; }
        .ma-library-comment-preview { overflow: hidden; padding: 13px; color: #d7dde5; font-size: 11px; }
        .ma-library-card-body { position: relative; z-index: 3; min-width: 0; padding: 9px 10px; background: linear-gradient(to bottom, rgba(23,28,34,.94), var(--ma-surface)); }
        .ma-library-card-body strong,
        .ma-library-card-body span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ma-library-card-body strong { font-size: 11px; }
        .ma-library-card-body span { margin-top: 3px; color: var(--ma-muted); font-size: 9px; }
        .ma-library-selected-overlay { position: absolute; inset: 0; z-index: 2; pointer-events: none; background: rgba(229,72,85,.14); opacity: 0; transition: opacity .15s ease; }
        .ma-library-card.ma-selected .ma-library-selected-overlay { opacity: 1; }
        .ma-library-check {
            position: absolute;
            right: 8px;
            top: 8px;
            z-index: 5;
            display: grid;
            width: 30px;
            height: 30px;
            place-items: center;
            border: 2px solid rgba(255,255,255,.74);
            border-radius: 50%;
            background: rgba(8,10,13,.82);
            color: transparent;
            cursor: pointer;
            font-weight: 900;
            transform: scale(.86);
            transition: transform .16s ease, background .16s ease, color .16s ease;
        }
        .ma-library-card.ma-selected .ma-library-check { background: var(--ma-danger); color: white; transform: scale(1); }
        .ma-library-check:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
        .ma-library-empty { padding: 70px 20px; color: var(--ma-muted); text-align: center; }

        .ma-library-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 18px;
            padding: 12px 16px;
            border-top: 1px solid var(--ma-border);
            background: rgba(7,9,12,.94);
        }
        .ma-library-footer > div:first-child { min-width: 0; }
        .ma-library-footer strong,
        .ma-library-footer span { display: block; }
        .ma-library-footer span { color: var(--ma-muted); font-size: 10px; }
        .ma-library-footer p { margin: 4px 0 0; color: #a9d2ff; font-size: 10px; }
        .ma-library-footer p.ma-error-text { color: #ff7b84; }
        .ma-library-footer-actions { display: flex; gap: 8px; }
        .ma-library-footer-actions button { width: auto; min-width: 150px; }
        .ma-library-footer .ma-library-primary { border-color: #f05b67; background: var(--ma-danger); color: white; }
        .ma-library-footer button:disabled { cursor: not-allowed; opacity: .45; }

        .ma-developer-toolbar { display: grid; grid-template-columns: minmax(220px, 1fr) 2fr 3fr auto; gap: 10px; align-items: center; padding: 10px 16px; border-bottom: 1px solid var(--ma-border); background: var(--ma-surface); }
        .ma-developer-toolbar fieldset { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; margin: 0; border: 0; padding: 0; }
        .ma-developer-toolbar legend { color: var(--ma-muted); font-size: 9px; }
        .ma-developer-toolbar label { font-size: 9px; white-space: nowrap; }
        .ma-developer-actions { display: flex; gap: 6px; }
        .ma-developer-content { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(360px, .8fr); min-height: 0; }
        .ma-developer-events { overflow: auto; padding: 12px 16px; }
        .ma-developer-event { margin-bottom: 7px; border: 1px solid var(--ma-border); border-radius: 9px; padding: 8px; background: var(--ma-surface); }
        .ma-developer-event summary { cursor: pointer; font: 10px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace; }
        .ma-developer-event pre { overflow: auto; color: #b9c4cf; font: 9px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap; }
        .ma-developer-error { border-color: rgba(229,72,85,.65); }
        .ma-developer-warn { border-color: rgba(255,199,87,.48); }
        .ma-developer-report-wrap { display: grid; grid-template-rows: auto minmax(0,1fr); gap: 6px; min-height: 0; padding: 12px 16px; border-left: 1px solid var(--ma-border); color: var(--ma-muted); font-size: 10px; }
        .ma-developer-report-wrap textarea { width: 100%; height: 100%; resize: none; border: 1px solid var(--ma-border); border-radius: 10px; padding: 10px; background: #080a0d; color: #d8e0e8; font: 10px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; }

        .ma-visually-hidden { position: absolute !important; width: 1px !important; height: 1px !important; overflow: hidden !important; clip: rect(0 0 0 0) !important; white-space: nowrap !important; }
        @keyframes ma-selection-sweep { from { box-shadow: 0 0 0 0 rgba(229,72,85,.7); } to { box-shadow: 0 0 0 3px rgba(229,72,85,.23), 0 13px 34px rgba(0,0,0,.36); } }

        @media (prefers-reduced-motion: reduce) {
            .ma-library-card,
            .ma-library-check,
            .ma-library-selected-overlay { transition: none !important; animation: none !important; }
            .ma-library-card.ma-selected { transform: none; }
        }
        @media (max-width: 900px) {
            .ma-library-toolbar { grid-template-columns: 1fr 1fr; }
            .ma-library-search { grid-column: 1 / -1; }
            .ma-library-selection-bar { align-items: flex-start; flex-direction: column; }
            .ma-library-shortcuts { text-align: left; }
            .ma-library-footer { align-items: stretch; flex-direction: column; }
            .ma-library-footer-actions button { flex: 1; min-width: 0; }
            .ma-developer-toolbar { grid-template-columns: 1fr; }
            .ma-developer-content { grid-template-columns: 1fr; }
            .ma-developer-report-wrap { min-height: 360px; border-top: 1px solid var(--ma-border); border-left: 0; }
        }
        @media (max-width: 560px) {
            #ma-library-overlay, #ma-developer-overlay { padding: 0; }
            .ma-library-dialog, .ma-developer-dialog { width: 100vw; height: 100vh; border: 0; border-radius: 0; }
            .ma-library-items { grid-template-columns: repeat(2, minmax(0,1fr)); padding: 8px; }
            .ma-library-toolbar { padding: 8px; }
            .ma-library-selection-bar { padding: 8px; }
            .ma-library-footer-actions { flex-direction: column; }
        }
    `;
    // Large-library hardening. Keep the complete filtered model in memory, but
    // create cards in bounded batches so opening a 1,000+ item review does not
    // synchronously attach every preview and event listener at once.
    let libraryRenderedCount = 0;
    const LIBRARY_INITIAL_RENDER_COUNT = 240;
    const LIBRARY_RENDER_BATCH_COUNT = 160;

    function staticLibraryPosterUrl(entry) {
        const raw = entry?.previewUrl;
        if (!raw || raw === entry?.url) return '';
        try {
            const extension = extensionFromPath(new URL(raw, location.href).pathname);
            return ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.bmp'].includes(extension)
                ? raw
                : '';
        } catch {
            return '';
        }
    }

    createLibraryPreview = function createLibraryPreviewOptimized(entry) {
        if (entry.kind === 'comment') {
            const text = document.createElement('div');
            text.className = 'ma-library-comment-preview';
            text.textContent = entry.payload?.bodyText || 'Comment';
            return text;
        }

        if (entry.mediaType === 'video' || entry.mediaType === 'external-gif') {
            const tile = document.createElement('div');
            tile.className = 'ma-library-video-preview';
            tile.textContent = entry.mediaType === 'external-gif' ? 'GIF' : '▶';
            const poster = staticLibraryPosterUrl(entry);
            if (poster) {
                tile.style.backgroundImage = `url("${String(poster).replace(/"/g, '%22')}")`;
            }
            return tile;
        }

        const image = document.createElement('img');
        image.className = 'ma-library-image';
        image.loading = 'lazy';
        image.decoding = 'async';
        image.fetchPriority = 'low';
        image.referrerPolicy = 'no-referrer';
        image.alt = '';
        image.src = entry.previewUrl || entry.url;
        return image;
    };

    function appendLibraryRenderBatch(minimumTargetIndex = null) {
        if (!libraryItemsElement || libraryRenderedCount >= libraryViewItems.length) return;
        const requestedEnd = minimumTargetIndex === null
            ? libraryRenderedCount + (
                libraryRenderedCount === 0
                    ? LIBRARY_INITIAL_RENDER_COUNT
                    : LIBRARY_RENDER_BATCH_COUNT
            )
            : minimumTargetIndex + 1;
        const end = Math.min(
            libraryViewItems.length,
            Math.max(requestedEnd, libraryRenderedCount + 1)
        );
        const fragment = document.createDocumentFragment();
        for (let index = libraryRenderedCount; index < end; index++) {
            fragment.appendChild(createLibraryCard(libraryViewItems[index], index));
        }
        libraryItemsElement.appendChild(fragment);
        libraryRenderedCount = end;
        updateLibraryRovingTabIndex();
    }

    renderLibrary = function renderLibraryBatched() {
        if (typeof libraryItemsElement === 'undefined' || !libraryItemsElement) return;
        libraryViewItems = libraryFilteredEntries();
        if (!libraryViewItems.some(entry => entry.key === libraryFocusedKey)) {
            libraryFocusedKey = libraryViewItems[0]?.key || null;
        }

        libraryItemsElement.replaceChildren();
        libraryRenderedCount = 0;
        libraryItemsElement.classList.toggle(
            'ma-list-view',
            libraryViewToggle?.dataset.view === 'list'
        );
        appendLibraryRenderBatch();
        libraryEmptyElement.hidden = libraryViewItems.length > 0;
        updateLibrarySelectionSummary();
    };

    handleLibraryCardKeydown = function handleLibraryCardKeydownBatched(event, key) {
        if (event.key === ' ') {
            event.preventDefault();
            selectionStore.toggle(key);
            selectionStore.syncItems([...mediaEntries.values()]);
            updateAllLibraryCardStates();
            return;
        }

        const index = libraryViewItems.findIndex(entry => entry.key === key);
        if (index < 0) return;
        let target = index;
        const grid = libraryViewToggle?.dataset.view !== 'list';
        const firstCard = libraryItemsElement.querySelector('[data-ma-item-key]');
        const columns = grid && firstCard
            ? Math.max(1, Math.floor(
                libraryItemsElement.clientWidth /
                Math.max(190, firstCard.getBoundingClientRect().width)
            ))
            : 1;

        if (event.key === 'ArrowLeft') target = index - 1;
        else if (event.key === 'ArrowRight') target = index + 1;
        else if (event.key === 'ArrowUp') target = index - columns;
        else if (event.key === 'ArrowDown') target = index + columns;
        else if (event.key === 'Home') target = 0;
        else if (event.key === 'End') target = libraryViewItems.length - 1;
        else return;

        event.preventDefault();
        target = Math.max(0, Math.min(libraryViewItems.length - 1, target));
        if (target >= libraryRenderedCount) appendLibraryRenderBatch(target);
        libraryFocusedKey = libraryViewItems[target]?.key || key;
        updateLibraryRovingTabIndex();
        const targetCard = [...libraryItemsElement.querySelectorAll('[data-ma-item-key]')]
            .find(card => card.dataset.maItemKey === libraryFocusedKey);
        targetCard?.focus();
        targetCard?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };

    libraryItemsElement.addEventListener('scroll', () => {
        const remaining =
            libraryItemsElement.scrollHeight -
            (libraryItemsElement.scrollTop + libraryItemsElement.clientHeight);
        if (remaining < 720) appendLibraryRenderBatch();
    }, { passive: true });

    const shortcutHint = libraryOverlay.querySelector('.ma-library-shortcuts');
    if (shortcutHint) {
        shortcutHint.textContent =
            'Click/check: toggle · Shift: range · Ctrl/Cmd+Shift: additive range · Ctrl/Cmd+A: visible · Space: toggle';
    }

    libraryStyle.textContent += `
        .ma-library-dialog,
        .ma-developer-dialog { min-height: 0; }
        .ma-library-items {
            grid-auto-rows: 232px;
            min-height: 0;
            height: 100%;
            overflow-x: hidden;
            overflow-y: auto;
            overscroll-behavior: contain;
            scrollbar-gutter: stable;
            align-content: start;
        }
        .ma-library-card {
            height: 232px;
            min-height: 232px;
            grid-template-rows: minmax(0, 1fr) auto;
            contain-intrinsic-size: 232px;
        }
        .ma-library-image,
        .ma-library-video-preview,
        .ma-library-comment-preview {
            min-width: 0;
            min-height: 0;
        }
        .ma-library-items.ma-list-view {
            grid-auto-rows: 96px;
        }
        .ma-library-items.ma-list-view .ma-library-card {
            height: 96px;
            min-height: 96px;
            grid-template-columns: 112px minmax(0, 1fr);
            grid-template-rows: 96px;
            contain-intrinsic-size: 96px;
        }
        .ma-developer-toolbar > input[type="search"] {
            width: 100%;
        }
        .ma-developer-toolbar fieldset label {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            min-height: 24px;
            padding: 2px 5px;
            border: 1px solid rgba(255,255,255,.08);
            border-radius: 6px;
            background: rgba(0,0,0,.12);
        }
        .ma-developer-toolbar input[type="checkbox"] {
            appearance: auto !important;
            width: 15px !important;
            min-width: 15px !important;
            height: 15px !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            accent-color: #4f8cff;
        }
        @media (max-width: 560px) {
            .ma-library-items { grid-auto-rows: 200px; }
            .ma-library-card { height: 200px; min-height: 200px; }
        }
    `;
    document.head.appendChild(style);
    document.body.appendChild(panel);

    const phaseElement = panel.querySelector('#ma-phase');
    const progressFill = panel.querySelector('#ma-progress-fill');
    const foundElement = panel.querySelector('#ma-found');
    const photoCountElement = panel.querySelector('#ma-photo-count');
    const videoCountElement = panel.querySelector('#ma-video-count');
    const externalGifCountElement = panel.querySelector('#ma-external-gif-count');
    const inRangeElement = panel.querySelector('#ma-in-range');
    const excludedDateElement = panel.querySelector('#ma-excluded-date');
    const selectedCountElement = panel.querySelector('#ma-selected-count');
    const selectedSummaryElement = panel.querySelector('#ma-selected-summary');
    const packedElement = panel.querySelector('#ma-packed');
    const errorElement = panel.querySelector('#ma-errors');
    const mediaTabCount = panel.querySelector('#ma-media-tab-count');
    const mediaList = panel.querySelector('#ma-media-list');
    const logArea = panel.querySelector('#ma-log');
    const startButton = panel.querySelector('#ma-start');
    const stopButton = panel.querySelector('#ma-stop');
    const zipButton = panel.querySelector('#ma-zip');
    const resetButton = panel.querySelector('#ma-reset');
    const autoZipCheckbox = panel.querySelector('#ma-auto-zip');
    const photoCheckbox = panel.querySelector('#ma-include-photos');
    const videoCheckbox = panel.querySelector('#ma-include-videos');
    const externalGifCheckbox = panel.querySelector('#ma-include-external-gifs');
    const scanDirectionSelect = panel.querySelector('#ma-scan-direction');
    const finalPositionSelect = panel.querySelector('#ma-final-position');
    const dateFilterCheckbox = panel.querySelector('#ma-date-filter');
    const dateFields = panel.querySelector('#ma-date-fields');
    const fromDateInput = panel.querySelector('#ma-from-date');
    const dateEndModeSelect = panel.querySelector('#ma-date-end-mode');
    const toDateWrap = panel.querySelector('#ma-to-date-wrap');
    const toDateInput = panel.querySelector('#ma-to-date');
    const dateSummaryElement = panel.querySelector('#ma-date-summary');
    const collapseButton = panel.querySelector('#ma-collapse');
    const clearLogButton = panel.querySelector('#ma-clear-log');
    const tabButtons = [...panel.querySelectorAll('[data-ma-tab]')];
    const tabPanels = [...panel.querySelectorAll('[data-ma-panel]')];

    function selectInterfaceTab(tabName) {
        for (const button of tabButtons) {
            const selected = button.dataset.maTab === tabName;
            button.setAttribute('aria-selected', String(selected));
        }

        for (const tabPanel of tabPanels) {
            tabPanel.hidden = tabPanel.dataset.maPanel !== tabName;
        }
    }

    function refreshDateControls() {
        const enabled = dateFilterCheckbox.checked;
        const specificEnd = enabled && dateEndModeSelect.value === 'specific';

        dateFields.classList.toggle('ma-disabled', !enabled);
        toDateWrap.hidden = !specificEnd;

        const range = getDateRangeConfig();
        dateSummaryElement.classList.toggle('ma-date-error', !range.valid);
        dateSummaryElement.textContent = !enabled
            ? 'Date interval is off. The current-position chronology control is used.'
            : range.valid
                ? `Automatic interval: ${range.label}`
                : range.error;

        scheduleRender();
        updateCounters();
    }

    for (const button of tabButtons) {
        button.addEventListener('click', () => {
            selectInterfaceTab(button.dataset.maTab);
        });
    }

    startButton.addEventListener('click', startAutomaticWorkflow);
    stopButton.addEventListener('click', requestStop);
    zipButton.addEventListener('click', createAndDownloadZipParts);
    autoZipCheckbox.addEventListener('change', updateButtons);

    for (const checkbox of [
        photoCheckbox,
        videoCheckbox,
        externalGifCheckbox
    ]) {
        checkbox.addEventListener('change', () => {
            scheduleRender();
            scheduleLibraryRender();
            updateCounters();
            renderNamingPreview();
        });
    }

    scanDirectionSelect.addEventListener('change', () => {
        addLog(`Scan mode selected: ${scanModeDescription(scanDirectionSelect.value)}.`);
    });
    finalPositionSelect.addEventListener('change', () => {
        addLog(`Final position: ${finalPositionDescription(finalPositionSelect.value)}.`);
    });
    dateFilterCheckbox.addEventListener('change', refreshDateControls);
    fromDateInput.addEventListener('change', refreshDateControls);
    dateEndModeSelect.addEventListener('change', refreshDateControls);
    toDateInput.addEventListener('change', refreshDateControls);

    resetButton.addEventListener('click', () => {
        resetCollection();
        logArea.replaceChildren();
        diagnostics.clear();
        addLog('Collection reset.');
    });
    clearLogButton.addEventListener('click', () => {
        logArea.replaceChildren();
    });
    collapseButton.addEventListener('click', () => {
        const collapsed = panel.classList.toggle('ma-collapsed');
        collapseButton.textContent = collapsed ? '+' : '−';
        collapseButton.title = collapsed ? 'Expand panel' : 'Collapse panel';
        collapseButton.setAttribute(
            'aria-label',
            collapsed ? 'Expand panel' : 'Collapse panel'
        );
    });

    window.addEventListener('beforeunload', abortActiveRequests);

    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    fromDateInput.value = localDateInputValue(thirtyDaysAgo);
    toDateInput.value = localDateInputValue(today);
    dateEndModeSelect.value = 'latest';

    addLog(
        `Ready on ${activeSiteAdapter.label}. Configure the scan, then start.`
    );
    selectInterfaceTab('setup');
    refreshDateControls();
    document.head.appendChild(libraryStyle);
    document.body.append(libraryOverlay, developerLogsOverlay);

    reviewBeforeRadio.addEventListener('change', () => {
        syncWorkflowMode();
        updateButtons();
    });
    autoZipCheckbox.addEventListener('change', () => {
        syncWorkflowMode();
        updateButtons();
    });

    openLibraryButton.addEventListener('click', openLibrary);
    libraryCloseButton.addEventListener('click', closeLibrary);
    libraryCancelButton.addEventListener('click', closeLibrary);
    libraryArchiveButton.addEventListener('click', archiveSelectedFromLibrary);
    libraryOverlay.addEventListener('click', event => {
        if (event.target === libraryOverlay) closeLibrary();
    });
    libraryDialogElement.addEventListener('keydown', handleLibraryDialogKeydown);

    librarySearchInput.addEventListener('input', scheduleLibraryRender);
    librarySortSelect.addEventListener('change', scheduleLibraryRender);
    libraryTypeFilter.addEventListener('change', scheduleLibraryRender);
    libraryStatusFilter.addEventListener('change', scheduleLibraryRender);
    libraryViewToggle.addEventListener('click', toggleLibraryView);
    selectVisibleButton.addEventListener('click', selectAllVisibleLibrary);
    selectEligibleButton.addEventListener('click', selectAllEligibleLibrary);
    selectNoneButton.addEventListener('click', selectNoneLibrary);
    selectInvertButton.addEventListener('click', invertVisibleLibrary);

    const namingPresetTemplates = Object.freeze({
        numbered: '{sequence}',
        'source-datetime': '{datetime}',
        'source-date-number': '{source}_{date}_{sequence}',
        'original-number': '{original}_{sequence}'
    });

    namingPresetSelect.addEventListener('change', () => {
        const template = namingPresetTemplates[namingPresetSelect.value];
        if (template) namingTemplateInput.value = template;
        if (namingPresetSelect.value === 'custom') namingCustomizeToggle.open = true;
        refreshNamingAdvancedVisibility();
        renderNamingPreview();
        persistNamingSettings();
    });
    namingCustomizeToggle.addEventListener('toggle', refreshNamingAdvancedVisibility);
    for (const control of [
        namingTemplateInput,
        namingTimezoneSelect,
        namingSequenceWidthInput
    ]) {
        control.addEventListener('input', () => {
            renderNamingPreview();
            persistNamingSettings();
        });
        control.addEventListener('change', () => {
            renderNamingPreview();
            persistNamingSettings();
        });
    }

    copyActivityButton.addEventListener('click', copyActivity);
    downloadReportButton.addEventListener('click', downloadDeveloperReport);
    developerLogsButton.addEventListener('click', openDeveloperLogs);
    clearLogButton.addEventListener('click', () => diagnostics.clear());

    developerCloseButton.addEventListener('click', closeDeveloperLogs);
    developerLogsOverlay.addEventListener('click', event => {
        if (event.target === developerLogsOverlay) closeDeveloperLogs();
    });
    developerLogsOverlay.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeDeveloperLogs();
        }
    });
    developerSearchInput.addEventListener('input', renderDeveloperLogs);
    for (const input of [...developerLevelFilters, ...developerCategoryFilters]) {
        input.addEventListener('change', renderDeveloperLogs);
    }
    copyDeveloperButton.addEventListener('click', copyDeveloperReport);
    downloadDeveloperButton.addEventListener('click', downloadDeveloperReport);

    document.addEventListener('visibilitychange', () => {
        liveMetrics.handleVisibilityChange(document.visibilityState === 'visible');
    });

    loadNamingSettings();
    renderLibrary();
    updateButtons();
    function applyAdapterCapabilitiesToUi() {
        const capabilities = activeSiteAdapter.capabilities || {};
        const dateGroup = dateFilterCheckbox?.closest('.ma-group');
        const dateSupported = capabilities.dateFilter !== false;
        if (dateGroup) dateGroup.hidden = !dateSupported;
        if (!dateSupported) {
            dateFilterCheckbox.checked = false;
            dateFilterCheckbox.disabled = true;
            dateFields.classList.add('ma-disabled');
        }

        const supportedModes = new Set(capabilities.scanModes || []);
        for (const option of [...scanDirectionSelect.options]) {
            option.hidden = supportedModes.size > 0 && !supportedModes.has(option.value);
            option.disabled = option.hidden;
        }
        if (scanDirectionSelect.selectedOptions[0]?.disabled) {
            const firstSupported = [...scanDirectionSelect.options]
                .find(option => !option.disabled);
            if (firstSupported) scanDirectionSelect.value = firstSupported.value;
        }

        const textRecordsSupported = Boolean(capabilities.textRecords);
        const commentOption = libraryTypeFilter?.querySelector('option[value="comment"]');
        if (commentOption) commentOption.hidden = !textRecordsSupported;

        const mediaSupported = capabilities.media !== false;
        const mediaGroup = photoCheckbox?.closest('.ma-group');
        if (mediaGroup) mediaGroup.hidden = !mediaSupported && textRecordsSupported;

        refreshDateControls();
        updateButtons();
    }

    applyAdapterCapabilitiesToUi();
    // ---------- Compact four-tab interface ----------

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
    archiveMainGroup.innerHTML = `
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
    `;
    archiveTabPanel.appendChild(archiveMainGroup);

    const compactAutoArchiveGroup = autoZipCheckbox?.closest('.ma-group');
    if (compactAutoArchiveGroup) {
        const archiveChoiceContent = compactAutoArchiveGroup.querySelector(
            '.ma-after-scan-options, .ma-option-row'
        );
        if (archiveChoiceContent) {
            archiveMainGroup
                .querySelector('.ma-archive-primary')
                .appendChild(archiveChoiceContent);
        }
        compactAutoArchiveGroup.remove();
    }
    if (finalPositionLabel) {
        archiveMainGroup
            .querySelector('.ma-disclosure-body')
            .appendChild(finalPositionLabel);
    }

    const compactStyle = document.createElement('style');
    compactStyle.textContent = `
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
        #media-archiver-panel .ma-switch > span { pointer-events: none; }
    `;
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
    function applyProviderPreferredScanMode({ forDateFilter = false } = {}) {
        const preferred = forDateFilter
            ? activeSiteAdapter.preferredDateScanMode || activeSiteAdapter.preferredScanMode
            : activeSiteAdapter.preferredScanMode;
        if (!preferred) return false;

        const option = [...scanDirectionSelect.options]
            .find(candidate => candidate.value === preferred && !candidate.disabled);
        if (!option || scanDirectionSelect.value === preferred) return false;

        scanDirectionSelect.value = preferred;
        addLog(
            `${activeSiteAdapter.label} selected its optimized scan mode: ${scanModeDescription(preferred)}.`
        );
        return true;
    }

    dateFilterCheckbox.addEventListener('change', () => {
        if (
            dateFilterCheckbox.checked &&
            activeSiteAdapter.capabilities?.dateFilter !== false
        ) {
            applyProviderPreferredScanMode({ forDateFilter: true });
        }
    });

    applyProviderPreferredScanMode();
    const virusTotalService = globalThis.MediaArchiverVirusTotal.createService(runtime);
    let virusTotalSettingsReady;

    const virusTotalGroup = document.createElement('section');
    virusTotalGroup.className = 'ma-group';
    virusTotalGroup.id = 'ma-virustotal-settings';
    virusTotalGroup.innerHTML = `
        <div class="ma-group-heading">
            <div>
                <h2>VirusTotal check</h2>
                <p>Optionally check confirmed files after download and before they enter a ZIP.</p>
            </div>
        </div>
        <div class="ma-field-grid">
            <label class="ma-field-wide">
                <span>Scan mode</span>
                <select id="ma-vt-mode">
                    <option value="off">Off</option>
                    <option value="hash-only">SHA-256 report lookup only</option>
                    <option value="upload-unknown">Lookup, then upload unknown files</option>
                </select>
            </label>
            <label>
                <span>Block threshold</span>
                <select id="ma-vt-threshold">
                    <option value="malicious">Malicious only</option>
                    <option value="suspicious">Suspicious or malicious</option>
                </select>
            </label>
            <label>
                <span>Unknown/error result</span>
                <select id="ma-vt-unknown-policy">
                    <option value="allow">Allow into ZIP</option>
                    <option value="block">Block from ZIP</option>
                </select>
            </label>
        </div>
        <div class="ma-button-row">
            <button id="ma-vt-set-key" class="ma-secondary" type="button">Set API key</button>
            <button id="ma-vt-clear-key" class="ma-text-button" type="button">Clear key</button>
            <span id="ma-vt-key-status" class="ma-inline-status">No API key stored.</span>
        </div>
        <label id="ma-vt-upload-consent-row" class="ma-option-row" hidden>
            <span>
                <strong>I consent to uploading unknown files to VirusTotal</strong>
                <small>Standard VirusTotal uploads may be shared with security partners. This consent applies only to the current page session.</small>
            </span>
            <input id="ma-vt-upload-consent" type="checkbox">
        </label>
        <div id="ma-vt-note" class="ma-inline-status">
            VirusTotal is disabled by default. API requests are rate-limited and the API key is stored only in this browser profile.
        </div>
    `;

    const setupPanel = panel.querySelector('[data-ma-panel="setup"]');
    const autoArchiveGroup = setupPanel?.querySelector('.ma-compact-group');
    if (autoArchiveGroup) autoArchiveGroup.before(virusTotalGroup);
    else setupPanel?.appendChild(virusTotalGroup);

    const virusTotalModeSelect = virusTotalGroup.querySelector('#ma-vt-mode');
    const virusTotalThresholdSelect = virusTotalGroup.querySelector('#ma-vt-threshold');
    const virusTotalUnknownPolicySelect = virusTotalGroup.querySelector('#ma-vt-unknown-policy');
    const virusTotalSetKeyButton = virusTotalGroup.querySelector('#ma-vt-set-key');
    const virusTotalClearKeyButton = virusTotalGroup.querySelector('#ma-vt-clear-key');
    const virusTotalKeyStatus = virusTotalGroup.querySelector('#ma-vt-key-status');
    const virusTotalUploadConsentRow = virusTotalGroup.querySelector('#ma-vt-upload-consent-row');
    const virusTotalUploadConsentCheckbox = virusTotalGroup.querySelector('#ma-vt-upload-consent');
    const virusTotalNote = virusTotalGroup.querySelector('#ma-vt-note');

    function refreshVirusTotalControls() {
        const mode = virusTotalModeSelect.value;
        virusTotalUploadConsentRow.hidden = mode !== 'upload-unknown';
        virusTotalThresholdSelect.disabled = mode === 'off';
        virusTotalUnknownPolicySelect.disabled = mode === 'off';
        virusTotalNote.textContent = mode === 'off'
            ? 'VirusTotal is disabled. No hashes or files are sent.'
            : mode === 'hash-only'
                ? 'Only the SHA-256 hash is queried. Unknown files are not uploaded.'
                : 'Unknown files are uploaded only after the session consent checkbox is selected.';
    }

    async function updateVirusTotalKeyStatus() {
        const key = String(await runtime.getSetting('virustotal.apiKey', '') || '').trim();
        virusTotalKeyStatus.textContent = key
            ? 'API key stored locally.'
            : 'No API key stored.';
        virusTotalKeyStatus.classList.toggle('ma-date-error', !key && virusTotalModeSelect.value !== 'off');
        return Boolean(key);
    }

    async function persistVirusTotalPreferences() {
        await Promise.all([
            runtime.setSetting('virustotal.mode', virusTotalModeSelect.value),
            runtime.setSetting('virustotal.blockThreshold', virusTotalThresholdSelect.value),
            runtime.setSetting('virustotal.unknownPolicy', virusTotalUnknownPolicySelect.value)
        ]);
        refreshVirusTotalControls();
        await updateVirusTotalKeyStatus();
    }

    async function initializeVirusTotalSettings() {
        const [mode, threshold, unknownPolicy] = await Promise.all([
            runtime.getSetting('virustotal.mode', 'off'),
            runtime.getSetting('virustotal.blockThreshold', 'malicious'),
            runtime.getSetting('virustotal.unknownPolicy', 'allow')
        ]);
        virusTotalModeSelect.value = ['off', 'hash-only', 'upload-unknown'].includes(mode)
            ? mode
            : 'off';
        virusTotalThresholdSelect.value = threshold === 'suspicious'
            ? 'suspicious'
            : 'malicious';
        virusTotalUnknownPolicySelect.value = unknownPolicy === 'block'
            ? 'block'
            : 'allow';
        refreshVirusTotalControls();
        await updateVirusTotalKeyStatus();
    }

    virusTotalSettingsReady = initializeVirusTotalSettings().catch(error => {
        diagnostics.error(
            'VIRUSTOTAL_SETTINGS_FAILED',
            'VirusTotal settings could not be loaded.',
            error,
            {},
            { category: 'virustotal' }
        );
        virusTotalModeSelect.value = 'off';
        refreshVirusTotalControls();
    });

    for (const select of [
        virusTotalModeSelect,
        virusTotalThresholdSelect,
        virusTotalUnknownPolicySelect
    ]) {
        select.addEventListener('change', () => {
            persistVirusTotalPreferences().catch(error => {
                addLog(`VirusTotal settings could not be saved. Code: ${error.code || 'VIRUSTOTAL_SETTINGS_FAILED'}`, 'error');
            });
        });
    }

    virusTotalSetKeyButton.addEventListener('click', async () => {
        const key = prompt(
            'Enter your VirusTotal API key. It will be stored only in this browser profile and never written to logs or ZIP manifests.',
            ''
        );
        if (key == null) return;
        const normalized = key.trim();
        if (!normalized) {
            addLog('VirusTotal API key was not changed.', 'warn');
            return;
        }
        await runtime.setSetting('virustotal.apiKey', normalized);
        await updateVirusTotalKeyStatus();
        addLog('VirusTotal API key stored locally.', 'success');
    });

    virusTotalClearKeyButton.addEventListener('click', async () => {
        await runtime.setSetting('virustotal.apiKey', '');
        virusTotalUploadConsentCheckbox.checked = false;
        await updateVirusTotalKeyStatus();
        addLog('VirusTotal API key cleared.');
    });

    async function prepareVirusTotalArchiveOptions() {
        await virusTotalSettingsReady;
        const mode = virusTotalModeSelect.value;
        if (mode === 'off') {
            return Object.freeze({
                mode: 'off',
                blockThreshold: virusTotalThresholdSelect.value,
                unknownPolicy: virusTotalUnknownPolicySelect.value,
                uploadConsent: false
            });
        }

        const apiKey = String(await runtime.getSetting('virustotal.apiKey', '') || '').trim();
        if (!apiKey) {
            const error = new Error('Add a VirusTotal API key or turn VirusTotal off.');
            error.code = 'VIRUSTOTAL_API_KEY_MISSING';
            throw error;
        }
        if (mode === 'upload-unknown' && !virusTotalUploadConsentCheckbox.checked) {
            const error = new Error('Confirm the VirusTotal upload consent checkbox before archiving.');
            error.code = 'VIRUSTOTAL_UPLOAD_CONSENT_REQUIRED';
            throw error;
        }

        return Object.freeze({
            mode,
            apiKey,
            blockThreshold: virusTotalThresholdSelect.value,
            unknownPolicy: virusTotalUnknownPolicySelect.value,
            uploadConsent: mode === 'upload-unknown' && virusTotalUploadConsentCheckbox.checked
        });
    }

    async function scanArchiveEntryWithVirusTotal(entry, data, options) {
        if (!options || options.mode === 'off' || entry.kind !== 'media') return null;
        setPhase(`VIRUSTOTAL: ${entry.filename || entry.key}`);
        const result = await virusTotalService.scanBytes(data, entry.filename, options);
        entry.payload = {
            ...entry.payload,
            virusTotal: result
        };
        const stats = result.stats || {};
        addLog(
            `VirusTotal ${result.verdict}: ${entry.filename || entry.key} ` +
            `(malicious ${stats.malicious || 0}, suspicious ${stats.suspicious || 0}).`,
            result.verdict === 'clean'
                ? 'success'
                : result.verdict === 'unknown'
                    ? 'warn'
                    : 'error'
        );
        if (virusTotalService.shouldBlock(result, options)) {
            const error = new Error(
                `VirusTotal verdict ${result.verdict} blocked this file from the ZIP.`
            );
            error.code = 'VIRUSTOTAL_FILE_BLOCKED';
            error.virusTotal = result;
            throw error;
        }
        return result;
    }

    let activeVirusTotalArchiveOptions = Object.freeze({ mode: 'off' });
    const requestArrayBufferWithoutVirusTotal = requestArrayBuffer;
    const createAndDownloadZipPartsWithoutVirusTotal = createAndDownloadZipParts;

    requestArrayBuffer = async function requestArrayBufferWithVirusTotal(url, attempt = 1) {
        const buffer = await requestArrayBufferWithoutVirusTotal(url, attempt);
        if (activeVirusTotalArchiveOptions.mode === 'off') return buffer;

        const entry = [...mediaEntries.values()].find(candidate =>
            candidate.kind === 'media' &&
            candidate.url === url &&
            candidate.status === STATUS.FETCHING
        ) || [...mediaEntries.values()].find(candidate =>
            candidate.kind === 'media' && candidate.url === url
        );
        if (!entry) return buffer;

        try {
            await scanArchiveEntryWithVirusTotal(
                entry,
                new Uint8Array(buffer),
                activeVirusTotalArchiveOptions
            );
        } catch (error) {
            if (
                error?.code !== 'VIRUSTOTAL_FILE_BLOCKED' &&
                activeVirusTotalArchiveOptions.unknownPolicy === 'allow'
            ) {
                const result = Object.freeze({
                    provider: 'virustotal',
                    verdict: 'error',
                    known: false,
                    uploaded: false,
                    stats: null,
                    reportUrl: null,
                    checkedAt: new Date().toISOString(),
                    code: error?.code || 'VIRUSTOTAL_REQUEST_FAILED'
                });
                entry.payload = { ...entry.payload, virusTotal: result };
                diagnostics.warn(
                    result.code,
                    'VirusTotal could not complete the check; the configured unknown policy allows the file.',
                    { filename: entry.filename, continued: true },
                    { category: 'virustotal', adapterId: entry.adapterId }
                );
                addLog(
                    `VirusTotal check unavailable for ${entry.filename || entry.key}; unknown/error policy allows it. Code: ${result.code}`,
                    'warn'
                );
                return buffer;
            }
            throw error;
        }
        return buffer;
    };

    createAndDownloadZipParts = async function createAndDownloadZipPartsWithVirusTotal() {
        const reviewNeedsConfirmation =
            getAfterScanMode() === 'review' && !reviewArchiveConfirmed;
        if (reviewNeedsConfirmation) {
            return createAndDownloadZipPartsWithoutVirusTotal();
        }

        let options;
        try {
            options = await prepareVirusTotalArchiveOptions();
        } catch (error) {
            reviewArchiveConfirmed = false;
            setPhase('VIRUSTOTAL SETUP REQUIRED');
            addLog(
                `${error.message} Code: ${error.code || 'VIRUSTOTAL_SETTINGS_FAILED'}`,
                'error'
            );
            diagnostics.error(
                error.code || 'VIRUSTOTAL_SETTINGS_FAILED',
                'VirusTotal prevented the archive from starting.',
                error,
                { originalRequestsStarted: 0 },
                { category: 'virustotal' }
            );
            updateButtons();
            return;
        }

        activeVirusTotalArchiveOptions = options;
        if (options.mode !== 'off') {
            addLog(
                options.mode === 'hash-only'
                    ? 'VirusTotal hash-only checks are enabled. Original files will be hashed after confirmation and before ZIP creation.'
                    : 'VirusTotal upload-unknown checks are enabled with session consent. Unknown files may be uploaded before ZIP creation.',
                'warn'
            );
        }
        try {
            return await createAndDownloadZipPartsWithoutVirusTotal();
        } finally {
            activeVirusTotalArchiveOptions = Object.freeze({ mode: 'off' });
        }
    };

    zipButton.addEventListener('click', event => {
        if (virusTotalModeSelect.value === 'off') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        createAndDownloadZipParts();
    }, true);

})();
