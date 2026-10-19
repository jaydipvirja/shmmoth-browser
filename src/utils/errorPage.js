/**
 * ERROR PAGE helpers — errorPage.js
 *
 * When a page cannot be loaded (no internet, unknown host, refused/reset connection, bad certificate, …) Electron
 * leaves the tab blank. The main process then shows mtc://error (src/pages/error.html) in that tab.
 *
 * The failed address travels in the query string and is only ever shown as text and used for "Try again" after the
 * page re-checks that it is http(s); it never reaches innerHTML.
 */

'use strict';

/** ERR_ABORTED: the user navigated elsewhere / pressed Stop, or the response turned into a download. Not an error. */
const IGNORED_CODES = new Set([-3]);

const MAX_URL = 2000;

/**
 * @param {{errorCode:number, validatedURL:string, isMainFrame:boolean}} e  the did-fail-load details
 * @returns {boolean} true when the tab should show the error page
 */
function shouldShowErrorPage({ errorCode, validatedURL, isMainFrame } = {}) {
  if (!isMainFrame) return false;                                          // a broken image / iframe is not a broken page
  if (!Number.isInteger(errorCode) || errorCode >= 0 || IGNORED_CODES.has(errorCode)) return false;
  return typeof validatedURL === 'string' && /^https?:\/\//i.test(validatedURL);   // never for mtc://, file:, … (no loops)
}

/**
 * mtc://error?code=-105&name=ERR_NAME_NOT_RESOLVED&url=<failed address>
 * `httpUrl`: the page was an HTTPS-Only upgrade of this http address that has no working https (https=1&url=<http>:
 * the page offers to continue over http, and only that address is let through — services/privacyShield.js)
 */
function buildErrorPageUrl(errorCode, errorName, failedUrl, httpUrl = '') {
  const name = String(errorName || '').replace(/^net::/i, '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 64);
  if (httpUrl && /^http:\/\//i.test(httpUrl)) {
    return `mtc://error?code=${Number(errorCode) | 0}&name=${encodeURIComponent(name)}&https=1&url=${encodeURIComponent(String(httpUrl).slice(0, MAX_URL))}`;
  }
  return `mtc://error?code=${Number(errorCode) | 0}&name=${encodeURIComponent(name)}&url=${encodeURIComponent(String(failedUrl).slice(0, MAX_URL))}`;
}

/** What the address bar / history / session should show for a tab: the page that failed, not the error page. */
function displayUrl(tab) {
  if (tab && tab.failedUrl && typeof tab.url === 'string' && tab.url.startsWith('mtc://error')) return tab.failedUrl;
  return tab ? tab.url : '';
}

module.exports = { shouldShowErrorPage, buildErrorPageUrl, displayUrl, MAX_URL };
