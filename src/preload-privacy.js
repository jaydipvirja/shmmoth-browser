// Runs in EVERY frame of every web page (registered by browser/network.js with session.registerPreloadScript, type
// "frame"). It asks the browser what this page gets before its own scripts run (services/privacyShield.js
// pageScripts): navigator.globalPrivacyControl (Global Privacy Control) and fingerprinting protection with this site's
// seed (services/fingerprintShield.js). webFrame.executeJavaScript runs them in the page itself, before the page's
// own scripts. A sandboxed preload cannot load other files, so the browser sends the code.
'use strict';
const { ipcRenderer, webFrame } = require('electron');

try {
  const href = String(location.href || '');
  if (/^https?:|^about:blank/i.test(href)) {
    const scripts = ipcRenderer.sendSync('shmmoth:privacy-page', href);
    if (Array.isArray(scripts)) {
      for (const code of scripts) {
        if (typeof code === 'string' && code) webFrame.executeJavaScript(code).catch(() => {});
      }
    }
  }
} catch (_) { /* the request headers still protect the page */ }
