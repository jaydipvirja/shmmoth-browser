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

// Only used if navigator.userAgent has no Chrome/<major> token; normally the UA already carries the engine version.
const FALLBACK_CHROME_MAJOR = String((typeof process !== 'undefined' && process.versions && process.versions.chrome) || '130').split('.')[0];

// Align navigator.userAgentData with genuine Google Chrome in the webpage's main world
// This ensures Google Account login (botguard / GlifWebSignIn) does not detect embedded Chromium.
try {
  webFrame.executeJavaScriptInIsolatedWorld(0, [{
    code: `
      try {
        if (navigator.userAgentData) {
          const ua = navigator.userAgent || '';
          const isAndroid = ua.includes('Android');
          const chromeVersion = (ua.match(/Chrome\\/(\\d+)/) || [])[1] || '${FALLBACK_CHROME_MAJOR}';
          const chromeBrands = [
            { brand: 'Chromium', version: chromeVersion },
            { brand: 'Google Chrome', version: chromeVersion },
            { brand: 'Not?A_Brand', version: '99' }
          ];

          const proto = Object.getPrototypeOf(navigator.userAgentData);
          if (proto) {
            Object.defineProperty(proto, 'brands', {
              get: () => chromeBrands,
              configurable: true
            });
            if (isAndroid) {
              Object.defineProperty(proto, 'mobile', {
                get: () => true,
                configurable: true
              });
              Object.defineProperty(proto, 'platform', {
                get: () => 'Android',
                configurable: true
              });
            }
          }

          if (navigator.userAgentData.getHighEntropyValues) {
            const origGetHighEntropyValues = navigator.userAgentData.getHighEntropyValues;
            navigator.userAgentData.getHighEntropyValues = async function(hints) {
              const res = await origGetHighEntropyValues.call(this, hints);
              const copy = Object.assign({}, res);
              if (chromeBrands) copy.brands = chromeBrands;
              if (isAndroid) {
                if ('mobile' in copy) copy.mobile = true;
                if ('platform' in copy) copy.platform = 'Android';
                if ('platformVersion' in copy) copy.platformVersion = '14.0.0';
                if ('model' in copy) copy.model = 'Pixel 8';
              }
              return copy;
            };
          }
        }
      } catch (_) {}
    `
  }]);
} catch (_) {}

// External web pages have zero access to privileged browser APIs.
// window.mtcAPI and window.shmmothAPI are intentionally NOT defined for external pages.
