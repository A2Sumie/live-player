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

    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    const sendMessage = (message) => new Promise((resolve) => {
        chrome.runtime.sendMessage(message, (response) => resolve(response || {}));
    });

    const relayState = {
        streams: [],
        licenses: [],
        pagePackage: null
    };

    const buildRelayPayload = (selectedUrl, selectedHeaders, label) => {
        const pagePackage = relayState.pagePackage || {};
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

    const copyRelayPayload = (selectedUrl, selectedHeaders, label) => {
        buildRelayPayload(selectedUrl, selectedHeaders, label);
        output.select();
        document.execCommand('copy');
        status.textContent = `📋 Copied relay package: ${label}`;
    };

    const loginAdmin = async () => {
        const response = await fetch(`${config.API_BASE_URL}/api/auth/login`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            },
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
        status.textContent = 'Sending relay package...';

        await loginAdmin();

        const response = await fetch(`${config.API_BASE_URL}/api/players/relay/relay`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                action: 'start',
                streamConfig: relayPayload,
                metadata: {
                    title: tab.title || 'Relay',
                    description: tab.url,
                    coverUrl: tab.favIconUrl || null
                }
            })
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Relay sync failed: ${response.status} ${text}`);
        }

        status.textContent = `✅ Relay synced: ${label}`;
    };

    copyRelayPackageButton.addEventListener('click', () => {
        if (!relayState.pagePackage) {
            status.textContent = 'No DRM relay package available yet.';
            return;
        }
        copyRelayPayload(null, null, 'Full Page Package');
    });

    sendRelayButton.addEventListener('click', async () => {
        if (!relayState.pagePackage) {
            status.textContent = 'No DRM relay package available yet.';
            return;
        }
        try {
            await sendRelayPayload(null, null, 'Full Page Package');
        } catch (error) {
            status.textContent = error instanceof Error ? error.message : 'Relay sync failed';
        }
    });

    const [streamResponse, pagePackageResponse] = await Promise.all([
        sendMessage({ action: 'getStreams', tabId: tab.id }),
        sendMessage({ action: 'getPageDRMPackage', tabId: tab.id, pageUrl: tab.url })
    ]);

    const streams = streamResponse.streams || [];
    const licenses = streamResponse.licenses || [];
    relayState.streams = streams;
    relayState.licenses = licenses;
    relayState.pagePackage = pagePackageResponse.package || null;

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
        status.textContent = "No Media/DRM detected. Refresh or play.";
        return;
    }

    const keysCount = relayState.pagePackage?.keys?.length || 0;
    status.textContent = `Captured: ${streams.length} Stream(s), ${licenses.length} License(s), ${keysCount} Key(s)`;

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
