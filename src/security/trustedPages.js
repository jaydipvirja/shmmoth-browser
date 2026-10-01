/**
 * TRUSTED PAGES — trustedPages.js
 *
 * Single source of truth for "which documents are part of the browser itself
 * and may therefore use the privileged window.mtcAPI / IPC surface".
 *
 * A document is trusted only if it is:
 *   - served by our own mtc:// protocol handler, OR
 *   - one of the exact HTML files shipped inside the app (browser chrome and
 *     the native flyout bubbles), loaded through file://.
 *
 * Any other file:// URL (a downloaded .html, a file on a network share, …) is
 * ordinary web content and must never receive browser APIs.
 */

'use strict';

const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');

// <app>/src  (also correct inside app.asar, because it is derived from __dirname)
const SRC_ROOT = path.resolve(__dirname, '..');

/** HTML documents shipped with the app that are loaded via file:// */
const TRUSTED_FILES = Object.freeze([
  ['renderer', 'index.html'],
  ['pages', 'download-bubble.html'],
  ['pages', 'extension-bubble.html'],
  ['pages', 'shield-bubble.html'],
  ['pages', 'permission-bubble.html'],
  ['pages', 'password-bubble.html'],
]);

/**
 * @param {object} [opts]
 * @param {string} [opts.srcRoot]   directory that contains renderer/ and pages/
 * @param {string} [opts.platform]  'win32' enables Windows path semantics
 */
function createTrustedPageChecker({ srcRoot = SRC_ROOT, platform = process.platform } = {}) {
  const isWin = platform === 'win32';
  const p = isWin ? path.win32 : path.posix;
  const toKey = (s) => (isWin ? p.normalize(s).toLowerCase() : p.normalize(s));

  const allowedKeys = new Set(TRUSTED_FILES.map((parts) => toKey(p.join(srcRoot, ...parts))));

  /** True only for the exact shipped HTML files (query string / hash are ignored). */
  function isTrustedFileUrl(url) {
    if (typeof url !== 'string' || !url.startsWith('file:')) return false;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'file:') return false;
      // file://server/share/... (UNC) has a host — never trusted
      if (parsed.hostname !== '') return false;
      const filePath = fileURLToPath(parsed, { windows: isWin });
      return allowedKeys.has(toKey(filePath));
    } catch (_) {
      return false;
    }
  }

  /** mtc:// pages or one of the exact shipped file:// documents. */
  function isTrustedInternalUrl(url) {
    if (typeof url !== 'string') return false;
    if (url.startsWith('mtc://')) return true;
    return isTrustedFileUrl(url);
  }

  return { isTrustedFileUrl, isTrustedInternalUrl };
}

const defaultChecker = createTrustedPageChecker();

/** file:// URL of the browser chrome document (used as the origin of chrome-initiated navigations). */
const BROWSER_CHROME_URL = pathToFileURL(path.join(SRC_ROOT, 'renderer', 'index.html')).href;

module.exports = {
  SRC_ROOT,
  TRUSTED_FILES,
  BROWSER_CHROME_URL,
  createTrustedPageChecker,
  isTrustedFileUrl: defaultChecker.isTrustedFileUrl,
  isTrustedInternalUrl: defaultChecker.isTrustedInternalUrl,
};
