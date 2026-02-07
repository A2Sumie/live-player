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

// Basic M3U8 Parser
function parseM3u8Variants(content, baseUrl) {
    const variants = [];
    const lines = content.split('\n');
    let currentInfo = {};

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXT-X-STREAM-INF:')) {
            // Parse attributes
            const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
            const resolutionMatch = line.match(/RESOLUTION=(\d+x\d+)/);

            currentInfo = {
                bandwidth: bandwidthMatch ? parseInt(bandwidthMatch[1]) : 0,
                resolution: resolutionMatch ? resolutionMatch[1] : 'Unknown',
            };
        } else if (line.startsWith('#') || line === '') {
            continue;
        } else {
            // URL line
            if (currentInfo.bandwidth || currentInfo.resolution) {
                let url = line;
                if (!url.startsWith('http')) {
                    // Resolve relative URL
                    const baseParts = baseUrl.split('/');
                    baseParts.pop(); // Remove filename
                    url = baseParts.join('/') + '/' + url;
                }
                variants.push({
                    url: url,
                    ...currentInfo
                });
                currentInfo = {}; // Reset
            }
        }
    }
    return variants.sort((a, b) => b.bandwidth - a.bandwidth);
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
        if (url.includes('.m3u8')) {
            info.encrypted = text.includes('#EXT-X-KEY');
            info.variants = parseM3u8Variants(text, url);
            info.variants_count = info.variants.length;
        }

        // Basic DASH analysis with PSSH extraction
        if (url.includes('.mpd')) {
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
    const streams = detectedStreams[tabId] || [];
    const licenses = detectedLicenses[tabId] || [];
    const keys = detectedKeys[tabId] || [];

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
        if (details.type === 'xmlhttprequest' || details.type === 'main_frame' || details.type === 'other') {
            const url = details.url;
            const tabId = details.tabId;
            if (tabId === -1) return;

            // Initialize storage
            if (!detectedStreams[tabId]) detectedStreams[tabId] = [];
            if (!detectedLicenses[tabId]) detectedLicenses[tabId] = [];
            if (!detectedKeys[tabId]) detectedKeys[tabId] = [];

            const headers = cleanHeaders(details.requestHeaders);

            // KEYBOARD: Detect License Requests
            let isLicense = false;
            // Common keywords
            if ((url.includes('license') || url.includes('widevine') || url.includes('drm')) && details.method === 'POST') {
                isLicense = true;
            }

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

                    // Visual Indicator
                    chrome.action.setBadgeText({ text: "DRM", tabId: tabId });
                    chrome.action.setBadgeBackgroundColor({ color: '#d9534f', tabId: tabId });
                }
                return;
            }

            // Check for .m3u8 or .mpd
            let type = null;
            if (url.includes('.m3u8')) type = 'HLS';
            if (url.includes('.mpd')) type = 'DASH';

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

                    // Trigger analysis
                    analyzeM3u8(url, headers).then(info => {
                        streamObj.mediaInfo = info;
                    });

                    // Update badge
                    const count = detectedStreams[tabId].filter(s => s.type !== 'LICENSE').length;
                    chrome.action.setBadgeText({ text: String(count), tabId: tabId });
                    chrome.action.setBadgeBackgroundColor({ color: '#28a745', tabId: tabId });
                }
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
        sendResponse({
            streams: detectedStreams[tabId] || [],
            licenses: detectedLicenses[tabId] || [],
            keys: detectedKeys[tabId] || []
        });
        return true; // async
    }

    // Legacy: getDRMPackage (single stream)
    if (request.action === 'getDRMPackage') {
        const tabId = request.tabId;
        const streamIndex = request.streamIndex;
        const streams = detectedStreams[tabId] || [];
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
            sendResponse({ success: true, cached: pkg });
        }).catch(err => {
            sendResponse({ error: err.message });
        });
        return true; // async
    }

    if (request.action === 'enableMonitoring') {
        const tabId = request.tabId;
        monitoringState[tabId] = { enabled: true, targetStream: null };
        sendResponse({ success: true });
        return true;
    }

    if (request.action === 'getCachedDRM') {
        const tabId = request.tabId;
        if (cachedPageInfo[tabId]) {
            sendResponse({ package: cachedPageInfo[tabId] });
        } else {
            sendResponse({ error: 'No cached data' });
        }
        return true;
    }
});

// Clean up on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
    delete detectedStreams[tabId];
    delete detectedLicenses[tabId];
    delete detectedKeys[tabId];
    delete cachedPageInfo[tabId];
    delete monitoringState[tabId];
});

// Clean up on navigation (refresh/new page in same tab)
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
    if (details.frameId === 0) { // Main frame only
        const tabId = details.tabId;
        delete detectedStreams[tabId];
        delete detectedLicenses[tabId];
        delete detectedKeys[tabId];
        delete cachedPageInfo[tabId];
        // Don't necessarily delete monitoringState if we want it ensuring across navs? 
        // usually safer to reset to avoid confusion.
        delete monitoringState[tabId];

        // Reset badge
        chrome.action.setBadgeText({ text: "", tabId: tabId });
    }
});
