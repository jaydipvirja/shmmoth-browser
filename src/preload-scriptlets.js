// Runs in EVERY frame of every web page while the ad blocker is on (registered by services/adblocker.js with
// session.registerPreloadScript, type "frame").
// uBlock Origin's scriptlets (the `##+js(...)` rules of the filter lists: set-constant, json-prune, ...) patch what a
// page's own scripts are about to read, so they must run BEFORE those scripts. A preload script runs before anything of
// the page, and webFrame.executeJavaScript runs its code in the page itself (not in this isolated world) at once. The
// browser answers with nothing for its own pages, when the blocker is off, or when it is paused for the site.
'use strict';
const { ipcRenderer, webFrame } = require('electron');

try {
  const href = String(location.href || '');
  if (/^https?:/i.test(href)) {
    const scripts = ipcRenderer.sendSync('shmmoth:adblock-scriptlets', href);
    if (Array.isArray(scripts)) {
      for (const code of scripts) {
        if (typeof code === 'string' && code) webFrame.executeJavaScript(code).catch(() => {});
      }
    }
  }
} catch (_) { /* a frame without scriptlets still works, only with more ads */ }
