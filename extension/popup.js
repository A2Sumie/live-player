// popup.js - Detection & Copy
import { config } from './config.js';

// Open dashboard button
document.getElementById('openDashboard').addEventListener('click', () => {
    chrome.tabs.create({ url: config.API_BASE_URL });
});

document.addEventListener('DOMContentLoaded', async () => {
    const status = document.getElementById('status');
    const output = document.getElementById('output');

    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    // Ask background for streams
    chrome.runtime.sendMessage({ action: 'getStreams', tabId: tab.id }, (response) => {
        const streams = response.streams || [];
        const licenses = response.licenses || [];

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

        status.textContent = `Captured: ${streams.length} Stream(s), ${licenses.length} License(s)`;

        const list = document.createElement('div');
        list.id = 'streamList';
        list.style.maxHeight = "200px";
        list.style.overflowY = "auto";
        list.style.marginBottom = "8px";

        const copyConfig = (url, label) => {
            const pkg = {
                source: url,
                page_url: tab.url,
                headers: streams[0]?.headers || {}
            };
            output.value = JSON.stringify(pkg, null, 2);
            output.select();
            document.execCommand('copy');
            status.textContent = `📋 Copied: ${label}`;
        };

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

            const copyBtn = document.createElement('button');
            copyBtn.style.fontSize = "10px";
            copyBtn.style.padding = "2px 6px";
            copyBtn.style.width = "auto";
            copyBtn.style.marginBottom = "0";
            copyBtn.textContent = "Copy";
            copyBtn.onclick = () => copyConfig(stream.url, `Stream ${idx + 1}`);

            header.appendChild(label);
            header.appendChild(copyBtn);
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
                        copyConfig(v.url, `${v.resolution} | ${v.bandwidth}`);
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
