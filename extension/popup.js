// popup.js - Detection & Copy

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

        // Always build and display comprehensive package (not just for DRM)
        chrome.runtime.sendMessage({
            action: 'getPageDRMPackage',
            tabId: tab.id,
            pageUrl: tab.url
        }, (response) => {
            if (response.package) {
                const jsonStr = JSON.stringify(response.package, null, 2);
                output.value = jsonStr;

                // Update status
                status.textContent = `📦 Ready: ${streams.length} stream(s), ${licenses.length} license(s), cookies included`;
                if (licenses.length > 0) {
                    status.style.color = '#d9534f'; // Red for DRM
                } else {
                    status.style.color = '#28a745'; // Green for normal
                }
            }
        });

        // Single comprehensive export button
        const exportBtn = document.createElement('button');
        exportBtn.textContent = '📋 Copy Comprehensive Package';
        exportBtn.style.width = '100%';
        exportBtn.style.marginTop = '10px';
        exportBtn.style.marginBottom = '10px';
        exportBtn.style.backgroundColor = licenses.length > 0 ? '#d9534f' : '#28a745';
        exportBtn.style.color = 'white';
        exportBtn.style.padding = '10px';
        exportBtn.style.border = 'none';
        exportBtn.style.borderRadius = '4px';
        exportBtn.style.cursor = 'pointer';
        exportBtn.style.fontWeight = 'bold';

        exportBtn.onclick = () => {
            output.select();
            document.execCommand('copy');
            status.textContent = `✅ Copied! (${streams.length} streams, ${licenses.length} licenses)`;
            status.style.color = '#5cb85c';
            exportBtn.textContent = '✅ Copied to Clipboard';
            setTimeout(() => {
                exportBtn.textContent = '📋 Copy Comprehensive Package';
            }, 2000);
        };

        document.body.insertBefore(exportBtn, output);

        const list = document.createElement('div');
        list.style.marginTop = '10px';
        list.style.marginBottom = '10px';

        // Render Streams
        streams.forEach((stream, index) => {
            const container = document.createElement('div');
            container.style.border = "1px solid #ddd";
            container.style.marginBottom = "5px";
            container.style.padding = "5px";
            container.style.borderRadius = "4px";
            container.style.cursor = "pointer";
            container.style.fontSize = "11px";

            // Title / Type
            const fileName = stream.url.split('?')[0].split('/').pop() || 'stream';
            const title = document.createElement('div');
            title.style.fontWeight = "bold";
            title.textContent = `[${stream.type || 'HLS'}] ${fileName}`;

            // Check if we have a matching license (simple heuristic: exist?)
            const matchingLicense = licenses.length > 0 ? licenses[licenses.length - 1] : null;
            if (matchingLicense) {
                const drmBadge = document.createElement('span');
                drmBadge.textContent = " + DRM KEY";
                drmBadge.style.color = "white";
                drmBadge.style.backgroundColor = "#d9534f";
                drmBadge.style.padding = "2px 4px";
                drmBadge.style.borderRadius = "3px";
                drmBadge.style.fontSize = "9px";
                drmBadge.style.marginLeft = "5px";
                title.appendChild(drmBadge);
            }

            container.appendChild(title);

            // Info
            const details = document.createElement('div');
            details.style.color = "#666";
            details.style.wordBreak = "break-all";
            details.textContent = stream.url.substring(0, 50) + "...";
            container.appendChild(details);

            // Create button container for actions
            const buttonContainer = document.createElement('div');
            buttonContainer.style.marginTop = '5px';
            buttonContainer.style.display = 'flex';
            buttonContainer.style.gap = '5px';

            // Function to generate and copy config
            const copyConfig = (variantUrl, label) => {
                let finalUrl = variantUrl || stream.url;
                const finalHeaders = { ...stream.headers };
                if (matchingLicense) {
                    // For Comprehensive Package structure, we use top-level License URL in 'licenses' array usually
                    // But for simple "Stream Config" object:
                    // We might need to conform to what auto_stream expects. 
                    // auto_stream expects licenses[] in new format or X-License-Url header in legacy.
                    finalHeaders['X-License-Url'] = matchingLicense.url;
                }

                // Construct the "Refined" object directly
                const configObj = {
                    mode: 'echo',
                    page_url: tab.url,
                    timestamp: Date.now(),
                    // Include cookies?
                    // cookies_b64: ... (requires full package call usually, simplifying here)
                    streams: [{
                        source: finalUrl,
                        type: stream.type,
                        headers: stream.headers,
                        label: label // e.g. "1920x1080 | 5000000"
                    }],
                    licenses: matchingLicense ? [matchingLicense] : [],
                    // If keys are known (e.g. from background detectedKeys), include them
                    keys: []
                };

                // Try to fetch keys from background context?
                // Note: popup.js has keys from getStreams response!
                // See line 13: const streams = response.streams || [];
                // response also has keys!
                if (response.keys && response.keys.length > 0) {
                    configObj.keys = response.keys;
                }

                const jsonStr = JSON.stringify(configObj, null, 2);
                output.value = jsonStr;
                output.select();
                document.execCommand('copy');
                status.textContent = `Copied ${label || 'Master'} Config`;
                status.style.color = 'green';
            };

            // Simple/Master Copy Button
            const simpleBtn = document.createElement('button');
            simpleBtn.textContent = 'Copy Master';
            simpleBtn.style.fontSize = '10px';
            simpleBtn.style.padding = '3px 8px';
            simpleBtn.style.flex = '1';
            simpleBtn.onclick = (e) => {
                e.stopPropagation();
                copyConfig(null, "Master");
            };
            buttonContainer.appendChild(simpleBtn);

            // Variants List (New Feature)
            if (stream.mediaInfo && stream.mediaInfo.variants && stream.mediaInfo.variants.length > 0) {
                const variantList = document.createElement('div');
                variantList.style.marginTop = "5px";
                variantList.style.borderTop = "1px dashed #eee";
                variantList.style.paddingTop = "5px";

                stream.mediaInfo.variants.forEach(v => {
                    const vBtn = document.createElement('div');
                    vBtn.style.fontSize = "10px";
                    vBtn.style.padding = "2px 5px";
                    vBtn.style.cursor = "pointer";
                    vBtn.style.display = "flex";
                    vBtn.style.justifyContent = "space-between";
                    vBtn.style.backgroundColor = "#f9f9f9";
                    vBtn.style.marginBottom = "2px";
                    vBtn.textContent = `${v.resolution} (${(v.bandwidth / 1000).toFixed(0)}k)`;

                    vBtn.onclick = (e) => {
                        e.stopPropagation();
                        copyConfig(v.url, `${v.resolution} | ${v.bandwidth}`);
                    };

                    // Hover effect
                    vBtn.onmouseover = () => vBtn.style.backgroundColor = "#e9ecef";
                    vBtn.onmouseout = () => vBtn.style.backgroundColor = "#f9f9f9";

                    variantList.appendChild(vBtn);
                });
                container.appendChild(variantList);
            }

            container.appendChild(buttonContainer);
            list.appendChild(container);
        });

        // Also list Licenses separately if needed?
        if (licenses.length > 0) {
            const licHeader = document.createElement('div');
            licHeader.textContent = "--- Detected Licenses ---";
            licHeader.style.fontSize = "10px";
            licHeader.style.fontWeight = "bold";
            licHeader.style.marginTop = "10px";
            list.appendChild(licHeader);

            licenses.forEach((lic, idx) => {
                const lBox = document.createElement('div');
                lBox.style.fontSize = "9px";
                lBox.style.color = "#d9534f";
                lBox.textContent = `License: ${lic.url.substring(0, 40)}...`;
                list.appendChild(lBox);
            });
        }

        // Insert list before output
        document.body.insertBefore(list, output);
    });

    // Manual Capture (Fallback)
    document.getElementById('capture').textContent = "Force Page Headers";
});

document.getElementById('capture').addEventListener('click', async () => {
    // ... existing manual capture ...
    // Shortened for brevity as it's not the main focus now
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
        output.value = JSON.stringify({ source: "", headers: h }, null, 2);
        output.select();
        document.execCommand('copy');
    } catch (e) { }
});
