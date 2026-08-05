// ==UserScript==
// @name         Discord Media Archiver - Photos and Videos
// @namespace    https://github.com/madebycli/Picture-Downloader
// @version      5.6.0
// @description  Archive Discord photos, GIFs, videos, and rendered external GIF previews into numbered ZIP parts.
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

    const VERSION = '5.6.0';
    const SCAN_DELAY_MS = 650;
    const REAL_TOP_CONFIRM_MS = 20_000;
    const REAL_BOTTOM_CONFIRM_MS = 20_000;
    const FINAL_NEWEST_SETTLE_MS = 7_000;
    const RESTORE_POSITION_MAX_STEPS = 700;
    const TOP_PROBE_INTERVAL_MS = 1000;
    const NEWEST_STABLE_ROUNDS_REQUIRED = 3;
    const DISCORD_EPOCH_MS = 1420070400000;
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
        // Common browser/Discord video containers
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
     * sourceKind: 'discord-attachment'|'external-gif-preview',
     * sourcePageUrl: string|null,
     * messageId: string|null,
     * timestamp: string|null,
     * firstSeen: number,
     * status: string,
     * error: string,
     * size: number
     * }>} */
    const images = new Map(); // Stores attachments and external GIF previews.

    const activeRequests = new Set();

    let firstSeenCounter = 0;
    let running = false;
    let scanning = false;
    let packing = false;
    let stopRequested = false;
    let renderTimer = null;
    let lastZipBlobUrl = null;
    let lastZipFilename = null;
    let lastScanBoundaryReason = '';

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

        return findMessageContainer(element);
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

    function toOriginalUrl(rawUrl) {
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

    function findMessageContainer(element) {
        return element.closest?.(
            'li[id*="chat-messages"], div[id*="chat-messages"], ' +
            '[data-list-item-id*="chat-messages"], article'
        ) || null;
    }

    function findMessageId(element) {
        let current = findMessageContainer(element) || element;

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

    function timestampFromSnowflake(messageId) {
        if (!messageId) return null;

        try {
            const milliseconds =
                Number((BigInt(messageId) >> 22n) + BigInt(DISCORD_EPOCH_MS));

            if (!Number.isFinite(milliseconds)) return null;
            return new Date(milliseconds).toISOString();
        } catch {
            return null;
        }
    }

    function findTimestamp(element) {
        const container = findMessageContainer(element);
        const messageId = findMessageId(element);

        if (messageId) {
            const exactTime = document.getElementById(
                `message-timestamp-${messageId}`
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
            timestampFromSnowflake(messageId)
        );
    }

    function addOrUpdateImage(rawUrl, sourceElement) {
        if (!isDiscordAttachmentUrl(rawUrl, sourceElement)) return false;

        const originalUrl = toOriginalUrl(rawUrl);
        const key = canonicalKey(originalUrl);
        const existing = images.get(key);

        if (existing) {
            if (urlQualityScore(originalUrl) > urlQualityScore(existing.url)) {
                existing.url = originalUrl;
            }

            // A freshly loaded URL usually has the newest signature.
            if (new URL(originalUrl).searchParams.has('ex')) {
                existing.url = originalUrl;
            }

            if (!existing.messageId) existing.messageId = findMessageId(sourceElement);
            if (!existing.timestamp) existing.timestamp = findTimestamp(sourceElement);
            return false;
        }

        images.set(key, {
            key,
            url: originalUrl,
            previewUrl: rawUrl,
            filename: filenameFromUrl(originalUrl),
            mediaType: mediaTypeFromUrl(originalUrl, sourceElement),
            sourceKind: 'discord-attachment',
            sourcePageUrl: null,
            messageId: findMessageId(sourceElement),
            timestamp: findTimestamp(sourceElement),
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
        const existing = images.get(key);

        if (existing) {
            existing.url = mediaUrl;
            existing.previewUrl = mediaUrl;

            if (!existing.sourcePageUrl && sourcePageUrl) {
                existing.sourcePageUrl = sourcePageUrl;
            }

            if (!existing.messageId) {
                existing.messageId = findMessageId(sourceElement);
            }

            if (!existing.timestamp) {
                existing.timestamp = findTimestamp(sourceElement);
            }

            return false;
        }

        let filename = filenameFromUrl(mediaUrl);

        if (!MEDIA_EXTENSIONS.has(extensionFromPath(`/${filename}`))) {
            filename = 'external-gif-preview.mp4';
        }

        images.set(key, {
            key,
            url: mediaUrl,
            previewUrl: mediaUrl,
            filename,
            mediaType: 'external-gif',
            sourceKind: 'external-gif-preview',
            sourcePageUrl:
                sourcePageUrl ||
                findExternalGifPageUrl(sourceElement),
            messageId: findMessageId(sourceElement),
            timestamp: findTimestamp(sourceElement),
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

    function scanVisiblePage() {
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
                if (addOrUpdateImage(candidate, element)) {
                    added++;
                    break;
                }
            }
        });

        added += scanExternalGifPreviews();

        updateCounters();
        return added;
    }

    function compareImagesNewestFirst(a, b) {
        if (a.messageId && b.messageId) {
            try {
                const left = BigInt(a.messageId);
                const right = BigInt(b.messageId);
                if (left > right) return -1;
                if (left < right) return 1;
            } catch {
                // Fall back to timestamp/detection order.
            }
        }

        if (a.timestamp && b.timestamp) {
            const timeDifference =
                new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
            if (timeDifference) return timeDifference;
        }

        if (a.messageId && !b.messageId) return -1;
        if (!a.messageId && b.messageId) return 1;
        return a.firstSeen - b.firstSeen;
    }

    function sortedImages() {
        return [...images.values()].sort(compareImagesNewestFirst);
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

        const fallback = timestampFromSnowflake(entry.messageId);
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
                : 'Skipped because its message date is unknown';
        }

        return '';
    }

    function selectedMediaEntries() {
        return sortedImages().filter(isEntryIncluded);
    }

    function selectionStatistics() {
        let inDateRange = 0;
        let excludedByDate = 0;
        let excludedByType = 0;
        let selected = 0;

        for (const entry of images.values()) {
            const insideDate = isEntryInsideDateRange(entry);
            const typeEnabled = mediaTypeIsEnabled(entry);

            if (insideDate) inDateRange++;
            else excludedByDate++;

            if (insideDate && !typeEnabled) excludedByType++;
            if (insideDate && typeEnabled) selected++;
        }

        return {
            total: images.size,
            inDateRange,
            excludedByDate,
            excludedByType,
            selected
        };
    }

    function visibleMessageTimeRange() {
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
            for (const messageId of visibleMessageIds()) {
                const timestamp = timestampFromSnowflake(messageId);
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

    function selectedDateBoundaryReached(direction) {
        const range = getDateRangeConfig();
        if (!range.enabled || !range.valid) return null;

        const visible = visibleMessageTimeRange();
        if (!visible) return null;

        // The whole visible viewport must be outside the selected range.
        // This keeps the complete boundary day and avoids skipping media near
        // the top or bottom edge of Discord's virtualized message list.
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
            case 'chat-top':
                return 'oldest-message boundary';
            case 'chat-bottom':
                return 'newest-message boundary';
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

    function countMediaTypes(entries = [...images.values()]) {
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

    function findChatScroller() {
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

    function scrollPosition(scroller) {
        return {
            top: Math.round(scroller.scrollTop),
            height: Math.round(scroller.scrollHeight),
            client: Math.round(scroller.clientHeight)
        };
    }

    function findMessageElementById(messageId) {
        if (!messageId) return null;

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
                    String(value).includes(messageId)
                )
            ) {
                return element;
            }
        }

        return null;
    }

    function captureStartingAnchor(scroller) {
        const scrollerRect = scroller.getBoundingClientRect();
        let best = null;

        const elements = document.querySelectorAll(
            '[id*="chat-messages"], [data-list-item-id*="chat-messages"]'
        );

        for (const element of elements) {
            const messageId = findMessageId(element);
            if (!messageId) continue;

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
                    messageId,
                    offset: rect.top - scrollerRect.top,
                    distance
                };
            }
        }

        const position = scrollPosition(scroller);

        return {
            messageId: best?.messageId || null,
            offset: best?.offset || 0,
            scrollRatio:
                position.height > position.client
                    ? position.top /
                      (position.height - position.client)
                    : 0
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

        // Discord's virtual list can move the viewport after the first
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
                findMessageElementById(anchor.messageId);

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

            if (!anchor.messageId) break;

            const ids = visibleMessageIds();
            let oldest = null;
            let newest = null;

            for (const id of ids) {
                try {
                    if (
                        oldest === null ||
                        BigInt(id) < BigInt(oldest)
                    ) {
                        oldest = id;
                    }

                    if (
                        newest === null ||
                        BigInt(id) > BigInt(newest)
                    ) {
                        newest = id;
                    }
                } catch {
                    // Ignore invalid IDs.
                }
            }

            let direction = 0;

            try {
                if (
                    oldest &&
                    BigInt(anchor.messageId) < BigInt(oldest)
                ) {
                    direction = -1;
                } else if (
                    newest &&
                    BigInt(anchor.messageId) > BigInt(newest)
                ) {
                    direction = 1;
                }
            } catch {
                direction = 0;
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

        // Best-effort fallback if the original message could not be found.
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
                return 'Jump to newest after scan / ZIP';
        }
    }

    async function applyFinalChatPosition(
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
                    : 'Starting position restored approximately because Discord had unloaded the original message.',
                exact ? 'success' : 'warn'
            );
            return;
        }

        setPhase('RETURNING TO NEWEST MESSAGE');
        addLog(
            'Returning to the newest message and waiting for Discord’s virtual list to settle.'
        );

        const reachedBottom =
            await forceScrollToNewest(scroller);

        addLog(
            reachedBottom
                ? 'Final chat position is now at the newest message.'
                : 'Discord moved the virtual list again; the script applied its strongest bottom-position correction.',
            reachedBottom ? 'success' : 'warn'
        );
    }

    async function moveToNewest(scroller) {
        setPhase('SCAN: moving to newest message');
        addLog('Moving to the newest loaded message first.');
        await forceScrollToNewest(scroller, 5_000);
    }

    function visibleMessageIds() {
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

    function oldestVisibleMessageId() {
        let oldest = null;

        for (const id of visibleMessageIds()) {
            try {
                if (oldest === null || BigInt(id) < BigInt(oldest)) {
                    oldest = id;
                }
            } catch {
                // Ignore invalid IDs.
            }
        }

        return oldest;
    }

    function isOlderSnowflake(candidate, baseline) {
        if (!candidate || !baseline) return false;

        try {
            return BigInt(candidate) < BigInt(baseline);
        } catch {
            return false;
        }
    }

    async function confirmRealChatTop(scroller) {
        const startedAt = performance.now();
        const baseline = {
            oldestId: oldestVisibleMessageId(),
            mediaCount: images.size,
            height: scrollPosition(scroller).height
        };

        addLog(
            'Possible chat beginning reached. Waiting 20 seconds for delayed older messages.'
        );

        while (!stopRequested) {
            scroller.scrollTop = 0;
            scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
            await sleep(TOP_PROBE_INTERVAL_MS);
            scanVisiblePage();

            const current = scrollPosition(scroller);
            const currentOldestId = oldestVisibleMessageId();
            const olderMessageLoaded = isOlderSnowflake(
                currentOldestId,
                baseline.oldestId
            );
            const changed =
                olderMessageLoaded ||
                images.size > baseline.mediaCount ||
                Math.abs(current.height - baseline.height) >= 3 ||
                current.top > 8;

            if (changed) {
                addLog(
                    `Discord loaded more content; scanning continues (${images.size} media files found).`,
                    'success'
                );
                return false;
            }

            const elapsed = performance.now() - startedAt;
            const remaining = Math.max(0, REAL_TOP_CONFIRM_MS - elapsed);
            setPhase(
                `SCAN: confirming real chat beginning · ${Math.ceil(remaining / 1000)} s left`
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
        addLog('Fast scan started. A 20-second confirmation runs at the possible chat beginning.');

        let iterations = 0;

        while (!stopRequested && iterations < 20_000) {
            iterations++;
            scanVisiblePage();

            const before = scrollPosition(scroller);
            const step = Math.max(Math.floor(before.client * 0.78), 520);

            scroller.scrollTop = Math.max(0, before.top - step);
            await sleep(SCAN_DELAY_MS);
            scanVisiblePage();

            // A second short scan catches attachments inserted shortly after the message
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
                addLog(`Scan running: ${images.size} media files found.`);
            }

            if (after.top <= 5) {
                const reallyAtTop = await confirmRealChatTop(scroller);

                if (reallyAtTop) {
                    lastScanBoundaryReason = 'chat-top';
                    addLog(
                        'No older messages appeared for 20 seconds. Chat beginning confirmed.',
                        'success'
                    );
                    return true;
                }
            }
        }

        return false;
    }

    function newestVisibleMessageId() {
        let newest = null;

        for (const id of visibleMessageIds()) {
            try {
                if (newest === null || BigInt(id) > BigInt(newest)) {
                    newest = id;
                }
            } catch {
                // Ignore invalid IDs.
            }
        }

        return newest;
    }

    function isNewerSnowflake(candidate, baseline) {
        if (!candidate || !baseline) return false;

        try {
            return BigInt(candidate) > BigInt(baseline);
        } catch {
            return false;
        }
    }

    async function confirmRealChatBottom(scroller) {
        const startedAt = performance.now();
        const baseline = {
            newestId: newestVisibleMessageId(),
            mediaCount: images.size,
            height: scrollPosition(scroller).height
        };

        addLog(
            'Possible newest-message boundary reached. Waiting 20 seconds for delayed newer messages.'
        );

        while (!stopRequested) {
            scroller.scrollTop = scroller.scrollHeight;
            scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
            await sleep(TOP_PROBE_INTERVAL_MS);
            scanVisiblePage();

            const current = scrollPosition(scroller);
            const currentNewestId = newestVisibleMessageId();
            const newerMessageLoaded = isNewerSnowflake(
                currentNewestId,
                baseline.newestId
            );
            const distanceFromBottom =
                current.height - (current.top + current.client);

            const changed =
                newerMessageLoaded ||
                images.size > baseline.mediaCount ||
                Math.abs(current.height - baseline.height) >= 3 ||
                distanceFromBottom > 8;

            if (changed) {
                addLog(
                    `Discord loaded newer content; downward scanning continues (${images.size} media files found).`,
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
        setPhase('SCAN: current → newest');
        addLog(
            'Downward scan started. A 20-second confirmation runs at the possible newest-message boundary.'
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
                    `Downward scan running: ${images.size} media files found.`
                );
            }

            if (nearBottom) {
                const reallyAtBottom =
                    await confirmRealChatBottom(scroller);

                if (reallyAtBottom) {
                    lastScanBoundaryReason = 'chat-bottom';
                    addLog(
                        'No newer messages appeared for 20 seconds. Newest-message boundary confirmed.',
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
                return 'Current position → oldest';
            case 'current-to-newest':
                return 'Current position → newest';
            case 'full-finish-down':
                return 'Full channel: current → oldest → newest';
            default:
                return 'Newest → oldest (jump to newest first)';
        }
    }

    function abortActiveRequests() {
        for (const request of activeRequests) {
            try {
                request.abort();
            } catch {
                // Ignorieren.
            }
        }
        activeRequests.clear();
    }

    function requestArrayBuffer(url, attempt = 1) {
        return new Promise((resolve, reject) => {
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
                'message_id',
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
                entry.messageId || '',
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
            'message_id',
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
                entry.messageId || '',
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
        const channelId =
            location.pathname.match(/\/channels\/(?:@me|\d+)\/(\d+)/)?.[1] ||
            'channel';
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
                    `discord_${archiveKind}_${channelId}_` +
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
            `Version ${VERSION}: automatic photo/GIF/video scan started. ` +
            `Mode: ${scanModeDescription(scanMode)}.`
        );

        if (dateRange.enabled) {
            addLog(
                `Date range: ${dateRange.label}. Calendar days use your browser's local time zone.`
            );
        }

        await sleep(300);

        const scroller = findChatScroller();
        if (!scroller) {
            running = false;
            scanning = false;
            setPhase('ERROR');
            addLog(
                'Discord chat area was not found. Open a text channel or thread first.',
                'error'
            );
            updateButtons();
            return;
        }

        // Capture media and a message anchor at the selected starting position.
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
                'Full downward-finish mode: first scanning from the current position to the oldest message.'
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
                completedBoundaryLabel = 'oldest-message boundary';
                addLog(
                    'The first scan did not confirm the oldest-message boundary, so the downward full-channel pass was not started.',
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
            setPhase(`SCAN FINISHED: ${images.size} media files`);
            addLog(
                `Scan completed at the ${completedBoundaryLabel}: ` +
                `${images.size} unique media files found.`,
                'success'
            );
        } else {
            setPhase(`SCAN ENDED: ${images.size} media files`);
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
            await applyFinalChatPosition(
                scroller,
                finalPositionSelect.value,
                startingAnchor
            );

            setPhase(
                createdZip
                    ? 'FINISHED'
                    : `SCAN FINISHED: ${images.size} media files`
            );
        }
    }

    function finishStoppedScan() {
        scanning = false;
        running = false;
        setPhase(`STOPPED: ${images.size} media files collected`);
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
        for (const entry of images.values()) {
            entry.status = STATUS.COLLECTED;
            entry.error = '';
            entry.size = 0;
        }
        scheduleRender();
    }

    function resetCollection() {
        if (running || packing || scanning) return;

        images.clear();
        firstSeenCounter = 0;
        progressFill.style.width = '0%';
        imageList.replaceChildren();
        releaseLastZipUrl();
        updateCounters();
        updateDownloadAgainButton();
        setPhase('READY');
    }

    function releaseLastZipUrl() {
        if (lastZipBlobUrl) {
            URL.revokeObjectURL(lastZipBlobUrl);
        }
        lastZipBlobUrl = null;
        lastZipFilename = null;
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
        renderTimer = setTimeout(renderImageList, 120);
    }

    function renderImageList() {
        const entries = sortedImages();
        const fragment = document.createDocumentFragment();

        entries.forEach((entry, index) => {
            const row = document.createElement('div');
            row.className = `daz-row daz-${entry.status}`;
            if (!isEntryIncluded(entry)) row.classList.add('daz-skipped');

            let thumbnail;

            if (
                entry.mediaType === 'video' ||
                entry.mediaType === 'external-gif'
            ) {
                thumbnail = document.createElement('div');
                thumbnail.className = 'daz-thumb daz-video-thumb';
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
                thumbnail.className = 'daz-thumb';
                thumbnail.loading = 'lazy';
                thumbnail.referrerPolicy = 'no-referrer';
                thumbnail.src = entry.previewUrl;
                thumbnail.alt = '';
            }

            const details = document.createElement('div');
            details.className = 'daz-details';

            const name = document.createElement('div');
            name.className = 'daz-name';
            name.textContent =
                `${String(index + 1).padStart(4, '0')} · ${entry.filename}`;
            name.title = entry.filename;

            const meta = document.createElement('div');
            meta.className = 'daz-meta';
            meta.textContent = [
                entry.mediaType === 'external-gif'
                    ? 'EXTERNAL GIF PREVIEW'
                    : entry.mediaType.toUpperCase(),
                entry.timestamp
                    ? new Date(entry.timestamp).toLocaleString('en-GB')
                    : 'Time unknown',
                entry.size ? formatBytes(entry.size) : '',
                entry.messageId ? `ID ${entry.messageId}` : ''
            ].filter(Boolean).join(' · ');

            details.append(name, meta);

            const [symbol, title, className] = statusIcon(entry);
            const status = document.createElement('div');
            status.className = `daz-check daz-check-${className}`;
            status.textContent = symbol;
            status.title = title;

            row.append(thumbnail, details, status);
            fragment.appendChild(row);
        });

        imageList.replaceChildren(fragment);
        updateCounters();
    }

    function addLog(message, type = 'info') {
        const line = document.createElement('div');
        line.className = `daz-log-line daz-log-${type}`;

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

        for (const entry of images.values()) {
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
        packedElement.textContent = String(packedCount);
        errorElement.textContent = String(errorCount);
        updateButtons();
    }

    function updateButtons() {
        const selectedCount = selectedMediaEntries().length;
        const busy = running || packing || scanning;

        const dateRange = getDateRangeConfig();

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
        updateDownloadAgainButton();
    }

    function updateDownloadAgainButton() {
        downloadAgainButton.hidden = !lastZipBlobUrl;
        downloadAgainButton.disabled = !lastZipBlobUrl;
    }

    // ---------- Interface ----------

    const panel = document.createElement('aside');
    panel.id = 'discord-auto-zip-panel';
    panel.innerHTML = `
        <header class="daz-header">
            <div>
                <div class="daz-title">Discord Media Archiver</div>
                <div class="daz-version">Attachments · Firefox-safe ZIP fallback · v${VERSION}</div>
            </div>
            <button id="daz-collapse" class="daz-icon-button" title="Collapse or expand">−</button>
        </header>

        <div id="daz-body">
            <section class="daz-status-card">
                <div id="daz-phase">READY</div>
                <div class="daz-progress">
                    <div id="daz-progress-fill"></div>
                </div>
                <div class="daz-counters">
                    <span>Total found <strong id="daz-found">0</strong></span>
                    <span>Photos <strong id="daz-photo-count">0</strong></span>
                    <span>Videos <strong id="daz-video-count">0</strong></span>
                    <span>Embed GIFs <strong id="daz-external-gif-count">0</strong></span>
                    <span>In date range <strong id="daz-in-range">0</strong></span>
                    <span>Excluded by date <strong id="daz-excluded-date">0</strong></span>
                    <span>Selected for ZIP <strong id="daz-selected-count">0</strong></span>
                    <span>✓ ZIP saved <strong id="daz-packed">0</strong></span>
                    <span>Errors <strong id="daz-errors">0</strong></span>
                </div>
            </section>

            <div class="daz-media-options">
                <label class="daz-option">
                    <input id="daz-include-photos" type="checkbox" checked>
                    Include photos / GIFs
                </label>
                <label class="daz-option">
                    <input id="daz-include-videos" type="checkbox" checked>
                    Include videos
                </label>
                <label class="daz-option daz-wide-option">
                    <input id="daz-include-external-gifs" type="checkbox" checked>
                    Include external GIF previews
                </label>
            </div>

            <label class="daz-direction-option">
                <span>Scan direction / starting point</span>
                <select id="daz-scan-direction">
                    <option value="newest-to-oldest">
                        Newest → oldest (jump to newest first)
                    </option>
                    <option value="current-to-oldest">
                        Current position → oldest (scroll up)
                    </option>
                    <option value="current-to-newest">
                        Current position → newest (scroll down)
                    </option>
                    <option value="full-finish-down">
                        Full channel: current → oldest → newest
                    </option>
                </select>
            </label>

            <label class="daz-direction-option">
                <span>Final chat position after scan / ZIP</span>
                <select id="daz-final-position">
                    <option value="newest" selected>
                        Jump to newest after scan / ZIP
                    </option>
                    <option value="scan-end">
                        Stay at scan end
                    </option>
                    <option value="start">
                        Return to starting position
                    </option>
                </select>
            </label>

            <section class="daz-date-card">
                <label class="daz-option daz-date-enable">
                    <input id="daz-date-filter" type="checkbox">
                    Limit media by message date
                </label>

                <div id="daz-date-fields" class="daz-date-fields">
                    <label>
                        <span>From date</span>
                        <input id="daz-from-date" type="date">
                    </label>

                    <label>
                        <span>End of range</span>
                        <select id="daz-date-end-mode">
                            <option value="latest">Latest available</option>
                            <option value="specific">Specific date</option>
                        </select>
                    </label>

                    <label id="daz-to-date-wrap">
                        <span>To date (inclusive)</span>
                        <input id="daz-to-date" type="date">
                    </label>
                </div>

                <div id="daz-date-summary" class="daz-date-summary">
                    Date filter disabled
                </div>
            </section>

            <label class="daz-option daz-auto-option">
                <input id="daz-auto-zip" type="checkbox" checked>
                Automatically create ZIP parts after the scan
            </label>

            <div class="daz-actions">
                <button id="daz-start" class="daz-primary">START: SCAN + ZIP</button>
                <button id="daz-stop" class="daz-danger" disabled>STOP</button>
                <button id="daz-zip" class="daz-success" disabled>CREATE ZIP NOW</button>
                <button id="daz-reset" class="daz-secondary">RESET</button>
            </div>

            <div class="daz-section-title">
                Media <span class="daz-legend">○ collected · … downloading · ✓ saved</span>
            </div>
            <div id="daz-image-list" class="daz-image-list"></div>

            <div class="daz-section-title">Live log</div>
            <div id="daz-log" class="daz-log"></div>

            <div class="daz-note">
                Total found and the media-type counters include everything detected
                while scrolling. In date range and Selected for ZIP show what passes
                the active filters. Native Discord GIF files use the Photos / GIFs
                switch. External GIF-page links are detected from Discord's rendered
                preview and use
                the External GIF previews switch. These previews are commonly MP4
                files even though Discord labels them as GIFs. Disabled media types
                are skipped. The date filter reads each Discord message's exact
                timestamp and includes complete local calendar days. For a range such
                as 5 September through today, choose the From date and leave End of
                range on Latest available. “Full channel: current → oldest → newest”
                is the safest date-range mode when you start in the middle.
                If the external fast ZIP library is blocked, the script automatically
                uses a built-in ZIP writer instead of stopping.
            </div>
        </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
        #discord-auto-zip-panel {
            --daz-bg: #111214;
            --daz-card: #1e1f22;
            --daz-border: rgba(255,255,255,.12);
            --daz-text: #f2f3f5;
            --daz-muted: #949ba4;
            position: fixed;
            right: 18px;
            bottom: 18px;
            z-index: 2147483647;
            width: min(430px, calc(100vw - 36px));
            max-height: min(780px, calc(100vh - 36px));
            overflow: hidden;
            border: 1px solid var(--daz-border);
            border-radius: 14px;
            background: var(--daz-bg);
            color: var(--daz-text);
            box-shadow: 0 14px 50px rgba(0,0,0,.55);
            font: 13px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        #discord-auto-zip-panel * {
            box-sizing: border-box;
        }

        .daz-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            padding: 12px 14px;
            border-bottom: 1px solid var(--daz-border);
            background: #0c0d0e;
        }

        .daz-title {
            font-size: 16px;
            font-weight: 800;
        }

        .daz-version,
        .daz-note,
        .daz-legend {
            color: var(--daz-muted);
            font-size: 11px;
        }

        #daz-body {
            max-height: calc(min(780px, 100vh - 36px) - 59px);
            overflow-y: auto;
            padding: 12px;
        }

        .daz-status-card {
            padding: 10px;
            border: 1px solid var(--daz-border);
            border-radius: 9px;
            background: var(--daz-card);
        }

        #daz-phase {
            min-height: 19px;
            margin-bottom: 7px;
            font-weight: 750;
            overflow-wrap: anywhere;
        }

        .daz-progress {
            height: 7px;
            overflow: hidden;
            border-radius: 99px;
            background: #2b2d31;
        }

        #daz-progress-fill {
            width: 0;
            height: 100%;
            border-radius: inherit;
            background: #5865f2;
            transition: width .18s ease;
        }

        .daz-counters {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            margin-top: 8px;
            color: #b5bac1;
            font-size: 12px;
        }

        .daz-option {
            display: flex;
            align-items: center;
            gap: 7px;
            margin: 0;
            cursor: pointer;
            color: #dbdee1;
        }

        .daz-media-options {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 7px;
            margin: 10px 0 8px;
        }

        .daz-media-options .daz-option {
            padding: 9px;
            border: 1px solid var(--daz-border);
            border-radius: 7px;
            background: var(--daz-card);
        }

        .daz-media-options .daz-wide-option {
            grid-column: 1 / -1;
        }

        .daz-direction-option {
            display: block;
            margin: 9px 0;
            color: #dbdee1;
            font-size: 11px;
        }

        .daz-direction-option span {
            display: block;
            margin-bottom: 4px;
            font-weight: 700;
        }

        .daz-direction-option select {
            width: 100%;
            border: 1px solid var(--daz-border);
            border-radius: 6px;
            padding: 8px;
            background: var(--daz-card);
            color: var(--daz-text);
            font: inherit;
        }

        .daz-date-card {
            margin: 9px 0;
            padding: 9px;
            border: 1px solid var(--daz-border);
            border-radius: 8px;
            background: var(--daz-card);
        }

        .daz-date-enable {
            font-weight: 700;
        }

        .daz-date-fields {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 7px;
            margin-top: 9px;
        }

        .daz-date-fields label {
            min-width: 0;
            color: #b5bac1;
            font-size: 11px;
        }

        .daz-date-fields label span {
            display: block;
            margin-bottom: 4px;
        }

        .daz-date-fields input,
        .daz-date-fields select {
            width: 100%;
            border: 1px solid var(--daz-border);
            border-radius: 6px;
            padding: 7px;
            background: #111214;
            color: var(--daz-text);
            color-scheme: dark;
            font: inherit;
        }

        .daz-date-fields.daz-disabled {
            opacity: .45;
        }

        .daz-date-summary {
            margin-top: 7px;
            color: var(--daz-muted);
            font-size: 10px;
            overflow-wrap: anywhere;
        }

        .daz-date-summary.daz-date-error {
            color: #ed4245;
        }

        #daz-to-date-wrap[hidden] {
            display: none;
        }

        .daz-auto-option {
            margin: 9px 1px 10px;
        }

        .daz-actions {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 7px;
        }

        #discord-auto-zip-panel button {
            border: 0;
            border-radius: 6px;
            padding: 9px 8px;
            color: #fff;
            cursor: pointer;
            font: inherit;
            font-weight: 750;
        }

        #discord-auto-zip-panel button:hover:not(:disabled) {
            filter: brightness(1.12);
        }

        #discord-auto-zip-panel button:disabled {
            cursor: not-allowed;
            opacity: .42;
        }

        .daz-primary {
            grid-column: 1 / -1;
            background: #5865f2;
        }

        .daz-danger {
            background: #da373c;
        }

        .daz-success {
            background: #248046;
        }

        .daz-secondary,
        .daz-icon-button {
            background: #4e5058;
        }

        #daz-download-again {
            grid-column: 1 / -1;
        }

        .daz-icon-button {
            width: 34px;
            min-width: 34px;
            padding: 6px !important;
        }

        .daz-section-title {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            gap: 8px;
            margin: 13px 1px 6px;
            font-weight: 800;
        }

        .daz-image-list {
            max-height: 260px;
            overflow-y: auto;
            border: 1px solid var(--daz-border);
            border-radius: 8px;
            background: #0c0d0e;
        }

        .daz-image-list:empty::before {
            display: block;
            padding: 16px;
            color: var(--daz-muted);
            text-align: center;
            content: "No media collected yet";
        }

        .daz-row {
            display: grid;
            grid-template-columns: 42px minmax(0, 1fr) 31px;
            align-items: center;
            gap: 8px;
            min-height: 50px;
            padding: 5px 7px;
            border-bottom: 1px solid rgba(255,255,255,.07);
        }

        .daz-row:last-child {
            border-bottom: 0;
        }

        .daz-thumb {
            width: 42px;
            height: 42px;
            border-radius: 5px;
            background: #2b2d31;
            object-fit: cover;
        }

        .daz-video-thumb {
            display: grid;
            place-items: center;
            color: #fff;
            background: #2b2d31;
            font-size: 18px;
        }

        .daz-skipped {
            opacity: .45;
        }

        .daz-details {
            min-width: 0;
        }

        .daz-name {
            overflow: hidden;
            font-size: 12px;
            font-weight: 650;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .daz-meta {
            margin-top: 3px;
            overflow: hidden;
            color: var(--daz-muted);
            font-size: 10px;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .daz-check {
            display: grid;
            width: 25px;
            height: 25px;
            place-items: center;
            border: 1px solid var(--daz-border);
            border-radius: 50%;
            font-weight: 900;
        }

        .daz-check-collected {
            color: #b5bac1;
        }

        .daz-check-fetching {
            color: #f0b232;
            animation: daz-pulse .7s infinite alternate;
        }

        .daz-check-packed {
            border-color: #248046;
            background: #248046;
            color: white;
        }

        .daz-check-error {
            border-color: #da373c;
            background: #da373c;
            color: white;
        }

        .daz-check-skipped {
            color: #949ba4;
        }

        @keyframes daz-pulse {
            to { opacity: .35; }
        }

        .daz-log {
            height: 130px;
            overflow: auto;
            padding: 7px;
            border: 1px solid var(--daz-border);
            border-radius: 8px;
            background: #08090a;
            color: #b5bac1;
            font: 11px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace;
        }

        .daz-log-line {
            overflow-wrap: anywhere;
        }

        .daz-log-success {
            color: #57f287;
        }

        .daz-log-warn {
            color: #f0b232;
        }

        .daz-log-error {
            color: #ed4245;
        }

        .daz-note {
            margin-top: 9px;
        }

        #discord-auto-zip-panel.daz-collapsed #daz-body {
            display: none;
        }
    `;

    document.head.appendChild(style);
    document.body.appendChild(panel);

    const phaseElement = panel.querySelector('#daz-phase');
    const progressFill = panel.querySelector('#daz-progress-fill');
    const foundElement = panel.querySelector('#daz-found');
    const photoCountElement = panel.querySelector('#daz-photo-count');
    const videoCountElement = panel.querySelector('#daz-video-count');
    const externalGifCountElement =
        panel.querySelector('#daz-external-gif-count');
    const inRangeElement = panel.querySelector('#daz-in-range');
    const excludedDateElement =
        panel.querySelector('#daz-excluded-date');
    const selectedCountElement = panel.querySelector('#daz-selected-count');
    const packedElement = panel.querySelector('#daz-packed');
    const errorElement = panel.querySelector('#daz-errors');
    const imageList = panel.querySelector('#daz-image-list');
    const logArea = panel.querySelector('#daz-log');
    const startButton = panel.querySelector('#daz-start');
    const stopButton = panel.querySelector('#daz-stop');
    const zipButton = panel.querySelector('#daz-zip');
    const resetButton = panel.querySelector('#daz-reset');
    const downloadAgainButton = document.createElement('button');
    downloadAgainButton.hidden = true;
    const autoZipCheckbox = panel.querySelector('#daz-auto-zip');
    const photoCheckbox = panel.querySelector('#daz-include-photos');
    const videoCheckbox = panel.querySelector('#daz-include-videos');
    const externalGifCheckbox =
        panel.querySelector('#daz-include-external-gifs');
    const scanDirectionSelect = panel.querySelector('#daz-scan-direction');
    const finalPositionSelect =
        panel.querySelector('#daz-final-position');
    const dateFilterCheckbox = panel.querySelector('#daz-date-filter');
    const dateFields = panel.querySelector('#daz-date-fields');
    const fromDateInput = panel.querySelector('#daz-from-date');
    const dateEndModeSelect = panel.querySelector('#daz-date-end-mode');
    const toDateWrap = panel.querySelector('#daz-to-date-wrap');
    const toDateInput = panel.querySelector('#daz-to-date');
    const dateSummaryElement = panel.querySelector('#daz-date-summary');
    const collapseButton = panel.querySelector('#daz-collapse');

    function refreshDateControls() {
        const enabled = dateFilterCheckbox.checked;
        const specificEnd =
            enabled && dateEndModeSelect.value === 'specific';

        dateFields.classList.toggle('daz-disabled', !enabled);
        toDateWrap.hidden = !specificEnd;

        const range = getDateRangeConfig();
        dateSummaryElement.classList.toggle(
            'daz-date-error',
            !range.valid
        );

        dateSummaryElement.textContent = !enabled
            ? 'Date filter disabled — all scanned dates can be included.'
            : range.valid
                ? `Inclusive range: ${range.label}`
                : range.error;

        scheduleRender();
        updateCounters();
    }

    startButton.addEventListener('click', startAutomaticWorkflow);
    stopButton.addEventListener('click', requestStop);
    zipButton.addEventListener('click', createAndDownloadZipParts);
    photoCheckbox.addEventListener('change', () => {
        scheduleRender();
        updateCounters();
    });
    videoCheckbox.addEventListener('change', () => {
        scheduleRender();
        updateCounters();
    });
    externalGifCheckbox.addEventListener('change', () => {
        scheduleRender();
        updateCounters();
    });
    scanDirectionSelect.addEventListener('change', () => {
        addLog(
            `Scan mode selected: ${scanModeDescription(scanDirectionSelect.value)}.`
        );
    });
    finalPositionSelect.addEventListener('change', () => {
        addLog(
            `Final chat position: ${finalPositionDescription(finalPositionSelect.value)}.`
        );
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
    collapseButton.addEventListener('click', () => {
        const collapsed = panel.classList.toggle('daz-collapsed');
        collapseButton.textContent = collapsed ? '+' : '−';
    });

    window.addEventListener('beforeunload', () => {
        abortActiveRequests();
        releaseLastZipUrl();
    });

    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    fromDateInput.value = localDateInputValue(thirtyDaysAgo);
    toDateInput.value = localDateInputValue(today);
    dateEndModeSelect.value = 'latest';

    addLog(
        'Ready. Choose filters, scan direction, and final chat position, then click START.'
    );
    refreshDateControls();
})();
