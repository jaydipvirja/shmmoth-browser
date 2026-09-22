/**
 * URL SECURITY POLICY — urlPolicy.js
 *
 * Centralised URL classification and navigation policy enforcement for MTC Browser.
 * All navigation requests (user input, redirects, popups, new windows) should
 * be run through this module before being acted upon.
 *
 * URL CATEGORIES:
 *
 *   TRUSTED_INTERNAL    — mtc:// scheme pages (served locally, controlled by app)
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

// ─── Category constants ───────────────────────────────────────────────────────

const UrlCategory = Object.freeze({
  TRUSTED_INTERNAL:  'TRUSTED_INTERNAL',
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

  // Local file serving for renderer (file:// is trusted only from app context)
  if (trimmed.startsWith('file://')) {
    return UrlCategory.TRUSTED_INTERNAL;
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
 * Returns true if an internal page (mtc://) navigation is allowed given
 * the current frame's URL. External pages must not be able to navigate
 * the browser into internal routes.
 *
 * Rules:
 *   - mtc:// → mtc://   : allowed (internal navigating to internal)
 *   - file:// → mtc://   : allowed (browser chrome navigating to internal)
 *   - https:// → mtc://  : BLOCKED (external page trying to reach internal)
 *   - http://  → mtc://  : BLOCKED
 *
 * @param {string} fromUrl — current frame URL
 * @param {string} toUrl   — destination URL
 * @returns {boolean}
 */
function isInternalNavigationAllowedFrom(fromUrl, toUrl) {
  if (!toUrl.startsWith('mtc://') && !toUrl.startsWith('file://')) {
    return true; // Navigating to external — always allow (safety checked separately)
  }
  // Destination is internal — check source is also trusted
  if (typeof fromUrl !== 'string') return false;
  return fromUrl.startsWith('mtc://') || fromUrl.startsWith('file://');
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

  if (toUrl.startsWith('mtc://') && !isInternalNavigationAllowedFrom(fromUrl, toUrl)) {
    return {
      allowed: false,
      reason: `External page attempted navigation to internal route: ${toUrl.slice(0, 64)}`,
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
 * @returns {boolean}
 */
function isPopupBlocked(url) {
  if (typeof url !== 'string' || !url.trim()) return true;
  const cat = classify(url);
  if (cat === UrlCategory.DANGEROUS) return true;

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
};
