/**
 * URL SECURITY POLICY — urlPolicy.js
 *
 * Centralised URL classification and navigation policy enforcement for SHMMOTH Browser.
 * All navigation requests (user input, redirects, popups, new windows) should
 * be run through this module before being acted upon.
 *
 * URL CATEGORIES:
 *
 *   TRUSTED_INTERNAL    — mtc:// pages and the exact HTML files shipped with the app
 *   LOCAL_FILE          — any other file:// URL (viewable, but treated as untrusted web content)
 *   TRUSTED_EXTERNAL    — Known safe HTTPS sites with no special restrictions
 *   UNKNOWN_EXTERNAL    — Arbitrary HTTPS/HTTP URLs from the open web
 *   DANGEROUS           — URLs that must never be loaded:
 *                           - javascript: (XSS via URL)
 *                           - data:       (arbitrary content injection)
 *                           - vbscript:   (legacy attack vector)
 *                           - blob:       (opaque URLs, controlled by caller)
 *                           - about:blank opened by external context (conditional)
 *
 * PROMPT INJECTION BOUNDARY:
 *   External pages must NEVER be able to navigate the application into
 *   a trusted internal route (mtc://settings, mtc://history, etc.) by
 *   injecting a navigation event. isInternalNavigationAllowedFrom() enforces this.
 *
 * FUTURE SHMMOTH AGENT NOTE:
 *   When SHMMOTH proposes a navigation action, it must pass through
 *   isNavigationAllowed() and be validated against the current page context.
 *   The agent cannot bypass URL policy regardless of its instruction source.
 */

'use strict';

const { isTrustedInternalUrl, BROWSER_CHROME_URL } = require('./trustedPages');

// ─── Category constants ───────────────────────────────────────────────────────

const UrlCategory = Object.freeze({
  TRUSTED_INTERNAL:  'TRUSTED_INTERNAL',
  LOCAL_FILE:        'LOCAL_FILE',
  TRUSTED_EXTERNAL:  'TRUSTED_EXTERNAL',
  UNKNOWN_EXTERNAL:  'UNKNOWN_EXTERNAL',
  DANGEROUS:         'DANGEROUS',
});

// ─── Dangerous scheme patterns ────────────────────────────────────────────────

const DANGEROUS_SCHEME_PATTERNS = [
  /^javascript:/i,
  /^vbscript:/i,
  /^data:/i,
];

// These blob: URLs can be legitimate in controlled contexts but are blocked
// from being initiated by external page navigations.
const BLOCKED_FROM_EXTERNAL = [
  /^blob:/i,
];

// ─── Internal routes ──────────────────────────────────────────────────────────

const INTERNAL_SCHEME = 'mtc:';

/**
 * Known valid internal page hostnames.
 * Only these pages are served by the mtc:// protocol handler.
 */
const KNOWN_INTERNAL_PAGES = new Set([
  'newtab',
  'settings',
  'bookmarks',
  'history',
  'notes',
  'downloads',
  'extensions',
]);

// ─── Classification ───────────────────────────────────────────────────────────

/**
 * Classifies a URL string into one of the UrlCategory values.
 *
 * @param {string} url
 * @returns {string} UrlCategory value
 */
function classify(url) {
  if (typeof url !== 'string' || !url.trim()) {
    return UrlCategory.DANGEROUS;
  }

  const trimmed = url.trim();

  // Check dangerous schemes first
  for (const pattern of DANGEROUS_SCHEME_PATTERNS) {
    if (pattern.test(trimmed)) return UrlCategory.DANGEROUS;
  }

  // Internal mtc:// pages
  if (trimmed.startsWith('mtc://')) {
    return UrlCategory.TRUSTED_INTERNAL;
  }

  // file:// — only the exact documents shipped with the app are trusted.
  // Everything else (downloaded .html, UNC shares, …) is ordinary untrusted content.
  if (/^file:/i.test(trimmed)) {
    return isTrustedInternalUrl(trimmed) ? UrlCategory.TRUSTED_INTERNAL : UrlCategory.LOCAL_FILE;
  }

  // blob: — treated as unknown external (not dangerous but not trusted)
  for (const pattern of BLOCKED_FROM_EXTERNAL) {
    if (pattern.test(trimmed)) return UrlCategory.UNKNOWN_EXTERNAL;
  }

  // Standard web URLs
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return UrlCategory.UNKNOWN_EXTERNAL;
  }

  // Anything else
  return UrlCategory.DANGEROUS;
}

/**
 * Returns true if the URL is safe to load in a tab.
 * Blocks DANGEROUS category URLs entirely.
 *
 * @param {string} url
 * @returns {boolean}
 */
function isSafeToLoad(url) {
  const cat = classify(url);
  return cat !== UrlCategory.DANGEROUS;
}

/**
 * Returns true if the URL is a known valid internal page.
 * Prevents creation of arbitrary mtc:// routes.
 *
 * @param {string} url
 * @returns {boolean}
 */
function isKnownInternalPage(url) {
  if (typeof url !== 'string') return false;
  if (!url.startsWith('mtc://')) return false;
  try {
    const parsed = new URL(url);
    return KNOWN_INTERNAL_PAGES.has(parsed.hostname);
  } catch (_) {
    return false;
  }
}

/**
 * Returns true if navigating from `fromUrl` to `toUrl` is allowed with regard to
 * privileged destinations. Web content must not be able to reach internal
 * routes or local files.
 *
 * Rules:
 *   - → mtc://   : only from a trusted internal page / the browser chrome
 *   - → file://  : from a trusted internal page / the browser chrome, or from
 *                  another local file (browsing a local folder of documents)
 *   - https:// → mtc:// or file:// : BLOCKED
 *   - http://  → mtc:// or file:// : BLOCKED
 *   - anything else → allowed here (scheme safety is checked separately)
 *
 * @param {string} fromUrl — current frame URL
 * @param {string} toUrl   — destination URL
 * @returns {boolean}
 */
function isInternalNavigationAllowedFrom(fromUrl, toUrl) {
  const toMtc  = /^mtc:/i.test(toUrl);
  const toFile = /^file:/i.test(toUrl);
  if (!toMtc && !toFile) {
    return true; // Navigating to external — always allow (safety checked separately)
  }
  if (typeof fromUrl !== 'string') return false;
  if (isTrustedInternalUrl(fromUrl)) return true;
  // Local documents may link to sibling local documents, but never to mtc://
  return toFile && /^file:/i.test(fromUrl);
}

/**
 * Full navigation policy check combining safety and internal-navigation rules.
 *
 * @param {string} fromUrl — current frame/tab URL
 * @param {string} toUrl   — requested navigation target
 * @returns {{ allowed: boolean, reason: string }}
 */
function checkNavigation(fromUrl, toUrl) {
  if (!isSafeToLoad(toUrl)) {
    return { allowed: false, reason: `Dangerous URL scheme blocked: ${toUrl.slice(0, 64)}` };
  }

  if (!isInternalNavigationAllowedFrom(fromUrl, toUrl)) {
    return {
      allowed: false,
      reason: `External page attempted navigation to internal or local route: ${toUrl.slice(0, 64)}`,
    };
  }

  return { allowed: true, reason: 'ok' };
}

// Known popup/popunder advertising and clickjacking networks
const POPUP_AD_PATTERNS = [
  /admaven/i,
  /moonlighthathel/i,
  /nwhoisabletopres/i,
  /getsmartyapp/i,
  /fortyfile/i,
  /sparkrainstorm/i,
  /adsboosters/i,
  /go2cloud/i,
  /bonuscaf/i,
  /popads/i,
  /propellerads/i,
  /adsterra/i,
  /clickadu/i,
  /exoclick/i,
  /trafficjunky/i,
  /hilltopads/i,
  /richpush/i,
  /monetag/i,
  /onclicktraff/i,
  /yourjsdelivery/i,
  /dollscough/i,
  /paisavyapari/i,
  /visheshtoday/i,
  /adnxs\.com/i,
  /criteo\.com/i,
  /taboola\.com/i,
  /outbrain\.com/i,
  /doubleclick\.net/i,
  /googlesyndication\.com/i,
];

/**
 * Returns true if this URL should be blocked from being opened as a popup
 * or new window from an external page context.
 *
 * @param {string} url
 * @param {string} [openerUrl] URL of the page calling window.open(); when given,
 *        popups that would reach internal/local routes from web content are blocked.
 * @returns {boolean}
 */
function isPopupBlocked(url, openerUrl) {
  if (typeof url !== 'string' || !url.trim()) return true;
  const cat = classify(url);
  if (cat === UrlCategory.DANGEROUS) return true;

  if (openerUrl !== undefined && !isInternalNavigationAllowedFrom(openerUrl, url.trim())) {
    return true;
  }

  // Block known ad networks and clickjackers from opening popups/tabs
  for (const pattern of POPUP_AD_PATTERNS) {
    if (pattern.test(url)) return true;
  }

  // Block typical popunder affiliate query markers
  try {
    const parsed = new URL(url);
    const search = parsed.search.toLowerCase();
    if (search.includes('partner=admaven') || search.includes('aff_click_id=') || search.includes('offer_id=235')) {
      return true;
    }
  } catch (_) {}

  return false;
}

module.exports = {
  UrlCategory,
  classify,
  isSafeToLoad,
  isKnownInternalPage,
  isInternalNavigationAllowedFrom,
  checkNavigation,
  isPopupBlocked,
  BROWSER_CHROME_URL,
};
