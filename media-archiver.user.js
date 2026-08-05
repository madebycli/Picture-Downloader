// ==UserScript==
// @name         Media Archiver
// @namespace    https://github.com/madebycli/Picture-Downloader
// @version      6.0.0
// @description  Collect rendered media from supported web apps and save filtered files as numbered ZIP parts.
// @homepageURL  https://github.com/madebycli/Picture-Downloader
// @supportURL   https://github.com/madebycli/Picture-Downloader/issues
// @match        https://discord.com/channels/*
// @match        https://ptb.discord.com/channels/*
// @match        https://canary.discord.com/channels/*
// @require      https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js
// @grant        GM_xmlhttpRequest
// @connect      cdn.discordapp.com
// @connect      media.discordapp.net
// @connect      images-ext-1.discordapp.net
// @connect      images-ext-2.discordapp.net
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    const VERSION = '6.0.0';
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
        // Common browser-compatible video containers
        '.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi',

        // Additional uploaded video containers
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

    /** @type {Map<string, {
     * key: string,
     * url: string,
     * previewUrl: string,
     * filename: string,
     * mediaType: 'photo'|'video'|'external-gif',
     * sourceKind: string,
     * sourcePageUrl: string|null,
     * itemId: string|null,
     * timestamp: string|null,
     * firstSeen: number,
     * status: string,
     * error: string,
     * size: number
     * }>} */
    const mediaEntries = new Map(); // Stores attachments and external GIF previews.

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
        const requiredMethods = [
            'matches',
            'scanVisibleMedia',
            'findScroller',
            'visibleItemIds',
            'visibleItemTimeRange',
            'findItemElementById',
            'captureStartingAnchor',
            'findItemId',
            'findItemTimestamp',
            'compareItemIds',
            'getArchiveContext',
            'isDownloadUrlAllowed'
        ];

        if (!adapter?.id || !adapter?.label) {
            throw new Error('A site adapter needs an id and label.');
        }

        for (const method of requiredMethods) {
            if (typeof adapter[method] !== 'function') {
                throw new Error(
                    `Site adapter ${adapter.id} is missing ${method}().`
                );
            }
        }

        SITE_ADAPTERS.push(Object.freeze(adapter));
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
            terms: Object.freeze({
                timeline: 'channel or thread',
                item: 'message',
                items: 'messages',
                oldest: 'timeline start',
                newest: 'timeline end'
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
            findScroller: findDiscordScroller,
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

    function addOrUpdateMediaEntry(rawUrl, sourceElement) {
        if (!isDiscordAttachmentUrl(rawUrl, sourceElement)) return false;

        const originalUrl = normalizeDiscordAttachmentUrl(rawUrl);
        const key = canonicalKey(originalUrl);
        const existing = mediaEntries.get(key);

        if (existing) {
            if (urlQualityScore(originalUrl) > urlQualityScore(existing.url)) {
                existing.url = originalUrl;
            }

            // A freshly loaded URL usually has the newest signature.
            if (new URL(originalUrl).searchParams.has('ex')) {
                existing.url = originalUrl;
            }

            if (!existing.itemId) existing.itemId = findItemId(sourceElement);
            if (!existing.timestamp) existing.timestamp = findItemTimestamp(sourceElement);
            return false;
        }

        mediaEntries.set(key, {
            key,
            url: originalUrl,
            previewUrl: rawUrl,
            filename: filenameFromUrl(originalUrl),
            mediaType: mediaTypeFromUrl(originalUrl, sourceElement),
            sourceKind: 'discord-attachment',
            sourcePageUrl: null,
            itemId: findItemId(sourceElement),
            timestamp: findItemTimestamp(sourceElement),
            firstSeen: firstSeenCounter++,
            status: STATUS.COLLECTED,
            error: '',
            size: 0
        });

        scheduleRender();
        return true;
    }

    function addOrUpdateExternalGif(
        rawUrl,
        sourceElement,
        sourcePageUrl = null
    ) {
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
            existing.url = mediaUrl;
            existing.previewUrl = mediaUrl;

            if (!existing.sourcePageUrl && sourcePageUrl) {
                existing.sourcePageUrl = sourcePageUrl;
            }

            if (!existing.itemId) {
                existing.itemId = findItemId(sourceElement);
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

        mediaEntries.set(key, {
            key,
            url: mediaUrl,
            previewUrl: mediaUrl,
            filename,
            mediaType: 'external-gif',
            sourceKind: 'external-gif-preview',
            sourcePageUrl:
                sourcePageUrl ||
                findExternalGifPageUrl(sourceElement),
            itemId: findItemId(sourceElement),
            timestamp: findItemTimestamp(sourceElement),
            firstSeen: firstSeenCounter++,
            status: STATUS.COLLECTED,
            error: '',
            size: 0
        });

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

    function findDiscordScroller() {
        const messageList =
            document.querySelector('ol[data-list-id="chat-messages"]') ||
            document.querySelector('[data-list-id="chat-messages"]') ||
            document.querySelector('main');

        let current = messageList;
        while (current && current !== document.body) {
            if (isScrollable(current)) return current;
            current = current.parentElement;
        }

        // Fallback: largest visible scroll container in the main area.
        const candidates = [...document.querySelectorAll('main div, main section')]
            .filter(isScrollable)
            .sort((a, b) =>
                (b.scrollHeight - b.clientHeight) -
                (a.scrollHeight - a.clientHeight)
            );

        return candidates[0] || null;
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


    registerSiteAdapter(createDiscordAdapter());
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

    function isEntryIncluded(entry) {
        return (
            mediaTypeIsEnabled(entry) &&
            isEntryInsideDateRange(entry)
        );
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

        return '';
    }

    function selectedMediaEntries() {
        return sortedMediaEntries().filter(isEntryIncluded);
    }

    function selectionStatistics() {
        let inDateRange = 0;
        let excludedByDate = 0;
        let excludedByType = 0;
        let selected = 0;

        for (const entry of mediaEntries.values()) {
            const insideDate = isEntryInsideDateRange(entry);
            const typeEnabled = mediaTypeIsEnabled(entry);

            if (insideDate) inDateRange++;
            else excludedByDate++;

            if (insideDate && !typeEnabled) excludedByType++;
            if (insideDate && typeEnabled) selected++;
        }

        return {
            total: mediaEntries.size,
            inDateRange,
            excludedByDate,
            excludedByType,
            selected
        };
    }

    function selectedDateBoundaryReached(direction) {
        const range = getDateRangeConfig();
        if (!range.enabled || !range.valid) return null;

        const visible = visibleItemTimeRange();
        if (!visible) return null;

        // The whole visible viewport must be outside the selected range.
        // This keeps the complete boundary day and avoids skipping media near
        // the top or bottom edge of a virtualized timeline.
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

    function isScrollable(element) {
        if (!(element instanceof HTMLElement)) return false;
        if (element.scrollHeight <= element.clientHeight + 80) return false;

        const style = getComputedStyle(element);
        return ['auto', 'scroll', 'overlay'].includes(style.overflowY);
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
                return 'Stay at scan end';
            case 'start':
                return 'Return to starting position';
            default:
                return 'Jump to timeline end after scan / ZIP';
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
            setPhase('RETURNING TO START POSITION');
            addLog(
                'Returning to the position where the scan started.'
            );

            const exact = await restoreStartingAnchor(
                scroller,
                startingAnchor
            );

            addLog(
                exact
                    ? 'Starting position restored.'
                    : `Starting position restored approximately because ${activeSiteAdapter.label} unloaded the original ${adapterTerm('item', 'item')}.`,
                exact ? 'success' : 'warn'
            );
            return;
        }

        setPhase('RETURNING TO TIMELINE END');
        addLog(
            'Returning to the timeline end and waiting for ${activeSiteAdapter.label} virtual timeline to settle.'
        );

        const reachedBottom =
            await forceScrollToNewest(scroller);

        addLog(
            reachedBottom
                ? 'Final position is now at the timeline end.'
                : `${activeSiteAdapter.label} moved the virtual timeline again; the strongest end-position correction was applied.`,
            reachedBottom ? 'success' : 'warn'
        );
    }

    async function moveToNewest(scroller) {
        setPhase('SCAN: moving to timeline end');
        addLog('Moving to the timeline end first.');
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

    async function confirmRealTimelineStart(scroller) {
        const startedAt = performance.now();
        const baseline = {
            oldestId: oldestVisibleItemId(),
            mediaCount: mediaEntries.size,
            height: scrollPosition(scroller).height
        };

        addLog(
            'Possible timeline start reached. Waiting 20 seconds for delayed older items.'
        );

        while (!stopRequested) {
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
                    `${activeSiteAdapter.label} loaded more content; scanning continues (${mediaEntries.size} media files found).`,
                    'success'
                );
                return false;
            }

            const elapsed = performance.now() - startedAt;
            const remaining = Math.max(0, REAL_TOP_CONFIRM_MS - elapsed);
            setPhase(
                `SCAN: confirming real timeline start · ${Math.ceil(remaining / 1000)} s left`
            );

            if (remaining <= 0) {
                scanVisiblePage();
                return true;
            }
        }

        return false;
    }

    async function autoScrollToOldest(scroller) {
        setPhase('SCAN: newest → oldest');
        addLog('Fast scan started. A 20-second confirmation runs at the possible timeline start.');

        let iterations = 0;

        while (!stopRequested && iterations < 20_000) {
            iterations++;
            scanVisiblePage();

            const before = scrollPosition(scroller);
            const step = Math.max(Math.floor(before.client * 0.78), 520);

            scroller.scrollTop = Math.max(0, before.top - step);
            await sleep(SCAN_DELAY_MS);
            scanVisiblePage();

            // A second short scan catches media inserted shortly after the item
            // without slowing the whole run too much.
            await sleep(120);
            scanVisiblePage();

            const after = scrollPosition(scroller);
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
                addLog(`Scan running: ${mediaEntries.size} media files found.`);
            }

            if (after.top <= 5) {
                const reallyAtTop = await confirmRealTimelineStart(scroller);

                if (reallyAtTop) {
                    lastScanBoundaryReason = 'timeline-start';
                    addLog(
                        'No older items appeared for 20 seconds. Timeline start confirmed.',
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
        const baseline = {
            newestId: newestVisibleItemId(),
            mediaCount: mediaEntries.size,
            height: scrollPosition(scroller).height
        };

        addLog(
            'Possible timeline-end boundary reached. Waiting 20 seconds for delayed newer items.'
        );

        while (!stopRequested) {
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
                    `${activeSiteAdapter.label} loaded newer content; downward scanning continues (${mediaEntries.size} media files found).`,
                    'success'
                );
                return false;
            }

            const elapsed = performance.now() - startedAt;
            const remaining = Math.max(
                0,
                REAL_BOTTOM_CONFIRM_MS - elapsed
            );

            setPhase(
                `SCAN: confirming timeline-end boundary · ${Math.ceil(remaining / 1000)} s left`
            );

            if (remaining <= 0) {
                scanVisiblePage();
                return true;
            }
        }

        return false;
    }

    async function autoScrollToNewest(scroller) {
        setPhase('SCAN: current → newest');
        addLog(
            'Downward scan started. A 20-second confirmation runs at the possible timeline-end boundary.'
        );

        let iterations = 0;

        while (!stopRequested && iterations < 20_000) {
            iterations++;
            scanVisiblePage();

            const before = scrollPosition(scroller);
            const step = Math.max(
                Math.floor(before.client * 0.78),
                520
            );

            scroller.scrollTop = Math.min(
                scroller.scrollHeight,
                before.top + step
            );

            await sleep(SCAN_DELAY_MS);
            scanVisiblePage();

            await sleep(120);
            scanVisiblePage();

            const after = scrollPosition(scroller);
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
                    `Downward scan running: ${mediaEntries.size} media files found.`
                );
            }

            if (nearBottom) {
                const reallyAtBottom =
                    await confirmRealTimelineEnd(scroller);

                if (reallyAtBottom) {
                    lastScanBoundaryReason = 'timeline-end';
                    addLog(
                        'No newer items appeared for 20 seconds. Timeline end confirmed.',
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
                return 'Current position → start';
            case 'current-to-newest':
                return 'Current position → end';
            case 'full-finish-down':
                return 'Full timeline: current → start → end';
            default:
                return 'End → start (jump to end first)';
        }
    }

    function abortActiveRequests() {
        for (const request of activeRequests) {
            try {
                request.abort();
            } catch {
                // Ignore already-finished requests.
            }
        }
        activeRequests.clear();
    }

    function requestArrayBuffer(url, attempt = 1) {
        return new Promise((resolve, reject) => {
            if (!activeSiteAdapter.isDownloadUrlAllowed(url)) {
                reject(new Error('The active site adapter blocked this download URL.'));
                return;
            }

            if (stopRequested) {
                reject(new Error('Stopped by user'));
                return;
            }

            let requestHandle;

            requestHandle = GM_xmlhttpRequest({
                method: 'GET',
                url,
                responseType: 'arraybuffer',
                timeout: 120000,
                anonymous: true,
                headers: {
                    'Accept': 'video/*,image/*,*/*;q=0.8'
                },
                onload: async response => {
                    activeRequests.delete(requestHandle);

                    if (
                        response.status >= 200 &&
                        response.status < 300 &&
                        response.response
                    ) {
                        resolve(response.response);
                        return;
                    }

                    const retryable =
                        response.status === 429 ||
                        response.status >= 500 ||
                        response.status === 0;

                    if (
                        retryable &&
                        attempt < REQUEST_RETRIES &&
                        !stopRequested
                    ) {
                        await sleep(700 * attempt);
                        try {
                            resolve(await requestArrayBuffer(url, attempt + 1));
                        } catch (error) {
                            reject(error);
                        }
                        return;
                    }

                    reject(new Error(`HTTP ${response.status || 'unknown'}`));
                },
                onerror: async () => {
                    activeRequests.delete(requestHandle);

                    if (attempt < REQUEST_RETRIES && !stopRequested) {
                        await sleep(700 * attempt);
                        try {
                            resolve(await requestArrayBuffer(url, attempt + 1));
                        } catch (error) {
                            reject(error);
                        }
                        return;
                    }

                    reject(new Error('Network error'));
                },
                ontimeout: async () => {
                    activeRequests.delete(requestHandle);

                    if (attempt < REQUEST_RETRIES && !stopRequested) {
                        try {
                            resolve(await requestArrayBuffer(url, attempt + 1));
                        } catch (error) {
                            reject(error);
                        }
                        return;
                    }

                    reject(new Error('Request timed out'));
                }
            });

            activeRequests.add(requestHandle);
        });
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

        // On Firefox/Tampermonkey, an @require UMD global can exist in the
        // userscript scope without appearing as globalThis.fflate.
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

    // Built-in ZIP32 STORE writer. This is used only when the optional
    // external fflate library is unavailable. Media files are already
    // compressed, so storing them without DEFLATE is appropriate and avoids
    // depending on a CDN.
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

            // Keep Firefox responsive while checksumming large videos.
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

        return {
            blob: await buildFallbackStoredZip(
                files,
                onProgress
            ),
            backend: 'built-in'
        };
    }

    function downloadZipBlob(blob, filename) {
        const blobUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = blobUrl;
        anchor.download = filename;
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();

        // Allow enough time for a possible browser permission prompt.
        setTimeout(() => URL.revokeObjectURL(blobUrl), 120_000);
    }

    async function createAndDownloadZipParts() {
        const selectedEntries = selectedMediaEntries();

        if (packing || selectedEntries.length === 0) {
            if (!packing && selectedEntries.length === 0) {
                setPhase('NOTHING SELECTED');
                addLog('Enable photos, videos, external GIF previews, or a combination before creating ZIP files.', 'warn');
            }
            return;
        }

        packing = true;
        running = true;
        scanning = false;
        stopRequested = false;
        resetEntryStatuses();
        updateButtons();

        const entries = selectedEntries;
        const digits = Math.max(6, String(entries.length).length);
        const archiveNames = new Map();
        const archiveContext = activeSiteAdapter.getArchiveContext();
        const stamp = new Date()
            .toISOString()
            .slice(0, 16)
            .replace('T', '_')
            .replace(':', '-');
        const archiveKind = selectedArchiveKind(entries);
        const selectedCounts = countMediaTypes(entries);
        const initialZipLibrary = resolveFflateLibrary();

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

        addLog(
            `${entries.length} selected files (${selectedCounts.photos} photos/native GIFs, ` +
            `${selectedCounts.videos} videos, ${selectedCounts.externalGifs} external GIF previews). ` +
            `Using ${DOWNLOAD_CONCURRENCY} parallel media downloads.`
        );

        while (groupStart < entries.length && !stopRequested) {
            const group = takeAdaptiveWorkGroup(entries, groupStart);
            if (!group.length) break;

            const records = new Array(group.length);
            let finishedInGroup = 0;
            let bytesInGroup = 0;

            setPhase(
                `DOWNLOADING ORIGINALS: ${groupStart + 1}–` +
                `${groupStart + group.length}/${entries.length}`
            );

            await runWorkerPool(
                group,
                DOWNLOAD_CONCURRENCY,
                async (entry, localIndex) => {
                    if (stopRequested) return;

                    entry.status = STATUS.FETCHING;
                    entry.error = '';
                    scheduleRender();

                    try {
                        const buffer = await requestArrayBuffer(entry.url);
                        if (stopRequested) return;

                        entry.size = buffer.byteLength;
                        bytesInGroup += buffer.byteLength;
                        records[localIndex] = {
                            entry,
                            globalIndex: groupStart + localIndex,
                            data: new Uint8Array(buffer)
                        };
                    } catch (error) {
                        if (stopRequested) return;

                        entry.status = STATUS.ERROR;
                        entry.error = error?.message || String(error);
                        errorCount++;
                        addLog(
                            `Failed: ${entry.filename} — ${entry.error}`,
                            'error'
                        );
                    }

                    finishedInGroup++;
                    setPhase(
                        `DOWNLOADING ORIGINALS: ${finishedInGroup}/${group.length} · ` +
                        `${formatBytes(bytesInGroup)}`
                    );
                    progressFill.style.width =
                        `${(finishedInGroup / group.length) * 100}%`;
                    scheduleRender();
                }
            );

            if (stopRequested) break;

            const successfulRecords = records.filter(Boolean);
            const sizeGroups = splitRecordsBySize(
                successfulRecords,
                ZIP_MAX_BYTES
            );

            for (const partRecords of sizeGroups) {
                if (stopRequested) break;

                zipPart++;
                const partLabel = String(zipPart).padStart(3, '0');
                const files = {};

                for (const record of partRecords) {
                    const archiveName = uniqueArchiveName(
                        record.globalIndex,
                        record.entry,
                        digits
                    );
                    archiveNames.set(record.entry.key, archiveName);
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
                progressFill.style.width = '0%';
                await sleep(20);

                let zipResult;
                try {
                    zipResult = await createZipBlob(
                        files,
                        progress => {
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
                        `ZIP part ${partLabel} failed: ${error.message}`,
                        'error'
                    );
                    errorCount += partRecords.length;

                    for (const record of partRecords) {
                        record.entry.status = STATUS.ERROR;
                        record.entry.error = `ZIP: ${error.message}`;
                    }
                    continue;
                }

                const blob = zipResult.blob;
                const usedZipBackend = zipResult.backend;
                const filename =
                    `${activeSiteAdapter.archivePrefix}_${archiveKind}_${archiveContext.id}_` +
                    `${dateRangeFilenameToken()}_${stamp}_part_${partLabel}.zip`;

                downloadZipBlob(blob, filename);

                for (const record of partRecords) {
                    record.entry.status = STATUS.PACKED;
                    zippedCount++;
                    record.data = null;
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

                // Give the browser time to accept consecutive ZIP downloads.
                await sleep(900);
            }

            groupStart += group.length;
        }

        abortActiveRequests();
        packing = false;
        running = false;

        if (stopRequested) {
            setPhase(`STOPPED: ${zippedCount} files already saved`);
            addLog(
                'The operation was stopped. Completed ZIP parts remain available.',
                'warn'
            );
        } else {
            setPhase('FINISHED');
            progressFill.style.width = '100%';
            addLog(
                `Finished: ${zippedCount} files in ${zipPart} ZIP parts, ` +
                `${errorCount} errors.`,
                errorCount ? 'warn' : 'success'
            );
        }

        updateButtons();
        updateCounters();
    }

    async function startAutomaticWorkflow() {
        if (running) return;

        resetCollection();
        stopRequested = false;
        running = true;
        scanning = true;
        packing = false;
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

        lastScanBoundaryReason = '';
        setPhase('STARTING');
        addLog(
            `Scan started on ${activeSiteAdapter.label}. Mode: ` +
            `${scanModeDescription(scanMode)}.`
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
            addLog(
                `${activeSiteAdapter.label} ${adapterTerm('timeline', 'timeline')} was not found. ${activeSiteAdapter.openTargetHelp || ''}`.trim(),
                'error'
            );
            updateButtons();
            return;
        }

        // Capture media and an item anchor at the selected starting position.
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
                'Full downward-finish mode: first scanning from the current position to the timeline start.'
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
                    'The first scan did not confirm the timeline-start boundary, so the downward full-channel pass was not started.',
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
            setPhase(`SCAN FINISHED: ${mediaEntries.size} media files`);
            addLog(
                `Scan completed at the ${completedBoundaryLabel}: ` +
                `${mediaEntries.size} unique media files found.`,
                'success'
            );
        } else {
            setPhase(`SCAN ENDED: ${mediaEntries.size} media files`);
            addLog(
                'The scan stopped at the safety iteration limit or could not confirm the selected boundary.',
                'warn'
            );
        }

        const statsAfterScan = selectionStatistics();
        addLog(
            `Selection summary: ${statsAfterScan.total} total found, ` +
            `${statsAfterScan.inDateRange} in the date range, ` +
            `${statsAfterScan.excludedByDate} excluded by date, ` +
            `${statsAfterScan.excludedByType} excluded by media type, ` +
            `${statsAfterScan.selected} selected for ZIP.`
        );

        const selectedAfterScan = selectedMediaEntries();
        const createdZip =
            selectedAfterScan.length > 0 &&
            autoZipCheckbox.checked;

        if (createdZip) {
            await createAndDownloadZipParts();
        }

        if (!stopRequested) {
            await applyFinalTimelinePosition(
                scroller,
                finalPositionSelect.value,
                startingAnchor
            );

            setPhase(
                createdZip
                    ? 'FINISHED'
                    : `SCAN FINISHED: ${mediaEntries.size} media files`
            );
        }
    }

    function finishStoppedScan() {
        scanning = false;
        running = false;
        setPhase(`STOPPED: ${mediaEntries.size} media files collected`);
        addLog(
            'Scrolling stopped. Use “CREATE ZIP NOW” to save the media found so far.',
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
    }

    function resetCollection() {
        if (running || packing || scanning) return;

        mediaEntries.clear();
        firstSeenCounter = 0;
        progressFill.style.width = '0%';
        mediaList.replaceChildren();
        updateCounters();
        setPhase('READY');
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

    function statusIcon(entry) {
        if (!isEntryIncluded(entry) && entry.status === STATUS.COLLECTED) {
            return ['–', entrySkipReason(entry), 'skipped'];
        }

        switch (entry.status) {
            case STATUS.FETCHING:
                return ['…', 'Downloading original', 'fetching'];
            case STATUS.PACKED:
                return ['✓', 'Saved in ZIP', 'packed'];
            case STATUS.ERROR:
                return ['!', entry.error || 'Error', 'error'];
            default:
                return ['○', 'Collected', 'collected'];
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
            if (!isEntryIncluded(entry)) row.classList.add('ma-skipped');

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
                thumbnail.title =
                    entry.mediaType === 'external-gif'
                        ? 'External GIF preview (usually MP4)'
                        : 'Video attachment';
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
                entry.itemId ? `ID ${entry.itemId}` : ''
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

    function addLog(message, type = 'info') {
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
    }

    function updateCounters() {
        let packedCount = 0;
        let errorCount = 0;

        for (const entry of mediaEntries.values()) {
            if (entry.status === STATUS.PACKED) packedCount++;
            if (entry.status === STATUS.ERROR) errorCount++;
        }

        const counts = countMediaTypes();
        const stats = selectionStatistics();

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
        updateButtons();
    }

    function updateButtons() {
        const selectedCount = selectedMediaEntries().length;
        const busy = running || packing || scanning;

        const dateRange = getDateRangeConfig();

        startButton.textContent = autoZipCheckbox.checked
            ? 'Scan & create ZIPs'
            : 'Scan media';

        startButton.disabled =
            busy ||
            (
                !photoCheckbox.checked &&
                !videoCheckbox.checked &&
                !externalGifCheckbox.checked
            ) ||
            !dateRange.valid;
        stopButton.disabled = !busy;
        zipButton.disabled =
            busy ||
            selectedCount === 0 ||
            !dateRange.valid;
        resetButton.disabled = busy;
        autoZipCheckbox.disabled = busy;
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
                <button type="button" data-ma-tab="setup" aria-selected="true">Setup</button>
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
                                <h2>What to save</h2>
                                <p>Choose the media categories included in the archive.</p>
                            </div>
                        </div>
                        <div class="ma-choice-grid">
                            <label class="ma-choice">
                                <input id="ma-include-photos" type="checkbox" checked>
                                <span><strong>Photos & native GIFs</strong><small>Image attachments</small></span>
                            </label>
                            <label class="ma-choice">
                                <input id="ma-include-videos" type="checkbox" checked>
                                <span><strong>Videos</strong><small>Video attachments</small></span>
                            </label>
                            <label class="ma-choice ma-choice-wide">
                                <input id="ma-include-external-gifs" type="checkbox" checked>
                                <span><strong>Rendered GIF previews</strong><small>Animated previews supplied by the active site</small></span>
                            </label>
                        </div>
                    </section>

                    <section class="ma-group">
                        <div class="ma-group-heading ma-heading-with-control">
                            <div>
                                <h2>Date range</h2>
                                <p>Filter by each item's source timestamp.</p>
                            </div>
                            <label class="ma-switch">
                                <input id="ma-date-filter" type="checkbox">
                                <span aria-hidden="true"></span>
                                <b>Use filter</b>
                            </label>
                        </div>

                        <div id="ma-date-fields" class="ma-field-grid ma-date-fields">
                            <label>
                                <span>From</span>
                                <input id="ma-from-date" type="date">
                            </label>
                            <label>
                                <span>Range end</span>
                                <select id="ma-date-end-mode">
                                    <option value="latest">Latest available</option>
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
                                <h2>Scan behavior</h2>
                                <p>Control where the scan starts, ends, and leaves the page.</p>
                            </div>
                        </div>
                        <div class="ma-field-grid">
                            <label class="ma-field-wide">
                                <span>Direction and starting point</span>
                                <select id="ma-scan-direction">
                                    <option value="newest-to-oldest">End → start (jump to end first)</option>
                                    <option value="current-to-oldest">Current position → start</option>
                                    <option value="current-to-newest">Current position → end</option>
                                    <option value="full-finish-down">Full timeline: current → start → end</option>
                                </select>
                            </label>
                            <label class="ma-field-wide">
                                <span>Position after completion</span>
                                <select id="ma-final-position">
                                    <option value="newest" selected>Jump to timeline end</option>
                                    <option value="scan-end">Stay at scan end</option>
                                    <option value="start">Return to starting position</option>
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
                        <div><span>Photos</span><strong id="ma-photo-count">0</strong></div>
                        <div><span>Videos</span><strong id="ma-video-count">0</strong></div>
                        <div><span>GIF previews</span><strong id="ma-external-gif-count">0</strong></div>
                        <div><span>In range</span><strong id="ma-in-range">0</strong></div>
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
            ? 'All scanned dates are included.'
            : range.valid
                ? `Inclusive range: ${range.label}`
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
            updateCounters();
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
})();
