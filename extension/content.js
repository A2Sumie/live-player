/* content.js */

// Relay messages from Page Context (WidevineCrypto) to Background
window.addEventListener("PassToBackground", function (evt) {
    chrome.runtime.sendMessage(evt.detail.item, response => {
        // If response is undefined/null, make sure we pass generic null/object to avoid errors
        var val = response ? response.value : null;
        var event = new CustomEvent("BackgroundReply_" + evt.detail.id, { detail: val });
        window.dispatchEvent(event);
    });
}, false);

// Listen for exfiltrated keys from content_key_decryption.js
window.addEventListener("WidevineKeyFound", function (evt) {
    console.log("[Content] Widevine Key Found:", evt.detail);
    chrome.runtime.sendMessage({
        action: "widevineKeyFound",
        data: evt.detail
    });
}, false);

// Inject Scripts into Page Context
async function injectScripts() {
    const scripts = [
        'lib/pbf.3.0.5.min.js',
        'lib/cryptojs-aes_0.2.0.min.js',
        'protobuf-generated/license_protocol.proto.js',
        'content_key_decryption.js',
        'eme_interception.js'
    ];

    for (const script of scripts) {
        await injectScript(script);
    }
}

function injectScript(scriptName) {
    return new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = chrome.runtime.getURL(scriptName);
        s.onload = function () {
            this.parentNode.removeChild(this);
            resolve(true);
        };
        s.onerror = function () {
            console.error("Failed to load script: " + scriptName);
            reject();
        }
            (document.head || document.documentElement).appendChild(s);
    });
}

injectScripts();
