/**
 * EXTERNAL WEB PRELOAD — preload-external.js
 *
 * Used for ALL external web content loaded in tab WebContentsViews:
 *   - Google, YouTube, GitHub, Reddit, and all other websites
 *
 * SECURITY POLICY:
 *   External web pages MUST NOT have access to any privileged browser APIs.
 *   This preload intentionally exposes NO privileged functionality.
 *
 *   External pages cannot access:
 *     ✗ Tab management (create, close, switch, navigate)
 *     ✗ History data
 *     ✗ Bookmarks data
 *     ✗ Storage / settings
 *     ✗ Filesystem
 *     ✗ IPC channels
 *     ✗ Session / cookies
 *     ✗ System APIs
 *     ✗ Window controls
 *
 * MINIMAL READ-ONLY EXPOSURE:
 *   Only non-privileged, informational data is exposed — nothing that
 *   can be used to interact with the browser application.
 */

const { webFrame } = require('electron');

// Align navigator.userAgentData with genuine Google Chrome in the webpage's main world
// This ensures Google Account login (botguard / GlifWebSignIn) does not detect embedded Chromium.
try {
  webFrame.executeJavaScriptInIsolatedWorld(0, [{
    code: `
      try {
        if (navigator.userAgentData && Array.isArray(navigator.userAgentData.brands)) {
          const chromeVersion = (navigator.userAgent.match(/Chrome\\/(\\d+)/) || [])[1] || '130';
          const chromeBrands = [
            { brand: 'Chromium', version: chromeVersion },
            { brand: 'Google Chrome', version: chromeVersion },
            { brand: 'Not?A_Brand', version: '99' }
          ];

          Object.defineProperty(Object.getPrototypeOf(navigator.userAgentData), 'brands', {
            get: () => chromeBrands,
            configurable: true
          });

          if (navigator.userAgentData.getHighEntropyValues) {
            const origGetHighEntropyValues = navigator.userAgentData.getHighEntropyValues;
            navigator.userAgentData.getHighEntropyValues = async function(hints) {
              const res = await origGetHighEntropyValues.call(this, hints);
              if (res && res.brands) res.brands = chromeBrands;
              return res;
            };
          }
        }
      } catch (_) {}
    `
  }]);
} catch (_) {}

// External web pages have zero access to privileged browser APIs.
// window.mtcAPI and window.shmmothAPI are intentionally NOT defined for external pages.
