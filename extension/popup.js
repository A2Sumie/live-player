// popup.js - Detection & Copy
import { config } from './config.js';

// Open dashboard button
document.getElementById('openDashboard').addEventListener('click', () => {
    chrome.tabs.create({ url: config.API_BASE_URL });
});

document.addEventListener('DOMContentLoaded', async () => {
    const status = document.getElementById('status');
    const output = document.getElementById('output');
    const copyRelayPackageButton = document.getElementById('copyRelayPackage');
    const sendRelayButton = document.getElementById('sendRelay');
    const relayTitleInput = document.getElementById('relayTitle');

    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    if (relayTitleInput) {
        relayTitleInput.value = tab.title || 'Relay';
    }

    const setStatus = (message, type = 'info') => {
        if (!status) {
            return;
        }
        status.textContent = message || '';
        status.className = `status-banner ${type}`.trim();
        status.dataset.visible = message ? 'true' : 'false';
    };

    const sendMessage = (message) => new Promise((resolve) => {
        chrome.runtime.sendMessage(message, (response) => resolve(response || {}));
    });

    const buildApiHeaders = (headers = {}) => {
        const nextHeaders = {
            ...headers
        };

        if (config.WAF_SECRET_KEY) {
            nextHeaders['x-bypass-waf'] = config.WAF_SECRET_KEY;
        }

        return nextHeaders;
    };

    const relayState = {
        streams: [],
        licenses: [],
        pagePackage: null
    };

    const refreshRelayState = async () => {
        const [streamResponse, pagePackageResponse] = await Promise.all([
            sendMessage({ action: 'getStreams', tabId: tab.id }),
            sendMessage({ action: 'getPageDRMPackage', tabId: tab.id, pageUrl: tab.url })
        ]);

        const streams = normalizeCapturedStreams(streamResponse.streams || []);
        const licenses = normalizeLicenses(streamResponse.licenses || []);
        relayState.streams = streams;
        relayState.licenses = licenses;
        relayState.pagePackage = buildSanitizedPagePackage(pagePackageResponse.package || null);
        return relayState.pagePackage;
    };

    const tryParseUrl = (rawUrl) => {
        try {
            return new URL(rawUrl);
        } catch (_error) {
            return null;
        }
    };

    const isIgnoredTrackerUrl = (rawUrl) => {
        const parsed = tryParseUrl(rawUrl);
        if (!parsed) {
            return false;
        }

        const hostname = parsed.hostname.toLowerCase();
        if (hostname === 'metrics.brightcove.com') {
            return true;
        }

        const pathname = parsed.pathname.toLowerCase();
        return pathname.includes('/v2/tracker');
    };

    const isManifestPathname = (pathname) => {
        const normalized = String(pathname || '').toLowerCase();
        return normalized.endsWith('.m3u8') || normalized.endsWith('.mpd');
    };

    const isLikelyManifestUrl = (rawUrl) => {
        const parsed = tryParseUrl(rawUrl);
        if (!parsed || isIgnoredTrackerUrl(rawUrl)) {
            return false;
        }

        return isManifestPathname(parsed.pathname);
    };

    const dedupeBy = (items, getKey) => {
        const seen = new Set();
        const deduped = [];

        for (const item of items || []) {
            const key = String(getKey(item) || '').trim();
            if (!key || seen.has(key)) {
                continue;
            }
            seen.add(key);
            deduped.push(item);
        }

        return deduped;
    };

    const normalizeCapturedStreams = (streams) => {
        const normalizedStreams = (streams || []).map((stream) => ({
            url: stream.url || stream.source || '',
            type: stream.type || 'HLS',
            headers: stream.headers || {},
            mediaInfo: stream.mediaInfo || null
        })).filter((stream) => stream.url);

        const manifestStreams = normalizedStreams.filter((stream) => isLikelyManifestUrl(stream.url));
        const filtered = manifestStreams.length > 0
            ? manifestStreams
            : normalizedStreams.filter((stream) => !isIgnoredTrackerUrl(stream.url));

        return dedupeBy(filtered, (stream) => stream.url);
    };

    const normalizeLicenses = (licenses) => dedupeBy(
        (licenses || []).filter((license) => license && license.url),
        (license) => license.url
    );

    const normalizeKeys = (keys) => dedupeBy(
        (keys || []).filter((key) => key && (key.kid || key.key)),
        (key) => `${key.kid || ''}:${key.key || ''}`
    );

    const decodeCookiesHeader = (cookiesB64) => {
        if (!cookiesB64 || typeof cookiesB64 !== 'string') {
            return '';
        }

        try {
            const cookieJson = atob(cookiesB64);
            const cookieDict = JSON.parse(cookieJson);
            if (!cookieDict || typeof cookieDict !== 'object') {
                return '';
            }

            return Object.entries(cookieDict)
                .filter(([name, value]) => {
                    const normalized = String(name || '').toLowerCase();
                    return normalized && !normalized.includes('experiment') && value !== undefined && value !== null;
                })
                .map(([name, value]) => `${name}=${value}`)
                .join('; ');
        } catch (_error) {
            return '';
        }
    };

    const sanitizeHeaders = (headers = {}, options = {}) => {
        const includeCookie = options.includeCookie !== false;
        const nextHeaders = {};

        for (const [name, value] of Object.entries(headers || {})) {
            const normalizedName = String(name || '').trim();
            const normalizedValue = typeof value === 'string' ? value.trim() : '';
            if (!normalizedName || !normalizedValue) {
                continue;
            }

            const lowerName = normalizedName.toLowerCase();
            if (lowerName === 'cookie' && !includeCookie) {
                continue;
            }

            if ([
                'user-agent',
                'referer',
                'origin',
                'cookie',
                'authorization',
                'x-requested-with',
                'accept',
                'accept-language',
                'content-type',
                'sec-ch-ua',
                'sec-ch-ua-mobile',
                'sec-ch-ua-platform',
                'sec-fetch-dest',
                'sec-fetch-mode',
                'sec-fetch-site',
                'x-license-url',
                'x-drm-key',
            ].includes(lowerName)) {
                nextHeaders[normalizedName] = normalizedValue;
            }
        }

        return nextHeaders;
    };

    const trimMediaInfo = (mediaInfo) => {
        if (!mediaInfo || typeof mediaInfo !== 'object') {
            return null;
        }

        const trimmed = {};
        if (typeof mediaInfo.variants_count === 'number') {
            trimmed.variants_count = mediaInfo.variants_count;
        } else if (Array.isArray(mediaInfo.variants)) {
            trimmed.variants_count = mediaInfo.variants.length;
        }
        if (typeof mediaInfo.pssh === 'string' && mediaInfo.pssh.trim()) {
            trimmed.pssh = mediaInfo.pssh.trim();
        }
        if (typeof mediaInfo.bandwidth === 'number') {
            trimmed.bandwidth = mediaInfo.bandwidth;
        }
        if (typeof mediaInfo.resolution === 'string' && mediaInfo.resolution.trim()) {
            trimmed.resolution = mediaInfo.resolution.trim();
        }
        if (mediaInfo.has_audio_renditions) {
            trimmed.has_audio_renditions = true;
        }
        if (typeof mediaInfo.audio_track_count === 'number') {
            trimmed.audio_track_count = mediaInfo.audio_track_count;
        }
        if (Array.isArray(mediaInfo.audio_tracks) && mediaInfo.audio_tracks.length > 0) {
            trimmed.audio_tracks = mediaInfo.audio_tracks
                .filter((track) => track && track.url)
                .slice(0, 4)
                .map((track) => ({
                    url: track.url,
                    group_id: track.group_id || null,
                    name: track.name || null,
                    language: track.language || null,
                    channels: track.channels || null,
                    autoselect: Boolean(track.autoselect),
                    default: Boolean(track.default)
                }));
        }
        return Object.keys(trimmed).length > 0 ? trimmed : null;
    };

    const selectPrimaryStream = (streams) => {
        for (const stream of streams) {
            const mediaInfo = stream.mediaInfo || {};
            const variantsCount = mediaInfo.variants_count || (Array.isArray(mediaInfo.variants) ? mediaInfo.variants.length : 0);
            if ((stream.url && stream.url.includes('playlist')) || variantsCount > 0) {
                return stream;
            }
        }

        return streams[0] || null;
    };

    const buildSanitizedPagePackage = (rawPackage) => {
        const streams = normalizeCapturedStreams(rawPackage?.streams || relayState.streams || []);
        const primaryStream = selectPrimaryStream(streams);
        const cookieHeader = decodeCookiesHeader(rawPackage?.cookies_b64);
        const primaryHeaders = sanitizeHeaders(primaryStream ? (primaryStream.headers || {}) : (rawPackage?.headers || {}));
        if (cookieHeader && !primaryHeaders.Cookie && !primaryHeaders.cookie) {
            primaryHeaders.Cookie = cookieHeader;
        }
        const relayStreams = streams.map((stream) => {
            const streamHeaders = sanitizeHeaders(stream.headers || {});
            if (cookieHeader && !streamHeaders.Cookie && !streamHeaders.cookie) {
                streamHeaders.Cookie = cookieHeader;
            }
            return {
                source: stream.url,
                type: stream.type,
                headers: streamHeaders,
                mediaInfo: trimMediaInfo(stream.mediaInfo)
            };
        });

        const relayLicenses = normalizeLicenses(rawPackage?.licenses || relayState.licenses || [])
            .slice(0, 2)
            .map((license) => {
                const licenseHeaders = sanitizeHeaders(license.headers || {});
                if (cookieHeader && !licenseHeaders.Cookie && !licenseHeaders.cookie) {
                    licenseHeaders.Cookie = cookieHeader;
                }
                return {
                    url: license.url,
                    headers: licenseHeaders,
                    timestamp: license.timestamp
                };
            });

        return {
            mode: 'echo',
            page_url: tab.url,
            source: primaryStream ? primaryStream.url : (rawPackage?.source || ''),
            headers: primaryHeaders,
            timestamp: rawPackage?.timestamp || Date.now(),
            streams_detected: streams.length,
            streams: relayStreams,
            licenses: relayLicenses,
            keys: normalizeKeys(rawPackage?.keys || []).slice(0, 8).map((key) => ({
                kid: key.kid || '',
                key: key.key || '',
                session: key.session || null
            }))
        };
    };

    const buildRelayPayload = (selectedUrl, selectedHeaders, label) => {
        const pagePackage = buildSanitizedPagePackage(relayState.pagePackage);
        const payload = {
            ...pagePackage,
            mode: 'echo',
            source: selectedUrl || pagePackage.source || '',
            headers: selectedHeaders || pagePackage.headers || {},
            page_url: tab.url,
            note: label || null
        };
        output.value = JSON.stringify(payload, null, 2);
        return payload;
    };

    const buildRelayMetadata = (relayTitle) => ({
        title: relayTitle,
        description: tab.url
    });

    const buildRelayWorkerStub = (relayPayload) => ({
        mode: 'echo',
        page_url: relayPayload.page_url || tab.url,
        source: relayPayload.source || '',
        note: relayPayload.note || null,
        timestamp: relayPayload.timestamp || Date.now(),
        relay_override: true,
        relay_override_updated_at: Date.now(),
        streams_detected: relayPayload.streams_detected || 0,
        streams: (relayPayload.streams || []).slice(0, 1).map((stream) => ({
            source: stream.source,
            type: stream.type,
            mediaInfo: trimMediaInfo(stream.mediaInfo)
        })),
        headers: {},
        licenses: [],
        keys: []
    });

    const syncRelayConfigToStreamServ = async (relayPayload, metadata) => {
        const response = await fetch(`${config.STREAMSERV_API_BASE_URL}/archive-api/relay-config`, {
            method: 'POST',
            headers: buildApiHeaders({
                'Content-Type': 'application/json',
            }),
            body: JSON.stringify({
                pid: 'relay',
                action: 'start',
                streamConfig: relayPayload,
                metadata,
            }),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`StreamServ relay sync failed: ${response.status} ${text}`);
        }

        return response.json();
    };

    const copyRelayPayload = (selectedUrl, selectedHeaders, label) => {
        buildRelayPayload(selectedUrl, selectedHeaders, label);
        output.select();
        document.execCommand('copy');
        setStatus(`📋 Copied relay package: ${label}`, 'info');
    };

    const loginAdmin = async () => {
        const response = await fetch(`${config.API_BASE_URL}/api/auth/login`, {
            method: 'POST',
            credentials: 'include',
            headers: buildApiHeaders({
                'Content-Type': 'application/json'
            }),
            body: JSON.stringify({
                username: config.ADMIN_USER,
                password: config.ADMIN_PASS
            })
        });
        if (!response.ok) {
            throw new Error(`Admin login failed: ${response.status}`);
        }
    };

    const sendRelayPayload = async (selectedUrl, selectedHeaders, label) => {
        const relayPayload = buildRelayPayload(selectedUrl, selectedHeaders, label);
        const relayTitle = relayTitleInput?.value?.trim() || tab.title || 'Relay';
        const relayMetadata = buildRelayMetadata(relayTitle);
        const relayWorkerStub = buildRelayWorkerStub(relayPayload);

        setStatus('Syncing relay package to StreamServ...', 'info');
        await syncRelayConfigToStreamServ(relayPayload, relayMetadata);

        setStatus('Relay package synced. Updating dashboard...', 'info');

        await loginAdmin();

        const response = await fetch(`${config.API_BASE_URL}/api/players/relay/relay`, {
            method: 'POST',
            credentials: 'include',
            headers: buildApiHeaders({
                'Content-Type': 'application/json',
            }),
            body: JSON.stringify({
                action: 'start',
                streamConfig: relayWorkerStub,
                metadata: relayMetadata
            })
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Relay sync failed: ${response.status} ${text}`);
        }

        await response.json();
        setStatus(`✅ Relay synced: ${label}`, 'success');
    };

    copyRelayPackageButton.addEventListener('click', async () => {
        await refreshRelayState();
        if (!relayState.pagePackage) {
            setStatus('No DRM relay package available yet.', 'error');
            return;
        }
        copyRelayPayload(null, null, 'Full Page Package');
    });

    sendRelayButton.addEventListener('click', async () => {
        await refreshRelayState();
        if (!relayState.pagePackage) {
            setStatus('No DRM relay package available yet.', 'error');
            return;
        }
        try {
            await sendRelayPayload(null, null, 'Full Page Package');
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Relay sync failed', 'error');
        }
    });

    await refreshRelayState();
    const streams = relayState.streams;
    const licenses = relayState.licenses;

    if (relayState.pagePackage) {
        buildRelayPayload(null, null, 'Full Page Package');
    }

        // Always show Base URL for context
        const baseUrlContainer = document.createElement('div');
        baseUrlContainer.style.fontSize = "10px";
        baseUrlContainer.style.color = "#888";
        baseUrlContainer.style.marginBottom = "5px";
        baseUrlContainer.textContent = `Page Context: ${new URL(tab.url).origin}`;
        document.body.insertBefore(baseUrlContainer, output);

    if (streams.length === 0 && licenses.length === 0) {
        setStatus('No Media/DRM detected. Refresh or play.', 'error');
        return;
    }

    const keysCount = relayState.pagePackage?.keys?.length || 0;
    setStatus(`Captured: ${streams.length} Stream(s), ${licenses.length} License(s), ${keysCount} Key(s)`, 'info');

    const list = document.createElement('div');
    list.id = 'streamList';
    list.style.maxHeight = "200px";
    list.style.overflowY = "auto";
    list.style.marginBottom = "8px";

    streams.forEach((stream, idx) => {
        const container = document.createElement('div');
        container.style.marginBottom = "8px";
        container.style.padding = "6px";
        container.style.border = "1px solid #ddd";
        container.style.borderRadius = "4px";

        const header = document.createElement('div');
        header.style.display = "flex";
        header.style.justifyContent = "space-between";
        header.style.alignItems = "center";

        const label = document.createElement('span');
        label.style.fontSize = "11px";
        label.style.fontWeight = "bold";
        label.textContent = `[${stream.type}] ${stream.url.substring(0, 40)}...`;

        const buttonGroup = document.createElement('div');
        buttonGroup.style.display = 'flex';
        buttonGroup.style.gap = '4px';

        const copyBtn = document.createElement('button');
        copyBtn.style.fontSize = "10px";
        copyBtn.style.padding = "2px 6px";
        copyBtn.style.width = "auto";
        copyBtn.style.marginBottom = "0";
        copyBtn.textContent = "Copy";
        copyBtn.onclick = () => copyRelayPayload(stream.url, stream.headers || {}, `Stream ${idx + 1}`);

        const sendBtn = document.createElement('button');
        sendBtn.style.fontSize = "10px";
        sendBtn.style.padding = "2px 6px";
        sendBtn.style.width = "auto";
        sendBtn.style.marginBottom = "0";
        sendBtn.textContent = "Relay";
        sendBtn.onclick = async () => {
            try {
                await sendRelayPayload(stream.url, stream.headers || {}, `Stream ${idx + 1}`);
            } catch (error) {
                status.textContent = error instanceof Error ? error.message : 'Relay sync failed';
            }
        };

        buttonGroup.appendChild(copyBtn);
        buttonGroup.appendChild(sendBtn);
        header.appendChild(label);
        header.appendChild(buttonGroup);
        container.appendChild(header);

        // Show variants if available
        if (stream.mediaInfo && stream.mediaInfo.variants && stream.mediaInfo.variants.length > 0) {
            const variantList = document.createElement('div');
            variantList.style.marginTop = "4px";

            stream.mediaInfo.variants.forEach(v => {
                const vBtn = document.createElement('button');
                vBtn.style.fontSize = "9px";
                vBtn.style.padding = "2px 4px";
                vBtn.style.width = "auto";
                vBtn.style.backgroundColor = "#f9f9f9";
                vBtn.style.marginBottom = "2px";
                vBtn.textContent = `${v.resolution} (${(v.bandwidth / 1000).toFixed(0)}k)`;

                vBtn.onclick = (e) => {
                    e.stopPropagation();
                    copyRelayPayload(v.url, stream.headers || {}, `${v.resolution} | ${v.bandwidth}`);
                };

                vBtn.onmouseover = () => vBtn.style.backgroundColor = "#e9ecef";
                vBtn.onmouseout = () => vBtn.style.backgroundColor = "#f9f9f9";

                variantList.appendChild(vBtn);
            });
            container.appendChild(variantList);
        }

        container.appendChild(document.createElement('div'));
        list.appendChild(container);
    });

    // Also list Licenses separately if needed
    if (licenses.length > 0) {
        const licHeader = document.createElement('div');
        licHeader.textContent = "--- Detected Licenses ---";
        licHeader.style.fontSize = "10px";
        licHeader.style.fontWeight = "bold";
        licHeader.style.marginTop = "10px";
        list.appendChild(licHeader);

        licenses.forEach((lic) => {
            const lBox = document.createElement('div');
            lBox.style.fontSize = "9px";
            lBox.style.color = "#d9534f";
            lBox.textContent = `License: ${lic.url.substring(0, 40)}...`;
            list.appendChild(lBox);
        });
    }

    document.body.insertBefore(list, output);
});

document.getElementById('capture').addEventListener('click', async () => {
    const output = document.getElementById('output');
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const result = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => ({ ua: navigator.userAgent, ref: document.referrer })
        });
        const r = result[0].result;
        const cookies = await chrome.cookies.getAll({ url: tab.url });
        const cStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

        const h = { "User-Agent": r.ua, "Referer": r.ref || tab.url, "Cookie": cStr };
        output.value = JSON.stringify({ source: "", page_url: tab.url, headers: h }, null, 2);
        output.select();
        document.execCommand('copy');
    } catch (e) { }
});
