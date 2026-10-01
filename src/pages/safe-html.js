/**
 * SAFE HTML HELPERS — safe-html.js
 *
 * Shared by the browser chrome (renderer/) and every mtc:// page.
 *
 * Why this exists: page titles, URLs, favicon URLs, cookie names … all come
 * from untrusted websites, and these pages have access to the privileged
 * window.mtcAPI. The previous per-file helper used
 * `div.textContent = x; return div.innerHTML`, which does NOT escape quotes,
 * so a title such as   x" autofocus tabindex=0 onfocus="…"   broke out of a
 * `title="…"` attribute and ran script with full browser privileges.
 *
 * Rules for callers:
 *   - Put untrusted text into the DOM with textContent / setAttribute when you can.
 *   - When building markup strings, wrap EVERY untrusted value in escapeHtml().
 *   - Never use inline event-handler attributes (onerror=…); the mtc:// CSP
 *     forbids them. For image fallbacks use  <img data-fallback="🌐">.
 */
(function (root) {
  'use strict';

  var ENTITIES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '`': '&#96;'
  };

  /**
   * Escapes a value for safe use both as element text and inside a quoted
   * (single or double) HTML attribute value.
   * @param {*} value
   * @returns {string}
   */
  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"'`]/g, function (ch) { return ENTITIES[ch]; });
  }

  var api = { escapeHtml: escapeHtml };

  // Node (unit tests)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  // Browser
  if (root && root.document) {
    root.escapeHtml = escapeHtml;

    // Image fallback without inline handlers (CSP-safe). Markup:
    //   <img src="…" data-fallback="🌐">
    // `error` events do not bubble, so listen in the capture phase on document.
    root.document.addEventListener('error', function (event) {
      var el = event.target;
      if (!el || el.tagName !== 'IMG' || !el.hasAttribute('data-fallback')) return;
      var parent = el.parentElement;
      if (parent) parent.textContent = el.getAttribute('data-fallback');
    }, true);
  }
})(typeof window !== 'undefined' ? window : null);
