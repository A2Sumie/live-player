import WasmDsp from "./wasm/wasm_gsr.js";
import { config } from "./config.js";

// background.js - Sniff M3U8 requests + Widevine Key Extraction (WASM)

// Store captured streams, licenses, and KEYS
let detectedStreams = {}; // { tabId: [ { url, headers, timestamp, mediaInfo } ] }
let detectedLicenses = {}; // { tabId: [ { url, headers, timestamp } ] }
let detectedKeys = {}; // { tabId: [ { kid, key, session } ] }

// Caching and monitoring state
let cachedPageInfo = {}; // { tabId: { streams, licenses, keys, cookies, pageUrl, timestamp } }
let monitoringState = {}; // { tabId: { enabled: bool, targetStream: null } }
let debugEvents = []; // deduped request/debug events kept across MV3 worker restarts

const CAPTURE_STATE_KEY = 'captureState.v2';
const MAX_DEBUG_EVENTS = 50;
const storageArea = chrome.storage.session || chrome.storage.local;
const BYPASS_RULE_ID = 22781;

async function ensureBypassHeaderRule() {
    if (!chrome.declarativeNetRequest?.updateDynamicRules || !config.WAF_SECRET_KEY) {
        return;
    }

    await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [BYPASS_RULE_ID],
        addRules: [{
            id: BYPASS_RULE_ID,
            priority: 1,
            action: {
                type: 'modifyHeaders',
                requestHeaders: [{
                    header: 'x-bypass-waf',
                    operation: 'set',
                    value: config.WAF_SECRET_KEY
                }]
            },
            condition: {
                regexFilter: '^https://stream\\.n2nj\\.moe/archive-api/.*$',
                resourceTypes: [
                    'main_frame',
                    'sub_frame',
                    'xmlhttprequest',
                    'other',
                    'media'
                ]
            }
        }]
    });
}

function tryParseUrl(rawUrl) {
    try {
        return new URL(rawUrl);
    } catch (error) {
        return null;
    }
}

function isManifestPathname(pathname) {
    const normalized = String(pathname || '').toLowerCase();
    return normalized.endsWith('.m3u8') || normalized.endsWith('.mpd');
}

function isIgnoredTrackerUrl(rawUrl) {
    const parsed = tryParseUrl(rawUrl);
    if (!parsed) {
        return false;
    }

    return parsed.hostname.toLowerCase() === 'metrics.brightcove.com';
}

function isLikelyManifestUrl(rawUrl) {
    const parsed = tryParseUrl(rawUrl);
    if (!parsed || isIgnoredTrackerUrl(rawUrl)) {
        return false;
    }

    return isManifestPathname(parsed.pathname);
}

function detectManifestType(rawUrl) {
    const parsed = tryParseUrl(rawUrl);
    if (!parsed) {
        return null;
    }

    const pathname = parsed.pathname.toLowerCase();
    if (pathname.endsWith('.m3u8')) return 'HLS';
    if (pathname.endsWith('.mpd')) return 'DASH';
    return null;
}

function normalizeCapturedStreams(streams) {
    const filtered = (streams || []).filter((stream) => isLikelyManifestUrl(stream.url));
    if (filtered.length > 0) {
        return filtered;
    }

    return (streams || []).filter((stream) => !isIgnoredTrackerUrl(stream.url));
}

function serializeState() {
    return {
        detectedStreams,
        detectedLicenses,
        detectedKeys,
        cachedPageInfo,
        monitoringState,
        debugEvents
    };
}

function hydrateState(state) {
    if (!state || typeof state !== 'object') return;

    detectedStreams = state.detectedStreams || {};
    detectedLicenses = state.detectedLicenses || {};
    detectedKeys = state.detectedKeys || {};
    cachedPageInfo = state.cachedPageInfo || {};
    monitoringState = state.monitoringState || {};
    debugEvents = Array.isArray(state.debugEvents) ? state.debugEvents : [];
}

function persistState() {
    try {
        storageArea.set({ [CAPTURE_STATE_KEY]: serializeState() }, () => {
            if (chrome.runtime.lastError) {
                console.warn('[Background] Failed to persist capture state:', chrome.runtime.lastError.message);
            }
        });
    } catch (error) {
        console.warn('[Background] Failed to persist capture state:', error);
    }
}

function loadPersistedState() {
    return new Promise((resolve) => {
        try {
            storageArea.get([CAPTURE_STATE_KEY], (result) => {
                if (chrome.runtime.lastError) {
                    console.warn('[Background] Failed to restore capture state:', chrome.runtime.lastError.message);
                    resolve();
                    return;
                }

                hydrateState(result[CAPTURE_STATE_KEY]);
                resolve();
            });
        } catch (error) {
            console.warn('[Background] Failed to restore capture state:', error);
            resolve();
        }
    });
}

function rememberDebugEvent(event) {
    const signature = [
        event.kind || 'event',
        event.tabId,
        event.resourceType || '',
        event.method || '',
        event.url || ''
    ].join('|');

    const existingIndex = debugEvents.findIndex((item) => item.signature === signature);
    const payload = {
        ...event,
        signature,
        timestamp: Date.now()
    };

    if (existingIndex >= 0) {
        debugEvents[existingIndex] = payload;
    } else {
        debugEvents.push(payload);
        if (debugEvents.length > MAX_DEBUG_EVENTS) {
            debugEvents = debugEvents.slice(-MAX_DEBUG_EVENTS);
        }
    }

    persistState();
}

function resetTabState(tabId, options = {}) {
    delete detectedStreams[tabId];
    delete detectedLicenses[tabId];
    delete detectedKeys[tabId];
    delete cachedPageInfo[tabId];
    delete monitoringState[tabId];
    debugEvents = debugEvents.filter((item) => item.tabId !== tabId);
    persistState();

    if (options.clearBadge) {
        chrome.action.setBadgeText({ text: "", tabId: tabId });
    }
}

const stateReady = loadPersistedState();
ensureBypassHeaderRule().catch((error) => console.warn('[Background] Failed to apply bypass rule:', error));
chrome.runtime.onInstalled.addListener(() => {
    ensureBypassHeaderRule().catch((error) => console.warn('[Background] Failed to apply bypass rule:', error));
});
chrome.runtime.onStartup.addListener(() => {
    ensureBypassHeaderRule().catch((error) => console.warn('[Background] Failed to apply bypass rule:', error));
});

// --- WASM / Widevine L3 Guesser Logic ---
var Wdsp = null;
var _freeStr, stringToUTF8, writeArrayToMemory, UTF8ToString, stackSave, stackRestore, stackAlloc;

function getCFunc(ident) {
    return Wdsp[`_${ident}`]; // closure exported function
}

function scall(ident, returnType, argTypes, args, opts) {
    const toC = {
        string(str) {
            let ret = 0;
            if (str !== null && str !== undefined && str !== 0) {
                const len = (str.length << 2) + 1;
                ret = stackAlloc(len);
                stringToUTF8(str, ret, len);
            }
            return ret;
        },
        array(arr) {
            const ret = stackAlloc(arr.length);
            writeArrayToMemory(arr, ret);
            return ret;
        }
    };
    function convertReturnValue(ret) {
        if (returnType === 'string') return UTF8ToString(ret);
        if (returnType === 'boolean') return Boolean(ret);
        return ret;
    }
    const func = getCFunc(ident);
    const cArgs = [];
    let stack = 0;
    if (args) {
        for (let i = 0; i < args.length; i++) {
            const converter = toC[argTypes[i]];
            if (converter) {
                if (stack === 0) stack = stackSave();
                cArgs[i] = converter(args[i]);
            } else {
                cArgs[i] = args[i];
            }
        }
    }
    const _ret = func.apply(null, cArgs);
    const ret = convertReturnValue(_ret);
    _freeStr(_ret);
    if (stack !== 0) stackRestore(stack);
    return ret;
}

function swrap(ident, returnType, argTypes, opts) {
    argTypes = argTypes || [];
    const numericArgs = argTypes.every((type) => type === 'number');
    const numericRet = returnType !== 'string';
    if (numericRet && numericArgs && !opts) {
        return getCFunc(ident);
    }
    return function () {
        return scall(ident, returnType, argTypes, arguments, opts);
    };
}

async function init() {
    if (Wdsp) return; // Already initialized
    Wdsp = await WasmDsp();
    await Wdsp.ready;
    _freeStr = Wdsp._freeStr;
    stringToUTF8 = Wdsp.stringToUTF8;
    writeArrayToMemory = Wdsp.writeArrayToMemory;
    UTF8ToString = Wdsp.UTF8ToString;
    stackSave = Wdsp.stackSave;
    stackRestore = Wdsp.stackRestore;
    stackAlloc = Wdsp.stackAlloc;
    console.log("✅ [Background] WASM Module Initialized");
}

function decode(val, sendResponse) {
    var tryUsingDecoder = swrap('tryUsingDecoder', 'string', ['string']);
    var res = tryUsingDecoder(val);
    sendResponse({ value: res });
}

// Initialize WASM on load
init();

// --- End WASM Logic ---

// Clean headers - remove unnecessary headers
function cleanHeaders(requestHeaders) {
    if (!requestHeaders) return {};

    const headers = {};
    const allowedHeaders = [
        'user-agent',
        'referer',
        'origin',
        'cookie',
        'authorization',
        'x-requested-with',
        'accept',
        'accept-language',
        'accept-encoding',
        'content-type',
        'sec-ch-ua',
        'sec-ch-ua-mobile',
        'sec-ch-ua-platform',
        'sec-fetch-dest',
        'sec-fetch-mode',
        'sec-fetch-site'
    ];

    for (const header of requestHeaders) {
        const name = header.name.toLowerCase();
        if (allowedHeaders.includes(name)) {
            headers[header.name] = header.value;
        }
    }

    return headers;
}

function parseHlsAttributeList(attributeLine) {
    const attributes = {};
    const matcher = /([A-Z0-9-]+)=("(?:[^"\\]|\\.)*"|[^,]*)/gi;
    let match = null;

    while ((match = matcher.exec(attributeLine)) !== null) {
        let value = match[2] || '';
        if (value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1);
        }
        attributes[match[1].toUpperCase()] = value;
    }

    return attributes;
}

function resolveManifestUrl(rawUrl, baseUrl) {
    try {
        return new URL(rawUrl, baseUrl).toString();
    } catch (_error) {
        return rawUrl;
    }
}

// Parse both variants and referenced renditions so separate audio can be surfaced
// even before the browser fetches the audio playlist itself.
function parseHlsManifest(content, baseUrl) {
    const lines = content.split('\n');
    const variants = [];
    const audioTracks = [];
    let pendingVariant = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) {
            continue;
        }

        if (line.startsWith('#EXT-X-MEDIA:')) {
            const attrs = parseHlsAttributeList(line.slice('#EXT-X-MEDIA:'.length));
            if ((attrs.TYPE || '').toUpperCase() === 'AUDIO') {
                audioTracks.push({
                    url: attrs.URI ? resolveManifestUrl(attrs.URI, baseUrl) : null,
                    group_id: attrs['GROUP-ID'] || null,
                    name: attrs.NAME || null,
                    language: attrs.LANGUAGE || null,
                    channels: attrs.CHANNELS || null,
                    autoselect: attrs.AUTOSELECT === 'YES',
                    default: attrs.DEFAULT === 'YES'
                });
            }
            continue;
        }

        if (line.startsWith('#EXT-X-STREAM-INF:')) {
            const attrs = parseHlsAttributeList(line.slice('#EXT-X-STREAM-INF:'.length));
            pendingVariant = {
                bandwidth: attrs.BANDWIDTH ? parseInt(attrs.BANDWIDTH, 10) : 0,
                resolution: attrs.RESOLUTION || 'Unknown',
                codecs: attrs.CODECS || '',
                audio_group: attrs.AUDIO || null
            };
            continue;
        }

        if (line.startsWith('#')) {
            continue;
        }

        if (pendingVariant) {
            variants.push({
                url: resolveManifestUrl(line, baseUrl),
                ...pendingVariant
            });
            pendingVariant = null;
        }
    }

    return {
        variants: variants.sort((a, b) => b.bandwidth - a.bandwidth),
        audio_tracks: audioTracks.filter((track, index, allTracks) => {
            const signature = [track.url, track.group_id, track.name, track.language].join('|');
            return allTracks.findIndex((candidate) => {
                return [candidate.url, candidate.group_id, candidate.name, candidate.language].join('|') === signature;
            }) === index;
        })
    };
}

// Analyze M3U8/MPD stream and extract PSSH if available
async function analyzeM3u8(url, headers) {
    try {
        const response = await fetch(url, {
            headers: headers,
            method: 'GET'
        });

        if (!response.ok) {
            return { error: 'Failed to fetch', status: response.status };
        }

        const text = await response.text();
        const info = {
            size: text.length,
            variants_count: 0,
            variants: [],
            encrypted: false,
            pssh: null
        };

        // Basic HLS analysis
        if (detectManifestType(url) === 'HLS') {
            info.encrypted = text.includes('#EXT-X-KEY');
            const parsedManifest = parseHlsManifest(text, url);
            info.variants = parsedManifest.variants;
            info.variants_count = info.variants.length;
            info.audio_tracks = parsedManifest.audio_tracks;
            info.audio_track_count = parsedManifest.audio_tracks.length;
            info.has_audio_renditions = parsedManifest.audio_tracks.length > 0;
        }

        // Basic DASH analysis with PSSH extraction
        if (detectManifestType(url) === 'DASH') {
            info.variants_count = (text.match(/<Representation/g) || []).length;
            info.encrypted = text.includes('ContentProtection') || text.includes('cenc:default_KID');

            // Extract PSSH if DRM protected
            if (info.encrypted) {
                // Try to find PSSH in ContentProtection with Widevine UUID
                const psshMatch = text.match(/<cenc:pssh>([A-Za-z0-9+/=]+)<\/cenc:pssh>/);
                if (psshMatch) {
                    info.pssh = psshMatch[1];
                } else {
                    // Try alternative PSSH format
                    const altPsshMatch = text.match(/<mspr:pro>([A-Za-z0-9+/=]+)<\/mspr:pro>/);
                    if (altPsshMatch) {
                        info.pssh = altPsshMatch[1];
                    }
                }
            }
        }

        return info;
    } catch (error) {
        return { error: error.message };
    }
}

// Build comprehensive DRM package
function buildComprehensiveDRM(stream, license, pageUrl) {
    const pkg = {
        mode: 'echo',
        source: stream.url,
        type: stream.type,
        headers: { ...stream.headers },
        page_url: pageUrl,
        drm: {
            license_url: license ? license.url : null,
            license_headers: license ? license.headers : {},
            pssh: stream.mediaInfo && stream.mediaInfo.pssh ? stream.mediaInfo.pssh : null
        }
    };

    // For backward compatibility, also flatten license_url into headers
    if (license) {
        pkg.headers['X-License-Url'] = license.url;
    }

    return pkg;
}

// Build page-level comprehensive DRM package (all streams + all licenses + cookies + KEYS)
async function buildPageLevelDRM(tabId, pageUrl) {
    await stateReady;

    const streams = normalizeCapturedStreams(detectedStreams[tabId] || []);
    const licenses = detectedLicenses[tabId] || [];
    const keys = detectedKeys[tabId] || [];

    let primaryStream = null;
    for (const stream of streams) {
        const mediaInfo = stream.mediaInfo || {};
        const variantsCount = mediaInfo.variants_count || (Array.isArray(mediaInfo.variants) ? mediaInfo.variants.length : 0);
        if ((stream.url && stream.url.includes('playlist')) || variantsCount > 0) {
            primaryStream = stream;
            break;
        }
    }
    if (!primaryStream && streams.length > 0) {
        primaryStream = streams[0];
    }

    // Get all cookies for this page
    const cookies = await chrome.cookies.getAll({ url: pageUrl });
    const cookieDict = {};
    cookies.forEach(c => {
        cookieDict[c.name] = c.value;
    });

    // Encode cookies as base64
    const cookiesJson = JSON.stringify(cookieDict);
    const cookies_b64 = btoa(cookiesJson);

    // Build comprehensive package
    const pkg = {
        mode: 'echo',
        page_url: pageUrl,
        timestamp: Date.now(),
        source: primaryStream ? primaryStream.url : '',
        headers: primaryStream ? { ...primaryStream.headers } : {},
        cookies_b64: cookies_b64,
        streams_detected: streams.length,
        streams: streams.map(s => ({
            source: s.url,
            type: s.type,
            headers: s.headers,
            mediaInfo: s.mediaInfo // Includes parsed variants
        })),
        licenses: licenses.map(l => ({
            url: l.url,
            headers: l.headers,
            timestamp: l.timestamp
        })),
        keys: keys.map(k => ({
            kid: k.kid,
            key: k.key,
            session: k.session
        }))
    };

    return pkg;
}

// Listener
chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
        const url = details.url;
        const tabId = details.tabId;

        let isLicense = false;
        if ((url.includes('license') || url.includes('widevine') || url.includes('drm')) && details.method === 'POST') {
            isLicense = true;
        }

        const type = detectManifestType(url);

        if (isLicense || type) {
            rememberDebugEvent({
                kind: isLicense ? 'license' : 'stream',
                tabId,
                resourceType: details.type,
                method: details.method,
                skipped: tabId === -1,
                url
            });
        }

        if (tabId === -1) return;

        // Initialize storage
        if (!detectedStreams[tabId]) detectedStreams[tabId] = [];
        if (!detectedLicenses[tabId]) detectedLicenses[tabId] = [];
        if (!detectedKeys[tabId]) detectedKeys[tabId] = [];

        const headers = cleanHeaders(details.requestHeaders);

        if (isLicense) {
            console.log("Captured License Request:", url);
            const licObj = {
                type: 'LICENSE',
                url: url,
                headers: headers,
                timestamp: Date.now()
            };
            // Dedupe licenses
            if (!detectedLicenses[tabId].find(l => l.url === url)) {
                detectedLicenses[tabId].push(licObj);
                persistState();

                // Visual Indicator
                chrome.action.setBadgeText({ text: "DRM", tabId: tabId });
                chrome.action.setBadgeBackgroundColor({ color: '#d9534f', tabId: tabId });
            }
            return;
        }

        if (type) {
            // Deduplicate simple
            const exists = detectedStreams[tabId].find(s => s.url === url);
            if (!exists) {
                const streamObj = {
                    type: type,
                    url: url,
                    headers: headers,
                    timestamp: Date.now(),
                    mediaInfo: null // To be filled
                };

                detectedStreams[tabId].push(streamObj);
                persistState();

                // Trigger analysis
                analyzeM3u8(url, headers).then(info => {
                    streamObj.mediaInfo = info;
                    persistState();
                });

                // Update badge
                const count = normalizeCapturedStreams(detectedStreams[tabId]).length;
                chrome.action.setBadgeText({ text: String(count), tabId: tabId });
                chrome.action.setBadgeBackgroundColor({ color: '#28a745', tabId: tabId });
            }
        }
    },
    { urls: ["<all_urls>"] },
    ["requestHeaders", "extraHeaders"] // Extra info spec for MV3
);

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    // --- WASM Decryption Relay ---
    if (request.name === "dec") {
        if (!request.value) {
            sendResponse({ value: null });
            return;
        }

        // Ensure WASM is ready
        if (Wdsp == null) {
            init().then(() => {
                decode(request.value, sendResponse)
            }).catch(e => console.error(e));
        } else {
            decode(request.value, sendResponse);
        }
        return true; // async promise
    }

    // --- Key Exfiltration ---
    if (request.action === "widevineKeyFound") {
        // Tab ID comes from sender (content script)
        const tabId = sender.tab ? sender.tab.id : request.tabId;

        if (tabId) {
            if (!detectedKeys[tabId]) detectedKeys[tabId] = [];

            // Deduplicate keys
            if (!detectedKeys[tabId].find(k => k.kid === request.data.kid)) {
                console.log("🔑 [Background] Stored Widevine Key:", request.data);
                detectedKeys[tabId].push(request.data);
                persistState();

                // Update badge to Purple for Keys to indicate success!
                chrome.action.setBadgeText({ text: "KEY", tabId: tabId });
                chrome.action.setBadgeBackgroundColor({ color: '#800080', tabId: tabId });
            }
        }
        sendResponse({ success: true });
        return;
    }

    // --- Standard Action Handlers ---

    if (request.action === 'getStreams') {
        const tabId = request.tabId;
        stateReady.then(() => {
            sendResponse({
                streams: normalizeCapturedStreams(detectedStreams[tabId] || []),
                licenses: detectedLicenses[tabId] || [],
                keys: detectedKeys[tabId] || []
            });
        });
        return true;
    }

    // Legacy: getDRMPackage (single stream)
    if (request.action === 'getDRMPackage') {
        stateReady.then(() => {
            const tabId = request.tabId;
            const streamIndex = request.streamIndex;
            const streams = normalizeCapturedStreams(detectedStreams[tabId] || []);
            const licenses = detectedLicenses[tabId] || [];

            if (streamIndex < streams.length) {
                const stream = streams[streamIndex];
                const license = licenses.length > 0 ? licenses[licenses.length - 1] : null;
                const pkg = buildComprehensiveDRM(stream, license, request.pageUrl);

                // Attach keys if any
                if (detectedKeys[tabId] && detectedKeys[tabId].length > 0) {
                    pkg.keys = detectedKeys[tabId];
                }

                sendResponse({ package: pkg });
            } else {
                sendResponse({ error: 'Stream not found' });
            }
        });
        return true;
    }

    // Get Comprehensive Page Package
    if (request.action === 'getPageDRMPackage') {
        const tabId = request.tabId;
        buildPageLevelDRM(tabId, request.pageUrl).then(pkg => {
            sendResponse({ package: pkg });
        }).catch(err => {
            sendResponse({ error: err.message });
        });
        return true; // async
    }

    if (request.action === 'cachePageInfo') {
        const tabId = request.tabId;
        buildPageLevelDRM(tabId, request.pageUrl).then(pkg => {
            cachedPageInfo[tabId] = pkg;
            persistState();
            sendResponse({ success: true, cached: pkg });
        }).catch(err => {
            sendResponse({ error: err.message });
        });
        return true; // async
    }

    if (request.action === 'enableMonitoring') {
        const tabId = request.tabId;
        monitoringState[tabId] = { enabled: true, targetStream: null };
        persistState();
        sendResponse({ success: true });
        return true;
    }

    if (request.action === 'getCachedDRM') {
        const tabId = request.tabId;
        stateReady.then(() => {
            if (cachedPageInfo[tabId]) {
                sendResponse({ package: cachedPageInfo[tabId] });
            } else {
                sendResponse({ error: 'No cached data' });
            }
        });
        return true;
    }

    if (request.action === 'getDebugState') {
        stateReady.then(() => {
            sendResponse({
                tabs: {
                    streams: Object.fromEntries(
                        Object.entries(detectedStreams).map(([tabId, items]) => [tabId, items.length])
                    ),
                    licenses: Object.fromEntries(
                        Object.entries(detectedLicenses).map(([tabId, items]) => [tabId, items.length])
                    ),
                    keys: Object.fromEntries(
                        Object.entries(detectedKeys).map(([tabId, items]) => [tabId, items.length])
                    ),
                    cached: Object.keys(cachedPageInfo),
                    monitoring: Object.keys(monitoringState),
                },
                debugEvents
            });
        });
        return true;
    }
});

// Clean up on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
    resetTabState(tabId);
});

// Clean up on navigation (refresh/new page in same tab)
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
    if (details.frameId === 0) { // Main frame only
        resetTabState(details.tabId, { clearBadge: true });
    }
});
